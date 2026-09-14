// One immutable identity per human roll. Effects and handoff share its receipt.
export function activeHumanRoll(state = {}) {
  const roll = state.humanRoll
  return roll && String(roll.playerId) === String(state.turnPlayerId)
    && Number(roll.turnSeq) === Number(state.turnSeq)
    && String(roll.matchId ?? '') === String(state.matchId ?? '') ? roll : null
}

export function humanClaimExpired(state, now) {
  const roll = activeHumanRoll(state)
  return !!(roll && !roll.moved && Number.isFinite(roll.expiresAt)
    && Number.isFinite(now) && now >= roll.expiresAt)
}

export function validateHumanTransaction(prev, patch, now) {
  const roll = activeHumanRoll(prev)
  const kind = patch._commitKind || patch.kind
  if (kind === 'HUMAN_ROLL_CLAIM') {
    const next = patch.humanRoll
    if (!next?.id || !next.executorId || String(next.playerId) !== String(prev.turnPlayerId)
      || Number(next.turnSeq) !== Number(prev.turnSeq)
      || String(next.matchId ?? '') !== String(prev.matchId ?? '')) {
      return { ok: false, reason: 'invalid-human-claim' }
    }
    if (roll && roll.id !== next.id && !humanClaimExpired(prev, now)) return { ok: false, reason: 'human-roll-already-claimed' }
    if (roll?.moved) return { ok: false, reason: 'human-roll-already-moved' }
    if (prev.gameOver) return { ok: false, reason: 'game-over' }
    if (prev.lastRollTurnKey != null && String(prev.lastRollTurnKey) === String(prev.turnSeq)) {
      return { ok: false, reason: 'already-rolled' }
    }
    return { ok: true, reason: 'human-claim-ok' }
  }
  if (!roll) {
    if (patch._expectHumanRollId) return { ok: false, reason: 'human-claim-missing' }
    return null // Existing games and bots keep their original protocol.
  }
  const protectedKind = ['PLAYER_DELTA', 'HUMAN_MOVE', 'NORMAL_HANDOFF', 'ENDGAME',
    'LOCK_ACQUIRE', 'LOCK_RELEASE'].includes(kind)
  if (!protectedKind) return null
  if (patch._expectHumanRollId !== roll.id) return { ok: false, reason: 'human-roll-owner-mismatch' }
  if (kind === 'NORMAL_HANDOFF' && !roll.moved) {
    return { ok: false, reason: 'human-move-unconfirmed' }
  }
  if (kind === 'HUMAN_MOVE' && patch.humanRoll?.id !== roll.id) {
    return { ok: false, reason: 'human-move-receipt-missing' }
  }
  return null
}

// Jobs are created before enqueue, with a fixed action ID and turn identity.
// A transport failure never lets the following handoff overtake the failed job.
export function createHumanCommitQueue({ delay = ms => new Promise(r => setTimeout(r, ms)) } = {}) {
  let tail = Promise.resolve()
  let stopped = false
  let pending = 0
  return {
    get pending() { return pending },
    stop() { stopped = true },
    enqueue(job, isCurrent = () => true) {
      pending++
      const run = async () => {
        while (!stopped && isCurrent()) {
          let result
          try { result = await job() } catch { result = { ok: false } }
          if (result?.ok || result?.casLost || result?.terminal) return result
          await delay(750)
        }
        return { ok: false, terminal: true, reason: 'human-turn-obsolete' }
      }
      const result = tail.then(run, run).finally(() => { pending-- })
      tail = result.catch(() => {})
      return result
    },
  }
}
