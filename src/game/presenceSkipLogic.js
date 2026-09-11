/**
 * Presença durante a partida: só HUD (“aguardando reconexão”).
 *
 * Pular o turno NÃO é por last_seen. Celular (aba em segundo plano, timer
 * throttled) parece offline e, com 4 jogadores, o host pulava 2–3 pessoas
 * em sequência. O avanço por ausência/AFK é só o cronômetro do turno
 * (`useTurnTimerAutoPass`).
 */
import { turnAttemptKey } from './turnTimerLogic.js'
import { shouldAllowRemoteAutoPassThroughLock } from './decisionTimeoutPolicy.js'

/** @deprecated HUD only — não dispara skip. Mantido para testes/compat. */
export const GAME_ABSENCE_SKIP_GRACE_MS = 15_000

export function shouldRejectAbsentTurnSkip({
  turnLock = false,
  lastRollTurnKey = null,
  expectedTurnSeq = 0,
  decisionHold = null,
  expectedTurnPlayerId = null,
} = {}) {
  if (turnLock) {
    const through = shouldAllowRemoteAutoPassThroughLock({
      turnLock: true,
      decisionHold,
      expectedTurnPlayerId,
      expectedTurnSeq,
    })
    if (!through.ok) return { reject: true, reason: through.reason || 'turn-locked' }
    return { reject: false, reason: 'optional-expire' }
  }
  if (
    lastRollTurnKey != null &&
    String(lastRollTurnKey) === String(expectedTurnSeq)
  ) {
    return { reject: true, reason: 'already-rolled' }
  }
  return { reject: false, reason: 'ok' }
}

/**
 * @returns {{ ok: boolean, reason: string, waitingSinceMs: number|null }}
 */
export function shouldAttemptPresenceAutoSkip({
  turnPresent = false,
  turnLock = false,
  gameOver = false,
  amCoordinator = false,
  turnPlayerId = '',
  turnSeq = 0,
  waitingSinceMs = null,
  now = Date.now(),
  inFlight = false,
} = {}) {
  void amCoordinator
  void inFlight
  void turnSeq

  if (gameOver) {
    return { ok: false, reason: 'game-over', waitingSinceMs: null }
  }
  if (!turnPlayerId) {
    return { ok: false, reason: 'no-turn-player', waitingSinceMs: null }
  }
  if (turnLock) {
    return { ok: false, reason: 'turn-locked', waitingSinceMs: null }
  }
  if (turnPresent) {
    return { ok: false, reason: 'present', waitingSinceMs: null }
  }

  const t = Number.isFinite(Number(now)) ? Number(now) : Date.now()
  const started = waitingSinceMs == null ? NaN : Number(waitingSinceMs)
  const nextWaiting = Number.isFinite(started) ? started : t

  return {
    ok: false,
    reason: 'hud-only-wait',
    waitingSinceMs: nextWaiting,
    attemptKey: turnAttemptKey(turnPlayerId, turnSeq),
  }
}
