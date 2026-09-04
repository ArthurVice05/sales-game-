import { createUuidV4 } from '../lib/uuid.js'
import { MANUAL_CONSTANTS } from './manualConstants.js'

export const GAME_MODE = Object.freeze({
  ONLINE: 'online',
  LOCAL: 'local',
})

// Papéis de sessão (ortogonais a GAME_MODE). A superfície pública — SESSION_ROLE
// e os predicados de espectador — vive em ./spectatorMode.js; os literais ficam
// aqui para que este módulo não dependa daquele (evita import circular).
export const PLAYER_SESSION_ROLE = 'player'
export const SPECTATOR_SESSION_ROLE = 'spectator'

const isSpectatorRole = (sessionRole) =>
  String(sessionRole ?? '') === SPECTATOR_SESSION_ROLE

export const LOCAL_PLAYER_COLORS = Object.freeze([
  '#FFD600',
  '#2196F3',
  '#00C853',
  '#FF6D00',
])

export function applyStarterKit(obj = {}) {
  return {
    ...obj,
    mixProdutos: obj.mixProdutos ?? 'D',
    erpLevel: obj.erpLevel ?? 'D',
    clients: obj.clients ?? 1,
    vendedoresComuns: obj.vendedoresComuns ?? 1,
    loanTakenInMatch: obj.loanTakenInMatch ?? false,
    lastChargedLoanId: obj.lastChargedLoanId ?? null,
  }
}

export function validateLocalPlayerNames(values = []) {
  const names = Array.isArray(values)
    ? values.map((value) => String(value ?? '').trim())
    : []

  if (names.length < 2 || names.length > 4) {
    return { ok: false, names, error: 'Escolha entre 2 e 4 jogadores.' }
  }
  if (names.some((name) => !name)) {
    return { ok: false, names, error: 'Preencha o nome de todos os jogadores.' }
  }

  const normalized = names.map((name) => name.toLocaleLowerCase('pt-BR'))
  if (new Set(normalized).size !== normalized.length) {
    return { ok: false, names, error: 'Use nomes diferentes para cada jogador.' }
  }

  return { ok: true, names, error: '' }
}

export function createLocalPlayers(values, options = {}) {
  const validation = validateLocalPlayerNames(values)
  if (!validation.ok) throw new Error(validation.error)

  const createId = options.createId || createUuidV4
  const colors = options.colors || LOCAL_PLAYER_COLORS
  const players = validation.names.map((name, index) => applyStarterKit({
    id: String(createId()),
    name,
    seat: index,
    joinOrder: index,
    cash: MANUAL_CONSTANTS.startCash,
    bens: MANUAL_CONSTANTS.startBens,
    pos: 0,
    color: colors[index % colors.length],
  }))

  if (new Set(players.map((player) => player.id)).size !== players.length) {
    throw new Error('Não foi possível gerar IDs distintos para os jogadores locais.')
  }

  return players
}

export function resolveGameplayActorId({
  gameMode,
  sessionRole,
  localTurnReady,
  turnPlayerId,
  myUid,
} = {}) {
  // Espectador não tem assento: nenhuma autoridade de gameplay, em modo algum.
  if (isSpectatorRole(sessionRole)) return null
  if (gameMode !== GAME_MODE.LOCAL) {
    return myUid != null && String(myUid) !== '' ? String(myUid) : null
  }
  if (!localTurnReady) return null
  return turnPlayerId != null && String(turnPlayerId) !== ''
    ? String(turnPlayerId)
    : null
}

export function localTurnKey(turnPlayerId, turnSeq) {
  if (turnPlayerId == null || String(turnPlayerId) === '') return null
  const sequence = Number(turnSeq)
  return `${String(turnPlayerId)}:${Number.isFinite(sequence) ? sequence : 0}`
}

export function isLocalTurnReady({
  gameMode,
  turnPlayerId,
  turnSeq,
  acknowledgedTurnKey,
} = {}) {
  if (gameMode !== GAME_MODE.LOCAL) return true
  const turnKey = localTurnKey(turnPlayerId, turnSeq)
  return !!turnKey && turnKey === acknowledgedTurnKey
}

export function shouldOpenLocalHandoff({
  gameMode,
  gameOver,
  turnPlayerId,
  turnSeq,
  localTurnReady,
  acknowledgedTurnKey,
} = {}) {
  if (gameMode !== GAME_MODE.LOCAL || gameOver || localTurnReady) return false
  const turnKey = localTurnKey(turnPlayerId, turnSeq)
  return !!turnKey && turnKey !== acknowledgedTurnKey
}

export function shouldEnableTurnTimer({ gameMode, localTurnReady } = {}) {
  return gameMode !== GAME_MODE.LOCAL || localTurnReady === true
}

/**
 * Duração mínima da apresentação de troca de turno (hot-seat).
 *
 * É camada de APRESENTAÇÃO: o motor já commitou turnPlayerId/turnSeq: o que
 * espera é só a liberação do próximo jogador. Durante a espera o cronômetro
 * fica suspenso e gameplayActorId continua null.
 */
export const LOCAL_HANDOFF_MIN_DURATION_MS = 5000

function resolveMinDuration(minDurationMs) {
  const n = Number(minDurationMs)
  if (!Number.isFinite(n)) return LOCAL_HANDOFF_MIN_DURATION_MS
  return Math.max(0, n)
}

/** Milissegundos que ainda faltam. Sem timestamp válido → 0 (nunca prende). */
export function localHandoffRemainingMs({ startedAt, now, minDurationMs } = {}) {
  const inicio = Number(startedAt)
  const agora = Number(now)
  if (!Number.isFinite(inicio) || !Number.isFinite(agora)) return 0
  const total = resolveMinDuration(minDurationMs)
  return Math.max(0, Math.min(total, total - (agora - inicio)))
}

export function isLocalHandoffHoldSatisfied(args = {}) {
  return localHandoffRemainingMs(args) <= 0
}

/** Segundos exibidos na contagem (5, 4, 3, 2, 1, 0). */
export function localHandoffCountdownSeconds(args = {}) {
  return Math.ceil(localHandoffRemainingMs(args) / 1000)
}

export function shouldCreateGameBroadcastChannel({ gameMode, sessionRole, lobbyId } = {}) {
  // Espectador lê apenas rooms.state: nada de canal bidirecional entre abas.
  if (isSpectatorRole(sessionRole)) return false
  return gameMode === GAME_MODE.ONLINE && !!String(lobbyId || '')
}
