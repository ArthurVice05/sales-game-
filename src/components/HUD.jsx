import React, { useEffect } from 'react'
import { computePatrimonio } from '../game/patrimonio.js'
import { buildGameStatSections } from './gameStats.js'

const DEBUG_LOGS = import.meta.env.DEV && localStorage.getItem('SG_DEBUG_LOGS') === '1'

export default function HUD({ totals, players }) {
  const statSections = buildGameStatSections(totals)

  useEffect(() => {
    if (!DEBUG_LOGS) return
    console.groupCollapsed('[HUD] totals')
    console.log(totals)
    console.groupEnd()
  }, [totals])

  return (
    <div className="hud">
      <div className="panel game-stats-card">
        {statSections.map((section) => (
          <section className="game-stats-section" key={section.key}>
            <h3 className="game-stats-title">{section.title}</h3>
            <dl className="game-stats-list">
              {section.rows.map((row) => (
                <div className="game-stat-row" key={row.key} data-stat-key={row.key}>
                  <dt>{row.label}</dt>
                  <dd className={`game-stat-value game-stat-value--${row.tone}`}>
                    {row.value}
                  </dd>
                </div>
              ))}
            </dl>
          </section>
        ))}
      </div>

      <div className="score">
        <div className="title hudHelp" title="Patrimônio = Caixa + Bens. Critério de vitória no fim da partida.">
          Placar
        </div>
        <p className="scorePatrimonioNote">Patrimônio = Caixa + Bens</p>
        {players.map((player) => (
          <div className="row" key={player.id}>
            <span>{player.name}</span>
            <span className="scoreValues">
              <span className="hudHelp" title="Dinheiro disponível para compras, despesas e decisões.">
                Caixa {Number(player.cash || 0).toLocaleString('pt-BR')}
              </span>
              <span
                className="hudHelp scorePatrimonio"
                title="Patrimônio = Caixa + Bens (mesmo critério do pódio final)."
              >
                Pat. {computePatrimonio(player).toLocaleString('pt-BR')}
              </span>
            </span>
          </div>
        ))}
      </div>
    </div>
  )
}
