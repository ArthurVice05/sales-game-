import { botTurnKey } from './botTypes.js'

/** Prova local síncrona após BOT_CLAIM CAS ok — não depende do eco React/realtime. */
export function buildClaimProof({
  matchId,
  turnPlayerId,
  turnSeq,
  turnKey,
  executorId,
  lockOwner,
  seed,
} = {}) {
  if (matchId == null || turnPlayerId == null || turnSeq == null) return null
  if (!executorId || !lockOwner) return null
  const key =
    turnKey != null
      ? String(turnKey)
      : botTurnKey(matchId, turnPlayerId, turnSeq)
  if (!key) return null
  return {
    matchId: String(matchId),
    turnPlayerId: String(turnPlayerId),
    turnSeq: Number(turnSeq),
    turnKey: key,
    executorId: String(executorId),
    lockOwner: String(lockOwner),
    seed: seed ?? null,
  }
}

export function isValidClaimProof(proof) {
  return !!(
    proof &&
    proof.ok !== false &&
    proof.matchId &&
    proof.turnPlayerId &&
    Number.isFinite(Number(proof.turnSeq)) &&
    proof.turnKey &&
    proof.executorId &&
    proof.lockOwner
  )
}

export function claimProofMatchesLive(proof, live = {}) {
  if (!isValidClaimProof(proof)) return { ok: false, reason: 'no-proof' }
  if (String(live.matchId ?? '') !== String(proof.matchId)) {
    return { ok: false, reason: 'match-id' }
  }
  if (String(live.turnPlayerId ?? '') !== String(proof.turnPlayerId)) {
    return { ok: false, reason: 'turn-player' }
  }
  if (Number(live.turnSeq) !== Number(proof.turnSeq)) {
    return { ok: false, reason: 'turn-seq' }
  }
  const rollKey = String(proof.turnSeq)
  if (live.lastRollTurnKey != null && String(live.lastRollTurnKey) === rollKey) {
    return { ok: false, reason: 'already-rolled' }
  }
  return { ok: true, reason: 'proof-live-ok' }
}

/**
 * Executor autoritativo: prova local vence latência; remoto contraditório aborta.
 */
export function resolveAuthoritativeExecutor({
  claimProof = null,
  localExecutorId = null,
  remoteExecutorId = null,
} = {}) {
  const localExec = localExecutorId != null ? String(localExecutorId) : ''
  const remoteExec = remoteExecutorId != null ? String(remoteExecutorId) : ''
  const proofExec =
    claimProof?.executorId != null ? String(claimProof.executorId) : ''

  if (proofExec && localExec && proofExec === localExec) {
    if (remoteExec && remoteExec !== proofExec) {
      return { ok: false, reason: 'remote-contradicts-proof', executorId: null }
    }
    return { ok: true, reason: 'claim-proof', executorId: proofExec }
  }

  if (localExec && remoteExec && localExec === remoteExec) {
    return { ok: true, reason: 'remote-synced', executorId: remoteExec }
  }

  if (remoteExec && localExec && remoteExec !== localExec) {
    return { ok: false, reason: 'executor-mismatch', executorId: null }
  }

  return { ok: false, reason: 'missing-executor', executorId: null }
}

export function enrichSuccessfulClaimResult(result, claim, turnKey) {
  if (!result || result.ok !== true || result.casLost === true) return result
  const proof = buildClaimProof({
    matchId: claim?.matchId,
    turnPlayerId: claim?.turnPlayerId,
    turnSeq: claim?.turnSeq,
    turnKey: turnKey ?? result.turnKey,
    executorId: claim?.executorId,
    lockOwner: claim?.lockOwner,
    seed: claim?.seed,
  })
  if (!proof) return result
  return { ...result, claimProof: proof }
}
