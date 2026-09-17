import { randomUUID } from 'node:crypto'
import { createClient } from '@supabase/supabase-js'

const enabled = process.env.SG_LOAD_TEST_RUN === '1'
const baseUrl = String(process.env.VITE_SUPABASE_URL || '').replace(/\/$/, '')
const anonKey = String(process.env.VITE_SUPABASE_ANON_KEY || '')
const roomCount = Math.max(1, Math.min(40, Number(process.env.SG_LOAD_TEST_ROOMS) || 20))
const playersPerRoom = Math.max(2, Math.min(8, Number(process.env.SG_LOAD_TEST_PLAYERS) || 4))
const durationMs = Math.max(15_000, Math.min(120_000, Number(process.env.SG_LOAD_TEST_DURATION_MS) || 60_000))
const runId = `LOAD-GAME-${Date.now()}-${randomUUID().slice(0, 8)}`
const createdLobbyIds = []
const clients = []
const latencies = []
const failures = []
const metrics = {
  realtimeSubscribed: 0,
  realtimeFailed: 0,
  roomEvents: 0,
  lobbyEvents: 0,
  foreignRoomEvents: 0,
  casWins: 0,
  casLosses: 0,
  heartbeatWrites: 0,
  gameplayCommits: 0,
  reconnects: 0,
  pollingReads: 0,
  pollingFailures: 0,
}

if (!enabled) {
  console.log('Teste multiplayer preparado (modo seguro). Use SG_LOAD_TEST_RUN=1 para executar.')
  process.exit(0)
}
if (!baseUrl || !anonKey) throw new Error('Supabase URL/key ausentes.')

const headers = {
  apikey: anonKey,
  authorization: `Bearer ${anonKey}`,
  'content-type': 'application/json',
}

const sleep = ms => new Promise(resolve => setTimeout(resolve, ms))
const percentile = (values, p) => {
  const sorted = [...values].sort((a, b) => a - b)
  return Math.round(sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * p))] || 0)
}

async function request(path, { method = 'GET', body, prefer = 'return=representation', timeoutMs = 20_000 } = {}) {
  const started = performance.now()
  const response = await fetch(`${baseUrl}/rest/v1/${path}`, {
    method,
    headers: { ...headers, ...(prefer ? { prefer } : {}) },
    body: body === undefined ? undefined : JSON.stringify(body),
    signal: AbortSignal.timeout(timeoutMs),
  })
  latencies.push(performance.now() - started)
  const text = await response.text()
  if (!response.ok) throw new Error(`${method} ${path}: ${response.status} ${text.slice(0, 240)}`)
  return text ? JSON.parse(text) : null
}

function newClient() {
  const client = createClient(baseUrl, anonKey, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
    realtime: { params: { eventsPerSecond: 10 } },
  })
  clients.push(client)
  return client
}

function subscribe(channel, timeoutMs = 15_000) {
  return new Promise(resolve => {
    let done = false
    const finish = (ok, status) => {
      if (done) return
      done = true
      clearTimeout(timer)
      if (ok) metrics.realtimeSubscribed += 1
      else metrics.realtimeFailed += 1
      resolve({ ok, status })
    }
    const timer = setTimeout(() => finish(false, 'TIMEOUT'), timeoutMs)
    channel.subscribe(status => {
      if (status === 'SUBSCRIBED') finish(true, status)
      else if (['CHANNEL_ERROR', 'TIMED_OUT', 'CLOSED'].includes(status)) finish(false, status)
    })
  })
}

async function createRoom(index) {
  const lobbyId = randomUUID()
  const playerIds = Array.from({ length: playersPerRoom }, () => randomUUID())
  createdLobbyIds.push(lobbyId)
  await request('lobbies', {
    method: 'POST',
    body: { id: lobbyId, name: `${runId}-${index}`, host_id: playerIds[0], max_players: playersPerRoom, status: 'open' },
  })
  await Promise.all(playerIds.map((playerId, seat) => request('rpc/join_lobby_atomic', {
    method: 'POST',
    body: { p_lobby_id: lobbyId, p_player_id: playerId, p_player_name: `Carga ${index + 1}.${seat + 1}`, p_ready: true },
  })))
  const starts = await Promise.all([0, 1].map(() => request('rpc/start_match_atomic', {
    method: 'POST', body: { p_lobby_id: lobbyId, p_host_player_id: playerIds[0] },
  })))
  if (!starts[0]?.id || starts[0].id !== starts[1]?.id) throw new Error(`START não idempotente na sala ${index + 1}`)
  const state = {
    loadTest: runId,
    matchId: starts[0].id,
    stateId: randomUUID(),
    players: playerIds.map((id, seat) => ({ id, name: `Carga ${index + 1}.${seat + 1}`, seat, pos: 0, cash: 10000 })),
    turnPlayerId: playerIds[0],
    turnSeq: 0,
    round: 1,
    gameOver: false,
  }
  const rows = await request('rooms', {
    method: 'POST',
    body: { code: lobbyId, host_id: playerIds[0], state, version: 0 },
  })
  if (!rows?.[0]?.id) throw new Error(`rooms INSERT sem retorno na sala ${index + 1}`)
  return { index, lobbyId, playerIds, matchId: starts[0].id, roomId: rows[0].id, version: 0, state }
}

