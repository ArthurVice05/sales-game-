import React, { useEffect, useMemo } from 'react'
import { rankPlayersByPatrimonio } from '../game/patrimonio.js'
import { buildGameStatSections } from './gameStats.js'

import { isDebugLogsEnabled } from '../game/debugFlags.js'

const DEBUG_LOGS = isDebugLogsEnabled()

function formatMoney(value) {
  return Number(value || 0).toLocaleString('pt-BR')
}

export default function HUD({ totals, players }) {
  const statSections = buildGameStatSections(totals)
  const rankedPlayers = useMemo(
    () => rankPlayersByPatrimonio(Array.isArray(players) ? players : []),
    [players]
  )

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
        <p className="scorePatrimonioNote">
          1º ao 4º por patrimônio (Caixa + Bens). Atualiza durante a partida.
        </p>
        {rankedPlayers.map((player, index) => {
          const place = index + 1
          const rowClass = [
            'row',
            place === 1 && !player.isBankrupt ? 'is-leader' : '',
            player.isBankrupt ? 'is-bankrupt' : '',
          ].filter(Boolean).join(' ')

          return (
            <div className={rowClass} key={player.id || `${player.name}-${index}`}>
              <span className="scoreName">
                <span className="scorePlace" aria-label={`${place}º lugar`}>
                  {place}º
                </span>
                <span className="scorePlayerName">
                  {player.name}
                  {player.isBankrupt ? ' (falido)' : ''}
                </span>
              </span>
              <span className="scoreValues">
                <span className="hudHelp" title="Dinheiro disponível para compras, despesas e decisões.">
                  Caixa {formatMoney(player.cash)}
                </span>
                <span className="hudHelp" title="Bens acumulados na partida.">
                  Bens {formatMoney(player.bens)}
                </span>
                <span
                  className="hudHelp scorePatrimonio"
                  title="Patrimônio = Caixa + Bens (mesmo critério do pódio final)."
                >
                  Pat. {formatMoney(player.patrimonio)}
                </span>
              </span>
            </div>
          )
        })}
      </div>
    </div>
  )
}
