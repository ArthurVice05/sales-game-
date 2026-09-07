import { enrichSuccessfulClaimResult } from './botClaimProof.js'

/** Sincroniza executor autoritativo a partir do netState (nunca do payload de ROLL). */
export function syncAuthoritativeBotExecutorRef(ref, { botClaimExecutor, gameOver } = {}) {
  if (!ref) return
  if (gameOver === true || botClaimExecutor == null) {
    ref.current = null
    return
  }
  ref.current = String(botClaimExecutor)
}

/** Atualiza executor somente após commit CAS confirmado; anexa claimProof ao resultado. */
export function applyCommitToAuthoritativeExecutor(ref, result, claim, turnKey) {
  const enriched = enrichSuccessfulClaimResult(result, claim, turnKey)
  if (!ref) return enriched
  if (enriched?.ok === true && enriched?.casLost !== true && claim?.executorId != null) {
    ref.current = String(claim.executorId)
  }
  return enriched
}
