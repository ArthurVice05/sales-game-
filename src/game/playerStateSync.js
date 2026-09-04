/**
 * Sync seguro de players/cash/identidade (multiplayer).
 * - NÃO usa Math.max/min em cash (valores menores são legítimos).
 * - cash undefined/null no delta = não alterar.
 * - roster parcial não apaga jogadores ausentes.
 */

import { normalizePlayerAliases } from './playerShape.js'
import { validateTurnCommit, stripCommitMeta } from './turnCommitValidation.js'

/** Cash válido para aplicar em patch: número finito (inclui 0). */
export function isValidCashPatchValue(value) {
  return typeof value === 'number' && Number.isFinite(value)
}

/**
 * Merge parcial de um jogador.
 * Campos ausentes/undefined no delta não alteram o existente.
 * cash null/undefined/NaN preserva o cash atual.
 */
export function mergePlayerPartial(existing, delta = {}) {
  const base =
    existing && typeof existing === 'object'
      ? { ...existing }
      : {}

  if (!delta || typeof delta !== 'object') {
    return normalizePlayerAliases(base)
  }

  for (const [key, value] of Object.entries(delta)) {
    if (key === '_actionId') continue

    if (key === 'cash') {
      if (!isValidCashPatchValue(value)) continue
      base.cash = value
      continue
    }

    if (key === 'bankrupt') {
      // Falência é sticky: um delta false não ressuscita quem já saiu/faliu.
      base.bankrupt = !!(base.bankrupt || value)
      continue
    }

    if (value === undefined) continue
    base[key] = value
  }

  if (base.isBot === true || base.controller === 'BOT' || existing?.isBot === true) {
    base.isBot = true
    base.controller = 'BOT'
    if (existing?.botDifficulty != null && base.botDifficulty == null) {
      base.botDifficulty = existing.botDifficulty
    }
    if (existing?.botPolicyVersion != null && base.botPolicyVersion == null) {
      base.botPolicyVersion = existing.botPolicyVersion
    }
    if (Number.isInteger(existing?.seat) && !Number.isInteger(base.seat)) {
      base.seat = existing.seat
    }
    if (Number.isInteger(existing?.joinOrder) && !Number.isInteger(base.joinOrder)) {
      base.joinOrder = existing.joinOrder
    }
  }

  return normalizePlayerAliases(base)
}

/**
 * Aplica deltas por id sobre um roster.
 * Não remove jogadores que não aparecem no delta.
 * Não cria jogador novo a partir de identidade inválida (só se createMissing=true).
 */
export function mergePlayersById(prevPlayers = [], deltaById = {}, { createMissing = false } = {}) {
  const list = Array.isArray(prevPlayers) ? prevPlayers : []
  const byId = new Map(list.map((p) => [String(p?.id), { ...p }]))
  const order = list.map((p) => String(p?.id))

  for (const [rawId, delta] of Object.entries(deltaById || {})) {
    const id = String(rawId)
    const existing = byId.get(id)
    if (existing) {
      byId.set(id, mergePlayerPartial(existing, delta))
    } else if (createMissing) {
      const created = mergePlayerPartial({ id }, delta)
      byId.set(id, created)
      order.push(id)
    }
  }

  return order.map((id) => byId.get(id)).filter(Boolean)
}

/**
 * Delta só com campos que mudaram (parcial).
 * cash só entra se o valor novo for um número finito diferente do anterior.
 */
export function buildPartialPlayerDelta(before = {}, after = {}, extras = {}) {
  const delta = { ...extras }
  const prev = before && typeof before === 'object' ? before : {}
  const next = after && typeof after === 'object' ? after : {}

  const keys = new Set([...Object.keys(prev), ...Object.keys(next)])
  for (const key of keys) {
    if (key === '_actionId' || key === 'lastActions') continue
    if (!Object.prototype.hasOwnProperty.call(next, key)) continue

    const nextVal = next[key]
    const prevVal = prev[key]

    if (key === 'cash') {
      if (!isValidCashPatchValue(nextVal)) continue
      if (isValidCashPatchValue(prevVal) && prevVal === nextVal) continue
      delta.cash = nextVal
      continue
    }

    if (nextVal === undefined) continue
    if (Object.is(prevVal, nextVal)) continue
    // shallow: objetos/arrays só se referência mudou (igual ao hot-path atual)
    if (
      prevVal &&
      nextVal &&
      typeof prevVal === 'object' &&
      typeof nextVal === 'object' &&
      JSON.stringify(prevVal) === JSON.stringify(nextVal)
    ) {
      continue
    }
    delta[key] = nextVal
  }

  return delta
}

