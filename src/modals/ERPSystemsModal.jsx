// src/modals/ERPSystemsModal.jsx
import React, { useEffect, useMemo, useRef, useState } from 'react'
import { useModal } from './ModalContext'
import InsufficientFundsModal from './InsufficientFundsModal'
import PurchaseImpactPreview from '../components/PurchaseImpactPreview.jsx'
import {
  buildErpPurchaseDeltas,
  calculateErpReturn,
  countErpCollaborators,
  getErpLevelView,
} from '../game/erpPurchase.js'
import { previewPurchaseImpact } from '../game/purchasePreview.js'
import { DEFAULT_MAX_ROUNDS, normalizeMaxRounds } from '../game/roundConfig'
import TileContextHint from './TileContextHint.jsx'
import TileModalShell from './TileModalShell.jsx'
import { useRegisterDecisionBuyer } from './decisionBuyerContext.jsx'
import './training-erp-modals.css'

const LEVEL_META = {
  A: { color: '#1d4ed8', pill: 'NÍVEL A' },
  B: { color: '#16a34a', pill: 'NÍVEL B' },
  C: { color: '#f59e0b', pill: 'NÍVEL C' },
  D: { color: '#6b7280', pill: 'NÍVEL D' },
}

function levelView(k) {
  const rule = getErpLevelView(k)
  const meta = LEVEL_META[k] || {}
  if (!rule) return null
  return {
    ...rule,
    color: meta.color,
    pill: meta.pill,
  }
}

/**
 * onResolve(payload)
 *  - {action:'BUY', level:'A'|'B'|'C'|'D', values:{...}}
 *  - {action:'SKIP'}
 */
