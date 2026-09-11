// src/modals/BuyManagerModal.jsx
import React, { useEffect, useMemo, useRef, useState } from 'react'
import { useModal } from './ModalContext'
import InsufficientFundsModal from './InsufficientFundsModal'
import PurchaseImpactPreview from '../components/PurchaseImpactPreview.jsx'
import { MANAGER_MANAGES_UP_TO, VENDOR_RULES, managerBoostPct } from '../game/gameRules'
import { MANUAL_CONSTANTS } from '../game/manualConstants.js'
import { buildManagerPurchaseDeltas } from '../game/managersPurchase.js'
import { previewPurchaseImpact } from '../game/purchasePreview.js'
import TileContextHint from './TileContextHint.jsx'
import TileModalShell from './TileModalShell.jsx'
import { useRegisterDecisionBuyer } from './decisionBuyerContext.jsx'

/**
 * Modal para compra de Gestor Comercial.
 *
 * Props:
 *  - onResolve: function
 *      â€¢ {action:'BUY', qty:number, unitHire:number, unitExpense:number,
 *         totalHire:number, totalExpense:number, cost:number, total:number,
 *         // deltas para o painel:
 *         cashDelta:number, expenseDelta:number, role:'MANAGER'}
 *      â€¢ {action:'SKIP'}
 *  - unitHire?: number     (custo de contrataÃ§Ã£o por gestor â€” padrÃ£o 5000)
 *  - unitExpense?: number  (despesa mensal por gestor â€” padrÃ£o 3000)
 *  - managesUpTo?: number  (qtd. colaboradores por gestor â€” padrÃ£o 7, informativo)
 *  - currentCash?: number  (saldo atual do jogador para validaÃ§Ã£o)
 *  - currentPlayer?: object (snapshot somente leitura para preview)
 */
