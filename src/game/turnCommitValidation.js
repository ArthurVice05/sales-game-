/**
 * Validação de commits de turno/lock no snapshot remoto (CAS updater).
 * Regras distintas para auto-pass, handoff normal e LOCK.
 */

import { isBotPlayer } from './bots/botTypes.js'
import { botLeaseExpired, evaluateBotClaimCas } from './bots/botTurnClaim.js'

export function inferCommitKind(statePatch = {}) {
  if (statePatch._commitKind) return statePatch._commitKind
  if (statePatch.kind === 'BOT_CLAIM') return 'BOT_CLAIM'
  if (statePatch.kind === 'LOCK') {
    return statePatch.turnLock ? 'LOCK_ACQUIRE' : 'LOCK_RELEASE'
  }
  if (statePatch.kind === 'TURN') {
    if (statePatch.lastAction === 'AUTO_PASS_TIMER') return 'AUTO_PASS'
    if (statePatch._expectTurnPlayerId != null || statePatch._expectTurnSeq != null) {
      return 'NORMAL_HANDOFF'
    }
  }
  if (statePatch._expectTurnPlayerId != null || statePatch._expectTurnSeq != null) {
    return 'AUTO_PASS'
  }
  return null
}

export function isSkipAttemptCommitKind(kind) {
  return kind === 'AUTO_PASS' || kind === 'AUTO_SKIP_OFFLINE'
}

/** Decide confirmação/liberação do sharedTurnSkipGuard — só para tentativas de skip. */
export function resolveSkipGuardAction(statePatch = {}, { casLost = false, commitOk = false } = {}) {
  const kind = inferCommitKind(statePatch)
  if (!isSkipAttemptCommitKind(kind)) return { action: 'none', kind }
  if (casLost || !commitOk) return { action: 'release', kind }
  return { action: 'confirm', kind }
}

function originTurnMatches(prevState, expectTurnId, expectTurnSeq, expectMatchId) {
  if (expectMatchId != null && String(prevState.matchId ?? '') !== String(expectMatchId)) {
    return { ok: false, reason: 'stale-match-id' }
  }
  const remoteTurnId = prevState.turnPlayerId != null ? String(prevState.turnPlayerId) : ''
  const remoteTurnSeq = Number(prevState.turnSeq) || 0
  if (expectTurnId != null && remoteTurnId !== String(expectTurnId)) {
    return { ok: false, reason: 'stale-turn-player' }
  }
  if (expectTurnSeq != null && remoteTurnSeq !== Number(expectTurnSeq)) {
    return { ok: false, reason: 'stale-turn-seq' }
  }
  return { ok: true, reason: 'origin-ok' }
}

function remoteTurnPlayer(prevState) {
  const id = prevState?.turnPlayerId != null ? String(prevState.turnPlayerId) : ''
  return (prevState?.players || []).find((p) => String(p?.id) === id) || null
}

/** Defesa no motor: timer nunca avança turno de máquina. */
export function shouldRejectEngineBotTimerAutoPass(turnPlayer, reason) {
  if (reason !== 'AUTO_PASS_TIMER') return null
  if (isBotPlayer(turnPlayer)) {
    return { ok: false, reason: 'bot-turn-managed-by-controller' }
  }
  return null
}

/** Guarda pura: timer humano nunca deve auto-passar turno de máquina. */
export function shouldDisableTimerAutoPassForTurn(players, turnPlayerId) {
  const id = turnPlayerId != null ? String(turnPlayerId) : ''
  if (!id) return false
  const roster = Array.isArray(players) ? players : []
  const current = roster.find((p) => String(p?.id) === id)
  return isBotPlayer(current)
}

/** Interpreta retorno de skipAbsentTurn (boolean ou { ok }). */
export function parseSkipAttemptResult(result) {
  if (result && typeof result === 'object' && 'ok' in result) {
    return result.ok === true
  }
  return !!result
}

function validateNextSeq(statePatch, expectTurnSeq) {
  if (expectTurnSeq == null) return { ok: true, reason: 'no-seq-expect' }
  const proposedSeq = Number(statePatch.turnSeq)
  if (!Number.isFinite(proposedSeq)) return { ok: true, reason: 'no-proposed-seq' }
  if (proposedSeq !== Number(expectTurnSeq) + 1) {
    return { ok: false, reason: 'invalid-next-seq' }
  }
  return { ok: true, reason: 'next-seq-ok' }
}

