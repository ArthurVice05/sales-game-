// src/modals/MixProductsModal.jsx
import React, { useEffect, useMemo, useRef, useState } from 'react'
import { useModal } from './ModalContext'
import InsufficientFundsModal from './InsufficientFundsModal'
import PurchaseImpactPreview from '../components/PurchaseImpactPreview.jsx'
import { MIX_RULES } from '../game/gameRules'
import { MIX_PURCHASE_PRICES } from '../game/manualConstants.js'
import { capacityAndAttendance } from '../game/gameMath'
import {
  buildMixPurchaseDeltas,
  calculateMixReturn,
} from '../game/productMixPurchase.js'
import { previewPurchaseImpact } from '../game/purchasePreview.js'
import { DEFAULT_MAX_ROUNDS, normalizeMaxRounds } from '../game/roundConfig'
import TileContextHint from './TileContextHint.jsx'
import TileModalShell from './TileModalShell.jsx'
import { useRegisterDecisionBuyer } from './decisionBuyerContext.jsx'

const LEVEL_RANK = { A: 4, B: 3, C: 2, D: 1 }

/**
 * Modal de escolha do Mix de Produtos (A/B/C/D)
 *
 * onResolve(payload):
 *  • { action:'BUY', level:'A'|'B'|'C'|'D', compra:number, despesa:number, faturamento:number, ... }
 *  • { action:'SKIP' }
 *
 * Props:
 *  - currentCash?: number (saldo atual do jogador; usado para validar compra)
 *  - currentLevel?: string (nível atual do Mix: 'A', 'B', 'C', 'D' ou null)
 *  - mixOwned?: object (níveis possuídos: { A:boolean, B:boolean, C:boolean, D:boolean })
 *  - currentPlayer?: object (snapshot somente leitura para preview)
 */
