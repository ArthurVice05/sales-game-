/**
 * Persistência idempotente do movimento da máquina.
 * Não reaplica o movimento local; só reenvia o mesmo delta/actionId.
 */
import { sleepCancellable } from './botRollRetry.js'
import {
  bumpBotMovePersistAttempt,
  classifyBotMoveCommitResult,
  logBotCommit,
  markBotMoveConfirmed,
  markBotMoveFailed,
  setLiveBotMoveBarrier,
} from './botMoveBarrier.js'

export const BOT_MOVE_RETRY_MS = 200
export const BOT_MOVE_MAX_BACKOFF_MS = 4000

export async function persistBotMove({
  commit,
  barrier,
  shouldContinue,
  signal,
  sleep = sleepCancellable,
  delayMs = BOT_MOVE_RETRY_MS,
  maxBackoffMs = BOT_MOVE_MAX_BACKOFF_MS,
} = {}) {
  if (!barrier) {
    return { ok: false, reason: 'no-barrier', terminal: true, retry: false, localApplied: 0 }
  }
  if (typeof commit !== 'function') {
    const failed = markBotMoveFailed(barrier, 'no-commit')
    setLiveBotMoveBarrier(failed)
    return { ok: false, reason: 'no-commit', terminal: true, retry: false, barrier: failed, localApplied: barrier.localApplied }
  }

  let current = barrier
  setLiveBotMoveBarrier(current)
  let backoff = delayMs

  while (true) {
    if (signal?.aborted) {
      current = markBotMoveFailed(current, 'cancelled')
      setLiveBotMoveBarrier(current)
      return {
        ok: false,
        reason: 'cancelled',
        terminal: true,
        retry: false,
        barrier: current,
        actionId: current.actionId,
        localApplied: current.localApplied,
        attempts: current.persistAttempts,
      }
    }
    const cont =
      typeof shouldContinue === 'function'
        ? shouldContinue()
        : { ok: true }
    if (!cont?.ok) {
      current = markBotMoveFailed(current, cont?.reason || 'cancelled')
      setLiveBotMoveBarrier(current)
      return {
        ok: false,
        reason: cont?.reason || 'cancelled',
        terminal: true,
        retry: false,
        barrier: current,
        actionId: current.actionId,
        localApplied: current.localApplied,
        attempts: current.persistAttempts,
      }
    }

    current = bumpBotMovePersistAttempt(current)
    setLiveBotMoveBarrier(current)

    let raw = null
    try {
      raw = await commit({
        actionId: current.actionId,
        delta: current.delta,
        attempt: current.persistAttempts,
        barrier: current,
      })
    } catch {
      raw = { ok: false, reason: 'network-error', casLost: true }
    }

    const classified = classifyBotMoveCommitResult(raw)
    logBotCommit('BOT_MOVE', {
      matchId: current.matchId,
      turnPlayerId: current.playerId,
      turnSeq: current.turnSeq,
      actionId: current.actionId,
      executorId: current.executorId,
      attempt: current.persistAttempts,
      ok: classified.ok,
      casLost: raw?.casLost === true || classified.retry,
      fromPos: current.fromPos,
      toPos: current.toPos,
      stateVersion: raw?.stateVersion ?? null,
    })

    if (classified.ok) {
      current = markBotMoveConfirmed(current)
      setLiveBotMoveBarrier(current)
      return {
        ok: true,
        reason: 'bot-move-ok',
        terminal: false,
        retry: false,
        barrier: current,
        actionId: current.actionId,
        steps: current.steps,
        localApplied: current.localApplied,
        attempts: current.persistAttempts,
      }
    }

    if (classified.terminal) {
      current = markBotMoveFailed(current, classified.reason)
      setLiveBotMoveBarrier(current)
      return {
        ok: false,
        reason: classified.reason,
        terminal: true,
        retry: false,
        barrier: current,
        actionId: current.actionId,
        localApplied: current.localApplied,
        attempts: current.persistAttempts,
      }
    }

    try {
      if (backoff > 0) await sleep(backoff, signal)
    } catch (err) {
      current = markBotMoveFailed(current, err?.reason || 'cancelled')
      setLiveBotMoveBarrier(current)
      return {
        ok: false,
        reason: err?.reason || 'cancelled',
        terminal: true,
        retry: false,
        barrier: current,
        actionId: current.actionId,
        localApplied: current.localApplied,
        attempts: current.persistAttempts,
      }
    }
    backoff = Math.min(maxBackoffMs, Math.floor(backoff * 1.25) + delayMs)
  }
}
