import React, { useRef } from "react";
import ModalBase from "./ModalBase";
import TileContextHint from "./TileContextHint.jsx";
import { MANUAL_CONSTANTS } from "../game/manualConstants.js";
import "./tile-modal.css";

/**
 * Esta modal fecha chamando `onResolve`, que é injetado pelo ModalProvider
 * quando você usa `pushModal(<DespesasOperacionaisModal ... />)`.
 */
export default function DespesasOperacionaisModal({
  expense = 0,
  loanCharge = 0,
  onResolve, // <- vem do provider
}) {
  const total = Number(expense || 0) + Number(loanCharge || 0);
  const didResolveRef = useRef(false);

  const finish = (payload) => {
    if (didResolveRef.current) return;
    didResolveRef.current = true;
    onResolve?.(payload);
  };

  const handleOk = (e) => {
    e?.preventDefault?.();
    e?.stopPropagation?.();
    finish({
      action: "OK",
      expense: Number(expense || 0),
      loanCharge: Number(loanCharge || 0),
      total: Number(total || 0),
      source: { modal: "DespesasOperacionaisModal", file: "src/modals/DespesasOperacionaisModal.jsx" }
    }); // <- fecha a modal do topo
  };

  return (
    <ModalBase
      variant="tile"
      size="sm"
      zIndex={2147483647}
      onClose={() => finish({ action: "CLOSE", source: { modal: "DespesasOperacionaisModal", file: "src/modals/DespesasOperacionaisModal.jsx" } })} // fecha no overlay/X
    >
      <header className="tileModalHeader">
        <h2 className="tileModalTitle">Despesas do mês</h2>
      </header>
      <div className="tileModalBody">
        <TileContextHint kind="EXPENSES" />

        <div className="tileStatBlock" style={{ marginBottom: 8 }}>
          Despesas operacionais:&nbsp;
          <b>-$ {Number(expense).toLocaleString()}</b>
        </div>

        {Number(loanCharge) > 0 && (
          <div className="tileWarn" style={{ marginBottom: 8 }}>
            Empréstimo + {Math.round((MANUAL_CONSTANTS.loanInterestRatio || 0) * 100)}% de juros:&nbsp;
            <b>-$ {Number(loanCharge).toLocaleString()}</b>
          </div>
        )}

        <div className="tileValueHuge tileValueHuge--neg">
          -$ {total.toLocaleString()}
        </div>
        <p className="purchasePreviewHint">Total a debitar</p>
      </div>
      <footer className="tileModalFooter">
        <button type="button" onClick={handleOk} className="tileModalBtn tileModalBtn--confirm">
          OK
        </button>
      </footer>
    </ModalBase>
  );
}
