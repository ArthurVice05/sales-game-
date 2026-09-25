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
import { SORTE_REVES_CARDS, resolveCardEffect } from '../modals/sorteRevesDeck.js'

export const DECISION_TIMEOUT_CATEGORY = Object.freeze({
  OPTIONAL: 'optional',
  ACK: 'ack',
  MANDATORY: 'mandatory',
  UNKNOWN: 'unknown',
})

export const ORPHANED_POST_ROLL_GRACE_MS = 15_000

export function isOrphanedPostRollLock({
  now = Date.now(),
  turnDeadlineAt = null,
  lockTs = null,
  lastRollTurnKey = null,
  expectedTurnSeq = 0,
  graceMs = ORPHANED_POST_ROLL_GRACE_MS,
} = {}) {
  const current = Number(now)
  const deadline = Number(turnDeadlineAt)
  if (turnDeadlineAt == null || !Number.isFinite(current) || !Number.isFinite(deadline)) return false
  if (lastRollTurnKey == null || String(lastRollTurnKey) !== String(expectedTurnSeq ?? '')) return false
  // lockTs legado usava o relogio local do dispositivo e pode estar adiantado.
  // O deadline autoritativo e a margem adicional bastam para proteger a animacao.
  void lockTs
  const staleAfter = deadline + Math.max(0, Number(graceMs) || 0)
  return current >= staleAfter
}

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
export function expirationPayloadForKind(kind, { reason = 'AUTO_PASS_TIMER', element = null } = {}) {
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
    if (element?.props?.showRecoveryOptions || element?.props?.canClose === false) return null
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
  if (k === 'LUCK') {
    const cardId = element?.props?.cardId
    if (cardId == null) return null // nunca sorteia uma segunda carta no timeout
    const card = SORTE_REVES_CARDS.find((item) => String(item.id) === String(cardId))
    if (!card) return null
    return resolveCardEffect(card, element?.props?.player || {}).payload
  }
  // Ações abertas voluntariamente podem ser canceladas sem alterar patrimônio.
  if (k === 'RECOVERY' && element?.props?.canClose !== false) return false
  if (k === 'BANKRUPT') return false
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
  const locks = Math.max(0, Number(modalLocks) || 0)
  if (locks <= 0 && !hasOpenModals) return { ok: false, reason: 'no-open-decision' }
  const lrk = lastRollTurnKey != null ? String(lastRollTurnKey) : ''
  const seq = String(Number(turnSeq) || 0)
  const postRoll = !!lrk && lrk === seq
  if (turnLock && !postRoll) return { ok: false, reason: 'not-post-roll' }
  const deadline = Number(turnDeadlineAt)
  if (!Number.isFinite(deadline)) return { ok: false, reason: 'no-deadline' }
  const t = Number.isFinite(Number(now)) ? Number(now) : Date.now()
  if (t < deadline) return { ok: false, reason: 'not-expired' }
  return { ok: true, reason: 'expire-open-decision', phase: postRoll ? 'post-roll' : 'pre-roll' }
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
  lastRollTurnKey = null,
  allowOrphanedPostRoll = false,
} = {}) {
  if (!turnLock) return { ok: true, reason: 'unlocked' }
  const hold = decisionHold && typeof decisionHold === 'object' ? decisionHold : null
  if (!hold) {
    if (
      allowOrphanedPostRoll === true &&
      lastRollTurnKey != null &&
      String(lastRollTurnKey) === String(expectedTurnSeq ?? '')
    ) {
      return { ok: true, reason: 'orphaned-post-roll-lock' }
    }
    return { ok: false, reason: 'turn-locked-no-hold' }
  }
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
