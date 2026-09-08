// src/modals/BuyCommonSellersModal.jsx
import React, { useEffect, useMemo, useRef, useState } from 'react'
import InsufficientFundsModal from './InsufficientFundsModal'
import { useModal } from './ModalContext'
import PurchaseImpactPreview from '../components/PurchaseImpactPreview.jsx'
import { CERT_EFFECTS, VENDOR_RULES, certDeltaForVendor } from '../game/gameRules'
import { MANUAL_CONSTANTS } from '../game/manualConstants.js'
import { buildCommonSellersPurchaseDeltas } from '../game/commonSellersPurchase.js'
import { previewPurchaseImpact } from '../game/purchasePreview.js'
import TileContextHint from './TileContextHint.jsx'
import TileModalShell from './TileModalShell.jsx'

/**
 * Modal de compra de Vendedores Comuns (faz tudo)
 *
 * Resolve com:
 *  â€¢ { action:'BUY',
 *      role:'COMMON',
 *      qty:number, headcount:number,
 *      unitHire:number, unitExpense:number,
 *      totalHire:number, totalExpense:number,
 *      // compat extras
 *      total:number, cost:number,
 *      // >>> deltas p/ painel e saldo:
 *      cashDelta:number,        // negativo (debita contrataÃ§Ã£o)
 *      expenseDelta:number,     // positivo (despesa mensal total)
 *      revenueDelta:number,     // positivo (receita mensal base)
 *      revenuePerSeller:number, // 600
 *      attendsUpTo:number,
 *      hudUpdate:{ category:'Vendedores Comuns', addQty:number }
 *    }
 *  â€¢ { action:'SKIP' }
 *  - currentCash?: number
 *  - currentPlayer?: object (snapshot somente leitura para preview)
 */
