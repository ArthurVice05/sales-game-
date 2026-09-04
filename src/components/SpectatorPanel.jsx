import React from 'react'

/**
 * Painel read-only do modo espectador.
 *
 * Substitui o `Controls` interativo: o espectador não rola dado, não compra,
 * não confirma ações e não resolve modais. Só mostra de quem é a vez e o que
 * está acontecendo, derivado do estado autoritativo já recebido.
 */
export default function SpectatorPanel({
  turnPlayerName = '',
  round,
  maxRounds,
  gameOver = false,
  turnLock = false,
  modalLocks = 0,
  onExit,
  exitLabel = 'Voltar às salas',
}) {
  const busy = !!turnLock || Number(modalLocks || 0) > 0
  const statusText = gameOver
    ? 'Partida encerrada — veja o resultado.'
    : !turnPlayerName
    ? 'Aguardando o próximo jogador...'
    : busy
    ? `${turnPlayerName} está resolvendo uma jogada...`
    : `Aguardando a jogada de ${turnPlayerName}...`

  return (
    <div className="spectatorPanel" role="status" aria-live="polite">
      <div className="spectatorPanelHeader">
        <span className="spectatorPanelBadge">👁 Modo espectador</span>
        {Number.isFinite(Number(round)) && Number(round) > 0 && (
          <span className="spectatorPanelRound">
            Rodada {Number(round)}
            {Number.isFinite(Number(maxRounds)) ? `/${Number(maxRounds)}` : ''}
          </span>
        )}
      </div>

      <div className="spectatorPanelTurn">
        <span className="spectatorPanelTurnLabel">Turno atual</span>
        <strong className="spectatorPanelTurnName">
          {turnPlayerName || '—'}
        </strong>
      </div>

      <p className="spectatorPanelStatus">{statusText}</p>

      <button type="button" className="btn dark" onClick={onExit}>
        {exitLabel}
      </button>
    </div>
  )
}
