// src/modals/InsideSalesModal.jsx
import React, { useEffect, useMemo, useRef, useState } from 'react'
import { useModal } from './ModalContext'
import InsufficientFundsModal from './InsufficientFundsModal'
import PurchaseImpactPreview from '../components/PurchaseImpactPreview.jsx'
import { CERT_EFFECTS, VENDOR_RULES, certDeltaForVendor } from '../game/gameRules'
import { buildInsideSalesPurchaseDeltas } from '../game/insideSalesPurchase.js'
import { previewPurchaseImpact } from '../game/purchasePreview.js'
import TileContextHint from './TileContextHint.jsx'
import TileModalShell from './TileModalShell.jsx'

/**
 * onResolve(payload)
 *  - { action:'BUY',
 *      qty:number,
 *      headcount:number,
 *      unitHire:number,
 *      total:number,
 *      cost:number,
 *      totalCost:number,
 *      baseExpense:number,
 *      baseRevenue:number }
 *  - { action:'SKIP' }
 *
 * Props:
 *  - currentCash?: number (saldo atual do jogador)
 *  - currentPlayer?: object (snapshot somente leitura para preview)
 */
export default function InsideSalesModal({ onResolve, currentCash = 0, currentPlayer = null, allowBack = false }) {
  const closeRef = useRef(null)
  const [qty, setQty] = useState('')
  const { pushModal, awaitTop } = useModal()

  // Valores base (conforme regra centralizada; contratação é CAPEX e não faz parte do gameMath)
  const unitHire = VENDOR_RULES.inside.hire
  const baseExpense = VENDOR_RULES.inside.baseDesp
  const baseRevenue = VENDOR_RULES.inside.baseFat
  const attendsUpTo = VENDOR_RULES.inside.cap

  const money = (n) => `$ ${Number(n || 0).toLocaleString()}`
  const expenseAt = (certs) => VENDOR_RULES.inside.baseDesp + VENDOR_RULES.inside.incDesp * Math.max(0, certs)
  const revenueAt = (certs) => VENDOR_RULES.inside.baseFat + VENDOR_RULES.inside.incFat * Math.max(0, certs)
  const certCards = [
    { id: 'personalizado', title: 'Azul', bg: '#1d4ed8', pill: 'AZUL' },
    { id: 'fieldsales', title: 'Amarelo', bg: '#f1c40f', pill: 'AMARELO', dark: true },
    { id: 'imersaomultiplier', title: 'Roxo', bg: '#8b5cf6', pill: 'ROXO', dark: true },
  ].map((card) => {
    const d = certDeltaForVendor('inside', card.id)
    const fx = CERT_EFFECTS[card.id]
    return {
      ...card,
      lines: [
        `${Math.round((fx?.multFat || 0) * 100)}% fat · ${Math.round((fx?.multDesp || 0) * 100)}% desp`,
        d.desp === 0 ? 'Despesa: +$ 0' : `Despesa: +${money(d.desp)}`,
        `Faturamento: +${money(d.fat)} / cliente-cap`,
      ],
    }
  })

  const qtyNum = useMemo(() => {
    const n = Number(qty)
    return Number.isFinite(n) && n > 0 ? Math.floor(n) : 0
  }, [qty])

  const totalCost = qtyNum * unitHire
  const canBuy = qtyNum > 0

  // Máximo por saldo (apenas ajuda visual/atalhos)
  const maxBySaldo = Math.max(0, Math.floor(Number(currentCash || 0) / unitHire))

  const purchaseImpact = useMemo(() => {
    const playerSnapshot = currentPlayer || { cash: Number(currentCash || 0) }
    const draftPayload = {
      action: 'BUY',
      qty: qtyNum,
      headcount: qtyNum,
      unitHire,
      total: totalCost,
      cost: totalCost,
      totalCost,
      baseExpense,
      baseRevenue,
    }
    const deltas = buildInsideSalesPurchaseDeltas(draftPayload)
    return previewPurchaseImpact({
      player: playerSnapshot,
      deltas,
      immediateCost: totalCost,
    })
  }, [currentPlayer, currentCash, qtyNum, unitHire, totalCost, baseExpense, baseRevenue])

  const handleClose = (e) => {
    e?.preventDefault?.()
    e?.stopPropagation?.()
    onResolve?.({ action: 'SKIP' })
  }
  const handleBack = (e) => { e?.preventDefault?.(); e?.stopPropagation?.(); onResolve?.({ action:'BACK' }) }

  const bump = (n) => {
    const cur = Number(qty) || 0
    const next = Math.max(0, Math.min(maxBySaldo || Infinity, cur + n))
    setQty(next || '')
  }
  const setMax = () => setQty(maxBySaldo || '')

  const handleBuy = async () => {
    if (!canBuy) return

    const cash = Number(currentCash || 0)
    const need = Number(totalCost || 0)

    if (cash < need) {
      // Alerta de saldo insuficiente (mantém esta modal aberta)
      pushModal(
        <InsufficientFundsModal
          requiredAmount={need}
          currentCash={cash}
          title="Saldo insuficiente para contratar Inside Sales"
          message={`Você precisa de $ ${need.toLocaleString()} mas possui $ ${cash.toLocaleString()}.`}
          okLabel="Entendi"
        />
      )
      await awaitTop()
      return
    }

    onResolve?.({
      action: 'BUY',
      qty: qtyNum,
      headcount: qtyNum,
      unitHire,
      total: totalCost,
      cost: totalCost,
      totalCost,
      baseExpense,
      baseRevenue,
    })
  }

  // UX: trava scroll do body e foca no botão de fechar
  useEffect(() => {
    const prev = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    setTimeout(() => closeRef.current?.focus?.(), 0)
    return () => { document.body.style.overflow = prev }
  }, [])

  return (
    <TileModalShell
      title="Inside Sales"
      label="Inside Sales"
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
            title={!canBuy ? 'Informe uma quantidade válida' : undefined}
          >
            {canBuy ? `Contratar por ${money(totalCost)}` : 'Contratar'}
          </button>
        </>
      )}
    >
      <TileContextHint kind="INSIDE" />

      <p className="purchasePreviewHint">
        O Inside Sales aumenta a capacidade de atendimento em {attendsUpTo} clientes,
        gera faturamento pelas regras atuais da equipe e adiciona despesas mensais.
        Cada cor de certificado tem efeito financeiro diferente (não são equivalentes).
        Capacidade não muda com treinamento. Gestores certificados podem potencializar
        o faturamento dos vendedores.
      </p>

      <div className="tileBanner">
        <div style={{ fontWeight: 900, marginBottom: 4 }}>INSIDE SALES (SDR/BDR + CLOSER + CS)</div>
        <div><b>Base para cálculo despesa:</b> × quantidade <b>Canal representantes</b> ou <b>Inside Sales</b>.</div>
        <div><b>Base para cálculo faturamento:</b> × quantidade <b>máxima de clientes que cada vendedor pode atender</b>.</div>
      </div>

      <div className="tileQtyCost">
        <div className="tileStatBlock">
          <div className="tileStatLabel">Quantidade de representantes</div>
          <div className="tileStepper">
            <button
              type="button"
              className="tileStepperBtn"
              aria-label="Diminuir quantidade"
              disabled={qtyNum <= 0}
              onClick={() => bump(-1)}
            >
              −
            </button>
            <input
              type="number"
              inputMode="numeric"
              min={0}
              placeholder="0"
              value={qty}
              onChange={(e) => setQty(e.target.value)}
              aria-label="Quantidade de Inside Sales"
            />
            <button
              type="button"
              className="tileStepperBtn"
              aria-label="Aumentar quantidade"
              onClick={() => bump(1)}
            >
              +
            </button>
          </div>
          <div className="tileQuickBtns">
            <button type="button" className="tileModalBtn" onClick={() => bump(5)}>+5</button>
            <button type="button" className="tileModalBtn" onClick={() => bump(10)}>+10</button>
            <button type="button" className="tileModalBtn" onClick={setMax}>Máx</button>
          </div>
          <div className="tileStatHint">Máximo por saldo: <b>{maxBySaldo}</b></div>
        </div>
        <div className="tileStatBlock">
          <div className="tileStatLabel">Custo por representante</div>
          <div className="tileStatValue">{money(unitHire)}</div>
          <div className="tileStatHint">Pagamento único · saldo {money(currentCash)}</div>
          <div className="tileStatHint">Total contratar: <b>{money(totalCost)}</b></div>
        </div>
      </div>

      <div className="tileSectionTitle">Certificações disponíveis</div>
      <div className="tileBanner" style={{ marginBottom: 10 }}>
        <div className="tileCertMeta">
          <span className="tileCertPill tileCertPill--base">S/ certificado</span>
        </div>
        <div className="tileCertEffect">
          <div className="tileCertEffectRow"><span>Contratação</span><strong>$ {unitHire.toLocaleString()}</strong></div>
          <div className="tileCertEffectRow"><span>Despesa mensal</span><strong>{money(expenseAt(0))}</strong></div>
          <div className="tileCertEffectRow"><span>Faturamento mensal</span><strong>{money(revenueAt(0))}</strong></div>
        </div>
      </div>
      <div className="tileCertGrid">
        {certCards.map((card) => {
          const tone = card.id === 'personalizado' ? 'blue' : card.id === 'fieldsales' ? 'yellow' : 'purple'
          return (
            <article key={card.id} className="tileCertCard">
              <div className="tileCertMeta">
                <span className={`tileCertPill tileCertPill--${tone}`}>{card.pill}</span>
              </div>
              <h3 className="tileCertName">{card.title}</h3>
              <div className="tileCertEffect">
                {card.lines.map((ln, i) => (
                  <div key={i} className="tileCertEffectRow"><span>{ln}</span></div>
                ))}
              </div>
            </article>
          )
        })}
      </div>

      <PurchaseImpactPreview impact={purchaseImpact} />
    </TileModalShell>
  )
}
