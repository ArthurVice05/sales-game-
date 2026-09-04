import { MIX_PURCHASE_PRICES, MANUAL_CONSTANTS } from '../manualConstants.js'
import { VENDOR_RULES, getErpPrice } from '../gameRules.js'
import { capacityAndAttendance, computeDespesasFor, computeFaturamentoFor } from '../gameMath.js'
import { previewPurchaseImpact } from '../purchasePreview.js'
import { buildMixPurchaseDeltas, calculateMixReturn } from '../productMixPurchase.js'
import { buildErpPurchaseDeltas, calculateErpReturn } from '../erpPurchase.js'
import { buildClientsPurchaseDeltas } from '../clientsPurchase.js'
import { buildCommonSellersPurchaseDeltas } from '../commonSellersPurchase.js'
import { buildFieldSalesPurchaseDeltas } from '../fieldSalesPurchase.js'
import { buildInsideSalesPurchaseDeltas } from '../insideSalesPurchase.js'
import { buildManagerPurchaseDeltas } from '../managersPurchase.js'
import { canTakeLoan, clampLoanAmount } from '../loanCycle.js'
import { computePatrimonio } from '../patrimonio.js'
import { BOT_POLICY_VERSION } from './botTypes.js'
import {
  ACTION_SKIP,
  buildClientsBuyPayload,
  buildCommonSellersBuyPayload,
  buildDirectOpenPayload,
  buildErpBuyPayload,
  buildFieldSalesBuyPayload,
  buildFirePayload,
  buildInsideSalesBuyPayload,
  buildLoanPayload,
  buildManagerBuyPayload,
  buildMixBuyPayload,
  buildTrainingBuyPayload,
  buildTriggerBankruptcyPayload,
  chooseRecoveryPayload,
} from './botModalContracts.js'

export const BOT_STRATEGY = Object.freeze({
  minimumCashReserve: 3500,
  riskWeight: 1.25,
  shortHorizonPenalty: 0.55,
  capacityWeight: 1.6,
  patrimonioWeight: 1.0,
  expenseWeight: 0.85,
  skipThreshold: 40,
  clientUnitPrice: MANUAL_CONSTANTS.clientPrice,
  commonHire: MANUAL_CONSTANTS.commonHire,
  managerHire: MANUAL_CONSTANTS.managerHire,
  trainingPrice: MANUAL_CONSTANTS.trainingPrice,
})

const MIX_ORDER = ['C', 'B', 'A']

function remainingRounds(round, maxRounds) {
  const r = Math.max(1, Number(round) || 1)
  const m = Math.max(1, Number(maxRounds) || 5)
  return Math.max(0, m - r + 1)
}

function cashOf(p) {
  return Number(p?.cash) || 0
}

function canAfford(player, cost, reserve = BOT_STRATEGY.minimumCashReserve) {
  const c = Number(cost) || 0
  if (c <= 0) return false
  return cashOf(player) - c >= reserve
}

