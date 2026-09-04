import { useEffect, useRef, useState } from 'react'
import { listLobbyPresence, GAME_PRESENCE_POLL_INTERVAL_MS } from '../../lib/lobbies.js'
import { isBotsFeatureEnabled } from './botFlags.js'
import { isBotPlayer, BOT_LEASE_HEARTBEAT_MS, botTurnKey, botActionKey } from './botTypes.js'
import { isValidClaimProof } from './botClaimProof.js'
import {
  buildBotTurnCycleKey,
  logBotPipeline,
  presenceListsSemanticallyEqual,
  releaseBotExecutionPhase,
  resolveNextThinkingClear,
  resolveNextThinkingState,
  runBotTurnPipeline,
} from './botTurnPipeline.js'
import { classifyHeartbeatTick } from './botRollRetry.js'
import { applyBotClaimToState } from './botTurnClaim.js'
import { getLiveBotMoveBarrier, shouldPauseBotHeartbeat } from './botMoveBarrier.js'
import {
  getBotForegroundCommitDepth,
  getSharedBotCommitSerializer,
} from './botForegroundCommit.js'

function generateExecutorId() {
  try {
    if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
      return crypto.randomUUID()
    }
    const buf = new Uint8Array(16)
    if (typeof crypto !== 'undefined' && typeof crypto.getRandomValues === 'function') {
      crypto.getRandomValues(buf)
    } else {
      for (let i = 0; i < 16; i++) buf[i] = Math.floor(Math.random() * 256)
    }
    return Array.from(buf).map((b) => b.toString(16).padStart(2, '0')).join('')
  } catch {
    return `ex-${Date.now()}-${Math.random().toString(36).slice(2)}`
  }
}

function stopHeartbeatTimer(ref) {
  if (ref.current) {
    clearInterval(ref.current)
    ref.current = null
  }
}

