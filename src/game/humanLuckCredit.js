/**
 * Crédito de Sorte humana: valor congelado no payload da carta, recibo em lastActions.
 * Modal confirmado ≠ gravação confirmada. Não altera o baralho nem applySorteRevesPayloadToPlayer.
 */

import { applySorteRevesPayloadToPlayer } from './sorteRevesApply.js'
import { hasBotEffectAction } from './bots/botEconomicRuntime.js'
import { buildPartialPlayerDelta } from './playerStateSync.js'
import { stampAndTrimHumanRevenueLastActions } from './humanRevenueCredit.js'
import { stripCommitMeta, validateTurnCommit } from './turnCommitValidation.js'
import { SORTE_REVES_CARDS, resolveCardEffect } from '../modals/sorteRevesDeck.js'

export const HUMAN_LUCK_PREFIX = 'hum-luck'
export const HUMAN_LUCK_COMMIT_KIND = 'HUMAN_LUCK'

export function buildHumanLuckActionId({ matchId, playerId, turnSeq } = {}) {
  return [
    HUMAN_LUCK_PREFIX,
    String(matchId ?? ''),
    String(playerId ?? ''),
    String(Number(turnSeq) || 0),
  ].join(':')
}

export function isHumanLuckActionId(actionId) {
  return String(actionId || '').startsWith(`${HUMAN_LUCK_PREFIX}:`)
}

export function buildHumanLuckPending({
  matchId,
  playerId,
  turnSeq,
  actionId,
  payload,
  skipNegativeCash = false,
  frozenCashDelta = 0,
  paid = false,
} = {}) {
  return {
    matchId: String(matchId ?? ''),
    turnPlayerId: String(playerId ?? ''),
    turnSeq: Number(turnSeq) || 0,
    actionId: String(actionId || ''),
    payload: payload && typeof payload === 'object' ? { ...payload } : null,
    skipNegativeCash: skipNegativeCash === true,
    frozenCashDelta: Number.isFinite(Number(frozenCashDelta)) ? Number(frozenCashDelta) : 0,
    paid: paid === true,
  }
}

export function isSameHumanLuckScope(pending, { matchId, playerId, turnSeq } = {}) {
  if (!pending || typeof pending !== 'object') return false
  if (String(pending.turnPlayerId ?? '') !== String(playerId ?? '')) return false
  if (Number(pending.turnSeq) !== (Number(turnSeq) || 0)) return false
  if (matchId && pending.matchId && String(pending.matchId) !== String(matchId)) return false
  return true
}

export function isHumanLuckPaid({ player, actionId, pending } = {}) {
  const src = pending || player?.humanLuckPending || null
  if (src && src.paid === true) {
    if (actionId && String(src.actionId) === String(actionId)) return true
    if (!actionId) return true
  }
  return hasBotEffectAction(player?.lastActions, actionId)
}

function luckEffectsForScope(player, { matchId, playerId, turnSeq } = {}) {
  const effects = player?.humanTurnEffects
  if (!effects || typeof effects !== 'object') return null
  if (String(effects.turnPlayerId ?? '') !== String(playerId ?? player?.id ?? '')) return null
  if (Number(effects.turnSeq) !== (Number(turnSeq) || 0)) return null
  if (matchId && effects.matchId && String(effects.matchId) !== String(matchId)) return null
  if (String(effects.landTile || '').toUpperCase() !== 'LUCK') return null
  if (effects.processLandTile === false) return null
  if (!effects.luckCardId) return null
  return effects
}

export function resolveHumanLuckPayloadForScope({ player, matchId, playerId, turnSeq } = {}) {
  const pending = player?.humanLuckPending
  if (
    isSameHumanLuckScope(pending, { matchId, playerId: playerId ?? player?.id, turnSeq })
    && pending?.payload?.action === 'APPLY_CARD'
  ) {
    return pending.payload
  }
  const effects = luckEffectsForScope(player, {
    matchId,
    playerId: playerId ?? player?.id,
    turnSeq,
  })
  const card = effects
    ? SORTE_REVES_CARDS.find((item) => String(item.id) === String(effects.luckCardId))
    : null
  return card ? resolveCardEffect(card, player).payload : null
}

