/**
 * Recuperação do turno da máquina após reload/F5.
 * Classifica o estado remoto e reconstrói pending para o tick existente.
 * Não emite HANDOFF/ENDGAME por conta própria.
 */
import { findNextAliveIdx } from '../gameMath.js'
import { botLeaseExpired } from './botTurnClaim.js'
import { isBotPlayer } from './botTypes.js'
import { isBotTurnEffectsSettled, readBotTurnEffects } from './botEconomicRuntime.js'

export const BOT_RECOVERY_NEEDS_ROLL = 'needs-roll'
export const BOT_RECOVERY_NEEDS_MOVE = 'already-rolled-needs-move'
export const BOT_RECOVERY_NEEDS_HANDOFF = 'already-rolled-needs-handoff'
export const BOT_RECOVERY_COMPLETE = 'handoff-complete'

export const LATE_BOT_MOVE_WAIT_MS = 4000

export function botMoveActionPrefix(matchId, turnPlayerId, turnSeq) {
  return `bot-move:${String(matchId ?? '')}:${String(turnPlayerId ?? '')}:${Number(turnSeq) || 0}:`
}

export function buildBotMoveCrossing({
  matchId,
  turnPlayerId,
  turnSeq,
  actionId,
  crossedStart,
} = {}) {
  return {
    matchId: matchId != null ? String(matchId) : '',
    turnPlayerId: turnPlayerId != null ? String(turnPlayerId) : '',
    turnSeq: Number(turnSeq) || 0,
    actionId: actionId != null ? String(actionId) : '',
    crossedStart: crossedStart === true,
  }
}

export function findConfirmedBotMoveAction({
  matchId,
  turnPlayerId,
  turnSeq,
  players,
  lastActions,
} = {}) {
  const prefix = botMoveActionPrefix(matchId, turnPlayerId, turnSeq)
  const bags = []
  if (lastActions && typeof lastActions === 'object') bags.push(lastActions)
  for (const player of Array.isArray(players) ? players : []) {
    if (player?.lastActions && typeof player.lastActions === 'object') {
      bags.push(player.lastActions)
    }
  }
  for (const bag of bags) {
    for (const key of Object.keys(bag)) {
      if (key.startsWith(prefix)) {
        return { ok: true, actionId: key }
      }
    }
  }
  return { ok: false, actionId: null }
}

export function lastRollMatchesTurn(lastRoll, turnPlayerId, turnSeq) {
  if (!lastRoll || typeof lastRoll !== 'object') return false
  if (String(lastRoll.playerId ?? '') !== String(turnPlayerId ?? '')) return false
  if (lastRoll.turnKey != null && String(lastRoll.turnKey) !== String(turnSeq)) {
    return false
  }
  const steps = Number(lastRoll.steps)
  return Number.isFinite(steps) && steps >= 1 && steps <= 6
}

export function readBotMoveCrossing({
  players,
  matchId,
  turnPlayerId,
  turnSeq,
  lastRoll,
} = {}) {
  const seq = Number(turnSeq) || 0
  const botId = turnPlayerId != null ? String(turnPlayerId) : ''
  const list = Array.isArray(players) ? players : []
  for (const player of list) {
    const crossing = player?.botMoveCrossing
    if (!crossing || typeof crossing !== 'object') continue
    if (botId && String(crossing.turnPlayerId ?? '') !== botId) continue
    if (Number(crossing.turnSeq) !== seq) continue
    if (matchId && crossing.matchId && String(crossing.matchId) !== String(matchId)) {
      continue
    }
    return {
      ok: true,
      crossedStart: crossing.crossedStart === true,
      actionId: crossing.actionId || null,
      source: 'player',
    }
  }
  if (
    lastRollMatchesTurn(lastRoll, turnPlayerId, turnSeq) &&
    typeof lastRoll.crossedStart === 'boolean'
  ) {
    return {
      ok: true,
      crossedStart: lastRoll.crossedStart === true,
      actionId: null,
      source: 'lastRoll',
    }
  }
  return { ok: false, crossedStart: null, actionId: null, source: null }
}

export function hasConfirmedBotMoveForTurn(opts = {}) {
  const move = findConfirmedBotMoveAction(opts)
  if (move.ok) return { ok: true, actionId: move.actionId, reason: 'last-actions' }
  if (lastRollMatchesTurn(opts.lastRoll, opts.turnPlayerId, opts.turnSeq)) {
    return { ok: true, actionId: null, reason: 'last-roll' }
  }
  const crossing = readBotMoveCrossing(opts)
  if (crossing.ok) {
    return { ok: true, actionId: crossing.actionId, reason: 'crossing' }
  }
  return { ok: false, actionId: null, reason: 'none' }
}

