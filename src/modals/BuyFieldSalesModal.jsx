// src/modals/BuyFieldSalesModal.jsx
import React, { useEffect, useMemo, useRef, useState } from 'react'
import InsufficientFundsModal from './InsufficientFundsModal'
import { useModal } from './ModalContext'
import PurchaseImpactPreview from '../components/PurchaseImpactPreview.jsx'
import { CERT_EFFECTS, VENDOR_RULES, certDeltaForVendor } from '../game/gameRules'
import { buildFieldSalesPurchaseDeltas } from '../game/fieldSalesPurchase.js'
import { previewPurchaseImpact } from '../game/purchasePreview.js'
import TileContextHint from './TileContextHint.jsx'
import TileModalShell from './TileModalShell.jsx'

/**
 * Modal de compra de Field Sales (Representantes Comerciais)
 *
 * Props:
 *  - onResolve: function(payload)
 *      • { action:'BUY', qty, unitHire, unitExpense, totalHire, totalExpense,
 *          cashDelta, expenseDelta, revenueDelta, role:'FIELD', total, cost }
 *      • { action:'SKIP' }
 *  - unitHire?: number     (custo de contratação por vendedor — padrão VENDOR_RULES.field.hire)
 *  - unitExpense?: number  (despesa mensal por vendedor — padrão VENDOR_RULES.field.baseDesp)
 *  - attendsUpTo?: number  (qtd. clientes atendidos por vendedor — infográfico)
 *  - currentCash?: number  (saldo atual do jogador para validar compra)
 *  - currentPlayer?: object (snapshot somente leitura para preview)
 */
