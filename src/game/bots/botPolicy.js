import { MIX_PURCHASE_PRICES, MANUAL_CONSTANTS } from '../manualConstants.js'
import { VENDOR_RULES, getErpPrice } from '../gameRules.js'
import { capacityAndAttendance, computeDespesasFor, computeFaturamentoFor } from '../gameMath.js'
import { previewPurchaseImpact } from '../purchasePreview.js'
import { buildMixPurchaseDeltas, calculateMixReturn } from '../productMixPurchase.js'
import { buildErpPurchaseDeltas, calculateErpReturn, countErpCollaborators } from '../erpPurchase.js'
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

export const BOT_PHASE_START = 'INICIO'
export const BOT_PHASE_MID = 'MEIO'
export const BOT_PHASE_END = 'FINAL'

/** Pesos estratégicos apenas. Preços e regras econômicas vêm dos SSOT. */
export const BOT_STRATEGY = Object.freeze({
  minimumCashReserve: 3500,
  skipThreshold: 40,
  clientUnitPrice: MANUAL_CONSTANTS.clientPrice,
  commonHire: MANUAL_CONSTANTS.commonHire,
  managerHire: MANUAL_CONSTANTS.managerHire,
  trainingPrice: MANUAL_CONSTANTS.trainingPrice,
  horizonReturnWeight: 1.0,
  costWeight: 0.15,
  shortHorizonPenalty: 0.55,
  paybackBonus: 40,
  noReturnPenalty: 80,
  capacityWeight: 1.6,
  idleHirePenalty: 28,
  saturatedHireBonus: 56,
  clientFillWeight: 24,
  overflowFillWeight: 18,
  expenseWeight: 0.85,
  cashRiskWeight: 0.035,
  catchUpGap: 0.18,
  catchUpWeight: 22,
  catchUpFinalBonus: 16,
  leadGap: 0.12,
  leadFinalPenalty: 0.45,
  reserveExpenseRatio: 0.35,
  reserveSafetyRatio: 0.2,
  catchUpReserveRelief: 0.45,
  phaseReserve: Object.freeze({
    [BOT_PHASE_START]: 0.8,
    [BOT_PHASE_MID]: 1.0,
    [BOT_PHASE_END]: 1.2,
  }),
  phasePayback: Object.freeze({
    [BOT_PHASE_START]: 0.7,
    [BOT_PHASE_MID]: 1.0,
    [BOT_PHASE_END]: 1.45,
  }),
})

const MIX_ORDER = ['C', 'B', 'A']
const VENDOR_KINDS = new Set(['COMMON', 'FIELD', 'INSIDE'])

export function remainingRounds(round, maxRounds) {
  const r = Math.max(1, Number(round) || 1)
  const m = Math.max(1, Number(maxRounds) || 5)
  return Math.max(0, m - r + 1)
}

export function resolveMatchPhase(round, maxRounds) {
  const r = Math.max(1, Number(round) || 1)
  const m = Math.max(1, Number(maxRounds) || 1)
  if (m <= 1) return BOT_PHASE_END
  const progress = (r - 1) / Math.max(1, m - 1)
  if (progress >= 2 / 3) return BOT_PHASE_END
  if (progress < 1 / 3) return BOT_PHASE_START
  return BOT_PHASE_MID
}

function cashOf(p) {
  return Number(p?.cash) || 0
}

function attendanceOf(player) {
  const { cap, inAtt } = capacityAndAttendance(player)
  const capacity = Number(cap) || 0
  const used = Number(inAtt) || 0
  const clients = Math.max(0, Number(player?.clients) || 0)
  return {
    cap: capacity,
    used,
    spare: Math.max(0, capacity - used),
    overflow: Math.max(0, clients - capacity),
    clients,
  }
}

export function competitiveGap(player, opponents = []) {
  const myPat = computePatrimonio(player)
  const bestOpp = (opponents || []).reduce((m, o) => Math.max(m, computePatrimonio(o)), 0)
  if (bestOpp <= 0 && myPat <= 0) return 0
  return (bestOpp - myPat) / Math.max(1, bestOpp, myPat)
}

export function resolveCashReserve({ player, opponents = [], round, maxRounds } = {}) {
  const phase = resolveMatchPhase(round, maxRounds)
  const expenses = computeDespesasFor(player)
  const phaseMult = BOT_STRATEGY.phaseReserve[phase] ?? 1
  const base = BOT_STRATEGY.minimumCashReserve * phaseMult
  const fromExpenses = expenses * BOT_STRATEGY.reserveExpenseRatio
  let reserve = Math.max(base, fromExpenses)
  const gap = competitiveGap(player, opponents)
  if (phase === BOT_PHASE_END && gap >= BOT_STRATEGY.catchUpGap) {
    reserve *= (1 - BOT_STRATEGY.catchUpReserveRelief)
  }
  const safety = expenses * BOT_STRATEGY.reserveSafetyRatio
  return Math.max(safety, reserve)
}

