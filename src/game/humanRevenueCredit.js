/**
 * Crédito de faturamento humano (passagem/chegada no início).
 * Separado do modal: abrir/fechar modal ≠ crédito confirmado.
 *
 * O recibo do turno fica em `humanTurnEffects`, com `revenueValue` congelado
 * por (match, player, turnSeq). A confirmação econômica é idempotente via
 * `lastActions[actionId]` ou `humanTurnEffects.done`.
 */

import { armLoanAfterRevenue } from './loanCycle.js'
import { buildPartialPlayerDelta } from './playerStateSync.js'
import { hasBotEffectAction, remainingEffectKinds, requiredEffectKinds } from './bots/botEconomicRuntime.js'

export const HUMAN_REVENUE_PREFIX = 'hum-revenue'
export const HUMAN_REVENUE_COMMIT_KIND = 'HUMAN_REVENUE'
export const HUMAN_LAST_ACTIONS_MAX = 50
const HUMAN_REVENUE_KIND = 'REVENUE'

const HUMAN_QUEUE_EVENT_TYPE = {
  REVENUE: 'REVENUE',
  EXPENSES: 'EXPENSES',
  LUCK: 'LUCK',
  ERP: 'ERP_PURCHASE',
  TRAINING: 'TRAINING_PURCHASE',
  DIRECT_BUY: 'DIRECT_BUY_PURCHASE',
  INSIDE: 'INSIDE_PURCHASE',
  CLIENTS: 'CLIENTS_PURCHASE',
  MANAGER: 'MANAGER_PURCHASE',
  FIELD: 'FIELD_PURCHASE',
  COMMON: 'COMMON_PURCHASE',
  MIX: 'MIX_PURCHASE',
}

function toFrozenInt(value) {
  return Math.max(0, Math.floor(Number(value) || 0))
}

function humanEffectsOf(player) {
  return player?.humanTurnEffects && typeof player.humanTurnEffects === 'object'
    ? player.humanTurnEffects
    : null
}

function parseHumanRevenueActionId(actionId) {
  if (!isHumanRevenueActionId(actionId)) return null
  const parts = String(actionId).split(':')
  if (parts.length < 4) return null
  return {
    matchId: String(parts[1] ?? ''),
    turnPlayerId: String(parts[2] ?? ''),
    turnSeq: Number(parts[3]) || 0,
  }
}

export function buildHumanRevenueActionId({ matchId, playerId, turnSeq } = {}) {
  return [
    HUMAN_REVENUE_PREFIX,
    String(matchId ?? ''),
    String(playerId ?? ''),
    String(Number(turnSeq) || 0),
  ].join(':')
}

export function isHumanRevenueActionId(actionId) {
  return String(actionId || '').startsWith(`${HUMAN_REVENUE_PREFIX}:`)
}

export function isSameHumanTurnEffectsScope(effects, { matchId, turnPlayerId, turnSeq } = {}) {
  if (!effects || typeof effects !== 'object') return false
  if (String(effects.turnPlayerId ?? '') !== String(turnPlayerId ?? '')) return false
  if (Number(effects.turnSeq) !== (Number(turnSeq) || 0)) return false
  if (matchId && effects.matchId && String(effects.matchId) !== String(matchId)) return false
  return true
}

function resolveHumanEffectsForScope({
  player,
  effects,
  matchId,
  turnPlayerId,
  turnSeq,
} = {}) {
  const candidate = effects || humanEffectsOf(player)
  if (!candidate) return null
  return isSameHumanTurnEffectsScope(candidate, { matchId, turnPlayerId, turnSeq })
    ? candidate
    : null
}

export function isHumanTurnEffectsSettled(effects, plan = effects) {
  if (!effects && !plan) return true
  const src = effects || plan
  if (src.settled === true) return true
  const required = requiredEffectKinds(src)
  if (required.length === 0) return true
  const done = Array.isArray(src.done) ? src.done : []
  return required.every((kind) => done.includes(kind))
}

