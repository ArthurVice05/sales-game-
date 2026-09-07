// Presença durante a partida (heartbeat + HUD de ausência).
// NÃO avança turno por last_seen — isso pulava celular em mesa de 4.
// Reutiliza lobby_players.last_seen (não toca rooms.state no heartbeat).

import { useEffect, useRef } from 'react'
import {
  GAME_HEARTBEAT_INTERVAL_MS,
  GAME_OFFLINE_THRESHOLD_MS,
  GAME_PRESENCE_POLL_INTERVAL_MS,
  listLobbyPresence,
  startLobbyHeartbeat,
  touchLobbyPlayer,
  attemptHostTransferFromPresence,
} from '../lib/lobbies.js'
import {
  resolveGamePresencePlayerId,
  isTurnPlayerPresent,
  resolveTurnSkipAuthority,
  isRosterPlayerBankrupt,
} from './canonicalPresence.js'
import {
  getSharedSkipInFlight,
  wasAlreadySkipped,
  clearSharedSkipKeyIfStale,
} from './sharedTurnSkipGuard.js'
import { turnAttemptKey } from './turnTimerLogic.js'
import { shouldAttemptPresenceAutoSkip } from './presenceSkipLogic.js'
import { isBotPlayer } from './bots/botTypes.js'

import { isDevVerbose } from './debugFlags.js'

const DEV = isDevVerbose()

function devLog(...args) {
  if (DEV) console.log(...args)
}

/**
 * @param {object} opts
 * @param {boolean} opts.enabled
 * @param {string|null} opts.lobbyId
 * @param {string|null} opts.myUid — assento canônico (NÃO passar tab-id como fallback)
 * @param {string|null} [opts.lobbyHostId] — lobbies.host_id (fallback de autoridade)
 * @param {array} opts.players
 * @param {string|null} opts.turnPlayerId
 * @param {number} opts.turnSeq
 * @param {boolean} opts.gameOver
 * @param {boolean} [opts.turnLock]
 * @param {(plan: object) => boolean|void} opts.attemptSkipTurn
 * @param {(status: 'waiting'|'skipped'|null) => void} opts.onStatus
 */
