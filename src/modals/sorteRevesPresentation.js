/**
 * Apresentação de Sorte & Revés — estado VISUAL puro.
 *
 * Este módulo não conhece o baralho, o jogador, o payload nem o turno: ele só
 * decide o que a tela mostra. Eventos de mídia (loadeddata, timeupdate, ended,
 * error, timeout, play() rejeitado) entram aqui e não saem em lugar nenhum do
 * fluxo de jogo — a aplicação do efeito continua exclusivamente na confirmação.
 */

// Mídia renderizada no Blender, copiada para public/media/sorte-reves/.
export const SORTE_REVES_MEDIA_BASE = '/media/sorte-reves'

// A carta termina o giro no quadro 45 de 72, a 30 fps.
export const SETTLE_SECONDS = 1.47

/**
 * Área livre da frente da carta no quadro final, em fração do quadro inteiro
 * (960 × 1200). É onde o texto real da carta é sobreposto — quando couber.
 */
export const CARD_TEXT_AREA = Object.freeze({
  left: 0.255,
  top: 0.47,
  width: 0.49,
  height: 0.31,
})

export const MEDIA_PHASES = Object.freeze({
  ANIMATING: 'animating', // vídeo rodando; o PNG final ainda não pode aparecer
  FINAL: 'final',         // quadro final: fim normal, falha ou movimento reduzido
})

/** A mídia vem do `kind` já sorteado — nunca do sinal do efeito financeiro. */
export function mediaVariantForCard(card) {
  return card?.kind === 'SORTE' ? 'sorte' : 'reves'
}

export function mediaSourcesFor(variant) {
  const name = variant === 'sorte' ? 'sorte' : 'reves'
  return {
    webm: `${SORTE_REVES_MEDIA_BASE}/${name}.webm`, // VP9 com alfa
    mp4: `${SORTE_REVES_MEDIA_BASE}/${name}.mp4`,   // H.264 opaco (#07111F)
    poster: `${SORTE_REVES_MEDIA_BASE}/${name}-poster.png`,
  }
}

export function initialPresentation(reducedMotion) {
  return reducedMotion
    ? { phase: MEDIA_PHASES.FINAL, settled: true }
    : { phase: MEDIA_PHASES.ANIMATING, settled: false }
}

const FINAL_STATE = Object.freeze({ phase: MEDIA_PHASES.FINAL, settled: true })

/**
 * Reduz um evento de mídia sobre o estado visual.
 * Retorna o mesmo objeto quando nada muda (evita re-render à toa) e nunca
 * volta do quadro final para a animação.
 */
export function reducePresentation(state, event) {
  const cur = state || initialPresentation(false)
  if (cur.phase === MEDIA_PHASES.FINAL) return cur

  switch (event?.type) {
    case 'ended':
    case 'error':
    case 'timeout':
    case 'playRejected':
      return { ...FINAL_STATE }

    case 'timeupdate': {
      const t = Number(event.currentTime)
      if (!Number.isFinite(t) || t < SETTLE_SECONDS || cur.settled) return cur
      return { phase: cur.phase, settled: true }
    }

    default:
      return cur
  }
}

/**
 * Trava local por abertura do modal: libera a primeira confirmação e recusa
 * clique duplo / Enter + Space repetidos. Não toca no payload.
 */
export function createOnceGuard() {
  let used = false
  return () => {
    if (used) return false
    used = true
    return true
  }
}