export default function MixProductsModal({
  onResolve,
  currentCash,
  currentLevel = null,
  mixOwned = null,
  allowBack = false,
  currentPlayer = null,
  horizonRounds = DEFAULT_MAX_ROUNDS,
}) {
  const closeRef = useRef(null)
  const { pushModal, awaitTop } = useModal()
  useRegisterDecisionBuyer(currentPlayer)
  const [selectedLevel, setSelectedLevel] = useState(null)

  // Mantém os mesmos valores do print/implementação anterior
  const LEVELS = {
    A: { compra: MIX_PURCHASE_PRICES.A, despesa: MIX_RULES.A.despPerClient, faturamento: MIX_RULES.A.fatPerClient, color:'#1d4ed8', pill:'NÍVEL A', label:'100 produtos' },
    B: { compra: MIX_PURCHASE_PRICES.B, despesa: MIX_RULES.B.despPerClient, faturamento: MIX_RULES.B.fatPerClient, color:'#16a34a', pill:'NÍVEL B', label:'50 produtos'  },
    C: { compra: MIX_PURCHASE_PRICES.C, despesa: MIX_RULES.C.despPerClient, faturamento: MIX_RULES.C.fatPerClient, color:'#f59e0b', pill:'NÍVEL C', label:'20 produtos'  },
    D: { compra: MIX_PURCHASE_PRICES.D, despesa: MIX_RULES.D.despPerClient, faturamento: MIX_RULES.D.fatPerClient, color:'#6b7280', pill:'NÍVEL D', label:'5 produtos'   },
  }

  const normLevel = (v) => { const L = String(v || '').toUpperCase(); return ['A', 'B', 'C', 'D'].includes(L) ? L : '' }
  const current = normLevel(currentLevel) || 'D'
  const cashNow = Number(currentCash != null ? currentCash : (currentPlayer?.cash ?? 0))

  const draftPayload = useMemo(() => {
    const desired = normLevel(selectedLevel)
    if (!desired || desired === current) return null
    const row = LEVELS[desired]
    if (!row) return null
    return { action: 'BUY', level: desired, ...row }
  }, [selectedLevel, current])

  const purchaseImpact = useMemo(() => {
    if (!draftPayload) return null
    const playerSnapshot = {
      ...(currentPlayer || {}),
      cash: cashNow,
      mixProdutos: current,
    }
    const deltas = buildMixPurchaseDeltas(draftPayload)
    return previewPurchaseImpact({
      player: playerSnapshot,
      deltas,
      immediateCost: draftPayload.compra,
    })
  }, [draftPayload, currentPlayer, cashNow, current])

  const safeHorizon = normalizeMaxRounds(horizonRounds, DEFAULT_MAX_ROUNDS)

  const mixReturn = useMemo(() => {
    if (!purchaseImpact) return null
    return calculateMixReturn({ impact: purchaseImpact, horizonRounds: safeHorizon })
  }, [purchaseImpact, safeHorizon])

  const portfolioStats = useMemo(() => {
    const playerSnapshot = {
      ...(currentPlayer || {}),
      cash: cashNow,
      mixProdutos: current,
    }
    const totalClients = Math.max(0, Number(playerSnapshot.clients || 0))
    const { cap, inAtt } = capacityAndAttendance(playerSnapshot)
    const capacity = Number(cap || 0)
    const attended = Number(inAtt || 0)
    const unattended = Math.max(0, totalClients - attended)
    return { totalClients, capacity, attended, unattended }
  }, [currentPlayer, cashNow, current])

  const isDowngrade = useMemo(() => {
    const desired = normLevel(selectedLevel)
    if (!desired) return false
    return (LEVEL_RANK[desired] || 0) < (LEVEL_RANK[current] || 0)
  }, [selectedLevel, current])

  const handleSelect = (level) => {
    const desired = normLevel(level)
    if (!desired) return
    if (desired === current) return
    setSelectedLevel(desired)
  }

  const handleConfirm = async () => {
    if (!draftPayload) return

    const need = Number(draftPayload.compra || 0)
    const cash = Number(cashNow)

    if (Number.isFinite(cash) && cash >= 0 && cash < need) {
      pushModal(
        <InsufficientFundsModal
          requiredAmount={need}
          currentCash={cash}
          title="Saldo insuficiente para adquirir o Mix de Produtos"
          message={`Você precisa de $ ${need.toLocaleString()} mas possui $ ${cash.toLocaleString()}.`}
          okLabel="Entendi"
        />
      )
      await awaitTop()
      return
    }

    onResolve?.(draftPayload)
  }

  function resolveSkip(){ onResolve?.({ action:'SKIP' }) }
  const handleBack = (e) => { e?.preventDefault?.(); e?.stopPropagation?.(); onResolve?.({ action:'BACK' }) }

  // UX: trava scroll e foca no X (ESC/backdrop não fecham)
  useEffect(() => {
    const prev = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    setTimeout(() => closeRef.current?.focus?.(), 0)
    return () => { document.body.style.overflow = prev }
  }, [])

  const formatMoneySigned = (n) => {
    const v = Number(n || 0)
    const abs = Math.abs(v).toLocaleString()
    if (v > 0) return `+ $ ${abs}`
    if (v < 0) return `- $ ${abs}`
    return `$ ${abs}`
  }

  const paybackLabel = (() => {
    if (!mixReturn) return null
    if (mixReturn.status === 'no_financial_return' || mixReturn.paybackRounds == null) {
      return 'Sem retorno financeiro estimado'
    }
    if (mixReturn.paybackRounds === 0) {
      return 'Retorno estimado: 0 rodadas'
    }
    const rounded = Math.ceil(mixReturn.paybackRounds * 10) / 10
    return `Retorno estimado: ${rounded} rodadas`
  })()

  return (
    <TileModalShell
      title="Mix de Produtos"
      label="Mix de Produtos"
      onClose={resolveSkip}
      closeRef={closeRef}
      footer={(
        <>
          {allowBack && (
            <button type="button" className="tileModalBtn tileModalBtn--ghost" onClick={handleBack}>
              Voltar
            </button>
          )}
          <button type="button" className="tileModalBtn tileModalBtn--ghost" onClick={resolveSkip}>
            Não comprar
          </button>
          <button
            type="button"
            className="tileModalBtn tileModalBtn--confirm"
            onClick={handleConfirm}
            disabled={!draftPayload}
            title={!draftPayload ? 'Selecione um nível diferente do atual' : `Confirmar compra do nível ${draftPayload.level}`}
          >
            {draftPayload ? `Confirmar compra ${draftPayload.level}` : 'Confirmar compra'}
          </button>
        </>
      )}
    >
      <TileContextHint kind="MIX" />

        <div style={S.note}>
          <div style={{fontWeight:900, marginBottom:4}}>MIX DE PRODUTOS</div>
          <div>Valores de despesa e faturamento nos cards são bases <b>por cliente</b>.</div>
        </div>

        <p className="purchasePreviewHint">
          O faturamento do Mix de Produtos é calculado sobre os clientes atendidos.
          As despesas são calculadas sobre todos os clientes da carteira.
          Se a capacidade for menor que a quantidade de clientes, parte da carteira pode
          gerar despesas sem gerar faturamento do Mix.
        </p>
        <p className="purchasePreviewHint">
          A compra não aumenta sua capacidade de atendimento. O valor investido sai do caixa
          e é registrado em bens. A troca de nível cobra o preço cheio, sem desconto pelo nível atual.
        </p>

        {Number.isFinite(Number(cashNow)) && (
          <div style={S.saldo}>Saldo disponível: <b>$ {Number(cashNow || 0).toLocaleString()}</b></div>
        )}

        {/* Cards (mesmo estilo da modal anterior) */}
        <div className="tileCertGrid tileCertGrid--4">
          {(['A','B','C','D']).map((k) => {
            const v = LEVELS[k]
            const isOwned = current === k  // ✅ apenas o atual
            const isDisabled = isOwned
            const isSelected = selectedLevel === k

            return (
              <article
                key={k}
                className={`tileCertCard tileOptionCard${isSelected ? ' is-selected' : ''}${isOwned ? ' is-owned' : ''}`}
              >
                <h3 className="tileCertName">{isOwned ? '✓ ADQUIRIDO' : v.pill}</h3>
                <p><b>{v.label}</b></p>
                <p>Compra: <b>$ {v.compra.toLocaleString()}</b></p>
                <p>Despesa: <b>$ {v.despesa.toLocaleString()}</b> / cliente</p>
                <p>Faturamento: <b>$ {v.faturamento.toLocaleString()}</b> / cliente atendido</p>
                <button
                  type="button"
                  className="tileModalBtn"
                  onClick={() => handleSelect(k)}
                  disabled={isDisabled}
                  title={isDisabled ? `Mix nível ${k} já adquirido` : `Selecionar Mix de Produtos ${k}`}
                >
                  {isDisabled ? 'Já Adquirido' : (isSelected ? `Selecionado ${k}` : `Selecionar ${k}`)}
                </button>
              </article>
            )
          })}
        </div>

        {purchaseImpact && (
          <>
            <PurchaseImpactPreview impact={purchaseImpact} />

            <div className="purchasePreviewExtra">
              <div className="purchasePreviewExtraTitle">Carteira e retorno (Mix)</div>

              <div className="purchasePreviewRow">
                <span>Total de clientes</span>
                <span>{portfolioStats.totalClients.toLocaleString()}</span>
              </div>
              <div className="purchasePreviewRow">
                <span>Clientes atendidos</span>
                <span>{portfolioStats.attended.toLocaleString()}</span>
              </div>
              <div className="purchasePreviewRow">
                <span>Clientes sem atendimento</span>
                <span>{portfolioStats.unattended.toLocaleString()}</span>
              </div>
              <div className="purchasePreviewRow">
                <span>Capacidade atual</span>
                <span>{portfolioStats.capacity.toLocaleString()}</span>
              </div>
              <div className="purchasePreviewRow">
                <span>CAPEX → bens</span>
                <span>$ {Number(draftPayload?.compra || 0).toLocaleString()} saem do caixa e entram em bens</span>
              </div>
              <div className="purchasePreviewRow">
                <span>Impacto líquido incremental por rodada</span>
                <span>{formatMoneySigned(mixReturn?.incrementalNet)}</span>
              </div>
              <div className="purchasePreviewRow purchasePreviewRowStrong">
                <span>{paybackLabel}</span>
              </div>

              {portfolioStats.attended === 0 && (
                <div className="purchasePreviewAlert">
                  Sem clientes atendidos, o Mix não gera faturamento neste momento.
                </div>
              )}
              {portfolioStats.totalClients > portfolioStats.attended && (
                <div className="purchasePreviewAlert">
                  Há clientes sem atendimento. As despesas do Mix consideram toda a carteira, mas o faturamento considera apenas os clientes atendidos.
                </div>
              )}
              {mixReturn && mixReturn.incrementalNet <= 0 && (
                <div className="purchasePreviewAlert">
                  A troca selecionada não melhora o resultado líquido mensal no estado atual da empresa.
                </div>
              )}
              {mixReturn && !mixReturn.paysBackWithinHorizon && mixReturn.status !== 'no_cost' && mixReturn.status !== 'no_financial_return' && (
                <div className="purchasePreviewAlert">
                  Este investimento não se recupera no horizonte atual de {safeHorizon} rodada(s).
                </div>
              )}
              {isDowngrade && (
                <div className="purchasePreviewAlert">
                  Você está selecionando um nível inferior. O jogo ainda cobra o preço cheio por essa troca.
                </div>
              )}
            </div>
          </>
        )}

    </TileModalShell>
  )
}