async function connectPlayer(room, playerId, seat) {
  const client = newClient()
  const session = {
    client,
    playerId,
    seat,
    room,
    roomEvents: 0,
    lobbyEvents: 0,
    lastPolledVersion: null,
  }
  const roomChannel = client
    .channel(`rooms:${room.lobbyId}`)
    .on('postgres_changes', { event: '*', schema: 'public', table: 'rooms', filter: `code=eq.${room.lobbyId}` }, payload => {
      metrics.roomEvents += 1
      session.roomEvents += 1
      const code = payload.new?.code || payload.old?.code
      if (code && String(code) !== room.lobbyId) metrics.foreignRoomEvents += 1
    })
  const lobbyChannel = client
    .channel(`lobby-${room.lobbyId}`)
    .on('postgres_changes', { event: '*', schema: 'public', table: 'lobby_players', filter: `lobby_id=eq.${room.lobbyId}` }, () => {
      metrics.lobbyEvents += 1
      session.lobbyEvents += 1
    })
  const spectatorChannel = client.channel(`spectators:${room.lobbyId}`, { config: { presence: { key: '' } } })
  const statuses = await Promise.all([subscribe(roomChannel), subscribe(lobbyChannel), subscribe(spectatorChannel)])
  session.channels = [roomChannel, lobbyChannel, spectatorChannel]
  session.statuses = statuses
  return session
}

async function patchRoom(room, nextState, expectedVersion) {
  const rows = await request(`rooms?id=eq.${room.roomId}&version=eq.${expectedVersion}`, {
    method: 'PATCH',
    body: { state: nextState, version: expectedVersion + 1, updated_at: new Date().toISOString() },
  })
  return rows?.[0] || null
}

async function contentionProbe(room) {
  const base = room.state
  const expected = room.version
  const attempts = await Promise.all(['A', 'B'].map(candidate => patchRoom(room, {
    ...base,
    stateId: randomUUID(),
    contentionWinner: candidate,
  }, expected)))
  const wins = attempts.filter(Boolean)
  metrics.casWins += wins.length
  metrics.casLosses += attempts.length - wins.length
  if (wins.length !== 1) failures.push(`Sala ${room.index + 1}: CAS teve ${wins.length} vencedores`)
  const latest = await request(`rooms?id=eq.${room.roomId}&select=id,state,version`)
  if (!latest?.[0]) throw new Error(`Sala ${room.index + 1}: snapshot ausente após CAS`)
  room.version = latest[0].version
  room.state = latest[0].state
}

async function gameplayCommit(room, sequence) {
  const seat = sequence % room.playerIds.length
  const playerId = room.playerIds[seat]
  const steps = (sequence % 6) + 1
  const players = room.state.players.map(player => String(player.id) === String(playerId)
    ? { ...player, pos: (Number(player.pos) + steps) % 40, cash: Number(player.cash) + 100 }
    : player)
  const state = {
    ...room.state,
    stateId: randomUUID(),
    players,
    turnSeq: sequence,
    turnPlayerId: room.playerIds[(seat + 1) % room.playerIds.length],
    lastRoll: { id: `${runId}:${room.index}:${sequence}`, playerId, steps },
  }
  const updated = await patchRoom(room, state, room.version)
  if (!updated) {
    failures.push(`Sala ${room.index + 1}: commit ${sequence} perdeu CAS sem concorrência`)
    return
  }
  room.version = updated.version
  room.state = updated.state
  metrics.gameplayCommits += 1
}

async function touchPlayer(session) {
  const rows = await request(`lobby_players?lobby_id=eq.${session.room.lobbyId}&player_id=eq.${session.playerId}`, {
    method: 'PATCH', body: { last_seen: new Date().toISOString() },
  })
  if (!rows?.length) failures.push(`Heartbeat sem row: sala ${session.room.index + 1}, assento ${session.seat + 1}`)
  else metrics.heartbeatWrites += 1
}

async function pollPlayer(session) {
  try {
    const rows = await request(`rooms?id=eq.${session.room.roomId}&select=version,state`, { prefer: '' })
    const snapshot = rows?.[0]
    if (!snapshot) throw new Error('snapshot ausente')
    if (snapshot.state?.loadTest !== runId) throw new Error('estado de outra execução')
    session.lastPolledVersion = snapshot.version
    metrics.pollingReads += 1
  } catch (error) {
    metrics.pollingFailures += 1
    failures.push(`Polling sala ${session.room.index + 1}, assento ${session.seat + 1}: ${error.message}`)
  }
}

