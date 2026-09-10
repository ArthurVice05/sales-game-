// src/modals/TrainingModal.jsx
import React, { useEffect, useMemo, useRef, useState } from 'react'
import PurchaseImpactPreview from '../components/PurchaseImpactPreview.jsx'
import { CERT_EFFECTS, MANAGER_BOOST_BY_CERT, MANAGER_BOOST_MAX_CERTS } from '../game/gameRules'
import { MANUAL_CONSTANTS } from '../game/manualConstants.js'
import { previewTrainingPurchaseImpact } from '../game/trainingPurchase.js'
import TileContextHint from './TileContextHint.jsx'
import TileModalShell from './TileModalShell.jsx'
import './training-erp-modals.css'

/**
 * TABELA DE TREINAMENTOS
 * - Cada item tem uma cor principal que corresponde ao certificado:
 *   • Azul    -> 'personalizado'
 *   • Amarelo -> 'fieldsales'
 *   • Roxo    -> 'imersaomultiplier'
 */
const TRAINING_PRICE = MANUAL_CONSTANTS.trainingPrice
const PRODUCTS = [
  {
    id: 'personalizado',
    label: 'Treinamento de venda personalizado\nCasagrande Consultores',
    shortLabel: 'Treinamento de venda personalizado',
    price: TRAINING_PRICE,
    cert: 'azul',
    colors: { bg: '#0f2848', border: '#3b82f6', pill: '#60a5fa' }, // AZUL
  },
  {
    id: 'fieldsales',
    label: 'Curso Canal representantes Collab\nMultiplier Educação e\nCasagrande Consultores',
    shortLabel: 'Canal representantes Collab',
    price: TRAINING_PRICE,
    cert: 'amarelo',
    colors: { bg: '#3a3202', border: '#facc15', pill: '#fde047' }, // AMARELO
  },
  {
    id: 'imersaomultiplier',
    label: 'Pacote Imersões\nMultiplier Educação',
    shortLabel: 'Pacote Imersões',
    price: TRAINING_PRICE,
    cert: 'roxo',
    colors: { bg: '#2b0840', border: '#a855f7', pill: '#c084fc' }, // ROXO
  },
]

const VENDOR_TYPE_META = [
  { id: 'comum',  label: 'Vendedor Comum', shortBtn: 'Vend. Comum' },
  { id: 'field',  label: 'Canal representantes', shortBtn: 'Canal representantes' },
  { id: 'inside', label: 'Inside Sales', shortBtn: 'Inside Sales' },
  { id: 'gestor', label: 'Gestor Comercial', shortBtn: 'Gestor' },
]

/**
 * Props:
 * - onResolve(payload)
 *      • { action:'BUY',
 *          purchases:[{vendorType:'comum'|'field'|'inside'|'gestor', items:[{id,label,price,cert}], total:number}],
 *          grandTotal:number,
 *          bensDelta:number,
 *          certsCount:{ azul:number, amarelo:number, roxo:number },
 *          ownedUpdate: { [vendorType]: string[] } }
 *      • { action:'SKIP' }
 * - ownedByType?: { [vendorType]: Set<string> | string[] }
 * - canTrain?: { comum?:boolean|number|string, field?:boolean|number|string, inside?:boolean|number|string, gestor?:boolean|number|string }
 * - currentCash?: number
 * - currentPlayer?: object (snapshot somente leitura para preview)
 */