export default function BuyFieldSalesModal({
  onResolve,
  unitHire = VENDOR_RULES.field.hire,
  unitExpense = VENDOR_RULES.field.baseDesp,
  attendsUpTo = VENDOR_RULES.field.cap,
  currentCash = 0,
  currentPlayer = null,
  allowBack = false,
}) {
  const closeRef = useRef(null)
  const inputRef = useRef(null)
  const { pushModal, awaitTop } = useModal()

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

  const totalHire     = qtyNum * priceHire
  const totalExpense  = qtyNum * monthly
  const revenuePer    = VENDOR_RULES.field.baseFat // faturamento base “S/ certificado”
  const totalRevenue  = qtyNum * revenuePer
  const canBuy        = qtyNum > 0

  const purchaseImpact = useMemo(() => {
    const playerSnapshot = currentPlayer || { cash: cashNow }
    const draftPayload = {
      action: 'BUY',
      qty: qtyNum,
      unitHire: priceHire,
      unitExpense: monthly,
      totalHire,
      totalExpense,
      cashDelta: -totalHire,
      expenseDelta: totalExpense,
      revenueDelta: totalRevenue,
      cost: totalHire,
      total: totalHire,
      role: 'FIELD',
    }
    const deltas = buildFieldSalesPurchaseDeltas(draftPayload)
    return previewPurchaseImpact({
      player: playerSnapshot,
      deltas,
      immediateCost: totalHire,
    })
  }, [
    currentPlayer,
    cashNow,
    qtyNum,
    priceHire,
    monthly,
    totalHire,
    totalExpense,
    totalRevenue,
  ])

  const money = (n) => `$ ${Number(n || 0).toLocaleString()}`
  const baseExpense = VENDOR_RULES.field.baseDesp
  const baseRevenue = VENDOR_RULES.field.baseFat
  const certRows = [
    { id: 'personalizado', label: 'Azul (personalizado)' },
    { id: 'fieldsales', label: 'Amarelo (Field Sales Collab)' },
    { id: 'imersaomultiplier', label: 'Roxo (Imersões)' },
  ].map((row) => {
    const d = certDeltaForVendor('field', row.id)
    const fx = CERT_EFFECTS[row.id]
    return {
      ...row,
      expense: d.desp === 0 ? '+$ 0 despesa' : `+${money(d.desp)} despesa`,
      revenue: `+${money(d.fat)} fat / cliente-cap`,
      note: `${Math.round((fx?.multFat || 0) * 100)}% fat · ${Math.round((fx?.multDesp || 0) * 100)}% desp`,
    }
  })

  const setBoundedQty = (val) => {
    const n = Math.floor(Number(val) || 0)
    const bounded = Math.max(0, Math.min(n, 1_000_000))
    setQty(String(bounded))
  }

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
          title="Saldo insuficiente para contratar Field Sales"
          message="Você não possui saldo suficiente para concluir esta contratação."
          okLabel="Entendi"
        />
      )
      await awaitTop()
      return
    }

    onResolve?.({
      action: 'BUY',
      qty: qtyNum,
      unitHire: priceHire,
      unitExpense: monthly,
      totalHire,
      totalExpense,
      // deltas padronizados para o App.jsx
      cashDelta: -totalHire,
      expenseDelta: totalExpense,
      revenueDelta: totalRevenue,
      // compat legado:
      cost: totalHire,
      total: totalHire,
      role: 'FIELD',
    })
  }

  // UX: bloqueia o scroll do body; foca; Enter confirma
  useEffect(() => {
    const prev = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    const t1 = setTimeout(() => closeRef.current?.focus?.(), 0)
    const t2 = setTimeout(() => inputRef.current?.focus?.(), 50)

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
      title="Field Sales"
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
      <TileContextHint kind="FIELD" />

      <p className="purchasePreviewHint">
        O Field Sales aumenta a capacidade de atendimento em {attendsUpTo} clientes,
        gera faturamento e adiciona uma despesa mensal. Cada cor de certificado tem
        efeito financeiro diferente. Gestores certificados podem potencializar o
        faturamento dos vendedores. Base de despesa: × quantidade de Field Sales.
        Base de faturamento: × quantidade máxima de clientes que cada vendedor pode
        atender. Cada vendedor atende até {attendsUpTo} clientes. Efeitos de cor
        acumulam; capacidade não muda.
      </p>

      <div className="tileQtyCost">
        <div className="tileStatBlock">
          <div className="tileStatLabel">Quantidade de representantes</div>
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
              aria-label="Quantidade de Field Sales"
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
          <div className="tileStatLabel">Custo por representante</div>
          <div className="tileStatValue">{money(unitHire)}</div>
          <div className="tileStatHint">Pagamento único · saldo {money(cashNow)}</div>
          <div className="tileStatHint">Despesa mensal: <b>{money(unitExpense)}</b></div>
        </div>
      </div>

      <div className="tileSectionTitle">Certificações disponíveis</div>
      <div className="tileBanner" style={{ marginBottom: 10 }}>
        <div className="tileCertMeta">
          <span className="tileCertPill tileCertPill--base">S/ certificado</span>
          <span>base</span>
        </div>
        <div className="tileCertEffect">
          <div className="tileCertEffectRow"><span>Despesa mensal</span><strong>{money(baseExpense)}</strong></div>
          <div className="tileCertEffectRow"><span>Faturamento mensal</span><strong>{money(baseRevenue)} / cliente-cap</strong></div>
        </div>
      </div>
      <div className="tileCertGrid">
        {certRows.map((row) => {
          const tone = row.id === 'personalizado' ? 'blue' : row.id === 'fieldsales' ? 'yellow' : 'purple'
          return (
            <article key={row.id} className="tileCertCard">
              <div className="tileCertMeta">
                <span className={`tileCertPill tileCertPill--${tone}`}>{row.label.split(' ')[0]}</span>
              </div>
              <h3 className="tileCertName">{row.label}</h3>
              <p>{row.note}</p>
              <div className="tileCertEffect">
                <div className="tileCertEffectRow"><span>Despesa mensal</span><strong>{row.expense}</strong></div>
                <div className="tileCertEffectRow"><span>Faturamento mensal</span><strong>{row.revenue}</strong></div>
              </div>
            </article>
          )
        })}
      </div>

      <PurchaseImpactPreview impact={purchaseImpact} />
    </TileModalShell>
  )
}
