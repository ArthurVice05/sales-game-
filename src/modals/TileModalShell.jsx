import './tile-modal.css'
import { useModal } from './ModalContext'

/**
 * Casca visual dos modais de casa. Não resolve ações e não pinta backdrop —
 * o ModalContext já cobre a pilha. onClose só renderiza o X se o fluxo atual
 * já tiver essa permissão.
 *
 * Com uma única decisão aberta, aria-modal=false permite Tab no HUD lateral
 * consultável. Com filho obrigatório no topo, aria-modal=true.
 */
export default function TileModalShell({
  title,
  titleId = 'tile-modal-title',
  onClose,
  closeRef,
  footer,
  children,
  size = 'lg',
  label,
  className = '',
}) {
  const modalApi = useModal()
  const depth = Array.isArray(modalApi?.stack) ? modalApi.stack.length : 0
  const ariaModal = depth > 1 ? 'true' : 'false'
  const sizeClass = `tileModal tileModal--${size}`
  const extra = typeof className === 'string' && className.trim() ? ` ${className.trim()}` : ''

  return (
    <div
      className={`${sizeClass}${extra}`}
      role="dialog"
      aria-modal={ariaModal}
      aria-labelledby={title ? titleId : undefined}
      aria-label={label || undefined}
      onMouseDown={(event) => event.stopPropagation()}
    >
      <header className="tileModalHeader">
        {title ? (
          <h2 id={titleId} className="tileModalTitle">{title}</h2>
        ) : (
          <span className="tileModalTitle tileModalTitle--empty" />
        )}
        {typeof onClose === 'function' ? (
          <button
            ref={closeRef}
            type="button"
            className="tileModalClose"
            onClick={onClose}
            aria-label="Fechar"
          >
            ✕
          </button>
        ) : null}
      </header>
      <div className="tileModalBody">{children}</div>
      {footer ? <footer className="tileModalFooter">{footer}</footer> : null}
    </div>
  )
}