export function buildHumanTurnEffectPlan({
  matchId,
  turnPlayerId,
  turnSeq,
  fromPos,
  toPos,
  steps,
  crossedStart,
  crossedExpenses,
  landTile,
  processLandTile,
  revenueValue,
  luckCardId,
  done,
  settled,
} = {}) {
  const plan = {
    matchId: matchId != null ? String(matchId) : '',
    turnPlayerId: turnPlayerId != null ? String(turnPlayerId) : '',
    turnSeq: Number(turnSeq) || 0,
    fromPos: Number(fromPos),
    toPos: Number(toPos),
    steps: Number(steps) || 0,
    crossedStart: crossedStart === true,
    crossedExpenses: crossedExpenses === true,
    landTile: landTile != null ? String(landTile) : 'NONE',
    processLandTile: processLandTile !== false,
    revenueValue: crossedStart === true ? toFrozenInt(revenueValue) : 0,
    ...(landTile === 'LUCK' && luckCardId ? { luckCardId: String(luckCardId) } : {}),
    done: Array.isArray(done) ? [...done] : [],
    settled: false,
  }
  const required = requiredEffectKinds(plan)
  const settledNow = settled === true || required.every((kind) => plan.done.includes(kind))
  plan.settled = required.length === 0 ? true : settledNow
  return plan
}

export function readHumanTurnEffects({
  players,
  matchId,
  turnPlayerId,
  turnSeq,
} = {}) {
  const seq = Number(turnSeq) || 0
  const actorId = turnPlayerId != null ? String(turnPlayerId) : ''
  for (const player of Array.isArray(players) ? players : []) {
    const effects = humanEffectsOf(player)
    if (!effects) continue
    if (actorId && String(effects.turnPlayerId ?? '') !== actorId) continue
    if (Number(effects.turnSeq) !== seq) continue
    if (matchId && effects.matchId && String(effects.matchId) !== String(matchId)) continue
    return { ok: true, effects, settled: isHumanTurnEffectsSettled(effects) }
  }
  return { ok: false, effects: null, settled: null }
}

function currentHumanRevenueScope({ player, actionId, matchId, turnPlayerId, turnSeq } = {}) {
  const parsed = parseHumanRevenueActionId(actionId)
  return {
    matchId: parsed?.matchId ?? String(matchId ?? ''),
    turnPlayerId: parsed?.turnPlayerId ?? String(turnPlayerId ?? player?.id ?? ''),
    turnSeq: parsed?.turnSeq ?? (Number(turnSeq) || 0),
  }
}

export function isHumanRevenuePaid({ player, actionId, effects } = {}) {
  if (hasBotEffectAction(player?.lastActions, actionId)) return true
  const scope = currentHumanRevenueScope({ player, actionId })
  const liveEffects = resolveHumanEffectsForScope({
    player,
    effects,
    matchId: scope.matchId,
    turnPlayerId: scope.turnPlayerId,
    turnSeq: scope.turnSeq,
  })
  if (!liveEffects) return false
  const done = Array.isArray(liveEffects.done) ? liveEffects.done : []
  return done.includes(HUMAN_REVENUE_KIND)
}

export function isHumanRevenueDue({ player, matchId, turnPlayerId, turnSeq } = {}) {
  const actorId = String(turnPlayerId ?? player?.id ?? '')
  const actionId = buildHumanRevenueActionId({
    matchId,
    playerId: actorId,
    turnSeq,
  })
  const effects = resolveHumanEffectsForScope({
    player,
    matchId,
    turnPlayerId: actorId,
    turnSeq,
  })
  if (!effects || effects.crossedStart !== true) return false
  return !isHumanRevenuePaid({ player, actionId, effects })
}

export function listDueHumanRevenues(prevState = {}) {
  const matchId = String(prevState.matchId ?? '')
  const turnPlayerId = String(prevState.turnPlayerId ?? '')
  const turnSeq = Number(prevState.turnSeq) || 0
  const players = Array.isArray(prevState.players) ? prevState.players : []
  const due = []
  const seen = new Set()

  const current = players.find((player) => String(player?.id) === turnPlayerId) || null
  if (current && isHumanRevenueDue({ player: current, matchId, turnPlayerId, turnSeq })) {
    due.push({
      player: current,
      effects: humanEffectsOf(current),
      matchId,
      turnPlayerId,
      turnSeq,
    })
    seen.add(String(current.id))
  }

  for (const player of players) {
    if (!player || player.bankrupt === true) continue
    if (seen.has(String(player.id))) continue
    const effects = humanEffectsOf(player)
    if (!effects) continue
    if (matchId && effects.matchId && String(effects.matchId) !== matchId) continue
    const actorId = String(effects.turnPlayerId ?? player.id)
    const seq = Number(effects.turnSeq) || 0
    if (!isHumanRevenueDue({
      player,
      matchId: effects.matchId ?? matchId,
      turnPlayerId: actorId,
      turnSeq: seq,
    })) continue
    due.push({
      player,
      effects,
      matchId: effects.matchId ?? matchId,
      turnPlayerId: actorId,
      turnSeq: seq,
    })
    seen.add(String(player.id))
  }
  return due
}

