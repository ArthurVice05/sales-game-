/**
 * Presença canônica na partida: rooms.state.players[].id === myUid === lobby_players.player_id.
 * Tab-id (sg_tab_player_id) NÃO substitui o assento em game.
 *
 * Funções puras (sem Supabase) — espelham o threshold/coordinator de lobbies.js.
 */

import { isBotPlayer } from './bots/botTypes.js'

/** Mesmo valor de src/lib/lobbies.js — NÃO afrouxar. */
export const GAME_OFFLINE_THRESHOLD_MS = 35_000

export function isPresenceFresh(
  lastSeenMs,
  now = Date.now(),
  thresholdMs = GAME_OFFLINE_THRESHOLD_MS
) {
  if (lastSeenMs == null || !Number.isFinite(lastSeenMs)) return false
  return (now - lastSeenMs) <= thresholdMs
}

/**
 * Coordinator determinístico: primeiro jogador vivo (ordem do roster)
 * cujo last_seen ainda está fresco. Não usa host.
 * (Mesma regra de lobbies.pickSkipCoordinator.)
 */
export function pickPresenceCoordinator(rosterPlayers, presenceList, now = Date.now()) {
  const byId = new Map(
    (presenceList || []).map((p) => [String(p.playerId), p.lastSeen])
  )
  for (const p of rosterPlayers || []) {
    if (!p || p.bankrupt) continue
    if (isBotPlayer(p)) continue
    const id = String(p.id ?? '')
    if (!id) continue
    if (isPresenceFresh(byId.get(id), now)) return id
  }
  return null
}

function rosterHasAlive(roster, playerId) {
  const id = playerId != null ? String(playerId) : ''
  if (!id) return false
  return (roster || []).some(
    (p) => p && String(p.id) === id && p.bankrupt !== true
  )
}

function rosterHas(roster, playerId) {
  const id = playerId != null ? String(playerId) : ''
  if (!id) return false
  return (roster || []).some((p) => p && String(p.id) === id)
}

/** Jogador do turno já falido (saída/falência) — não tratar como desconexão. */
export function isRosterPlayerBankrupt(roster = [], playerId) {
  const id = playerId != null ? String(playerId) : ''
  if (!id) return false
  return (roster || []).some(
    (p) => p && String(p.id) === id && p.bankrupt === true
  )
}

/**
 * PlayerId usado para heartbeat/presença durante o GAME.
 * Só retorna o assento canônico se estiver no roster.
 * Nunca faz fallback para tabPlayerId.
 */
export function resolveGamePresencePlayerId({
  seatPlayerId = null,
  tabPlayerId = null,
  roster = [],
} = {}) {
  const seat = seatPlayerId != null && String(seatPlayerId).trim() !== ''
    ? String(seatPlayerId)
    : ''
  if (seat && rosterHas(roster, seat)) return seat

  // tab-id existe só para identidade de aba — não publica presença de assento
  void tabPlayerId
  return null
}

/** turnPlayerId online? Lookup estrito por ID canônico (ignora rows de tab-id). */
export function isTurnPlayerPresent({
  turnPlayerId,
  presenceList = [],
  now = Date.now(),
  thresholdMs = GAME_OFFLINE_THRESHOLD_MS,
} = {}) {
  const id = turnPlayerId != null ? String(turnPlayerId) : ''
  if (!id) return false
  const row = (presenceList || []).find((p) => String(p?.playerId) === id)
  return isPresenceFresh(row?.lastSeen, now, thresholdMs)
}

/**
 * Detecta desalinhamento: assento X sem presença fresca, enquanto tab Y (≠ X) está fresco.
 */
export function detectSeatPresenceMismatch({
  seatPlayerId,
  tabPlayerId,
  presenceList = [],
  now = Date.now(),
  thresholdMs = GAME_OFFLINE_THRESHOLD_MS,
} = {}) {
  const seat = seatPlayerId != null ? String(seatPlayerId) : ''
  const tab = tabPlayerId != null ? String(tabPlayerId) : ''
  if (!seat) return { mismatch: false, reason: 'no-seat' }
  if (!tab || tab === seat) return { mismatch: false, reason: 'same-or-no-tab' }

  const byId = new Map(
    (presenceList || []).map((p) => [String(p.playerId), p.lastSeen])
  )
  const seatFresh = isPresenceFresh(byId.get(seat), now, thresholdMs)
  const tabFresh = isPresenceFresh(byId.get(tab), now, thresholdMs)

  if (!seatFresh && tabFresh) {
    return {
      mismatch: true,
      reason: 'tab-presence-not-seat',
      seatPlayerId: seat,
      tabPlayerId: tab,
    }
  }
  return { mismatch: false, reason: seatFresh ? 'seat-ok' : 'seat-offline' }
}

/**
 * Autoridade para auto-skip / timer auto-pass.
 *
 * 1) pickPresenceCoordinator por presença (fluxo normal = lobbies.pickSkipCoordinator).
 * 2) Fail-safe determinístico: se NÃO há coordinator de presença,
 *    o host atual da sala (lobbies.host_id) pode avançar — somente se
 *    este cliente É o host e o host pertence ao roster (vivo).
 *
 * Guest comum nunca ganha autoridade arbitrária.
 */
export function resolveTurnSkipAuthority({
  rosterPlayers = [],
  presenceList = [],
  now = Date.now(),
  myUid = null,
  lobbyHostId = null,
} = {}) {
  const me = myUid != null ? String(myUid) : ''
  const coordinatorId = pickPresenceCoordinator(rosterPlayers, presenceList, now)

  if (coordinatorId != null && me && String(coordinatorId) === me) {
    return {
      authorized: true,
      reason: 'presence-coordinator',
      authorityId: String(coordinatorId),
    }
  }

  // Fallback só quando a presença não elege ninguém (deadlock 0:00).
  if (coordinatorId == null) {
    const hostId = lobbyHostId != null ? String(lobbyHostId) : ''
    const hasAlive = (rosterPlayers || []).some(
      (p) => p && p.bankrupt !== true
    )
    if (
      hasAlive &&
      hostId &&
      me &&
      hostId === me &&
      rosterHasAlive(rosterPlayers, hostId)
    ) {
      return {
        authorized: true,
        reason: 'lobby-host-fallback',
        authorityId: hostId,
      }
    }
  }

  return {
    authorized: false,
    reason: coordinatorId != null ? 'not-authority' : 'no-authority',
    authorityId: coordinatorId != null ? String(coordinatorId) : null,
  }
}
