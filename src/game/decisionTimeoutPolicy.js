/**
 * Política de expiração de turno com decisão aberta.
 * Pura: sem React, sem side-effects.
 *
 * Categorias:
 * - optional: compra/contratação — expirar = SKIP (Não comprar)
 * - ack: confirmação informativa pós-cálculo (faturamento/despesas/saldo) — expirar = OK/Entendi
 * - mandatory: sorte/revés, recuperação, falência — sem auto-escolha econômica definida
 * - unknown: não forçar
 */

import { inferBotDecisionKindByTypeName } from './bots/botDecisionKind.js'

export const DECISION_TIMEOUT_CATEGORY = Object.freeze({
  OPTIONAL: 'optional',
  ACK: 'ack',
  MANDATORY: 'mandatory',
  UNKNOWN: 'unknown',
})

const OPTIONAL_KINDS = new Set([
  'CLIENTS',
  'COMMON',
  'FIELD',
  'INSIDE',
  'MANAGERS',
  'MIX',
  'ERP',
  'TRAINING',
  'DIRECT_BUY',
])

const ACK_KINDS = new Set([
  'REVENUE',
  'EXPENSES',
  'INSUFFICIENT_FUNDS',
])

const MANDATORY_KINDS = new Set([
  'LUCK',
  'RECOVERY',
  'BANKRUPT',
])

export function categoryForDecisionKind(kind) {
  const k = String(kind || '')
  if (OPTIONAL_KINDS.has(k)) return DECISION_TIMEOUT_CATEGORY.OPTIONAL
  if (ACK_KINDS.has(k)) return DECISION_TIMEOUT_CATEGORY.ACK
  if (MANDATORY_KINDS.has(k)) return DECISION_TIMEOUT_CATEGORY.MANDATORY
  return DECISION_TIMEOUT_CATEGORY.UNKNOWN
}

export function categoryForModalTypeName(name) {
  return categoryForDecisionKind(inferBotDecisionKindByTypeName(name))
}

/**
 * Payload que fecha a modal sem compra e sem inventar escolha econômica.
 */
export function expirationPayloadForKind(kind, { reason = 'AUTO_PASS_TIMER' } = {}) {
  const k = String(kind || '')
  const category = categoryForDecisionKind(k)
  if (category === DECISION_TIMEOUT_CATEGORY.OPTIONAL) {
    return {
      action: 'SKIP',
      reason,
      source: { via: 'decision-timeout', kind: k },
    }
  }
  if (k === 'INSUFFICIENT_FUNDS') {
    return {
      action: 'CLOSE',
      reason,
      source: { via: 'decision-timeout', kind: k },
    }
  }
  if (k === 'REVENUE') {
    return {
      action: 'OK',
      reason,
      source: { via: 'decision-timeout', kind: k, modal: 'FaturamentoMesModal' },
    }
  }
  if (k === 'EXPENSES') {
    return {
      action: 'OK',
      reason,
      source: { via: 'decision-timeout', kind: k, modal: 'DespesasOperacionaisModal' },
    }
  }
  return null
}

/**
 * Agrega a categoria “mais restritiva” da pilha aberta.
 * mandatory > unknown > ack > optional
 */
export function aggregateDecisionHoldCategory(kinds = []) {
  const cats = (Array.isArray(kinds) ? kinds : []).map(categoryForDecisionKind)
  if (cats.includes(DECISION_TIMEOUT_CATEGORY.MANDATORY)) {
    return DECISION_TIMEOUT_CATEGORY.MANDATORY
  }
  if (cats.includes(DECISION_TIMEOUT_CATEGORY.UNKNOWN)) {
    return DECISION_TIMEOUT_CATEGORY.UNKNOWN
  }
  if (cats.includes(DECISION_TIMEOUT_CATEGORY.ACK)) {
    return DECISION_TIMEOUT_CATEGORY.ACK
  }
  if (cats.includes(DECISION_TIMEOUT_CATEGORY.OPTIONAL)) {
    return DECISION_TIMEOUT_CATEGORY.OPTIONAL
  }
  return DECISION_TIMEOUT_CATEGORY.UNKNOWN
}

/**
 * Deve tentar expirar decisão local em vez de esperar turnLock forever?
 */
export function shouldAttemptLocalDecisionExpire({
  now,
  turnDeadlineAt,
  turnLock,
  gameOver,
  diceBusy = false,
  modalLocks = 0,
  lastRollTurnKey = null,
  turnSeq = 0,
  hasOpenModals = false,
} = {}) {
  if (gameOver) return { ok: false, reason: 'game-over' }
  if (diceBusy) return { ok: false, reason: 'dice-busy' }
  if (!turnLock) return { ok: false, reason: 'not-locked' }
  const locks = Math.max(0, Number(modalLocks) || 0)
  if (locks <= 0 && !hasOpenModals) return { ok: false, reason: 'no-open-decision' }
  const lrk = lastRollTurnKey != null ? String(lastRollTurnKey) : ''
  const seq = String(Number(turnSeq) || 0)
  if (!lrk || lrk !== seq) return { ok: false, reason: 'not-post-roll' }
  const deadline = Number(turnDeadlineAt)
  if (!Number.isFinite(deadline)) return { ok: false, reason: 'no-deadline' }
  const t = Number.isFinite(Number(now)) ? Number(now) : Date.now()
  if (t < deadline) return { ok: false, reason: 'not-expired' }
  return { ok: true, reason: 'expire-open-decision' }
}

/**
 * Coordenador remoto pode forçar AUTO_PASS atravessando turnLock?
 * Só compras opcionais — ack/mandatory ficam documentados como lacuna offline.
 */
export function shouldAllowRemoteAutoPassThroughLock({
  turnLock,
  decisionHold = null,
  expectedTurnSeq,
  expectedTurnPlayerId,
} = {}) {
  if (!turnLock) return { ok: true, reason: 'unlocked' }
  const hold = decisionHold && typeof decisionHold === 'object' ? decisionHold : null
  if (!hold) return { ok: false, reason: 'turn-locked-no-hold' }
  if (String(hold.turnPlayerId || '') !== String(expectedTurnPlayerId || '')) {
    return { ok: false, reason: 'hold-player-mismatch' }
  }
  if (String(hold.turnSeq ?? '') !== String(expectedTurnSeq ?? '')) {
    return { ok: false, reason: 'hold-seq-mismatch' }
  }
  if (hold.category === DECISION_TIMEOUT_CATEGORY.OPTIONAL) {
    return { ok: true, reason: 'optional-hold-expired' }
  }
  if (hold.category === DECISION_TIMEOUT_CATEGORY.ACK) {
    return { ok: false, reason: 'ack-requires-local-apply' }
  }
  if (hold.category === DECISION_TIMEOUT_CATEGORY.MANDATORY) {
    return { ok: false, reason: 'mandatory-no-policy' }
  }
  return { ok: false, reason: 'turn-locked' }
}

export function buildDecisionHold({
  kinds = [],
  turnPlayerId,
  turnSeq,
  matchId = null,
} = {}) {
  const list = Array.isArray(kinds) ? kinds.filter(Boolean).map(String) : []
  if (!list.length) return null
  return {
    category: aggregateDecisionHoldCategory(list),
    kinds: list,
    turnPlayerId: turnPlayerId != null ? String(turnPlayerId) : '',
    turnSeq: Number(turnSeq) || 0,
    matchId: matchId != null ? String(matchId) : null,
  }
}
