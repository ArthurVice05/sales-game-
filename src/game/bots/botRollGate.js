/** Resultado de advanceAndMaybeLap ao tentar iniciar movimento. */
export const ADVANCE_STARTED = true
export const ADVANCE_PENDING = 'pending'
export const ADVANCE_REJECTED = false

export function classifyAdvanceStart(started) {
  if (started === true || started === 'started' || started === ADVANCE_STARTED) return 'STARTED'
  if (started === ADVANCE_PENDING || started === 'pending') return 'PENDING'
  return 'REJECTED'
}

export function interpretAdvanceStartResult(started) {
  const status = classifyAdvanceStart(started)
  if (status === 'STARTED') return { ok: true, retry: false, status }
  if (status === 'PENDING') {
    return { ok: false, reason: 'roll-pending-modals', retry: true, status }
  }
  return { ok: false, reason: 'roll-not-started', retry: true, status }
}

export function toBotOnActionRollResult(started) {
  const interpreted = interpretAdvanceStartResult(started)
  if (interpreted.ok === true) return { ok: true }
  return {
    ok: false,
    reason: interpreted.reason,
    retry: interpreted.retry === true,
  }
}

/**
 * Humano: agenda retry interno e devolve true (assinatura antiga).
 * Máquina: não agenda; devolve PENDING para o controlador.
 */
export function resolveAdvanceWhenModalsBusy(scheduleInternalRetry = true) {
  if (scheduleInternalRetry) return true
  return ADVANCE_PENDING
}

/**
 * Humano: marca lastRollTurnKey antes do advance (proteção de duplo clique).
 * Máquina: marca somente depois de STARTED.
 */
export function shouldMarkLastRollTurnKeyNow({
  isBotRoll = false,
  phase = 'before-advance',
  advanceResult,
} = {}) {
  if (isBotRoll) {
    return phase === 'after-advance' && classifyAdvanceStart(advanceResult) === 'STARTED'
  }
  return phase === 'before-advance'
}