/**
 * Monta playersDeltaById a partir do baseline vs next roster.
 * Só inclui jogadores que mudaram; cada delta é parcial.
 */
export function buildPlayersDeltaById(baselinePlayers, nextPlayers, actionId) {
  const baseList = Array.isArray(baselinePlayers) ? baselinePlayers : []
  const nextList = Array.isArray(nextPlayers) ? nextPlayers : []
  const baseById = new Map(baseList.map((p) => [String(p?.id), p]))
  const out = {}

  for (const p of nextList) {
    const id = String(p?.id ?? '')
    if (!id) continue
    const base = baseById.get(id)
    if (!base) {
      // jogador novo no roster local: envia campos definidos (sem cash inválido)
      const created = mergePlayerPartial({ id }, p)
      out[id] = actionId != null ? { ...created, _actionId: actionId } : created
      continue
    }
    const partial = buildPartialPlayerDelta(base, p, actionId != null ? { _actionId: actionId } : {})
    const keys = Object.keys(partial).filter((k) => k !== '_actionId')
    if (keys.length > 0) out[id] = partial
  }

  return out
}

/**
 * Rebind de assento a partir de matchIdentity.
 * Nunca inventa player; se id não está no roster → identity-mismatch.
 */
export function resolveSeatIdentity({
  identityPlayerId,
  roster = [],
  currentMyUid = null,
} = {}) {
  const list = Array.isArray(roster) ? roster : []
  const wantRaw =
    identityPlayerId != null && String(identityPlayerId).trim() !== ''
      ? String(identityPlayerId)
      : null

  if (wantRaw) {
    const found = list.find((p) => String(p?.id) === wantRaw)
    if (found) {
      return {
        ok: true,
        myUid: wantRaw,
        player: found,
        reason: 'identity-matched',
      }
    }
    return {
      ok: false,
      myUid: currentMyUid != null ? String(currentMyUid) : null,
      wantId: wantRaw,
      player: null,
      reason: 'identity-not-in-roster',
    }
  }

  // Sem identity canônica: tenta currentMyUid se existir no roster
  if (currentMyUid != null && String(currentMyUid) !== '') {
    const cur = String(currentMyUid)
    const found = list.find((p) => String(p?.id) === cur)
    if (found) {
      return {
        ok: true,
        myUid: cur,
        player: found,
        reason: 'current-uid-matched',
      }
    }
  }

  return {
    ok: false,
    myUid: currentMyUid != null ? String(currentMyUid) : null,
    wantId: null,
    player: null,
    reason: 'no-identity',
  }
}

/**
 * myCash seguro: se o player da identidade existe, usa o cash dele.
 * Se identidade aponta para id no roster mas find falhou — não deve acontecer.
 * Se identidade válida não está no roster: found=false (UI não deve fingir 0).
 */
export function resolveMyCash({ myUid, players = [] } = {}) {
  if (myUid == null || String(myUid) === '') {
    return { found: false, cash: null, reason: 'no-uid' }
  }
  const mine = (Array.isArray(players) ? players : []).find(
    (p) => String(p?.id) === String(myUid)
  )
  if (!mine) {
    return { found: false, cash: null, reason: 'player-not-in-roster' }
  }
  const raw = mine.cash
  if (!isValidCashPatchValue(raw)) {
    // cash ausente no objeto: trata como 0 apenas se o jogador existe (campo faltando)
    // Preferência: null para UI distinguir? Testes pedem 12000 quando presente.
    return { found: true, cash: 0, reason: 'cash-missing-default-0', player: mine }
  }
  return { found: true, cash: raw, reason: 'ok', player: mine }
}

/**
 * Decide se o snapshot de players pode substituir o roster local.
 * - [] não apaga roster hidratado
 * - parcial (menor) não substitui completo → merge por id
 * - START sempre substitui
 */
export function planRosterApply({
  incomingPlayers,
  currentPlayers,
  hydrated = false,
  isStart = false,
} = {}) {
  const incoming = Array.isArray(incomingPlayers) ? incomingPlayers : null
  const current = Array.isArray(currentPlayers) ? currentPlayers : []

  if (!incoming) {
    return { action: 'skip', reason: 'no-incoming' }
  }

  if (incoming.length === 0) {
    if (hydrated || current.length > 0) {
      return { action: 'skip', reason: 'empty-wipe-blocked' }
    }
    return { action: 'replace', reason: 'empty-initial', players: incoming }
  }

  if (isStart) {
    return { action: 'replace', reason: 'start', players: incoming }
  }

  if (hydrated && current.length > 0 && incoming.length < current.length) {
    const merged = mergeRosterPreserveMissing(current, incoming)
    return { action: 'merge', reason: 'partial-roster', players: merged }
  }

  // Mesmo tamanho ou maior: replace (autoritativo), mas merge campo a campo
  // para não apagar cash com undefined no snapshot
  if (current.length > 0) {
    const merged = mergeRosterPreserveMissing(current, incoming)
    return { action: 'merge', reason: 'field-safe-merge', players: merged }
  }

  return { action: 'replace', reason: 'initial-hydrate', players: incoming }
}