export function useGamePresenceAutoSkip({
  enabled,
  lobbyId,
  myUid,
  lobbyHostId = null,
  players,
  turnPlayerId,
  turnSeq,
  gameOver,
  turnLock = false,
  attemptSkipTurn,
  onStatus,
} = {}) {
  const playersRef = useRef(players)
  const turnPlayerIdRef = useRef(turnPlayerId)
  const turnSeqRef = useRef(turnSeq)
  const gameOverRef = useRef(gameOver)
  const turnLockRef = useRef(turnLock)
  const attemptSkipRef = useRef(attemptSkipTurn)
  const onStatusRef = useRef(onStatus)
  const lobbyHostIdRef = useRef(lobbyHostId)
  const statusRef = useRef(null)
  const waitingSinceRef = useRef(null)

  useEffect(() => { playersRef.current = players }, [players])
  useEffect(() => { turnPlayerIdRef.current = turnPlayerId }, [turnPlayerId])
  useEffect(() => { turnSeqRef.current = turnSeq }, [turnSeq])
  useEffect(() => { gameOverRef.current = gameOver }, [gameOver])
  useEffect(() => { turnLockRef.current = !!turnLock }, [turnLock])
  useEffect(() => { attemptSkipRef.current = attemptSkipTurn }, [attemptSkipTurn])
  useEffect(() => { onStatusRef.current = onStatus }, [onStatus])
  useEffect(() => { lobbyHostIdRef.current = lobbyHostId }, [lobbyHostId])

  const skippedClearTimerRef = useRef(null)

  const setStatus = (next) => {
    if (statusRef.current === next) return
    statusRef.current = next
    try { onStatusRef.current?.(next) } catch {}
    if (skippedClearTimerRef.current) {
      clearTimeout(skippedClearTimerRef.current)
      skippedClearTimerRef.current = null
    }
    if (next === 'skipped') {
      skippedClearTimerRef.current = setTimeout(() => {
        if (statusRef.current === 'skipped') setStatus(null)
      }, 4000)
    }
  }

  // Heartbeat canônico — SOMENTE seat id no roster (nunca tab-id).
  // Depende dos ids do roster (não do cash) para rebind sem restart a cada patch.
  const rosterIdsKey = (Array.isArray(players) ? players : [])
    .map((p) => String(p?.id ?? ''))
    .filter(Boolean)
    .join('|')

  useEffect(() => {
    if (!enabled) return
    if (!lobbyId) return

    const roster = Array.isArray(playersRef.current) ? playersRef.current : []
    const presenceId = resolveGamePresencePlayerId({
      seatPlayerId: myUid,
      tabPlayerId: null,
      roster,
    })
    if (!presenceId) {
      devLog('[presence] heartbeat skipped: no canonical seat id')
      return
    }

    const stop = startLobbyHeartbeat({
      lobbyId,
      playerId: String(presenceId),
      intervalMs: GAME_HEARTBEAT_INTERVAL_MS,
      allowRecreateIfSeated: true,
    })
    // Touch imediato ao alinhar identidade (rebind/hydrate)
    touchLobbyPlayer({
      lobbyId,
      playerId: String(presenceId),
      allowRecreateIfSeated: true,
    }).catch(() => {})
    devLog('[presence] heartbeat started canonical=' + presenceId)

    const bump = () => {
      try {
        if (typeof document !== 'undefined' && document.visibilityState === 'hidden') return
      } catch {}
      touchLobbyPlayer({
        lobbyId,
        playerId: String(presenceId),
        allowRecreateIfSeated: true,
      }).catch(() => {})
    }
    const onVis = () => bump()
    try {
      document.addEventListener('visibilitychange', onVis)
      window.addEventListener('focus', onVis)
    } catch {}

    return () => {
      try { stop?.() } catch {}
      try {
        document.removeEventListener('visibilitychange', onVis)
        window.removeEventListener('focus', onVis)
      } catch {}
    }
  }, [enabled, lobbyId, myUid, rosterIdsKey])

  // Observa presença e (só a autoridade) tenta auto-skip
  useEffect(() => {
    if (!enabled) {
      setStatus(null)
      return
    }
    if (!lobbyId || !myUid) return

    let cancelled = false

    const evaluate = async () => {
      if (cancelled || getSharedSkipInFlight()) return
      if (gameOverRef.current) {
        setStatus(null)
        return
      }

      const roster = Array.isArray(playersRef.current) ? playersRef.current : []
      const presenceId = resolveGamePresencePlayerId({
        seatPlayerId: myUid,
        tabPlayerId: null,
        roster,
      })
      if (!presenceId) return

      const curTurnId = turnPlayerIdRef.current != null
        ? String(turnPlayerIdRef.current)
        : ''
      const curTurnSeq = Number(turnSeqRef.current) || 0
      clearSharedSkipKeyIfStale(curTurnId, curTurnSeq)
      if (!curTurnId || roster.length === 0) {
        setStatus(null)
        return
      }
      if (isRosterPlayerBankrupt(roster, curTurnId)) {
        setStatus(null)
        return
      }
      if (wasAlreadySkipped(curTurnId, curTurnSeq)) return

      // Atualiza last_seen canônico antes de decidir ausência
      try {
        await touchLobbyPlayer({
          lobbyId,
          playerId: String(presenceId),
          allowRecreateIfSeated: true,
        })
      } catch {}

      let presence
      try {
        presence = await listLobbyPresence(lobbyId)
      } catch {
        return
      }
      if (cancelled) return

      const now = Date.now()
      const turnPresent = isTurnPlayerPresent({
        turnPlayerId: curTurnId,
        presenceList: presence,
        now,
        thresholdMs: GAME_OFFLINE_THRESHOLD_MS,
      })

      // Se EU sou o jogador do turno e acabei de tocar presença canônica → online
      if (!turnPresent && String(presenceId) === curTurnId) {
        // Re-lê após touch próprio (evita falso waiting por race de lista)
        try {
          presence = await listLobbyPresence(lobbyId)
        } catch {
          return
        }
        if (cancelled) return
      }

      const currentTurnPlayer = roster.find((p) => String(p?.id) === curTurnId)
      const turnPresent2 = isBotPlayer(currentTurnPlayer)
        ? true
        : isTurnPlayerPresent({
            turnPlayerId: curTurnId,
            presenceList: presence,
            now: Date.now(),
            thresholdMs: GAME_OFFLINE_THRESHOLD_MS,
          })

      devLog('[presence] current turn present=' + (turnPresent2 ? 'true' : 'false'))

      const auth = resolveTurnSkipAuthority({
        rosterPlayers: roster,
        presenceList: presence,
        now: Date.now(),
        myUid: presenceId,
        lobbyHostId: lobbyHostIdRef.current,
      })
      const amCoordinator = auth.authorized === true
      devLog('[presence] authority=' + auth.reason + ' self=' + (amCoordinator ? 'true' : 'false'))

      // Host transfer (independente do auto-skip)
      try {
        const candidateIds = roster
          .filter((p) => !isBotPlayer(p))
          .map((p) => String(p?.id ?? ''))
          .filter(Boolean)
        const ht = await attemptHostTransferFromPresence({
          lobbyId,
          myUid: String(presenceId),
          candidateIds,
        })
        if (ht?.transferred) {
          devLog('[host-transfer] committed')
        } else if (ht?.casLost) {
          devLog('[host-transfer] CAS lost')
        } else if (ht?.reason === 'no-present') {
          devLog('[host-transfer] no present candidate')
        }
      } catch {
        // fail-safe
      }
      if (cancelled) return

      const turnKey = turnAttemptKey(curTurnId, curTurnSeq)
      const prevWait = waitingSinceRef.current
      const prevWaitMs =
        prevWait && prevWait.key === turnKey ? prevWait.at : null

      const decision = shouldAttemptPresenceAutoSkip({
        turnPresent: turnPresent2,
        turnLock: !!turnLockRef.current,
        gameOver: !!gameOverRef.current,
        amCoordinator,
        turnPlayerId: curTurnId,
        turnSeq: curTurnSeq,
        waitingSinceMs: prevWaitMs,
        now: Date.now(),
        inFlight: getSharedSkipInFlight(),
      })

      if (decision.waitingSinceMs != null) {
        waitingSinceRef.current = { key: turnKey, at: decision.waitingSinceMs }
      } else {
        waitingSinceRef.current = null
      }

      if (decision.reason === 'present' || decision.reason === 'turn-locked' || decision.reason === 'game-over') {
        if (statusRef.current === 'waiting') {
          devLog('[auto-skip] cancelled player returned')
        }
        setStatus(null)
        return
      }

      // Ausente: só HUD. Cronômetro do turno é quem avança (evita pular celular “offline”).
      if (!decision.ok) {
        setStatus('waiting')
        if (DEV) devLog('[presence] hud-wait reason=' + decision.reason)
      }
    }

    evaluate().catch(() => {})
    const t = setInterval(() => {
      evaluate().catch(() => {})
    }, GAME_PRESENCE_POLL_INTERVAL_MS)

    return () => {
      cancelled = true
      clearInterval(t)
    }
  }, [enabled, lobbyId, myUid, lobbyHostId])
}
