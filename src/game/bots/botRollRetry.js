/**
 * Retry de ROLL da máquina — único proprietário quando advanceAndMaybeLap
 * retorna ADVANCE_PENDING (sem timer interno no motor).
 */
import { runBotRollAttempt } from './botActionResult.js'
import { ADVANCE_PENDING } from './botRollGate.js'

export const BOT_ROLL_RETRY_MS = 200
export const BOT_ROLL_RETRY_MAX = 25

export function shouldBotAdvanceScheduleInternalRetry(isBotTurn) {
  return isBotTurn !== true
}

import { claimProofMatchesLive, resolveAuthoritativeExecutor } from './botClaimProof.js'

export function validateRollRetryContinue({
  signal,
  botsEnabled = true,
  enabled = true,
  matchId,
  turnPlayerId,
  turnSeq,
  turnKey,
  gameOver = false,
  claimValid = true,
  claimProof = null,
  localExecutorId,
  remoteExecutorId,
  lastRollTurnKey,
  expectedMatchId,
  expectedTurnPlayerId,
  expectedTurnSeq,
  expectedTurnKey,
} = {}) {
  if (signal?.aborted) return { ok: false, reason: 'cancelled' }
  if (!enabled || !botsEnabled) return { ok: false, reason: 'cancelled' }
  if (claimValid === false) return { ok: false, reason: 'cancelled' }
  if (gameOver === true) return { ok: false, reason: 'stale-turn' }
  if (String(matchId ?? '') !== String(expectedMatchId ?? '')) {
    return { ok: false, reason: 'stale-turn' }
  }
  if (String(turnPlayerId ?? '') !== String(expectedTurnPlayerId ?? '')) {
    return { ok: false, reason: 'stale-turn' }
  }
  if (Number(turnSeq) !== Number(expectedTurnSeq)) {
    return { ok: false, reason: 'stale-turn' }
  }
  if (String(turnKey ?? '') !== String(expectedTurnKey ?? '')) {
    return { ok: false, reason: 'stale-turn' }
  }
  const rollKey = typeof expectedTurnSeq === 'number' ? String(expectedTurnSeq) : ''
  if (rollKey && lastRollTurnKey != null && String(lastRollTurnKey) === rollKey) {
    return { ok: false, reason: 'stale-turn' }
  }

  const proofCheck = claimProofMatchesLive(claimProof, {
    matchId: expectedMatchId,
    turnPlayerId: expectedTurnPlayerId,
    turnSeq: expectedTurnSeq,
    lastRollTurnKey,
  })
  if (claimProof && !proofCheck.ok) {
    return { ok: false, reason: proofCheck.reason || 'stale-turn' }
  }

  const localExec = localExecutorId != null ? String(localExecutorId) : ''
  const remoteExec = remoteExecutorId != null ? String(remoteExecutorId) : ''
  const authExec = resolveAuthoritativeExecutor({
    claimProof,
    localExecutorId: localExec,
    remoteExecutorId: remoteExec,
  })
  if (!authExec.ok) {
    return { ok: false, reason: authExec.reason || 'stale-turn' }
  }
  return { ok: true }
}

export function sleepCancellable(ms, signal) {
  if (!ms || ms <= 0) return Promise.resolve()
  if (signal?.aborted) return Promise.reject(Object.assign(new Error('cancelled'), { reason: 'cancelled' }))
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      signal?.removeEventListener('abort', onAbort)
      resolve()
    }, ms)
    const onAbort = () => {
      clearTimeout(timer)
      reject(Object.assign(new Error('cancelled'), { reason: 'cancelled' }))
    }
    signal?.addEventListener('abort', onAbort, { once: true })
  })
}