export function isHumanLuckDue({ player, matchId, playerId, turnSeq } = {}) {
  const actorId = playerId ?? player?.id
  const actionId = buildHumanLuckActionId({ matchId, playerId: actorId, turnSeq })
  const pending = player?.humanLuckPending
  if (isHumanLuckPaid({ player, actionId, pending })) return false
  if (isSameHumanLuckScope(pending, {
    matchId,
    playerId: actorId,
    turnSeq,
  })) {
    return pending.paid !== true && pending.payload?.action === 'APPLY_CARD'
  }
  const receiptPayload = resolveHumanLuckPayloadForScope({
    player,
    matchId,
    playerId: actorId,
    turnSeq,
  })
  return receiptPayload?.kind === 'SORTE'
}

export function shouldBlockHumanHandoffForLuck({
  isHumanTurn,
  player = null,
  matchId,
  turnPlayerId,
  turnSeq,
} = {}) {
  if (!isHumanTurn) return { block: false, reason: 'not-human' }
  if (isHumanLuckDue({
    player,
    matchId,
    playerId: turnPlayerId ?? player?.id,
    turnSeq,
  })) {
    return { block: true, reason: 'luck-pending' }
  }
  return { block: false, reason: 'luck-settled' }
}

export function classifyHumanLuckLifecycle({
  player,
  actionId,
  matchId,
  playerId,
  turnSeq,
} = {}) {
  const pending = player?.humanLuckPending
  if (
    pending &&
    matchId &&
    pending.matchId &&
    String(pending.matchId) !== String(matchId)
  ) {
    return 'CANCELLED_MATCH'
  }
  const actorId = String(playerId ?? player?.id ?? '')
  const seq = Number(turnSeq) || 0
  const id = actionId || buildHumanLuckActionId({ matchId, playerId: actorId, turnSeq: seq })
  if (isHumanLuckPaid({ player, actionId: id, pending })) return 'PAID'
  if (isHumanLuckDue({ player, matchId, playerId: actorId, turnSeq: seq })) return 'PAYMENT_PENDING'
  return 'NONE'
}

function freezeLuckApply(player, payload, skipNegativeCash) {
  const cashBefore = Number(player?.cash) || 0
  const applied = applySorteRevesPayloadToPlayer(player, payload, { skipNegativeCash })
  const next = applied.applied ? applied.player : player
  return {
    applied: applied.applied === true,
    playerAfter: next,
    cashBefore,
    cashAfter: Number(next?.cash) || 0,
    frozenCashDelta: (Number(next?.cash) || 0) - cashBefore,
  }
}

export function planHumanLuckPersist({
  matchId,
  playerId,
  turnSeq,
  playerBefore,
  payload,
  skipNegativeCash = false,
  roster = null,
} = {}) {
  const pid = String(playerId ?? playerBefore?.id ?? '')
  const actionId = buildHumanLuckActionId({ matchId, playerId: pid, turnSeq })
  const frozenPayload = payload && typeof payload === 'object' ? { ...payload } : null
  const paid =
    isHumanLuckPaid({ player: playerBefore, actionId }) ||
    (Array.isArray(roster) && roster.some((p) => isHumanLuckPaid({ player: p, actionId })))

  if (!frozenPayload || frozenPayload.action !== 'APPLY_CARD') {
    return {
      skip: true,
      reason: 'no-payload',
      actionId,
      playerId: pid,
      payload: frozenPayload,
      skipNegativeCash: skipNegativeCash === true,
      frozenCashDelta: 0,
      cashBefore: Number(playerBefore?.cash) || 0,
      cashAfter: Number(playerBefore?.cash) || 0,
      playerAfter: playerBefore,
      playersDeltaById: null,
      commitKind: HUMAN_LUCK_COMMIT_KIND,
    }
  }

  if (paid) {
    return {
      skip: true,
      reason: 'already-paid',
      actionId,
      playerId: pid,
      payload: frozenPayload,
      skipNegativeCash: skipNegativeCash === true,
      frozenCashDelta: 0,
      cashBefore: Number(playerBefore?.cash) || 0,
      cashAfter: Number(playerBefore?.cash) || 0,
      playerAfter: playerBefore,
      playersDeltaById: null,
      commitKind: HUMAN_LUCK_COMMIT_KIND,
    }
  }

  const frozen = freezeLuckApply(playerBefore, frozenPayload, skipNegativeCash === true)
  const pending = buildHumanLuckPending({
    matchId,
    playerId: pid,
    turnSeq,
    actionId,
    payload: frozenPayload,
    skipNegativeCash,
    frozenCashDelta: frozen.frozenCashDelta,
    paid: true,
  })
  const playerAfter = {
    ...frozen.playerAfter,
    humanLuckPending: pending,
  }
  const delta = buildPartialPlayerDelta(playerBefore, playerAfter, { _actionId: actionId })

  return {
    skip: false,
    reason: 'apply',
    actionId,
    playerId: pid,
    payload: frozenPayload,
    skipNegativeCash: skipNegativeCash === true,
    pendingOnly: false,
    frozenCashDelta: frozen.frozenCashDelta,
    cashBefore: frozen.cashBefore,
    cashAfter: frozen.cashAfter,
    playerAfter,
    humanLuckPending: pending,
    playersDeltaById: { [pid]: delta },
    commitKind: HUMAN_LUCK_COMMIT_KIND,
  }
}

