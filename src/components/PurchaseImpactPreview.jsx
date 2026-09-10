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

function Row({ metric, current, after, variation, variationClass, strong, labelCurrent = 'Atual', labelAfter = 'Após a ação', labelDelta = 'Variação' }) {
  return (
    <tr className={strong ? 'purchasePreviewRowStrong' : undefined}>
      <td data-label="Métrica">{metric}</td>
      <td data-label={labelCurrent}>{current}</td>
      <td data-label={labelAfter}>{after}</td>
      <td data-label={labelDelta} className={variationClass}>{variation}</td>
    </tr>
  )
}

/**
 * Bloco visual reutilizável de preview financeiro.
 * Apenas apresenta dados; não aplica compra nem altera estado.
 * density="compact": rótulos curtos (Agora / Após / Variação) — opcional por modal.
 */
export default function PurchaseImpactPreview({ impact, density = 'default' }) {
  if (!impact) return null

  const { immediateCost, current, after, difference } = impact
  const compact = density === 'compact'
  const hCurrent = compact ? 'Agora' : 'Atual'
  const hAfter = compact ? 'Após' : 'Após a ação'
  const hDelta = 'Variação'
  const rowLabels = { labelCurrent: hCurrent, labelAfter: hAfter, labelDelta: hDelta }

  return (
    <div className={`purchasePreview${compact ? ' purchasePreview--compact' : ''}`}>
      <div className="purchasePreviewTitle">Impacto da contratação</div>

      <table className="purchasePreviewTable">
        <thead>
          <tr>
            <th>Métrica</th>
            <th>{hCurrent}</th>
            <th>{hAfter}</th>
            <th>{hDelta}</th>
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
            {...rowLabels}
          />
          <Row
            metric="Caixa"
            current={formatCash(current.cash)}
            after={formatCash(after.cash)}
            variation={formatMoney(difference.cash)}
            variationClass={deltaClass(difference.cash)}
            {...rowLabels}
          />
          <Row
            metric="Faturamento"
            current={formatCash(current.revenue)}
            after={formatCash(after.revenue)}
            variation={formatMoney(difference.revenue)}
            variationClass={deltaClass(difference.revenue)}
            {...rowLabels}
          />
          <Row
            metric="Despesas"
            current={formatCash(current.expenses)}
            after={formatCash(after.expenses)}
            variation={formatMoney(difference.expenses)}
            variationClass={deltaClass(difference.expenses)}
            {...rowLabels}
          />
          <Row
            metric="Capacidade"
            current={Number(current.capacity || 0).toLocaleString()}
            after={Number(after.capacity || 0).toLocaleString()}
            variation={formatNumber(difference.capacity)}
            variationClass={deltaClass(difference.capacity)}
            {...rowLabels}
          />
          <Row
            metric="Patrimônio"
            current={formatCash(current.patrimonio)}
            after={formatCash(after.patrimonio)}
            variation={formatMoney(difference.patrimonio)}
            variationClass={deltaClass(difference.patrimonio)}
            {...rowLabels}
          />
          <Row
            strong
            metric="Impacto líquido mensal estimado"
            current="—"
            after={formatMoney(difference.monthlyNet)}
            variation={formatMoney(difference.monthlyNet)}
            variationClass={deltaClass(difference.monthlyNet)}
            {...rowLabels}
          />
        </tbody>
      </table>
    </div>
  )
}
