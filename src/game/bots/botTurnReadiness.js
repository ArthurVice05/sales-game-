export function evaluateBotTurnAuthoritativeReadiness({
  expectedMatchId,
  expectedTurnPlayerId,
  expectedTurnSeq,
  remoteMatchId,
  remoteTurnPlayerId,
  remoteTurnSeq,
  remoteGameOver,
  requireRemote = true,
} = {}) {
  if (remoteGameOver === true) {
    return { ok: false, reason: 'game-over' }
  }
  if (!expectedMatchId || !expectedTurnPlayerId || expectedTurnSeq == null) {
    return { ok: false, reason: 'stale-local-cycle' }
  }
  if (!requireRemote) {
    return { ok: true, reason: 'ready' }
  }
  if (remoteMatchId == null || remoteTurnPlayerId == null || remoteTurnSeq == null) {
    return { ok: false, reason: 'waiting-remote-handoff' }
  }
  if (String(remoteMatchId) !== String(expectedMatchId)) {
    return { ok: false, reason: 'match-mismatch' }
  }
  if (String(remoteTurnPlayerId) !== String(expectedTurnPlayerId)) {
    return { ok: false, reason: 'waiting-remote-handoff' }
  }
  if (Number(remoteTurnSeq) !== Number(expectedTurnSeq)) {
    return { ok: false, reason: 'waiting-remote-handoff' }
  }
  return { ok: true, reason: 'ready' }
}

export function isAuthoritativeReadyScalar(readiness) {
  return readiness?.ok === true && readiness?.reason === 'ready'
}
