// src/modals/recovery/RecoveryFire.jsx
import React, { useMemo, useState } from 'react'
import S from './recoveryStyles'
import { MANUAL_CONSTANTS } from '../game/manualConstants.js'

/**
 * roles: [{ key:'comum'|'field'|'inside'|'gestor', label, unit?, total?, owned?, qty? }]
 * onConfirm(payload):
 *  {
 *    type: 'FIRE',
 *    items: { [key]: qtdParaDemitir },
 *    creditByRole: { [key]: creditoGerado },
 *    totalCredit: number,
 *    amount: number,          // alias p/ compat
 *    note: string
 *  }
 */
export default function RecoveryFire({ roles = [], onBack, onConfirm }) {
  // normaliza unit e owned
  const normalized = useMemo(() => {
    return roles.map(r => {
      const unit = Number((r.unit ?? r.total) ?? 0)
      const owned = Number((r.owned ?? r.qty) ?? 0)
      return { ...r, unit, owned }
    })
  }, [roles])

  // estado: quanto o jogador quer demitir de cada cargo
  const [qty, setQty] = useState(() => {
    const init = {}
    normalized.forEach(r => { init[r.key] = 0 })
    return init
  })

  const fmt = (v) => `R$ ${Number(v || 0).toLocaleString('pt-BR')}`
  const creditUnit = (unit) => Math.floor(Number(unit || 0) * MANUAL_CONSTANTS.recoveryCreditRatio)

  const add = (k, delta) => {
    setQty(q => {
      const role = normalized.find(r => r.key === k)
      if (!role) return q
      const cur = Number(q[k] || 0)
      const next = Math.max(0, Math.min(role.owned, cur + delta))
      if (next === cur) return q
      return { ...q, [k]: next }
    })
  }

  const creditByRole = useMemo(() => {
    const out = {}
    normalized.forEach(r => {
      const q = Number(qty[r.key] || 0)
      out[r.key] = creditUnit(r.unit) * q
    })
    return out
  }, [qty, normalized])

  const totalCredit = useMemo(
    () => Object.values(creditByRole).reduce((a, b) => a + b, 0),
    [creditByRole]
  )

  const confirm = () => {
    if (totalCredit <= 0) return
    const items = {}
    normalized.forEach(r => { items[r.key] = Number(qty[r.key] || 0) })

    onConfirm?.({
      type: 'FIRE',
      items,                 // quantidades a demitir por cargo
      creditByRole,          // crédito por cargo
      totalCredit,           // total no caixa
      amount: totalCredit,   // alias p/ compat
      note: `Demissões +${fmt(totalCredit)}`
    })
  }

  return (
    <div className="recovery-body" style={S.body}>
      <div style={S.subHeader}><b style={{fontSize:20}}>DEMITIR FUNCIONÁRIOS</b></div>
      <p style={{ opacity: 0.9, marginBottom: 12, lineHeight: 1.45 }}>
        Reduz a equipe e devolve 50% do valor ao caixa. Use para recuperar saldo e evitar falência.
      </p>

      {/* Cabeçalho */}
      <div style={{display:'grid', gridTemplateColumns:'1.2fr 1fr 1.2fr 1fr', gap:8, opacity:.9, fontWeight:700, marginBottom:6}}>
        <div>Cargo</div>
        <div>Valor Unitário</div>
        <div>Qtd demitir</div>
        <div>Crédito</div>
      </div>

      <div style={{display:'grid', gap:12}}>
        {normalized.map(r => {
          const q = Number(qty[r.key] || 0)
          const unit = Number(r.unit || 0)
          const owned = Number(r.owned || 0)
          const cu = creditUnit(unit)
          const credit = cu * q
          const minusDisabled = q <= 0
          const plusDisabled = q >= owned || owned <= 0

          return (
            <div
              key={r.key}
              style={{
                display:'grid',
                gridTemplateColumns:'1.2fr 1fr 1.2fr 1fr',
                alignItems:'center',
                gap:8
              }}
            >
              <div>
                <div style={{fontWeight:800}}>{r.label}</div>
                <div style={{opacity:.75, fontSize:12}}>Possui: <b>{owned}</b></div>
              </div>

              <div>
                <div><b>{fmt(unit)}</b></div>
                <div style={{opacity:.75, fontSize:12}}>Crédito por un.: <b>{fmt(cu)}</b></div>
              </div>

              <div style={{display:'flex', gap:6, alignItems:'center'}}>
                <button
                  style={{ ...S.spin, opacity: minusDisabled ? .5 : 1, cursor: minusDisabled ? 'not-allowed' : 'pointer' }}
                  disabled={minusDisabled}
                  onClick={() => add(r.key, -1)}
                >-</button>
                <div style={{minWidth:28, textAlign:'center', fontWeight:800}}>{q}</div>
                <button
                  style={{ ...S.spin, opacity: plusDisabled ? .5 : 1, cursor: plusDisabled ? 'not-allowed' : 'pointer' }}
                  disabled={plusDisabled}
                  onClick={() => add(r.key, +1)}
                >+</button>
              </div>

              <div><b>{fmt(credit)}</b></div>
            </div>
          )
        })}
      </div>

      <div style={{marginTop:12, textAlign:'right', fontWeight:900}}>
        Total a resgatar: <b>{fmt(totalCredit)}</b>
      </div>

      <div style={S.rowBtns}>
        <button style={S.back} onClick={onBack}>← Voltar</button>
        <button
          style={{...S.cta, background:'#ef4444', opacity: totalCredit>0 ? 1 : .6}}
          onClick={confirm}
          disabled={totalCredit <= 0}
        >
          DEMITIR
        </button>
      </div>
    </div>
  )
}