export function hasUnsettledHumanRevenue(prevState = {}) {
  return listDueHumanRevenues(prevState).length > 0
}

export function humanQueuedEventsFromEffects(effects) {
  return remainingEffectKinds(effects).map((kind) => ({
    type: HUMAN_QUEUE_EVENT_TYPE[kind] || kind,
  }))
}

export function shouldResumeHumanTurnEffects({
  isHumanTurn,
  player,
  matchId,
  turnPlayerId,
  turnSeq,
  gameOver = false,
} = {}) {
  if (gameOver === true) return { ok: false, reason: 'game-over', remaining: [], effects: null }
  if (!isHumanTurn) return { ok: false, reason: 'not-human', remaining: [], effects: null }
  const effects = humanEffectsOf(player)
  if (!isHumanRevenueDue({ player, matchId, turnPlayerId, turnSeq })) {
    return { ok: false, reason: 'not-due', remaining: [], effects }
  }
  return {
    ok: true,
    reason: 'payment-pending',
    remaining: remainingEffectKinds(effects),
    effects,
    frozenRevenue: toFrozenInt(effects?.revenueValue),
  }
}

export function applyHumanRevenueCreditToBaseline(player, { revenueValue, actionId } = {}) {
  if (!player) {
    return {
      player,
      actionId: actionId ?? null,
      fat: 0,
      cashBefore: 0,
      cashAfter: 0,
      loanArmed: false,
    }
  }
  const amount = toFrozenInt(revenueValue)
  const cashBefore = Number(player.cash) || 0
  const loanPending = player.loanPending || null
  const shouldArmLoan =
    loanPending &&
    Number(loanPending.amount) > 0 &&
    loanPending.charged !== true &&
    loanPending.eligibleOnExpenses !== true

  const next = {
    ...player,
    cash: cashBefore + amount,
    ...(shouldArmLoan ? { loanPending: armLoanAfterRevenue(loanPending) } : {}),
  }

  return {
    player: next,
    actionId: actionId ?? null,
    fat: amount,
    cashBefore,
    cashAfter: cashBefore + amount,
    loanArmed: !!shouldArmLoan,
  }
}

export function applyHumanRevenueToPlayer(player, fat) {
  return applyHumanRevenueCreditToBaseline(player, { revenueValue: fat })
}

export function markHumanRevenueDone(effects) {
  const base = effects && typeof effects === 'object' ? { ...effects } : {}
  const done = Array.isArray(base.done) ? [...base.done] : []
  if (!done.includes(HUMAN_REVENUE_KIND)) done.push(HUMAN_REVENUE_KIND)
  const next = {
    ...base,
    done,
  }
  next.settled = isHumanTurnEffectsSettled(next)
  return next
}

function pendingHumanEffectsFromInput({
  matchId,
  playerId,
  turnSeq,
  playerBefore,
  effects,
  revenueValue,
  fat,
  fromPos,
  toPos,
  steps,
  crossedStart = true,
  crossedExpenses = false,
  landTile = 'NONE',
  processLandTile = false,
} = {}) {
  const liveEffects = resolveHumanEffectsForScope({
    player: playerBefore,
    effects,
    matchId,
    turnPlayerId: playerId,
    turnSeq,
  })
  if (liveEffects) return liveEffects
  return buildHumanTurnEffectPlan({
    matchId,
    turnPlayerId: playerId,
    turnSeq,
    fromPos,
    toPos,
    steps,
    crossedStart,
    crossedExpenses,
    landTile,
    processLandTile,
    revenueValue: revenueValue ?? fat,
  })
}

