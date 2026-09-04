/**
 * Contratos idênticos aos onResolve/onConfirm dos modais humanos.
 * A política só escolhe; estes builders montam o payload.
 */
import { MIX_PURCHASE_PRICES, MANUAL_CONSTANTS } from '../manualConstants.js'
import { MIX_RULES, VENDOR_RULES, getErpPrice } from '../gameRules.js'
import { getErpLevelView } from '../erpPurchase.js'
import { canTakeLoan, clampLoanAmount, clampFireItems, computeRecoveryFireCredit } from '../loanCycle.js'

export const ACTION_SKIP = Object.freeze({ action: 'SKIP' })

const MIX_META = Object.freeze({
  A: { color: '#1d4ed8', pill: 'NÍVEL A', label: '100 produtos' },
  B: { color: '#16a34a', pill: 'NÍVEL B', label: '50 produtos' },
  C: { color: '#f59e0b', pill: 'NÍVEL C', label: '20 produtos' },
  D: { color: '#6b7280', pill: 'NÍVEL D', label: '5 produtos' },
})

const ERP_META = Object.freeze({
  A: { color: '#1d4ed8', pill: 'NÍVEL A' },
  B: { color: '#16a34a', pill: 'NÍVEL B' },
  C: { color: '#f59e0b', pill: 'NÍVEL C' },
  D: { color: '#6b7280', pill: 'NÍVEL D' },
})

export function buildMixBuyPayload(level) {
  const L = String(level || '').toUpperCase()
  const rule = MIX_RULES[L]
  const meta = MIX_META[L]
  if (!rule || !meta) return { ...ACTION_SKIP }
  return {
    action: 'BUY',
    level: L,
    compra: MIX_PURCHASE_PRICES[L],
    despesa: rule.despPerClient,
    faturamento: rule.fatPerClient,
    color: meta.color,
    pill: meta.pill,
    label: meta.label,
  }
}

export function buildErpBuyPayload(level) {
  const L = String(level || '').toUpperCase()
  const values = getErpLevelView(L)
  const meta = ERP_META[L]
  if (!values || !meta) return { ...ACTION_SKIP }
  return {
    action: 'BUY',
    level: L,
    values: { ...values, color: meta.color, pill: meta.pill },
  }
}

export function buildClientsBuyPayload(qty = 1) {
  const n = Math.max(0, Math.floor(Number(qty) || 0))
  const unitAcquisition = MANUAL_CONSTANTS.clientPrice
  const unitMaintenance = MANUAL_CONSTANTS.clientPortfolioDesp
  const totalCost = n * unitAcquisition
  const maintenanceDelta = n * unitMaintenance
  return {
    action: 'BUY',
    qty: n,
    unitAcquisition,
    totalCost,
    unitMaintenance,
    maintenanceDelta,
    bensDelta: totalCost,
    clientsAdded: n,
    source: { modal: 'BuyClientsModal', file: 'src/modals/BuyClientsModal.jsx' },
  }
}

export function buildCommonSellersBuyPayload(qty = 1) {
  const n = Math.max(0, Math.floor(Number(qty) || 0))
  const unitHire = MANUAL_CONSTANTS.commonHire
  const unitExpense = VENDOR_RULES.comum.baseDesp
  const attendsUpTo = VENDOR_RULES.comum.cap
  const revenuePerSeller = VENDOR_RULES.comum.baseFat
  const totalHire = n * unitHire
  const totalExpense = n * unitExpense
  return {
    action: 'BUY',
    role: 'COMMON',
    qty: n,
    headcount: n,
    unitHire,
    unitExpense,
    totalHire,
    totalExpense,
    total: totalHire,
    cost: totalHire,
    attendsUpTo,
    cashDelta: -totalHire,
    expenseDelta: totalExpense,
    revenueDelta: revenuePerSeller * n,
    revenuePerSeller,
    hudUpdate: { category: 'Vendedores Comuns', addQty: n },
  }
}

export function buildFieldSalesBuyPayload(qty = 1) {
  const n = Math.max(0, Math.floor(Number(qty) || 0))
  const unitHire = VENDOR_RULES.field.hire
  const unitExpense = VENDOR_RULES.field.baseDesp
  const totalHire = n * unitHire
  const totalExpense = n * unitExpense
  const totalRevenue = n * VENDOR_RULES.field.baseFat
  return {
    action: 'BUY',
    qty: n,
    unitHire,
    unitExpense,
    totalHire,
    totalExpense,
    cashDelta: -totalHire,
    expenseDelta: totalExpense,
    revenueDelta: totalRevenue,
    cost: totalHire,
    total: totalHire,
    role: 'FIELD',
  }
}

