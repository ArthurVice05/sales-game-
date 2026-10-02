/**
 * Montagem pura de payload → deltas oficiais para as casas de compra.
 * Reutiliza os builders do engine; não calcula regra própria (preços, despesas e
 * faturamento vêm de VENDOR_RULES / MANUAL_CONSTANTS / ERP_RULES / MIX_RULES).
 */
import { VENDOR_RULES, MIX_RULES, getErpPrice } from '../game/gameRules.js'
import { MANUAL_CONSTANTS, MIX_PURCHASE_PRICES } from '../game/manualConstants.js'
import { buildClientsPurchaseDeltas } from '../game/clientsPurchase.js'
import { buildInsideSalesPurchaseDeltas } from '../game/insideSalesPurchase.js'
import { buildFieldSalesPurchaseDeltas } from '../game/fieldSalesPurchase.js'
import { buildCommonSellersPurchaseDeltas } from '../game/commonSellersPurchase.js'
import { buildManagerPurchaseDeltas } from '../game/managersPurchase.js'
import { buildErpPurchaseDeltas } from '../game/erpPurchase.js'
import { buildMixPurchaseDeltas } from '../game/productMixPurchase.js'

export const QTY_PURCHASE_KINDS = ['CLIENTS', 'FIELD', 'INSIDE', 'COMMON', 'MANAGER']
export const LEVEL_PURCHASE_KINDS = ['ERP', 'MIX']

const STAFF = {
  FIELD: { rule: VENDOR_RULES.field, hire: VENDOR_RULES.field.hire, build: buildFieldSalesPurchaseDeltas },
  INSIDE: { rule: VENDOR_RULES.inside, hire: VENDOR_RULES.inside.hire, build: buildInsideSalesPurchaseDeltas },
  COMMON: { rule: VENDOR_RULES.comum, hire: MANUAL_CONSTANTS.commonHire, build: buildCommonSellersPurchaseDeltas },
  MANAGER: { rule: VENDOR_RULES.gestor, hire: MANUAL_CONSTANTS.managerHire, build: buildManagerPurchaseDeltas },
}

/** Payload de contratação de equipe (mesmos campos emitidos pelas modais Buy*). */
export function buildStaffPurchasePayload(kind, qty) {
  const { rule, hire } = STAFF[kind]
  const totalHire = qty * hire
  const totalExpense = qty * rule.baseDesp
  return {
    qty, headcount: qty, totalCost: totalHire, totalHire, total: totalHire,
    totalExpense, expenseDelta: totalExpense, revenueDelta: qty * rule.baseFat,
  }
}

/** Payload de compra de clientes (mesmos campos de BuyClientsModal). */
export function buildClientsPurchasePayload(qty) {
  const totalCost = qty * MANUAL_CONSTANTS.clientPrice
  return { qty, totalCost, maintenanceDelta: qty * MANUAL_CONSTANTS.clientPortfolioDesp, bensDelta: totalCost }
}

/** Payload de compra de Mix (preço e taxas por cliente vindos das regras oficiais). */
export function buildMixPurchasePayload(level) {
  const L = String(level).toUpperCase()
  return { level: L, compra: MIX_PURCHASE_PRICES[L], despesa: MIX_RULES[L].despPerClient, faturamento: MIX_RULES[L].fatPerClient }
}

/**
 * Deltas oficiais para uma compra por quantidade (CLIENTS/FIELD/INSIDE/COMMON/MANAGER)
 * ou por nível (ERP/MIX). Retorna { deltas, cost }; cost = -deltas.cashDelta.
 */
export function buildPurchaseDeltasForKind(kind, { qty = 1, level = '' } = {}) {
  let deltas
  if (kind === 'CLIENTS') deltas = buildClientsPurchaseDeltas(buildClientsPurchasePayload(qty))
  else if (STAFF[kind]) deltas = STAFF[kind].build(buildStaffPurchasePayload(kind, qty))
  else if (kind === 'ERP') deltas = buildErpPurchaseDeltas({ level, values: { compra: getErpPrice(level) } })
  else if (kind === 'MIX') deltas = buildMixPurchaseDeltas(buildMixPurchasePayload(level))
  else throw new Error('Compra indisponível nesta casa.')
  return { deltas, cost: -Number(deltas.cashDelta || 0) }
}