export function enumerateLegalBotActions({ player, round = 1, maxRounds = 5, kind = 'PURCHASE' } = {}) {
  const actions = []
  const horizon = remainingRounds(round, maxRounds)
  const { cap, used } = capacityAndAttendance(player)
  const expenses = computeDespesasFor(player)
  const revenue = computeFaturamentoFor(player)

  if (kind === 'SKIP' || kind === 'PURCHASE' || kind === 'DIRECT_BUY') {
    actions.push({ id: 'SKIP', kind: 'SKIP', legal: true, payload: { ...ACTION_SKIP }, scoreHint: 0 })
  }

  if (kind === 'PURCHASE' || kind === 'MIX' || kind === 'DIRECT_BUY') {
    const current = String(player?.mixProdutos || 'D').toUpperCase()
    const mixRank = { D: 0, C: 1, B: 2, A: 3 }
    for (const level of MIX_ORDER) {
      if ((mixRank[level] || 0) <= (mixRank[current] || 0)) continue
      const price = MIX_PURCHASE_PRICES[level]
      if (!canAfford(player, price)) continue
      const payload = buildMixBuyPayload(level)
      const deltas = buildMixPurchaseDeltas(payload)
      const impact = previewPurchaseImpact({ player, deltas, immediateCost: price })
      const ret = calculateMixReturn({ impact, horizonRounds: horizon })
      actions.push({
        id: `MIX:${level}`,
        kind: 'MIX',
        legal: true,
        payload,
        impact,
        ret,
      })
    }
  }

  if (kind === 'PURCHASE' || kind === 'ERP' || kind === 'DIRECT_BUY') {
    const current = String(player?.erpLevel || 'D').toUpperCase()
    for (const level of MIX_ORDER) {
      const better = 'DCBA'.indexOf(current) < 'DCBA'.indexOf(level)
      if (!better) continue
      const price = getErpPrice(level)
      if (!canAfford(player, price)) continue
      const payload = buildErpBuyPayload(level)
      const deltas = buildErpPurchaseDeltas(payload)
      const impact = previewPurchaseImpact({ player, deltas, immediateCost: price })
      const ret = calculateErpReturn({ impact, horizonRounds: horizon })
      actions.push({
        id: `ERP:${level}`,
        kind: 'ERP',
        legal: true,
        payload,
        impact,
        ret,
      })
    }
  }

  if (kind === 'PURCHASE' || kind === 'CLIENTS' || kind === 'DIRECT_BUY') {
    const spare = Math.max(0, Number(cap) - Number(used))
    const qty = Math.min(1, spare)
    const cost = qty * BOT_STRATEGY.clientUnitPrice
    if (qty > 0 && canAfford(player, cost)) {
      const payload = buildClientsBuyPayload(qty)
      const deltas = buildClientsPurchaseDeltas(payload)
      const impact = previewPurchaseImpact({ player, deltas, immediateCost: cost })
      actions.push({
        id: 'CLIENTS:1',
        kind: 'CLIENTS',
        legal: true,
        payload,
        impact,
      })
    }
  }

  if (kind === 'PURCHASE' || kind === 'COMMON' || kind === 'DIRECT_BUY') {
    const cost = BOT_STRATEGY.commonHire
    if (canAfford(player, cost)) {
      const payload = buildCommonSellersBuyPayload(1)
      const deltas = buildCommonSellersPurchaseDeltas(payload)
      const impact = previewPurchaseImpact({ player, deltas, immediateCost: cost })
      actions.push({
        id: 'COMMON:1',
        kind: 'COMMON',
        legal: true,
        payload,
        impact,
      })
    }
  }

  if (kind === 'PURCHASE' || kind === 'FIELD' || kind === 'DIRECT_BUY') {
    const cost = VENDOR_RULES.field.hire
    if (canAfford(player, cost)) {
      const payload = buildFieldSalesBuyPayload(1)
      const deltas = buildFieldSalesPurchaseDeltas(payload)
      const impact = previewPurchaseImpact({ player, deltas, immediateCost: cost })
      actions.push({
        id: 'FIELD:1',
        kind: 'FIELD',
        legal: true,
        payload,
        impact,
      })
    }
  }

  if (kind === 'PURCHASE' || kind === 'INSIDE' || kind === 'DIRECT_BUY') {
    const cost = VENDOR_RULES.inside.hire
    if (canAfford(player, cost)) {
      const payload = buildInsideSalesBuyPayload(1)
      const deltas = buildInsideSalesPurchaseDeltas(payload)
      const impact = previewPurchaseImpact({ player, deltas, immediateCost: cost })
      actions.push({
        id: 'INSIDE:1',
        kind: 'INSIDE',
        legal: true,
        payload,
        impact,
      })
    }
  }

  if (kind === 'PURCHASE' || kind === 'MANAGERS' || kind === 'DIRECT_BUY') {
    const cost = BOT_STRATEGY.managerHire
    if (canAfford(player, cost)) {
      const payload = buildManagerBuyPayload(1)
      const deltas = buildManagerPurchaseDeltas(payload)
      const impact = previewPurchaseImpact({ player, deltas, immediateCost: cost })
      actions.push({
        id: 'MANAGERS:1',
        kind: 'MANAGERS',
        legal: true,
        payload,
        impact,
      })
    }
  }

  if (kind === 'TRAINING' || kind === 'DIRECT_BUY') {
    const cost = BOT_STRATEGY.trainingPrice
    if (canAfford(player, cost) && Number(player?.vendedoresComuns || 0) > 0) {
      const payload = buildTrainingBuyPayload({ vendorType: 'comum', productId: 'personalizado' })
      actions.push({
        id: 'TRAINING:comum:personalizado',
        kind: 'TRAINING',
        legal: true,
        payload,
        impact: { immediateCost: cost, difference: { monthlyNet: 0 } },
      })
    }
  }

  if (kind === 'RECOVERY' || kind === 'LOAN') {
    if (canTakeLoan(player)) {
      const amount = clampLoanAmount(player.bens * MANUAL_CONSTANTS.loanMaxBensRatio, player.bens)
      if (amount > 0) {
        actions.push({
          id: 'LOAN',
          kind: 'LOAN',
          legal: true,
          payload: buildLoanPayload(amount),
        })
      }
    }
    const fire = buildFirePayload(player, { comum: 1 })
    if (fire.totalCredit > 0) {
      actions.push({ id: 'FIRE', kind: 'FIRE', legal: true, payload: fire })
    }
    actions.push({
      id: 'BANKRUPT',
      kind: 'BANKRUPT',
      legal: true,
      payload: buildTriggerBankruptcyPayload(),
    })
  }

  return { actions, horizon, expenses, revenue, cap, used }
}

