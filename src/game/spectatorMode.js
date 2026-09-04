import {
  GAME_MODE,
  PLAYER_SESSION_ROLE,
  SPECTATOR_SESSION_ROLE,
} from './localHotseat.js'

/**
 * Papel da sessão — conceito ORTOGONAL a gameMode.
 *
 *   gameMode    → como a partida executa   (online | local)
 *   sessionRole → o que esta sessão faz    (player | spectator)
 *
 * Combinações válidas: online+player, online+spectator, local+player.
 * O espectador é um consumidor read-only do estado autoritativo: ele observa
 * o motor, nunca participa dele (sem assento, presença, turno ou commit).
 */
export const SESSION_ROLE = Object.freeze({
  PLAYER: PLAYER_SESSION_ROLE,
  SPECTATOR: SPECTATOR_SESSION_ROLE,
})

/** Resultado neutro para chamadas de gameplay que já trabalham com objetos. */
export const SPECTATOR_READ_ONLY = Object.freeze({
  ok: false,
  skipped: true,
  reason: 'spectator-read-only',
})

const SPECTATOR_ENTRY_MESSAGES = Object.freeze({
  'invalid-room': 'Sala inválida para o modo espectador.',
  'room-not-found': 'Esta sala não está mais disponível.',
  'match-not-started': 'Partida ainda não está disponível para assistir.',
})

/** Papel desconhecido/ausente vira PLAYER — preserva todo o fluxo atual. */
export function normalizeSessionRole (sessionRole) {
  return String(sessionRole ?? '') === SESSION_ROLE.SPECTATOR
    ? SESSION_ROLE.SPECTATOR
    : SESSION_ROLE.PLAYER
}

/**
 * Fail-safe: o papel spectator basta para bloquear escrita, mesmo na
 * combinação inválida local+spectator (que a App nunca deve produzir).
 */
export function isSpectatorSession ({ sessionRole } = {}) {
  return normalizeSessionRole(sessionRole) === SESSION_ROLE.SPECTATOR
}

/** local+spectator não existe: hot-seat não tem modo espectador. */
export function isValidSessionCombination ({ gameMode, sessionRole } = {}) {
  if (!isSpectatorSession({ sessionRole })) return true
  return gameMode !== GAME_MODE.LOCAL
}

/** Autorização central de mutação — use antes de qualquer commit/broadcast. */
export function canSessionMutateGame (session = {}) {
  return !isSpectatorSession(session)
}

/**
 * Jogador observado pelo espectador — SOMENTE apresentação.
 * Nunca alimente isMine / isMyTurn / Controls / commits com este id.
 */
export function resolveSpectatorViewPlayerId ({ turnPlayerId, players } = {}) {
  const roster = Array.isArray(players) ? players.filter(Boolean) : []
  if (!roster.length) return null
  const wanted = String(turnPlayerId ?? '')
  if (wanted) {
    const found = roster.find((player) => String(player?.id ?? '') === wanted)
    if (found) return String(found.id)
  }
  const first = roster[0]
  return first?.id != null ? String(first.id) : null
}

/** Existe partida observável no snapshot autoritativo de rooms.state? */
export function hasSpectatableMatchState (state) {
  return Array.isArray(state?.players) && state.players.length > 0
}

/**
 * Valida a entrada em modo espectador a partir do snapshot autoritativo
 * (findAuthoritativeRoomMeta). NUNCA cria jogador como fallback.
 */
export function resolveSpectatorEntry ({ roomCode, meta } = {}) {
  const code = String(roomCode ?? '').trim()
  if (!code) {
    return { ok: false, reason: 'invalid-room', message: SPECTATOR_ENTRY_MESSAGES['invalid-room'] }
  }

  const state = meta?.state ?? null
  if (!state) {
    return { ok: false, reason: 'room-not-found', message: SPECTATOR_ENTRY_MESSAGES['room-not-found'], roomCode: code }
  }

  if (!hasSpectatableMatchState(state)) {
    return { ok: false, reason: 'match-not-started', message: SPECTATOR_ENTRY_MESSAGES['match-not-started'], roomCode: code }
  }

  return { ok: true, reason: null, message: '', roomCode: code }
}

function toSearchParams (search) {
  const raw = String(search ?? '')
  return new URLSearchParams(raw.startsWith('?') ? raw.slice(1) : raw)
}

/** Lê `?room=<id>&spectate=1` (ou `&role=spectator`) sem tocar em identidade. */
export function parseSpectateRequest (search) {
  const params = toSearchParams(search)
  const roomCode = String(params.get('room') ?? '').trim() || null
  const spectateFlag = String(params.get('spectate') ?? '').trim()
  const roleFlag = String(params.get('role') ?? '').trim()
  const wants =
    spectateFlag === '1' ||
    spectateFlag === 'true' ||
    roleFlag === SESSION_ROLE.SPECTATOR
  return { requested: !!roomCode && wants, roomCode }
}

export function buildSpectateSearch (search, { roomCode } = {}) {
  const params = toSearchParams(search)
  const code = String(roomCode ?? '').trim()
  if (code) {
    params.set('room', code)
    params.set('spectate', '1')
  }
  params.delete('role')
  return params.toString()
}

export function clearSpectateFromSearch (search) {
  const params = toSearchParams(search)
  params.delete('spectate')
  params.delete('role')
  params.delete('room')
  return params.toString()
}

const PLAYING_STATUSES = new Set(['playing', 'in_game'])

/**
 * Ação oferecida no card da lista de salas.
 * Prioridade absoluta: quem tem identidade naquela sala RETOMA — nunca é
 * empurrado para o modo espectador (perderia o assento).
 */
export function resolveLobbyEntryAction ({
  status,
  hasLocalMatchIdentity = false,
  canResume = false,
  isFull = false,
} = {}) {
  const raw = String(status ?? 'open')

  if (raw === 'open') {
    return isFull
      ? { action: 'none', label: 'Sala lotada', disabled: true }
      : { action: 'join', label: 'Entrar agora', disabled: false }
  }

  if (hasLocalMatchIdentity) {
    return {
      action: 'resume',
      label: canResume ? 'Retomar partida' : 'Reentrar na partida',
      disabled: false,
    }
  }

  // Sem assento nesta sala: assistir não ocupa vaga, então isFull não bloqueia.
  if (PLAYING_STATUSES.has(raw)) {
    return { action: 'spectate', label: 'Assistir partida', disabled: false }
  }

  return { action: 'none', label: 'Sala bloqueada', disabled: true }
}
