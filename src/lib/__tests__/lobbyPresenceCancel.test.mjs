/**
 * Presença de jogador: cancelamento do heartbeat e corrida com a exclusão do lobby.
 *
 * Executar: node --test src/lib/__tests__/lobbyPresenceCancel.test.mjs
 *
 * O sintoma era um heartbeat "recriando lobby_players" DEPOIS de o lobby ter
 * sido excluído. Parar o intervalo não bastava: um tick que já estava dentro de
 * touchLobbyPlayer seguia pelos awaits (probe, UPDATE, leitura de rooms) até o
 * UPSERT. Os testes abaixo separam três coisas que costumam ser confundidas:
 * cancelar o agendamento, invalidar o tick em andamento e perder a corrida com
 * a exclusão do lobby.
 */
import test from 'node:test'
import assert from 'node:assert/strict'

import { createFakeSupabase } from '../../game/__tests__/helpers/fakeSupabase.mjs'
import { loadWithFakeSupabase } from '../../game/__tests__/helpers/loadWithFakeSupabase.mjs'

const LOBBY = 'lobby-1111'
const SEATED = 'player-sentado'

/** Lobby existente, jogador sentado na partida, mas SEM row de presença. */
function worldWithMissingPresence () {
  return createFakeSupabase({
    lobbies: [{ id: LOBBY, name: 'Sala', max_players: 4, status: 'locked', host_id: SEATED, created_at: '2026-01-01' }],
    lobby_players: [],
    rooms: [{
      id: 'row-1',
      code: LOBBY,
      version: 4,
      updated_at: '2026-01-01T00:00:00Z',
      state: { matchId: 'm-1', players: [{ id: SEATED, name: 'Sentado' }] },
    }],
  })
}

const loadLobbies = (fake) => loadWithFakeSupabase('../lobbies.js', fake.client, import.meta.url)
const upsertsOfPresence = (fake) => fake.calls.filter((c) => c.table === 'lobby_players' && c.op === 'upsert')

test('tick já em andamento não recria presença depois da saída', async () => {
  const fake = worldWithMissingPresence()
  const lobbies = await loadLobbies(fake)

  let stop = () => {}
  // A saída acontece no meio do tick: o UPDATE de last_seen já foi enviado.
  fake.beforeOp('lobby_players', 'update', async () => { stop() })

  stop = lobbies.startLobbyHeartbeat({
    lobbyId: LOBBY,
    playerId: SEATED,
    intervalMs: 60_000,
    allowRecreateIfSeated: true,
  })
  await new Promise((resolve) => setTimeout(resolve, 30))

  assert.deepEqual(upsertsOfPresence(fake), [], 'presença não pode ser recriada por tick de sessão encerrada')
  assert.deepEqual(fake.tables.lobby_players, [], 'a row não pode ressuscitar')
  stop()
})

test('parar o heartbeat imediatamente invalida o tick disparado na largada', async () => {
  const fake = worldWithMissingPresence()
  const lobbies = await loadLobbies(fake)

  const stop = lobbies.startLobbyHeartbeat({
    lobbyId: LOBBY,
    playerId: SEATED,
    intervalMs: 60_000,
    allowRecreateIfSeated: true,
  })
  stop() // saída no mesmo tick do start

  await new Promise((resolve) => setTimeout(resolve, 30))
  assert.deepEqual(upsertsOfPresence(fake), [], 'nenhuma escrita depois de parar')
})

test('recuperação legítima de presença continua funcionando sem cancelamento', async () => {
  const fake = worldWithMissingPresence()
  const lobbies = await loadLobbies(fake)

  const result = await lobbies.touchLobbyPlayer({
    lobbyId: LOBBY,
    playerId: SEATED,
    allowRecreateIfSeated: true,
  })

  assert.equal(result.ok, true)
  assert.equal(result.restored, true)
  assert.equal(upsertsOfPresence(fake).length, 1)
  assert.equal(fake.tables.lobby_players.length, 1)
})

test('quem não está sentado na partida nunca vira presença', async () => {
  const fake = worldWithMissingPresence()
  const lobbies = await loadLobbies(fake)

  const result = await lobbies.touchLobbyPlayer({
    lobbyId: LOBBY,
    playerId: 'intruso',
    allowRecreateIfSeated: true,
  })

  assert.equal(result.ok, false)
  assert.equal(result.notSeated, true)
  assert.deepEqual(upsertsOfPresence(fake), [])
})

test('lobby excluído entre a validação e a escrita encerra o tick sem ressuscitar nada', async () => {
  const fake = worldWithMissingPresence()
  const lobbies = await loadLobbies(fake)

  // A consulta "o lobby existe?" não elimina a corrida: o lobby some depois dela.
  fake.beforeOp('lobby_players', 'upsert', async () => {
    fake.tables.lobbies = []
  })
  fake.failAlways('lobby_players', 'upsert', { code: '23503', message: 'insert or update on table "lobby_players" violates foreign key constraint' })

  const result = await lobbies.touchLobbyPlayer({
    lobbyId: LOBBY,
    playerId: SEATED,
    allowRecreateIfSeated: true,
  })

  assert.equal(result.ok, false)
  assert.equal(result.lobbyGone, true, 'a violação de FK precisa ser reconhecida como lobby excluído')
  assert.equal(upsertsOfPresence(fake).length, 1, 'sem repetição infinita')
  assert.deepEqual(fake.tables.lobbies, [], 'o lobby não pode ser recriado para esconder a falha')
  assert.deepEqual(fake.tables.lobby_players, [])
})

test('espectador não tem heartbeat: sem lobby ou sem jogador o agendamento nem começa', async () => {
  const fake = worldWithMissingPresence()
  const lobbies = await loadLobbies(fake)

  lobbies.startLobbyHeartbeat({ lobbyId: LOBBY, playerId: null })()
  lobbies.startLobbyHeartbeat({ lobbyId: null, playerId: SEATED })()
  const semJogador = await lobbies.touchLobbyPlayer({ lobbyId: LOBBY, playerId: null })

  await new Promise((resolve) => setTimeout(resolve, 20))
  assert.equal(semJogador.skipped, true)
  assert.deepEqual(fake.calls.filter((c) => c.op !== 'select'), [])
})
