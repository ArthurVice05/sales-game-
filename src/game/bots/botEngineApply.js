/**
 * Aplica o contrato reconhecido com os mesmos builders do useTurnEngine.
 * Uma vez só — usado por testes integrados e para garantir paridade de efeito.
 */
import { applyDeltas, applyTrainingPurchase } from '../gameMath.js'
import { buildMixPurchaseDeltas } from '../productMixPurchase.js'
import { buildErpPurchaseDeltas } from '../erpPurchase.js'
import { buildClientsPurchaseDeltas } from '../clientsPurchase.js'
import { buildCommonSellersPurchaseDeltas } from '../commonSellersPurchase.js'
import { buildFieldSalesPurchaseDeltas } from '../fieldSalesPurchase.js'
import { buildInsideSalesPurchaseDeltas } from '../insideSalesPurchase.js'
import { buildManagerPurchaseDeltas } from '../managersPurchase.js'
import { applyLoanTake } from '../loanCycle.js'
import { applyBankruptcyState } from '../matchForfeit.js'
import {
  engineAcceptsModalResult,
  isPurchaseAccepted,
  isSkipDecision,
  isDirectOpenDecision,
  isConfirmOkDecision,
  isBankruptcyConfirm,
  interpretInsufficientFundsDecision,
} from './botModalRecognition.js'

export function applyRecognizedEngineEffect(kind, decision, player, extra = {}) {
  if (!engineAcceptsModalResult(kind, decision)) {
    return { applied: false, player, reason: 'not-recognized' }
  }
  if (kind === 'INSUFFICIENT_FUNDS') {
    const read = interpretInsufficientFundsDecision(decision)
    if (read.action === 'ACK') {
      const need = Number(extra.requiredAmount || 0)
      const cash = Number(player.cash || 0)
      if (cash < need) return { applied: false, player, reason: 'ack-without-funds', action: 'ACK' }
      return {
        applied: true,
        player: applyDeltas(player, { cashDelta: -need }),
        action: 'ACK',
      }
    }
    return { applied: false, player, action: read.action, next: read.action }
  }
  if (kind === 'BANKRUPT' && isBankruptcyConfirm(decision)) {
    return { applied: true, player: applyBankruptcyState(player) }
  }
  if (kind === 'RECOVERY') {
    if (decision.type === 'LOAN') {
      const taken = applyLoanTake(player, decision.amount, extra.round || 1)
      return { applied: !!taken.ok, player: taken.player, reason: taken.reason }
    }
    if (decision.type === 'TRIGGER_BANKRUPTCY') {
      return { applied: false, player, next: 'BANKRUPT' }
    }
    return { applied: true, player, type: decision.type }
  }
  if ((kind === 'REVENUE' || kind === 'EXPENSES') && (isConfirmOkDecision(decision) || decision == null)) {
    if (kind === 'REVENUE') {
      const fat = Number(extra.revenue || decision?.value || 0)
      return { applied: true, player: applyDeltas(player, { cashDelta: fat }) }
    }
    const total = Number(extra.totalCharge || decision?.total || 0)
    return { applied: true, player: applyDeltas(player, { cashDelta: -total }) }
  }
  if (kind === 'DIRECT_BUY') {
    if (isSkipDecision(decision)) return { applied: false, player, skipped: true }
    if (isDirectOpenDecision(decision)) return { applied: false, player, open: decision.open }
  }
  if (isSkipDecision(decision)) return { applied: false, player, skipped: true }
  if (!isPurchaseAccepted(decision)) return { applied: false, player, reason: 'not-buy' }

  if (kind === 'MIX') return { applied: true, player: applyDeltas(player, buildMixPurchaseDeltas(decision)) }
  if (kind === 'ERP') return { applied: true, player: applyDeltas(player, buildErpPurchaseDeltas(decision)) }
  if (kind === 'CLIENTS') return { applied: true, player: applyDeltas(player, buildClientsPurchaseDeltas(decision)) }
  if (kind === 'COMMON') return { applied: true, player: applyDeltas(player, buildCommonSellersPurchaseDeltas(decision)) }
  if (kind === 'FIELD') return { applied: true, player: applyDeltas(player, buildFieldSalesPurchaseDeltas(decision)) }
  if (kind === 'INSIDE') return { applied: true, player: applyDeltas(player, buildInsideSalesPurchaseDeltas(decision)) }
  if (kind === 'MANAGERS') return { applied: true, player: applyDeltas(player, buildManagerPurchaseDeltas(decision)) }
  if (kind === 'TRAINING') return { applied: true, player: applyTrainingPurchase(player, decision) }
  return { applied: false, player, reason: 'unhandled-kind' }
}