/**
 * A — sem ROLL
 * B — lastRollTurnKey sem evidência utilizável de BOT_MOVE
 * C — BOT_MOVE confirmado; reconstruir pending e entregar ao tick
 * D — turno já avançou
 *
 * allowHandoff no caso C significa "tick pode concluir", não "emitir HANDOFF nu".
 */
export function classifyBotTurnRecovery({
  expectedTurnPlayerId,
  expectedTurnSeq,
  turnPlayerId,
  turnSeq,
  lastRollTurnKey,
  lastRoll = null,
  players = null,
  lastActions = null,
  matchId = null,
  gameOver = false,
} = {}) {
  const deny = (recoveryCase, kind, reason) => ({
    case: recoveryCase,
    kind,
    reason,
    allowRoll: false,
    allowMove: false,
    allowHandoff: false,
    actionId: null,
    steps: null,
    crossedStart: null,
    effectsSettled: false,
  })

  if (gameOver === true) {
    return deny('D', BOT_RECOVERY_COMPLETE, 'game-over')
  }
  if (String(turnPlayerId ?? '') !== String(expectedTurnPlayerId ?? '')) {
    return deny('D', BOT_RECOVERY_COMPLETE, 'turn-advanced')
  }
  if (Number(turnSeq) !== Number(expectedTurnSeq)) {
    return deny('D', BOT_RECOVERY_COMPLETE, 'turn-advanced')
  }

  const rolled =
    lastRollTurnKey != null &&
    String(lastRollTurnKey) === String(expectedTurnSeq)
  const confirmed = hasConfirmedBotMoveForTurn({
    matchId,
    turnPlayerId: expectedTurnPlayerId,
    turnSeq: expectedTurnSeq,
    players,
    lastActions,
    lastRoll,
  })
  const crossing = readBotMoveCrossing({
    players,
    matchId,
    turnPlayerId: expectedTurnPlayerId,
    turnSeq: expectedTurnSeq,
    lastRoll,
  })
  const steps = lastRollMatchesTurn(lastRoll, expectedTurnPlayerId, expectedTurnSeq)
    ? Number(lastRoll.steps)
    : null

  if (confirmed.ok) {
    const fx = readBotTurnEffects({
      players,
      matchId,
      turnPlayerId: expectedTurnPlayerId,
      turnSeq: expectedTurnSeq,
    })
    const effectsSettled = fx.ok ? isBotTurnEffectsSettled(fx.effects) : false
    return {
      case: 'C',
      kind: BOT_RECOVERY_NEEDS_HANDOFF,
      reason: confirmed.reason,
      allowRoll: false,
      allowMove: false,
      allowHandoff: true,
      actionId: confirmed.actionId || crossing.actionId,
      steps,
      crossedStart: crossing.ok ? crossing.crossedStart : null,
      effectsSettled,
    }
  }

  if (rolled) {
    return {
      case: 'B',
      kind: BOT_RECOVERY_NEEDS_MOVE,
      reason: 'reload-recovery-unsafe',
      allowRoll: false,
      allowMove: false,
      allowHandoff: false,
      actionId: null,
      steps,
      crossedStart: null,
      effectsSettled: false,
    }
  }

  return {
    case: 'A',
    kind: BOT_RECOVERY_NEEDS_ROLL,
    reason: 'needs-roll',
    allowRoll: true,
    allowMove: true,
    allowHandoff: false,
    actionId: null,
    steps: null,
    crossedStart: null,
    effectsSettled: false,
  }
}

export function classifyExecutorTakeover({
  localExecutorId,
  remoteExecutorId,
  lockTs,
  now = Date.now(),
} = {}) {
  const local = localExecutorId != null ? String(localExecutorId) : ''
  const remote = remoteExecutorId != null ? String(remoteExecutorId) : ''
  if (!remote || !local || remote === local) {
    return { action: 'proceed', reason: 'same-or-empty-executor' }
  }
  if (!botLeaseExpired(lockTs, now)) {
    return { action: 'wait', reason: 'other-executor-lease-valid' }
  }
  return { action: 'proceed', reason: 'orphan-lease-expired' }
}

/** Mesma regra do motor: todos os vivos com lastRevenueRound >= round. */
export function allAliveHaveCompletedRound(players, roundNow) {
  const alive = (Array.isArray(players) ? players : []).filter((p) => !p?.bankrupt)
  const round = Number(roundNow) || 0
  return (
    alive.length > 0 &&
    alive.every((p) => (Number(p.lastRevenueRound) || 0) >= round)
  )
}

/**
 * Próximo jogador após BOT_MOVE. Reusa findNextAliveIdx.
 * Não decide rodada/ENDGAME — isso exige crossedStart deste movimento.
 */