export function classifyHeartbeatTick({
  result,
  error = null,
  live = {},
  expectedTurnPlayerId,
  expectedTurnSeq,
  localExecutorId,
  claimProof = null,
  iAmCoordinator = true,
} = {}) {
  if (live.gameOver === true) {
    return { action: 'abort', kind: 'terminal', reason: 'game-over' }
  }
  if (String(live.turnPlayerId ?? '') !== String(expectedTurnPlayerId ?? '')) {
    return { action: 'abort', kind: 'terminal', reason: 'turn-player-changed' }
  }
  if (Number(live.turnSeq) !== Number(expectedTurnSeq)) {
    return { action: 'abort', kind: 'terminal', reason: 'turn-seq-changed' }
  }
  if (iAmCoordinator === false) {
    return { action: 'abort', kind: 'terminal', reason: 'not-coordinator' }
  }

  const localExec = localExecutorId != null ? String(localExecutorId) : ''
  const remoteExec = live.botClaimExecutor != null ? String(live.botClaimExecutor) : ''
  if (remoteExec && localExec && remoteExec !== localExec) {
    return { action: 'abort', kind: 'terminal', reason: 'other-executor' }
  }

  const proofExec = claimProof?.executorId != null ? String(claimProof.executorId) : ''
  if (remoteExec && proofExec && remoteExec !== proofExec) {
    return { action: 'abort', kind: 'terminal', reason: 'other-executor' }
  }

  const rollKey = expectedTurnSeq != null ? String(expectedTurnSeq) : ''
  if (rollKey && live.lastRollTurnKey != null && String(live.lastRollTurnKey) === rollKey) {
    if (remoteExec && localExec && remoteExec !== localExec) {
      return { action: 'abort', kind: 'terminal', reason: 'already-rolled' }
    }
  }

  if (error) {
    return { action: 'retry', kind: 'transient', reason: 'network-error' }
  }
  if (result == null) {
    return { action: 'retry', kind: 'transient', reason: 'undefined-result' }
  }
  if (result.ok === true && result.casLost !== true) {
    return { action: 'ok', kind: 'ok', reason: 'heartbeat-ok' }
  }
  if (
    result.casLost === true ||
    result.status === 406 ||
    String(result.reason || '') === 'cas-lost' ||
    String(result.reason || '') === 'casLost'
  ) {
    return { action: 'retry', kind: 'transient', reason: 'cas-lost' }
  }
  if (result.ok === false) {
    return { action: 'retry', kind: 'transient', reason: result.reason || 'heartbeat-false' }
  }
  return { action: 'retry', kind: 'transient', reason: 'heartbeat-unknown' }
}

export async function waitForBotPipelineHandoff({
  signal,
  getLive,
  expectedTurnPlayerId,
  expectedTurnSeq,
  pollMs = 100,
  maxWaitMs = 120_000,
  sleep = sleepCancellable,
} = {}) {
  const start = Date.now()
  while (Date.now() - start < maxWaitMs) {
    if (signal?.aborted) return { ok: false, reason: 'cancelled' }
    const live = typeof getLive === 'function' ? getLive() : {}
    if (live.gameOver === true) return { ok: true, reason: 'game-over' }
    if (
      String(live.turnPlayerId ?? '') !== String(expectedTurnPlayerId ?? '') ||
      Number(live.turnSeq) !== Number(expectedTurnSeq)
    ) {
      return { ok: true, reason: 'handoff' }
    }
    try {
      await sleep(pollMs, signal)
    } catch (err) {
      return { ok: false, reason: err?.reason || 'cancelled' }
    }
  }
  return { ok: false, reason: 'handoff-timeout' }
}

/**
 * Loop de retry do controlador com cancelamento e validação de snapshot.
 */
