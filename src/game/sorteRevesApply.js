/**
 * Aplica o payload APPLY_CARD exatamente como o bloco LUCK do useTurnEngine.
 * Humano e Máquina compartilham esta função — sem fórmula paralela.
 */
import { countManagerCerts } from './gameMath.js'

export function applySorteRevesPayloadToPlayer(player, payload, { skipNegativeCash = false } = {}) {
  if (!player) return { player, applied: false }
  if (!payload || payload.action !== 'APPLY_CARD') {
    return { player, applied: false }
  }

  let next = { ...player }
  let cashDelta = Number.isFinite(payload.cashDelta) ? Number(payload.cashDelta) : 0
  const clientsDelta = Number.isFinite(payload.clientsDelta) ? Number(payload.clientsDelta) : 0

  if (skipNegativeCash && cashDelta < 0) cashDelta = 0

  if (cashDelta !== 0) {
    next.cash = Math.max(0, (Number(next.cash) || 0) + cashDelta)
  }
  if (clientsDelta !== 0) {
    next.clients = Math.max(0, (Number(next.clients) || 0) + clientsDelta)
  }
  if (payload.gainSpecialCell) {
    next.fieldSales = (next.fieldSales || 0) + (payload.gainSpecialCell.fieldSales || 0)
    next.support = (next.support || 0) + (payload.gainSpecialCell.support || 0)
    const mgr = payload.gainSpecialCell.manager || 0
    next.gestores = (next.gestores || 0) + mgr
    next.gestoresComerciais = (next.gestoresComerciais || 0) + mgr
    next.managers = (next.managers || 0) + mgr
  }
  if (payload.id === 'casa_change_cert_blue') {
    next.az = (next.az || 0) + 1
    const curSet = new Set((next.trainingsByVendor?.comum || []))
    curSet.add('personalizado')
    next.trainingsByVendor = { ...(next.trainingsByVendor || {}), comum: Array.from(curSet) }
  }

  const anyDerived =
    payload.perClientBonus ||
    payload.perCertifiedManagerBonus ||
    payload.mixLevelBonusABOnly
  if (anyDerived) {
    let extra = 0
    if (payload.perClientBonus) {
      extra += (Number(next.clients) || 0) * Number(payload.perClientBonus || 0)
    }
    if (payload.perCertifiedManagerBonus) {
      extra += countManagerCerts(next) * Number(payload.perCertifiedManagerBonus || 0)
    }
    if (payload.mixLevelBonusABOnly) {
      const level = String(next.mixProdutos || '').toUpperCase()
      if (level === 'A' || level === 'B') extra += Number(payload.mixLevelBonusABOnly || 0)
    }
    if (extra) next.cash = (Number(next.cash) || 0) + extra
  }

  return { player: next, applied: true }
}