function canAfford(player, cost, reserve) {
  const c = Number(cost) || 0
  if (c <= 0) return false
  return cashOf(player) - c >= reserve
}

function inferHorizonReturn(impact, horizon) {
  const immediateCost = Number(impact?.immediateCost ?? 0)
  const incrementalNet = Number(impact?.difference?.monthlyNet ?? 0)
  if (immediateCost <= 0) {
    return {
      immediateCost,
      incrementalNet,
      paybackRounds: 0,
      horizonRounds: horizon,
      paysBackWithinHorizon: true,
    }
  }
  if (incrementalNet <= 0) {
    return {
      immediateCost,
      incrementalNet,
      paybackRounds: null,
      horizonRounds: horizon,
      paysBackWithinHorizon: false,
    }
  }
  const paybackRounds = immediateCost / incrementalNet
  return {
    immediateCost,
    incrementalNet,
    paybackRounds,
    horizonRounds: horizon,
    paysBackWithinHorizon: paybackRounds <= horizon,
  }
}

export function enumerateLegalBotActions({
  player,
  opponents = [],
  round = 1,
  maxRounds = 5,
  kind = 'PURCHASE',
} = {}) {
  const actions = []
  const horizon = remainingRounds(round, maxRounds)
  const { cap, used, spare } = attendanceOf(player)
  const expenses = computeDespesasFor(player)
  const revenue = computeFaturamentoFor(player)
  const reserve = resolveCashReserve({ player, opponents, round, maxRounds })

  if (kind === 'SKIP' || kind === 'PURCHASE' || kind === 'DIRECT_BUY') {
    actions.push({ id: 'SKIP', kind: 'SKIP', legal: true, payload: { ...ACTION_SKIP }, scoreHint: 0 })
  }

  if (kind === 'PURCHASE' || kind === 'MIX' || kind === 'DIRECT_BUY') {
    const current = String(player?.mixProdutos || 'D').toUpperCase()
    const mixRank = { D: 0, C: 1, B: 2, A: 3 }
    for (const level of MIX_ORDER) {
      if ((mixRank[level] || 0) <= (mixRank[current] || 0)) continue
      const price = MIX_PURCHASE_PRICES[level]
      if (!canAfford(player, price, reserve)) continue
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
      if (!canAfford(player, price, reserve)) continue
      const payload = buildErpBuyPayload(level)
      const deltas = buildErpPurchaseDeltas(payload)
      const impact = previewPurchaseImpact({ player, deltas, immediateCost: price })
      const ret = calculateErpReturn({
        impact,
        horizonRounds: horizon,
        staffCount: countErpCollaborators(player),
      })
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
    const qty = Math.min(1, spare)
    const cost = qty * BOT_STRATEGY.clientUnitPrice
    if (qty > 0 && canAfford(player, cost, reserve)) {
      const payload = buildClientsBuyPayload(qty)
      const deltas = buildClientsPurchaseDeltas(payload)
      const impact = previewPurchaseImpact({ player, deltas, immediateCost: cost })
      actions.push({
        id: 'CLIENTS:1',
        kind: 'CLIENTS',
        legal: true,
        payload,
        impact,
        ret: inferHorizonReturn(impact, horizon),
      })
    }
  }

  if (kind === 'PURCHASE' || kind === 'COMMON' || kind === 'DIRECT_BUY') {
    const cost = BOT_STRATEGY.commonHire
    if (canAfford(player, cost, reserve)) {
      const payload = buildCommonSellersBuyPayload(1)
      const deltas = buildCommonSellersPurchaseDeltas(payload)
      const impact = previewPurchaseImpact({ player, deltas, immediateCost: cost })
      actions.push({
        id: 'COMMON:1',
        kind: 'COMMON',
        legal: true,
        payload,
        impact,
        ret: inferHorizonReturn(impact, horizon),
      })
    }
  }

  if (kind === 'PURCHASE' || kind === 'FIELD' || kind === 'DIRECT_BUY') {
    const cost = VENDOR_RULES.field.hire
    if (canAfford(player, cost, reserve)) {
      const payload = buildFieldSalesBuyPayload(1)
      const deltas = buildFieldSalesPurchaseDeltas(payload)
      const impact = previewPurchaseImpact({ player, deltas, immediateCost: cost })
      actions.push({
        id: 'FIELD:1',
        kind: 'FIELD',
        legal: true,
        payload,
        impact,
        ret: inferHorizonReturn(impact, horizon),
      })
    }
  }

  if (kind === 'PURCHASE' || kind === 'INSIDE' || kind === 'DIRECT_BUY') {
    const cost = VENDOR_RULES.inside.hire
    if (canAfford(player, cost, reserve)) {
      const payload = buildInsideSalesBuyPayload(1)
      const deltas = buildInsideSalesPurchaseDeltas(payload)
      const impact = previewPurchaseImpact({ player, deltas, immediateCost: cost })
      actions.push({
        id: 'INSIDE:1',
        kind: 'INSIDE',
        legal: true,
        payload,
        impact,
        ret: inferHorizonReturn(impact, horizon),
      })
    }
  }

  if (kind === 'PURCHASE' || kind === 'MANAGERS' || kind === 'DIRECT_BUY') {
    const cost = BOT_STRATEGY.managerHire
    if (canAfford(player, cost, reserve)) {
      const payload = buildManagerBuyPayload(1)
      const deltas = buildManagerPurchaseDeltas(payload)
      const impact = previewPurchaseImpact({ player, deltas, immediateCost: cost })
      actions.push({
        id: 'MANAGERS:1',
        kind: 'MANAGERS',
        legal: true,
        payload,
        impact,
        ret: inferHorizonReturn(impact, horizon),
      })
    }
  }

  if (kind === 'TRAINING' || kind === 'DIRECT_BUY') {
    const cost = BOT_STRATEGY.trainingPrice
    if (canAfford(player, cost, reserve) && Number(player?.vendedoresComuns || 0) > 0) {
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

  return { actions, horizon, expenses, revenue, cap, used, reserve }
}

function isCapacityHire(kind) {
  return VENDOR_KINDS.has(kind)
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
  const phase = resolveMatchPhase(round, maxRounds)
  const { cap, spare, overflow } = attendanceOf(player)
  const expenses = computeDespesasFor(player)
  const reserve = resolveCashReserve({ player, opponents, round, maxRounds })
  const impact = action.impact
  const monthly = Number(impact?.difference?.monthlyNet ?? 0)
  const cost = Number(impact?.immediateCost ?? 0)
  const capAdded = Number(impact?.difference?.capacity ?? 0)
  const cashAfter = cashOf(player) - cost
  const ret = action.ret || inferHorizonReturn(impact, horizon)
  const paysBack = ret?.paysBackWithinHorizon === true
  const paybackMult = BOT_STRATEGY.phasePayback[phase] ?? 1
  const gap = competitiveGap(player, opponents)
  const behind = gap >= BOT_STRATEGY.catchUpGap
  const leading = gap <= -BOT_STRATEGY.leadGap
  const strategicCapacity = isCapacityHire(action.kind) && overflow > 0

  if (action.kind === 'CLIENTS' && spare <= 0) return -Infinity

  let score = monthly * horizon * BOT_STRATEGY.horizonReturnWeight
  score -= cost * BOT_STRATEGY.costWeight

  if (monthly <= 0 && !strategicCapacity) {
    score -= BOT_STRATEGY.noReturnPenalty + cost * BOT_STRATEGY.shortHorizonPenalty
  } else if (ret && paysBack) {
    score += BOT_STRATEGY.paybackBonus
  } else if (ret && ret.paysBackWithinHorizon === false) {
    score -= cost * BOT_STRATEGY.shortHorizonPenalty * paybackMult
  }

  if (action.kind === 'CLIENTS' && spare > 0) {
    score += spare * BOT_STRATEGY.clientFillWeight * BOT_STRATEGY.capacityWeight
  }

  if (isCapacityHire(action.kind)) {
    if (overflow > 0) {
      const filled = Math.min(Math.max(0, capAdded), overflow)
      score += BOT_STRATEGY.saturatedHireBonus
      score += filled * BOT_STRATEGY.overflowFillWeight * BOT_STRATEGY.capacityWeight
    } else if (spare > 0) {
      const idleRatio = cap > 0 ? spare / cap : 1
      score -= BOT_STRATEGY.idleHirePenalty * (1 + idleRatio)
    }
  }

  if (cashAfter < expenses) {
    score -= (expenses - cashAfter) * BOT_STRATEGY.cashRiskWeight * paybackMult
  }
  if (cashAfter < reserve) {
    score -= (reserve - cashAfter) * BOT_STRATEGY.cashRiskWeight
  }

  if (behind && (monthly > 0 || strategicCapacity)) {
    let catchUp = gap * BOT_STRATEGY.catchUpWeight
    if (phase === BOT_PHASE_END) catchUp += BOT_STRATEGY.catchUpFinalBonus
    score += catchUp
  }

  if (leading && phase === BOT_PHASE_END && !paysBack) {
    score -= cost * BOT_STRATEGY.leadFinalPenalty
  }

  score -= (expenses / 1000) * BOT_STRATEGY.expenseWeight
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
