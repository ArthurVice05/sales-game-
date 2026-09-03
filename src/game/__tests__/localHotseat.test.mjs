import test from 'node:test'
import assert from 'node:assert/strict'

import {
  GAME_MODE,
  LOCAL_PLAYER_COLORS,
  applyStarterKit,
  createLocalPlayers,
  isLocalTurnReady,
  localTurnKey,
  resolveGameplayActorId,
  shouldCreateGameBroadcastChannel,
  shouldEnableTurnTimer,
  shouldOpenLocalHandoff,
  validateLocalPlayerNames,
} from '../localHotseat.js'
import { MANUAL_CONSTANTS } from '../manualConstants.js'
import { planOfflineTurnSkip } from '../offlineTurnSkip.js'
import { computeTurnDeadlineAt, sanitizeTurnDeadlineOnHandoff } from '../turnTimerLogic.js'

const ids = [
  '00000000-0000-4000-8000-000000000001',
  '00000000-0000-4000-8000-000000000002',
  '00000000-0000-4000-8000-000000000003',
  '00000000-0000-4000-8000-000000000004',
]

function deterministicIdFactory() {
  let index = 0
  return () => ids[index++]
}

for (const count of [2, 3, 4]) {
  test(`createLocalPlayers creates ${count} distinct ordered starter players`, () => {
    const names = ['João', 'Victor', 'Felipe', 'Hiarley'].slice(0, count)
    const players = createLocalPlayers(names, { createId: deterministicIdFactory() })

    assert.equal(players.length, count)
    assert.equal(new Set(players.map((player) => player.id)).size, count)
    assert.deepEqual(players.map((player) => player.seat), names.map((_, index) => index))
    assert.deepEqual(players.map((player) => player.joinOrder), names.map((_, index) => index))
    assert.deepEqual(players.map((player) => player.name), names)

    for (const [index, player] of players.entries()) {
      assert.equal(player.color, LOCAL_PLAYER_COLORS[index])
      assert.equal(player.cash, MANUAL_CONSTANTS.startCash)
      assert.equal(player.bens, MANUAL_CONSTANTS.startBens)
      assert.equal(player.pos, 0)
      assert.equal(player.mixProdutos, 'D')
      assert.equal(player.erpLevel, 'D')
      assert.equal(player.clients, 1)
      assert.equal(player.vendedoresComuns, 1)
      assert.equal(player.loanTakenInMatch, false)
      assert.equal(player.lastChargedLoanId, null)
    }
  })
}

test('local roster validation enforces 2-4 non-empty unique names', () => {
  assert.equal(validateLocalPlayerNames(['A']).ok, false)
  assert.equal(validateLocalPlayerNames(['A', 'B', 'C', 'D', 'E']).ok, false)
  assert.equal(validateLocalPlayerNames(['A', '']).ok, false)
  assert.equal(validateLocalPlayerNames(['João', ' joão ']).ok, false)
  assert.deepEqual(validateLocalPlayerNames([' João ', 'Victor']), {
    ok: true,
    names: ['João', 'Victor'],
    error: '',
  })
})

test('applyStarterKit preserves supplied values and fills the official defaults', () => {
  const supplied = applyStarterKit({ clients: 3, loanTakenInMatch: true })
  assert.equal(supplied.clients, 3)
  assert.equal(supplied.loanTakenInMatch, true)
  assert.equal(supplied.mixProdutos, 'D')
  assert.equal(supplied.erpLevel, 'D')
  assert.equal(supplied.vendedoresComuns, 1)
  assert.equal(supplied.lastChargedLoanId, null)
})

test('online gameplay actor remains myUid and local actor requires handoff confirmation', () => {
  assert.equal(resolveGameplayActorId({
    gameMode: GAME_MODE.ONLINE,
    myUid: 'A',
    turnPlayerId: 'B',
    localTurnReady: false,
  }), 'A')

  assert.equal(resolveGameplayActorId({
    gameMode: GAME_MODE.LOCAL,
    myUid: 'device',
    turnPlayerId: 'B',
    localTurnReady: false,
  }), null)

  assert.equal(resolveGameplayActorId({
    gameMode: GAME_MODE.LOCAL,
    myUid: 'device',
    turnPlayerId: 'B',
    localTurnReady: true,
  }), 'B')
})

test('handoff is keyed by authoritative player and monotonic turn sequence', () => {
  assert.equal(localTurnKey('A', 0), 'A:0')
  assert.equal(localTurnKey('B', 1), 'B:1')
  assert.equal(localTurnKey('', 1), null)

  assert.equal(shouldOpenLocalHandoff({
    gameMode: GAME_MODE.LOCAL,
    gameOver: false,
    turnPlayerId: 'B',
    turnSeq: 1,
    localTurnReady: false,
    acknowledgedTurnKey: 'A:0',
  }), true)
  assert.equal(shouldOpenLocalHandoff({
    gameMode: GAME_MODE.LOCAL,
    gameOver: false,
    turnPlayerId: 'B',
    turnSeq: 1,
    localTurnReady: true,
    acknowledgedTurnKey: 'B:1',
  }), false)
  assert.equal(shouldOpenLocalHandoff({
    gameMode: GAME_MODE.LOCAL,
    gameOver: true,
    turnPlayerId: 'B',
    turnSeq: 1,
    localTurnReady: false,
    acknowledgedTurnKey: 'A:0',
  }), false)
})

