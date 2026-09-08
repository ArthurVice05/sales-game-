// src/modals/InsufficientFundsModal.jsx
import React, { useEffect, useMemo, useRef } from 'react'
import TileModalShell from './TileModalShell.jsx'

/**
 * Modal genérica de Saldo Insuficiente.
 *
 * Props:
 *  - onResolve: function(payload)
 *      • { action: 'ACK' }   // usuário leu/confirmou
 *      • { action: 'SKIP' }  // usuário fechou
 *      • { action: 'RECOVERY' }  // usuário escolheu recuperação financeira
 *      • { action: 'BANKRUPT' }  // usuário escolheu declarar falência
 *  - requiredAmount: number  (quanto precisa)
 *  - currentCash: number     (saldo atual)
 *  - title?: string          (padrão: "Saldo insuficiente")
 *  - message?: string        (mensagem adicional)
 *  - okLabel?: string        (padrão: "OK")
 *  - showRecoveryOptions?: boolean  // se deve mostrar botões de recuperação/falência
 */
export default function InsufficientFundsModal({
  onResolve,
  requiredAmount = 0,
  currentCash = 0,
  title = 'Saldo insuficiente',
  message = 'Seu saldo atual não é suficiente para concluir esta compra.',
  okLabel = 'OK',
  showRecoveryOptions = false,
  canClose = true,
}) {
  const closeRef = useRef(null)

  const missing = useMemo(
    () => Math.max(0, Number(requiredAmount || 0) - Number(currentCash || 0)),
    [requiredAmount, currentCash]
  )

  const fmt = (n) => `$ ${Number(n || 0).toLocaleString()}`

  const handleOk = (e) => {
    e?.preventDefault?.()
    e?.stopPropagation?.()
    onResolve?.({ action: 'ACK' })
  }

  const handleClose = (e) => {
    e?.preventDefault?.()
    e?.stopPropagation?.()
    // Não permite fechar quando showRecoveryOptions está ativo ou canClose é false
    if (showRecoveryOptions || !canClose) {
      return
    }
    onResolve?.({ action: 'SKIP' })
  }

  const handleRecovery = (e) => {
    e?.preventDefault?.()
    e?.stopPropagation?.()
    onResolve?.({ action: 'RECOVERY' })
  }

  const handleBankrupt = (e) => {
    e?.preventDefault?.()
    e?.stopPropagation?.()
    onResolve?.({ action: 'BANKRUPT' })
  }

  // Bloqueia scroll e foca no botão primário (ESC NÃO fecha)
  useEffect(() => {
    const prev = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    setTimeout(() => closeRef.current?.focus?.(), 0)
    return () => { document.body.style.overflow = prev }
  }, [])

  const canDismiss = !showRecoveryOptions && canClose

  return (
    <TileModalShell
      title={title}
      onClose={canDismiss ? handleClose : undefined}
      size="sm"
      footer={showRecoveryOptions ? (
        <>
          <button
            type="button"
            className="tileModalBtn"
            onClick={handleRecovery}
          >
            Recuperação Financeira
          </button>
          <button
            type="button"
            className="tileModalBtn tileModalBtn--danger"
            onClick={handleBankrupt}
          >
            Declarar Falência
          </button>
        </>
      ) : (
        <button
          ref={closeRef}
          type="button"
          className="tileModalBtn tileModalBtn--ghost"
          onClick={handleOk}
        >
          {okLabel}
        </button>
      )}
    >
      <p className="purchasePreviewHint">{message}</p>

      <div className="tileStatBlock">
        <div className="tileStatHint" style={{ display: 'flex', justifyContent: 'space-between' }}>
          <span>Necessário:</span><b>{fmt(requiredAmount)}</b>
        </div>
        <div className="tileStatHint" style={{ display: 'flex', justifyContent: 'space-between' }}>
          <span>Seu saldo:</span><b>{fmt(currentCash)}</b>
        </div>
        <div className="tileStatHint" style={{ display: 'flex', justifyContent: 'space-between', color: '#fca5a5' }}>
          <span>Faltam:</span><b>{fmt(missing)}</b>
        </div>
      </div>
    </TileModalShell>
  )
}