export default function BuyCommonSellersModal({
  onResolve,
  unitHire = MANUAL_CONSTANTS.commonHire,
  unitExpense = VENDOR_RULES.comum.baseDesp,
  attendsUpTo = VENDOR_RULES.comum.cap,
  currentCash = 0,
  currentPlayer = null,
  allowBack = false,
}) {
  const [qty, setQty] = useState('')
  const closeRef = useRef(null)
  const inputRef = useRef(null)

  // âœ… CORREÃ‡ÃƒO: Usa onResolve que Ã© injetado pelo ModalContext
  const { pushModal, awaitTop } = useModal()

  const priceHire = Number(unitHire || 0)
  const monthly   = Number(unitExpense || 0)
  const cashNow   = Number(currentCash || 0)

  // Receita base por vendedor (S/ Certificado) conforme regra centralizada
  const revenuePerSeller = VENDOR_RULES.comum.baseFat

  const money = (n) => `$ ${Number(n || 0).toLocaleString()}`
  const baseExpense = VENDOR_RULES.comum.baseDesp
  const baseRevenue = VENDOR_RULES.comum.baseFat
  const certRows = [
    { id: 'personalizado', label: 'Azul (personalizado)' },
    { id: 'fieldsales', label: 'Amarelo (Field Sales Collab)' },
    { id: 'imersaomultiplier', label: 'Roxo (Imersões)' },
  ].map((row) => {
    const d = certDeltaForVendor('comum', row.id)
    const fx = CERT_EFFECTS[row.id]
    return {
      ...row,
      expense: d.desp === 0 ? '+$ 0 despesa' : `+${money(d.desp)} despesa`,
      revenue: `+${money(d.fat)} fat / cliente-cap`,
      note: `${Math.round((fx?.multFat || 0) * 100)}% fat · ${Math.round((fx?.multDesp || 0) * 100)}% desp`,
    }
  })

  const qtyNum = useMemo(() => {
    const n = Math.floor(Number(qty))
    return Number.isFinite(n) && n > 0 ? n : 0
  }, [qty])

  const maxQtyByCash = useMemo(() => {
    if (priceHire <= 0) return 0
    return Math.max(0, Math.floor(cashNow / priceHire))
  }, [cashNow, priceHire])

  const totalHire    = useMemo(() => qtyNum * priceHire, [qtyNum, priceHire])
  const totalExpense = useMemo(() => qtyNum * monthly,   [qtyNum, monthly])

  const canBuy = qtyNum > 0

  const purchaseImpact = useMemo(() => {
    const playerSnapshot = currentPlayer || { cash: cashNow }
    const draftPayload = {
      action: 'BUY',
      role: 'COMMON',
      qty: qtyNum,
      headcount: qtyNum,
      unitHire: priceHire,
      unitExpense: monthly,
      totalHire,
      totalExpense,
      total: totalHire,
      cost: totalHire,
      attendsUpTo,
      cashDelta: -totalHire,
      expenseDelta: totalExpense,
      revenueDelta: revenuePerSeller * qtyNum,
      revenuePerSeller,
      hudUpdate: { category: 'Vendedores Comuns', addQty: qtyNum },
    }
    const deltas = buildCommonSellersPurchaseDeltas(draftPayload)
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
    attendsUpTo,
    revenuePerSeller,
  ])

  const setBoundedQty = (val) => {
    const n = Math.floor(Number(val) || 0)
    const bounded = Math.max(0, Math.min(n, 1_000_000))
    setQty(String(bounded))
  }

  // âœ… CORREÃ‡ÃƒO: Usa onResolve diretamente (injetado pelo ModalContext)
  const handleClose = (ev) => {
    ev?.stopPropagation?.()
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
          title="Saldo insuficiente para contratar vendedores"
          message="Você não possui saldo suficiente para concluir esta contratação."
          okLabel="Entendi"
        />
      )
      await awaitTop()
      return
    }

    const payload = {
      action: 'BUY',
      role: 'COMMON',

      // quantidade
      qty: qtyNum,
      headcount: qtyNum,              // compat extra

      // custos/unidades
      unitHire: priceHire,
      unitExpense: monthly,

      // totais
      totalHire,
      totalExpense,

      // compat extras (alguns fluxos leem 'total' / 'cost')
      total: totalHire,
      cost:  totalHire,

      attendsUpTo,

      // >>> DELTAS para o painel/saldo:
      cashDelta: -totalHire,
      expenseDelta: totalExpense,
      revenueDelta: revenuePerSeller * qtyNum,
      revenuePerSeller,

      // dica para HUD/contador
      hudUpdate: { category: 'Vendedores Comuns', addQty: qtyNum },
    }

    // âœ… CORREÃ‡ÃƒO: Usa onResolve diretamente
    onResolve?.(payload)
  }

  // UX: bloqueia scroll, foca no X e no input; Enter confirma
  useEffect(() => {
    const prevOverflow = document.body.style.overflow
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
      document.body.style.overflow = prevOverflow
      window.removeEventListener('keydown', onKeyDown)
      clearTimeout(t1); clearTimeout(t2)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  return (
    <TileModalShell
      title="Vendedor Comum"
      label="Comprar Vendedores Comuns"
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
            disabled={!canBuy}
            onClick={handleBuy}
            title={!canBuy ? 'Informe uma quantidade válida' : (cashNow < totalHire ? 'Saldo insuficiente' : undefined)}
          >
            {canBuy ? `Contratar por ${money(totalHire)}` : 'Contratar'}
          </button>
        </>
      )}
    >
      <TileContextHint kind="COMMON" />

      <p className="purchasePreviewHint">
        O Vendedor Comum aumenta a capacidade de atendimento em {attendsUpTo} clientes, gera
        faturamento e adiciona uma despesa mensal. Treinamentos podem aumentar seu
        faturamento e suas despesas. Gestores certificados podem potencializar o
        faturamento dos vendedores. Base de despesa: × quantidade vendedor comum.
        Base de faturamento: × quantidade máxima de clientes que cada vendedor pode
        atender. Atende até {attendsUpTo} clientes.
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
              aria-label="Quantidade de Vendedores Comuns"
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
        </div>
        <div className="tileCertEffect">
          <div className="tileCertEffectRow"><span>Contratação</span><strong>{money(unitHire)}</strong></div>
          <div className="tileCertEffectRow"><span>Despesa mensal</span><strong>{money(baseExpense)}</strong></div>
          <div className="tileCertEffectRow"><span>Faturamento mensal</span><strong>{money(baseRevenue)}</strong></div>
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