export function planBotReloadNextPlayer({
  players,
  turnPlayerId,
  turnIdx,
  round,
  maxRounds,
} = {}) {
  const list = Array.isArray(players) ? players : []
  const curId = turnPlayerId != null ? String(turnPlayerId) : ''
  if (!curId || list.length === 0) return null

  let curIdx = list.findIndex((p) => String(p?.id) === curId)
  if (curIdx < 0 && Number.isFinite(Number(turnIdx))) {
    curIdx = Number(turnIdx)
  }
  if (curIdx < 0) return null

  let nextTurnIdx = findNextAliveIdx(list, curIdx)
  const maxR = Number(maxRounds) || 0
  if (maxR > 0 && Number(round) === maxR) {
    let guard = 0
    while (guard < list.length) {
      const p = list[nextTurnIdx]
      if (p && !p.bankrupt && p.waitingAtRevenue !== true) break
      nextTurnIdx = (nextTurnIdx + 1) % list.length
      guard += 1
    }
  }

  const nextPlayer = list[nextTurnIdx]
  const nextTurnPlayerId =
    nextPlayer?.id != null ? String(nextPlayer.id) : null
  if (!nextTurnPlayerId) return null

  return {
    nextTurnIdx,
    nextTurnPlayerId,
    originTurnPlayerId: curId,
    sameSeat:
      nextTurnPlayerId === curId ||
      Number(nextTurnIdx) === Number(curIdx),
  }
}

/**
 * Reconstrói o pending que o tick existente consome.
 * crossedStart DESTE BOT_MOVE é obrigatório para incrementar/encerrar.
 * allAliveDone sozinho não incrementa.
 */
export function rebuildBotPendingAfterConfirmedMove({
  players,
  turnPlayerId,
  turnSeq,
  turnIdx,
  round,
  maxRounds,
  roundFlags,
  crossedStart,
  matchId = null,
} = {}) {
  const list = Array.isArray(players) ? players : []
  const next = planBotReloadNextPlayer({
    players: list,
    turnPlayerId,
    turnIdx,
    round,
    maxRounds,
  })
  if (!next) return null

  const roundNow = Number(round) || 1
  const maxR = Number(maxRounds) || 0
  const crossed = crossedStart === true
  const allAliveDone = allAliveHaveCompletedRound(list, roundNow)

  let shouldIncrementRound = false
  let endGame = false
  let nextRound = roundNow
  let nextRoundFlags = Array.isArray(roundFlags) ? [...roundFlags] : undefined

  if (crossed && allAliveDone && maxR > 0 && roundNow < maxR) {
    shouldIncrementRound = true
    nextRound = roundNow + 1
    if (Array.isArray(nextRoundFlags)) {
      nextRoundFlags = nextRoundFlags.map((_, idx) =>
        list[idx]?.bankrupt ? nextRoundFlags[idx] : false,
      )
    }
  } else if (crossed && allAliveDone && maxR > 0 && roundNow === maxR) {
    endGame = true
  }

  const fx = readBotTurnEffects({
    players: list,
    matchId,
    turnPlayerId,
    turnSeq,
  })
  const effectsSettled = fx.ok ? isBotTurnEffectsSettled(fx.effects) : false

  return {
    nextPlayers: list,
    nextTurnIdx: next.nextTurnIdx,
    nextTurnPlayerId: next.nextTurnPlayerId,
    originTurnPlayerId: next.originTurnPlayerId,
    originTurnSeq: Number(turnSeq) || 0,
    nextTurnSeq: (Number(turnSeq) || 0) + 1,
    nextRound,
    nextRoundFlags,
    timestamp: Date.now(),
    shouldIncrementRound,
    endGame,
    sameSeat: next.sameSeat,
    recovered: true,
    effectsSettled,
  }
}

/** Compat: próximo jogador sem assumir incremento. */
export function planBotReloadHandoff(opts = {}) {
  return rebuildBotPendingAfterConfirmedMove({
    ...opts,
    crossedStart: false,
  })
}

/**
 * Seed do claim reproduz o mesmo primeiro dado (botDecide ROLL = rollFairDie(rng)).
 * Não basta para retomar um caso B com lastRollTurnKey já marcado: o motor recusa
 * segundo ROLL. Fail-safe permanece.
 */
export function replayBotStepsFromSeed(seed, rollFairDieFn, createRngFn) {
  if (typeof rollFairDieFn !== 'function' || typeof createRngFn !== 'function') {
    return null
  }
  if (!Array.isArray(seed) || seed.length === 0) return null
  const steps = Number(rollFairDieFn(createRngFn(seed)))
  if (!Number.isFinite(steps) || steps < 1 || steps > 6) return null
  return steps
}

