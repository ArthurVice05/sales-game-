// src/modals/FaturamentoMesModal.jsx
import React, { useRef } from "react";
import ModalBase from "./ModalBase";
import TileContextHint from "./TileContextHint.jsx";
import "./tile-modal.css";

/**
 * Fecha usando `onResolve`, que é injetado pelo ModalProvider
 * quando a modal é aberta via `pushModal(<FaturamentoMesModal ... />)`.
 */
const formatMoney = (value) => Number(value || 0).toLocaleString('pt-BR')

export default function FaturamentoMesModal({
  value = 0,
  playerName = 'Jogador',
  cashBefore = 0,
  cashAfter,
  onResolve,
}) {
  const v = Number(value || 0);
  const before = Number(cashBefore || 0)
  const after = Number.isFinite(Number(cashAfter)) ? Number(cashAfter) : before + v
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
      value: v,
      source: { modal: "FaturamentoMesModal", file: "src/modals/FaturamentoMesModal.jsx" }
    }); // fecha a modal do topo
  };

  return (
    <ModalBase
      variant="tile"
      size="sm"
      zIndex={2147483647}
      onClose={() => finish({ action: "CLOSE", value: v, source: { modal: "FaturamentoMesModal", file: "src/modals/FaturamentoMesModal.jsx" } })} // fecha por overlay/X
    >
      <header className="tileModalHeader">
        <h2 className="tileModalTitle">Faturamento do mês</h2>
      </header>
      <div className="tileModalBody">
        <TileContextHint kind="REVENUE" />
        <p className="purchasePreviewHint">
          Será creditado o valor do faturamento ao seu saldo
        </p>
        <p className="tileRevenueRecipient"><strong>Empresa:</strong> {playerName}</p>
        <div className="tileValueHuge tileValueHuge--pos">
          R$ {formatMoney(v)}
        </div>
        <dl className="tileRevenueBalance" aria-label="Saldo antes e depois do faturamento">
          <div><dt>Saldo anterior</dt><dd>R$ {formatMoney(before)}</dd></div>
          <div><dt>Saldo após crédito</dt><dd>R$ {formatMoney(after)}</dd></div>
        </dl>
      </div>
      <footer className="tileModalFooter">
        <button type="button" onClick={handleOk} className="tileModalBtn tileModalBtn--confirm">
          OK
        </button>
      </footer>
    </ModalBase>
  );
}
