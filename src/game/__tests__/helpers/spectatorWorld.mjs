/**
 * Mundo de teste do modo espectador: duas salas independentes.
 *
 * Sala A é onde a sessão joga (e de onde ela sai). Sala B é a partida em
 * andamento que se quer assistir. Os identificadores são propositalmente
 * diferentes entre si — id do lobby, code da sala, id físico da row de rooms e
 * matchId — porque o bug original confundia justamente esses quatro.
 */

export const ROOM_A = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
export const ROOM_B = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'
export const MATCH_B = 'match-b-11111111'
export const ROOM_B_ROW_ID = 'row-fisica-b-99999999'

export const PLAYERS_B = [
  { id: 'p-ana', name: 'Ana', cash: 12000, pos: 4, seat: 0, joinOrder: 0, color: '#FFD600', bens: 0, clients: 1 },
  { id: 'p-bru', name: 'Bruno', cash: 9000, pos: 9, seat: 1, joinOrder: 1, color: '#2196F3', bens: 0, clients: 2 },
]

export function roomBState (overrides = {}) {
  return {
    matchId: MATCH_B,
    stateId: 'state-b-3',
    kind: 'PATCH',
    players: PLAYERS_B.map((p) => ({ ...p })),
    turnPlayerId: 'p-ana',
    turnSeq: 4,
    round: 2,
    maxRounds: 5,
    turnTimeSec: 60,
    gameOver: false,
    winner: null,
    turnLock: false,
    lockOwner: null,
    roundFlags: [false, false],
    boardVersion: 'v2-40',
    ...overrides,
  }
}

export function roomBRow ({ version = 3, state } = {}) {
  return {
    id: ROOM_B_ROW_ID,
    code: ROOM_B,
    host_id: 'p-ana',
    version,
    updated_at: '2026-01-02T00:05:00Z',
    state: state || roomBState(),
  }
}

const nowIso = () => new Date().toISOString()

export function worldFixture ({ roomB = roomBRow(), extraRooms = [] } = {}) {
  return {
    lobbies: [
      { id: ROOM_A, name: 'Sala A', max_players: 4, status: 'open', host_id: null, created_at: '2026-01-01T00:00:00Z' },
      { id: ROOM_B, name: 'Sala B', max_players: 4, status: 'locked', host_id: 'p-ana', created_at: '2026-01-02T00:00:00Z' },
    ],
    lobby_players: [
      { lobby_id: ROOM_A, player_id: 'p-z', player_name: 'Zeca', ready: true, joined_at: '2026-01-01T00:00:01Z', last_seen: nowIso() },
      { lobby_id: ROOM_B, player_id: 'p-ana', player_name: 'Ana', ready: true, joined_at: '2026-01-02T00:00:00Z', last_seen: nowIso() },
      { lobby_id: ROOM_B, player_id: 'p-bru', player_name: 'Bruno', ready: true, joined_at: '2026-01-02T00:00:01Z', last_seen: nowIso() },
    ],
    matches: [{ id: MATCH_B, lobby_id: ROOM_B, created_at: '2026-01-02T00:01:00Z' }],
    rooms: roomB ? [roomB, ...extraRooms] : [...extraRooms],
  }
}

/**
 * Avança a partida da sala B como o host faria: a escrita passa pelo client,
 * então o Realtime do dublê dispara igual ao Postgres changes real.
 */
export async function advanceRoomB (fake, patch = {}) {
  const row = fake.tables.rooms.find((r) => r.code === ROOM_B)
  if (!row) throw new Error('sala B não existe no mundo de teste')
  const version = (row.version || 0) + 1
  const state = { ...row.state, ...patch, stateId: `state-b-${version}` }
  await fake.client
    .from('rooms')
    .update({ state, version, updated_at: new Date().toISOString() })
    .eq('id', row.id)
    .select('id, code, state, version, updated_at')
    .maybeSingle()
  return fake.tables.rooms.find((r) => r.code === ROOM_B)
}

/** Joga uma partida completa na sala A e sai — deixa a sessão "suja". */
export async function playMatchInRoomA (app) {
  await app.settle(6)
  await app.click('Pular tutorial').catch(() => {})
  await app.type('Carla')
  await app.click('Jogar online')
  await app.settle(8)
  await app.click('Ficar pronto')
  await app.settle(4)
  await app.click('Iniciar partida')
  await app.settle(10)
}
