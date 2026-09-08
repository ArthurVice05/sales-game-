import React from 'react'
import logoGame from '/SalesGame_Logo-removebg-preview.png'
import { formatRoundProgress } from '../../game/roundDisplay.js'
import TurnTimer from '../TurnTimer.jsx'
import HudMetricCard from './HudMetricCard.jsx'
import {
  deriveMonthlyResult,
  monthlyResultTone,
  formatHudCash,
  formatGameMoney,
} from './hudPresentation.js'
import './desktop-hud.css'

export default function GameDesktopHeader({
  playerName,
  playerColor,
  isSpectator = false,
  iAmHost = false,
  hostName = '',
  round,
  maxRounds,
  gameOver = false,
  cash,
  totals = {},
  turnDeadlineAt,
  turnTimeSec,
  turnPlayerId,
  turnSeq,
  turnLock = false,
  timerPaused = false,
  children,
}) {
  const roundLabel = formatRoundProgress(round, maxRounds, gameOver).label
  const monthly = deriveMonthlyResult(totals.faturamento, totals.manutencao)
  const resultTone = monthlyResultTone(monthly)

  return (
    <header className="gameDesktopHeader">
      <div className="gdhBrand">
        <img className="gdhLogo" src={logoGame} alt="Sales Game" />
        {iAmHost && (
          <span className="gdhHost" title="Você é o Host da sala">
            👑 Você é o Host
          </span>
        )}
        {!iAmHost && hostName && (
          <span className="gdhHost gdhHost--other" title="Host atual da sala">
            👑 Host: {hostName}
          </span>
        )}
        <span className="gdhPlayer">
          <span
            className="gdhPlayerDot"
            style={{ background: playerColor || '#6d5dfc' }}
            aria-hidden="true"
          />
          <span className="gdhPlayerName">{playerName}</span>
        </span>
        {isSpectator && (
          <span className="gdhSpectator" title="Você está assistindo esta partida">
            👁 Espectador
          </span>
        )}
        {children}
      </div>

      <div className="gdhMetrics">
        <HudMetricCard label="Rodada" value={roundLabel} icon="📅" />
        <HudMetricCard label="Tempo" icon="⏱">
          <TurnTimer
            turnDeadlineAt={turnDeadlineAt}
            turnTimeSec={turnTimeSec}
            turnPlayerId={turnPlayerId}
            turnSeq={turnSeq}
            turnLock={turnLock}
            gameOver={gameOver}
            paused={timerPaused}
          />
        </HudMetricCard>
        <HudMetricCard label="Caixa" value={formatHudCash(cash)} icon="💵" />
        <HudMetricCard
          label="Faturamento"
          value={formatGameMoney(totals.faturamento)}
          tone="positive"
          icon="📈"
        />
        <HudMetricCard
          label="Despesas"
          value={formatGameMoney(totals.manutencao)}
          tone="negative"
          icon="📉"
        />
        <HudMetricCard
          label="Resultado mensal"
          value={formatGameMoney(monthly)}
          tone={resultTone}
          icon="📊"
        />
      </div>
    </header>
  )
}
