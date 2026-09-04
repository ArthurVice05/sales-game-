import test from 'node:test'
import assert from 'node:assert/strict'

import {
  SESSION_ROLE,
  SPECTATOR_READ_ONLY,
  buildSpectateSearch,
  canSessionMutateGame,
  clearSpectateFromSearch,
  hasSpectatableMatchState,
  isSpectatorSession,
  isValidSessionCombination,
  normalizeSessionRole,
  parseSpectateRequest,
  resolveLobbyEntryAction,
  resolveSpectatorEntry,
  resolveSpectatorViewPlayerId,
} from '../spectatorMode.js'
import {
  GAME_MODE,
  resolveGameplayActorId,
  shouldCreateGameBroadcastChannel,
} from '../localHotseat.js'

const A = '00000000-0000-4000-8000-0000000000aa'
const B = '00000000-0000-4000-8000-0000000000bb'
const C = '00000000-0000-4000-8000-0000000000cc'
const roster = [{ id: A, name: 'João' }, { id: B, name: 'Victor' }, { id: C, name: 'Felipe' }]

/* ---------------------------------------------------------------- papéis */

test('SESSION_ROLE expõe apenas player/spectator e é imutável', () => {
  assert.deepEqual({ ...SESSION_ROLE }, { PLAYER: 'player', SPECTATOR: 'spectator' })
  assert.equal(Object.isFrozen(SESSION_ROLE), true)
})

test('normalizeSessionRole tem player como padrão seguro', () => {
  assert.equal(normalizeSessionRole(SESSION_ROLE.SPECTATOR), SESSION_ROLE.SPECTATOR)
  assert.equal(normalizeSessionRole('spectator'), SESSION_ROLE.SPECTATOR)
  assert.equal(normalizeSessionRole('player'), SESSION_ROLE.PLAYER)
  assert.equal(normalizeSessionRole(undefined), SESSION_ROLE.PLAYER)
  assert.equal(normalizeSessionRole(null), SESSION_ROLE.PLAYER)
  assert.equal(normalizeSessionRole('qualquer-coisa'), SESSION_ROLE.PLAYER)
})

test('isSpectatorSession é fail-safe: papel spectator nunca é tratado como jogador', () => {
  assert.equal(isSpectatorSession({ gameMode: GAME_MODE.ONLINE, sessionRole: SESSION_ROLE.SPECTATOR }), true)
  assert.equal(isSpectatorSession({ gameMode: GAME_MODE.ONLINE, sessionRole: SESSION_ROLE.PLAYER }), false)
  assert.equal(isSpectatorSession({ gameMode: GAME_MODE.LOCAL, sessionRole: SESSION_ROLE.PLAYER }), false)
  // Combinação inválida (local+spectator) jamais pode virar autorização de escrita.
  assert.equal(isSpectatorSession({ gameMode: GAME_MODE.LOCAL, sessionRole: SESSION_ROLE.SPECTATOR }), true)
  assert.equal(isSpectatorSession({}), false)
})

test('isValidSessionCombination rejeita apenas local+spectator', () => {
  assert.equal(isValidSessionCombination({ gameMode: GAME_MODE.ONLINE, sessionRole: SESSION_ROLE.PLAYER }), true)
  assert.equal(isValidSessionCombination({ gameMode: GAME_MODE.ONLINE, sessionRole: SESSION_ROLE.SPECTATOR }), true)
  assert.equal(isValidSessionCombination({ gameMode: GAME_MODE.LOCAL, sessionRole: SESSION_ROLE.PLAYER }), true)
  assert.equal(isValidSessionCombination({ gameMode: GAME_MODE.LOCAL, sessionRole: SESSION_ROLE.SPECTATOR }), false)
})

test('canSessionMutateGame libera jogadores e bloqueia espectadores', () => {
  assert.equal(canSessionMutateGame({ gameMode: GAME_MODE.ONLINE, sessionRole: SESSION_ROLE.PLAYER }), true)
  assert.equal(canSessionMutateGame({ gameMode: GAME_MODE.LOCAL, sessionRole: SESSION_ROLE.PLAYER }), true)
  assert.equal(canSessionMutateGame({ gameMode: GAME_MODE.LOCAL }), true)
  assert.equal(canSessionMutateGame({ gameMode: GAME_MODE.ONLINE, sessionRole: SESSION_ROLE.SPECTATOR }), false)
  assert.equal(canSessionMutateGame({ gameMode: GAME_MODE.LOCAL, sessionRole: SESSION_ROLE.SPECTATOR }), false)
})

test('SPECTATOR_READ_ONLY é um resultado neutro congelado', () => {
  assert.deepEqual({ ...SPECTATOR_READ_ONLY }, { ok: false, skipped: true, reason: 'spectator-read-only' })
  assert.equal(Object.isFrozen(SPECTATOR_READ_ONLY), true)
})

/* ------------------------------------------------- ator de gameplay (§39) */

