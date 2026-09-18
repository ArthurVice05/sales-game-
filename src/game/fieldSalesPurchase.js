/**
 * Monta os deltas da contratação do Canal Representantes
 * exatamente como o useTurnEngine já aplicava nos 4 caminhos.
 *
 * Fonte: payload do BuyFieldSalesModal → applyDeltas
 * Campos: cashDelta, fieldSalesDelta, manutencaoDelta, revenueDelta
 */
export function buildFieldSalesPurchaseDeltas(res = {}) {
  const cost = Number(
    res.totalHire ??
    res.total ??
    res.cost ??
    0
  )

  const cashDelta =
    typeof res.cashDelta !== 'undefined'
      ? Number(res.cashDelta)
      : -cost

  const qty = Number(
    res.headcount ??
    res.qty ??
    res.fieldSalesQty ??
    0
  )

  const manutencaoDelta = Number(
    res.expenseDelta ??
    res.totalExpense ??
    res.maintenanceDelta ??
    0
  )

  const revenueDelta = Number(
    res.revenueDelta ??
    0
  )

  return {
    cashDelta,
    fieldSalesDelta: qty,
    manutencaoDelta,
    revenueDelta,
  }
}