export function buildInsideSalesBuyPayload(qty = 1) {
  const n = Math.max(0, Math.floor(Number(qty) || 0))
  const unitHire = VENDOR_RULES.inside.hire
  const totalCost = n * unitHire
  return {
    action: 'BUY',
    qty: n,
    headcount: n,
    unitHire,
    total: totalCost,
    cost: totalCost,
    totalCost,
    baseExpense: VENDOR_RULES.inside.baseDesp,
    baseRevenue: VENDOR_RULES.inside.baseFat,
  }
}

export function buildManagerBuyPayload(qty = 1) {
  const n = Math.max(0, Math.floor(Number(qty) || 0))
  const unitHire = MANUAL_CONSTANTS.managerHire
  const unitExpense = VENDOR_RULES.gestor.baseDesp
  const totalHire = n * unitHire
  const totalExpense = n * unitExpense
  return {
    action: 'BUY',
    role: 'MANAGER',
    qty: n,
    headcount: n,
    gestoresDelta: n,
    unitHire,
    unitExpense,
    totalHire,
    totalExpense,
    cost: totalHire,
    total: totalHire,
    cashDelta: -totalHire,
    expenseDelta: totalExpense,
    hudUpdate: { category: 'Gestores Comerciais', addQty: n },
  }
}

export function buildDirectOpenPayload(open) {
  const target = String(open || '').toUpperCase()
  const allowed = ['MIX', 'MANAGER', 'INSIDE', 'FIELD', 'COMMON', 'ERP', 'CLIENTS', 'TRAINING']
  if (!allowed.includes(target)) return { ...ACTION_SKIP }
  return { action: 'OPEN', open: target }
}

export function buildTrainingBuyPayload({ vendorType = 'comum', productId = 'personalizado' } = {}) {
  const price = MANUAL_CONSTANTS.trainingPrice
  const certById = {
    personalizado: 'azul',
    fieldsales: 'amarelo',
    imersaomultiplier: 'roxo',
  }
  const cert = certById[productId]
  if (!cert) return { ...ACTION_SKIP }
  const purchases = [{
    vendorType,
    items: [{ id: productId, cert, price }],
  }]
  const certsCount = { [cert]: 1 }
  const ownedUpdate = { [vendorType]: [productId] }
  return {
    action: 'BUY',
    purchases,
    grandTotal: price,
    bensDelta: price,
    certsCount,
    ownedUpdate,
  }
}

export function buildRevenueConfirmPayload(value = 0) {
  const v = Number(value || 0)
  return {
    action: 'OK',
    value: v,
    source: { modal: 'FaturamentoMesModal', file: 'src/modals/FaturamentoMesModal.jsx' },
  }
}

export function buildExpensesConfirmPayload({ expense = 0, loanCharge = 0 } = {}) {
  const exp = Number(expense || 0)
  const loan = Number(loanCharge || 0)
  return {
    action: 'OK',
    expense: exp,
    loanCharge: loan,
    total: exp + loan,
    source: { modal: 'DespesasOperacionaisModal', file: 'src/modals/DespesasOperacionaisModal.jsx' },
  }
}

export function buildLoanPayload(amount) {
  const val = Math.max(0, Math.floor(Number(amount) || 0))
  return {
    type: 'LOAN',
    amount: val,
    cashDelta: val,
    loan: { amount: val, charged: false },
    source: { modal: 'RecoveryModal', file: 'src/modals/RecoveryModal.jsx' },
  }
}

export function buildFirePayload(player, items) {
  const clamped = clampFireItems(player, items)
  const creditByRole = {}
  const ratio = MANUAL_CONSTANTS.recoveryCreditRatio
  const hire = {
    comum: MANUAL_CONSTANTS.commonHire,
    field: VENDOR_RULES.field.hire,
    inside: VENDOR_RULES.inside.hire,
    gestor: MANUAL_CONSTANTS.managerHire,
  }
  for (const key of Object.keys(clamped)) {
    creditByRole[key] = Math.floor(Number(hire[key] || 0) * ratio) * Number(clamped[key] || 0)
  }
  const totalCredit = computeRecoveryFireCredit(clamped)
  return {
    type: 'FIRE',
    items: clamped,
    creditByRole,
    totalCredit,
    amount: totalCredit,
    note: `Demissões +R$ ${Number(totalCredit || 0).toLocaleString('pt-BR')}`,
    source: { modal: 'RecoveryModal', file: 'src/modals/RecoveryModal.jsx' },
  }
}

export function buildReducePayload(items = []) {
  const list = (Array.isArray(items) ? items : []).map((c) => ({ ...c, selected: true }))
  const total = list.reduce((s, i) => s + Number(i.credit || 0), 0)
  return {
    type: 'REDUCE',
    amount: total,
    items: list,
    note: `Redução múltipla +R$ ${total.toLocaleString()}`,
    source: { modal: 'RecoveryModal', file: 'src/modals/RecoveryModal.jsx' },
  }
}

