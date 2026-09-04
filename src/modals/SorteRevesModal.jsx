// src/modals/SorteRevesModal.jsx
import React, { useEffect, useMemo, useRef, useState } from 'react'
import TileContextHint from './TileContextHint.jsx'
import { SORTE_REVES_CARDS, resolveCardEffect } from './sorteRevesDeck.js'

/**
 * Modal "Sorte & Revés"
 *
 * Ajustes:
 * - Removidas as cartas que não geram impacto financeiro direto (ex.: habeas
 *   corpus, “compra livre”, ganhar célula/gestor, subir infraestrutura sem custo).
 * - Cartas condicionais agora olham o estado do jogador (prop `player`) e
 *   recalculam os efeitos (ex.: se tiver certificado amarelo, “Cliente Chave em Risco”
 *   não aplica penalidade).
 * - Carta “Gestão de Mudanças Bem-sucedida” agora retorna um `certDelta` para
 *   o jogo creditar um certificado azul (az: +1) ao jogador.
 *
 * IMPORTANTE: Em App.jsx, ao aplicar o resultado da carta, some `certDelta.az`/`am`/`rox`
 * nos contadores do jogador, se existirem (ex.: next.az = (next.az||0) + certDelta.az).
 */

export default function SorteRevesModal({ onResolve, player = {} }) {
  const confirmRef = useRef(null)

  const CARDS = SORTE_REVES_CARDS

  // Sorteia uma carta ao abrir
  const [card] = useState(() => CARDS[Math.floor(Math.random() * CARDS.length)])

  // Calcula efeito resolvido para EXIBIÇÃO e para o payload
  // Fonte única: sorteRevesDeck.js (mesma lógica, agora testável sem DOM).
  const resolved = useMemo(() => resolveCardEffect(card, player), [card, player])

  const resolve = () => onResolve?.(resolved.payload)

  // Trava o scroll do body e foca no botão de confirmação
  useEffect(() => {
    const prev = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    setTimeout(() => confirmRef.current?.focus?.(), 0)
    return () => { document.body.style.overflow = prev }
  }, [])

  return (
    <div style={S.wrap} role="dialog" aria-modal="true" aria-label="Sorte e Revés">
      <div style={S.card}>
        <div style={S.badge(card.kind)}>{card.kind === 'SORTE' ? 'SORTE' : 'REVÉS'}</div>
        <TileContextHint kind="LUCK" />
        {card.title && <h2 style={S.title}>{card.title}</h2>}
        <p style={S.text}>{resolved.text}</p>
        <p style={S.hint}>
          O efeito desta carta é aplicado imediatamente ao confirmar.
        </p>

        <div style={S.footer}>
          <button ref={confirmRef} type="button" style={S.okBtn} onClick={resolve}>OK</button>
        </div>
      </div>
    </div>
  )
}

const S = {
  wrap: { position:'fixed', inset:0, background:'rgba(0,0,0,.55)', display:'flex', alignItems:'center', justifyContent:'center', zIndex:1000 },
  card: { width:'min(760px, 92vw)', background:'#1b1f2a', color:'#e9ecf1', borderRadius:18, padding:'22px', border:'1px solid rgba(255,255,255,.12)', boxShadow:'0 10px 40px rgba(0,0,0,.4)', position:'relative' },
  badge:(kind)=>({
    display:'inline-block', padding:'6px 12px', borderRadius:999, fontWeight:900, marginBottom:8,
    background: kind==='SORTE' ? '#22c55e' : '#ef4444', color:'#111'
  }),
  title:{ margin:'2px 0 6px', fontWeight:900 },
  text:{ fontSize:18, lineHeight:1.5, opacity:.95, margin:'6px 0 8px' },
  hint:{ fontSize:13, lineHeight:1.4, opacity:.75, margin:'0 0 14px' },
  footer:{ display:'flex', justifyContent:'center' },
  okBtn:{ minWidth:140, padding:'12px 18px', borderRadius:12, border:'none', fontWeight:900, cursor:'pointer', background:'#fff', color:'#111' },
}
