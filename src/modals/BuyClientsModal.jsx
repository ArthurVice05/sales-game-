// src/modals/BuyClientsModal.jsx
import React, { useEffect, useMemo, useRef, useState } from 'react'
import { useModal } from './ModalContext'
import InsufficientFundsModal from './InsufficientFundsModal'
import PurchaseImpactPreview from '../components/PurchaseImpactPreview.jsx'
import { buildClientsPurchaseDeltas } from '../game/clientsPurchase.js'
import { previewPurchaseImpact } from '../game/purchasePreview.js'
import { MANUAL_CONSTANTS } from '../game/manualConstants.js'
import TileContextHint from './TileContextHint.jsx'
import TileModalShell from './TileModalShell.jsx'

/**
 * Modal para compra de clientes.
 *
 * Props:
 *  - onResolve: function
 *      â€¢ { action:'BUY',
 *          qty:number,
 *          unitAcquisition:number,
 *          totalCost:number,
 *          unitMaintenance:number,
 *          maintenanceDelta:number,
 *          bensDelta:number,
 *          clientsAdded:number }
 *      â€¢ { action:'SKIP' }
 *  - unitAcquisition?: number   (preÃ§o por cliente)   -> padrÃ£o 1000
 *  - unitMaintenance?: number   (despesa por cliente) -> padrÃ£o 50
 *  - currentCash?: number       (saldo atual do jogador) -> obrigatÃ³rio para validar saldo
 *  - currentPlayer?: object     (snapshot somente leitura para preview)
 */
