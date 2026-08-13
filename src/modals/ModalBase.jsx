import React from "react";

/**
 * Componente base de modal. NÃO usa o contexto.
 * Quem chama passa `onClose`, e esse onClose deve chamar `onResolve`
 * do provider (feito no componente da modal).
 */
export default function ModalBase({ children, onClose, zIndex = 3000 }) {
  const handleClose = () => {
    if (typeof onClose === "function") onClose();
  };

  return (
    <div
      className="sg-modal-backdrop"
      style={{
        position: "fixed",
        inset: 0,
        background: "rgba(8,10,16,.55)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        boxSizing: "border-box",
        width: "100%",
        maxWidth: "100%",
        minWidth: 0,
        padding: 12,
        overflowX: "clip",
        zIndex,
      }}
      onClick={handleClose}
    >
      <div
        className="sg-modal-card"
        style={{
          position: "relative",
          background: "#0f1420",
          border: "1px solid rgba(255,255,255,.1)",
          borderRadius: 14,
          boxSizing: "border-box",
          width: "min(780px, 100%)",
          maxWidth: "100%",
          minWidth: 0,
          maxHeight: "calc(100dvh - 24px)",
          overflowX: "clip",
          overflowY: "auto",
          color: "#fff",
          boxShadow: "0 20px 60px rgba(0,0,0,.45)",
        }}
        onClick={(e) => e.stopPropagation()}
      >
        {children}
      </div>
    </div>
  );
}