export function planHumanLuckPendingOnly({
  matchId,
  playerId,
  turnSeq,
  playerBefore,
  payload,
  skipNegativeCash = false,
  frozenCashDelta,
} = {}) {
  const pid = String(playerId ?? playerBefore?.id ?? '')
  const actionId = buildHumanLuckActionId({ matchId, playerId: pid, turnSeq })
  const frozenPayload = payload && typeof payload === 'object' ? { ...payload } : null
  const livePending = playerBefore?.humanLuckPending
  if (isHumanLuckPaid({ player: playerBefore, actionId })) {
    return {
      skip: true,
      reason: 'already-paid',
      actionId,
      playerId: pid,
      pendingOnly: true,
      payload: frozenPayload,
      frozenCashDelta: Number(livePending?.frozenCashDelta) || 0,
      cashBefore: Number(playerBefore?.cash) || 0,
      cashAfter: Number(playerBefore?.cash) || 0,
      playerAfter: playerBefore,
      playersDeltaById: null,
      commitKind: HUMAN_LUCK_COMMIT_KIND,
    }
  }
  if (isHumanLuckDue({ player: playerBefore, matchId, playerId: pid, turnSeq })) {
    return {
      skip: true,
      reason: 'already-pending',
      actionId,
      playerId: pid,
      pendingOnly: true,
      payload: livePending?.payload || frozenPayload,
      frozenCashDelta: Number(livePending?.frozenCashDelta) || 0,
      cashBefore: Number(playerBefore?.cash) || 0,
      cashAfter: Number(playerBefore?.cash) || 0,
      playerAfter: playerBefore,
      humanLuckPending: livePending,
      playersDeltaById: null,
      commitKind: HUMAN_LUCK_COMMIT_KIND,
    }
  }
  const frozen = frozenPayload
    ? freezeLuckApply(playerBefore, frozenPayload, skipNegativeCash === true)
    : { frozenCashDelta: 0 }
  const pending = buildHumanLuckPending({
    matchId,
    playerId: pid,
    turnSeq,
    actionId,
    payload: frozenPayload,
    skipNegativeCash,
    frozenCashDelta: Number.isFinite(Number(frozenCashDelta))
      ? Number(frozenCashDelta)
      : frozen.frozenCashDelta,
    paid: false,
  })
  const playerAfter = {
    ...(playerBefore || {}),
    humanLuckPending: pending,
  }
  const delta = buildPartialPlayerDelta(playerBefore, playerAfter, { _actionId: actionId })
  return {
    skip: false,
    reason: 'park-pending',
    actionId,
    playerId: pid,
    payload: frozenPayload,
    skipNegativeCash: skipNegativeCash === true,
    pendingOnly: true,
    frozenCashDelta: pending.frozenCashDelta,
    cashBefore: Number(playerBefore?.cash) || 0,
    cashAfter: Number(playerBefore?.cash) || 0,
    playerAfter,
    humanLuckPending: pending,
    playersDeltaById: { [pid]: delta },
    commitKind: HUMAN_LUCK_COMMIT_KIND,
  }
}

