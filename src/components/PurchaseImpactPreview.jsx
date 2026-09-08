import React from 'react'

function formatMoney(value) {
  const n = Number(value || 0)
  const abs = Math.abs(n).toLocaleString()
  if (n > 0) return `+ $ ${abs}`
  if (n < 0) return `- $ ${abs}`
  return `$ ${abs}`
}

function formatNumber(value) {
  const n = Number(value || 0)
  if (n > 0) return `+${n.toLocaleString()}`
  if (n < 0) return n.toLocaleString()
  return n.toLocaleString()
}

function formatCash(value) {
  return `$ ${Number(value || 0).toLocaleString()}`
}

function deltaClass(value) {
  const n = Number(value || 0)
  if (n > 0) return 'purchasePreviewDeltaPositive'
  if (n < 0) return 'purchasePreviewDeltaNegative'
  return 'purchasePreviewDeltaNeutral'
}

function Row({ metric, current, after, variation, variationClass, strong }) {
  return (
    <tr className={strong ? 'purchasePreviewRowStrong' : undefined}>
      <td data-label="Métrica">{metric}</td>
      <td data-label="Atual">{current}</td>
      <td data-label="Após a ação">{after}</td>
      <td data-label="Variação" className={variationClass}>{variation}</td>
    </tr>
  )
}

/**
 * Bloco visual reutilizável de preview financeiro.
 * Apenas apresenta dados; não aplica compra nem altera estado.
 */
export default function PurchaseImpactPreview({ impact }) {
  if (!impact) return null

  const { immediateCost, current, after, difference } = impact

  return (
    <div className="purchasePreview">
      <div className="purchasePreviewTitle">Impacto da contratação</div>

      <table className="purchasePreviewTable">
        <thead>
          <tr>
            <th>Métrica</th>
            <th>Atual</th>
            <th>Após a ação</th>
            <th>Variação</th>
          </tr>
        </thead>
        <tbody>
          <Row
            strong
            metric="Custo imediato"
            current="—"
            after={formatCash(immediateCost)}
            variation={formatCash(immediateCost)}
            variationClass="purchasePreviewDeltaNegative"
          />
          <Row
            metric="Caixa"
            current={formatCash(current.cash)}
            after={formatCash(after.cash)}
            variation={formatMoney(difference.cash)}
            variationClass={deltaClass(difference.cash)}
          />
          <Row
            metric="Faturamento"
            current={formatCash(current.revenue)}
            after={formatCash(after.revenue)}
            variation={formatMoney(difference.revenue)}
            variationClass={deltaClass(difference.revenue)}
          />
          <Row
            metric="Despesas"
            current={formatCash(current.expenses)}
            after={formatCash(after.expenses)}
            variation={formatMoney(difference.expenses)}
            variationClass={deltaClass(difference.expenses)}
          />
          <Row
            metric="Capacidade"
            current={Number(current.capacity || 0).toLocaleString()}
            after={Number(after.capacity || 0).toLocaleString()}
            variation={formatNumber(difference.capacity)}
            variationClass={deltaClass(difference.capacity)}
          />
          <Row
            metric="Patrimônio"
            current={formatCash(current.patrimonio)}
            after={formatCash(after.patrimonio)}
            variation={formatMoney(difference.patrimonio)}
            variationClass={deltaClass(difference.patrimonio)}
          />
          <Row
            strong
            metric="Impacto líquido mensal estimado"
            current="—"
            after={formatMoney(difference.monthlyNet)}
            variation={formatMoney(difference.monthlyNet)}
            variationClass={deltaClass(difference.monthlyNet)}
          />
        </tbody>
      </table>
    </div>
  )
}
