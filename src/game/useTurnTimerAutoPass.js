// Auto-pass por tempo esgotado — autoridade = presence-coordinator ou host-fallback.
// Não remove a lógica de presença; compartilha o CAS de avanço.

import { useEffect, useRef } from 'react'
import { listLobbyPresence } from '../lib/lobbies.js'
import { resolveTurnSkipAuthority } from './canonicalPresence.js'
import {
  remainingTurnMs,
  shouldAttemptTimerAutoPass,
  shouldArmCoordinatorTimer,
  TURN_HANDOFF_STALE_REMAINING_MS,
} from './turnTimerLogic.js'
import { shouldProceedTimerAutoPassAfterAwait, shouldDisableTimerAutoPassForTurn, parseSkipAttemptResult } from './turnCommitValidation.js'
import {
  shouldAttemptLocalDecisionExpire,
  shouldAllowRemoteAutoPassThroughLock,
} from './decisionTimeoutPolicy.js'
import {
  getLastSharedSkipKey,
  getSharedSkipInFlight,
  markPendingSharedSkipKey,
  confirmSharedSkipKey,
  releaseSharedSkipKey,
  setSharedSkipInFlight,
  clearSharedSkipKeyIfStale,
  wasAlreadySkipped,
} from './sharedTurnSkipGuard.js'

import { isDevVerbose } from './debugFlags.js'

const DEV = isDevVerbose()
const POLL_MS = 500

function devLog(...args) {
  if (DEV) console.log(...args)
}

/**
 * @param {object} opts
 * @param {boolean} opts.enabled
 * @param {string|null} opts.lobbyId
 * @param {string|null} opts.myUid — assento canônico (sem fallback tab-id)
 * @param {string|null} [opts.lobbyHostId]
 * @param {array} opts.players
 * @param {string|null} opts.turnPlayerId
 * @param {number} opts.turnSeq
 * @param {number|null} opts.turnDeadlineAt
 * @param {boolean} opts.turnLock
 * @param {boolean} [opts.diceBusy]
 * @param {number} [opts.modalLocks]
 * @param {string|number|null} [opts.lastRollTurnKey]
 * @param {object|null} [opts.decisionHold]
 * @param {boolean} opts.gameOver
 * @param {number} opts.turnTimeSec
 * @param {(args: object) => boolean|void|Promise<boolean>} opts.attemptSkipTurn
 * @param {(args: object) => {ok:boolean}|void|Promise<object>} [opts.expireOpenDecisions]
 */