const S = {
  /* wrap, card, title e cards migraram para classes CSS responsivas
     (.mixWrap, .mixCard, .mixTitle, .mixCards em styles.css) */
  close: { position:'absolute', right:10, top:10, width:36, height:36, borderRadius:10, border:'1px solid rgba(255,255,255,.15)', background:'#2a2f3b', color:'#fff', cursor:'pointer' },

  note: {
    background:'#2a2f3b',
    border:'1px solid rgba(255,255,255,.15)',
    borderRadius:12,
    padding:'10px 12px',
    margin:'0 0 10px'
  },

  saldo:{ margin:'0 0 10px', padding:'8px 12px', border:'1px dashed rgba(255,255,255,.25)', borderRadius:10 },

  // --- Cards (igual padrão anterior; a grade migrou para .mixCards)
  cardItem:{ background:'#0f1320', border:'1px solid', borderRadius:14, padding:'12px', display:'flex', flexDirection:'column', gap:8 },
  cardBadge:{ width:'100%', height:6, borderRadius:999, opacity:.9 },
  pill:{ alignSelf:'flex-start', fontSize:12, fontWeight:900, padding:'4px 8px', borderRadius:999, color:'#111' },
  lines:{ margin:0, padding:'0 0 0 16px', lineHeight:1.35 },

  buyBtn:{ marginTop:'auto', padding:'10px 12px', borderRadius:10, border:'none', fontWeight:900, cursor:'pointer', background:'#2442f9', color:'#fff' },

  actions: { display:'flex', gap:12, justifyContent:'center', marginTop:14, flexWrap:'wrap' },
  /* min-width migrou para .mixBigBtn (largura total no mobile) */
  bigBtn: { padding:'14px 18px', borderRadius:12, border:'none', fontWeight:900, cursor:'pointer' },
}