export function planCoordinatorLuckLiquidation({
  matchId,
  turnPlayerId,
  turnSeq,
  players,
  playerBefore,
} = {}) {
  const roster = Array.isArray(players) ? players : []
  const actorId = String(turnPlayerId ?? playerBefore?.id ?? '')
  const before = playerBefore || roster.find((p) => String(p?.id) === actorId) || null
  const pending = before?.humanLuckPending
  const scopeMatchId = pending?.matchId ?? matchId
  const scopeTurnSeq = pending?.turnSeq ?? turnSeq
  if (!before || !isHumanLuckDue({
    player: before,
    matchId: scopeMatchId,
    playerId: actorId,
    turnSeq: scopeTurnSeq,
  })) {
    return {
      skip: true,
      reason: 'no-pending-luck',
      actionId: buildHumanLuckActionId({ matchId, playerId: actorId, turnSeq }),
      playerId: actorId,
      pendingOnly: false,
      playersDeltaById: null,
      commitKind: HUMAN_LUCK_COMMIT_KIND,
    }
  }
  const payload = resolveHumanLuckPayloadForScope({
    player: before,
    matchId: scopeMatchId,
    playerId: actorId,
    turnSeq: scopeTurnSeq,
  })
  if (!payload) {
    return {
      skip: true,
      reason: 'luck-payload-missing',
      actionId: buildHumanLuckActionId({ matchId: scopeMatchId, playerId: actorId, turnSeq: scopeTurnSeq }),
      playerId: actorId,
      pendingOnly: false,
      playersDeltaById: null,
      commitKind: HUMAN_LUCK_COMMIT_KIND,
    }
  }
  return planHumanLuckPersist({
    matchId: scopeMatchId,
    playerId: actorId,
    turnSeq: scopeTurnSeq,
    playerBefore: before,
    payload,
    skipNegativeCash: pending?.skipNegativeCash === true,
    roster,
  })
}

export function applyDueHumanLuckToRoster(prevState = {}, { now = Date.now() } = {}) {
  const players = Array.isArray(prevState.players) ? prevState.players : []
  let roster = players.map((p) => ({ ...p }))
  const applied = []
  for (const player of roster) {
    const effects = player?.humanTurnEffects
    const pending = player?.humanLuckPending
    const scopeMatchId = pending?.matchId ?? effects?.matchId ?? prevState.matchId
    const scopePlayerId = pending?.turnPlayerId ?? effects?.turnPlayerId ?? player.id
    const scopeTurnSeq = pending?.turnSeq ?? effects?.turnSeq
    if (!player || !isHumanLuckDue({
      player,
      matchId: scopeMatchId,
      playerId: scopePlayerId,
      turnSeq: scopeTurnSeq,
    })) continue
    const plan = planCoordinatorLuckLiquidation({
      matchId: scopeMatchId,
      turnPlayerId: scopePlayerId,
      turnSeq: scopeTurnSeq,
      players: roster,
      playerBefore: player,
    })
    if (plan.skip || !plan.playerAfter) continue
    roster = roster.map((p) =>
      String(p?.id) === String(player.id)
        ? stampAndTrimHumanRevenueLastActions(plan.playerAfter, plan.actionId, now)
        : p,
    )
    applied.push(plan)
  }
  return { players: roster, applied, skipped: applied.length === 0 }
}

export function reconcileHumanLuckAfterCommit({ actionId, authoritativePlayer } = {}) {
  if (!authoritativePlayer) {
    return { applied: false, reason: 'no-authoritative-player' }
  }
  if (isHumanLuckPaid({ player: authoritativePlayer, actionId })) {
    return {
      applied: true,
      reason: authoritativePlayer?.humanLuckPending?.paid === true ? 'pending-paid' : 'lastActions',
      cash: Number(authoritativePlayer.cash) || 0,
    }
  }
  const remoteCash = Number(authoritativePlayer.cash)
  return {
    applied: false,
    reason: 'unconfirmed',
    cash: Number.isFinite(remoteCash) ? remoteCash : null,
  }
}

