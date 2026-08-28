/**
 * Simulador de partida multiplayer (1 desktop + N mobile) para backtests de skip.
 */

import { planOfflineTurnSkip } from '../offlineTurnSkip.js'
import {
  resolveTurnSkipAuthority,
  pickPresenceCoordinator,
  isTurnPlayerPresent,
  GAME_OFFLINE_THRESHOLD_MS,
} from '../canonicalPresence.js'
import {
  computeTurnDeadlineAt,
  remainingTurnMs,
  resolveTurnDeadlineAfterHandoff,
  shouldArmCoordinatorTimer,
  shouldAttemptTimerAutoPass,
} from '../turnTimerLogic.js'
import { applyGamePatchToState } from '../playerStateSync.js'
import { shouldAttemptPresenceAutoSkip } from '../presenceSkipLogic.js'

export function rosterFromIds(ids) {
  return ids.map((id) => ({ id, name: id, bankrupt: false }))
}

export function freshPresence(ids, now, lagById = {}) {
  return ids.map((id) => ({
    playerId: id,
    lastSeen: now - (lagById[id] ?? 0),
  }))
}

export function createMatchState({
  playerIds,
  turnTimeSec = 90,
  maxRounds = 2,
  now = 0,
  coordinatorId,
} = {}) {
  const players = rosterFromIds(playerIds)
  const first = playerIds[0]
  return {
    players,
    turnPlayerId: first,
    turnSeq: 0,
    turnLock: false,
    lockOwner: null,
    turnDeadlineAt: computeTurnDeadlineAt(now, turnTimeSec),
    turnTimeSec,
    maxRounds,
    round: 1,
    gameOver: false,
    lastRollTurnKey: null,
    coordinatorId: coordinatorId ?? first,
  }
}

export function applyNetSnapshotToClient(clientView, incoming, now) {
  const prevId = String(clientView.turnPlayerId ?? '')
  const prevSeq = Number(clientView.turnSeq) || 0
  const nextId =
    incoming.turnPlayerId != null ? String(incoming.turnPlayerId) : prevId
  const nextSeq =
    typeof incoming.turnSeq === 'number' ? Number(incoming.turnSeq) : prevSeq
  const hasIncomingDeadline = Object.prototype.hasOwnProperty.call(
    incoming,
    'turnDeadlineAt',
  )
  const turnTimeSec = incoming.turnTimeSec ?? clientView.turnTimeSec

  const deadline = resolveTurnDeadlineAfterHandoff({
    prevTurnPlayerId: prevId,
    prevTurnSeq: prevSeq,
    nextTurnPlayerId: nextId,
    nextTurnSeq: nextSeq,
    incomingDeadlineAt: incoming.turnDeadlineAt,
    currentDeadlineAt: clientView.turnDeadlineAt,
    now,
    turnTimeSec,
    hasIncomingDeadline,
  })

  return {
    ...clientView,
    turnPlayerId: nextId,
    turnSeq: nextSeq,
    turnDeadlineAt: deadline,
    turnLock: incoming.turnLock ?? clientView.turnLock,
  }
}

export function buildTurnPatch(state, plan, { lastAction = 'NORMAL_HANDOFF', includeDeadline = true, now } = {}) {
  const patch = {
    kind: 'TURN',
    turnPlayerId: plan.nextTurnPlayerId,
    turnSeq: plan.nextTurnSeq,
    turnLock: false,
    lockOwner: null,
    lastRollTurnKey: null,
    lastAction,
    _expectTurnPlayerId: state.turnPlayerId,
    _expectTurnSeq: state.turnSeq,
    _commitKind: lastAction === 'AUTO_PASS_TIMER' ? 'AUTO_PASS' : 'NORMAL_HANDOFF',
  }
  if (includeDeadline) {
    patch.turnDeadlineAt = computeTurnDeadlineAt(now, state.turnTimeSec)
  }
  return patch
}

export function commitTurnPatch(state, patch, { now = Date.now() } = {}) {
  const applied = applyGamePatchToState(state, { statePatch: patch }, { now })
  if (!applied.ok) return { ok: false, reason: applied.reason, state }

  let next = applied.state
  const resolved = resolveTurnDeadlineAfterHandoff({
    prevTurnPlayerId: state.turnPlayerId,
    prevTurnSeq: state.turnSeq,
    nextTurnPlayerId: next.turnPlayerId,
    nextTurnSeq: next.turnSeq,
    incomingDeadlineAt: patch.turnDeadlineAt,
    currentDeadlineAt: next.turnDeadlineAt ?? state.turnDeadlineAt,
    now,
    turnTimeSec: state.turnTimeSec,
    hasIncomingDeadline: Object.prototype.hasOwnProperty.call(patch, 'turnDeadlineAt'),
  })
  next = { ...next, turnDeadlineAt: resolved }
  return { ok: true, state: next }
}

