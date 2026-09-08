import { formatGameMoney } from '../gameStats.js'

export { formatGameMoney }

/** Resultado mensal de apresentação: faturamento − manutenção já calculados. */
export function deriveMonthlyResult(faturamento, manutencao) {
  const fat = Number(faturamento)
  const opex = Number(manutencao)
  const safeFat = Number.isFinite(fat) ? fat : 0
  const safeOpex = Number.isFinite(opex) ? opex : 0
  return safeFat - safeOpex
}

export function monthlyResultTone(value) {
  const n = Number(value)
  if (!Number.isFinite(n) || n === 0) return 'neutral'
  return n > 0 ? 'positive' : 'negative'
}

/** Razão segura para gauges; 0 se o denominador não for positivo. */
export function gaugeRatio(used, total) {
  const u = Number(used)
  const t = Number(total)
  if (!Number.isFinite(u) || !Number.isFinite(t) || t <= 0) return 0
  return Math.min(1, Math.max(0, u / t))
}

export function formatHudCash(cash) {
  if (cash == null) return '—'
  return formatGameMoney(cash)
}

export const HUD_TABS = Object.freeze(['empresa', 'comercial', 'estrutura', 'ranking'])

export function hudTabDomId(prefix, tab) {
  const safePrefix = String(prefix || 'hud')
  return `${safePrefix}-tab-${tab}`
}

export function hudPanelDomId(prefix, tab) {
  const safePrefix = String(prefix || 'hud')
  return `${safePrefix}-panel-${tab}`
}

/** Capacidade = atendimento / capacidade; clientes = atendimento / carteira. */
export function buildHudGauges(totals = {}) {
  const inService = Number(totals.clientsAt)
  const capacity = Number(totals.possibAt)
  const clients = Number(totals.clientes)
  const usedService = Number.isFinite(inService) ? inService : 0
  const totalCap = Number.isFinite(capacity) ? capacity : 0
  const totalClients = Number.isFinite(clients) ? clients : 0
  return [
    {
      key: 'capacity',
      label: 'Capacidade',
      detail: 'Em atendimento',
      used: usedService,
      total: totalCap,
      value: `${usedService} / ${totalCap}`,
      hasRatio: totalCap > 0,
    },
    {
      key: 'clients',
      label: 'Clientes',
      detail: 'Em atendimento',
      used: usedService,
      total: totalClients,
      value: `${usedService} / ${totalClients}`,
      hasRatio: totalClients > 0,
    },
  ]
}

export function rosterPlayerStatus(player, { turnPlayerId, turnAbsenceStatus } = {}) {
  if (player?.isBankrupt || player?.bankrupt) return { label: 'Falido', tone: 'danger' }
  const isTurn = turnPlayerId != null && String(player?.id) === String(turnPlayerId)
  if (isTurn && turnAbsenceStatus === 'waiting') {
    return { label: 'Desconectado', tone: 'warn' }
  }
  if (isTurn) return { label: 'Na vez', tone: 'active' }
  return { label: 'Aguardando', tone: 'muted' }
}
