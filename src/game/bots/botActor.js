import { isBotPlayer } from './botTypes.js'
import { isValidClaimProof, resolveAuthoritativeExecutor } from './botClaimProof.js'

/**
 * Humano: actorId === myUid === turnPlayerId e o jogador atual não é máquina.
 * Máquina: coordenador humano com claimProof ou executor remoto convergido.
 */
export function isAuthorizedTurnActor({
  actorId,
  myUid,
  executorId = null,
  remoteExecutorId = null,
  currentPlayer,
  turnPlayerId,
  turnSeq,
  matchId,
  gameOver = false,
  lockOwner = null,
  botClaim = null,
  claimProof = null,
  coordinatorId = null,
  lastRollTurnKey = null,
} = {}) {
  if (gameOver === true) return { ok: false, reason: 'game-over' }
  const turnId = turnPlayerId != null ? String(turnPlayerId) : ''
  const actor = actorId != null ? String(actorId) : ''
  const me = myUid != null ? String(myUid) : ''
  const exec = executorId != null ? String(executorId) : ''
  const turnKey = typeof turnSeq === 'number' ? String(turnSeq) : ''
  if (!turnId || !actor) return { ok: false, reason: 'missing-ids' }
  if (actor !== turnId) return { ok: false, reason: 'not-turn-player' }

  if (isBotPlayer(currentPlayer)) {
    if (me && actor === me) return { ok: false, reason: 'human-acting-as-bot' }
    const coord = coordinatorId != null ? String(coordinatorId) : ''
    if (!coord || coord !== me) return { ok: false, reason: 'not-coordinator' }

    const proof = claimProof || botClaim?.claimProof || null
    const proofLock = proof?.lockOwner != null ? String(proof.lockOwner) : ''
    const liveLock = lockOwner != null ? String(lockOwner) : ''
    if (proofLock && proofLock === me) {
      if (liveLock && liveLock !== me) {
        return { ok: false, reason: 'not-lock-owner' }
      }
    } else if (liveLock !== me) {
      return { ok: false, reason: 'not-lock-owner' }
    }

    const claimOk = botClaim?.ok === true || isValidClaimProof(proof)
    if (!claimOk) return { ok: false, reason: 'no-claim' }

    const proofMatchId = proof?.matchId ?? botClaim?.matchId
    const proofTurnSeq = proof?.turnSeq ?? botClaim?.turnSeq
    const proofExec = proof?.executorId ?? botClaim?.executorId

    if (String(proofMatchId ?? '') !== String(matchId ?? '')) {
      return { ok: false, reason: 'match-id' }
    }
    if (Number(proofTurnSeq) !== Number(turnSeq)) {
      return { ok: false, reason: 'turn-seq' }
    }
    if (turnKey && lastRollTurnKey != null && String(lastRollTurnKey) === turnKey) {
      return { ok: false, reason: 'already-rolled' }
    }

    const claimExec = proofExec != null ? String(proofExec) : ''
    if (!claimExec) return { ok: false, reason: 'missing-claim-executor' }
    if (!exec) return { ok: false, reason: 'missing-executor' }

    const authExec = resolveAuthoritativeExecutor({
      claimProof: proof,
      localExecutorId: exec,
      remoteExecutorId,
    })
    if (!authExec.ok) return { ok: false, reason: authExec.reason || 'not-remote-executor' }
    if (claimExec !== exec || exec !== authExec.executorId) {
      return { ok: false, reason: 'not-remote-executor' }
    }

    return { ok: true, reason: 'bot-coordinator', mode: 'bot' }
  }

  if (actor !== me) return { ok: false, reason: 'not-self' }
  return { ok: true, reason: 'human', mode: 'human' }
}