/**
 * CAS: reaplica o payload congelado no jogador vigente e soma o caixa congelado.
 * Ignora cash absoluto do delta (snapshot stale). Recibo na mesma atualização.
 */
export function applyHumanLuckCreditToCurrent(existing, { payload, skipNegativeCash, frozenCashDelta } = {}) {
  if (!existing) return existing
  const applied = applySorteRevesPayloadToPlayer(existing, payload, {
    skipNegativeCash: skipNegativeCash === true,
  })
  const next = applied.applied ? applied.player : { ...existing }
  const delta = Number.isFinite(Number(frozenCashDelta))
    ? Number(frozenCashDelta)
    : (Number(next.cash) || 0) - (Number(existing.cash) || 0)
  return {
    ...next,
    cash: Math.max(0, (Number(existing.cash) || 0) + delta),
  }
}

export function applyHumanLuckCasToState(
  prevState = {},
  { playersDeltaById = {}, statePatch = {} } = {},
  opts = {},
) {
  const prev = prevState && typeof prevState === 'object' ? prevState : {}
  const now = opts.now ?? Date.now()
  const validation = validateTurnCommit(prev, statePatch, { now })
  if (!validation.ok) {
    return { ok: false, state: prev, reason: validation.reason, casLost: true }
  }

  const actorId = String(statePatch._expectTurnPlayerId ?? '')
  const incomingDelta = (playersDeltaById && actorId && playersDeltaById[actorId]) || {}
  const actionId = incomingDelta._actionId || statePatch.actionId || null
  const prevPlayers = Array.isArray(prev.players) ? prev.players : []
  const existing = prevPlayers.find((player) => String(player?.id) === actorId) || null

  if (!existing) {
    return { ok: false, state: prev, reason: 'human-luck-missing-player', casLost: true }
  }

  if (isHumanLuckPaid({ player: existing, actionId })) {
    return { ok: true, state: prev, reason: 'already-applied', alreadyApplied: true }
  }

  const pendingOnly = statePatch._luckPendingOnly === true
  const payload = statePatch._luckPayload
    || incomingDelta.luckPayload
    || existing.humanLuckPending?.payload
    || null
  const skipNegativeCash = statePatch._luckSkipNegativeCash === true
    || existing.humanLuckPending?.skipNegativeCash === true
  const frozenCashDelta = Number.isFinite(Number(statePatch._luckFrozenCashDelta))
    ? Number(statePatch._luckFrozenCashDelta)
    : (Number.isFinite(Number(existing.humanLuckPending?.frozenCashDelta))
      ? Number(existing.humanLuckPending.frozenCashDelta)
      : null)

  if (pendingOnly) {
    const parked = planHumanLuckPendingOnly({
      matchId: statePatch._expectMatchId ?? prev.matchId,
      playerId: actorId,
      turnSeq: statePatch._expectTurnSeq,
      playerBefore: existing,
      payload,
      skipNegativeCash,
      frozenCashDelta,
    })
    if (parked.skip) {
      return { ok: true, state: prev, reason: parked.reason, alreadyApplied: true }
    }
    const nextPlayers = prevPlayers.map((player) =>
      String(player?.id) === actorId ? parked.playerAfter : player,
    )
    const next = {
      ...prev,
      ...stripCommitMeta(statePatch),
      players: nextPlayers,
    }
    try { delete next._luckPayload } catch { /* ignore */ }
    try { delete next._luckSkipNegativeCash } catch { /* ignore */ }
    try { delete next._luckFrozenCashDelta } catch { /* ignore */ }
    try { delete next._luckPendingOnly } catch { /* ignore */ }
    return { ok: true, state: next, reason: 'pending-parked', alreadyApplied: false }
  }

  const credited = applyHumanLuckCreditToCurrent(existing, {
    payload,
    skipNegativeCash,
    frozenCashDelta,
  })
  const pending = buildHumanLuckPending({
    matchId: statePatch._expectMatchId ?? existing.humanLuckPending?.matchId ?? prev.matchId,
    playerId: actorId,
    turnSeq: statePatch._expectTurnSeq ?? existing.humanLuckPending?.turnSeq,
    actionId,
    payload,
    skipNegativeCash,
    frozenCashDelta,
    paid: true,
  })
  const stamped = stampAndTrimHumanRevenueLastActions(
    { ...credited, humanLuckPending: pending },
    actionId,
    now,
  )
  const nextPlayers = prevPlayers.map((player) =>
    String(player?.id) === actorId ? stamped : player,
  )
  const next = {
    ...prev,
    ...stripCommitMeta(statePatch),
    players: nextPlayers,
  }
  try { delete next._luckPayload } catch { /* ignore */ }
  try { delete next._luckSkipNegativeCash } catch { /* ignore */ }
  try { delete next._luckFrozenCashDelta } catch { /* ignore */ }
  try { delete next._luckPendingOnly } catch { /* ignore */ }
  return { ok: true, state: next, reason: 'applied', alreadyApplied: false }
}