async function sustainedTraffic(rooms, sessions) {
  const started = Date.now()
  let presenceTick = 0
  let gameTick = 0
  while (Date.now() - started < durationMs) {
    presenceTick += 1
    await Promise.all(sessions.map(touchPlayer))
    if (presenceTick % 2 === 0) await Promise.all(sessions.map(touchPlayer))
    if (presenceTick % 2 === 0) await Promise.all(sessions.map(pollPlayer))
    if ((Date.now() - started) >= (gameTick + 1) * 15_000) {
      gameTick += 1
      await Promise.all(rooms.map(room => gameplayCommit(room, gameTick + 1)))
    }
    const nextAt = started + presenceTick * 5_000
    await sleep(Math.max(0, nextAt - Date.now()))
  }
}

async function reconnectProbe(rooms, sessions) {
  const selected = rooms.map(room => sessions.find(session => session.room === room && session.seat === 0))
  await Promise.all(selected.map(async session => {
    await Promise.all(session.channels.map(channel => session.client.removeChannel(channel).catch(() => {})))
    const client = newClient()
    const channel = client
      .channel(`rooms:${session.room.lobbyId}:reconnect`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'rooms', filter: `code=eq.${session.room.lobbyId}` }, () => { metrics.roomEvents += 1 })
    const status = await subscribe(channel)
    if (!status.ok) {
      failures.push(`Sala ${session.room.index + 1}: reconexão Realtime falhou (${status.status})`)
      return
    }
    const snapshot = await request(`rooms?id=eq.${session.room.roomId}&select=version,state`)
    if (snapshot?.[0]?.version !== session.room.version) failures.push(`Sala ${session.room.index + 1}: reconexão recebeu versão incorreta`)
    else metrics.reconnects += 1
  }))
}

async function cleanup() {
  await Promise.allSettled(clients.map(client => client.removeAllChannels()))
  if (!createdLobbyIds.length) return
  const ids = `(${createdLobbyIds.join(',')})`
  for (const { table, column } of [
    { table: 'rooms', column: 'code' },
    { table: 'matches', column: 'lobby_id' },
    { table: 'lobby_players', column: 'lobby_id' },
    { table: 'lobbies', column: 'id' },
  ]) {
    try { await request(`${table}?${column}=in.${ids}`, { method: 'DELETE', prefer: 'return=minimal' }) }
    catch (error) { failures.push(`Limpeza ${table}: ${error.message}`) }
  }
}

const startedAt = performance.now()
let rooms = []
let sessions = []
try {
  rooms = await Promise.all(Array.from({ length: roomCount }, (_, index) => createRoom(index)))
  sessions = (await Promise.all(rooms.flatMap(room => room.playerIds.map((id, seat) => connectPlayer(room, id, seat))))).flat()
  const badSubscriptions = sessions.flatMap(session => session.statuses.filter(status => !status.ok))
  if (badSubscriptions.length) failures.push(`${badSubscriptions.length} canais falharam na conexão inicial`)
  await Promise.all(rooms.map(contentionProbe))
  await sustainedTraffic(rooms, sessions)
  await sleep(2_000)
  await Promise.all(sessions.map(pollPlayer))
  for (const session of sessions) {
    if (session.lastPolledVersion !== session.room.version) {
      failures.push(`Sala ${session.room.index + 1}, assento ${session.seat + 1}: polling terminou em v${session.lastPolledVersion}, esperado v${session.room.version}`)
    }
  }
  await reconnectProbe(rooms, sessions)
  await sleep(1_000)
} catch (error) {
  failures.push(error?.stack || error?.message || String(error))
} finally {
  await cleanup()
}

const leftovers = await Promise.all(['rooms?code', 'matches?lobby_id', 'lobby_players?lobby_id', 'lobbies?id'].map(async spec => {
  const [table, column] = spec.split('?')
  const ids = `(${createdLobbyIds.join(',')})`
  const rows = await request(`${table}?${column}=in.${ids}&select=${column}`, { prefer: '' }).catch(() => null)
  return { table, rows: Array.isArray(rows) ? rows.length : null }
}))
for (const item of leftovers) if (item.rows !== 0) failures.push(`Resíduo após teste em ${item.table}: ${item.rows}`)

const realtimeRoomSilentSessions = sessions.filter(session => session.roomEvents === 0).length
const realtimeLobbySilentSessions = sessions.filter(session => session.lobbyEvents === 0).length
const expectedLobbyEvents = metrics.heartbeatWrites * playersPerRoom
const lobbyDeliveryRatio = expectedLobbyEvents > 0
  ? Number((metrics.lobbyEvents / expectedLobbyEvents).toFixed(3))
  : null

console.log(JSON.stringify({
  ok: failures.length === 0,
  runId,
  rooms: roomCount,
  players: roomCount * playersPerRoom,
  durationMs,
  elapsedMs: Math.round(performance.now() - startedAt),
  requests: latencies.length,
  latencyP50Ms: percentile(latencies, 0.50),
  latencyP95Ms: percentile(latencies, 0.95),
  latencyP99Ms: percentile(latencies, 0.99),
  metrics,
  realtimeRoomSilentSessions,
  realtimeLobbySilentSessions,
  expectedLobbyEvents,
  lobbyDeliveryRatio,
  leftovers,
  failures,
}, null, 2))

if (failures.length) process.exitCode = 1
