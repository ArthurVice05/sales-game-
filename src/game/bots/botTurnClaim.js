import { BOT_LEASE_MS, botActionKey, botTurnKey, isBotPlayer } from './botTypes.js'

export const BOT_PHASE_CLAIMED = 'CLAIMED'
export const BOT_PHASE_ROLLED = 'ROLLED'
export const BOT_PHASE_HANDOFF = 'HANDOFF'

export function botLeaseExpired(lockTs, now = Date.now(), leaseMs = BOT_LEASE_MS) {
  const ts = Number(lockTs)
  if (!Number.isFinite(ts) || ts <= 0) return true
  return Number(now) - ts > Number(leaseMs)
}

export function isBotRollComplete(remote = {}, turnSeq) {
  const seq = turnSeq != null ? String(turnSeq) : String(remote.turnSeq ?? '')
  if (remote.lastRollTurnKey != null && String(remote.lastRollTurnKey) === seq) return true
  if (remote.botPhase === BOT_PHASE_ROLLED || remote.botPhase === BOT_PHASE_HANDOFF) return true
  return false
}

/**
 * CAS lógico do claim da máquina. Usado pelo ramo BOT_CLAIM de validateTurnCommit.
 */
export function evaluateBotClaimCas({
  remote = {},
  claim = {},
  now = Date.now(),
  leaseMs = BOT_LEASE_MS,
} = {}) {
  if (remote.gameOver === true) return { ok: false, reason: 'game-over', casLost: true }
  if (String(remote.matchId ?? '') !== String(claim.matchId ?? '')) {
    return { ok: false, reason: 'match-id', casLost: true }
  }
  if (String(remote.turnPlayerId ?? '') !== String(claim.turnPlayerId ?? '')) {
    return { ok: false, reason: 'turn-player', casLost: true }
  }
  if (Number(remote.turnSeq) !== Number(claim.turnSeq)) {
    return { ok: false, reason: 'turn-seq', casLost: true }
  }

  const current = claim.currentPlayer || remote.currentPlayer
  if (!isBotPlayer(current)) {
    return { ok: false, reason: 'not-bot-turn', casLost: true }
  }
  if (String(current.id) !== String(claim.turnPlayerId)) {
    return { ok: false, reason: 'bot-id-mismatch', casLost: true }
  }

  const expectedKey = botTurnKey(claim.matchId, claim.turnPlayerId, claim.turnSeq)
  if (claim.botTurnKey != null && String(claim.botTurnKey) !== expectedKey) {
    return { ok: false, reason: 'bot-turn-key', casLost: true }
  }
  if (remote.botTurnKey != null && String(remote.botTurnKey) !== expectedKey) {
    if (remote.botPhase === BOT_PHASE_ROLLED || isBotRollComplete(remote, claim.turnSeq)) {
      return { ok: false, reason: 'stale-bot-turn-key', casLost: true }
    }
  }

  const rolled = isBotRollComplete(remote, claim.turnSeq)
  const claimExecutor = claim.executorId != null ? String(claim.executorId) : ''
  const remoteExecutor = remote.botClaimExecutor != null ? String(remote.botClaimExecutor) : ''
  const remoteOwner = remote.lockOwner != null ? String(remote.lockOwner) : ''
  const claimOwner = claim.lockOwner != null ? String(claim.lockOwner) : ''
  const locked = remote.turnLock === true && (remoteOwner !== '' || remoteExecutor !== '')

  if (remote.botPhase === BOT_PHASE_ROLLED && claimExecutor && remoteExecutor && claimExecutor !== remoteExecutor) {
    return { ok: false, reason: 'already-rolled', casLost: true }
  }
  if (rolled && claimExecutor && remoteExecutor && claimExecutor !== remoteExecutor) {
    return { ok: false, reason: 'already-rolled', casLost: true }
  }
  if (rolled && !claimExecutor) {
    return { ok: false, reason: 'already-rolled', casLost: true }
  }

  if (locked) {
    const sameExecutor = claimExecutor && remoteExecutor && claimExecutor === remoteExecutor
    if (sameExecutor) {
      return {
        ok: true,
        casLost: false,
        turnKey: expectedKey,
        seed: claim.seed || remote.botTurnSeed || null,
        resume: true,
      }
    }
    const otherExecutor = remoteExecutor && claimExecutor && remoteExecutor !== claimExecutor
    const otherOwner = remoteOwner && claimOwner && remoteOwner !== claimOwner
    if (otherExecutor || otherOwner) {
      if (!isBotPlayer(current)) {
        return { ok: false, reason: 'human-lock', casLost: true }
      }
      if (rolled) {
        return { ok: false, reason: 'already-rolled', casLost: true }
      }
      if (!botLeaseExpired(remote.lockTs, now, leaseMs)) {
        return { ok: false, reason: 'lock-held', casLost: true }
      }
      if (remote.botPhase === BOT_PHASE_ROLLED) {
        return { ok: false, reason: 'phase-rolled', casLost: true }
      }
      if (claim.releaseExpectedOwner && String(claim.releaseExpectedOwner) !== remoteOwner && String(claim.releaseExpectedOwner) !== remoteExecutor) {
        return { ok: false, reason: 'lock-owner-mismatch', casLost: true }
      }
    }
  }

  return {
    ok: true,
    casLost: false,
    turnKey: expectedKey,
    seed: claim.seed || remote.botTurnSeed || null,
  }
}

