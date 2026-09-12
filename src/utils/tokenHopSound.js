/**
 * Som de pulo cartoon do peão (Web Audio, sem arquivo).
 * Falha silenciosa se AudioContext indisponível / autoplay bloqueado.
 */

import { readGameSoundEnabled, registerGameSoundStopper } from './gameSoundPreference.js'

let sharedContext = null
let stoppersRegistered = false

function ensureHopStopper() {
  if (stoppersRegistered) return
  stoppersRegistered = true
  registerGameSoundStopper(() => {
    try { sharedContext?.suspend?.() } catch { /* mute não pode travar */ }
  })
}

function getAudioContext() {
  if (typeof window === 'undefined') return null
  const AC = window.AudioContext || window.webkitAudioContext
  if (!AC) return null
  if (!sharedContext || sharedContext.state === 'closed') {
    try {
      sharedContext = new AC()
    } catch {
      return null
    }
  }
  return sharedContext
}

/** Desbloqueia o AudioContext após gesto do usuário (obrigatório em mobile). */
export async function unlockTokenHopAudio() {
  const ctx = getAudioContext()
  if (!ctx) return false
  try {
    if (ctx.state === 'suspended') await ctx.resume()
    return ctx.state === 'running'
  } catch {
    return false
  }
}

/**
 * Blip curto estilo desenho (subida + queda).
 * @param {{ muted?: boolean }} [options]
 */
export function playTokenHopSound(options = {}) {
  ensureHopStopper()
  if (options.muted) return false
  if (!readGameSoundEnabled()) return false
  if (typeof window === 'undefined') return false

  try {
    if (window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) {
      return false
    }
  } catch {
    // ignore
  }

  const ctx = getAudioContext()
  if (!ctx) return false

  try {
    if (ctx.state === 'suspended') {
      void ctx.resume()
    }

    const now = ctx.currentTime
    const variation = 0.94 + Math.random() * 0.12

    const osc = ctx.createOscillator()
    const gain = ctx.createGain()
    osc.type = 'triangle'
    osc.frequency.setValueAtTime(300 * variation, now)
    osc.frequency.exponentialRampToValueAtTime(640 * variation, now + 0.04)
    osc.frequency.exponentialRampToValueAtTime(240 * variation, now + 0.11)

    gain.gain.setValueAtTime(0.0001, now)
    gain.gain.exponentialRampToValueAtTime(0.16, now + 0.012)
    gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.13)

    osc.connect(gain)
    gain.connect(ctx.destination)
    osc.start(now)
    osc.stop(now + 0.15)

    return true
  } catch {
    return false
  }
}
