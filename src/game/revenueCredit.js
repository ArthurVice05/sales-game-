export function applyMonthlyRevenueCredit(player, revenue) {
  const current = player && typeof player === 'object' ? player : {}
  const cashBefore = Number(current.cash)
  const rawRevenue = Number(revenue)
  const safeCash = Number.isFinite(cashBefore) ? cashBefore : 0
  const safeRevenue = Number.isFinite(rawRevenue) ? Math.max(0, Math.floor(rawRevenue)) : 0

  return {
    ...current,
    cash: safeCash + safeRevenue,
  }
}
