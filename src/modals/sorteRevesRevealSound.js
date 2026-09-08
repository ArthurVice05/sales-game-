/**
 * Efeito sonoro da revelação de Sorte & Revés — apresentação e nada mais.
 *
 * Este módulo não conhece carta, efeito, jogador nem turno: recebe a variante já
 * decidida pelo `kind` e toca um arquivo, uma vez por abertura. Falhar aqui é
 * inofensivo — o jogo segue e a confirmação nunca espera pelo áudio.
 *
 * Usa `Audio` nativo, e não o AudioContext do dado/peão: desbloquear aquele
 * contexto não desbloqueia um elemento novo, e este som precisa poder ser
 * cortado e descartado por abertura sem tocar em recursos compartilhados.
 */

const SOUND_BASE = '/media/sorte-reves'

export const REVEAL_SOUND_PREFERENCE_KEY = 'sg:sorteRevesSound'

// Sorte tem nível médio ~7 dB abaixo de Revés; o ganho compensa a diferença.
const REVEAL_SOUND_VOLUMES = Object.freeze({ sorte: 0.8, reves: 0.35 })

function normalizeVariant(variant) {
  return variant === 'sorte' ? 'sorte' : 'reves'
}

export function revealSoundSourceFor(variant) {
  return `${SOUND_BASE}/${normalizeVariant(variant)}.mp3`
}

export function revealSoundVolumeFor(variant) {
  return REVEAL_SOUND_VOLUMES[normalizeVariant(variant)]
}

/* ---------------------------------------------------------------- preferência */

function defaultStorage() {
  try {
    return typeof window !== 'undefined' ? window.localStorage : null
  } catch {
    return null
  }
}

export function readRevealSoundPreference(storage) {
  const store = storage === undefined ? defaultStorage() : storage
  try {
    return store?.getItem(REVEAL_SOUND_PREFERENCE_KEY) !== '0'
  } catch {
    return true
  }
}

export function writeRevealSoundPreference(enabled, storage) {
  const store = storage === undefined ? defaultStorage() : storage
  try {
    store?.setItem(REVEAL_SOUND_PREFERENCE_KEY, enabled ? '1' : '0')
  } catch {
    // modo privado / storage bloqueado: a preferência vale só nesta abertura
  }
}

/* ---------------------------------------------------------------- controlador */

function defaultAudioFactory(src) {
  if (typeof window === 'undefined' || typeof window.Audio !== 'function') return null
  try {
    const el = new window.Audio()
    el.preload = 'auto'
    el.loop = false
    el.src = src
    return el
  } catch {
    return null
  }
}

/**
 * Controlador de UMA abertura do modal.
 *
 * play() é idempotente: eventos repetidos do vídeo, troca de fonte ou novas
 * props não geram uma segunda reprodução. `explicit` existe só para o controle
 * de som reativar algo que o navegador bloqueou — nunca para retentar sozinho.
 */
export function createRevealSound(variant, options = {}) {
  const createAudio = options.createAudio || defaultAudioFactory
  const isEnabled = options.isEnabled || (() => true)
  const src = revealSoundSourceFor(variant)
  const volume = revealSoundVolumeFor(variant)

  let audio = null
  let attempted = false
  let heard = false
  let blocked = false
  let disposed = false
  // Cada reprodução recebe uma geração; parar/descartar invalida as conclusões
  // assíncronas pendentes para não vazar som para a abertura seguinte.
  let generation = 0

  const release = () => {
    const el = audio
    audio = null
    if (!el) return
    try { el.pause() } catch { /* elemento já descartado */ }
    try { el.removeAttribute?.('src'); el.load?.() } catch { /* idem */ }
  }

  return {
    play({ explicit = false } = {}) {
      if (disposed || heard) return 'skipped'
      if (attempted && !explicit) return 'skipped'
      if (!isEnabled()) return 'off'

      const el = createAudio(src)
      if (!el) { attempted = true; return 'unavailable' }

      attempted = true
      audio = el
      const gen = ++generation
      try { el.volume = volume } catch { /* alguns navegadores travam volume */ }

      let started
      try {
        started = el.play?.()
      } catch {
        blocked = true
        release()
        return 'blocked'
      }

      if (started && typeof started.then === 'function') {
        started.then(
          () => { if (gen === generation && !disposed) heard = true },
          () => {
            if (gen !== generation) return
            blocked = true
            release()
          },
        )
      } else {
        heard = true
      }
      return 'started'
    },

    /** Confirmação, som desligado ou aba oculta: corta agora. */
    stop() {
      generation += 1
      release()
    },

    /** Desmontagem: corta, invalida pendências e não aceita mais nada. */
    dispose() {
      disposed = true
      generation += 1
      release()
    },

    get state() {
      return { attempted, heard, blocked, disposed }
    },
  }
}

/**
 * Ciclo de vida de uma abertura, na forma que o `useEffect` do modal consome.
 * Setup e cleanup andam em par — em StrictMode o React faz setup → cleanup →
 * setup, e cada setup recebe um controlador novo, então a revelação continua
 * tocando uma vez só.
 *
 * `revealed` é a caixa (ref) que diz se a carta já foi revelada antes deste
 * efeito rodar: o efeito do filho (vídeo) roda antes do efeito do pai, então
 * fallback e movimento reduzido revelam antes desta função existir.
 */
export function openRevealSoundSession({ variant, createAudio, isEnabled, doc, revealed }) {
  const target = doc || (typeof document !== 'undefined' ? document : null)
  const sound = createRevealSound(variant, { createAudio, isEnabled })

  const onVisibilityChange = () => {
    if (target?.visibilityState === 'hidden') sound.stop()
  }
  target?.addEventListener?.('visibilitychange', onVisibilityChange)

  if (revealed?.current) sound.play()

  return {
    sound,
    cleanup() {
      target?.removeEventListener?.('visibilitychange', onVisibilityChange)
      sound.dispose()
    },
  }
}