/** Mantém jogadores locais ausentes no incoming; merge parcial por id. */
export function mergeRosterPreserveMissing(currentPlayers = [], incomingPlayers = []) {
  const current = Array.isArray(currentPlayers) ? currentPlayers : []
  const incoming = Array.isArray(incomingPlayers) ? incomingPlayers : []
  const byId = new Map(current.map((p) => [String(p?.id), { ...p }]))
  const order = current.map((p) => String(p?.id))

  for (const inc of incoming) {
    const id = String(inc?.id ?? '')
    if (!id) continue
    const existing = byId.get(id)
    if (existing) {
      byId.set(id, mergePlayerPartial(existing, inc))
    } else {
      byId.set(id, mergePlayerPartial({ id }, inc))
      order.push(id)
    }
  }

  return order.map((id) => byId.get(id)).filter(Boolean)
}

/**
 * START de verdade. LOCK/TURN/PLAYER_DELTA com todos em pos 0 (início da
 * partida) NÃO é reset — isso zerava lock/turnSeq no meio do dado.
 */
export function isAuthoritativeStartState(incoming = {}) {
  if (!incoming || typeof incoming !== 'object') return false
  if (incoming.kind === 'START' || incoming.isStartGame === true) return true

  const kind = incoming.kind
  if (
    kind === 'LOCK' ||
    kind === 'TURN' ||
    kind === 'PLAYER_DELTA' ||
    kind === 'ENDGAME'
  ) {
    return false
  }

  const np = Array.isArray(incoming.players) ? incoming.players : null
  const nr = Number.isInteger(incoming.round) ? incoming.round : null
  if (nr !== 1 || !np || np.length === 0) return false
  if (!np.every((p) => Number(p?.pos ?? 0) === 0)) return false
  if (incoming.gameOver === true || incoming.winner) return false
  return true
}

/**
 * Gate de versão: snapshot stale (version menor) não aplica.
 * stateId novo com version mais antiga também não.
 */
export function shouldApplyIncomingState({
  isStart = false,
  incomingVersion,
  lastAppliedVersion = 0,
  incomingStateId = null,
  lastAppliedStateId = null,
} = {}) {
  if (isStart) return { apply: true, reason: 'start' }

  const versionIsNumber = typeof incomingVersion === 'number'
  const last = Number(lastAppliedVersion) || 0
  const isNumericallyOlder = versionIsNumber && incomingVersion < last
  const sameStateId =
    !!incomingStateId && lastAppliedStateId != null && String(incomingStateId) === String(lastAppliedStateId)

  if (versionIsNumber && incomingVersion > last) {
    return { apply: true, reason: 'version-newer' }
  }

  if (incomingStateId && !sameStateId && !isNumericallyOlder) {
    return { apply: true, reason: 'stateId-new' }
  }

  return { apply: false, reason: isNumericallyOlder ? 'stale-version' : 'duplicate-or-older' }
}

/**
 * Simula commit patch sobre rooms.state (para testes / CAS retry mental model).
 * Reaplica updater semantics: merge deltas no prev remoto.
 */
/**
 * Simula commit patch sobre rooms.state (para testes / CAS retry mental model).
 * Reaplica updater semantics: merge deltas no prev remoto.
 */
export function applyGamePatchToState(prevState = {}, { playersDeltaById = {}, statePatch = {} } = {}, opts = {}) {
  const prev = prevState && typeof prevState === 'object' ? prevState : {}

  const validation = validateTurnCommit(prev, statePatch, { now: opts.now ?? Date.now() })
  if (!validation.ok) {
    return { ok: false, state: prev, reason: validation.reason }
  }

  const prevPlayers = Array.isArray(prev.players) ? prev.players : []
  const mergedPlayers = mergePlayersById(prevPlayers, playersDeltaById, {
    createMissing: false,
  })

  const publicPatch = stripCommitMeta(statePatch)

  const next = {
    ...prev,
    ...publicPatch,
    ...(Object.keys(playersDeltaById || {}).length > 0
      ? { players: mergedPlayers }
      : {}),
  }

  return { ok: true, state: next, reason: 'applied' }
}