export function hasHumanRevenueActionInRoster(players, actionId, extraLastActions = null) {
  if (hasBotEffectAction(extraLastActions, actionId)) return true
  for (const player of Array.isArray(players) ? players : []) {
    if (hasBotEffectAction(player?.lastActions, actionId)) return true
  }
  return false
}

export function classifyHumanRevenueLifecycle({
  player,
  actionId,
  effects,
  matchId,
  turnPlayerId,
  turnSeq,
} = {}) {
  const scope = currentHumanRevenueScope({
    player,
    actionId,
    matchId,
    turnPlayerId,
    turnSeq,
  })
  const rawEffects = effects || humanEffectsOf(player)
  if (
    rawEffects &&
    String(rawEffects.turnPlayerId ?? '') === String(scope.turnPlayerId) &&
    Number(rawEffects.turnSeq) === Number(scope.turnSeq) &&
    scope.matchId &&
    rawEffects.matchId &&
    String(rawEffects.matchId) !== String(scope.matchId)
  ) {
    return 'CANCELLED_MATCH'
  }
  const liveEffects = resolveHumanEffectsForScope({
    player,
    effects,
    matchId: scope.matchId,
    turnPlayerId: scope.turnPlayerId,
    turnSeq: scope.turnSeq,
  })
  if (isHumanRevenuePaid({
    player,
    actionId: actionId || buildHumanRevenueActionId({
      matchId: scope.matchId,
      playerId: scope.turnPlayerId,
      turnSeq: scope.turnSeq,
    }),
    effects: liveEffects,
  })) {
    return 'PAID'
  }
  if (liveEffects?.crossedStart === true) return 'PAYMENT_PENDING'
  return 'AWAITING_ACK'
}

export function shouldBlockHumanHandoffForEffects({
  isHumanTurn,
  player = null,
  effects,
  plan,
  matchId,
  turnPlayerId,
  turnSeq,
  economicBusy = false,
} = {}) {
  if (economicBusy === true) return { block: true, reason: 'economic-busy' }
  if (!isHumanTurn) return { block: false, reason: 'not-human' }
  const src = effects || plan || humanEffectsOf(player)
  if (!src) return { block: false, reason: 'no-plan' }
  // Só REVENUE bloqueia handoff neste plano: compras/despesas humanas
  // seguem a fila de modais e não atualizam `done` aqui.
  if (src.crossedStart !== true) return { block: false, reason: 'no-revenue' }
  const due = isHumanRevenueDue({
    player: player || { id: src.turnPlayerId, humanTurnEffects: src, lastActions: {} },
    matchId: matchId ?? src.matchId,
    turnPlayerId: turnPlayerId ?? src.turnPlayerId,
    turnSeq: turnSeq ?? src.turnSeq,
  })
  if (due) return { block: true, reason: 'revenue-pending' }
  return { block: false, reason: 'revenue-settled' }
}

/**
 * Após liquidar REVENUE (dono ou coordenador), o skip offline/timer
 * não pode avançar se ainda restarem efeitos obrigatórios do plano
 * (despesas, sorte, compras). Sem política de auto-resolução: bloqueia.
 */
export function shouldBlockOfflineSkipForHumanEffects({
  player = null,
  effects = null,
  matchId,
  turnPlayerId,
  turnSeq,
} = {}) {
  const src = resolveHumanEffectsForScope({
    player,
    effects,
    matchId,
    turnPlayerId,
    turnSeq,
  })
  if (!src) return { block: false, reason: 'no-plan', remaining: [] }
  if (
    isHumanRevenueDue({
      player: player || { id: turnPlayerId, humanTurnEffects: src, lastActions: {} },
      matchId,
      turnPlayerId,
      turnSeq,
      effects: src,
    })
  ) {
    return { block: true, reason: 'revenue-pending', remaining: ['REVENUE'] }
  }
  const remaining = remainingEffectKinds(src)
  if (remaining.length > 0) {
    return { block: true, reason: 'mandatory-effects-remaining', remaining }
  }
  return { block: false, reason: 'clear', remaining: [] }
}

