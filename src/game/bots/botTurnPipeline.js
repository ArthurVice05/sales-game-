import { botTurnKey } from './botTypes.js'
import { botLeaseExpired } from './botTurnClaim.js'
import { isDevVerbose } from '../debugFlags.js'
import { isValidClaimProof, enrichSuccessfulClaimResult } from './botClaimProof.js'
import { evaluateBotCoordinatorGate } from './botAuthority.js'
import { createBotSeed, createBotRng, rollFairDie } from './botRandom.js'
import { evaluateBotClaimCas, shouldRunBotPhase } from './botTurnClaim.js'
import { requestTurnDecision } from './botDecisionProvider.js'
import {
  runBotRollPersistentRetry,
  validateRollRetryContinue,
  waitForBotPipelineHandoff,
  BOT_ROLL_RETRY_MS,
  sleepCancellable,
} from './botRollRetry.js'
import {
  runBotClaimPersistentRetry,
  validateClaimRetryContinue,
  isSuccessfulClaimResult,
  BOT_CLAIM_RETRY_MS,
} from './botClaimRetry.js'
import { BOT_THINK_MIN_MS, BOT_THINK_MAX_MS, PRESENCE_LOAD_STATE } from './botTypes.js'
import {
  evaluateBotTurnAuthoritativeReadiness,
  isAuthoritativeReadyScalar,
} from './botTurnReadiness.js'

export { PRESENCE_LOAD_STATE }
export { evaluateBotTurnAuthoritativeReadiness, isAuthoritativeReadyScalar }

function pipelineLogEnabled() {
  try {
    return isDevVerbose()
  } catch {
    return false
  }
}

function abbrevExecutor(id) {
  if (id == null) return null
  const s = String(id)
  return s.length <= 8 ? s : `${s.slice(0, 4)}…${s.slice(-2)}`
}

export function logBotPipeline(event, fields = {}) {
  if (!pipelineLogEnabled()) return
  console.log('[BOT_PIPELINE]', event, {
    matchId: fields.matchId ?? null,
    turnPlayerId: fields.turnPlayerId ?? null,
    turnSeq: fields.turnSeq ?? null,
    turnKey: fields.turnKey ?? null,
    executor: abbrevExecutor(fields.localExecutorId ?? fields.executorId),
    stage: fields.stage ?? event,
    reason: fields.reason ?? null,
  })
}

export function derivePresenceLoadState({
  hasAttemptedFetch = false,
  lastFetchError = null,
  list = null,
} = {}) {
  if (!hasAttemptedFetch) {
    return { state: PRESENCE_LOAD_STATE.LOADING, reason: 'not-fetched' }
  }
  if (lastFetchError) {
    return { state: PRESENCE_LOAD_STATE.ERROR, reason: 'fetch-error' }
  }
  return {
    state: PRESENCE_LOAD_STATE.READY,
    reason: 'loaded',
    isEmpty: !Array.isArray(list) || list.length === 0,
  }
}

export function buildBotTurnCycleKey({
  enabled = false,
  botsEnabled = false,
  gameOver = false,
  matchId = null,
  turnPlayerId = null,
  turnSeq = null,
  isBotTurn = false,
} = {}) {
  if (!enabled || !botsEnabled || gameOver || !isBotTurn) return ''
  if (!matchId || !turnPlayerId) return ''
  return botTurnKey(matchId, turnPlayerId, turnSeq) || ''
}

export async function waitForLiveCondition({
  signal,
  sleep,
  delayMs = 200,
  maxBackoffMs = 4000,
  getSnapshot,
  isDone,
  isTerminal,
} = {}) {
  let backoff = delayMs
  while (true) {
    if (signal?.aborted) {
      return { ok: false, reason: 'cancelled', terminal: true }
    }
    const snap = typeof getSnapshot === 'function' ? getSnapshot() : null
    if (isDone(snap)) {
      return { ok: true, snapshot: snap }
    }
    const term = typeof isTerminal === 'function' ? isTerminal(snap) : null
    if (term?.terminal) {
      return { ok: false, reason: term.reason, terminal: true }
    }
    try {
      await sleep(backoff, signal)
    } catch (err) {
      return { ok: false, reason: err?.reason || 'cancelled', terminal: true }
    }
    backoff = Math.min(maxBackoffMs, Math.floor(backoff * 1.25) + delayMs)
  }
}

