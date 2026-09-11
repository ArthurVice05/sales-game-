import test from 'node:test'
import assert from 'node:assert/strict'
import { validateTurnCommit, shouldProceedTimerAutoPassAfterAwait } from '../turnCommitValidation.js'
import { shouldAttemptTimerAutoPass } from '../turnTimerLogic.js'
import { shouldRejectAbsentTurnSkip } from '../presenceSkipLogic.js'
import {
  buildDecisionHold,
  shouldAttemptLocalDecisionExpire,
} from '../decisionTimeoutPolicy.js'

const optionalHold = buildDecisionHold({
  kinds: ['CLIENTS'],
  turnPlayerId: 'p1',
  turnSeq: 5,
  matchId: 'm1',
})

function basePrev(extra = {}) {
  return {
    turnPlayerId: 'p1',
    turnSeq: 5,
    turnLock: true,
    lockOwner: 'p1',
    lastRollTurnKey: '5',
    turnDeadlineAt: 1_000,
    gameOver: false,
    decisionHold: optionalHold,
    players: [
      { id: 'p1', name: 'A', cash: 100, bankrupt: false },
      { id: 'p2', name: 'B', cash: 100, bankrupt: false },
    ],
    ...extra,
  }
}

function autoPassPatch() {
  return {
    kind: 'TURN',
    turnPlayerId: 'p2',
    turnSeq: 6,
    turnLock: false,
    lockOwner: null,
    lastRollTurnKey: null,
    decisionHold: null,
    lastAction: 'AUTO_PASS_TIMER',
    _expectTurnPlayerId: 'p1',
    _expectTurnSeq: 5,
    _commitKind: 'AUTO_PASS',
  }
}

test('AUTO_PASS com decisionHold optional + já rolou atravessa turnLock', () => {
  const v = validateTurnCommit(basePrev(), autoPassPatch(), { now: 5_000 })
  assert.equal(v.ok, true)
  assert.equal(v.reason, 'auto-pass-optional-expire')
})

test('AUTO_PASS com lock e sem hold continua bloqueado', () => {
  const v = validateTurnCommit(basePrev({ decisionHold: null }), autoPassPatch(), { now: 5_000 })
  assert.equal(v.ok, false)
  assert.match(String(v.reason), /turn-locked|hold/)
})

test('AUTO_PASS pós-roll sem lock continua rejeitado (tick é o caminho)', () => {
  const v = validateTurnCommit(
    basePrev({ turnLock: false, decisionHold: null }),
    autoPassPatch(),
    { now: 5_000 },
  )
  assert.equal(v.ok, false)
  assert.equal(v.reason, 'already-rolled')
})

test('AUTO_PASS pré-roll sem modal preserva caminho sem lock', () => {
  const v = validateTurnCommit(
    basePrev({
      turnLock: false,
      lastRollTurnKey: null,
      decisionHold: null,
    }),
    autoPassPatch(),
    { now: 5_000 },
  )
  assert.equal(v.ok, true)
  assert.equal(v.reason, 'auto-pass-ok')
})

test('shouldAttemptTimerAutoPass: optional hold libera lock; sem hold bloqueia', () => {
  const blocked = shouldAttemptTimerAutoPass({
    now: 9_000,
    turnDeadlineAt: 1,
    turnLock: true,
    gameOver: false,
    amCoordinator: true,
    turnPlayerId: 'p1',
    turnSeq: 5,
    lastAttemptKey: null,
    inFlight: false,
    decisionHold: null,
  })
  assert.equal(blocked.ok, false)

  const allowed = shouldAttemptTimerAutoPass({
    now: 9_000,
    turnDeadlineAt: 1,
    turnLock: true,
    gameOver: false,
    amCoordinator: true,
    turnPlayerId: 'p1',
    turnSeq: 5,
    lastAttemptKey: null,
    inFlight: false,
    decisionHold: optionalHold,
  })
  assert.equal(allowed.ok, true)
  assert.equal(allowed.reason, 'expired-optional-hold')
})

test('shouldProceedTimerAutoPassAfterAwait respeita decisionHold', () => {
  const blocked = shouldProceedTimerAutoPassAfterAwait({
    now: 9_000,
    turnDeadlineAt: 1,
    turnLock: true,
    gameOver: false,
    capturedTurnPlayerId: 'p1',
    capturedTurnSeq: 5,
    currentTurnPlayerId: 'p1',
    currentTurnSeq: 5,
    lastAttemptKey: null,
    inFlight: false,
    amCoordinator: true,
    decisionHold: null,
  })
  assert.equal(blocked.ok, false)

  const ok = shouldProceedTimerAutoPassAfterAwait({
    now: 9_000,
    turnDeadlineAt: 1,
    turnLock: true,
    gameOver: false,
    capturedTurnPlayerId: 'p1',
    capturedTurnSeq: 5,
    currentTurnPlayerId: 'p1',
    currentTurnSeq: 5,
    lastAttemptKey: null,
    inFlight: false,
    amCoordinator: true,
    decisionHold: optionalHold,
  })
  assert.equal(ok.ok, true)
})

test('shouldRejectAbsentTurnSkip: optional hold não rejeita; mandatory rejeita', () => {
  assert.equal(
    shouldRejectAbsentTurnSkip({
      turnLock: true,
      expectedTurnSeq: 5,
      expectedTurnPlayerId: 'p1',
      decisionHold: optionalHold,
    }).reject,
    false,
  )
  assert.equal(
    shouldRejectAbsentTurnSkip({
      turnLock: true,
      expectedTurnSeq: 5,
      expectedTurnPlayerId: 'p1',
      decisionHold: buildDecisionHold({ kinds: ['LUCK'], turnPlayerId: 'p1', turnSeq: 5 }),
    }).reject,
    true,
  )
})

test('local expire gate: identidade pós-roll; sem segundo avanço implícito', () => {
  const gate = shouldAttemptLocalDecisionExpire({
    now: 10_000,
    turnDeadlineAt: 1,
    turnLock: true,
    gameOver: false,
    diceBusy: false,
    modalLocks: 1,
    lastRollTurnKey: '5',
    turnSeq: 5,
    hasOpenModals: true,
  })
  assert.equal(gate.ok, true)
  // Sem modal: não tenta expire local — caminho AUTO_PASS clássico.
  assert.equal(
    shouldAttemptLocalDecisionExpire({
      now: 10_000,
      turnDeadlineAt: 1,
      turnLock: false,
      gameOver: false,
      modalLocks: 0,
      lastRollTurnKey: null,
      turnSeq: 5,
    }).ok,
    false,
  )
})
