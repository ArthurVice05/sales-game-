/**
 * Preferência local de áudio da partida (por navegador/dispositivo).
 * Não entra no estado compartilhado / Supabase.
 *
 * Mute geral prevalece sobre o mute só de Sorte & Revés (`sg:sorteRevesSound`).
 */

export const GAME_SOUND_PREFERENCE_KEY = 'sg:gameSound'

function defaultStorage() {
  try {
    return typeof window !== 'undefined' ? window.localStorage : null
  } catch {
    return null
  }
}

const listeners = new Set()
const stoppers = new Set()

export function readGameSoundEnabled(storage) {
  const store = storage === undefined ? defaultStorage() : storage
  try {
    return store?.getItem(GAME_SOUND_PREFERENCE_KEY) !== '0'
  } catch {
    return true
  }
}

export function writeGameSoundEnabled(enabled, storage) {
  const store = storage === undefined ? defaultStorage() : storage
  try {
    store?.setItem(GAME_SOUND_PREFERENCE_KEY, enabled ? '1' : '0')
  } catch {
    // storage indisponível: preferência vale só nesta sessão
  }
}

export function subscribeGameSound(listener) {
  if (typeof listener !== 'function') return () => {}
  listeners.add(listener)
  return () => { listeners.delete(listener) }
}

/** Registra callback para interromper sons em andamento ao desligar. */
export function registerGameSoundStopper(stopFn) {
  if (typeof stopFn !== 'function') return () => {}
  stoppers.add(stopFn)
  return () => { stoppers.delete(stopFn) }
}

export function notifyGameSoundStoppers() {
  for (const stop of [...stoppers]) {
    try { stop() } catch { /* som não pode travar o jogo */ }
  }
}

/**
 * Liga/desliga o áudio geral. Ao desligar, interrompe sons ativos.
 * Não reproduz efeitos antigos ao religar.
 */
export function setGameSoundEnabled(enabled, storage) {
  const next = !!enabled
  writeGameSoundEnabled(next, storage)
  if (!next) notifyGameSoundStoppers()
  for (const listener of [...listeners]) {
    try { listener(next) } catch { /* UI não pode travar o jogo */ }
  }
  return next
}

export function toggleGameSoundEnabled(storage) {
  const next = !readGameSoundEnabled(storage)
  return setGameSoundEnabled(next, storage)
}