export async function waitForAuthoritativeBotTurn({
  signal,
  sleep,
  getLive,
  expectedMatchId,
  expectedTurnPlayerId,
  expectedTurnSeq,
  requireRemote = true,
  delayMs = 200,
  onWait,
} = {}) {
  return waitForLiveCondition({
    signal,
    sleep,
    delayMs,
    getSnapshot: () => {
      const live = typeof getLive === 'function' ? getLive() : {}
      return evaluateBotTurnAuthoritativeReadiness({
        expectedMatchId,
        expectedTurnPlayerId,
        expectedTurnSeq,
        remoteMatchId: live.remoteMatchId ?? null,
        remoteTurnPlayerId: live.remoteTurnPlayerId ?? null,
        remoteTurnSeq: live.remoteTurnSeq ?? null,
        remoteGameOver: live.remoteGameOver === true,
        requireRemote: live.authoritativeNetEnabled ?? requireRemote,
      })
    },
    isDone: (readiness) => isAuthoritativeReadyScalar(readiness),
    isTerminal: (readiness) => {
      const live = typeof getLive === 'function' ? getLive() : {}
      if (Number(live.turnSeq) !== Number(expectedTurnSeq)) {
        return { terminal: true, reason: 'turn-seq-changed' }
      }
      if (String(live.turnPlayerId ?? '') !== String(expectedTurnPlayerId ?? '')) {
        return { terminal: true, reason: 'turn-player-changed' }
      }
      if (readiness?.reason === 'game-over' || readiness?.reason === 'match-mismatch') {
        return { terminal: true, reason: readiness.reason }
      }
      if (readiness?.reason && readiness.reason !== 'waiting-remote-handoff' && !readiness.ok) {
        if (readiness.reason === 'stale-local-cycle') {
          return { terminal: true, reason: readiness.reason }
        }
      }
      if (readiness?.reason === 'waiting-remote-handoff' && typeof onWait === 'function') {
        onWait(readiness)
      }
      return null
    },
  })
}

export function shouldContinueBotTurnCycle({
  getLive,
  expectedMatchId,
  expectedTurnPlayerId,
  expectedTurnSeq,
  localExecutorId,
  getCoordinatorGate,
} = {}) {
  const live = typeof getLive === 'function' ? getLive() : {}
  if (!live.enabled || !live.botsEnabled || live.gameOver) {
    return { ok: false, reason: 'inactive', terminal: true }
  }
  if (String(live.matchId ?? '') !== String(expectedMatchId ?? '')) {
    return { ok: false, reason: 'match-changed', terminal: true }
  }
  if (String(live.turnPlayerId ?? '') !== String(expectedTurnPlayerId ?? '')) {
    return { ok: false, reason: 'turn-player-changed', terminal: true }
  }
  if (Number(live.turnSeq) !== Number(expectedTurnSeq)) {
    return { ok: false, reason: 'turn-seq-changed', terminal: true }
  }
  const rollKey = expectedTurnSeq != null ? String(expectedTurnSeq) : ''
  if (rollKey && live.lastRollTurnKey != null && String(live.lastRollTurnKey) === rollKey) {
    return { ok: false, reason: 'already-rolled', terminal: true }
  }
  const coord = typeof getCoordinatorGate === 'function' ? getCoordinatorGate() : { ok: true }
  if (!coord.ok && coord.terminal !== false) {
    return { ok: false, reason: coord.reason || 'not-coordinator', terminal: true }
  }
  if (!coord.ok) {
    return { ok: false, reason: coord.reason || 'not-coordinator', terminal: false, waiting: true }
  }
  const localExec = localExecutorId != null ? String(localExecutorId) : ''
  const remoteExec = live.botClaimExecutor != null ? String(live.botClaimExecutor) : ''
  if (remoteExec && localExec && remoteExec !== localExec && !botLeaseExpired(live.lockTs)) {
    return { ok: false, reason: 'other-executor', terminal: true }
  }
  return { ok: true }
}

export function resolveNextThinkingState(previous, name) {
  const nextName = name || 'Máquina'
  if (previous?.name === nextName) return previous
  return { name: nextName }
}

export function resolveNextThinkingClear(previous) {
  return previous === null ? previous : null
}