export function scoreBotAction(action, { player, opponents = [], round, maxRounds } = {}) {
  if (!action?.legal) return -Infinity
  if (action.kind === 'SKIP' || action.payload?.action === 'SKIP') return BOT_STRATEGY.skipThreshold - 1
  if (action.kind === 'BANKRUPT' || action.payload?.type === 'TRIGGER_BANKRUPTCY') return -1000
  if (action.kind === 'LOAN') {
    const exp = computeDespesasFor(player)
    return cashOf(player) < exp ? 80 : 10
  }
  const horizon = remainingRounds(round, maxRounds)
  const impact = action.impact
  const monthly = Number(impact?.difference?.monthlyNet ?? 0)
  const cost = Number(impact?.immediateCost ?? 0)
  const ret = action.ret
  let score = monthly * horizon * BOT_STRATEGY.patrimonioWeight - cost * 0.15
  if (ret && ret.paysBackWithinHorizon === false) {
    score -= cost * BOT_STRATEGY.shortHorizonPenalty
  }
  if (ret && ret.paysBackWithinHorizon === true) {
    score += 40
  }
  const { cap, used } = capacityAndAttendance(player)
  if (action.kind === 'CLIENTS' && used >= cap) score = -Infinity
  if (action.kind === 'COMMON' || action.kind === 'FIELD' || action.kind === 'INSIDE') {
    if (used < cap) score -= 20
    else score += 35 * BOT_STRATEGY.capacityWeight
  }
  const myPat = computePatrimonio(player)
  const bestOpp = opponents.reduce((m, o) => Math.max(m, computePatrimonio(o)), 0)
  if (bestOpp > myPat) score += 8
  score -= (computeDespesasFor(player) / 1000) * BOT_STRATEGY.expenseWeight
  return score
}

export function chooseBotAction(ctx) {
  const { actions } = enumerateLegalBotActions(ctx)
  let best = null
  let bestScore = -Infinity
  for (const action of actions) {
    const s = scoreBotAction(action, ctx)
    action.score = s
    if (s > bestScore || (s === bestScore && best && action.id < best.id)) {
      best = action
      bestScore = s
    }
  }
  if (!best || bestScore < BOT_STRATEGY.skipThreshold) {
    return { id: 'SKIP', kind: 'SKIP', payload: { ...ACTION_SKIP }, score: bestScore }
  }
  if (ctx.kind === 'DIRECT_BUY' && best.kind !== 'SKIP') {
    const openMap = {
      MIX: 'MIX',
      ERP: 'ERP',
      CLIENTS: 'CLIENTS',
      COMMON: 'COMMON',
      FIELD: 'FIELD',
      INSIDE: 'INSIDE',
      MANAGERS: 'MANAGER',
      TRAINING: 'TRAINING',
    }
    const open = openMap[best.kind]
    if (open) {
      return { ...best, payload: buildDirectOpenPayload(open) }
    }
  }
  if (ctx.kind === 'RECOVERY' && !best.payload?.type) {
    return { ...best, payload: chooseRecoveryPayload(ctx.player, ctx) }
  }
  return best
}

export { BOT_POLICY_VERSION }
