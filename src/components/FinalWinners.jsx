// src/components/FinalWinners.jsx
import React, { useEffect, useMemo, useRef } from 'react'
import { createPortal } from 'react-dom'
import ModalBase from '../modals/ModalBase'
import { rankPlayersByPatrimonio } from '../game/patrimonio.js'
import FinalResultsScene, { ResultsCounter } from './final-winners/FinalResultsScene.jsx'
import { createResultsTimeline, formatResultsMoney, resultsEntries } from './final-winners/resultsPresentation.js'
import './final-winners/final-results.css'

/** Acima do tabuleiro / pinch-zoom / OrientationGuard no iOS Safari. */
export const FINAL_WINNERS_Z_INDEX = 2147483646

/**
 * Pódio final (Top 3) — modal travada no centro.
 * Ranking: patrimônio (Caixa+Bens) → caixa → nome; falidos por último.
 * Portal em document.body: evita ficar atrás do tabuleiro no mobile
 * (.page overflow:hidden + stacking do boardWrap).
 */
export default function FinalWinners({ players = [], maxRounds, endedRound, onExit, onResolve, exitLabel = 'Voltar aos Lobbies' }) {
  const rankedPlayers = useMemo(() => rankPlayersByPatrimonio(players), [players])

  const entries = useMemo(() => resultsEntries(rankedPlayers), [rankedPlayers])
  const timeline = useMemo(() => createResultsTimeline(), [])
  const exitRef = useRef(null)

  useEffect(() => {
    const previous = document.activeElement
    exitRef.current?.focus({ preventScroll: true })
    return () => { if (previous?.isConnected) previous.focus?.({ preventScroll: true }) }
  }, [])

  const doExit = () => {
    if (onResolve) onResolve({ action: 'EXIT' })
    else onExit?.()
  }

  const ui = (
    <ModalBase zIndex={FINAL_WINNERS_Z_INDEX} onClose={() => {}}>
      <div className="finalWinners fwr3d-dialog" role="dialog" aria-modal="true" aria-label="Fim da partida" onKeyDown={event => {
        if (event.key === 'Tab') { event.preventDefault(); exitRef.current?.focus({ preventScroll: true }) }
      }}>
        <h1 className="finalWinnersTitle">Fim da partida</h1>
        <p className="finalWinnersSubtitle">
          {Number.isFinite(Number(maxRounds)) ? (
            <>
              Duração configurada: <b>{Number(maxRounds)}</b> rodada(s).
            </>
          ) : null}
          {Number.isFinite(Number(endedRound)) && Number(endedRound) > 0 ? (
            <>
              {' '}
              Encerrada na rodada <b>{Number(endedRound)}</b>.
            </>
          ) : null}
          {' '}
          Vence quem tiver <b>Caixa + Bens</b> (patrimônio).
        </p>

        <section className="finalWinnersPodium fwr3d-podium" aria-label="Patrimônio dos três primeiros">
          {entries.length > 0 ? <>
            <FinalResultsScene entries={entries} timeline={timeline} />
            <div className="fwr3d-labels" style={{ '--fwr3d-count': entries.length }}>
              {entries.map(({ player, place }) => <div className={`fwr3d-columnLabel fwr3d-place-${place}`} key={place}>
                <span className="fwr3d-place">{place}º lugar</span>
                <span className="fwr3d-name">{player.name}</span>
              </div>)}
            </div>
            <p className="fwr3d-scaleNote">Altura proporcional ao patrimônio · linha de base: $ 0</p>
            <ol className="fwr3d-details">
              {rankedPlayers.slice(0, 3).map((player, index) => <li className={`fwr3d-result fwr3d-place-${index + 1}`} key={player.id || index}>
                <h2 className="fwr3d-resultName">{index + 1}º · {player.name}</h2>
                {player.isBankrupt && <p className="fwr3d-bankrupt">Falido · classificação após os não falidos.</p>}
                <p className="fwr3d-money">Patrimônio <strong>
                  <span className="fwr3d-srOnly">{formatResultsMoney(player.patrimonio)}</span>
                  <ResultsCounter value={player.patrimonio} timeline={timeline} />
                </strong></p>
                <p className="fwr3d-breakdown">Caixa: <b>{formatResultsMoney(player.cash)}</b><span> · </span>Bens: <b>{formatResultsMoney(player.bens)}</b></p>
                {!Number.isFinite(player.patrimonio) && <p className="fwr3d-bankrupt">Valor indisponível; coluna não representada.</p>}
              </li>)}
            </ol>
          </> : <p>Nenhum jogador para apresentar.</p>}
        </section>

        {rankedPlayers.length > 3 && (
          <ol className="finalWinnersList">
            {rankedPlayers.slice(3).map((p, i) => (
              <li key={p.id || `${p.name}-${i}`}>
                <span className="finalWinnersListPlace">{i + 4}º</span>
                <span className="finalWinnersListName">
                  {p.name}
                  {p.isBankrupt ? ' (falido)' : ''}
                </span>
                <span className="finalWinnersListPat">
                  {formatResultsMoney(p.patrimonio)}
                </span>
              </li>
            ))}
          </ol>
        )}

        <div className="finalWinnersActions">
          <button ref={exitRef} type="button" className="finalWinnersBtn" onClick={doExit}>
            {exitLabel}
          </button>
        </div>
      </div>
    </ModalBase>
  )

  if (typeof document === 'undefined') return ui
  return createPortal(ui, document.body)
}