export function presenceListsSemanticallyEqual(a, b) {
  if (a === b) return true
  if (!Array.isArray(a) || !Array.isArray(b)) return false
  if (a.length !== b.length) return false
  const norm = (list) =>
    [...list]
      .map((row) => ({
        playerId: String(row?.playerId ?? ''),
        lastSeen: row?.lastSeen == null ? null : Number(row.lastSeen),
      }))
      .sort((x, y) => x.playerId.localeCompare(y.playerId))
  const left = norm(a)
  const right = norm(b)
  for (let i = 0; i < left.length; i++) {
    if (left[i].playerId !== right[i].playerId) return false
    if (left[i].lastSeen !== right[i].lastSeen) return false
  }
  return true
}

export function buildBotExecutionTriggerKey({
  enabled = false,
  botsEnabled = false,
  gameOver = false,
  matchId = null,
  turnPlayerId = null,
  turnSeq = null,
  isBotTurn = false,
  presenceReady = false,
  coordinatorId = '',
  iAmCoordinator = false,
  authoritativeReady = false,
} = {}) {
  if (!enabled || !botsEnabled || gameOver || !isBotTurn) return ''
  if (!matchId || !turnPlayerId) return ''
  const cycle = botTurnKey(matchId, turnPlayerId, turnSeq)
  if (!cycle) return ''
  return [
    cycle,
    presenceReady ? 'p1' : 'p0',
    coordinatorId || 'none',
    iAmCoordinator ? 'me' : 'other',
    authoritativeReady ? 'ar1' : 'ar0',
  ].join('|')
}

export function shouldRestartBotExecution(previousKey, nextKey) {
  return String(previousKey ?? '') !== String(nextKey ?? '')
}

export function reserveBotExecutionPhase(executedKeys, phaseKey) {
  const keys = Array.isArray(executedKeys) ? executedKeys : []
  if (keys.includes(phaseKey)) return { keys, reserved: false }
  return { keys: [...keys, phaseKey], reserved: true }
}

export function releaseBotExecutionPhase(executedKeys, phaseKey) {
  const keys = Array.isArray(executedKeys) ? executedKeys : []
  if (!phaseKey || !keys.includes(phaseKey)) return keys
  return keys.filter((k) => k !== phaseKey)
}

const TERMINAL_CAS_REASONS = new Set([
  'game-over',
  'match-id',
  'turn-player',
  'turn-seq',
  'not-bot-turn',
  'already-rolled',
  'stale-bot-turn-key',
  'phase-rolled',
  'human-lock',
  'bot-id-mismatch',
])

function buildRemoteSnapshot(live) {
  const useRemote = live.authoritativeNetEnabled === true
  return {
    matchId: useRemote ? (live.remoteMatchId ?? live.matchId) : live.matchId,
    turnPlayerId: useRemote ? (live.remoteTurnPlayerId ?? live.turnPlayerId) : live.turnPlayerId,
    turnSeq: useRemote ? (live.remoteTurnSeq ?? live.turnSeq) : live.turnSeq,
    gameOver: useRemote ? live.remoteGameOver === true : live.gameOver === true,
    turnLock: live.turnLock,
    lockOwner: live.lockOwner,
    lockTs: live.lockTs,
    lastRollTurnKey: live.lastRollTurnKey,
    currentPlayer: live.currentPlayer,
    botTurnKey: live.botTurnKey,
    botTurnSeed: live.botTurnSeed,
    botClaimExecutor: live.botClaimExecutor,
  }
}

/**
 * Máquina de estados assíncrona testável — usada por useBotTurnController.
 */
