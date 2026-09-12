/**
 * Som de dado rolando + impacto final (Web Audio, sem arquivo).
 * Timbre: rattling/cliques (versão anterior, mais “de dado”).
 * Precisa de AudioContext running — unlockDiceAudio no gesto de Rolar.
 */

import { readGameSoundEnabled, registerGameSoundStopper } from './gameSoundPreference.js'

let sharedContext = null
let stoppersRegistered = false

function ensureDiceStopper() {
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

/** Desbloqueia + aquecimento (iOS/Safari). Chamar no clique de “Rolar”. */
export async function unlockDiceAudio() {
  const ctx = getAudioContext()
  if (!ctx) return false
  try {
    if (ctx.state === 'suspended') await ctx.resume()
    const buffer = ctx.createBuffer(1, 1, ctx.sampleRate)
    const src = ctx.createBufferSource()
    src.buffer = buffer
    src.connect(ctx.destination)
    src.start(0)
    return ctx.state === 'running'
  } catch {
    return false
  }
}

function playClick(ctx, time, intensity = 1) {
  const osc = ctx.createOscillator()
  const gain = ctx.createGain()
  const filter = ctx.createBiquadFilter()
  filter.type = 'bandpass'
  filter.frequency.value = 1800 + Math.random() * 1200
  filter.Q.value = 1.2
  osc.type = 'triangle'
  osc.frequency.setValueAtTime(140 + Math.random() * 80, time)
  gain.gain.setValueAtTime(0.0001, time)
  gain.gain.exponentialRampToValueAtTime(0.09 * intensity, time + 0.004)
  gain.gain.exponentialRampToValueAtTime(0.0001, time + 0.045)
  osc.connect(filter)
  filter.connect(gain)
  gain.connect(ctx.destination)
  osc.start(time)
  osc.stop(time + 0.05)
}

function playNoiseBurst(ctx, time, duration = 0.04, intensity = 1) {
  const sampleRate = ctx.sampleRate
  const length = Math.max(1, Math.floor(sampleRate * duration))
  const buffer = ctx.createBuffer(1, length, sampleRate)
  const data = buffer.getChannelData(0)
  for (let i = 0; i < length; i += 1) {
    data[i] = (Math.random() * 2 - 1) * (1 - i / length)
  }
  const src = ctx.createBufferSource()
  src.buffer = buffer
  const filter = ctx.createBiquadFilter()
  filter.type = 'lowpass'
  filter.frequency.value = 900 + Math.random() * 700
  const gain = ctx.createGain()
  gain.gain.setValueAtTime(0.0001, time)
  gain.gain.exponentialRampToValueAtTime(0.12 * intensity, time + 0.005)
  gain.gain.exponentialRampToValueAtTime(0.0001, time + duration)
  src.connect(filter)
  filter.connect(gain)
  gain.connect(ctx.destination)
  src.start(time)
  src.stop(time + duration + 0.01)
}

/** Cascata de cliques enquanto o dado gira (timbre original). */
export async function playDiceTumbleSound(durationMs = 1600) {
  ensureDiceStopper()
  if (!readGameSoundEnabled()) return false
  const ctx = getAudioContext()
  if (!ctx) return false
  try {
    if (ctx.state === 'suspended') await ctx.resume()
  } catch {
    return false
  }
  if (ctx.state !== 'running') return false
  if (!readGameSoundEnabled()) return false

  const now = ctx.currentTime + 0.02
  const duration = Math.max(0.4, durationMs / 1000)
  const clicks = Math.floor(10 + duration * 8)
  for (let i = 0; i < clicks; i += 1) {
    const t = now + (i / clicks) * duration * (0.55 + Math.random() * 0.2)
    const intensity = 0.55 + (1 - i / clicks) * 0.55
    playNoiseBurst(ctx, t, 0.03 + Math.random() * 0.02, intensity)
    playClick(ctx, t + 0.002, intensity)
  }

  return true
}

/** Impacto seco quando o dado para (timbre original). */
export async function playDiceLandSound() {
  ensureDiceStopper()
  if (!readGameSoundEnabled()) return false
  const ctx = getAudioContext()
  if (!ctx) return false
  try {
    if (ctx.state === 'suspended') await ctx.resume()
  } catch {
    return false
  }
  if (ctx.state !== 'running') return false
  if (!readGameSoundEnabled()) return false

  const now = ctx.currentTime
  playNoiseBurst(ctx, now, 0.08, 1.35)
  playClick(ctx, now + 0.01, 1.4)

  const osc = ctx.createOscillator()
  const gain = ctx.createGain()
  osc.type = 'sine'
  osc.frequency.setValueAtTime(90, now)
  osc.frequency.exponentialRampToValueAtTime(55, now + 0.12)
  gain.gain.setValueAtTime(0.0001, now)
  gain.gain.exponentialRampToValueAtTime(0.14, now + 0.01)
  gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.18)
  osc.connect(gain)
  gain.connect(ctx.destination)
  osc.start(now)
  osc.stop(now + 0.2)
  return true
}
