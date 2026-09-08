// src/modals/SorteRevesModal.jsx
import React, { useEffect, useMemo, useRef, useState } from 'react'
import TileContextHint from './TileContextHint.jsx'
import { SORTE_REVES_CARDS, resolveCardEffect } from './sorteRevesDeck.js'
import TileModalShell from './TileModalShell.jsx'

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
  const didResolveRef = useRef(false)

  const CARDS = SORTE_REVES_CARDS

  // Sorteia uma carta ao abrir
  const [card] = useState(() => CARDS[Math.floor(Math.random() * CARDS.length)])

  // Calcula efeito resolvido para EXIBIÇÃO e para o payload
  // Fonte única: sorteRevesDeck.js (mesma lógica, agora testável sem DOM).
  const resolved = useMemo(() => resolveCardEffect(card, player), [card, player])

  const resolve = () => {
    if (didResolveRef.current) return
    didResolveRef.current = true
    onResolve?.(resolved.payload)
  }

  // Trava o scroll do body e foca no botão de confirmação
  useEffect(() => {
    const prev = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    setTimeout(() => confirmRef.current?.focus?.(), 0)
    return () => { document.body.style.overflow = prev }
  }, [])

  return (
    <TileModalShell
      title="Sorte & Revés"
      label="Sorte e Revés"
      size="md"
      footer={(
        <button ref={confirmRef} type="button" className="tileModalBtn tileModalBtn--confirm" onClick={resolve}>
          OK
        </button>
      )}
    >
      <div className={card.kind === 'SORTE' ? 'tileValueHuge tileValueHuge--pos' : 'tileValueHuge tileValueHuge--neg'}>
        {card.kind === 'SORTE' ? 'SORTE' : 'REVÉS'}
      </div>
      <TileContextHint kind="LUCK" />
      {card.title && <h3 className="tileCertName">{card.title}</h3>}
      <p className="purchasePreviewHint" style={{ fontSize: 18, color: 'var(--tm-text, #f4f6fb)' }}>{resolved.text}</p>
      <p className="purchasePreviewHint">
        O efeito desta carta é aplicado imediatamente ao confirmar.
      </p>
    </TileModalShell>
  )
}