export function buildTriggerBankruptcyPayload() {
  return {
    type: 'TRIGGER_BANKRUPTCY',
    source: { modal: 'RecoveryModal', file: 'src/modals/RecoveryModal.jsx' },
  }
}

export function buildRecoveryContext(player = {}, { requiredAmount = 0 } = {}) {
  const cash = Number(player.cash || 0)
  const need = Number(requiredAmount || 0)
  const deficit = Math.max(0, need - cash)
  const loanAvailable = clampLoanAmount(
    Number(player.bens || 0) * MANUAL_CONSTANTS.loanMaxBensRatio,
    player.bens,
  )
  const loanOk = canTakeLoan(player) && loanAvailable > 0
  const fireable = {
    comum: Math.max(0, Number(player.vendedoresComuns || 0)),
    field: Math.max(0, Number(player.fieldSales || 0)),
    inside: Math.max(0, Number(player.insideSales || 0)),
    gestor: Math.max(0, Number(player.gestores ?? player.gestoresComerciais ?? player.managers ?? 0)),
  }
  const mixLevel = String(player.mixProdutos || 'D').toUpperCase()
  const erpLevel = String(player.erpLevel || 'D').toUpperCase()
  const reducedMix = Array.isArray(player.reducedLevels?.MIX) ? player.reducedLevels.MIX : []
  const reducedErp = Array.isArray(player.reducedLevels?.ERP) ? player.reducedLevels.ERP : []
  const reducibleMix = ['A', 'B', 'C', 'D'].filter((lv) => mixLevel === lv && !reducedMix.includes(lv) && lv !== 'D')
  const reducibleErp = ['A', 'B', 'C', 'D'].filter((lv) => erpLevel === lv && !reducedErp.includes(lv) && lv !== 'D')
  const fireCreditMax = computeRecoveryFireCredit(fireable)
  const mixCredit = reducibleMix.reduce(
    (s, lv) => s + Math.floor((MIX_PURCHASE_PRICES[lv] || 0) * MANUAL_CONSTANTS.recoveryCreditRatio),
    0,
  )
  const erpCredit = reducibleErp.reduce(
    (s, lv) => s + Math.floor(getErpPrice(lv) * MANUAL_CONSTANTS.recoveryCreditRatio),
    0,
  )
  const canRecover = loanOk || fireCreditMax > 0 || mixCredit > 0 || erpCredit > 0
  return {
    requiredAmount: need,
    currentCash: cash,
    deficit,
    loanAvailable,
    loanOk,
    fireable,
    fireCreditMax,
    reducibleMix,
    reducibleErp,
    mixCredit,
    erpCredit,
    canRecover,
    bankruptcyRequired: !canRecover && deficit > 0,
  }
}

export function chooseRecoveryPayload(player, context = {}) {
  const ctx = { ...buildRecoveryContext(player, context), ...context }
  if (ctx.currentCash >= ctx.requiredAmount && ctx.requiredAmount > 0) {
    return null
  }
  if (ctx.loanOk && ctx.loanAvailable >= ctx.deficit && ctx.deficit > 0) {
    return buildLoanPayload(Math.min(ctx.loanAvailable, Math.max(ctx.deficit, 1)))
  }
  if (ctx.fireCreditMax > 0) {
    const items = {}
    let credit = 0
    for (const key of ['comum', 'field', 'inside', 'gestor']) {
      const owned = Number(ctx.fireable?.[key] || 0)
      if (owned <= 0) continue
      items[key] = 1
      credit = computeRecoveryFireCredit(items)
      if (credit >= ctx.deficit) break
    }
    if (Object.keys(items).length) return buildFirePayload(player, items)
  }
  if (ctx.reducibleMix?.length) {
    const lv = ctx.reducibleMix[0]
    return buildReducePayload([{
      key: `mix-${lv}`,
      group: 'MIX',
      level: lv,
      label: `Nível ${lv}`,
      credit: Math.floor((MIX_PURCHASE_PRICES[lv] || 0) * MANUAL_CONSTANTS.recoveryCreditRatio),
      owned: true,
    }])
  }
  if (ctx.reducibleErp?.length) {
    const lv = ctx.reducibleErp[0]
    return buildReducePayload([{
      key: `erp-${lv}`,
      group: 'ERP',
      level: lv,
      label: `Nível ${lv}`,
      credit: Math.floor(getErpPrice(lv) * MANUAL_CONSTANTS.recoveryCreditRatio),
      owned: true,
    }])
  }
  return buildTriggerBankruptcyPayload()
}

export function chooseInsufficientFundsAction(player, context = {}) {
  const ctx = buildRecoveryContext(player, context)
  if (ctx.currentCash >= ctx.requiredAmount) return { action: 'ACK' }
  if (ctx.canRecover) return { action: 'RECOVERY' }
  return { action: 'BANKRUPT' }
}

export { getErpPrice }
