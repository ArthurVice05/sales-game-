// Lógica pura do cronômetro de turno (autoridade + anti double-skip).
// Separado do auto-skip offline por presença; reutiliza o mesmo planner de avanço.

import { planOfflineTurnSkip } from './offlineTurnSkip.js'
import {
  DEFAULT_TURN_TIME_SEC,
  normalizeTurnTime,
  resolveTurnTimeSecFromState,
} from './turnTimeConfig.js'
import { normalizeMaxRounds, DEFAULT_MAX_ROUNDS } from './roundConfig.js'
import { normalizeBotConfig } from './bots/botRoster.js'

export function turnAttemptKey(turnPlayerId, turnSeq) {
  return `${String(turnPlayerId ?? '')}|${Number(turnSeq) || 0}`
}

export function computeTurnDeadlineAt(nowMs, turnTimeSec) {
  const sec = normalizeTurnTime(turnTimeSec)
  const now = Number(nowMs)
  const base = Number.isFinite(now) ? now : Date.now()
  return base + sec * 1000
}

export function remainingTurnMs(turnDeadlineAt, nowMs = Date.now()) {
  const deadline = Number(turnDeadlineAt)
  if (!Number.isFinite(deadline)) return 0
  const now = Number(nowMs)
  const t = Number.isFinite(now) ? now : Date.now()
  return Math.max(0, deadline - t)
}

/**
 * Se o próximo jogador herda um prazo já estourado (ou com poucos segundos),
 * o coordenador pulava a vez na hora — “passa a vez sem jogar”.
 */
export const TURN_HANDOFF_STALE_REMAINING_MS = 20_000

export function sanitizeTurnDeadlineOnHandoff({
  prevTurnPlayerId,
  nextTurnPlayerId,
  prevTurnSeq,
  nextTurnSeq,
  currentDeadlineAt,
  now = Date.now(),
  turnTimeSec,
} = {}) {
  const handedOff =
    String(prevTurnPlayerId ?? '') !== String(nextTurnPlayerId ?? '') ||
    (Number(prevTurnSeq) || 0) !== (Number(nextTurnSeq) || 0)

  const fresh = () => computeTurnDeadlineAt(now, turnTimeSec)
  const current = Number(currentDeadlineAt)

  if (!handedOff) {
    return Number.isFinite(current) ? current : fresh()
  }

  const remaining = remainingTurnMs(current, now)
  if (remaining < TURN_HANDOFF_STALE_REMAINING_MS) {
    return fresh()
  }
  return current
}

export function resolveTurnDeadlineAfterHandoff({
  prevTurnPlayerId,
  prevTurnSeq,
  nextTurnPlayerId,
  nextTurnSeq,
  incomingDeadlineAt,
  currentDeadlineAt,
  now = Date.now(),
  turnTimeSec,
  hasIncomingDeadline = false,
} = {}) {
  const handedOff =
    String(prevTurnPlayerId ?? '') !== String(nextTurnPlayerId ?? '') ||
    (Number(prevTurnSeq) || 0) !== (Number(nextTurnSeq) || 0)

  let base = Number(currentDeadlineAt)
  if (hasIncomingDeadline) {
    const incoming = Number(incomingDeadlineAt)
    base = Number.isFinite(incoming) ? incoming : NaN
  }
  if (!Number.isFinite(base)) {
    base = computeTurnDeadlineAt(now, turnTimeSec)
  }

  if (!handedOff) return base

  return sanitizeTurnDeadlineOnHandoff({
    prevTurnPlayerId,
    nextTurnPlayerId,
    prevTurnSeq,
    nextTurnSeq,
    currentDeadlineAt: base,
    now,
    turnTimeSec,
  })
}

export function shouldArmTimerSkipForTurn({
  remainingMs,
  minRemainingMs = TURN_HANDOFF_STALE_REMAINING_MS,
} = {}) {
  return Number(remainingMs) >= Number(minRemainingMs)
}

export function shouldArmCoordinatorTimer({ remainingMs, turnDeadlineAt } = {}) {
  if (shouldArmTimerSkipForTurn({ remainingMs })) return true
  const deadline = Number(turnDeadlineAt)
  if (!Number.isFinite(deadline)) return false
  return Number(remainingMs) < TURN_HANDOFF_STALE_REMAINING_MS
}

/**
 * Config da partida no lobby / rooms.state (fonte única).
 */
export function normalizeMatchConfig(partial = {}, fallbacks = {}) {
  const maxRounds = normalizeMaxRounds(
    partial?.maxRounds,
    fallbacks.maxRounds ?? DEFAULT_MAX_ROUNDS
  )
  const turnTimeSec = Object.prototype.hasOwnProperty.call(partial || {}, 'turnTimeSec')
    ? normalizeTurnTime(partial.turnTimeSec, fallbacks.turnTimeSec ?? DEFAULT_TURN_TIME_SEC)
    : normalizeTurnTime(
        fallbacks.turnTimeSec,
        DEFAULT_TURN_TIME_SEC
      )

  return { maxRounds, turnTimeSec }
}

