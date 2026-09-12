// src/modals/SorteRevesModal.jsx
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import TileContextHint from './TileContextHint.jsx'
import { SORTE_REVES_CARDS, resolveCardEffect } from './sorteRevesDeck.js'
import SorteRevesScene from './SorteRevesScene.jsx'
import SorteRevesCardContent from './SorteRevesCardContent.jsx'
import { createOnceGuard, mediaVariantForCard } from './sorteRevesPresentation.js'
import {
  openRevealSoundSession,
  readRevealSoundPreference,
  writeRevealSoundPreference,
} from './sorteRevesRevealSound.js'
import {
  readGameSoundEnabled,
  setGameSoundEnabled,
  subscribeGameSound,
} from '../utils/gameSoundPreference.js'
import './sorte-reves.css'

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
 *
 * APRESENTAÇÃO: geometria Three.js e conteúdo DOM, independentes do efeito.
 * O áudio existente acompanha a revelação; adiantar nunca confirma a carta.
 */

export default function SorteRevesModal({ onResolve, player = {} }) {
  const confirmRef = useRef(null)
  const frameRef = useRef(null)
  const advanceRef = useRef(null)
  const advanceButtonRef = useRef(null)

  const CARDS = SORTE_REVES_CARDS

  // Sorteia uma carta ao abrir
  const [card] = useState(() => CARDS[Math.floor(Math.random() * CARDS.length)])

  // Calcula efeito resolvido para EXIBIÇÃO e para o payload
  // Fonte única: sorteRevesDeck.js (mesma lógica, agora testável sem DOM).
  const resolved = useMemo(() => resolveCardEffect(card, player), [card, player])

  // Mídia decorativa: sai do kind da carta, nunca do sinal do efeito.
  const mediaVariant = useMemo(() => mediaVariantForCard(card), [card])

  // Trava local por abertura: clique duplo / Enter+Space não confirmam duas vezes.
  const confirmGuard = useRef(null)
  if (!confirmGuard.current) confirmGuard.current = createOnceGuard()

  // Som da revelação: preferência da carta + mute geral da partida.
  const [soundOn, setSoundOn] = useState(readRevealSoundPreference)
  const soundOnRef = useRef(soundOn)
  soundOnRef.current = soundOn
  const [masterSoundOn, setMasterSoundOn] = useState(readGameSoundEnabled)
  useEffect(() => subscribeGameSound(setMasterSoundOn), [])
  const soundRef = useRef(null)
  const revealedRef = useRef(false)
  const effectiveSoundOn = masterSoundOn && soundOn

  // O assentamento do Three.js ou fallback DOM libera o texto sobre a carta
  // e dispara o som. Só apresentação: não encosta no turno nem no efeito.
  const [revealed, setRevealed] = useState(false)
  const handleReveal = useCallback(() => {
    if (revealedRef.current) return
    revealedRef.current = true
    setRevealed(true)
    soundRef.current?.play()
  }, [])

  useEffect(() => {
    const session = openRevealSoundSession({
      variant: mediaVariant,
      isEnabled: () => soundOnRef.current,
      revealed: revealedRef,
    })
    soundRef.current = session.sound
    return () => {
      soundRef.current = null
      session.cleanup()
    }
  }, [mediaVariant])

  const toggleSound = () => {
    if (effectiveSoundOn) {
      setSoundOn(false)
      soundOnRef.current = false
      writeRevealSoundPreference(false)
      soundRef.current?.stop()
      return
    }
    setSoundOn(true)
    soundOnRef.current = true
    writeRevealSoundPreference(true)
    if (!masterSoundOn) setGameSoundEnabled(true)
    if (revealedRef.current) soundRef.current?.play({ explicit: true })
  }

  const resolve = () => {
    if (!revealedRef.current || !confirmGuard.current()) return
    soundRef.current?.stop()
    onResolve?.(resolved.payload)
  }

  // Foco e scroll pertencem ao modal; o renderer nunca fecha o diálogo.
  useEffect(() => {
    const prev = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    advanceButtonRef.current?.focus()
    return () => { document.body.style.overflow = prev }
  }, [])
  useEffect(() => { if (revealed) confirmRef.current?.focus() }, [revealed])

  const trapFocus = (event) => {
    if (event.key !== 'Tab') return
    const focusable = [...event.currentTarget.querySelectorAll('button:not(:disabled), [tabindex="0"]')]
      .filter(el => !el.closest('[aria-hidden="true"]'))
    const first = focusable[0], last = focusable.at(-1)
    if (!first) return
    if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus() }
    else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus() }
  }

  return (
    <div className={`sr3d-wrap${revealed ? ' is-revealed' : ''}`} role="dialog" aria-modal="true" aria-label="Sorte e Revés" onKeyDown={trapFocus}>
      <SorteRevesScene variant={mediaVariant} frameRef={frameRef} advanceRef={advanceRef} onRevealed={handleReveal} />
      {!revealed && (
        <button ref={advanceButtonRef} type="button" className="sr3d-advance" onClick={() => advanceRef.current?.()} aria-label="Adiantar animação e revelar carta">
          <span>Toque para revelar a carta</span>
        </button>
      )}
      <SorteRevesCardContent
        frameRef={frameRef}
        variant={mediaVariant}
        title={card.title}
        text={resolved.text}
        cashDelta={resolved.payload.cashDelta}
        revealed={revealed}
      >
        <TileContextHint kind="LUCK" />
        <p className="sr3d-confirmHint">O efeito desta carta é aplicado imediatamente ao confirmar.</p>
        <div className="sr3d-actionsRow">
          <button ref={confirmRef} type="button" className="sr3d-ok" disabled={!revealed} onClick={resolve}>OK</button>
          <button type="button" className="sr3d-sound" aria-pressed={effectiveSoundOn} onClick={toggleSound}>
            <span aria-hidden="true">{effectiveSoundOn ? '🔊' : '🔇'}</span>
            {effectiveSoundOn ? 'Som ligado' : 'Som desligado'}
          </button>
        </div>
      </SorteRevesCardContent>
      <span className="sr3d-srOnly" role="status" aria-live="polite" aria-atomic="true">
        {revealed ? `${card.kind === 'SORTE' ? 'Sorte' : 'Revés'}. ${card.title}. ${resolved.text}` : 'Revelando carta de Sorte e Revés.'}
      </span>
    </div>
  )
}
