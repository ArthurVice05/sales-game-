import React from 'react'
import ModalBase from './ModalBase'
import { useModal } from './ModalContext'
import './tile-modal.css'

export default function ConfirmModal({ title = 'Confirmar', message = 'Tem certeza?' }) {
  const { resolveTop, closeModal } = useModal()
  return (
    <ModalBase variant="tile" size="sm">
      <header className="tileModalHeader">
        <h2 className="tileModalTitle">{title}</h2>
      </header>
      <div className="tileModalBody">
        <p className="purchasePreviewHint">{message}</p>
      </div>
      <footer className="tileModalFooter">
        <button type="button" className="tileModalBtn tileModalBtn--ghost" onClick={closeModal}>Cancelar</button>
        <button type="button" className="tileModalBtn tileModalBtn--confirm" onClick={() => resolveTop(true)}>Confirmar</button>
      </footer>
    </ModalBase>
  )
}