/**
 * @returns {{ ok: boolean, reason: string }}
 */
export function validateTurnCommit(prevState = {}, statePatch = {}, { now = Date.now() } = {}) {
  const kind = inferCommitKind(statePatch)
  if (!kind) return { ok: true, reason: 'no-guard' }

  const prev = prevState && typeof prevState === 'object' ? prevState : {}
  const expectTurnId =
    statePatch._expectTurnPlayerId != null ? String(statePatch._expectTurnPlayerId) : null
  const expectTurnSeq =
    statePatch._expectTurnSeq != null ? Number(statePatch._expectTurnSeq) : null
  const expectMatchId =
    statePatch._expectMatchId != null ? String(statePatch._expectMatchId) : null

  const origin = originTurnMatches(prev, expectTurnId, expectTurnSeq, expectMatchId)
  if (!origin.ok) return origin

  switch (kind) {
    case 'AUTO_PASS': {
      if (prev.gameOver) return { ok: false, reason: 'game-over' }
      if (isBotPlayer(remoteTurnPlayer(prev))) {
        return { ok: false, reason: 'bot-timer-auto-pass' }
      }
      if (prev.turnLock) return { ok: false, reason: 'turn-locked' }
      const lrk = prev.lastRollTurnKey
      if (lrk != null && expectTurnSeq != null && String(lrk) === String(expectTurnSeq)) {
        return { ok: false, reason: 'already-rolled' }
      }
      const deadlineRaw = prev.turnDeadlineAt
      if (deadlineRaw == null || !Number.isFinite(Number(deadlineRaw))) {
        return { ok: false, reason: 'no-deadline' }
      }
      const deadline = Number(deadlineRaw)
      const t = Number.isFinite(Number(now)) ? Number(now) : Date.now()
      if (t < deadline) return { ok: false, reason: 'not-expired' }
      const seqCheck = validateNextSeq(statePatch, expectTurnSeq)
      if (!seqCheck.ok) return seqCheck
      return { ok: true, reason: 'auto-pass-ok' }
    }

    case 'AUTO_SKIP_OFFLINE': {
      if (prev.gameOver) return { ok: false, reason: 'game-over' }
      if (isBotPlayer(remoteTurnPlayer(prev))) {
        return { ok: false, reason: 'bot-presence-skip' }
      }
      if (prev.turnLock) return { ok: false, reason: 'turn-locked' }
      const lrk = prev.lastRollTurnKey
      if (lrk != null && expectTurnSeq != null && String(lrk) === String(expectTurnSeq)) {
        return { ok: false, reason: 'already-rolled' }
      }
      const seqCheck = validateNextSeq(statePatch, expectTurnSeq)
      if (!seqCheck.ok) return seqCheck
      return { ok: true, reason: 'auto-skip-offline-ok' }
    }

    case 'NORMAL_HANDOFF': {
      if (prev.gameOver) return { ok: false, reason: 'game-over' }
      const seqCheck = validateNextSeq(statePatch, expectTurnSeq)
      if (!seqCheck.ok) return seqCheck
      return { ok: true, reason: 'normal-handoff-ok' }
    }

    case 'LOCK_RELEASE': {
      if (!prev.turnLock) return { ok: true, reason: 'already-unlocked' }
      const expectOwner =
        statePatch._expectLockOwner != null ? String(statePatch._expectLockOwner) : null
      const remoteOwner = prev.lockOwner != null ? String(prev.lockOwner) : ''
      // Sem dono esperado não pode apagar lock remoto ativo de outro contexto.
      if (!expectOwner && remoteOwner) {
        return { ok: false, reason: 'lock-owner-unknown' }
      }
      if (expectOwner && remoteOwner && remoteOwner !== expectOwner) {
        return { ok: false, reason: 'lock-owner-mismatch' }
      }
      return { ok: true, reason: 'lock-release-ok' }
    }

    case 'BOT_CLAIM': {
      if (prev.gameOver) return { ok: false, reason: 'game-over' }
      const current = remoteTurnPlayer(prev)
      const expectedKey = statePatch.botTurnKey
      const claim = {
        matchId: expectMatchId ?? statePatch.matchId,
        turnPlayerId: expectTurnId ?? statePatch.turnPlayerId,
        turnSeq: expectTurnSeq ?? statePatch.turnSeq,
        lockOwner: statePatch.lockOwner,
        executorId: statePatch.botClaimExecutor,
        currentPlayer: current,
        seed: statePatch.botTurnSeed,
        botTurnKey: expectedKey,
        releaseExpectedOwner: statePatch._expectLockOwner,
      }
      const cas = evaluateBotClaimCas({
        remote: { ...prev, currentPlayer: current },
        claim,
        now,
      })
      if (!cas.ok) return { ok: false, reason: cas.reason }
      return { ok: true, reason: 'bot-claim-ok' }
    }

    case 'BOT_MOVE': {
      if (prev.gameOver) return { ok: false, reason: 'game-over' }
      const current = remoteTurnPlayer(prev)
      if (!isBotPlayer(current)) return { ok: false, reason: 'not-bot-turn' }
      const expectOwner =
        statePatch._expectLockOwner != null ? String(statePatch._expectLockOwner) : null
      const remoteOwner = prev.lockOwner != null ? String(prev.lockOwner) : ''
      if (expectOwner && remoteOwner && remoteOwner !== expectOwner) {
        return { ok: false, reason: 'lock-owner-mismatch' }
      }
      return { ok: true, reason: 'bot-move-ok' }
    }

    case 'LOCK_ACQUIRE': {
      if (prev.gameOver) return { ok: false, reason: 'game-over' }
      if (prev.turnLock) {
        const remoteOwner = prev.lockOwner != null ? String(prev.lockOwner) : ''
        const nextOwner =
          statePatch.lockOwner != null ? String(statePatch.lockOwner) : ''
        if (remoteOwner && nextOwner && remoteOwner !== nextOwner) {
          return { ok: false, reason: 'already-locked-by-other' }
        }
      }
      return { ok: true, reason: 'lock-acquire-ok' }
    }

    default:
      return { ok: true, reason: 'unknown-kind' }
  }
}