test('local timer is disabled during handoff and enabled only after confirmation', () => {
  assert.equal(shouldEnableTurnTimer({ gameMode: GAME_MODE.LOCAL, localTurnReady: false }), false)
  assert.equal(shouldEnableTurnTimer({ gameMode: GAME_MODE.LOCAL, localTurnReady: true }), true)
  assert.equal(shouldEnableTurnTimer({ gameMode: GAME_MODE.ONLINE, localTurnReady: false }), true)
})

test('BroadcastChannel is available only to an identified online room', () => {
  assert.equal(shouldCreateGameBroadcastChannel({ gameMode: GAME_MODE.LOCAL, lobbyId: null }), false)
  assert.equal(shouldCreateGameBroadcastChannel({ gameMode: GAME_MODE.LOCAL, lobbyId: 'room' }), false)
  assert.equal(shouldCreateGameBroadcastChannel({ gameMode: GAME_MODE.ONLINE, lobbyId: null }), false)
  assert.equal(shouldCreateGameBroadcastChannel({ gameMode: GAME_MODE.ONLINE, lobbyId: 'room' }), true)
})

test('three-player hot-seat cycle requires one confirmation for A → B → C → A', () => {
  let acknowledgedTurnKey = null
  const observedKeys = new Set()
  const turns = [
    { turnPlayerId: 'A', turnSeq: 0 },
    { turnPlayerId: 'B', turnSeq: 1 },
    { turnPlayerId: 'C', turnSeq: 2 },
    { turnPlayerId: 'A', turnSeq: 3 },
  ]

  for (const turn of turns) {
    const key = localTurnKey(turn.turnPlayerId, turn.turnSeq)
    assert.equal(isLocalTurnReady({
      gameMode: GAME_MODE.LOCAL,
      turnPlayerId: turn.turnPlayerId,
      turnSeq: turn.turnSeq,
      acknowledgedTurnKey,
    }), false)
    assert.equal(resolveGameplayActorId({
      gameMode: GAME_MODE.LOCAL,
      localTurnReady: false,
      turnPlayerId: turn.turnPlayerId,
      myUid: 'device',
    }), null)

    assert.equal(observedKeys.has(key), false)
    observedKeys.add(key)
    acknowledgedTurnKey = key

    assert.equal(isLocalTurnReady({
      gameMode: GAME_MODE.LOCAL,
      turnPlayerId: turn.turnPlayerId,
      turnSeq: turn.turnSeq,
      acknowledgedTurnKey,
    }), true)
    assert.equal(resolveGameplayActorId({
      gameMode: GAME_MODE.LOCAL,
      localTurnReady: true,
      turnPlayerId: turn.turnPlayerId,
      myUid: 'device',
    }), turn.turnPlayerId)
  }
})

test('offline auto-pass skips a bankrupt player without incrementing round', () => {
  const plan = planOfflineTurnSkip({
    players: [
      { id: 'A', bankrupt: false },
      { id: 'B', bankrupt: true },
      { id: 'C', bankrupt: false },
    ],
    turnPlayerId: 'A',
    turnSeq: 7,
    round: 2,
    maxRounds: 5,
  })

  assert.equal(plan.nextTurnPlayerId, 'C')
  assert.equal(plan.nextTurnSeq, 8)
  assert.equal(plan.nextRound, 2)
})

test('handoff time does not reduce the fresh deadline granted on confirmation', () => {
  const handoffStartedAt = 1_000
  const confirmedAt = handoffStartedAt + 45_000
  const turnTimeSec = 90
  assert.equal(computeTurnDeadlineAt(confirmedAt, turnTimeSec), confirmedAt + 90_000)
})

test('online handoff A → B mantém o deadline e ignora toda a suspensão local', () => {
  const online = { gameMode: GAME_MODE.ONLINE, myUid: 'A' }

  for (const [turnPlayerId, turnSeq] of [['A', 0], ['B', 1]]) {
    // Sem confirmação local registrada, o online nunca entra em estado de handoff.
    assert.equal(
      isLocalTurnReady({ ...online, turnPlayerId, turnSeq, acknowledgedTurnKey: null }),
      true,
    )
    assert.equal(
      shouldOpenLocalHandoff({
        ...online,
        gameOver: false,
        turnPlayerId,
        turnSeq,
        localTurnReady: true,
        acknowledgedTurnKey: null,
      }),
      false,
    )
    assert.equal(shouldEnableTurnTimer({ gameMode: GAME_MODE.ONLINE, localTurnReady: false }), true)
    assert.equal(resolveGameplayActorId({ ...online, turnPlayerId, localTurnReady: false }), 'A')
  }

  // O deadline do turno online continua sendo produzido pelo helper compartilhado.
  const now = 1_000_000
  const fresh = sanitizeTurnDeadlineOnHandoff({
    prevTurnPlayerId: 'A',
    nextTurnPlayerId: 'B',
    prevTurnSeq: 0,
    nextTurnSeq: 1,
    currentDeadlineAt: null,
    now,
    turnTimeSec: 90,
  })
  assert.equal(Number.isFinite(fresh), true)
  assert.equal(fresh, computeTurnDeadlineAt(now, 90))
})
