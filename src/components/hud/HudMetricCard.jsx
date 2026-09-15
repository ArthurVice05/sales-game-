import React from 'react'
import { useFitMetricValue } from './useFitMetricValue.js'

/**
 * Card numérico do HUD. O valor nunca sai do quadrado:
 * 1) reduz a fonte até METRIC_MIN_SCALE; 2) se ainda não couber, usa
 * `compactValue` (ex.: "R$ 1,2 mi"). O valor completo fica no title/aria.
 */
export default function HudMetricCard({ label, value, compactValue, tone = 'neutral', icon, children }) {
  const text = value == null ? '' : String(value)
  const compactText = compactValue == null ? '' : String(compactValue)
  const { boxRef, fullRef, compactRef, fit } = useFitMetricValue([text, compactText])
  const shown = fit.compact && compactText ? compactText : text

  return (
    <div className={`hudMetricCard hudMetricCard--${tone}`} title={children ? undefined : `${label}: ${text}`}>
      {icon ? (
        <span className="hudMetricCardIcon" aria-hidden="true">{icon}</span>
      ) : null}
      <div className="hudMetricCardBody">
        <div className="hudMetricCardLabel">{label}</div>
        {children || (
          <div className="hudMetricCardValue" ref={boxRef} aria-label={text}>
            <span
              className="hudMetricCardValueText"
              aria-hidden="true"
              style={fit.scale < 1 ? { fontSize: `${(fit.scale * 100).toFixed(1)}%` } : undefined}
            >
              {shown}
            </span>
            <span className="hudMetricCardMeasure" ref={fullRef} aria-hidden="true">{text}</span>
            {compactText ? (
              <span className="hudMetricCardMeasure" ref={compactRef} aria-hidden="true">{compactText}</span>
            ) : null}
          </div>
        )}
      </div>
    </div>
  )
}
