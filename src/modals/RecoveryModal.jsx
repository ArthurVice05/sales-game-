// src/modals/RecoveryModal.jsx
import React, { useMemo, useState, useEffect } from 'react'
import { useModal } from './ModalContext'
import S from './recoveryStyles'

import RecoveryMenu from './RecoveryMenu'
import RecoveryLoan from './RecoveryLoan'
import RecoveryReduce from './RecoveryReduce'
import RecoveryFire from './RecoveryFire' // mesmo diretório
import { ERP_RULES, VENDOR_RULES } from '../game/gameRules.js'
import { MIX_PURCHASE_PRICES, MANUAL_CONSTANTS } from '../game/manualConstants.js'

export default function RecoveryModal({ playerName = 'Jogador', bens = 0, currentPlayer, canClose = true }) {
  const { resolveTop, popModal } = useModal?.() || {}
  const [step, setStep] = useState('menu') // 'menu' | 'loan' | 'reduce' | 'fire'

  const close = () => {
    if (!canClose) return
    popModal ? popModal(false) : resolveTop?.(null)
  }

  // ✅ FIX: safeResolve estava sendo usado mas não existia
  const safeResolve = (payload) => {
    try {
      resolveTop?.(payload) // fecha a modal e devolve payload para openModalAndWait
    } catch (e) {
      console.error('[RecoveryModal] safeResolve falhou:', e)
      try { popModal?.() } catch {}
    }
  }

  // --- preços de compra -> crédito = recoveryCreditRatio (ERP/Mix da fonte única) ---
  const MIX_PRICES = useMemo(() => ({ ...MIX_PURCHASE_PRICES }), [])
  const ERP_PRICES = useMemo(() => ({
    A: ERP_RULES.A.price,
    B: ERP_RULES.B.price,
    C: ERP_RULES.C.price,
    D: ERP_RULES.D.price,
  }), [])
  const creditRatio = MANUAL_CONSTANTS.recoveryCreditRatio
  const loanRatio = MANUAL_CONSTANTS.loanMaxBensRatio

  // --------- helpers de normalização ---------
  const letterFrom = (v) => {
    if (v == null) return ''
    const s = String(v).trim().toUpperCase()
    if (['A','B','C','D'].includes(s)) return s
    const n = Number(s)
    if (n === 1) return 'A'
    if (n === 2) return 'B'
    if (n === 3) return 'C'
    if (n === 4) return 'D'
    return ''
  }

  const setFromOwned = (src) => {
    // aceita array ['A','C'], objeto {A:true}, string 'B', número 1..4
    if (!src) return new Set()
    if (Array.isArray(src)) return new Set(src.map(letterFrom).filter(Boolean))
    if (typeof src === 'object') {
      const out = new Set()
      ;['A','B','C','D'].forEach(k => { if (src[k]) out.add(k) })
      return out
    }
    const l = letterFrom(src)
    return l ? new Set([l]) : new Set()
  }

  // --------- snapshot do jogador ---------
  const snapshot = useMemo(() => {
    const p = currentPlayer || {}
    return {
      name: p.name ?? playerName,
      bens: Number(p.bens ?? bens ?? 0),
      vendedoresComuns: Number(p.vendedoresComuns ?? 0),
      fieldSales: Number(p.fieldSales ?? 0),
      insideSales: Number(p.insideSales ?? 0),
      gestores: Number(p.gestores ?? p.gestoresComerciais ?? 0),
      raw: p
    }
  }, [currentPlayer, playerName, bens])

  useEffect(() => {
    console.group('[RecoveryModal] mount snapshot')
    console.log('raw player =>', snapshot.raw)
    console.groupEnd()
  }, [snapshot.raw])

  // disponível para empréstimo (50% dos bens)
  const loanAvailable = useMemo(
    () => Math.max(0, Math.floor(snapshot.bens * loanRatio)),
    [snapshot.bens, loanRatio]
  )

  // verifica se já tem empréstimo pendente
  const hasPendingLoan = useMemo(() => {
    const loanPending = snapshot.raw?.loanPending
    return loanPending && Number(loanPending.amount) > 0
  }, [snapshot.raw?.loanPending])

  const hasTakenLoanInMatch = useMemo(() => {
    return !!snapshot.raw?.loanTakenInMatch
  }, [snapshot.raw?.loanTakenInMatch])

  const loanBlockedInMatch = hasPendingLoan || hasTakenLoanInMatch

  console.log('[LOAN DEBUG] recovery snapshot', {
    playerId: snapshot.raw?.id,
    loanTakenInMatch: !!snapshot.raw?.loanTakenInMatch,
    loanPending: snapshot.raw?.loanPending || null,
  })

  // opções do menu (crédito ilustrativo = nível D × ratio; o real é por nível em RecoveryReduce)
  const REDUCE_OPTIONS = useMemo(
    () => [
      { key:'mix', label:'MIX PRODUTOS', credit: Math.floor(MIX_PRICES.D * creditRatio) },
      { key:'erp', label:'ERP/SISTEMAS', credit: Math.floor(ERP_PRICES.D * creditRatio) },
    ],
    [MIX_PRICES, ERP_PRICES, creditRatio]
  )

  // Demissão: crédito = hire × recoveryCreditRatio
  const ROLES = useMemo(() => ([
    { key:'comum',  label:'Vendedor Comum', unit: MANUAL_CONSTANTS.commonHire, owned: snapshot.vendedoresComuns },
    { key:'field',  label:'Field Sales',     unit: VENDOR_RULES.field.hire, owned: snapshot.fieldSales },
    { key:'inside', label:'Inside Sales',    unit: VENDOR_RULES.inside.hire, owned: snapshot.insideSales },
    { key:'gestor', label:'Gestor',          unit: MANUAL_CONSTANTS.managerHire, owned: snapshot.gestores },
  ]), [snapshot])

  // --------- detectar níveis exibidos no painel (letras) ---------
  const mixLetter = useMemo(() => {
    const p = snapshot.raw || {}
    return letterFrom(
      p.mixProdutosLetter ??
      p.mixProdutos ??
      p.mixProducts ??
      p.mixLevelLetter ??
      p.mixLevel ??
      p.mix_level ??
      p.mix ??
      p['mix_produtos'] ??
      p['mix_products']
    )
  }, [snapshot.raw])

  const erpLetter = useMemo(() => {
    const p = snapshot.raw || {}
    return letterFrom(
      p.erpSistemasLetter ??
      p.erpSistemas ??
      p.erpSystems?.level ??
      p.erpSystemsLetter ??
      p.erpLevelLetter ??
      p.erpLevel ??
      p.erp_level ??
      p.erp ??
      p['erp_sistemas']
    )
  }, [snapshot.raw])

  // --------- conjunto de posses reais (derivado de mixProdutos/erpLevel quando mixOwned vazio) ---------
  const ownedMix = useMemo(() => {
    const p = snapshot.raw || {}
    const mixOwnedObj = p.mixOwned ?? p.mix ?? {}
    const set = new Set()
    
    // ✅ CORREÇÃO: Se mixOwned vier como objeto válido, usa diretamente
    if (typeof mixOwnedObj === 'object' && !Array.isArray(mixOwnedObj) && mixOwnedObj !== null) {
      if (mixOwnedObj.A === true) set.add('A')
      if (mixOwnedObj.B === true) set.add('B')
      if (mixOwnedObj.C === true) set.add('C')
      if (mixOwnedObj.D === true) set.add('D')
    }
    
    // ✅ CORREÇÃO: Se mixOwned estiver vazio mas mixProdutos existir, infere os níveis
    // Se está no nível B, possui B e C
    // Se está no nível A, possui A, B e C
    // Se está no nível C, possui C
    // D sempre está disponível (básico, não reduz)
    if (set.size === 0 && mixLetter) {
      // Sempre adiciona D (básico)
      set.add('D')
      
      if (mixLetter === 'A') {
        set.add('A')
        set.add('B')
        set.add('C')
      } else if (mixLetter === 'B') {
        set.add('B')
        set.add('C')
      } else if (mixLetter === 'C') {
        set.add('C')
      }
    }
    
    // Fallback: se não detectamos nada, considera o D como base inicial
    if (set.size === 0) set.add('D')
    
    return set
  }, [snapshot.raw, mixLetter])

  const ownedErp = useMemo(() => {
    const p = snapshot.raw || {}
    const erpOwnedObj = p.erpOwned ?? p.erp ?? {}
    const set = new Set()
    
    // ✅ CORREÇÃO: Se erpOwned vier como objeto válido, usa diretamente
    if (typeof erpOwnedObj === 'object' && !Array.isArray(erpOwnedObj) && erpOwnedObj !== null) {
      if (erpOwnedObj.A === true) set.add('A')
      if (erpOwnedObj.B === true) set.add('B')
      if (erpOwnedObj.C === true) set.add('C')
      if (erpOwnedObj.D === true) set.add('D')
    }
    
    // ✅ CORREÇÃO: Se erpOwned estiver vazio mas erpLevel existir, infere os níveis
    // Se está no nível B, possui B e C
    // Se está no nível A, possui A, B e C
    // Se está no nível C, possui C
    // D sempre está disponível (básico, não reduz)
    if (set.size === 0 && erpLetter) {
      // Sempre adiciona D (básico)
      set.add('D')
      
      if (erpLetter === 'A') {
        set.add('A')
        set.add('B')
        set.add('C')
      } else if (erpLetter === 'B') {
        set.add('B')
        set.add('C')
      } else if (erpLetter === 'C') {
        set.add('C')
      }
    }
    
    // Fallback: se não detectamos nada, considera o D como base inicial
    if (set.size === 0) set.add('D')
    
    return set
  }, [snapshot.raw, erpLetter])

  useEffect(() => {
    console.group('[RecoveryModal] owned detect')
    console.log('mixLetter(panel):', mixLetter, ' -> ownedMix =', Object.fromEntries(['A','B','C','D'].map(k=>[k,ownedMix.has(k)])))
    console.log('erpLetter(panel):', erpLetter, ' -> ownedErp =', Object.fromEntries(['A','B','C','D'].map(k=>[k,ownedErp.has(k)])))
    console.groupEnd()
  }, [mixLetter, erpLetter, ownedMix, ownedErp])

  // ✅ CORREÇÃO: Verifica quais níveis já foram reduzidos
  const reducedLevels = useMemo(() => {
    const p = snapshot.raw || {}
    return {
      MIX: Array.isArray(p.reducedLevels?.MIX) ? p.reducedLevels.MIX : [],
      ERP: Array.isArray(p.reducedLevels?.ERP) ? p.reducedLevels.ERP : [],
    }
  }, [snapshot.raw])

  // --------- montar cartões (com crédito e flag owned) ---------
  const optionsMix = useMemo(
    () => ['A','B','C','D'].map(k => ({
      key:`mix-${k}`,
      group:'MIX',
      level:k,
      label:`Nível ${k}`,
      credit: Math.floor((MIX_PRICES[k] || 0) * creditRatio),
      owned: ownedMix.has(k),
      // ✅ CORREÇÃO: Marca se o nível já foi reduzido
      alreadyReduced: reducedLevels.MIX.includes(k),
    })),
    [ownedMix, MIX_PRICES, reducedLevels.MIX, creditRatio]
  )

  const optionsErp = useMemo(
    () => ['A','B','C','D'].map(k => ({
      key:`erp-${k}`,
      group:'ERP',
      level:k,
      label:`Nível ${k}`,
      credit: Math.floor((ERP_PRICES[k] || 0) * creditRatio),
      owned: ownedErp.has(k),
      // ✅ CORREÇÃO: Marca se o nível já foi reduzido
      alreadyReduced: reducedLevels.ERP.includes(k),
    })),
    [ownedErp, ERP_PRICES, reducedLevels.ERP, creditRatio]
  )

  // tabelas de crédito por nível (se a sub-tela quiser usar)
  const creditsTables = useMemo(() => ({
    MIX: {
      A: Math.floor(MIX_PRICES.A * creditRatio),
      B: Math.floor(MIX_PRICES.B * creditRatio),
      C: Math.floor(MIX_PRICES.C * creditRatio),
      D: Math.floor(MIX_PRICES.D * creditRatio),
    },
    ERP: {
      A: Math.floor(ERP_PRICES.A * creditRatio),
      B: Math.floor(ERP_PRICES.B * creditRatio),
      C: Math.floor(ERP_PRICES.C * creditRatio),
      D: Math.floor(ERP_PRICES.D * creditRatio),
    },
  }), [MIX_PRICES, ERP_PRICES, creditRatio])

  return (
    <div style={S.backdrop} className="recovery-backdrop">
      {/* forçar remount por step ajuda quando a sub-tela possui estado interno */}
      <div
        style={S.card}
        className={step === 'reduce' ? 'recovery-card recovery-card--reduce' : 'recovery-card'}
        key={step}
      >
        <div style={S.header} className="recovery-header">
          <div style={{ fontWeight:900, fontSize:22 }}>RECUPERAÇÃO FINANCEIRA</div>
          {canClose && (
            <button onClick={close} style={S.closeBtn}>×</button>
          )}
        </div>

        {step === 'menu' && (
          <RecoveryMenu
            playerName={snapshot.name}
            loanAvailable={loanAvailable}
            hasPendingLoan={hasPendingLoan}
            hasTakenLoanInMatch={hasTakenLoanInMatch}
            loanBlockedInMatch={loanBlockedInMatch}
            onGoLoan={() => setStep('loan')}
            onGoReduce={() => setStep('reduce')}
            onGoFire={() => setStep('fire')}
            onDeclareBankruptcy={() => safeResolve({ type: 'TRIGGER_BANKRUPTCY', source: { modal: 'RecoveryModal', file: 'src/modals/RecoveryModal.jsx' } })}
          />
        )}

        {step === 'loan' && (
          <RecoveryLoan
            loanAvailable={loanAvailable}
            alreadyHasLoan={loanBlockedInMatch}
            onBack={() => setStep('menu')}
            onConfirm={(payload) => {
              console.log('[DEBUG] RecoveryModal recebeu payload do RecoveryLoan:', payload)
              console.log('[DEBUG] RecoveryModal chamando resolveTop com:', payload)
              const result = resolveTop?.({ ...(payload || {}), source: { modal: 'RecoveryModal', file: 'src/modals/RecoveryModal.jsx' } })
              console.log('[DEBUG] RecoveryModal resolveTop retornou:', result)
            }}
          />
        )}

        {step === 'reduce' && (
          <RecoveryReduce
            // retrocompatível
            options={REDUCE_OPTIONS}

            // nova API – arrays seguros com owned correto
            optionsMix={optionsMix}
            optionsErp={optionsErp}
            mixOwned={{ A:ownedMix.has('A'), B:ownedMix.has('B'), C:ownedMix.has('C'), D:ownedMix.has('D') }}
            erpOwned={{ A:ownedErp.has('A'), B:ownedErp.has('B'), C:ownedErp.has('C'), D:ownedErp.has('D') }}
            credits={creditsTables}
            snapshot={snapshot}

            onBack={() => setStep('menu')}

            onConfirm={(payload) => {
              // payload pode ser:
              // - { group, level, credit }
              // - { items: [{group,level,credit,selected:true}, ...], total }
              if (Array.isArray(payload?.items)) {
                const total = Number(
                  payload.total ??
                  payload.items.filter(i=>i.selected).reduce((s,i)=>s+Number(i.credit||0),0)
                )
                resolveTop?.({
                  type: 'REDUCE',
                  amount: total,
                  items: payload.items,
                  note: `Redução múltipla +R$ ${total.toLocaleString()}`,
                  source: { modal: 'RecoveryModal', file: 'src/modals/RecoveryModal.jsx' }
                })
                return
              }

              const amount = Number(payload?.credit || payload?.amount || 0)
              const selection = payload && payload.group && payload.level
                ? { group: String(payload.group).toUpperCase(), level: String(payload.level).toUpperCase(), credit: amount }
                : null

              resolveTop?.({
                type: 'REDUCE',
                amount,
                group: selection?.group,
                level: selection?.level,
                selection,
                note: selection
                  ? `Redução ${selection.group} nível ${selection.level} +R$ ${amount.toLocaleString()}`
                  : `Redução +R$ ${amount.toLocaleString()}`,
                source: { modal: 'RecoveryModal', file: 'src/modals/RecoveryModal.jsx' },
              })
            }}
          />
        )}

        {step === 'fire' && (
          <RecoveryFire
            roles={ROLES}
            onBack={() => setStep('menu')}
            onConfirm={(payload) => resolveTop?.({ ...(payload || {}), source: { modal: 'RecoveryModal', file: 'src/modals/RecoveryModal.jsx' } })}
          />
        )}
      </div>
    </div>
  )
}