test('gameplayActorId: online player usa myUid, online spectator é sempre null', () => {
  assert.equal(resolveGameplayActorId({
    gameMode: GAME_MODE.ONLINE,
    sessionRole: SESSION_ROLE.PLAYER,
    myUid: A,
    turnPlayerId: B,
  }), A)

  assert.equal(resolveGameplayActorId({
    gameMode: GAME_MODE.ONLINE,
    sessionRole: SESSION_ROLE.SPECTATOR,
    myUid: A,
    turnPlayerId: B,
  }), null)
})

test('gameplayActorId: hot-seat permanece intacto e ignora papel ausente', () => {
  assert.equal(resolveGameplayActorId({
    gameMode: GAME_MODE.LOCAL,
    localTurnReady: true,
    turnPlayerId: B,
    myUid: A,
  }), B)

  assert.equal(resolveGameplayActorId({
    gameMode: GAME_MODE.LOCAL,
    localTurnReady: false,
    turnPlayerId: B,
    myUid: A,
  }), null)

  assert.equal(resolveGameplayActorId({
    gameMode: GAME_MODE.LOCAL,
    sessionRole: SESSION_ROLE.PLAYER,
    localTurnReady: true,
    turnPlayerId: B,
    myUid: A,
  }), B)

  // online sem papel declarado continua sendo jogador (regressão do fluxo atual)
  assert.equal(resolveGameplayActorId({ gameMode: GAME_MODE.ONLINE, myUid: A }), A)
})

test('gameplayActorId: papel spectator anula autoridade mesmo em combinação inválida', () => {
  assert.equal(resolveGameplayActorId({
    gameMode: GAME_MODE.LOCAL,
    sessionRole: SESSION_ROLE.SPECTATOR,
    localTurnReady: true,
    turnPlayerId: B,
    myUid: A,
  }), null)
})

/* --------------------------------------------- BroadcastChannel (§19/§47) */

test('BroadcastChannel: só online player com sala cria canal', () => {
  assert.equal(shouldCreateGameBroadcastChannel({
    gameMode: GAME_MODE.ONLINE,
    sessionRole: SESSION_ROLE.PLAYER,
    lobbyId: 'sala-1',
  }), true)

  assert.equal(shouldCreateGameBroadcastChannel({
    gameMode: GAME_MODE.ONLINE,
    sessionRole: SESSION_ROLE.SPECTATOR,
    lobbyId: 'sala-1',
  }), false)

  assert.equal(shouldCreateGameBroadcastChannel({
    gameMode: GAME_MODE.LOCAL,
    sessionRole: SESSION_ROLE.PLAYER,
    lobbyId: 'sala-1',
  }), false)

  assert.equal(shouldCreateGameBroadcastChannel({
    gameMode: GAME_MODE.ONLINE,
    lobbyId: 'sala-1',
  }), true)

  assert.equal(shouldCreateGameBroadcastChannel({
    gameMode: GAME_MODE.ONLINE,
    sessionRole: SESSION_ROLE.PLAYER,
    lobbyId: '',
  }), false)
})

/* ------------------------------------------------ perspectiva visual (§23) */

test('resolveSpectatorViewPlayerId acompanha o jogador da vez', () => {
  assert.equal(resolveSpectatorViewPlayerId({ turnPlayerId: B, players: roster }), B)
  assert.equal(resolveSpectatorViewPlayerId({ turnPlayerId: C, players: roster }), C)
})

test('resolveSpectatorViewPlayerId cai para o primeiro do roster quando o turno não resolve', () => {
  assert.equal(resolveSpectatorViewPlayerId({ turnPlayerId: null, players: roster }), A)
  assert.equal(resolveSpectatorViewPlayerId({ turnPlayerId: 'fora-do-roster', players: roster }), A)
  assert.equal(resolveSpectatorViewPlayerId({ turnPlayerId: B, players: [] }), null)
  assert.equal(resolveSpectatorViewPlayerId({}), null)
})

/* ------------------------------------- validação de entrada (§7 / ajuste 3) */

test('hasSpectatableMatchState exige roster no snapshot autoritativo', () => {
  assert.equal(hasSpectatableMatchState({ players: roster }), true)
  assert.equal(hasSpectatableMatchState({ players: [] }), false)
  assert.equal(hasSpectatableMatchState({}), false)
  assert.equal(hasSpectatableMatchState(null), false)
})

test('resolveSpectatorEntry recusa sala inválida, inexistente ou sem partida', () => {
  const invalid = resolveSpectatorEntry({ roomCode: '  ', meta: { state: { players: roster } } })
  assert.equal(invalid.ok, false)
  assert.equal(invalid.reason, 'invalid-room')
  assert.ok(invalid.message)

  const missing = resolveSpectatorEntry({ roomCode: 'ABC', meta: null })
  assert.equal(missing.ok, false)
  assert.equal(missing.reason, 'room-not-found')
  assert.ok(missing.message)

  const deleted = resolveSpectatorEntry({ roomCode: 'ABC', meta: { state: null } })
  assert.equal(deleted.ok, false)
  assert.equal(deleted.reason, 'room-not-found')

  const notStarted = resolveSpectatorEntry({ roomCode: 'ABC', meta: { state: { players: [] } } })
  assert.equal(notStarted.ok, false)
  assert.equal(notStarted.reason, 'match-not-started')
  assert.match(notStarted.message, /assistir/i)
})

