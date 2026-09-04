/**
 * Classificação dos modais humanos para requestTurnDecision.
 * InsufficientFundsModal NÃO pode cair em PURCHASE.
 * Autoridade: igualdade de referência de componente, nunca Function.name/displayName.
 */

export const BOT_KIND_UNKNOWN = 'UNKNOWN'

export const BOT_KIND_BY_MODAL_NAME = Object.freeze({
  InsufficientFundsModal: 'INSUFFICIENT_FUNDS',
  RecoveryModal: 'RECOVERY',
  BankruptcyModal: 'BANKRUPT',
  MixProductsModal: 'MIX',
  ERPSystemsModal: 'ERP',
  BuyClientsModal: 'CLIENTS',
  ClientsModal: 'CLIENTS',
  BuyCommonSellersModal: 'COMMON',
  BuyFieldSalesModal: 'FIELD',
  FieldSalesModal: 'FIELD',
  InsideSalesModal: 'INSIDE',
  BuyManagerModal: 'MANAGERS',
  ManagerModal: 'MANAGERS',
  TrainingModal: 'TRAINING',
  DirectBuyModal: 'DIRECT_BUY',
  FaturamentoMesModal: 'REVENUE',
  FaturamentoDoMesModal: 'REVENUE',
  DespesasOperacionaisModal: 'EXPENSES',
  SorteRevesModal: 'LUCK',
})

export function inferBotDecisionKindByTypeName(name) {
  const key = String(name || '')
  return BOT_KIND_BY_MODAL_NAME[key] || BOT_KIND_UNKNOWN
}

export function buildBotModalTypeIndex(components = {}) {
  const index = new Map()
  for (const [name, kind] of Object.entries(BOT_KIND_BY_MODAL_NAME)) {
    const comp = components[name]
    if (comp) index.set(comp, kind)
  }
  return index
}

export function inferBotDecisionKindFromElement(element, typeIndex) {
  const t = element?.type
  if (t == null) return BOT_KIND_UNKNOWN
  if (typeIndex && typeof typeIndex.has === 'function' && typeIndex.has(t)) {
    return typeIndex.get(t)
  }
  if (typeof t === 'string') return inferBotDecisionKindByTypeName(t)
  return BOT_KIND_UNKNOWN
}

export function resolveBotModalContext(element = {}, extra = {}) {
  const p = element?.props && typeof element.props === 'object' ? element.props : {}
  const requiredAmount = p.requiredAmount != null ? p.requiredAmount : extra.requiredAmount
  const currentCash = p.currentCash != null ? p.currentCash : extra.currentCash
  return {
    rng: extra.rng,
    requiredAmount,
    currentCash,
    canClose: p.canClose,
    expense: p.expense,
    loanCharge: p.loanCharge,
    value: p.value,
    recoveryStep: extra.recoveryStep,
    showRecoveryOptions: p.showRecoveryOptions,
  }
}