/** Merge seguro de settings de lobby sem apagar players/jogo em andamento. */
export function mergeLobbyMatchSettings(prevState = {}, nextSettings = {}) {
  const prev = prevState && typeof prevState === 'object' ? prevState : {}
  const cfg = normalizeMatchConfig(nextSettings, {
    maxRounds: prev.maxRounds,
    turnTimeSec: Object.prototype.hasOwnProperty.call(prev, 'turnTimeSec')
      ? prev.turnTimeSec
      : DEFAULT_TURN_TIME_SEC,
  })

  const next = {
    ...prev,
    maxRounds: cfg.maxRounds,
    turnTimeSec: cfg.turnTimeSec,
    kind: Array.isArray(prev.players) && prev.players.length > 0
      ? (prev.kind || 'TURN')
      : 'LOBBY_SETTINGS',
  }
  if (Object.prototype.hasOwnProperty.call(nextSettings || {}, 'botConfig')) {
    next.botConfig = normalizeBotConfig({
      ...(prev.botConfig || {}),
      ...(nextSettings.botConfig || {}),
    })
  } else if (prev.botConfig) {
    next.botConfig = normalizeBotConfig(prev.botConfig)
  }
  return next
}

/**
 * Decide se o coordinator pode tentar auto-pass por timer.
 * Não avança sozinho — só autoriza a tentativa (CAS fica no skipAbsentTurn).
 */
export function shouldAttemptTimerAutoPass({
  now,
  turnDeadlineAt,
  turnLock,
  gameOver,
  amCoordinator,
  turnPlayerId,
  turnSeq,
  lastAttemptKey,
  inFlight,
} = {}) {
  if (gameOver) return { ok: false, reason: 'game-over' }
  if (!amCoordinator) return { ok: false, reason: 'not-coordinator' }
  if (inFlight) return { ok: false, reason: 'in-flight' }
  if (!turnPlayerId) return { ok: false, reason: 'no-turn-player' }

  // Modal/roll críticos: turnLock compartilhado. Timer visual pode zerar,
  // mas auto-pass só com motor seguro (lock livre).
  if (turnLock) return { ok: false, reason: 'turn-locked' }

  const deadline = Number(turnDeadlineAt)
  if (!Number.isFinite(deadline)) return { ok: false, reason: 'no-deadline' }
  const t = Number.isFinite(Number(now)) ? Number(now) : Date.now()
  if (t < deadline) return { ok: false, reason: 'not-expired' }

  const key = turnAttemptKey(turnPlayerId, turnSeq)
  if (lastAttemptKey != null && String(lastAttemptKey) === key) {
    return { ok: false, reason: 'already-attempted' }
  }

  return { ok: true, attemptKey: key, reason: 'expired' }
}

/**
 * Planeja avanço por timer (mesma regra do skip offline: próximo vivo, +1 turnSeq).
 */
export function planTurnTimerPass(args) {
  return planOfflineTurnSkip(args)
}

/**
 * Proteção contra double-skip entre offline e timer (mesmo turnKey).
 */
export function shouldBlockDuplicateSkip({
  attemptKey,
  lastOfflineSkipKey,
  lastTimerSkipKey,
} = {}) {
  const key = attemptKey != null ? String(attemptKey) : ''
  if (!key) return true
  if (lastOfflineSkipKey != null && String(lastOfflineSkipKey) === key) return true
  if (lastTimerSkipKey != null && String(lastTimerSkipKey) === key) return true
  return false
}

/**
 * Deadline autoritativo: usa rooms.state se válido para o turnSeq atual;
 * senão calcula a partir de now (fallback partidas antigas / first paint).
 */
export function resolveAuthoritativeDeadline({
  stateDeadlineAt,
  stateTurnSeq,
  currentTurnSeq,
  turnTimeSec,
  now = Date.now(),
} = {}) {
  const curSeq = Number(currentTurnSeq) || 0
  const stateSeq = stateTurnSeq != null ? Number(stateTurnSeq) : curSeq
  const deadline = Number(stateDeadlineAt)
  const sec = normalizeTurnTime(turnTimeSec)

  if (
    Number.isFinite(deadline) &&
    stateSeq === curSeq
  ) {
    return deadline
  }

  return computeTurnDeadlineAt(now, sec)
}

export function readMatchConfigFromRoomState(state) {
  const maxRounds = Object.prototype.hasOwnProperty.call(state || {}, 'maxRounds')
    ? normalizeMaxRounds(state.maxRounds)
    : DEFAULT_MAX_ROUNDS
  const turnTimeSec = resolveTurnTimeSecFromState(state, DEFAULT_TURN_TIME_SEC)
  if (!Object.prototype.hasOwnProperty.call(state || {}, 'botConfig')) {
    return { maxRounds, turnTimeSec }
  }
  return { maxRounds, turnTimeSec, botConfig: normalizeBotConfig(state.botConfig) }
}
