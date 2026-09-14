import { randomUUID } from 'node:crypto'

const shouldRun = process.env.SG_LOAD_TEST_RUN === '1'
const baseUrl = String(process.env.VITE_SUPABASE_URL || '').replace(/\/$/, '')
const anonKey = process.env.VITE_SUPABASE_ANON_KEY || ''
const roomCount = Math.max(1, Math.min(200, Number(process.env.SG_LOAD_TEST_ROOMS) || 25))
const playersPerRoom = Math.max(2, Math.min(8, Number(process.env.SG_LOAD_TEST_PLAYERS) || 4))
const concurrency = Math.max(1, Math.min(40, Number(process.env.SG_LOAD_TEST_CONCURRENCY) || 10))
const createdLobbyIds = []
const latencies = []

if (!shouldRun) {
  console.log('Teste de carga preparado (modo seguro). Para executar: SG_LOAD_TEST_RUN=1 npm run test:load')
  console.log(`Plano padrão: ${roomCount} salas, ${playersPerRoom} jogadores por sala, concorrência ${concurrency}.`)
  process.exit(0)
}

if (!baseUrl || !anonKey) {
  throw new Error('Defina VITE_SUPABASE_URL e VITE_SUPABASE_ANON_KEY para executar o teste de carga.')
}

const headers = {
  apikey: anonKey,
  authorization: `Bearer ${anonKey}`,
  'content-type': 'application/json',
}

async function request(path, { method = 'GET', body, prefer } = {}) {
  const started = performance.now()
  const response = await fetch(`${baseUrl}/rest/v1/${path}`, {
    method,
    headers: { ...headers, ...(prefer ? { prefer } : {}) },
    body: body === undefined ? undefined : JSON.stringify(body),
    signal: AbortSignal.timeout(20_000),
  })
  latencies.push(performance.now() - started)
  const text = await response.text()
  if (!response.ok) throw new Error(`${method} ${path}: ${response.status} ${text.slice(0, 300)}`)
  return text ? JSON.parse(text) : null
}

async function mapLimit(items, limit, worker) {
  const pending = [...items]
  const runners = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (pending.length) await worker(pending.shift())
  })
  await Promise.all(runners)
}

async function exerciseRoom(index) {
  const lobbyId = randomUUID()
  const playerIds = Array.from({ length: playersPerRoom }, () => randomUUID())
  createdLobbyIds.push(lobbyId)

  await request('lobbies', {
    method: 'POST',
    prefer: 'return=minimal',
    body: {
      id: lobbyId,
      name: `LOAD-${Date.now()}-${index}`,
      host_id: playerIds[0],
      max_players: playersPerRoom,
      status: 'open',
      created_at: new Date().toISOString(),
    },
  })

  await Promise.all(playerIds.map((playerId, playerIndex) => request('rpc/join_lobby_atomic', {
    method: 'POST',
    body: {
      p_lobby_id: lobbyId,
      p_player_id: playerId,
      p_player_name: `Carga ${index + 1}.${playerIndex + 1}`,
      p_ready: true,
    },
  })))

  const starts = await Promise.all([0, 1].map(() => request('rpc/start_match_atomic', {
    method: 'POST',
    body: { p_lobby_id: lobbyId, p_host_player_id: playerIds[0] },
  })))

  if (!starts[0]?.id || starts[0].id !== starts[1]?.id) {
    throw new Error(`Sala ${lobbyId} criou partidas diferentes sob concorrência.`)
  }
}

async function cleanup() {
  if (!createdLobbyIds.length) return
  const ids = `(${createdLobbyIds.join(',')})`
  for (const { table, column } of [
    { table: 'matches', column: 'lobby_id' },
    { table: 'lobby_players', column: 'lobby_id' },
    { table: 'lobbies', column: 'id' },
  ]) {
    try {
      await request(`${table}?${column}=in.${ids}`, { method: 'DELETE', prefer: 'return=minimal' })
    } catch (error) {
      console.warn(`Limpeza parcial em ${table}: ${error.message}`)
    }
  }
}

const startedAt = performance.now()
try {
  await mapLimit(Array.from({ length: roomCount }, (_, index) => index), concurrency, exerciseRoom)
  const sorted = [...latencies].sort((a, b) => a - b)
  const percentile = (p) => sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * p))] || 0
  console.log(JSON.stringify({
    ok: true,
    rooms: roomCount,
    players: roomCount * playersPerRoom,
    requests: latencies.length,
    elapsedMs: Math.round(performance.now() - startedAt),
    latencyP50Ms: Math.round(percentile(0.50)),
    latencyP95Ms: Math.round(percentile(0.95)),
  }, null, 2))
} finally {
  await cleanup()
}
