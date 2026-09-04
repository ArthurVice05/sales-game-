import { isAuthorizedTurnActor } from './botActor.js'

/**
 * Autorização de ROLL da máquina — prova local + estado remoto; payload não é autoridade.
 */
export function evaluateBotRollAuthorization({
  act,
  myUid,
  authoritativeMatchId,
  authoritativeRemoteExecutor,
  claimProof = null,
  coordinatorId,
  lockOwner,
  turnPlayerId,
  turnSeq,
  lastRollTurnKey,
  gameOver,
  currentPlayer,
} = {}) {
  const liveTurnId = turnPlayerId != null ? String(turnPlayerId) : ''
  const proof = claimProof || act?.botClaim?.claimProof || null
  return isAuthorizedTurnActor({
    actorId: act?.actorId || liveTurnId,
    myUid,
    executorId: proof?.executorId ?? act?.botClaim?.executorId,
    remoteExecutorId: authoritativeRemoteExecutor,
    currentPlayer,
    turnPlayerId: liveTurnId,
    turnSeq,
    matchId: authoritativeMatchId,
    gameOver,
    lockOwner,
    botClaim: act?.botClaim,
    claimProof: proof,
    coordinatorId,
    lastRollTurnKey,
  })
}
