import React from 'react'

export default function HudMetricCard({ label, value, tone = 'neutral', icon, children }) {
  return (
    <div className={`hudMetricCard hudMetricCard--${tone}`}>
      {icon ? (
        <span className="hudMetricCardIcon" aria-hidden="true">{icon}</span>
      ) : null}
      <div className="hudMetricCardBody">
        <div className="hudMetricCardLabel">{label}</div>
        {children || <div className="hudMetricCardValue">{value}</div>}
      </div>
    </div>
  )
}