export function evaluateCoordinatorTimer(state, presence, now, { lastAttemptKey = null, inFlight = false } = {}) {
  const coordinatorId = pickPresenceCoordinator(state.players, presence, now)
  if (!coordinatorId) return { action: 'none', reason: 'no-coordinator' }

  const auth = resolveTurnSkipAuthority({
    rosterPlayers: state.players,
    presenceList: presence,
    now,
    myUid: coordinatorId,
    lobbyHostId: state.coordinatorId,
  })
  if (!auth.authorized) return { action: 'none', reason: auth.reason }

  const remaining = remainingTurnMs(state.turnDeadlineAt, now)
  if (!shouldArmCoordinatorTimer({ remainingMs: remaining, turnDeadlineAt: state.turnDeadlineAt })) {
    return { action: 'none', reason: 'timer-not-armed', remaining }
  }

  const decision = shouldAttemptTimerAutoPass({
    now,
    turnDeadlineAt: state.turnDeadlineAt,
    turnLock: !!state.turnLock,
    gameOver: !!state.gameOver,
    amCoordinator: true,
    turnPlayerId: state.turnPlayerId,
    turnSeq: state.turnSeq,
    lastAttemptKey,
    inFlight,
  })
  if (!decision.ok) return { action: 'none', reason: decision.reason, remaining }

  return { action: 'auto-pass', attemptKey: decision.attemptKey, coordinatorId, remaining }
}

export function performAutoPass(state, now) {
  const plan = planOfflineTurnSkip({
    players: state.players,
    turnPlayerId: state.turnPlayerId,
    turnSeq: state.turnSeq,
    round: state.round,
    maxRounds: state.maxRounds,
  })
  if (!plan) return { ok: false, reason: 'no-plan', state }
  const patch = buildTurnPatch(state, plan, {
    lastAction: 'AUTO_PASS_TIMER',
    includeDeadline: true,
    now,
  })
  return commitTurnPatch(state, patch, { now })
}

export function handoffAfterPlay(state, now, { includeDeadline = true } = {}) {
  const plan = planOfflineTurnSkip({
    players: state.players,
    turnPlayerId: state.turnPlayerId,
    turnSeq: state.turnSeq,
    round: state.round,
    maxRounds: state.maxRounds,
  })
  if (!plan) return { ok: false, reason: 'no-plan', state }
  const patch = buildTurnPatch(state, plan, {
    lastAction: 'NORMAL_HANDOFF',
    includeDeadline,
    now,
  })
  const rolled = { ...state, lastRollTurnKey: String(state.turnSeq) }
  return commitTurnPatch(rolled, patch, { now })
}

/**
 * Avança relógio em passos; coordenador desktop tenta auto-pass a cada tick.
 * Retorna se houve skip injusto (auto-pass com remaining > 0 ou < minPlayMs após handoff).
 */
export function advanceTurnWithTimer({
  state,
  presence,
  startNow,
  endNow,
  tickMs = 500,
  handoffAt,
  minPlayAfterHandoffMs = 15_000,
} = {}) {
  const unfairSkips = []
  let now = startNow
  let current = state
  let lastAttemptKey = null

  while (now <= endNow) {
    const evalResult = evaluateCoordinatorTimer(current, presence, now, { lastAttemptKey })
    if (evalResult.action === 'auto-pass') {
      const rem = remainingTurnMs(current.turnDeadlineAt, now)
      const sinceHandoff = handoffAt != null ? now - handoffAt : Infinity
      if (rem > 0 || sinceHandoff < minPlayAfterHandoffMs) {
        unfairSkips.push({
          at: now,
          player: current.turnPlayerId,
          reason: rem > 0 ? 'skip-before-deadline' : 'skip-too-soon-after-handoff',
          remainingMs: rem,
          sinceHandoffMs: sinceHandoff,
        })
      }
      const passed = performAutoPass(current, now)
      if (!passed.ok) break
      return { state: passed.state, unfairSkips, endedBy: 'auto-pass', at: now }
    }
    now += tickMs
  }
  return { state: current, unfairSkips, endedBy: 'completed', at: endNow }
}

/**
 * Partida completa 1D+3M (ou mix custom): cada jogador joga playDurationMs.
 */