export function isReloadRecoveryCurrent({
  expectedTurnPlayerId,
  expectedTurnSeq,
  turnPlayerId,
  turnSeq,
  gameOver = false,
} = {}) {
  if (gameOver === true) return false
  if (String(turnPlayerId ?? '') !== String(expectedTurnPlayerId ?? '')) return false
  if (Number(turnSeq) !== Number(expectedTurnSeq)) return false
  return true
}

/** Marcador local de lifecycle — nunca persistir. */
export function buildLocallyStartedBotTurnKey({ matchId, turnPlayerId, turnSeq } = {}) {
  const id = turnPlayerId != null ? String(turnPlayerId) : ''
  if (!id) return ''
  return `${matchId != null ? String(matchId) : ''}|${id}|${Number(turnSeq) || 0}`
}

/**
 * Pending criado por advanceAndMaybeLap nesta montagem (não recovered).
 * Tem precedência absoluta sobre o recovery.
 */
export function pendingOwnsCurrentBotTurn({
  pending,
  matchId,
  turnPlayerId,
  turnSeq,
} = {}) {
  if (!pending || typeof pending !== 'object') return false
  if (pending.recovered === true) return false
  const originId =
    pending.originTurnPlayerId != null ? String(pending.originTurnPlayerId) : ''
  if (!originId || originId !== String(turnPlayerId ?? '')) return false
  if ((Number(pending.originTurnSeq) || 0) !== (Number(turnSeq) || 0)) return false
  if (
    pending.matchId != null &&
    matchId != null &&
    String(pending.matchId) !== String(matchId)
  ) {
    return false
  }
  return true
}

/**
 * Recovery só quando a montagem herdou o turno sem o ter iniciado.
 * Sem F5: pending normal ou turnKey local → recusa.
 */
export function shouldAllowBotReloadRecovery({
  matchId,
  turnPlayerId,
  turnSeq,
  pending = null,
  locallyStartedTurnKey = '',
} = {}) {
  const currentKey = buildLocallyStartedBotTurnKey({
    matchId,
    turnPlayerId,
    turnSeq,
  })
  if (currentKey && locallyStartedTurnKey && String(locallyStartedTurnKey) === currentKey) {
    return { ok: false, reason: 'locally-started-turn' }
  }
  if (pendingOwnsCurrentBotTurn({ pending, matchId, turnPlayerId, turnSeq })) {
    return { ok: false, reason: 'normal-pending-owns-turn' }
  }
  return { ok: true, reason: 'inherited-incomplete-turn' }
}

/**
 * Espera o BOT_MOVE de qualquer executor deste turnSeq (prefixo, sem exigir actionId de Y).
 * Usado no takeover órfão e no caso B. timeoutMs<=0 faz um único peek.
 */
export async function waitForConfirmedBotMove({
  signal,
  sleep,
  getSnapshot,
  expectedTurnPlayerId,
  expectedTurnSeq,
  timeoutMs = LATE_BOT_MOVE_WAIT_MS,
  pollMs = 50,
} = {}) {
  const started = Date.now()
  const peek = () => {
    if (signal?.aborted) {
      return { ok: false, reason: 'cancelled', case: null }
    }
    const snap = typeof getSnapshot === 'function' ? getSnapshot() : {}
    if (snap.gameOver === true) {
      return { ok: false, reason: 'game-over', case: 'D' }
    }
    if (
      !isReloadRecoveryCurrent({
        expectedTurnPlayerId,
        expectedTurnSeq,
        turnPlayerId: snap.turnPlayerId ?? expectedTurnPlayerId,
        turnSeq: snap.turnSeq ?? expectedTurnSeq,
        gameOver: snap.gameOver === true,
      })
    ) {
      return { ok: false, reason: 'turn-advanced', case: 'D' }
    }
    const confirmed = hasConfirmedBotMoveForTurn({
      matchId: snap.matchId,
      turnPlayerId: expectedTurnPlayerId,
      turnSeq: expectedTurnSeq,
      players: snap.players,
      lastActions: snap.lastActions,
      lastRoll: snap.lastRoll,
    })
    if (confirmed.ok) {
      return {
        ok: true,
        reason: confirmed.reason,
        actionId: confirmed.actionId,
        case: 'C',
      }
    }
    return null
  }

  while (true) {
    const hit = peek()
    if (hit) return hit
    if (!Number(timeoutMs) || timeoutMs <= 0 || Date.now() - started >= timeoutMs) {
      return { ok: false, reason: 'late-move-timeout', case: null }
    }
    if (typeof sleep !== 'function') {
      return { ok: false, reason: 'late-move-timeout', case: null }
    }
    try {
      await sleep(pollMs, signal)
    } catch (err) {
      return { ok: false, reason: err?.reason || 'cancelled', case: null }
    }
  }
}

export function isBotTurnEligibleForReloadRecovery(player) {
  return isBotPlayer(player)
}