export function planHumanRevenuePersist({
  matchId,
  playerId,
  turnSeq,
  playerBefore,
  fat,
  revenueValue,
  roster = null,
  extraLastActions = null,
  effects = null,
  fromPos,
  toPos,
  steps,
  crossedStart = true,
  crossedExpenses = false,
  landTile = 'NONE',
  processLandTile = false,
} = {}) {
  const pid = String(playerId ?? playerBefore?.id ?? '')
  const actionId = buildHumanRevenueActionId({ matchId, playerId: pid, turnSeq })
  const liveEffects = pendingHumanEffectsFromInput({
    matchId,
    playerId: pid,
    turnSeq,
    playerBefore,
    effects,
    revenueValue,
    fat,
    fromPos,
    toPos,
    steps,
    crossedStart,
    crossedExpenses,
    landTile,
    processLandTile,
  })
  const frozenRevenue = toFrozenInt(liveEffects?.revenueValue ?? revenueValue ?? fat)
  const paid =
    hasHumanRevenueActionInRoster(roster, actionId, extraLastActions) ||
    isHumanRevenuePaid({ player: playerBefore, actionId, effects: liveEffects })

  if (paid) {
    return {
      skip: true,
      reason: 'already-paid',
      actionId,
      playerId: pid,
      fat: frozenRevenue,
      revenueValue: frozenRevenue,
      cashBefore: Number(playerBefore?.cash) || 0,
      cashAfter: Number(playerBefore?.cash) || 0,
      playerAfter: playerBefore,
      humanTurnEffects: liveEffects,
      playersDeltaById: null,
      commitKind: HUMAN_REVENUE_COMMIT_KIND,
    }
  }

  const applied = applyHumanRevenueCreditToBaseline(playerBefore, {
    revenueValue: frozenRevenue,
    actionId,
  })
  const nextEffects = markHumanRevenueDone(liveEffects)
  const playerAfter = {
    ...applied.player,
    humanTurnEffects: nextEffects,
  }
  const delta = buildPartialPlayerDelta(playerBefore, playerAfter, { _actionId: actionId })

  return {
    skip: false,
    reason: 'apply',
    actionId,
    playerId: pid,
    fat: applied.fat,
    revenueValue: frozenRevenue,
    cashBefore: applied.cashBefore,
    cashAfter: applied.cashAfter,
    playerAfter,
    humanTurnEffects: nextEffects,
    loanArmed: applied.loanArmed,
    playersDeltaById: { [pid]: delta },
    commitKind: HUMAN_REVENUE_COMMIT_KIND,
  }
}

export function planCoordinatorRevenueLiquidation({
  matchId,
  turnPlayerId,
  turnSeq,
  players,
  playerBefore,
  extraLastActions = null,
} = {}) {
  const roster = Array.isArray(players) ? players : []
  const actorId = String(turnPlayerId ?? playerBefore?.id ?? '')
  const before = playerBefore || roster.find((player) => String(player?.id) === actorId) || null
  const read = readHumanTurnEffects({
    players: before ? [before] : roster,
    matchId,
    turnPlayerId: actorId,
    turnSeq,
  })
  if (!before || !read.ok || !isHumanRevenueDue({ player: before, matchId, turnPlayerId: actorId, turnSeq })) {
    return {
      skip: true,
      reason: 'no-pending-revenue',
      actionId: buildHumanRevenueActionId({ matchId, playerId: actorId, turnSeq }),
      playerId: actorId,
      fat: toFrozenInt(read.effects?.revenueValue),
      revenueValue: toFrozenInt(read.effects?.revenueValue),
      cashBefore: Number(before?.cash) || 0,
      cashAfter: Number(before?.cash) || 0,
      playerAfter: before,
      humanTurnEffects: read.effects || null,
      playersDeltaById: null,
      commitKind: HUMAN_REVENUE_COMMIT_KIND,
    }
  }
  return planHumanRevenuePersist({
    matchId,
    playerId: actorId,
    turnSeq,
    playerBefore: before,
    revenueValue: read.effects?.revenueValue,
    roster,
    extraLastActions,
    effects: read.effects,
  })
}

