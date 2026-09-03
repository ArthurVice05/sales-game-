// src/components/FinalWinners.jsx
import React, { useMemo } from 'react'
import { createPortal } from 'react-dom'
import ModalBase from '../modals/ModalBase'
import { rankPlayersByPatrimonio } from '../game/patrimonio.js'

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

  const first = rankedPlayers[0] || null
  const second = rankedPlayers[1] || null
  const third = rankedPlayers[2] || null

  const doExit = () => {
    if (onResolve) onResolve({ action: 'EXIT' })
    else onExit?.()
  }

  const ui = (
    <ModalBase zIndex={FINAL_WINNERS_Z_INDEX} onClose={() => {}}>
      <div className="finalWinners">
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

        <div className="finalWinnersPodium" aria-label="Pódio top 3">
          <MedalCard place="second" player={second} />
          <MedalCard place="first" player={first} big />
          <MedalCard place="third" player={third} />
        </div>

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
                  $ {Number(p.patrimonio || 0).toLocaleString('pt-BR')}
                </span>
              </li>
            ))}
          </ol>
        )}

        <div className="finalWinnersActions">
          <button type="button" className="finalWinnersBtn" onClick={doExit}>
            {exitLabel}
          </button>
        </div>
      </div>
    </ModalBase>
  )

  if (typeof document === 'undefined') return ui
  return createPortal(ui, document.body)
}

function MedalCard({ place, player, big }) {
  if (!player) {
    return <div className={`finalMedalCol finalMedalCol--${place} is-empty`} aria-hidden="true" />
  }

  const label = { first: '1º', second: '2º', third: '3º' }[place]

  return (
    <div
      className={`finalMedalCol finalMedalCol--${place}${big ? ' is-first' : ''}${player.isBankrupt ? ' is-bankrupt' : ''}`}
    >
      <div className="finalMedalRibbon" aria-hidden="true" />
      <div className="finalMedal" aria-hidden="true">
        <div className="finalMedalFace">
          <span className="finalMedalNumber">{label}</span>
        </div>
      </div>

      <div className="finalMedalCard">
        <div className="finalMedalName">{player.name}</div>
        {player.isBankrupt && <div className="finalMedalBadge">Falido</div>}
        <div className="finalMedalStats">
          Caixa: <b>$ {Number(player.cash || 0).toLocaleString('pt-BR')}</b>
          <br />
          Bens: <b>$ {Number(player.bens || 0).toLocaleString('pt-BR')}</b>
        </div>
        <div className="finalMedalPat">
          Patrimônio:{' '}
          <b>$ {Number(player.patrimonio || 0).toLocaleString('pt-BR')}</b>
        </div>
      </div>
    </div>
  )
}