/**
 * Renova lockTs só para o mesmo executor ativo. Não renova se o executor desapareceu.
 */
export function applyBotLeaseHeartbeat(remote = {}, claim = {}, { now = Date.now(), leaseMs = BOT_LEASE_MS } = {}) {
  const claimExecutor = claim.executorId != null ? String(claim.executorId) : ''
  const remoteExecutor = remote.botClaimExecutor != null ? String(remote.botClaimExecutor) : ''
  if (!claimExecutor || !remoteExecutor || claimExecutor !== remoteExecutor) {
    return { ok: false, reason: 'not-active-executor', casLost: true, next: remote }
  }
  const decision = evaluateBotClaimCas({ remote, claim, now, leaseMs })
  if (!decision.ok) return { ...decision, next: remote }
  return {
    ok: true,
    casLost: false,
    next: {
      ...remote,
      turnLock: true,
      lockTs: now,
      lockOwner: String(claim.lockOwner || remote.lockOwner),
      botClaimExecutor: claimExecutor,
    },
  }
}

export function applyBotClaimToState(remote, claim, { now = Date.now() } = {}) {
  const decision = evaluateBotClaimCas({ remote, claim, now })
  if (!decision.ok) return { ...decision, next: remote }
  const seed = Array.isArray(remote.botTurnSeed) && remote.botTurnKey === decision.turnKey
    ? remote.botTurnSeed
    : (claim.seed || remote.botTurnSeed)
  const phase = isBotRollComplete(remote, claim.turnSeq)
    ? (remote.botPhase || BOT_PHASE_ROLLED)
    : BOT_PHASE_CLAIMED
  return {
    ok: true,
    casLost: false,
    next: {
      ...remote,
      turnLock: true,
      lockOwner: String(claim.lockOwner),
      lockTs: now,
      botTurnKey: decision.turnKey,
      botTurnSeed: seed,
      botClaimOwner: String(claim.lockOwner),
      botClaimExecutor: claim.executorId != null ? String(claim.executorId) : remote.botClaimExecutor,
      botPhase: phase,
    },
  }
}

export function simulateConcurrentBotClaims(remote, claims, now = Date.now()) {
  let state = { ...remote }
  const results = []
  for (const claim of claims) {
    const applied = applyBotClaimToState(state, claim, { now })
    results.push({ ok: applied.ok, reason: applied.reason, casLost: applied.casLost })
    if (applied.ok) state = applied.next
  }
  return { results, state }
}

export function shouldRunBotPhase({ executedKeys = [], turnKey, phase }) {
  const key = botActionKey(turnKey, phase)
  if ((executedKeys || []).includes(key)) return { run: false, key, reason: 'idempotent' }
  return { run: true, key, reason: 'ok' }
}

export function isObsoleteBotRollReason(reason) {
  return [
    'game-over',
    'already-rolled',
    'match-id',
    'turn-seq',
    'turn-player',
    'not-bot-turn',
    'stale-match-id',
    'stale-turn-seq',
    'stale-turn-player',
    'bot-id-mismatch',
  ].includes(String(reason || ''))
}