export default function ERPSystemsModal({
  onResolve,
  currentCash = 0,
  currentLevel = null,
  erpOwned = null,
  allowBack = false,
  currentPlayer = null,
  horizonRounds = DEFAULT_MAX_ROUNDS,
}) {
  const closeRef = useRef(null)
  const { pushModal, awaitTop } = useModal()
  useRegisterDecisionBuyer(currentPlayer)
  const [selectedLevel, setSelectedLevel] = useState(null)

  const normLevel = (v) => {
    const L = String(v || '').toUpperCase()
    return ['A', 'B', 'C', 'D'].includes(L) ? L : ''
  }
  const current = normLevel(currentLevel) || 'D'
  const cashNow = Number(currentCash || 0)
  const staffCount = countErpCollaborators(currentPlayer || { cash: cashNow })

  const LEVELS = useMemo(() => ({
    A: levelView('A'),
    B: levelView('B'),
    C: levelView('C'),
    D: levelView('D'),
  }), [])

  const draftPayload = useMemo(() => {
    const desired = normLevel(selectedLevel)
    if (!desired || desired === current) return null
    const values = LEVELS[desired]
    if (!values) return null
    return { action: 'BUY', level: desired, values }
  }, [selectedLevel, current, LEVELS])

  const purchaseImpact = useMemo(() => {
    if (!draftPayload) return null
    const playerSnapshot = {
      ...(currentPlayer || {}),
      cash: cashNow,
      erpLevel: current,
    }
    const deltas = buildErpPurchaseDeltas(draftPayload)
    return previewPurchaseImpact({
      player: playerSnapshot,
      deltas,
      immediateCost: draftPayload.values.compra,
    })
  }, [draftPayload, currentPlayer, cashNow, current])

  const safeHorizon = normalizeMaxRounds(horizonRounds, DEFAULT_MAX_ROUNDS)

  const erpReturn = useMemo(() => {
    if (!purchaseImpact) return null
    return calculateErpReturn({
      impact: purchaseImpact,
      horizonRounds: safeHorizon,
      staffCount,
    })
  }, [purchaseImpact, safeHorizon, staffCount])

  const handleClose = (e) => {
    e?.preventDefault?.()
    e?.stopPropagation?.()
    onResolve?.({ action: 'SKIP' })
  }
  const handleBack = (e) => {
    e?.preventDefault?.()
    e?.stopPropagation?.()
    onResolve?.({ action: 'BACK' })
  }

  const handleSelect = (level) => {
    const desired = normLevel(level)
    if (!desired) return
    if (desired === current) return
    setSelectedLevel(desired)
  }

  const handleBuy = async () => {
    if (!draftPayload) return

    const desired = draftPayload.level
    const values = draftPayload.values
    const need = Number(values?.compra || 0)

    if (cashNow < need) {
      pushModal(
        <InsufficientFundsModal
          requiredAmount={need}
          currentCash={cashNow}
          title="Saldo insuficiente para comprar ERP"
          message={`Você precisa de $ ${need.toLocaleString()} para o ERP nível ${desired}, mas possui $ ${cashNow.toLocaleString()}.`}
          okLabel="Entendi"
        />
      )
      await awaitTop()
      return
    }
    onResolve?.({ action: 'BUY', level: desired, values })
  }

  useEffect(() => {
    const prevOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    setTimeout(() => closeRef.current?.focus?.(), 0)
    return () => { document.body.style.overflow = prevOverflow }
  }, [])

  const formatMoneySigned = (n) => {
    const v = Number(n || 0)
    const abs = Math.abs(v).toLocaleString()
    if (v > 0) return `+ $ ${abs}`
    if (v < 0) return `- $ ${abs}`
    return `$ ${abs}`
  }

  const paybackLabel = (() => {
    if (!erpReturn) return null
    if (erpReturn.status === 'no_financial_return' || erpReturn.paybackRounds == null) {
      return 'Sem retorno financeiro estimado (ganho líquido ≤ 0)'
    }
    if (erpReturn.paybackRounds === 0) {
      return 'Retorno estimado: 0 ciclos'
    }
    const rounded = Math.ceil(erpReturn.paybackRounds * 10) / 10
    return `Retorno estimado: ~${rounded} ciclos`
  })()

  return (
    <TileModalShell
      title="ERP / Sistemas"
      label="ERP/Sistemas"
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
            disabled={!draftPayload}
            title={!draftPayload ? 'Selecione um nível diferente do atual' : `Confirmar compra do nível ${draftPayload.level}`}
          >
            {draftPayload ? `Confirmar compra ${draftPayload.level}` : 'Confirmar compra'}
          </button>
        </>
      )}
    >
      <TileContextHint kind="ERP" />

      <p className="purchasePreviewHint">
        O ERP gera faturamento e despesas por colaborador da equipe comercial.
        O benefício cresce com o tamanho da equipe (vendedores e gestores) e não escala
        com a quantidade de clientes — o Mix de Produtos já cobre essa parte.
        Avalie o ganho líquido por ciclo e o tempo estimado para recuperar o investimento.
      </p>

      <div className="erpSupportRow">
        <div className="erpSupportItem">
          <span className="erpSupportLabel">Saldo disponível</span>
          <div className="erpSupportValue">$ {cashNow.toLocaleString()}</div>
        </div>
        <div className="erpSupportItem">
          <span className="erpSupportLabel">Equipe atual</span>
          <div className="erpSupportValue">
            {staffCount} colaborador{staffCount === 1 ? '' : 'es'}
          </div>
        </div>
      </div>

      <div className="erpCompare" role="region" aria-label="Comparativo de níveis ERP">
        <table className="erpCompareTable">
          <thead>
            <tr>
              <th className="erpCompareMetricHead">Métrica</th>
              {(['A', 'B', 'C', 'D']).map((k) => (
                <th
                  key={k}
                  className={`${selectedLevel === k ? 'is-selected' : ''} ${current === k ? 'is-current' : ''}`.trim()}
                >
                  Nível {k}
                  {current === k ? ' · atual' : ''}
                  {selectedLevel === k ? ' · sel.' : ''}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            <ErpCompareRow
              label="Compra (única)"
              values={{ A: LEVELS.A.compra, B: LEVELS.B.compra, C: LEVELS.C.compra, D: LEVELS.D.compra }}
              current={current}
              selected={selectedLevel}
            />
            <ErpCompareRow
              label="Despesa / colaborador"
              values={{ A: LEVELS.A.despesa, B: LEVELS.B.despesa, C: LEVELS.C.despesa, D: LEVELS.D.despesa }}
              current={current}
              selected={selectedLevel}
            />
            <ErpCompareRow
              label="Faturamento / colaborador"
              values={{ A: LEVELS.A.faturamento, B: LEVELS.B.faturamento, C: LEVELS.C.faturamento, D: LEVELS.D.faturamento }}
              current={current}
              selected={selectedLevel}
            />
          </tbody>
        </table>
      </div>

      <div className="erpMobileBlocks" aria-label="Comparativo ERP por métrica">
        {[
          { key: 'compra', title: 'Compra (única)', pick: (v) => v.compra },
          { key: 'despesa', title: 'Despesa / colaborador', pick: (v) => v.despesa },
          { key: 'fat', title: 'Faturamento / colaborador', pick: (v) => v.faturamento },
        ].map((block) => (
          <div key={block.key} className="erpMobileBlock">
            <div className="erpMobileBlockTitle">{block.title}</div>
            {(['A', 'B', 'C', 'D']).map((k) => (
              <div
                key={k}
                className={`erpMobileBlockRow${current === k ? ' is-current' : ''}${selectedLevel === k ? ' is-selected' : ''}`}
              >
                <span>Nível {k}{current === k ? ' (atual)' : ''}{selectedLevel === k ? ' (selecionado)' : ''}</span>
                <b>$ {Number(block.pick(LEVELS[k])).toLocaleString()}</b>
              </div>
            ))}
          </div>
        ))}
      </div>

      <p className="erpCompareNote">
        Despesa e faturamento são <b>recorrentes por colaborador</b>.
        A compra é <b>pagamento único</b>. Upgrade cobra o preço cheio do nível escolhido.
      </p>

      <div className="erpLevelGrid">
        {(['A', 'B', 'C', 'D']).map((k) => {
          const v = LEVELS[k]
          const isOwned = current === k
          const isDisabled = isOwned
          const isSelected = selectedLevel === k

          return (
            <article
              key={k}
              className={`erpLevelCard${isSelected ? ' is-selected' : ''}${isOwned ? ' is-owned is-current' : ''}`}
            >
              <span className="erpLevelBadge" style={{ background: v.color }}>{v.pill}</span>
              <span className="erpLevelStatus">
                {isOwned ? 'Nível atual · adquirido' : (isSelected ? 'Selecionado' : 'Disponível')}
              </span>
              <div className="erpLevelPrice">$ {v.compra.toLocaleString()}</div>
              <p className="erpLevelMeta">Despesa: $ {v.despesa.toLocaleString()} / colab.</p>
              <p className="erpLevelMeta">Faturamento: $ {v.faturamento.toLocaleString()} / colab.</p>
              <button
                type="button"
                className="tileModalBtn"
                onClick={() => handleSelect(k)}
                disabled={isDisabled}
                title={isDisabled ? `ERP nível ${k} já adquirido` : `Selecionar ERP nível ${k}`}
              >
                {isDisabled ? 'Já adquirido' : (isSelected ? `Selecionado ${k}` : `Selecionar ${k}`)}
              </button>
            </article>
          )
        })}
      </div>

      {purchaseImpact && erpReturn && (
        <>
          <PurchaseImpactPreview impact={purchaseImpact} />

          <div className="purchasePreviewExtra">
            <div className="purchasePreviewExtraTitle">Retorno do investimento (ERP)</div>
            <div className="purchasePreviewRow">
              <span>Investimento</span>
              <span>$ {Number(erpReturn.immediateCost || 0).toLocaleString()}</span>
            </div>
            <div className="purchasePreviewRow">
              <span>Equipe atual</span>
              <span>{staffCount} colaborador{staffCount === 1 ? '' : 'es'}</span>
            </div>
            <div className="purchasePreviewRow">
              <span>Faturamento adicional estimado por ciclo</span>
              <span>{formatMoneySigned(erpReturn.revenueDelta)}</span>
            </div>
            <div className="purchasePreviewRow">
              <span>Despesa adicional estimada por ciclo</span>
              <span>{formatMoneySigned(erpReturn.expensesDelta)}</span>
            </div>
            <div className="purchasePreviewRow purchasePreviewRowStrong">
              <span>Ganho líquido adicional por ciclo</span>
              <span>{formatMoneySigned(erpReturn.incrementalNet)}</span>
            </div>
            <div className="purchasePreviewRow">
              <span>Projeção em {safeHorizon} rodada(s) (equipe atual)</span>
              <span>{formatMoneySigned(erpReturn.horizonNet)}</span>
            </div>
            <div className="purchasePreviewRow purchasePreviewRowStrong">
              <span>{paybackLabel}</span>
            </div>
            {erpReturn.guidance && (
              <div className="purchasePreviewGuidance" role="note">
                {erpReturn.guidance}
              </div>
            )}
            {staffCount <= 0 && (
              <div className="purchasePreviewAlert">
                Sem colaboradores, o ERP não gera faturamento nem despesa operacional neste momento.
              </div>
            )}
            {erpReturn && !erpReturn.paysBackWithinHorizon && erpReturn.status !== 'no_cost' && (
              <div className="purchasePreviewAlert">
                Este investimento não se recupera no horizonte atual de {safeHorizon} rodada(s) com a equipe atual.
              </div>
            )}
          </div>
        </>
      )}

    </TileModalShell>
  )
}

function ErpCompareRow({ label, values, current, selected }) {
  return (
    <tr>
      <td className="erpCompareMetric">{label}</td>
      {(['A', 'B', 'C', 'D']).map((k) => (
        <td
          key={k}
          className={`erpCompareMoney${current === k ? ' is-current' : ''}${selected === k ? ' is-selected' : ''}`.trim()}
        >
          $ {Number(values[k]).toLocaleString()}
        </td>
      ))}
    </tr>
  )
}
