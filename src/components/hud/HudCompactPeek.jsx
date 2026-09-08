import DiceResult from '../DiceResult.jsx'
import HudMetricCard from './HudMetricCard.jsx'
import {
  formatGameMoney,
  formatHudCash,
  buildHudGauges,
} from './hudPresentation.js'

export default function HudCompactPeek({ lastRoll, isRolling, cash, totals = {} }) {
  const gauges = buildHudGauges(totals)
  return (
    <div className="hudCompactPeek">
      <DiceResult lastRoll={lastRoll} isRolling={isRolling} />
      <div className="hudCompactPeekMetrics">
        <HudMetricCard label="Caixa" value={formatHudCash(cash)} />
        <HudMetricCard
          label="Faturamento"
          value={formatGameMoney(totals.faturamento)}
          tone="positive"
        />
        <HudMetricCard
          label="Despesas"
          value={formatGameMoney(totals.manutencao)}
          tone="negative"
        />
      </div>
      <div className="hudCompactPeekGauges">
        {gauges.map((gauge) => (
          <div key={gauge.key} className="hudCompactPeekGauge">
            <span>{gauge.label}</span>
            <strong>{gauge.value}</strong>
          </div>
        ))}
      </div>
    </div>
  )
}
