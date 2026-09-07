/**
 * Reconhecimento dos contratos dos modais — o mesmo critério do useTurnEngine.
 * Não altera regras financeiras; só classifica o payload já produzido.
 */

export function isPurchaseAccepted(res) {
  return !!(res && (res.action === 'BUY' || res.action === 'HIRE'))
}

export function isDirectOpenDecision(res) {
  return !!(res && res.action === 'OPEN' && res.open)
}

export function isSkipDecision(res) {
  return !res || res.action === 'SKIP'
}

export function isConfirmOkDecision(res) {
  return !!(res && res.action === 'OK')
}

export function isBankruptcyConfirm(res) {
  return res === true
}

export function interpretInsufficientFundsDecision(res) {
  if (!res || res.action === 'SKIP') {
    return { ok: false, reason: 'skip-not-allowed', action: res?.action ?? null }
  }
  if (res.action === 'ACK' || res.action === 'RECOVERY' || res.action === 'BANKRUPT') {
    return { ok: true, action: res.action }
  }
  return { ok: false, reason: 'unknown-action', action: res?.action ?? null }
}

export function engineAcceptsModalResult(kind, res) {
  const k = String(kind || '')
  if (k === 'INSUFFICIENT_FUNDS') return interpretInsufficientFundsDecision(res).ok
  if (k === 'BANKRUPT') return isBankruptcyConfirm(res)
  if (k === 'REVENUE' || k === 'EXPENSES') return isConfirmOkDecision(res) || res == null
  if (k === 'RECOVERY') {
    return !!(res && ['LOAN', 'FIRE', 'REDUCE', 'TRIGGER_BANKRUPTCY'].includes(res.type))
  }
  if (k === 'DIRECT_BUY') return isDirectOpenDecision(res) || isSkipDecision(res)
  if (k === 'LUCK' || k === 'SORTE_REVES') return !!(res && res.action === 'APPLY_CARD')
  return isPurchaseAccepted(res) || isSkipDecision(res)
}