export async function persistHumanLuckWithRetries({
  attempts = 5,
  isCurrentTurn = () => true,
  getLivePlayer,
  getRoster,
  commitPlan,
  delay = (ms) => new Promise((r) => setTimeout(r, ms)),
  matchId,
  playerId,
  turnSeq,
  payload,
  skipNegativeCash = false,
} = {}) {
  let lastPlan = null
  for (let attempt = 0; attempt < attempts; attempt++) {
    if (!isCurrentTurn()) {
      return { ok: false, reason: 'stale-turn', pendingParked: false, plan: lastPlan }
    }
    const liveBefore = typeof getLivePlayer === 'function' ? getLivePlayer() : null
    if (!liveBefore) {
      return { ok: false, reason: 'no-player', pendingParked: false, plan: lastPlan }
    }
    const plan = planHumanLuckPersist({
      matchId,
      playerId,
      turnSeq,
      playerBefore: liveBefore,
      payload,
      skipNegativeCash,
      roster: typeof getRoster === 'function' ? getRoster() : null,
    })
    lastPlan = plan
    if (plan.skip) {
      return { ok: true, alreadyApplied: true, reason: plan.reason, plan, pendingParked: false }
    }
    const result = await commitPlan(plan)
    if (result?.ok === true || result?.alreadyApplied === true) {
      return {
        ok: true,
        alreadyApplied: !!result.alreadyApplied,
        plan,
        result,
        pendingParked: false,
      }
    }
    const recon = reconcileHumanLuckAfterCommit({
      actionId: plan.actionId,
      authoritativePlayer: result?.authoritativePlayer
        || (typeof getLivePlayer === 'function' ? getLivePlayer() : null),
    })
    if (recon.applied) {
      return { ok: true, alreadyApplied: true, reason: recon.reason, plan, pendingParked: false }
    }
    if (result?.retry === false) break
    await delay(Math.min(2000, 200 * (attempt + 1)))
  }

  if (!isCurrentTurn()) {
    return { ok: false, reason: 'stale-turn', pendingParked: false, plan: lastPlan }
  }
  const liveBefore = typeof getLivePlayer === 'function' ? getLivePlayer() : null
  const pendingPlan = planHumanLuckPendingOnly({
    matchId,
    playerId,
    turnSeq,
    playerBefore: liveBefore,
    payload,
    skipNegativeCash,
    frozenCashDelta: lastPlan?.frozenCashDelta,
  })
  lastPlan = pendingPlan
  if (pendingPlan.skip && pendingPlan.reason === 'already-paid') {
    return { ok: true, alreadyApplied: true, reason: 'already-paid', plan: pendingPlan, pendingParked: false }
  }
  if (pendingPlan.skip && pendingPlan.reason === 'already-pending') {
    return { ok: false, reason: 'commit-failed', pendingParked: true, plan: pendingPlan }
  }
  const parked = await commitPlan(pendingPlan)
  const liveAfter = typeof getLivePlayer === 'function' ? getLivePlayer() : parked?.state?.players?.find?.((p) => String(p?.id) === String(playerId))
  const pendingParked = parked?.ok === true
    || parked?.alreadyApplied === true
    || isHumanLuckDue({ player: liveAfter, matchId, playerId, turnSeq })
  return {
    ok: false,
    reason: 'commit-failed',
    pendingParked,
    plan: pendingPlan,
    result: parked,
  }
}