export async function runBotTurnPipeline({
  signal,
  liveRef,
  claimProofRef,
  ranKeysRef,
  executorId,
  matchId,
  turnPlayerId,
  turnSeq,
  botPlayer,
  myUidRef,
  lobbyHostIdRef,
  playersRef,
  presenceListRef,
  presenceFetchMetaRef,
  commitClaimRef,
  onBotRollRef,
  roundRef,
  maxRoundsRef,
  coordinatorIdRef,
  onThinking,
  stopHeartbeat,
  startHeartbeat,
  thinkDelayMs = null,
  waitDelayMs = BOT_CLAIM_RETRY_MS,
  claimDelayMs = BOT_CLAIM_RETRY_MS,
  rollDelayMs = BOT_ROLL_RETRY_MS,
  rollMaxBackoffMs = 4000,
  handoffPollMs = 100,
  handoffMaxWaitMs = 120_000,
} = {}) {
  const expectedTurnKey = botTurnKey(matchId, turnPlayerId, turnSeq)
  const logCtx = (extra = {}) => ({
    matchId,
    turnPlayerId,
    turnSeq,
    turnKey: expectedTurnKey,
    localExecutorId: executorId,
    ...extra,
  })

  logBotPipeline('turn-detected', logCtx())

  const getCoordinatorGate = () => {
    const derived = derivePresenceLoadState({
      hasAttemptedFetch: presenceFetchMetaRef.current.hasAttemptedFetch,
      lastFetchError: presenceFetchMetaRef.current.lastFetchError,
      list: presenceListRef.current,
    })
    return evaluateBotCoordinatorGate({
      presenceLoadState: derived.state,
      rosterPlayers: playersRef.current || [],
      presenceList: presenceListRef.current,
      myUid: myUidRef.current,
      lobbyHostId: lobbyHostIdRef.current,
      gameOver: liveRef.current.gameOver,
      isBotTurn: true,
    })
  }

  const buildClaimContext = () => {
    const remote = buildRemoteSnapshot(liveRef.current)
    const seed =
      Array.isArray(remote.botTurnSeed) && String(remote.botTurnKey) === expectedTurnKey
        ? remote.botTurnSeed
        : createBotSeed()
    const claim = {
      matchId,
      turnPlayerId,
      turnSeq,
      lockOwner: myUidRef.current,
      executorId,
      currentPlayer: botPlayer,
      seed,
      ok: true,
    }
    if (
      remote.turnLock === true &&
      remote.lockOwner != null &&
      String(remote.lockOwner) !== String(myUidRef.current)
    ) {
      claim.releaseExpectedOwner = String(remote.lockOwner)
    }
    return { claim, seed, remote }
  }

  const expected = {
    matchId,
    turnPlayerId,
    turnSeq,
    turnKey: expectedTurnKey,
    executorId,
  }

  const shouldContinueTurn = () =>
    shouldContinueBotTurnCycle({
      getLive: () => liveRef.current,
      expectedMatchId: expected.matchId,
      expectedTurnPlayerId: expected.turnPlayerId,
      expectedTurnSeq: expected.turnSeq,
      localExecutorId: executorId,
      getCoordinatorGate,
    })

  const shouldContinueClaim = () => {
    if (signal?.aborted) return { ok: false, reason: 'cancelled', terminal: true }
    const cycle = shouldContinueTurn()
    if (!cycle.ok) return cycle
    const live = liveRef.current
    return validateClaimRetryContinue({
      signal,
      enabled: live.enabled,
      botsEnabled: live.botsEnabled,
      expectedMatchId: expected.matchId,
      expectedTurnPlayerId: expected.turnPlayerId,
      expectedTurnSeq: expected.turnSeq,
      expectedTurnKey: expected.turnKey,
      gameOver: live.gameOver,
      lastRollTurnKey: live.lastRollTurnKey,
      localExecutorId: executorId,
      remoteExecutorId: live.botClaimExecutor,
      lockTs: live.lockTs,
      requireRemote: live.authoritativeNetEnabled,
      remoteMatchId: live.remoteMatchId,
      remoteTurnPlayerId: live.remoteTurnPlayerId,
      remoteTurnSeq: live.remoteTurnSeq,
      remoteGameOver: live.remoteGameOver,
      iAmCoordinator: true,
    })
  }

  const shouldContinueRoll = (turnKey) => {
    if (signal?.aborted) return { ok: false, reason: 'cancelled' }
    const cycle = shouldContinueTurn()
    if (!cycle.ok) return { ok: false, reason: cycle.reason }
    const live = liveRef.current
    const proof = claimProofRef?.current ?? null
    return validateRollRetryContinue({
      signal,
      enabled: live.enabled,
      botsEnabled: live.botsEnabled,
      matchId: live.matchId,
      turnPlayerId: live.turnPlayerId,
      turnSeq: live.turnSeq,
      turnKey,
      gameOver: live.gameOver,
      claimValid: isValidClaimProof(proof),
      claimProof: proof,
      localExecutorId: executorId,
      remoteExecutorId: live.botClaimExecutor,
      lastRollTurnKey: live.lastRollTurnKey,
      expectedMatchId: expected.matchId,
      expectedTurnPlayerId: expected.turnPlayerId,
      expectedTurnSeq: expected.turnSeq,
      expectedTurnKey: expected.turnKey,
    })
  }

  let rollSucceeded = false
  let reservedPhaseKey = null

  const coordWait = await waitForLiveCondition({
    signal,
    sleep: sleepCancellable,
    delayMs: waitDelayMs,
    getSnapshot: getCoordinatorGate,
    isDone: (gate) => gate?.ok === true,
    isTerminal: (gate) => {
      if (gate?.terminal === true) {
        return { terminal: true, reason: gate.reason }
      }
      if (gate?.reason === 'presence-loading' || gate?.reason === 'presence-error') {
        logBotPipeline('waiting-presence', logCtx({ reason: gate.reason }))
      } else if (gate?.reason === 'not-coordinator') {
        logBotPipeline('not-coordinator', logCtx({ reason: gate.reason }))
      }
      return null
    },
  })
  if (!coordWait.ok) {
    logBotPipeline('cancelled', logCtx({ reason: coordWait.reason }))
    return { ok: false, reason: coordWait.reason, rollSucceeded }
  }

  const coord = coordWait.snapshot
  if (coordinatorIdRef) {
    coordinatorIdRef.current = String(coord.authorityId)
  }
  logBotPipeline('coordinator-ready', logCtx())

  const authWait = await waitForAuthoritativeBotTurn({
    signal,
    sleep: sleepCancellable,
    delayMs: waitDelayMs,
    getLive: () => liveRef.current,
    expectedMatchId: matchId,
    expectedTurnPlayerId: turnPlayerId,
    expectedTurnSeq: turnSeq,
    onWait: () => {
      logBotPipeline('waiting-remote-handoff', logCtx())
    },
  })
  if (!authWait.ok) {
    logBotPipeline('cancelled', logCtx({ reason: authWait.reason }))
    return { ok: false, reason: authWait.reason, rollSucceeded }
  }

  let cas = null
  while (!signal?.aborted) {
    const cycle = shouldContinueTurn()
    if (!cycle.ok) {
      logBotPipeline('cancelled', logCtx({ reason: cycle.reason }))
      return { ok: false, reason: cycle.reason, rollSucceeded }
    }
    const { claim, remote } = buildClaimContext()
    cas = evaluateBotClaimCas({ remote, claim, now: Date.now() })
    if (cas.ok) break
    if (TERMINAL_CAS_REASONS.has(cas.reason)) {
      logBotPipeline('claim-rejected', logCtx({ reason: cas.reason }))
      return { ok: false, reason: cas.reason, rollSucceeded }
    }
    try {
      await sleepCancellable(claimDelayMs, signal)
    } catch {
      return { ok: false, reason: 'cancelled', rollSucceeded }
    }
  }
  if (!cas?.ok) return { ok: false, reason: 'claim-cas-failed', rollSucceeded }

  const { claim, seed } = buildClaimContext()

  if (typeof onThinking === 'function') {
    onThinking(botPlayer?.name || 'Máquina')
  }

  const delay =
    thinkDelayMs != null
      ? Number(thinkDelayMs)
      : BOT_THINK_MIN_MS +
        Math.floor(Math.random() * (BOT_THINK_MAX_MS - BOT_THINK_MIN_MS + 1))
  if (delay > 0) {
    try {
      await sleepCancellable(delay, signal)
    } catch {
      return { ok: false, reason: 'cancelled', rollSucceeded, reservedPhaseKey }
    }
  }

  if (signal?.aborted) {
    return { ok: false, reason: 'cancelled', rollSucceeded, reservedPhaseKey }
  }

  logBotPipeline('claim-attempt', logCtx())
  const claimResult = await runBotClaimPersistentRetry({
    claim,
    seed,
    turnKey: cas.turnKey,
    steal: !!claim.releaseExpectedOwner,
    commitClaim: async (payload) => {
      logBotPipeline('claim-attempt', logCtx())
      return commitClaimRef.current?.(payload)
    },
    signal,
    shouldContinue: shouldContinueClaim,
    delayMs: claimDelayMs,
  })

  const enriched = enrichSuccessfulClaimResult(
    claimResult.lastResult,
    claim,
    cas.turnKey,
  )
  const proof = enriched?.claimProof ?? null
  if (!claimResult.ok || !isSuccessfulClaimResult(enriched) || !isValidClaimProof(proof)) {
    logBotPipeline('claim-rejected', {
      ...logCtx(),
      reason: claimResult.reason || enriched?.reason || 'claim-failed',
    })
    return {
      ok: false,
      reason: claimResult.reason || 'claim-failed',
      rollSucceeded,
      reservedPhaseKey,
    }
  }

  if (claimProofRef) {
    claimProofRef.current = proof
  }

  logBotPipeline('claim-accepted', logCtx())

  const phase = shouldRunBotPhase({
    executedKeys: ranKeysRef.current,
    turnKey: cas.turnKey,
    phase: 'ROLL',
  })
  if (!phase.run) return { ok: false, reason: 'idempotent', rollSucceeded }

  const inflightKey = `${phase.key}:inflight`
  if ((ranKeysRef.current || []).includes(inflightKey)) {
    return { ok: false, reason: 'already-reserved', rollSucceeded }
  }
  ranKeysRef.current = [...(ranKeysRef.current || []), inflightKey]
  reservedPhaseKey = inflightKey

  let heartbeatStarted = false
  if (typeof startHeartbeat === 'function') {
    startHeartbeat({ claim, seed, turnKey: cas.turnKey, signal })
    heartbeatStarted = true
  }

  try {
    const preRoll = shouldContinueRoll(cas.turnKey)
    if (!preRoll.ok) {
      logBotPipeline('roll-rejected', logCtx({ reason: preRoll.reason }))
      return { ok: false, reason: preRoll.reason, rollSucceeded, reservedPhaseKey }
    }

    const reCas = evaluateBotClaimCas({
      remote: buildRemoteSnapshot(liveRef.current),
      claim,
      now: Date.now(),
    })
    if (!reCas.ok) {
      logBotPipeline('roll-rejected', logCtx({ reason: reCas.reason }))
      return { ok: false, reason: reCas.reason, rollSucceeded, reservedPhaseKey }
    }

    const rng = createBotRng(seed)
    const rosterNow = playersRef.current || []
    const decision = await requestTurnDecision({
      kind: 'ROLL',
      actor: botPlayer,
      gameState: {
        players: rosterNow,
        round: roundRef.current,
        maxRounds: maxRoundsRef.current,
      },
      context: { rng },
    })
    const steps = Number(decision?.steps)
    const fair = steps >= 1 && steps <= 6 ? steps : rollFairDie(rng)
    const rollPayload = {
      steps: fair,
      actorId: botPlayer.id,
      botClaim: {
        ...claim,
        ok: true,
        turnKey: cas.turnKey,
        claimProof: claimProofRef?.current ?? proof,
      },
    }

    logBotPipeline('roll-attempt', logCtx())
    const rollResult = await runBotRollPersistentRetry({
      executedKeys: ranKeysRef.current,
      turnKey: cas.turnKey,
      onBotRoll: onBotRollRef.current,
      payload: rollPayload,
      signal,
      shouldContinue: () => shouldContinueRoll(cas.turnKey),
      delayMs: rollDelayMs,
      maxBackoffMs: rollMaxBackoffMs,
    })

    if (rollResult.ok) {
      rollSucceeded = true
      ranKeysRef.current = rollResult.executedKeys
      reservedPhaseKey = null
      logBotPipeline('roll-accepted', logCtx())
      await waitForBotPipelineHandoff({
        signal,
        getLive: () => liveRef.current,
        expectedTurnPlayerId: turnPlayerId,
        expectedTurnSeq: turnSeq,
        pollMs: handoffPollMs,
        maxWaitMs: handoffMaxWaitMs,
      })
      logBotPipeline('handoff-complete', logCtx())
      return { ok: true, rollSucceeded, rollCalls: rollResult.rollCalls }
    }

    logBotPipeline('roll-rejected', logCtx({ reason: rollResult.reason }))
    return {
      ok: false,
      reason: rollResult.reason,
      rollSucceeded,
      reservedPhaseKey,
      rollCalls: rollResult.rollCalls,
    }
  } finally {
    if (heartbeatStarted && typeof stopHeartbeat === 'function') {
      stopHeartbeat()
    }
  }
}
