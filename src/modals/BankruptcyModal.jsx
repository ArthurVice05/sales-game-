// src/modals/BankruptcyModal.jsx
import React, { useEffect, useRef } from 'react'
import { useModal } from './ModalContext'
import ModalBase from './ModalBase'
import './tile-modal.css'

/**
 * Modal de Falência – estilo igual à modal de compra (header forte, callout âmbar,
 * infos nos cantos e rodapé com dois botões). Sem fechar por ESC/backdrop.
 * Tudo em um arquivo: estilos embutidos com <style>.
 */
export default function BankruptcyModal({ playerName = 'Jogador', balanceText = '' }) {
  const { resolveTop, closeModal } = useModal()
  const confirmBtnRef = useRef(null)

  // Bloqueia rolagem e foca no botão principal
  useEffect(() => {
    const prev = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    confirmBtnRef.current?.focus()
    return () => { document.body.style.overflow = prev }
  }, [])

  // Bloqueia ESC/Enter/Espaço para não acionar nada por engano
  useEffect(() => {
    const onKey = (e) => {
      if (e.key === 'Escape' || e.key === 'Enter' || e.key === ' ') {
        e.preventDefault(); e.stopPropagation()
      }
    }
    document.addEventListener('keydown', onKey, true)
    return () => document.removeEventListener('keydown', onKey, true)
  }, [])

  const stop = (e) => { e.preventDefault(); e.stopPropagation() }
  const onCancel = () => { resolveTop(false); closeModal?.() }
  const onConfirm = () => { resolveTop(true); closeModal?.() }

  return (
    <ModalBase variant="tile" size="md" onClose={onCancel}>
      <div
        role="dialog" aria-modal="true"
        aria-labelledby="bk-title" aria-describedby="bk-desc"
        onClick={stop} onMouseDown={stop} onKeyDown={stop}
        style={{ display: 'flex', flexDirection: 'column', minHeight: 0, flex: 1, overflow: 'hidden' }}
      >
        <header className="tileModalHeader">
          <h2 id="bk-title" className="tileModalTitle">Declarar Falência</h2>
          <button type="button" className="tileModalClose" aria-label="Fechar" onClick={onCancel}>×</button>
        </header>

        <div className="tileModalBody">
          <div className="tileStatHint" style={{ display: 'flex', justifyContent: 'space-between', gap: 12, marginBottom: 12, flexWrap: 'wrap' }}>
            <div>
              {balanceText ? <>Saldo disponível: <b>{balanceText}</b></> : <>&nbsp;</>}
            </div>
            <div>Ação permanente nesta partida</div>
          </div>

          <div className="tileWarn" id="bk-desc">
            <div style={{ fontWeight: 800, marginBottom: 6 }}>Atenção</div>
            <p>
              {playerName}, ao confirmar, você será marcado como <b>FALIDO</b>.
              Seu turno será <b>sempre pulado</b> e você não poderá mais executar ações.
            </p>
            <p className="purchasePreviewHint">Esta decisão é irreversível até o fim da partida.</p>
          </div>

          <p className="purchasePreviewHint">
            Confirme abaixo para encerrar sua participação ativa. Você continuará
            visível no placar como <b>FALIDO</b>.
          </p>
        </div>

        <footer className="tileModalFooter">
          <button type="button" className="tileModalBtn tileModalBtn--ghost" onClick={onCancel}>Cancelar</button>
          <button
            type="button"
            ref={confirmBtnRef}
            className="tileModalBtn tileModalBtn--danger"
            onClick={onConfirm}
          >
            Declarar Falência
          </button>
        </footer>
      </div>
    </ModalBase>
  )
}
