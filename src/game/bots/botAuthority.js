import { isBotPlayer } from './botTypes.js'
import { pickPresenceCoordinator, resolveTurnSkipAuthority } from '../canonicalPresence.js'
import { PRESENCE_LOAD_STATE } from './botTypes.js'

export function humanRosterPlayers(roster = []) {
  return (roster || []).filter((p) => p && !isBotPlayer(p))
}

export function resolveBotCoordinator({
  rosterPlayers = [],
  presenceList = [],
  now = Date.now(),
  myUid = null,
  lobbyHostId = null,
} = {}) {
  const humans = humanRosterPlayers(rosterPlayers)
  return resolveTurnSkipAuthority({
    rosterPlayers: humans,
    presenceList,
    now,
    myUid,
    lobbyHostId,
  })
}

/**
 * Gate de coordenação com estado explícito de presença.
 * Presença carregada e vazia: fallback de host via resolveTurnSkipAuthority.
 */
export function evaluateBotCoordinatorGate({
  presenceLoadState = PRESENCE_LOAD_STATE.LOADING,
  rosterPlayers = [],
  presenceList = [],
  myUid = null,
  lobbyHostId = null,
  gameOver = false,
  isBotTurn = false,
  now = Date.now(),
} = {}) {
  if (gameOver || !isBotTurn) {
    return { ok: false, reason: 'inactive', waiting: false, terminal: true }
  }
  if (presenceLoadState === PRESENCE_LOAD_STATE.LOADING) {
    return { ok: false, reason: 'presence-loading', waiting: true, terminal: false }
  }
  if (presenceLoadState === PRESENCE_LOAD_STATE.ERROR) {
    return { ok: false, reason: 'presence-error', waiting: true, terminal: false }
  }

  const auth = resolveBotCoordinator({
    rosterPlayers,
    presenceList: Array.isArray(presenceList) ? presenceList : [],
    now,
    myUid,
    lobbyHostId,
  })

  if (!auth.authorized) {
    return {
      ok: false,
      reason: auth.reason,
      waiting: false,
      terminal: true,
      authorityId: auth.authorityId ?? null,
    }
  }

  const me = myUid != null ? String(myUid) : ''
  if (!me || String(auth.authorityId) !== me) {
    return {
      ok: false,
      reason: 'not-coordinator',
      waiting: false,
      terminal: true,
      authorityId: auth.authorityId ?? null,
    }
  }

  return {
    ok: true,
    reason: auth.reason,
    waiting: false,
    terminal: false,
    authorityId: String(auth.authorityId),
    usedHostFallback: auth.reason === 'lobby-host-fallback',
    presenceEmpty: !Array.isArray(presenceList) || presenceList.length === 0,
  }
}

export function pickHumanPresenceCoordinator(rosterPlayers, presenceList, now) {
  return pickPresenceCoordinator(humanRosterPlayers(rosterPlayers), presenceList, now)
}

/** Presença ausente de máquina não conta como offline. */
export function isTurnPlayerEffectivelyPresent({ currentPlayer, turnPresent }) {
  if (isBotPlayer(currentPlayer)) return true
  return !!turnPresent
}