export default function TrainingModal({
  onResolve,
  ownedByType = {},
  canTrain = {},
  allowBack = false,
  currentCash = null,
  currentPlayer = null,
}) {
  // Normaliza: aceita 0/1, números em string, booleanos
  const toNum = (v) => (typeof v === 'string' && v.trim() !== '' && !Number.isNaN(Number(v)) ? Number(v) : v)
  const hasRole = (v) => {
    const val = toNum(v)
    return typeof val === 'number' ? val > 0 : !!val
  }

  const cashNow = Number(currentCash != null ? currentCash : (currentPlayer?.cash ?? 0))

  // NÃO usar default true; só mostra se tiver pelo menos 1 daquele tipo
  const canMap = useMemo(() => ({
    comum:  hasRole(canTrain.comum),
    field:  hasRole(canTrain.field),
    inside: hasRole(canTrain.inside),
    gestor: hasRole(canTrain.gestor),
  }), [canTrain])

  // Tipos disponíveis (precisa ter profissional e ainda ter algo a comprar)
  const ALL_IDS = PRODUCTS.map(p => p.id)
  const typeList = useMemo(() => (
    VENDOR_TYPE_META
      .filter(t => canMap[t.id]) // tem profissional do tipo
      .filter(t => {
        const owned = ownedByType[t.id] instanceof Set
          ? ownedByType[t.id]
          : new Set(ownedByType[t.id] || [])
        return ALL_IDS.some(id => !owned.has(id)) // ainda há certificado para comprar
      })
  ), [ownedByType, canMap])

  // Estado para seleção múltipla de tipos de vendedores e treinamentos únicos
  const [selectedVendorTypes, setSelectedVendorTypes] = useState(() => new Set())
  const [selectedTrainings, setSelectedTrainings] = useState(() => new Set()) // Set<trainingId> - aplicado a todos os tipos
  
  // Inicializa com o primeiro tipo disponível se não houver seleção
  useEffect(() => {
    if (selectedVendorTypes.size === 0 && typeList.length > 0) {
      setSelectedVendorTypes(new Set([typeList[0].id]))
    }
  }, [typeList, selectedVendorTypes.size])

  const closeRef = useRef(null)

  // Calcula totais: só itens ainda não possuídos por cada tipo selecionado
  const purchases = useMemo(() => {
    const result = []
    const selectedItems = Array.from(selectedTrainings)
      .map(id => PRODUCTS.find(p => p.id === id))
      .filter(Boolean)

    selectedVendorTypes.forEach((vendorType) => {
      const owned = ownedByType[vendorType] instanceof Set
        ? ownedByType[vendorType]
        : new Set(ownedByType[vendorType] || [])

      const items = selectedItems.filter(item => !owned.has(item.id))
      if (items.length === 0) return

      const total = items.reduce(
        (acc, item) => acc + Number(item?.price || 0),
        0
      )

      result.push({ vendorType, items, total })
    })

    return result
  }, [selectedVendorTypes, selectedTrainings, ownedByType])

  const grandTotal = useMemo(() => 
    purchases.reduce((acc, p) => acc + p.total, 0), 
    [purchases]
  )

  const certsCount = useMemo(() => {
    const counts = { azul: 0, amarelo: 0, roxo: 0 }
    purchases.forEach((purchase) => {
      ;(purchase.items || []).forEach((item) => {
        if (!item?.cert) return
        counts[item.cert] = (counts[item.cert] || 0) + 1
      })
    })
    return counts
  }, [purchases])

  const ownedUpdate = useMemo(() => {
    const result = {}
    purchases.forEach((purchase) => {
      result[purchase.vendorType] = (purchase.items || []).map(item => item.id)
    })
    return result
  }, [purchases])

  const draftPayload = useMemo(() => {
    if (purchases.length === 0) return null
    return {
      action: 'BUY',
      purchases,
      grandTotal,
      bensDelta: grandTotal,
      certsCount,
      ownedUpdate,
    }
  }, [purchases, grandTotal, certsCount, ownedUpdate])

  const purchaseImpact = useMemo(() => {
    if (!draftPayload) return null
    const playerSnapshot = {
      ...(currentPlayer || {}),
      cash: cashNow,
    }
    return previewTrainingPurchaseImpact({
      player: playerSnapshot,
      payload: draftPayload,
    })
  }, [draftPayload, currentPlayer, cashNow])

  const selectedTypeLabels = useMemo(() => {
    return Array.from(selectedVendorTypes).map((id) => {
      const meta = VENDOR_TYPE_META.find(t => t.id === id)
      return meta?.label || id
    })
  }, [selectedVendorTypes])

  const trainsGestor = purchases.some((p) => p.vendorType === 'gestor')

  const gestorBoostHint = useMemo(() => {
    const maxAvailableCerts = Math.min(
      PRODUCTS.length,
      MANAGER_BOOST_MAX_CERTS,
    )
    const ladder = Array.from(
      { length: maxAvailableCerts },
      (_, index) => index + 1
    )
      .map((certCount) => {
        const ratio = MANAGER_BOOST_BY_CERT?.[certCount]
        const pct = Math.round(Number(ratio || 0) * 100)
        return `${certCount} cert.: ${pct}%`
      })
      .join(' · ')
    return ladder
  }, [])

  const toggleVendorType = (vendorType) => {
    setSelectedVendorTypes(prev => {
      const next = new Set(prev)
      if (next.has(vendorType)) {
        next.delete(vendorType)
      } else {
        next.add(vendorType)
      }
      return next
    })
  }

  const toggleTraining = (trainingId) => {
    // Verifica se algum dos tipos selecionados já tem este treinamento
    const isOwnedByAnySelected = Array.from(selectedVendorTypes).some(vendorType => {
      const owned = ownedByType[vendorType] instanceof Set
        ? ownedByType[vendorType]
        : new Set(ownedByType[vendorType] || [])
      return owned.has(trainingId)
    })
    
    if (isOwnedByAnySelected) return // já comprado para algum tipo selecionado

    setSelectedTrainings(prev => {
      const next = new Set(prev)
      if (next.has(trainingId)) {
        next.delete(trainingId)
      } else {
        next.add(trainingId)
      }
      return next
    })
  }

  const handleBuy = () => {
    if (!draftPayload) return
    onResolve?.(draftPayload)
  }

  const clearAll = () => {
    setSelectedVendorTypes(new Set())
    setSelectedTrainings(new Set())
  }

  const handleClose = (e) => {
    e?.preventDefault?.()
    e?.stopPropagation?.()
    onResolve?.({ action: 'SKIP' })
  }
  const handleBack = (e) => { e?.preventDefault?.(); e?.stopPropagation?.(); onResolve?.({ action:'BACK' }) }

  // Trava o scroll e foca no X
  useEffect(() => {
    const prevOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    setTimeout(() => closeRef.current?.focus?.(), 0)
    return () => { document.body.style.overflow = prevOverflow }
  }, [])

  const noTypesLeft = typeList.length === 0
  const noProfessionAvailable = !Object.values(canMap).some(Boolean)

  return (
    <TileModalShell
      title="Treinamento"
      onClose={handleClose}
      closeRef={closeRef}
      size="xl"
      footer={(
        <>
          {allowBack && !noTypesLeft && (
            <button type="button" className="tileModalBtn tileModalBtn--ghost" onClick={handleBack}>Voltar</button>
          )}
          {!noTypesLeft && (
            <>
              <button type="button" className="tileModalBtn tileModalBtn--ghost" onClick={handleClose}>Não comprar</button>
              <button
                type="button"
                className="tileModalBtn tileModalBtn--confirm"
                disabled={purchases.length === 0}
                onClick={handleBuy}
              >
                Comprar ({purchases.length} tipo{purchases.length !== 1 ? 's' : ''})
              </button>
            </>
          )}
        </>
      )}
    >
      <TileContextHint kind="TRAINING" />

      <p className="purchasePreviewHint">
        Cada cor tem efeito financeiro diferente no profissional treinado (exceto o Gestor,
        cujo boost depende só da quantidade de certificados). Treinamentos não aumentam a
        capacidade de atendimento e não contratam novos profissionais. Cores também entram
        em Sorte &amp; Revés. Azul: 100% fat / 100% desp · Amarelo: 100% fat / 0% desp ·
        Roxo: 120% fat / 150% desp (sobre o incremento do tipo). Preço: $ {TRAINING_PRICE.toLocaleString()} cada.
      </p>

      <div className="trainingSupportRow">
        <span>Saldo disponível: <b>$ {cashNow.toLocaleString()}</b></span>
      </div>

      {noTypesLeft ? (
        <>
          <div className="tileStatBlock" style={{ marginBottom: 12 }}>
            {noProfessionAvailable
              ? 'Nenhum profissional disponível para treinar no momento.'
              : 'Todos os treinamentos já foram comprados para os profissionais disponíveis.'}
          </div>
          {allowBack && (
            <button type="button" className="tileModalBtn tileModalBtn--ghost" onClick={handleBack}>Voltar</button>
          )}
        </>
      ) : (
        <>
          <div className="trainingSectionTitle">Profissionais</div>
          <p className="purchasePreviewHint">
            Selecione um ou vários tipos para aplicar os mesmos treinamentos:
          </p>
          <div className="trainingVendorChipRow">
            {typeList.map((v) => {
              const selected = selectedVendorTypes.has(v.id)
              return (
                <button
                  key={v.id}
                  type="button"
                  className={`trainingVendorChip${selected ? ' is-selected' : ''}`}
                  onClick={() => toggleVendorType(v.id)}
                  aria-pressed={selected}
                >
                  {v.label}
                </button>
              )
            })}
          </div>
        </>
      )}

      {!noTypesLeft && selectedVendorTypes.size > 0 && (
        <>
          <p className="trainingSelectedSummary">
            Tipos selecionados: <b>{selectedTypeLabels.join(', ')}</b>
          </p>

          <div className="trainingSectionTitle">Certificações disponíveis</div>
          <p className="purchasePreviewHint">
            Escolha os treinamentos aplicados a todos os tipos selecionados:
          </p>

          <div className="trainingCertGrid">
            {PRODUCTS.map((p) => {
              const active = selectedTrainings.has(p.id)
              const isOwnedByAnySelected = Array.from(selectedVendorTypes).some((vendorType) => {
                const owned = ownedByType[vendorType] instanceof Set
                  ? ownedByType[vendorType]
                  : new Set(ownedByType[vendorType] || [])
                return owned.has(p.id)
              })
              const receivingLabels = Array.from(selectedVendorTypes)
                .filter((vendorType) => {
                  const owned = ownedByType[vendorType] instanceof Set
                    ? ownedByType[vendorType]
                    : new Set(ownedByType[vendorType] || [])
                  return !owned.has(p.id)
                })
                .map((id) => VENDOR_TYPE_META.find((t) => t.id === id)?.label || id)
              const appliedLine = receivingLabels.length > 0
                ? `Aplicado em: ${receivingLabels.join(', ')}`
                : 'Já adquirido para os tipos selecionados'
              const fx = CERT_EFFECTS[p.id]
              const status = isOwnedByAnySelected ? 'Já adquirido' : (active ? 'Selecionado' : 'Disponível')
              const tone = p.cert === 'azul' ? 'azul' : p.cert === 'amarelo' ? 'amarelo' : 'roxo'

              return (
                <button
                  key={p.id}
                  type="button"
                  className={`trainingCertCard trainingCertCard--${tone}${active ? ' is-selected' : ''}${isOwnedByAnySelected ? ' is-owned' : ''}`}
                  onClick={() => toggleTraining(p.id)}
                  disabled={isOwnedByAnySelected}
                  aria-pressed={active}
                  title={isOwnedByAnySelected ? 'Já adquirido para algum tipo selecionado' : undefined}
                >
                  <span className={`tileCertPill tileCertPill--${tone === 'azul' ? 'blue' : tone === 'amarelo' ? 'yellow' : 'purple'}`}>
                    Certificado {p.cert === 'azul' ? 'Azul' : p.cert === 'amarelo' ? 'Amarelo' : 'Roxo'}
                  </span>
                  <span className="trainingCertStatus">{status}</span>
                  <h3 className="trainingCertName">{p.label}</h3>
                  <p className="trainingCertApplied">{appliedLine}</p>
                  {fx ? (
                    <div className="tileCertEffect">
                      <div className="tileCertEffectRow">
                        <span>Faturamento</span>
                        <strong>{Math.round(fx.multFat * 100)}%</strong>
                      </div>
                      <div className="tileCertEffectRow">
                        <span>Despesa</span>
                        <strong>{Math.round(fx.multDesp * 100)}%</strong>
                      </div>
                    </div>
                  ) : null}
                  <div className="trainingCertPrice">$ {p.price.toLocaleString()}</div>
                </button>
              )
            })}
          </div>

          <div className="trainingTotalBar">
            <button
              type="button"
              className="tileModalBtn tileModalBtn--ghost"
              onClick={clearAll}
            >
              Limpar Tudo
            </button>
            <div className="trainingTotalValue">
              Total da compra: $ {grandTotal.toLocaleString()}
              {selectedVendorTypes.size > 1 ? (
                <span className="trainingTotalHint">
                  {selectedTrainings.size} treinamento{selectedTrainings.size !== 1 ? 's' : ''}
                  {' × '}
                  {selectedVendorTypes.size} tipos
                </span>
              ) : (
                <span className="trainingTotalHint">
                  Soma dos certificados escolhidos para os tipos selecionados
                </span>
              )}
            </div>
          </div>

          {trainsGestor && (
            <div className="purchasePreviewExtra">
              <div className="purchasePreviewExtraTitle">Gestor Comercial</div>
              <p className="purchasePreviewHint" style={{ marginBottom: gestorBoostHint ? 8 : 0 }}>
                Gestores sem certificação não aumentam o faturamento dos vendedores.
                As certificações liberam e ampliam esse benefício, mas também aumentam as despesas do gestor.
              </p>
              {gestorBoostHint ? (
                <div className="purchasePreviewRow">
                  <span>Boost por quantidade de certificações do gestor</span>
                  <span>{gestorBoostHint}</span>
                </div>
              ) : null}
            </div>
          )}

          {purchaseImpact && (
            <PurchaseImpactPreview impact={purchaseImpact} />
          )}
        </>
      )}
    </TileModalShell>
  )
}