/** Barreira final do hook após awaits assíncronos. */
export function shouldProceedTimerAutoPassAfterAwait({
  now,
  turnDeadlineAt,
  turnLock,
  gameOver,
  capturedTurnPlayerId,
  capturedTurnSeq,
  currentTurnPlayerId,
  currentTurnSeq,
  lastAttemptKey,
  inFlight = false,
  amCoordinator = true,
} = {}) {
  const curId = currentTurnPlayerId != null ? String(currentTurnPlayerId) : ''
  const capId = capturedTurnPlayerId != null ? String(capturedTurnPlayerId) : ''
  if (curId !== capId) return { ok: false, reason: 'turn-changed' }
  if ((Number(currentTurnSeq) || 0) !== (Number(capturedTurnSeq) || 0)) {
    return { ok: false, reason: 'seq-changed' }
  }
  if (gameOver) return { ok: false, reason: 'game-over' }
  if (turnLock) return { ok: false, reason: 'turn-locked' }

  const deadlineRaw = turnDeadlineAt
  if (deadlineRaw == null || !Number.isFinite(Number(deadlineRaw))) {
    return { ok: false, reason: 'no-deadline' }
  }
  const deadline = Number(deadlineRaw)
  const t = Number.isFinite(Number(now)) ? Number(now) : Date.now()
  if (t < deadline) return { ok: false, reason: 'not-expired' }

  if (!amCoordinator) return { ok: false, reason: 'not-coordinator' }
  if (inFlight) return { ok: false, reason: 'in-flight' }

  const key = `${capId}|${Number(capturedTurnSeq) || 0}`
  if (lastAttemptKey != null && String(lastAttemptKey) === key) {
    return { ok: false, reason: 'already-attempted' }
  }

  return { ok: true, reason: 'proceed', attemptKey: key }
}

export function stripCommitMeta(statePatch = {}) {
  const {
    _expectTurnPlayerId: _e1,
    _expectTurnSeq: _e2,
    _expectLockOwner: _e3,
    _commitKind: _e4,
    _expectMatchId: _e5,
    ...publicPatch
  } = statePatch || {}
  return publicPatch
}