test('resolveSpectatorEntry aceita partida em andamento e partida encerrada consultável', () => {
  const playing = resolveSpectatorEntry({
    roomCode: 'ABC',
    meta: { state: { players: roster, turnPlayerId: A } },
  })
  assert.equal(playing.ok, true)
  assert.equal(playing.roomCode, 'ABC')

  const finished = resolveSpectatorEntry({
    roomCode: 'ABC',
    meta: { state: { players: roster, gameOver: true, winner: A } },
  })
  assert.equal(finished.ok, true)
})

test('resolveSpectatorEntry nunca devolve jogador de fallback', () => {
  const result = resolveSpectatorEntry({ roomCode: 'ABC', meta: { state: { players: [] } } })
  assert.equal(Object.prototype.hasOwnProperty.call(result, 'playerId'), false)
  assert.equal(Object.prototype.hasOwnProperty.call(result, 'players'), false)
})

/* ---------------------------------------------------------- URL (§29/§48) */

test('parseSpectateRequest reconhece room + spectate=1 e room + role=spectator', () => {
  assert.deepEqual(parseSpectateRequest('?room=ABC&spectate=1'), { requested: true, roomCode: 'ABC' })
  assert.deepEqual(parseSpectateRequest('room=ABC&spectate=1'), { requested: true, roomCode: 'ABC' })
  assert.deepEqual(parseSpectateRequest('?room=ABC&role=spectator'), { requested: true, roomCode: 'ABC' })
})

test('parseSpectateRequest ignora pedidos incompletos ou desligados', () => {
  assert.deepEqual(parseSpectateRequest('?room=ABC'), { requested: false, roomCode: 'ABC' })
  assert.deepEqual(parseSpectateRequest('?spectate=1'), { requested: false, roomCode: null })
  assert.deepEqual(parseSpectateRequest('?room=ABC&spectate=0'), { requested: false, roomCode: 'ABC' })
  assert.deepEqual(parseSpectateRequest('?room=ABC&role=player'), { requested: false, roomCode: 'ABC' })
  assert.deepEqual(parseSpectateRequest(''), { requested: false, roomCode: null })
  assert.deepEqual(parseSpectateRequest(null), { requested: false, roomCode: null })
})

test('buildSpectateSearch e clearSpectateFromSearch mantêm a URL coerente', () => {
  const entered = buildSpectateSearch('', { roomCode: 'ABC' })
  assert.deepEqual(parseSpectateRequest(entered), { requested: true, roomCode: 'ABC' })

  const cleared = clearSpectateFromSearch(entered)
  assert.deepEqual(parseSpectateRequest(cleared), { requested: false, roomCode: null })
  assert.equal(cleared.includes('spectate'), false)
  assert.equal(cleared.includes('room'), false)

  // preserva parâmetros alheios
  const withExtra = buildSpectateSearch('?debug=1', { roomCode: 'ABC' })
  assert.match(withExtra, /debug=1/)
  assert.match(clearSpectateFromSearch(withExtra), /debug=1/)
})

/* -------------------------------------------- entrada pela lista (§27/§42) */

test('sala aberta continua no fluxo de jogador', () => {
  assert.deepEqual(
    resolveLobbyEntryAction({ status: 'open', isFull: false }),
    { action: 'join', label: 'Entrar agora', disabled: false }
  )
  assert.deepEqual(
    resolveLobbyEntryAction({ status: 'open', isFull: true }),
    { action: 'none', label: 'Sala lotada', disabled: true }
  )
})

test('identidade local naquela sala tem prioridade sobre assistir (§28/§42)', () => {
  for (const status of ['playing', 'in_game', 'locked']) {
    assert.deepEqual(
      resolveLobbyEntryAction({ status, hasLocalMatchIdentity: true, canResume: true, isFull: true }),
      { action: 'resume', label: 'Retomar partida', disabled: false }
    )
    assert.deepEqual(
      resolveLobbyEntryAction({ status, hasLocalMatchIdentity: true, canResume: false }),
      { action: 'resume', label: 'Reentrar na partida', disabled: false }
    )
  }
})

test('outsider em partida em andamento recebe assistir mesmo com sala cheia (§41)', () => {
  for (const status of ['playing', 'in_game']) {
    assert.deepEqual(
      resolveLobbyEntryAction({ status, hasLocalMatchIdentity: false, isFull: true }),
      { action: 'spectate', label: 'Assistir partida', disabled: false }
    )
    assert.deepEqual(
      resolveLobbyEntryAction({ status, hasLocalMatchIdentity: false, isFull: false }),
      { action: 'spectate', label: 'Assistir partida', disabled: false }
    )
  }
})

test('sala apenas bloqueada sem identidade continua indisponível', () => {
  assert.deepEqual(
    resolveLobbyEntryAction({ status: 'locked', hasLocalMatchIdentity: false }),
    { action: 'none', label: 'Sala bloqueada', disabled: true }
  )
})