export function stampAndTrimHumanRevenueLastActions(player, actionId, at = Date.now(), max = HUMAN_LAST_ACTIONS_MAX) {
  const stamped = stampHumanRevenueLastActions(player, actionId, at)
  const lastActions =
    stamped.lastActions && typeof stamped.lastActions === 'object'
      ? { ...stamped.lastActions }
      : {}
  const keys = Object.keys(lastActions)
  if (keys.length > max) {
    keys
      .sort((a, b) => Number(lastActions[a] || 0) - Number(lastActions[b] || 0))
      .slice(0, keys.length - max)
      .forEach((key) => { delete lastActions[key] })
  }
  return { ...stamped, lastActions }
}

export function applyDueHumanRevenuesToRoster(prevState = {}, { now = Date.now() } = {}) {
  const due = listDueHumanRevenues(prevState)
  if (!due.length) {
    return {
      players: Array.isArray(prevState.players) ? prevState.players : [],
      applied: [],
      skipped: true,
    }
  }
  let roster = (Array.isArray(prevState.players) ? prevState.players : []).map((player) => ({ ...player }))
  const applied = []
  for (const item of due) {
    const live = roster.find((player) => String(player?.id) === String(item.player?.id)) || item.player
    const plan = planCoordinatorRevenueLiquidation({
      matchId: item.matchId,
      turnPlayerId: item.turnPlayerId,
      turnSeq: item.turnSeq,
      players: roster,
      playerBefore: live,
    })
    if (plan.skip || !plan.playerAfter) continue
    roster = roster.map((player) =>
      String(player?.id) === String(item.player?.id)
        ? stampAndTrimHumanRevenueLastActions(plan.playerAfter, plan.actionId, now)
        : player,
    )
    applied.push(plan)
  }
  return { players: roster, applied, skipped: applied.length === 0 }
}

export function reconcileHumanRevenueAfterCommit({
  actionId,
  authoritativePlayer,
  effects,
  matchId,
  turnPlayerId,
  turnSeq,
} = {}) {
  if (!authoritativePlayer) {
    return { applied: false, reason: 'no-authoritative-player' }
  }
  if (hasBotEffectAction(authoritativePlayer.lastActions, actionId)) {
    return {
      applied: true,
      reason: 'lastActions',
      cash: Number(authoritativePlayer.cash) || 0,
      effects: humanEffectsOf(authoritativePlayer),
    }
  }
  const scope = currentHumanRevenueScope({
    player: authoritativePlayer,
    actionId,
    matchId,
    turnPlayerId,
    turnSeq,
  })
  const liveEffects = resolveHumanEffectsForScope({
    player: authoritativePlayer,
    effects,
    matchId: scope.matchId,
    turnPlayerId: scope.turnPlayerId,
    turnSeq: scope.turnSeq,
  })
  if (liveEffects && isHumanRevenuePaid({ player: authoritativePlayer, actionId, effects: liveEffects })) {
    return {
      applied: true,
      reason: 'effects-done',
      cash: Number(authoritativePlayer.cash) || 0,
      effects: liveEffects,
    }
  }
  const remoteCash = Number(authoritativePlayer.cash)
  return {
    applied: false,
    reason: 'unconfirmed',
    cash: Number.isFinite(remoteCash) ? remoteCash : null,
    effects: liveEffects,
  }
}

export function isFaturamentoOnceBlocking(flag) {
  return flag === true || flag === 'queued' || flag === 'done'
}

export function isFaturamentoEconomicallyDone(flag) {
  return flag === true || flag === 'done'
}

export function simulateLegacyFireAndForgetRevenueRace({
  cashBefore,
  fat,
  applyStaleSnapshot = true,
  remoteNeverAcked = true,
} = {}) {
  const amount = toFrozenInt(fat)
  const before = Number(cashBefore) || 0
  let localCash = before
  let remoteCash = before
  let baselineCash = before
  let commitCompleted = false
  let loggedSuccess = false
  let cashDeltaBuilt

  localCash = before + amount
  loggedSuccess = true
  cashDeltaBuilt = localCash
  baselineCash = localCash

  if (applyStaleSnapshot) {
    localCash = before
    baselineCash = before
  }

  if (!remoteNeverAcked) {
    remoteCash = before + amount
    commitCompleted = true
    localCash = remoteCash
  }

  return {
    localCash,
    remoteCash,
    baselineCash,
    commitCompleted,
    loggedSuccess,
    cashDeltaBuilt,
    lost:
      loggedSuccess &&
      localCash === before &&
      remoteCash === before &&
      !commitCompleted,
  }
}

