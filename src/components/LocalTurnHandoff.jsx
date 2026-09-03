import React, { useEffect, useRef } from 'react'
import { createPortal } from 'react-dom'

export const LOCAL_HANDOFF_Z_INDEX = 2147483645

export default function LocalTurnHandoff({
  open,
  playerName,
  turnKey,
  initial = false,
  readyToConfirm = true,
  onConfirm,
}) {
  const buttonRef = useRef(null)

  useEffect(() => {
    if (!open || typeof document === 'undefined') return undefined
    const gameShell = document.querySelector('[data-game-shell]')
    const alreadyInert = gameShell?.hasAttribute('inert') === true
    gameShell?.setAttribute('inert', '')

    if (readyToConfirm) buttonRef.current?.focus()
    return () => {
      if (!alreadyInert) gameShell?.removeAttribute('inert')
    }
  }, [open, readyToConfirm, turnKey])

  if (!open) return null

  const safeName = String(playerName || '').trim() || 'Próximo jogador'
  const ui = (
    <div
      className="localHandoff"
      role="dialog"
      aria-modal="true"
      aria-labelledby="localHandoffTitle"
      aria-describedby="localHandoffDescription"
      style={{ zIndex: LOCAL_HANDOFF_Z_INDEX }}
    >
      <div className="localHandoffCard">
        <p className="localHandoffEyebrow">Troca de jogador</p>
        <h1 id="localHandoffTitle">
          {initial ? 'Primeiro turno' : 'Passe o dispositivo para'}
        </h1>
        <p id="localHandoffDescription" className="localHandoffName">{safeName}</p>
        <p className="localHandoffHint">
          {readyToConfirm
            ? 'Confirme somente quando o dispositivo estiver com a pessoa certa.'
            : 'Finalizando a apresentação da jogada anterior…'}
        </p>
        <button
          ref={buttonRef}
          type="button"
          className="localHandoffButton"
          disabled={!readyToConfirm}
          onClick={() => onConfirm?.(turnKey)}
        >
          Sou {safeName} — iniciar turno
        </button>
      </div>
    </div>
  )

  if (typeof document === 'undefined') return ui
  return createPortal(ui, document.body)
}