export default function BuyClientsModal({
  onResolve,
  unitAcquisition = MANUAL_CONSTANTS.clientPrice,
  unitMaintenance = MANUAL_CONSTANTS.clientPortfolioDesp,
  currentCash = 0,
  currentPlayer = null,
  allowBack = false,
}) {
  const closeRef = useRef(null)
  const inputRef = useRef(null)
  const { pushModal, awaitTop } = useModal()

  const [qty, setQty] = useState('')

  const qtyNum = useMemo(() => {
    const n = Math.floor(Number(qty))
    return Number.isFinite(n) && n > 0 ? n : 0
  }, [qty])

  const pricePer = Number(unitAcquisition || 0)
  const mPer     = Number(unitMaintenance || 0)
  const cashNow  = Number(currentCash || 0)

  const maxQtyByCash = useMemo(() => {
    if (pricePer <= 0) return 0
    return Math.max(0, Math.floor(cashNow / pricePer))
  }, [cashNow, pricePer])

  const totalCost        = qtyNum * pricePer
  const maintenanceDelta = qtyNum * mPer
  const canBuy           = qtyNum > 0

  const purchaseImpact = useMemo(() => {
    const playerSnapshot = currentPlayer || { cash: cashNow }
    const draftPayload = {
      totalCost,
      qty: qtyNum,
      maintenanceDelta,
      bensDelta: totalCost,
    }
    const deltas = buildClientsPurchaseDeltas(draftPayload)
    return previewPurchaseImpact({
      player: playerSnapshot,
      deltas,
      immediateCost: totalCost,
    })
  }, [currentPlayer, cashNow, totalCost, qtyNum, maintenanceDelta])

  const handleClose = (e) => {
    e?.preventDefault?.()
    e?.stopPropagation?.()
    onResolve?.({ action: 'SKIP' })
  }
  const handleBack = (e) => { e?.preventDefault?.(); e?.stopPropagation?.(); onResolve?.({ action:'BACK' }) }

  const handleBuy = async () => {
    if (!canBuy) return

    if (cashNow < totalCost) {
      pushModal(
        <InsufficientFundsModal
          requiredAmount={totalCost}
          currentCash={cashNow}
          title="Saldo insuficiente para comprar clientes"
          message="Você não possui saldo suficiente para concluir esta aquisição."
          okLabel="Entendi"
        />
      )
      await awaitTop()
      return
    }

    onResolve?.({
      action: 'BUY',
      qty: qtyNum,
      unitAcquisition: pricePer,
      totalCost,
      unitMaintenance: mPer,
      // âœ… EXTRA: manutenÃ§Ã£o deve ser POSITIVA (despesa mensal adicionada). O restante do jogo trata manutencao como nÃºmero positivo.
      maintenanceDelta,
      bensDelta: totalCost,   // bens aumentam pelo valor da aquisiÃ§Ã£o
      clientsAdded: qtyNum,   // Ãºtil para cÃ¡lculos externos
      source: { modal: 'BuyClientsModal', file: 'src/modals/BuyClientsModal.jsx' },
    })
  }

  // UX: bloqueia scroll; foco no X e no input; Enter confirma
  useEffect(() => {
    const prev = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    const t1 = setTimeout(() => closeRef.current?.focus?.(), 0)
    const t2 = setTimeout(() => inputRef.current?.focus?.(), 50)
    const onKeyDown = (ev) => {
      if (ev.key === 'Enter') {
        ev.preventDefault()
        handleBuy()
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => {
      document.body.style.overflow = prev
      window.removeEventListener('keydown', onKeyDown)
      clearTimeout(t1); clearTimeout(t2)
    }
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  const setBoundedQty = (n) => {
    const v = Math.max(0, Math.min(Math.floor(Number(n) || 0), 1_000_000))
    setQty(String(v))
  }

  return (
    <TileModalShell
      title="Carteira de Clientes"
      onClose={handleClose}
      closeRef={closeRef}
      footer={(
        <>
          {allowBack && (
            <button type="button" className="tileModalBtn tileModalBtn--ghost" onClick={handleBack}>
              Voltar
            </button>
          )}
          <button type="button" className="tileModalBtn tileModalBtn--ghost" onClick={handleClose}>
            Não comprar
          </button>
          <button
            type="button"
            className="tileModalBtn tileModalBtn--confirm"
            onClick={handleBuy}
            disabled={!canBuy}
            title={!canBuy ? 'Informe uma quantidade válida' : (cashNow < totalCost ? 'Saldo insuficiente' : undefined)}
          >
            {canBuy ? `Contratar por $ ${totalCost.toLocaleString()}` : 'Contratar'}
          </button>
        </>
      )}
    >
      <TileContextHint kind="CLIENTS" />

      <div className="tileWarn">
        <b>Mas cuidado com a capacidade de atendimento da sua equipe!</b><br />
        Se o jogador adquirir mais clientes do que os vendedores podem atender,
        assim que passar na casa <i>Faturamento do Mês</i> não receberá o faturamento
        dos clientes excedentes e perderá o(s) cliente(s) que não foram atendidos.
      </div>

      <p className="purchasePreviewHint">
        Novos clientes podem aumentar seu faturamento, mas exigem capacidade suficiente
        da sua equipe para serem atendidos.
      </p>

      <div className="tileQtyCost">
        <div className="tileStatBlock">
          <div className="tileStatLabel">Quantidade de clientes</div>
          <div className="tileStepper">
            <button
              type="button"
              className="tileStepperBtn"
              aria-label="Diminuir quantidade"
              disabled={qtyNum <= 0}
              onClick={() => setBoundedQty(Math.max(0, qtyNum - 1))}
            >
              −
            </button>
            <input
              ref={inputRef}
              type="number"
              inputMode="numeric"
              min={0}
              placeholder="0"
              value={qty}
              onChange={(e) => setBoundedQty(e.target.value)}
              aria-label="Quantidade de Clientes"
            />
            <button
              type="button"
              className="tileStepperBtn"
              aria-label="Aumentar quantidade"
              onClick={() => setBoundedQty(qtyNum + 1)}
            >
              +
            </button>
          </div>
          <div className="tileQuickBtns">
            <button type="button" className="tileModalBtn" onClick={() => setBoundedQty(qtyNum + 5)}>+5</button>
            <button type="button" className="tileModalBtn" onClick={() => setBoundedQty(qtyNum + 10)}>+10</button>
            <button
              type="button"
              className="tileModalBtn"
              onClick={() => setBoundedQty(maxQtyByCash)}
              title="Comprar o máximo possível com o saldo atual"
            >
              Máx
            </button>
          </div>
          <div className="tileStatHint">Máximo por saldo: <b>{maxQtyByCash}</b></div>
        </div>
        <div className="tileStatBlock">
          <div className="tileStatLabel">Preço por cliente</div>
          <div className="tileStatValue">$ {pricePer.toLocaleString()}</div>
          <div className="tileStatHint">Pagamento único · saldo $ {cashNow.toLocaleString()}</div>
          <div className="tileStatHint">Despesa mensal por cliente: <b>$ {mPer.toLocaleString()}</b></div>
        </div>
      </div>

      <PurchaseImpactPreview impact={purchaseImpact} />
    </TileModalShell>
  )
}