export function simulateFullGame({
  playerIds = ['desktop', 'm1', 'm2', 'm3'],
  turnTimeSec = 90,
  maxRounds = 2,
  startNow = 1_000_000,
  playDurationMs = 45_000,
  handoffIncludesDeadline = true,
  presenceLagById = {},
  tickMs = 500,
} = {}) {
  const events = []
  const unfairSkips = []
  const rollsByPlayer = Object.fromEntries(playerIds.map((id) => [id, 0]))
  const skipsByPlayer = Object.fromEntries(playerIds.map((id) => [id, 0]))

  let state = createMatchState({ playerIds, turnTimeSec, maxRounds, now: startNow })
  let now = startNow
  const totalTurns = playerIds.length * maxRounds

  for (let t = 0; t < totalTurns; t += 1) {
    const turnPlayer = state.turnPlayerId
    const handoffAt = now
    const presence = freshPresence(playerIds, now, presenceLagById)

    const playEnd = now + playDurationMs
    const tickResult = advanceTurnWithTimer({
      state,
      presence,
      startNow: now,
      endNow: playEnd,
      tickMs,
      handoffAt,
    })
    unfairSkips.push(...tickResult.unfairSkips)

    if (tickResult.endedBy === 'auto-pass') {
      skipsByPlayer[turnPlayer] = (skipsByPlayer[turnPlayer] || 0) + 1
      events.push({ t: tickResult.at, type: 'AUTO_PASS', player: turnPlayer })
      state = tickResult.state
      now = tickResult.at + tickMs
      continue
    }

    rollsByPlayer[turnPlayer] = (rollsByPlayer[turnPlayer] || 0) + 1
    events.push({ t: playEnd, type: 'ROLL', player: turnPlayer })

    const handoff = handoffAfterPlay(state, playEnd, {
      includeDeadline: handoffIncludesDeadline,
    })
    if (!handoff.ok) break
    state = handoff.state
    now = playEnd

    const nextPlayer = state.turnPlayerId
    for (const mobileId of playerIds.filter((id) => id !== playerIds[0])) {
      const clientBefore = {
        turnPlayerId: turnPlayer,
        turnSeq: state.turnSeq - 1,
        turnDeadlineAt: computeTurnDeadlineAt(handoffAt, turnTimeSec),
        turnTimeSec,
        turnLock: false,
      }
      const incoming = {
        turnPlayerId: nextPlayer,
        turnSeq: state.turnSeq,
        turnLock: false,
        ...(handoffIncludesDeadline ? { turnDeadlineAt: state.turnDeadlineAt } : {}),
      }
      const mobileView = applyNetSnapshotToClient(clientBefore, incoming, now)
      const rem = remainingTurnMs(mobileView.turnDeadlineAt, now)
      const evalNext = evaluateCoordinatorTimer(
        {
          ...state,
          turnPlayerId: mobileView.turnPlayerId,
          turnSeq: mobileView.turnSeq,
          turnDeadlineAt: mobileView.turnDeadlineAt,
        },
        presence,
        now + tickMs,
      )
      if (evalNext.action === 'auto-pass' && String(nextPlayer) === mobileId) {
        unfairSkips.push({
          at: now + tickMs,
          player: mobileId,
          reason: 'mobile-view-stale-deadline',
          remainingMs: rem,
        })
      }
    }

    const turnPresent = isTurnPlayerPresent({
      turnPlayerId: nextPlayer,
      presenceList: presence,
      now,
    })
    const pres = shouldAttemptPresenceAutoSkip({
      turnPresent,
      turnLock: false,
      amCoordinator: true,
      turnPlayerId: nextPlayer,
      turnSeq: state.turnSeq,
      waitingSinceMs: now - 120_000,
      now,
    })
    if (pres.ok) {
      unfairSkips.push({ at: now, player: nextPlayer, reason: 'presence-skip-regression' })
    }

    events.push({ t: now, type: 'HANDOFF', from: turnPlayer, to: nextPlayer })
  }

  return {
    events,
    unfairSkips,
    stats: {
      turns: totalTurns,
      rollsByPlayer,
      skipsByPlayer,
      mobileUnfair: unfairSkips.filter((u) => u.player !== playerIds[0]).length,
    },
    finalState: state,
  }
}

/** Desktop termina turno tarde; mobile herda deadline quase zerado. */
export function scenarioStaleDeadlineHandoffToMobile({
  playerIds = ['desktop', 'm1', 'm2', 'm3'],
  turnTimeSec = 90,
  now = 2_000_000,
  includeDeadlineInPatch = false,
} = {}) {
  let state = createMatchState({ playerIds, turnTimeSec, now: now - 85_000 })
  state = { ...state, turnSeq: 1, turnPlayerId: 'desktop' }

  const handoff = handoffAfterPlay(state, now, { includeDeadline: includeDeadlineInPatch })
  if (!handoff.ok) return { ok: false, reason: handoff.reason }

  const next = handoff.state
  const presence = freshPresence(playerIds, now)
  const remaining = remainingTurnMs(next.turnDeadlineAt, now)
  const timer = evaluateCoordinatorTimer(next, presence, now + 500)

  return {
    ok: true,
    nextPlayer: next.turnPlayerId,
    remainingMs: remaining,
    immediateSkip: timer.action === 'auto-pass',
    turnDeadlineAt: next.turnDeadlineAt,
  }
}
