import React from "react";
import './modal-notebook-scrollbar.css'

/**
 * Componente base de modal. NÃO usa o contexto.
 * Quem chama passa `onClose`, e esse onClose deve chamar `onResolve`
 * do provider (feito no componente da modal).
 *
 * variant="tile": casca visual dos modais de casa (sem segundo backdrop escuro).
 * O ModalContext já fornece o overlay da pilha.
 *
 * @param {{ children: React.ReactNode, onClose?: () => void, zIndex?: number, width?: string, maxWidth?: string, variant?: 'default'|'tile', size?: string }} props
 */
export default function ModalBase({
  children,
  onClose,
  zIndex = 3000,
  width = 'min(780px, 92vw)',
  maxWidth = '92vw',
  variant = 'default',
  size = 'md',
}) {
  const handleClose = () => {
    if (typeof onClose === "function") onClose();
  };

  const isTile = variant === 'tile'

  return (
    <div
      className="sg-modal-backdrop"
      style={{
        position: "fixed",
        inset: 0,
        background: isTile ? "transparent" : "rgba(8,10,16,.55)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        zIndex,
        pointerEvents: isTile && typeof onClose !== 'function' ? 'none' : 'auto',
      }}
      onClick={typeof onClose === 'function' ? handleClose : undefined}
    >
      <div
        className={isTile ? `tileModal tileModal--${size}` : "sg-modal-card"}
        style={isTile ? { pointerEvents: 'auto' } : {
          position: "relative",
          background: "#0f1420",
          border: "1px solid rgba(255,255,255,.1)",
          borderRadius: 14,
          width,
          maxWidth,
          maxHeight: "90vh",
          overflowY: "auto",
          color: "#fff",
          boxShadow: "0 20px 60px rgba(0,0,0,.45)",
        }}
        onClick={(e) => e.stopPropagation()}
        onMouseDown={(e) => e.stopPropagation()}
      >
        {children}
      </div>
    </div>
  );
}
