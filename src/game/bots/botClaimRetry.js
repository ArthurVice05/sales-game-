/**
 * Retry de BOT_CLAIM — falhas transitórias (406/CAS) não encerram o turno da máquina.
 */
import { botLeaseExpired } from './botTurnClaim.js'
import { evaluateBotTurnAuthoritativeReadiness } from './botTurnReadiness.js'
import { sleepCancellable } from './botRollRetry.js'
import { enrichSuccessfulClaimResult } from './botClaimProof.js'

export const BOT_CLAIM_RETRY_MS = 200
export const BOT_CLAIM_RETRY_MAX = 25

export function isTransientClaimFailure(result) {
  if (!result || typeof result !== 'object') return true
  if (result.ok === true && result.casLost !== true) return false
  return true
}

export function isSuccessfulClaimResult(result) {
  return result?.ok === true && result?.casLost !== true
}

export function validateClaimRetryContinue({
  signal,
  enabled = true,
  botsEnabled = true,
  expectedMatchId,
  expectedTurnPlayerId,
  expectedTurnSeq,
  expectedTurnKey,
  gameOver = false,
  lastRollTurnKey,
  localExecutorId,
  remoteExecutorId,
  lockTs,
  requireRemote = true,
  remoteMatchId,
  remoteTurnPlayerId,
  remoteTurnSeq,
  remoteGameOver,
  iAmCoordinator = true,
} = {}) {
  if (signal?.aborted) return { ok: false, reason: 'cancelled', terminal: true }
  if (!enabled || !botsEnabled) return { ok: false, reason: 'cancelled', terminal: true }
  if (gameOver === true) return { ok: false, reason: 'game-over', terminal: true }
  if (iAmCoordinator !== true) {
    return { ok: false, reason: 'not-coordinator', terminal: true }
  }

  const readiness = evaluateBotTurnAuthoritativeReadiness({
    expectedMatchId,
    expectedTurnPlayerId,
    expectedTurnSeq,
    remoteMatchId,
    remoteTurnPlayerId,
    remoteTurnSeq,
    remoteGameOver,
    requireRemote,
  })
  if (!readiness.ok) {
    const terminal = readiness.reason === 'game-over' || readiness.reason === 'match-mismatch'
    return { ok: false, reason: readiness.reason, terminal }
  }

  const rollKey = expectedTurnSeq != null ? String(expectedTurnSeq) : ''
  if (rollKey && lastRollTurnKey != null && String(lastRollTurnKey) === rollKey) {
    return { ok: false, reason: 'already-rolled', terminal: true }
  }

  const localExec = localExecutorId != null ? String(localExecutorId) : ''
  const remoteExec = remoteExecutorId != null ? String(remoteExecutorId) : ''
  if (remoteExec && localExec && remoteExec !== localExec && !botLeaseExpired(lockTs)) {
    return { ok: false, reason: 'other-executor', terminal: true }
  }

  return { ok: true }
}

export async function runBotClaimRetryLoop({
  claim,
  seed,
  turnKey,
  steal = false,
  commitClaim,
  signal,
  shouldContinue,
  maxAttempts = BOT_CLAIM_RETRY_MAX,
  delayMs = BOT_CLAIM_RETRY_MS,
  sleep = sleepCancellable,
} = {}) {
  let claimCalls = 0
  let attempts = 0
  let lastResult = null

  const checkContinue = () => {
    if (typeof shouldContinue === 'function') return shouldContinue()
    if (signal?.aborted) return { ok: false, reason: 'cancelled', terminal: true }
    return { ok: true }
  }

  for (attempts = 1; attempts <= maxAttempts; attempts++) {
    const before = checkContinue()
    if (!before.ok) {
      return {
        ok: false,
        reason: before.reason,
        terminal: before.terminal === true,
        attempts: attempts - 1,
        claimCalls,
        lastResult,
      }
    }

    if (typeof commitClaim !== 'function') {
      return { ok: true, attempts, claimCalls, lastResult: { ok: true } }
    }

    claimCalls += 1
    lastResult = await commitClaim({
      claim,
      seed,
      turnKey,
      steal,
    })

    if (isSuccessfulClaimResult(lastResult)) {
      return {
        ok: true,
        attempts,
        claimCalls,
        lastResult: enrichSuccessfulClaimResult(lastResult, claim, turnKey) || lastResult,
      }
    }

    if (!isTransientClaimFailure(lastResult)) {
      return {
        ok: false,
        reason: lastResult?.reason || 'claim-rejected',
        terminal: true,
        attempts,
        claimCalls,
        lastResult,
      }
    }

    if (attempts >= maxAttempts) break

    if (delayMs > 0) {
      try {
        await sleep(delayMs, signal)
      } catch (err) {
        return {
          ok: false,
          reason: err?.reason || 'cancelled',
          terminal: true,
          attempts,
          claimCalls,
          lastResult,
        }
      }
      const afterSleep = checkContinue()
      if (!afterSleep.ok) {
        return {
          ok: false,
          reason: afterSleep.reason,
          terminal: afterSleep.terminal === true,
          attempts,
          claimCalls,
          lastResult,
        }
      }
    }
  }

  return {
    ok: false,
    reason: 'claim-retry-exhausted',
    terminal: false,
    attempts,
    claimCalls,
    lastResult,
  }
}

/**
 * Retry externo cancelável — rearmar após casLost/406 sem depender de novo render.
 */
export async function runBotClaimPersistentRetry({
  claim,
  seed,
  turnKey,
  steal = false,
  commitClaim,
  signal,
  shouldContinue,
  innerMaxAttempts = BOT_CLAIM_RETRY_MAX,
  delayMs = BOT_CLAIM_RETRY_MS,
  maxBackoffMs = 4000,
  sleep = sleepCancellable,
} = {}) {
  let outerRound = 0
  let backoff = delayMs
  let totalClaimCalls = 0
  let lastResult = null

  while (true) {
    const before = typeof shouldContinue === 'function'
      ? shouldContinue()
      : (signal?.aborted ? { ok: false, reason: 'cancelled', terminal: true } : { ok: true })
    if (!before.ok) {
      return {
        ok: false,
        reason: before.reason,
        terminal: before.terminal === true,
        outerRound,
        totalClaimCalls,
        lastResult,
      }
    }

    outerRound += 1
    const inner = await runBotClaimRetryLoop({
      claim,
      seed,
      turnKey,
      steal,
      commitClaim,
      signal,
      shouldContinue,
      maxAttempts: innerMaxAttempts,
      delayMs,
      sleep,
    })

    totalClaimCalls += inner.claimCalls || 0
    lastResult = inner.lastResult

    if (inner.ok && isSuccessfulClaimResult(inner.lastResult)) {
      return {
        ...inner,
        outerRound,
        totalClaimCalls,
      }
    }

    if (inner.terminal === true) {
      return {
        ...inner,
        outerRound,
        totalClaimCalls,
      }
    }

    const after = typeof shouldContinue === 'function'
      ? shouldContinue()
      : (signal?.aborted ? { ok: false, reason: 'cancelled', terminal: true } : { ok: true })
    if (!after.ok) {
      return {
        ok: false,
        reason: after.reason,
        terminal: after.terminal === true,
        outerRound,
        totalClaimCalls,
        lastResult,
      }
    }

    try {
      await sleep(backoff, signal)
    } catch (err) {
      return {
        ok: false,
        reason: err?.reason || 'cancelled',
        terminal: true,
        outerRound,
        totalClaimCalls,
        lastResult,
      }
    }

    backoff = Math.min(maxBackoffMs, Math.floor(backoff * 1.25) + delayMs)
  }
}