export function useTurnTimerAutoPass({
  enabled,
  lobbyId,
  myUid,
  lobbyHostId = null,
  players,
  turnPlayerId,
  turnSeq,
  turnDeadlineAt,
  turnLock,
  diceBusy = false,
  modalLocks = 0,
  lastRollTurnKey = null,
  decisionHold = null,
  gameOver,
  turnTimeSec,
  attemptSkipTurn,
  expireOpenDecisions = null,
} = {}) {
  const playersRef = useRef(players)
  const turnPlayerIdRef = useRef(turnPlayerId)
  const turnSeqRef = useRef(turnSeq)
  const deadlineRef = useRef(turnDeadlineAt)
  const turnLockRef = useRef(turnLock)
  const diceBusyRef = useRef(diceBusy)
  const modalLocksRef = useRef(modalLocks)
  const lastRollTurnKeyRef = useRef(lastRollTurnKey)
  const decisionHoldRef = useRef(decisionHold)
  const gameOverRef = useRef(gameOver)
  const attemptRef = useRef(attemptSkipTurn)
  const expireRef = useRef(expireOpenDecisions)
  const turnTimeSecRef = useRef(turnTimeSec)
  const lobbyHostIdRef = useRef(lobbyHostId)
  const armedKeyRef = useRef('')
  const skipArmedRef = useRef(false)
  const evalInFlightRef = useRef(false)

  useEffect(() => { playersRef.current = players }, [players])
  useEffect(() => { turnPlayerIdRef.current = turnPlayerId }, [turnPlayerId])
  useEffect(() => { turnSeqRef.current = turnSeq }, [turnSeq])
  useEffect(() => { deadlineRef.current = turnDeadlineAt }, [turnDeadlineAt])
  useEffect(() => { turnLockRef.current = turnLock }, [turnLock])
  useEffect(() => { diceBusyRef.current = diceBusy }, [diceBusy])
  useEffect(() => { modalLocksRef.current = modalLocks }, [modalLocks])
  useEffect(() => { lastRollTurnKeyRef.current = lastRollTurnKey }, [lastRollTurnKey])
  useEffect(() => { decisionHoldRef.current = decisionHold }, [decisionHold])
  useEffect(() => { gameOverRef.current = gameOver }, [gameOver])
  useEffect(() => { attemptRef.current = attemptSkipTurn }, [attemptSkipTurn])
  useEffect(() => { expireRef.current = expireOpenDecisions }, [expireOpenDecisions])
  useEffect(() => { turnTimeSecRef.current = turnTimeSec }, [turnTimeSec])
  useEffect(() => { lobbyHostIdRef.current = lobbyHostId }, [lobbyHostId])

  useEffect(() => {
    if (!enabled) return undefined
    if (!myUid) return undefined

    let cancelled = false

    const evaluate = async () => {
      if (cancelled) return
      if (evalInFlightRef.current) return

      clearSharedSkipKeyIfStale(turnPlayerIdRef.current, turnSeqRef.current)

      const curTurnId = turnPlayerIdRef.current != null
        ? String(turnPlayerIdRef.current)
        : ''
      const curTurnSeq = Number(turnSeqRef.current) || 0

      if (wasAlreadySkipped(curTurnId, curTurnSeq)) return
      if (getSharedSkipInFlight()) return

      const roster = Array.isArray(playersRef.current) ? playersRef.current : []

      if (shouldDisableTimerAutoPassForTurn(roster, curTurnId)) {
        armedKeyRef.current = ''
        skipArmedRef.current = false
        return
      }

      const now = Date.now()
      const turnKey = `${curTurnId}|${curTurnSeq}`
      const remaining = remainingTurnMs(deadlineRef.current, now)
      const armTimer = shouldArmCoordinatorTimer({
        remainingMs: remaining,
        turnDeadlineAt: deadlineRef.current,
      })
      if (armedKeyRef.current !== turnKey) {
        armedKeyRef.current = turnKey
        skipArmedRef.current = armTimer
        if (!skipArmedRef.current) {
          devLog('[turn-timer] skip desarmado no handoff rem=' + remaining)
        }
      } else if (!skipArmedRef.current && armTimer) {
        skipArmedRef.current = true
      }
      if (!skipArmedRef.current) return

      evalInFlightRef.current = true
      try {
        let amCoordinator = false
        let authReason = 'local'
        if (lobbyId) {
          let presence = []
          try {
            presence = await listLobbyPresence(lobbyId)
          } catch {
            return
          }
          if (cancelled) return
          const auth = resolveTurnSkipAuthority({
            rosterPlayers: roster,
            presenceList: presence,
            now,
            myUid: String(myUid),
            lobbyHostId: lobbyHostIdRef.current,
          })
          amCoordinator = auth.authorized === true
          authReason = auth.reason
        } else {
          amCoordinator = true
        }

        const decisionHold = decisionHoldRef.current
        const diceBusy = !!diceBusyRef.current
        const locked = !!turnLockRef.current

        // Decisão aberta neste cliente: resolve SKIP/OK e deixa o tick avançar.
        // Não chama attemptSkipTurn (evita segundo avanço).
        const localGate = shouldAttemptLocalDecisionExpire({
          now,
          turnDeadlineAt: deadlineRef.current,
          turnLock: locked,
          gameOver: !!gameOverRef.current,
          diceBusy,
          modalLocks: modalLocksRef.current,
          lastRollTurnKey: lastRollTurnKeyRef.current,
          turnSeq: curTurnSeq,
          hasOpenModals: Number(modalLocksRef.current) > 0,
        })
        const amTurnPlayer = !lobbyId || String(myUid) === curTurnId
        if (localGate.ok && amTurnPlayer && typeof expireRef.current === 'function') {
          setSharedSkipInFlight(true)
          try {
            if (String(turnPlayerIdRef.current || '') !== curTurnId) return
            if ((Number(turnSeqRef.current) || 0) !== curTurnSeq) return
            if (gameOverRef.current) return
            if (diceBusyRef.current) return

            const raw = expireRef.current({
              expectedTurnPlayerId: curTurnId,
              expectedTurnSeq: curTurnSeq,
              reason: 'AUTO_PASS_TIMER',
            })
            const exp = raw && typeof raw.then === 'function' ? await raw : raw
            if (exp?.ok) {
              markPendingSharedSkipKey(curTurnId, curTurnSeq)
              if (!lobbyId) confirmSharedSkipKey(curTurnId, curTurnSeq)
              devLog('[turn-timer] local decision expire ok category=' + (exp.category || ''))
              return
            }
            if (exp?.reason === 'unsupported-category') {
              devLog('[turn-timer] decision expire unsupported category=' + (exp.category || ''))
              return
            }
          } finally {
            setSharedSkipInFlight(false)
          }
        }

        const decision = shouldAttemptTimerAutoPass({
          now,
          turnDeadlineAt: deadlineRef.current,
          turnLock: locked,
          gameOver: !!gameOverRef.current,
          amCoordinator,
          turnPlayerId: curTurnId,
          turnSeq: curTurnSeq,
          lastAttemptKey: getLastSharedSkipKey(),
          inFlight: getSharedSkipInFlight(),
          decisionHold,
        })

        if (!decision.ok) {
          if ((decision.reason === 'turn-locked' || decision.reason === 'turn-locked-no-hold') && DEV) {
            devLog('[turn-timer] waiting turnLock clear')
          }
          if (decision.reason === 'not-coordinator' && DEV) {
            devLog('[turn-timer] not-coordinator reason=' + authReason)
          }
          return
        }

        setSharedSkipInFlight(true)
        try {
          if (String(turnPlayerIdRef.current || '') !== curTurnId) return
          if ((Number(turnSeqRef.current) || 0) !== curTurnSeq) return
          if (gameOverRef.current) return
          if (diceBusyRef.current) return
          if (turnLockRef.current) {
            const through = shouldAllowRemoteAutoPassThroughLock({
              turnLock: true,
              decisionHold: decisionHoldRef.current,
              expectedTurnPlayerId: curTurnId,
              expectedTurnSeq: curTurnSeq,
            })
            if (!through.ok) return
          }

          if (lobbyId) {
            let presence2 = []
            try {
              presence2 = await listLobbyPresence(lobbyId)
            } catch {
              return
            }
            if (cancelled) return
            const now2 = Date.now()
            const auth2 = resolveTurnSkipAuthority({
              rosterPlayers: roster,
              presenceList: presence2,
              now: now2,
              myUid: String(myUid),
              lobbyHostId: lobbyHostIdRef.current,
            })
            if (!auth2.authorized) {
              devLog('[turn-timer] authority=false reason=' + auth2.reason)
              return
            }

            const proceed = shouldProceedTimerAutoPassAfterAwait({
              now: now2,
              turnDeadlineAt: deadlineRef.current,
              turnLock: !!turnLockRef.current,
              gameOver: !!gameOverRef.current,
              capturedTurnPlayerId: curTurnId,
              capturedTurnSeq: curTurnSeq,
              currentTurnPlayerId: turnPlayerIdRef.current,
              currentTurnSeq: turnSeqRef.current,
              lastAttemptKey: getLastSharedSkipKey(),
              inFlight: false,
              amCoordinator: true,
              decisionHold: decisionHoldRef.current,
            })
            if (!proceed.ok) {
              if (DEV) devLog('[turn-timer] post-await blocked reason=' + proceed.reason)
              return
            }
          }

          if (wasAlreadySkipped(curTurnId, curTurnSeq)) return

          // Pós-roll sem lock: o tick já cuida do handoff — não force AUTO_PASS.
          const lrk = lastRollTurnKeyRef.current != null ? String(lastRollTurnKeyRef.current) : ''
          if (!turnLockRef.current && lrk && lrk === String(curTurnSeq)) {
            return
          }

          devLog('[turn-timer] attempt turnSeq=' + curTurnSeq + ' via=' + authReason)
          const result = attemptRef.current?.({
            expectedTurnPlayerId: curTurnId,
            expectedTurnSeq: curTurnSeq,
            reason: 'AUTO_PASS_TIMER',
          })

          let ok = false
          if (result && typeof result.then === 'function') {
            ok = parseSkipAttemptResult(await result)
          } else {
            ok = parseSkipAttemptResult(result)
          }

          if (ok) {
            markPendingSharedSkipKey(curTurnId, curTurnSeq)
            if (!lobbyId) {
              confirmSharedSkipKey(curTurnId, curTurnSeq)
            }
            devLog('[turn-timer] local applied (pending CAS)')
          } else {
            releaseSharedSkipKey(curTurnId, curTurnSeq)
            devLog('[turn-timer] local rejected')
          }
        } finally {
          setSharedSkipInFlight(false)
        }
      } finally {
        evalInFlightRef.current = false
      }
    }

    evaluate().catch(() => {})
    const t = setInterval(() => {
      evaluate().catch(() => {})
    }, POLL_MS)

    return () => {
      cancelled = true
      clearInterval(t)
    }
  }, [enabled, lobbyId, myUid, lobbyHostId])
}