export default function BuyManagerModal({
  onResolve,
  unitHire = MANUAL_CONSTANTS.managerHire,
  unitExpense = VENDOR_RULES.gestor.baseDesp,
  managesUpTo = MANAGER_MANAGES_UP_TO,
  currentCash = 0,
  currentPlayer = null,
  allowBack = false,
}) {
  const closeRef = useRef(null)
  const inputRef = useRef(null)
  // âœ… CORREÃ‡ÃƒO: Usa onResolve que Ã© injetado pelo ModalContext
  const { pushModal, awaitTop } = useModal()
  useRegisterDecisionBuyer(currentPlayer)

  const [qty, setQty] = useState('')

  const priceHire = Number(unitHire || 0)
  const monthly   = Number(unitExpense || 0)
  const cashNow   = Number(currentCash || 0)

  const qtyNum = useMemo(() => {
    const n = Math.floor(Number(qty))
    return Number.isFinite(n) && n > 0 ? n : 0
  }, [qty])

  const maxQtyByCash = useMemo(() => {
    if (priceHire <= 0) return 0
    return Math.max(0, Math.floor(cashNow / priceHire))
  }, [cashNow, priceHire])

  const totalHire    = qtyNum * priceHire
  const totalExpense = qtyNum * monthly
  const canBuy       = qtyNum > 0

  const purchaseImpact = useMemo(() => {
    const playerSnapshot = currentPlayer || { cash: cashNow }
    const draftPayload = {
      qty: qtyNum,
      headcount: qtyNum,
      managersQty: qtyNum,
      cost: totalHire,
      total: totalHire,
      totalHire,
      totalExpense,
      cashDelta: -totalHire,
      expenseDelta: totalExpense,
    }
    const deltas = buildManagerPurchaseDeltas(draftPayload)
    return previewPurchaseImpact({
      player: playerSnapshot,
      deltas,
      immediateCost: totalHire,
    })
  }, [currentPlayer, cashNow, qtyNum, totalHire, totalExpense])

  const money = (n) => `$ ${Number(n || 0).toLocaleString()}`
  const expenseAt = (certs) => VENDOR_RULES.gestor.baseDesp + VENDOR_RULES.gestor.incDesp * Math.max(0, certs)
  const boostAt = (certs) => {
    return managerBoostPct(certs) * 100
  }

  const setBoundedQty = (val) => {
    const n = Math.floor(Number(val) || 0)
    const bounded = Math.max(0, Math.min(n, 1_000_000))
    setQty(String(bounded))
  }

  // âœ… CORREÃ‡ÃƒO: Usa onResolve diretamente (injetado pelo ModalContext)
  const handleClose = (e) => {
    e?.preventDefault?.()
    e?.stopPropagation?.()
    onResolve?.({ action: 'SKIP' })
  }
  const handleBack = (e) => { e?.preventDefault?.(); e?.stopPropagation?.(); onResolve?.({ action:'BACK' }) }

  const handleBuy = async () => {
    if (!canBuy) return
    if (cashNow < totalHire) {
      pushModal(
        <InsufficientFundsModal
          requiredAmount={totalHire}
          currentCash={cashNow}
          title="Saldo insuficiente para contratar Gestores"
          message="Você não possui saldo suficiente para concluir esta contratação."
          okLabel="Entendi"
        />
      )
      await awaitTop()
      return
    }

    // âœ… CORREÃ‡ÃƒO: Usa onResolve diretamente
    onResolve?.({
      action: 'BUY',
      role: 'MANAGER',
      qty: qtyNum,
      headcount: qtyNum,            // compat extra
      gestoresDelta: qtyNum,        // <- faz o painel somar Gestores

      unitHire: priceHire,
      unitExpense: monthly,

      totalHire,
      totalExpense,

      // compat com fluxos que leem 'cost'/'total'
      cost: totalHire,
      total: totalHire,

      // deltas explÃ­citos para o painel:
      cashDelta: -totalHire,
      expenseDelta: totalExpense,

      // dica opcional p/ HUD
      hudUpdate: { category: 'Gestores Comerciais', addQty: qtyNum },
    })
  }

  // UX: trava scroll, foca, Enter confirma
  useEffect(() => {
    const prev = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    const t1 = setTimeout(() => closeRef.current?.focus?.(), 0)
    const t2 = setTimeout(() => inputRef.current?.focus?.(), 60)

    const onKeyDown = (e) => {
      if (e.key === 'Enter') {
        e.preventDefault()
        handleBuy()
      }
    }
    window.addEventListener('keydown', onKeyDown)

    return () => {
      document.body.style.overflow = prev
      window.removeEventListener('keydown', onKeyDown)
      clearTimeout(t1); clearTimeout(t2)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  return (
    <TileModalShell
      title="Gestor Comercial"
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
            title={!canBuy ? 'Informe uma quantidade válida' : (cashNow < totalHire ? 'Saldo insuficiente' : undefined)}
          >
            {canBuy ? `Contratar por ${money(totalHire)}` : 'Contratar'}
          </button>
        </>
      )}
    >
      <TileContextHint kind="MANAGER" />

      <div className="tileWarn" role="note">
        <div style={{ fontWeight: 800, marginBottom: 6 }}>
          Atenção: sem certificado, o Gestor Comercial não aumenta o faturamento da equipe.
        </div>
        <div>Bônus atual: <b>{boostAt(0)}%</b></div>
        <div>Treine/certifique o Gestor para ativar a potencialização.</div>
      </div>

      <p className="purchasePreviewHint">
        O Gestor aumenta despesas mensais e não aumenta a capacidade de atendimento.
        Base para cálculo de despesa: × quantidade de Gestores. Cada Gestor gerencia
        até {managesUpTo} colaboradores. Detalhes por certificação nos cards abaixo.
      </p>

      <div className="tileQtyCost">
        <div className="tileStatBlock">
          <div className="tileStatLabel">Quantidade de gestores</div>
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
              aria-label="Quantidade de Gestores"
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
          <div className="tileStatLabel">Custo por gestor</div>
          <div className="tileStatValue">{money(unitHire)}</div>
          <div className="tileStatHint">Pagamento único · saldo {money(cashNow)}</div>
          <div className="tileStatHint">Despesa mensal: <b>{money(unitExpense)}</b></div>
        </div>
      </div>

      <div className="tileSectionTitle">Certificações disponíveis</div>
      <div className="tileCertGrid tileCertGrid--4">
        <article className="tileCertCard">
          <h3 className="tileCertName">Sem Certificado</h3>
          <p>Contratação {money(unitHire)}</p>
          <p>Despesa {money(expenseAt(0))}</p>
          <p>bônus da equipe: {boostAt(0)}%</p>
        </article>
        <article className="tileCertCard">
          <h3 className="tileCertName">Com 1 certificado</h3>
          <p>Despesa {money(expenseAt(1))}</p>
          <p>potencializa colaboradores em {boostAt(1)}%</p>
        </article>
        <article className="tileCertCard">
          <h3 className="tileCertName">Com 2 certificados</h3>
          <p>Despesa {money(expenseAt(2))}</p>
          <p>potencializa colaboradores em {boostAt(2)}%</p>
        </article>
        <article className="tileCertCard">
          <h3 className="tileCertName">Com 3 certificados</h3>
          <p>Despesa {money(expenseAt(3))}</p>
          <p>potencializa colaboradores em {boostAt(3)}%</p>
        </article>
      </div>

      <PurchaseImpactPreview impact={purchaseImpact} />
    </TileModalShell>
  )
}
