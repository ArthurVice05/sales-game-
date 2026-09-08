import { formatGameMoney } from '../gameStats.js'

export { formatGameMoney }

/** Compactação só visual. O valor integral continua no Resumo. */
export function formatCompactCash(cash) {
  if (cash == null) return '—'
  const n = Number(cash)
  if (!Number.isFinite(n)) return '—'
  const abs = Math.abs(n)
  if (abs < 1000) return formatGameMoney(n)
  const k = n / 1000
  const rounded = Number.isInteger(k)
    ? String(k)
    : Math.abs(k - Math.round(k)) < 0.05
      ? String(Math.round(k))
      : k.toLocaleString('pt-BR', { maximumFractionDigits: 1 })
  const sign = n < 0 && !String(rounded).startsWith('-') ? '-' : ''
  return `${sign}R$ ${rounded}k`
}

export function compactHostLabel(isHost, hostName = '') {
  if (isHost) return { full: 'Você é o Host', short: 'H' }
  if (hostName) return { full: `Host: ${hostName}`, short: 'H' }
  return { full: '', short: '' }
}
