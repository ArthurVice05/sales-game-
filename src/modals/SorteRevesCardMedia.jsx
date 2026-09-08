// src/modals/SorteRevesCardMedia.jsx
import React, { useEffect, useMemo, useReducer, useRef, useState } from 'react'
import {
  MEDIA_PHASES,
  SETTLE_SECONDS,
  initialPresentation,
  mediaSourcesFor,
  reducePresentation,
} from './sorteRevesPresentation.js'

/**
 * Animação 3D da carta de Sorte & Revés — apresentação e nada mais.
 *
 * O componente é decorativo: está fora da árvore acessível (aria-hidden) e não
 * recebe cliques. Nenhum evento daqui avança o turno ou aplica efeito; o único
 * estado que ele produz é qual quadro está na tela.
 *
 * Fallback: o quadro final em PNG entra por cima assim que o vídeo termina,
 * falha, demora demais ou quando o sistema pede movimento reduzido. O vídeo
 * continua montado embaixo, exibindo o último quadro, para a troca não piscar.
 */

// Sem dados após este tempo => quadro final (rede lenta, formato recusado).
const LOAD_TIMEOUT_MS = 2500
// Guarda geral: 2,4 s de animação + folga. Uma tentativa só, sem reintentos.
const PLAYBACK_GUARD_MS = 4500

function prefersReducedMotion() {
  try {
    return typeof window !== 'undefined'
      && typeof window.matchMedia === 'function'
      && window.matchMedia('(prefers-reduced-motion: reduce)').matches
  } catch {
    return false
  }
}

export default function SorteRevesCardMedia({ variant, onReveal }) {
  const videoRef = useRef(null)
  const onRevealRef = useRef(onReveal)
  onRevealRef.current = onReveal
  const [reducedMotion] = useState(prefersReducedMotion)
  const [presentation, dispatch] = useReducer(
    reducePresentation,
    reducedMotion,
    initialPresentation,
  )

  const src = useMemo(() => mediaSourcesFor(variant), [variant])
  const isFinal = presentation.phase === MEDIA_PHASES.FINAL

  useEffect(() => {
    if (reducedMotion) return undefined
    const el = videoRef.current
    if (!el) return undefined

    const timers = [
      // readyState < HAVE_CURRENT_DATA depois da espera limitada: desiste.
      setTimeout(() => { if (el.readyState < 2) dispatch({ type: 'timeout' }) }, LOAD_TIMEOUT_MS),
      setTimeout(() => dispatch({ type: 'timeout' }), PLAYBACK_GUARD_MS),
    ]

    const started = el.play?.()
    if (started && typeof started.catch === 'function') {
      started.catch(() => dispatch({ type: 'playRejected' }))
    }

    return () => {
      timers.forEach(clearTimeout)
      try { el.pause() } catch { /* elemento já descartado */ }
    }
  }, [reducedMotion])

  // A revelação é a mesma transição visual do `settled`: 1,47 s de vídeo, ou já
  // no mount quando a apresentação começa direto no PNG (fallback/movimento
  // reduzido). `settled` nunca volta atrás, então isto dispara uma vez só.
  useEffect(() => {
    if (presentation.settled) onRevealRef.current?.()
  }, [presentation.settled])

  const stageClass = [
    'sr3d-media',
    `sr3d-media--${variant === 'sorte' ? 'sorte' : 'reves'}`,
    presentation.settled ? 'is-settled' : '',
  ].filter(Boolean).join(' ')

  return (
    <div className={stageClass} aria-hidden="true">
      {!reducedMotion && (
        <video
          ref={videoRef}
          className="sr3d-video"
          muted
          playsInline
          autoPlay
          preload="metadata"
          tabIndex={-1}
          onEnded={() => dispatch({ type: 'ended' })}
          onError={() => dispatch({ type: 'error' })}
          onTimeUpdate={(e) => dispatch({ type: 'timeupdate', currentTime: e.currentTarget.currentTime })}
        >
          {/* WebM transparente primeiro; MP4 opaco (#07111F) como alternativa.
              Quando a lista de fontes se esgota o evento chega no <source>, não
              no <video> — por isso o quadro final também é acionado daqui. */}
          <source src={src.webm} type="video/webm" />
          <source src={src.mp4} type="video/mp4" onError={() => dispatch({ type: 'error' })} />
        </video>
      )}

      <img
        className={`sr3d-poster${isFinal ? ' is-on' : ''}`}
        src={src.poster}
        alt=""
        draggable="false"
      />
    </div>
  )
}

export { SETTLE_SECONDS }