export function useBotTurnController({
  enabled,
  botsEnabled,
  lobbyId,
  players,
  myUid,
  matchId,
  turnPlayerId,
  turnSeq,
  gameOver,
  turnLock,
  lockOwner,
  lockTs,
  lastRollTurnKey,
  round,
  maxRounds,
  lobbyHostId,
  presenceList: presenceListProp,
  netState,
  commitClaim,
  onBotRoll,
  coordinatorIdRef = null,
  authoritativeNetEnabled = false,
  claimProofRef: claimProofRefProp = null,
} = {}) {
  const [thinking, setThinking] = useState(null)
  const [presenceList, setPresenceList] = useState(presenceListProp || [])
  const [presenceFetchMeta, setPresenceFetchMeta] = useState({
    hasAttemptedFetch: Array.isArray(presenceListProp),
    lastFetchError: null,
  })
  const ranKeysRef = useRef([])
  const heartbeatRef = useRef(null)
  const internalClaimProofRef = useRef(null)
  const claimProofRef = claimProofRefProp || internalClaimProofRef
  const liveRef = useRef({})
  const executorIdRef = useRef(null)
  const playersRef = useRef(players)
  const presenceListRef = useRef(presenceList)
  const presenceFetchMetaRef = useRef(presenceFetchMeta)
  const commitClaimRef = useRef(commitClaim)
  const onBotRollRef = useRef(onBotRoll)
  const roundRef = useRef(round)
  const maxRoundsRef = useRef(maxRounds)
  const lobbyHostIdRef = useRef(lobbyHostId)
  const myUidRef = useRef(myUid)
  const lobbyIdRef = useRef(lobbyId)

  if (executorIdRef.current === null) {
    executorIdRef.current = generateExecutorId()
  }

  const flagOn = botsEnabled != null ? botsEnabled : isBotsFeatureEnabled()
  const currentPlayer = (players || []).find((p) => String(p?.id) === String(turnPlayerId))
  const isBotTurn = isBotPlayer(currentPlayer)

  playersRef.current = players
  presenceListRef.current = presenceList
  presenceFetchMetaRef.current = presenceFetchMeta
  commitClaimRef.current = commitClaim
  onBotRollRef.current = onBotRoll
  roundRef.current = round
  maxRoundsRef.current = maxRounds
  lobbyHostIdRef.current = lobbyHostId
  myUidRef.current = myUid
  lobbyIdRef.current = lobbyId

  liveRef.current = {
    enabled,
    botsEnabled: flagOn,
    authoritativeNetEnabled,
    matchId,
    turnPlayerId,
    turnSeq,
    gameOver,
    turnLock,
    lockOwner,
    lockTs,
    lastRollTurnKey,
    currentPlayer,
    remoteMatchId: netState?.matchId ?? null,
    remoteTurnPlayerId: netState?.turnPlayerId ?? null,
    remoteTurnSeq: netState?.turnSeq ?? null,
    remoteGameOver: netState?.gameOver === true,
    remoteTurnDeadlineAt: netState?.turnDeadlineAt ?? null,
    botTurnKey: netState?.botTurnKey,
    botTurnSeed: netState?.botTurnSeed,
    botClaimExecutor: netState?.botClaimExecutor ?? null,
  }

  const turnCycleKey = buildBotTurnCycleKey({
    enabled,
    botsEnabled: flagOn,
    gameOver,
    matchId,
    turnPlayerId,
    turnSeq,
    isBotTurn,
  })

  const setThinkingName = (name) => {
    setThinking((previous) => resolveNextThinkingState(previous, name))
  }

  const clearThinking = () => {
    setThinking((previous) => resolveNextThinkingClear(previous))
  }

  useEffect(() => {
    if (Array.isArray(presenceListProp)) {
      setPresenceList((previous) =>
        presenceListsSemanticallyEqual(previous, presenceListProp)
          ? previous
          : presenceListProp
      )
      setPresenceFetchMeta((prev) => ({
        hasAttemptedFetch: true,
        lastFetchError: null,
      }))
    }
  }, [presenceListProp])

  useEffect(() => {
    if (!enabled || !flagOn || !lobbyIdRef.current) return undefined
    let cancelled = false
    const tick = async () => {
      try {
        const list = await listLobbyPresence(lobbyIdRef.current)
        if (!cancelled) {
          if (Array.isArray(list)) {
            setPresenceList((previous) =>
              presenceListsSemanticallyEqual(previous, list) ? previous : list
            )
          }
          setPresenceFetchMeta({
            hasAttemptedFetch: true,
            lastFetchError: null,
          })
        }
      } catch {
        if (!cancelled) {
          setPresenceFetchMeta((prev) => ({
            hasAttemptedFetch: true,
            lastFetchError: 'fetch-error',
          }))
        }
      }
    }
    tick()
    const t = setInterval(tick, GAME_PRESENCE_POLL_INTERVAL_MS)
    return () => {
      cancelled = true
      clearInterval(t)
    }
  }, [enabled, flagOn, lobbyId])

  useEffect(() => {
    const abortController = new AbortController()
    let localCancelled = false

    const cancelRun = () => {
      localCancelled = true
      abortController.abort()
    }

    stopHeartbeatTimer(heartbeatRef)
    claimProofRef.current = null

    const roster = playersRef.current || []
    const botPlayer = roster.find((p) => String(p?.id) === String(turnPlayerId))

    if (!enabled || !flagOn || gameOver || !isBotPlayer(botPlayer)) {
      clearThinking()
      return undefined
    }

    const executorId = executorIdRef.current
    const logCtx = (extra = {}) => ({
      matchId,
      turnPlayerId,
      turnSeq,
      localExecutorId: executorId,
      remoteExecutorId: liveRef.current.botClaimExecutor,
      coordinatorId: coordinatorIdRef?.current ?? myUidRef.current,
      ...extra,
    })

    const startHeartbeat = ({ claim, seed, turnKey, signal }) => {
      const commitClaimFn = commitClaimRef.current
      if (typeof commitClaimFn !== 'function') return
      heartbeatRef.current = setInterval(async () => {
        if (localCancelled || signal?.aborted) {
          stopHeartbeatTimer(heartbeatRef)
          return
        }
        if (
          shouldPauseBotHeartbeat({
            barrier: getLiveBotMoveBarrier(),
            foregroundDepth: getBotForegroundCommitDepth(),
          })
        ) {
          return
        }
        let result = null
        let error = null
        try {
          result = await getSharedBotCommitSerializer().enqueue(() =>
            commitClaimFn({
              claim,
              seed,
              turnKey,
              heartbeat: true,
            }),
          )
        } catch (err) {
          error = err
        }
        const live = liveRef.current
        const tick = classifyHeartbeatTick({
          result,
          error,
          live,
          expectedTurnPlayerId: turnPlayerId,
          expectedTurnSeq: turnSeq,
          localExecutorId: executorId,
          claimProof: claimProofRef.current,
          iAmCoordinator: true,
        })
        if (tick.action === 'abort') {
          logBotPipeline('heartbeat-lost', { ...logCtx(), reason: tick.reason })
          cancelRun()
          stopHeartbeatTimer(heartbeatRef)
        }
      }, BOT_LEASE_HEARTBEAT_MS)
    }

    runBotTurnPipeline({
      signal: abortController.signal,
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
      onThinking: (name) => setThinkingName(name),
      stopHeartbeat: () => stopHeartbeatTimer(heartbeatRef),
      startHeartbeat,
    })
      .then((result) => {
        if (!result?.rollSucceeded && result?.reservedPhaseKey) {
          ranKeysRef.current = releaseBotExecutionPhase(
            ranKeysRef.current,
            result.reservedPhaseKey
          )
        }
        const proof = claimProofRef.current
        if (!isValidClaimProof(proof)) {
          claimProofRef.current = null
        }
      })
      .finally(() => {
        stopHeartbeatTimer(heartbeatRef)
        clearThinking()
      })
      .catch(() => {})

    return () => {
      cancelRun()
      stopHeartbeatTimer(heartbeatRef)
      claimProofRef.current = null
      const cycleKey = botTurnKey(matchId, turnPlayerId, turnSeq)
      const alreadyRolled =
        liveRef.current.lastRollTurnKey != null &&
        String(liveRef.current.lastRollTurnKey) === String(turnSeq)
      if (!alreadyRolled && cycleKey) {
        const rollKey = botActionKey(cycleKey, 'ROLL')
        ranKeysRef.current = releaseBotExecutionPhase(
          releaseBotExecutionPhase(ranKeysRef.current, rollKey),
          `${rollKey}:inflight`
        )
      }
    }
  }, [turnCycleKey])

  return { thinking }
}

export { applyBotClaimToState, isValidClaimProof }
