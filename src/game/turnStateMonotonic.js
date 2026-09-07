/**
 * Gates monotônicos para aplicar snapshots de turno sem regredir estado mais novo.
 */

function turnId(value) {
  return value != null ? String(value) : ''
}

function turnSeq(value) {
  return Number(value) || 0
}

function rollKey(value) {
  return value != null ? String(value) : null
}

/**
 * Aplica row remota (commit HTTP, realtime, poll) sem regredir versão/turno/lock.
 */
export function shouldApplyRemoteRoomRow({
  incomingVersion,
  incomingState,
  localVersion,
  localState,
} = {}) {
  const lv = Number(localVersion) || 0
  const iv = incomingVersion != null ? Number(incomingVersion) : null
  if (iv != null && iv < lv) {
    return { apply: false, reason: 'stale-version' }
  }

  const local = localState && typeof localState === 'object' ? localState : {}
  const incoming = incomingState && typeof incomingState === 'object' ? incomingState : {}

  const localSeq = turnSeq(local.turnSeq)
  const incomingSeq = turnSeq(incoming.turnSeq)
  if (incomingSeq < localSeq) {
    return { apply: false, reason: 'stale-turn-seq' }
  }

  const localPlayer = turnId(local.turnPlayerId)
  const incomingPlayer = turnId(incoming.turnPlayerId)

  if (incomingSeq === localSeq && incomingPlayer && localPlayer && incomingPlayer !== localPlayer) {
    return { apply: false, reason: 'stale-turn-player' }
  }

  if (incomingSeq === localSeq && incomingPlayer === localPlayer) {
    const isStrictlyNewerVersion = iv != null && iv > lv
    if (!isStrictlyNewerVersion) {
      const localLock = !!local.turnLock
      const incomingLock = !!incoming.turnLock
      if (localLock && !incomingLock) {
        return { apply: false, reason: 'lock-regression' }
      }
      const localRoll = rollKey(local.lastRollTurnKey)
      const incomingRoll = rollKey(incoming.lastRollTurnKey)
      if (localRoll && !incomingRoll) {
        return { apply: false, reason: 'roll-regression' }
      }
    }
  }

  return { apply: true, reason: 'ok' }
}

/**
 * Decide se um patch TURN/LOCK deferido ainda pode atualizar o cliente local.
 */
export function shouldApplyDeferredLocalPatch({
  emission = {},
  current = {},
  patch = {},
} = {}) {
  const fromId = turnId(patch._expectTurnPlayerId ?? emission.turnPlayerId)
  const fromSeq = turnSeq(patch._expectTurnSeq ?? emission.turnSeq)
  const targetId = patch.turnPlayerId != null ? turnId(patch.turnPlayerId) : ''
  const targetSeq = patch.turnSeq != null ? turnSeq(patch.turnSeq) : null

  const curId = turnId(current.turnPlayerId)
  const curSeq = turnSeq(current.turnSeq)

  if (curSeq > fromSeq) {
    return { apply: false, reason: 'origin-superseded' }
  }
  if (curSeq === fromSeq && curId && fromId && curId !== fromId) {
    return { apply: false, reason: 'origin-changed' }
  }

  if (targetSeq != null) {
    if (curSeq > targetSeq) {
      return { apply: false, reason: 'target-superseded' }
    }
    if (curSeq === targetSeq && targetId && curId && curId !== targetId) {
      return { apply: false, reason: 'target-player-mismatch' }
    }
  }

  const sameTurn =
    targetSeq != null &&
    curSeq === targetSeq &&
    (!targetId || !curId || curId === targetId)

  if (sameTurn) {
    const patchClearsLock = patch.turnLock === false
    const curLocked = !!current.turnLock
    if (patchClearsLock && curLocked) {
      return { apply: false, reason: 'lock-evolved' }
    }
    const patchClearsRoll = patch.lastRollTurnKey === null
    const curRoll = rollKey(current.lastRollTurnKey)
    if (patchClearsRoll && curRoll) {
      return { apply: false, reason: 'roll-evolved' }
    }
  }

  return { apply: true, reason: 'ok' }
}

export function captureTurnEmissionSnapshot({
  turnPlayerId,
  turnSeq: seq,
  turnLock,
  lockOwner,
  lastRollTurnKey,
} = {}) {
  return {
    turnPlayerId: turnId(turnPlayerId),
    turnSeq: turnSeq(seq),
    turnLock: !!turnLock,
    lockOwner: lockOwner != null ? String(lockOwner) : null,
    lastRollTurnKey: rollKey(lastRollTurnKey),
  }
}

export function isHandoffPendingObsolete(pending, current = {}) {
  if (!pending || typeof pending !== 'object') return true
  const originSeq = turnSeq(pending.originTurnSeq)
  const curSeq = turnSeq(current.turnSeq)
  if (curSeq > originSeq) return true
  const originId = turnId(pending.originTurnPlayerId)
  const curId = turnId(current.turnPlayerId)
  if (curSeq === originSeq && originId && curId && curId !== originId) return true
  return false
}

/**
 * Effect legado: nextTurnIdx === turnIdx sozinho não prova stale.
 * Same-bot (Arthur waitingAtRevenue) nasce com next === atual e origem ainda viva.
 */
export function shouldDiscardSameSeatHandoffPending(pending, current = {}) {
  if (!pending || typeof pending !== 'object') return false
  if (Number(pending.nextTurnIdx) !== Number(current.turnIdx)) return false
  return isHandoffPendingObsolete(pending, {
    turnPlayerId: current.turnPlayerId,
    turnSeq: current.turnSeq,
  })
}
