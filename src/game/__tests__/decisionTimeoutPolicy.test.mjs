import test from 'node:test'
import assert from 'node:assert/strict'
import {
  DECISION_TIMEOUT_CATEGORY,
  categoryForDecisionKind,
  categoryForModalTypeName,
  expirationPayloadForKind,
  aggregateDecisionHoldCategory,
  shouldAttemptLocalDecisionExpire,
  shouldAllowRemoteAutoPassThroughLock,
  buildDecisionHold,
} from '../decisionTimeoutPolicy.js'

test('compras opcionais classificam como optional e expiram em SKIP', () => {
  for (const kind of ['CLIENTS', 'ERP', 'TRAINING', 'DIRECT_BUY', 'COMMON', 'MIX']) {
    assert.equal(categoryForDecisionKind(kind), DECISION_TIMEOUT_CATEGORY.OPTIONAL)
    const payload = expirationPayloadForKind(kind)
    assert.equal(payload.action, 'SKIP')
    assert.equal(payload.reason, 'AUTO_PASS_TIMER')
  }
  assert.equal(categoryForModalTypeName('BuyClientsModal'), DECISION_TIMEOUT_CATEGORY.OPTIONAL)
})

test('faturamento/despesas/saldo insuficiente são ack (fecham sem inventar economia)', () => {
  assert.equal(categoryForDecisionKind('REVENUE'), DECISION_TIMEOUT_CATEGORY.ACK)
  assert.equal(categoryForDecisionKind('EXPENSES'), DECISION_TIMEOUT_CATEGORY.ACK)
  assert.equal(categoryForDecisionKind('INSUFFICIENT_FUNDS'), DECISION_TIMEOUT_CATEGORY.ACK)
  assert.equal(expirationPayloadForKind('REVENUE').action, 'OK')
  assert.equal(expirationPayloadForKind('EXPENSES').action, 'OK')
  assert.equal(expirationPayloadForKind('INSUFFICIENT_FUNDS').action, 'CLOSE')
})

test('sorte/recuperação/falência são mandatory sem payload automático', () => {
  for (const kind of ['LUCK', 'RECOVERY', 'BANKRUPT']) {
    assert.equal(categoryForDecisionKind(kind), DECISION_TIMEOUT_CATEGORY.MANDATORY)
    assert.equal(expirationPayloadForKind(kind), null)
  }
})

test('agrega pilha: mandatory vence optional', () => {
  assert.equal(
    aggregateDecisionHoldCategory(['CLIENTS', 'INSUFFICIENT_FUNDS']),
    DECISION_TIMEOUT_CATEGORY.ACK,
  )
  assert.equal(
    aggregateDecisionHoldCategory(['CLIENTS', 'LUCK']),
    DECISION_TIMEOUT_CATEGORY.MANDATORY,
  )
})

test('expire local só pós-roll com deadline vencido e modal aberta', () => {
  const base = {
    now: 10_000,
    turnDeadlineAt: 5_000,
    turnLock: true,
    gameOver: false,
    diceBusy: false,
    modalLocks: 1,
    lastRollTurnKey: '3',
    turnSeq: 3,
    hasOpenModals: true,
  }
  assert.equal(shouldAttemptLocalDecisionExpire(base).ok, true)
  assert.equal(shouldAttemptLocalDecisionExpire({ ...base, diceBusy: true }).reason, 'dice-busy')
  assert.equal(shouldAttemptLocalDecisionExpire({ ...base, lastRollTurnKey: null }).reason, 'not-post-roll')
  assert.equal(shouldAttemptLocalDecisionExpire({ ...base, now: 1_000 }).reason, 'not-expired')
  assert.equal(shouldAttemptLocalDecisionExpire({ ...base, turnLock: false }).reason, 'not-locked')
})

test('remoto atravessa lock só com decisionHold optional alinhado ao turno', () => {
  const hold = buildDecisionHold({
    kinds: ['CLIENTS'],
    turnPlayerId: 'p1',
    turnSeq: 4,
    matchId: 'm1',
  })
  assert.equal(hold.category, DECISION_TIMEOUT_CATEGORY.OPTIONAL)
  assert.equal(
    shouldAllowRemoteAutoPassThroughLock({
      turnLock: true,
      decisionHold: hold,
      expectedTurnPlayerId: 'p1',
      expectedTurnSeq: 4,
    }).ok,
    true,
  )
  assert.equal(
    shouldAllowRemoteAutoPassThroughLock({
      turnLock: true,
      decisionHold: buildDecisionHold({ kinds: ['REVENUE'], turnPlayerId: 'p1', turnSeq: 4 }),
      expectedTurnPlayerId: 'p1',
      expectedTurnSeq: 4,
    }).reason,
    'ack-requires-local-apply',
  )
  assert.equal(
    shouldAllowRemoteAutoPassThroughLock({
      turnLock: true,
      decisionHold: buildDecisionHold({ kinds: ['LUCK'], turnPlayerId: 'p1', turnSeq: 4 }),
      expectedTurnPlayerId: 'p1',
      expectedTurnSeq: 4,
    }).reason,
    'mandatory-no-policy',
  )
  assert.equal(
    shouldAllowRemoteAutoPassThroughLock({
      turnLock: true,
      decisionHold: null,
      expectedTurnPlayerId: 'p1',
      expectedTurnSeq: 4,
    }).ok,
    false,
  )
})