export async function runBotRollRetryLoop({
  executedKeys = [],
  turnKey,
  onBotRoll,
  payload,
  signal,
  shouldContinue,
  maxAttempts = BOT_ROLL_RETRY_MAX,
  delayMs = BOT_ROLL_RETRY_MS,
  sleep = sleepCancellable,
} = {}) {
  let keys = [...executedKeys]
  let rollCalls = 0
  let attempts = 0

  const checkContinue = () => {
    if (typeof shouldContinue === 'function') return shouldContinue()
    if (signal?.aborted) return { ok: false, reason: 'cancelled' }
    return { ok: true }
  }

  for (attempts = 1; attempts <= maxAttempts; attempts++) {
    const before = checkContinue()
    if (!before.ok) {
      return {
        executedKeys: keys,
        movementStarted: 0,
        rollCalls,
        attempts: attempts - 1,
        ok: false,
        reason: before.reason,
        terminal: true,
      }
    }

    rollCalls += 1
    const attempt = await runBotRollAttempt({
      executedKeys: keys,
      turnKey,
      onBotRoll,
      payload,
    })

    if (attempt.result.ok) {
      keys = attempt.executedKeys
      return {
        executedKeys: keys,
        movementStarted: 1,
        rollCalls,
        attempts,
        ok: true,
      }
    }

    if (!attempt.retry) {
      return {
        executedKeys: keys,
        movementStarted: 0,
        rollCalls,
        attempts,
        ok: false,
        reason: attempt.result.reason,
        terminal: true,
      }
    }

    if (delayMs > 0) {
      try {
        await sleep(delayMs, signal)
      } catch (err) {
        return {
          executedKeys: keys,
          movementStarted: 0,
          rollCalls,
          attempts,
          ok: false,
          reason: err?.reason || 'cancelled',
          terminal: true,
        }
      }
      const afterSleep = checkContinue()
      if (!afterSleep.ok) {
        return {
          executedKeys: keys,
          movementStarted: 0,
          rollCalls,
          attempts,
          ok: false,
          reason: afterSleep.reason,
          terminal: true,
        }
      }
    }
  }

  return {
    executedKeys: keys,
    movementStarted: 0,
    rollCalls,
    attempts,
    ok: false,
    reason: 'retry-exhausted',
    terminal: false,
  }
}

/**
 * Retry persistente cancelável — o teto de 25 não abandona um turno que ainda é da máquina.
 */
export async function runBotRollPersistentRetry({
  executedKeys = [],
  turnKey,
  onBotRoll,
  payload,
  signal,
  shouldContinue,
  innerMaxAttempts = BOT_ROLL_RETRY_MAX,
  delayMs = BOT_ROLL_RETRY_MS,
  maxBackoffMs = 4000,
  sleep = sleepCancellable,
} = {}) {
  let keys = [...executedKeys]
  let rollCalls = 0
  let attempts = 0
  let outerRound = 0
  let backoff = delayMs

  while (true) {
    const before =
      typeof shouldContinue === 'function'
        ? shouldContinue()
        : signal?.aborted
          ? { ok: false, reason: 'cancelled' }
          : { ok: true }
    if (!before.ok) {
      return {
        executedKeys: keys,
        movementStarted: 0,
        rollCalls,
        attempts,
        ok: false,
        reason: before.reason,
        terminal: true,
        outerRound,
      }
    }

    outerRound += 1
    const inner = await runBotRollRetryLoop({
      executedKeys: keys,
      turnKey,
      onBotRoll,
      payload,
      signal,
      shouldContinue,
      maxAttempts: innerMaxAttempts,
      delayMs,
      sleep,
    })

    rollCalls += inner.rollCalls || 0
    attempts += inner.attempts || 0
    keys = inner.executedKeys || keys

    if (inner.ok) {
      return {
        ...inner,
        executedKeys: keys,
        rollCalls,
        attempts,
        outerRound,
        ok: true,
      }
    }

    if (inner.terminal === true) {
      return {
        ...inner,
        executedKeys: keys,
        rollCalls,
        attempts,
        outerRound,
      }
    }

    const after =
      typeof shouldContinue === 'function'
        ? shouldContinue()
        : signal?.aborted
          ? { ok: false, reason: 'cancelled' }
          : { ok: true }
    if (!after.ok) {
      return {
        executedKeys: keys,
        movementStarted: 0,
        rollCalls,
        attempts,
        ok: false,
        reason: after.reason,
        terminal: true,
        outerRound,
      }
    }

    try {
      if (backoff > 0) await sleep(backoff, signal)
    } catch (err) {
      return {
        executedKeys: keys,
        movementStarted: 0,
        rollCalls,
        attempts,
        ok: false,
        reason: err?.reason || 'cancelled',
        terminal: true,
        outerRound,
      }
    }

    backoff = Math.min(maxBackoffMs, Math.floor(backoff * 1.25) + delayMs)
  }
}

export { ADVANCE_PENDING }