export function simulateAwaitedRevenueCredit({
  cashBefore,
  fat,
  matchId = 'm1',
  playerId = 'p-human-1',
  turnSeq = 7,
  staleOverwriteAfterConfirm = true,
  commitFailsFirst = false,
} = {}) {
  const initialEffects = buildHumanTurnEffectPlan({
    matchId,
    turnPlayerId: playerId,
    turnSeq,
    crossedStart: true,
    crossedExpenses: false,
    landTile: 'NONE',
    processLandTile: false,
    revenueValue: fat,
  })
  const plan = planHumanRevenuePersist({
    matchId,
    playerId,
    turnSeq,
    playerBefore: {
      id: playerId,
      cash: Number(cashBefore) || 0,
      lastActions: {},
      humanTurnEffects: initialEffects,
    },
    fat,
  })

  const store = {
    players: [{
      id: playerId,
      cash: Number(cashBefore) || 0,
      lastActions: {},
      humanTurnEffects: initialEffects,
    }],
  }

  function applyPlan(nextPlan) {
    if (nextPlan.skip) return { ok: true, alreadyApplied: true }
    const current = store.players[0]
    if (isHumanRevenuePaid({ player: current, actionId: nextPlan.actionId })) {
      return { ok: true, alreadyApplied: true }
    }
    const delta = nextPlan.playersDeltaById[playerId]
    if (delta && Object.prototype.hasOwnProperty.call(delta, 'cash')) current.cash = delta.cash
    if (delta?.loanPending !== undefined) current.loanPending = delta.loanPending
    if (delta?.humanTurnEffects) current.humanTurnEffects = delta.humanTurnEffects
    current.lastActions = { ...current.lastActions, [nextPlan.actionId]: 1 }
    return { ok: true, alreadyApplied: false }
  }

  let result = commitFailsFirst
    ? { ok: false, reason: 'cas-lost' }
    : applyPlan(plan)

  if (!result.ok) {
    const recon = reconcileHumanRevenueAfterCommit({
      actionId: plan.actionId,
      authoritativePlayer: store.players[0],
    })
    if (!recon.applied) {
      result = applyPlan(plan)
    } else {
      result = { ok: true, alreadyApplied: true }
    }
  }

  let localCash = store.players[0].cash
  const remoteCashAfterCommit = store.players[0].cash

  if (staleOverwriteAfterConfirm) {
    const staleLocal = Number(cashBefore) || 0
    const recon = reconcileHumanRevenueAfterCommit({
      actionId: plan.actionId,
      authoritativePlayer: store.players[0],
    })
    localCash = recon.applied ? recon.cash : staleLocal
  }

  const second = planHumanRevenuePersist({
    matchId,
    playerId,
    turnSeq: turnSeq + 1,
    playerBefore: {
      ...store.players[0],
      humanTurnEffects: buildHumanTurnEffectPlan({
        matchId,
        turnPlayerId: playerId,
        turnSeq: turnSeq + 1,
        crossedStart: true,
        crossedExpenses: false,
        landTile: 'NONE',
        processLandTile: false,
        revenueValue: fat,
      }),
    },
    fat,
    roster: store.players,
  })

  const retrySame = planHumanRevenuePersist({
    matchId,
    playerId,
    turnSeq,
    playerBefore: { ...store.players[0] },
    fat,
    roster: store.players,
  })

  return {
    actionId: plan.actionId,
    localCash,
    remoteCash: remoteCashAfterCommit,
    commitOk: result?.ok === true,
    secondSkip: second.skip,
    secondActionId: second.actionId,
    retrySameSkip: retrySame.skip,
    expectedCash: (Number(cashBefore) || 0) + toFrozenInt(fat),
  }
}

export function stampHumanRevenueLastActions(player, actionId, at = Date.now()) {
  if (!player || !actionId) return player
  return {
    ...player,
    lastActions: {
      ...(player.lastActions && typeof player.lastActions === 'object' ? player.lastActions : {}),
      [String(actionId)]: at,
    },
  }
}
