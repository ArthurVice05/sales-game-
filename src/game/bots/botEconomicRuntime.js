/**
 * Runtime econômico da Máquina: ator, plano de efeitos, actionId estável,
 * idempotência e receipt settled. Não contém política (botPolicy).
 */
import { isBotPlayer } from './botTypes.js'
import { applyDeltas, applyTrainingPurchase } from '../gameMath.js'
import { buildClientsPurchaseDeltas } from '../clientsPurchase.js'
import { buildCommonSellersPurchaseDeltas } from '../commonSellersPurchase.js'
import { buildFieldSalesPurchaseDeltas } from '../fieldSalesPurchase.js'
import { buildInsideSalesPurchaseDeltas } from '../insideSalesPurchase.js'
import { buildManagerPurchaseDeltas } from '../managersPurchase.js'
import { buildErpPurchaseDeltas } from '../erpPurchase.js'
import { buildMixPurchaseDeltas } from '../productMixPurchase.js'
import { buildPartialPlayerDelta } from '../playerStateSync.js'
import { isValidClaimProof, resolveAuthoritativeExecutor } from './botClaimProof.js'
import { applySorteRevesPayloadToPlayer } from '../sorteRevesApply.js'
import { settleBotMandatoryCharge } from './botEconomicCharge.js'
import { createBotRng } from './botRandom.js'
import { pickSorteRevesCard, resolveSorteRevesCard } from '../sorteRevesCards.js'
import { isDevVerbose } from '../debugFlags.js'

export const BOT_EFFECT_PREFIX = 'bot-effect'

export const BOT_PURCHASE_KINDS = Object.freeze([
  'CLIENTS',
  'COMMON',
  'FIELD',
  'INSIDE',
  'MANAGER',
  'ERP',
  'MIX',
  'TRAINING',
  'DIRECT_BUY',
])

const PURCHASE_TILES = new Set(BOT_PURCHASE_KINDS)

export const BOT_EFFECT_RETRY_MS = 200
export const BOT_EFFECT_MAX_BACKOFF_MS = 2000
export const BOT_EFFECT_MAX_ATTEMPTS = 25

const TERMINAL_ECO_REASONS = new Set([
  'game-over',
  'not-bot-turn',
  'actor-mismatch',
  'match-mismatch',
  'turn-player-changed',
  'turn-seq-changed',
  'stale-turn-player',
  'stale-turn-seq',
  'stale-match-id',
  'remote-contradicts-proof',
  'executor-mismatch',
  'not-remote-executor',
  'not-lease-holder',
  'human-acting-as-bot',
  'no-local-uid',
])

const TRANSIENT_ECO_REASONS = new Set([
  'authority-not-ready',
  'missing-executor',
  'cas-lost',
  'casLost',
  'network-error',
  'network',
  'commit-failed',
  'undefined-result',
  'bot-effect-unconfirmed',
])

export function logBotEco(event, fields = {}) {
  if (!isDevVerbose()) return
  const proof = fields.claimProof || null
  console.log('[BOT_ECO]', event, {
    matchId: fields.matchId ?? null,
    turnPlayerId: fields.turnPlayerId ?? null,
    turnSeq: fields.turnSeq ?? null,
    effectKind: fields.effectKind ?? null,
    actionId: fields.actionId ?? null,
    executorId: fields.executorId ?? null,
    claimExecutorId: proof?.executorId ?? fields.claimExecutorId ?? null,
    botClaimExecutor: fields.botClaimExecutor ?? fields.remoteExecutorId ?? null,
    lockOwnerLocal: fields.lockOwnerLocal ?? fields.lockOwner ?? null,
    lockOwnerRemote: fields.lockOwnerRemote ?? null,
    ok: fields.ok ?? null,
    casLost: fields.casLost ?? null,
    reason: fields.reason ?? null,
    settled: fields.settled ?? null,
  })
}

export function botEconomicJobKey({ matchId, turnPlayerId, turnSeq } = {}) {
  return `${String(matchId ?? '')}|${String(turnPlayerId ?? '')}|${Number(turnSeq) || 0}`
}

export function shouldAcceptBotEconomicJob({ activeKey = '', nextKey = '', busy = false } = {}) {
  if (busy === true) {
    return {
      ok: false,
      reason: 'single-flight',
      sameKey: !!(activeKey && nextKey && String(activeKey) === String(nextKey)),
    }
  }
  return { ok: true, reason: 'accept' }
}

export function classifyBotEffectCommitResult(result) {
  if (result?.ok === true || result?.alreadyApplied === true) {
    return { ok: true, retry: false, terminal: false, reason: result?.reason || 'ok' }
  }
  const reason = String(
    result?.reason || (result?.casLost === true ? 'cas-lost' : 'commit-failed'),
  )
  if (TERMINAL_ECO_REASONS.has(reason)) {
    return { ok: false, retry: false, terminal: true, reason }
  }
  if (result?.casLost === true || TRANSIENT_ECO_REASONS.has(reason)) {
    return { ok: false, retry: true, terminal: false, reason }
  }
  return { ok: false, retry: true, terminal: false, reason }
}

export function isTransientBotEconomicGate(gate) {
  if (!gate || gate.ok === true) return false
  if (gate.terminal === true) return false
  if (gate.retry === true) return true
  return TRANSIENT_ECO_REASONS.has(String(gate.reason || ''))
}

export function shouldRescheduleBotEconomicEffects({
  isBotTurn = false,
  effects = null,
  economicBusy = false,
  eventsInProgress = false,
  gate = null,
} = {}) {
  if (economicBusy === true || eventsInProgress === true) {
    return { ok: false, reason: 'in-flight' }
  }
  if (!isBotTurn) return { ok: false, reason: 'not-bot' }
  if (isBotTurnEffectsSettled(effects)) return { ok: false, reason: 'settled' }
  if (gate?.terminal === true && gate?.ok === false) {
    return { ok: false, reason: gate.reason || 'gate-terminal' }
  }
  if (gate?.ok === true || isTransientBotEconomicGate(gate) || !gate) {
    return { ok: true, reason: gate?.ok ? 'leftover-unsettled' : (gate?.reason || 'authority-not-ready') }
  }
  return { ok: false, reason: gate?.reason || 'gate-blocked' }
}

function defaultEcoSleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, Math.max(0, Number(ms) || 0)))
}

function terminalFromLive(live = {}, logCtx = {}) {
  if (live.gameOver === true) return 'game-over'
  if (logCtx.matchId != null && live.matchId != null && String(live.matchId) !== String(logCtx.matchId)) {
    return 'match-mismatch'
  }
  if (
    logCtx.turnPlayerId != null &&
    live.turnPlayerId != null &&
    String(live.turnPlayerId) !== String(logCtx.turnPlayerId)
  ) {
    return 'turn-player-changed'
  }
  if (logCtx.turnSeq != null && live.turnSeq != null && Number(live.turnSeq) !== Number(logCtx.turnSeq)) {
    return 'turn-seq-changed'
  }
  const localExec = live.executorId ?? live.claimProof?.executorId
  const remoteExec = live.botClaimExecutor ?? live.remoteExecutorId
  if (localExec && remoteExec && String(localExec) !== String(remoteExec)) {
    return 'executor-mismatch'
  }
  return null
}

export async function retryBotEffectCommit({
  commit,
  args = {},
  getLive,
  shouldContinue,
  sleep = defaultEcoSleep,
  delayMs = BOT_EFFECT_RETRY_MS,
  maxBackoffMs = BOT_EFFECT_MAX_BACKOFF_MS,
  maxAttempts = BOT_EFFECT_MAX_ATTEMPTS,
  logCtx = {},
} = {}) {
  let backoff = delayMs
  let last = { ok: false, reason: 'commit-failed' }
  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    if (typeof shouldContinue === 'function') {
      const cont = shouldContinue() || { ok: true }
      if (!cont.ok) {
        const reason = cont.reason || 'cancelled'
        if (cont.terminal === true || TERMINAL_ECO_REASONS.has(reason)) {
          return { ok: false, reason, terminal: true }
        }
        last = { ok: false, reason }
        logBotEco('RETRY', { ...logCtx, actionId: args.actionId, attempt, reason, ...liveLog({}) })
        if (attempt >= maxAttempts) break
        if (typeof sleep === 'function' && backoff > 0) await sleep(backoff)
        backoff = Math.min(maxBackoffMs, Math.floor(backoff * 1.25) + delayMs)
        continue
      }
    }
    const live = typeof getLive === 'function' ? getLive() || {} : {}
    const liveStop = terminalFromLive(live, logCtx)
    if (liveStop) return { ok: false, reason: liveStop, terminal: true }
    const actionId = args.actionId
    if (actionId && hasBotEffectActionInRoster(live.players, actionId, live.lastActions)) {
      return { ok: true, alreadyApplied: true, reason: 'already-applied' }
    }
    logBotEco('COMMIT_ATTEMPT', { ...logCtx, actionId, attempt, ...liveLog(live) })
    let raw = null
    try {
      raw = await commit(args)
    } catch {
      raw = { ok: false, reason: 'network-error', casLost: true }
    }
    last = raw && typeof raw === 'object' ? raw : { ok: !!raw, reason: raw ? 'ok' : 'undefined-result' }
    const classified = classifyBotEffectCommitResult(last)
    logBotEco('COMMIT_RESULT', {
      ...logCtx,
      actionId,
      attempt,
      ok: classified.ok,
      casLost: last.casLost === true,
      reason: classified.reason,
      ...liveLog(live),
    })
    if (classified.ok) return last
    if (!classified.retry) return { ...last, ok: false, reason: classified.reason, terminal: true }
    logBotEco('RETRY', {
      ...logCtx,
      actionId,
      attempt,
      reason: classified.reason,
      ...liveLog(live),
    })
    if (attempt >= maxAttempts) break
    if (typeof sleep === 'function' && backoff > 0) await sleep(backoff)
    backoff = Math.min(maxBackoffMs, Math.floor(backoff * 1.25) + delayMs)
  }
  return { ...last, ok: false, reason: last.reason || 'commit-failed', terminal: false }
}

function liveLog(live = {}) {
  return {
    botClaimExecutor: live.botClaimExecutor ?? live.remoteExecutorId ?? null,
    lockOwnerLocal: live.lockOwner ?? null,
    lockOwnerRemote: live.remoteLockOwner ?? live.lockOwner ?? null,
    executorId: live.executorId ?? live.claimProof?.executorId ?? null,
    claimProof: live.claimProof ?? null,
  }
}

/**
 * Autoridade do CLAIM (prova + executor), não um lockOwnerRef stale de React.
 * lockOwner vivo só contradiz; vazio + prova válida do mesmo turno = pode executar.
 */
export function shouldRunBotEconomicEffects({
  currentPlayer,
  turnPlayerId,
  myUid,
  lockOwner,
  gameOver = false,
  executorId = null,
  remoteExecutorId = null,
  claimProof = null,
  matchId = null,
  turnSeq = null,
} = {}) {
  if (gameOver === true) {
    return { ok: false, reason: 'game-over', terminal: true, retry: false }
  }
  if (!isBotPlayer(currentPlayer)) {
    return { ok: false, reason: 'not-bot-turn', terminal: true, retry: false }
  }
  if (String(currentPlayer?.id ?? '') !== String(turnPlayerId ?? '')) {
    return { ok: false, reason: 'actor-mismatch', terminal: true, retry: false }
  }
  const me = myUid != null ? String(myUid) : ''
  if (!me) return { ok: false, reason: 'no-local-uid', terminal: true, retry: false }

  const proof = isValidClaimProof(claimProof) ? claimProof : null
  if (proof) {
    if (matchId != null && proof.matchId != null && String(proof.matchId) !== String(matchId)) {
      return { ok: false, reason: 'match-mismatch', terminal: true, retry: false }
    }
    if (
      turnPlayerId != null &&
      proof.turnPlayerId != null &&
      String(proof.turnPlayerId) !== String(turnPlayerId)
    ) {
      return { ok: false, reason: 'turn-player-changed', terminal: true, retry: false }
    }
    if (turnSeq != null && proof.turnSeq != null && Number(proof.turnSeq) !== Number(turnSeq)) {
      return { ok: false, reason: 'turn-seq-changed', terminal: true, retry: false }
    }
  }

  const proofLock = proof?.lockOwner != null ? String(proof.lockOwner) : ''
  const liveLock = lockOwner != null && String(lockOwner) !== '' ? String(lockOwner) : ''

  if (proof && proofLock === me) {
    if (liveLock && liveLock !== me) {
      return { ok: false, reason: 'not-lease-holder', terminal: true, retry: false }
    }
  } else if (liveLock) {
    if (liveLock !== me) {
      return { ok: false, reason: 'not-lease-holder', terminal: true, retry: false }
    }
  } else {
    return { ok: false, reason: 'authority-not-ready', terminal: false, retry: true }
  }

  const localExec =
    executorId != null
      ? String(executorId)
      : (proof?.executorId != null ? String(proof.executorId) : '')
  if (!localExec) {
    return { ok: false, reason: 'missing-executor', terminal: false, retry: true }
  }

  const authExec = resolveAuthoritativeExecutor({
    claimProof: proof || claimProof,
    localExecutorId: localExec,
    remoteExecutorId,
  })
  if (!authExec.ok) {
    const reason = authExec.reason || 'not-remote-executor'
    if (reason === 'missing-executor') {
      return { ok: false, reason: 'authority-not-ready', terminal: false, retry: true }
    }
    return { ok: false, reason, terminal: true, retry: false }
  }
  if (String(authExec.executorId) !== localExec) {
    return { ok: false, reason: 'not-remote-executor', terminal: true, retry: false }
  }
  return {
    ok: true,
    reason: 'bot-under-authorized-executor',
    executorId: localExec,
    terminal: false,
    retry: false,
  }
}

/** Identidade lógica estável — sem executor/tab. */
export function buildBotEffectActionId({
  matchId,
  playerId,
  turnSeq,
  effectKind,
} = {}) {
  const kind = String(effectKind || '').trim()
  return [
    BOT_EFFECT_PREFIX,
    String(matchId ?? ''),
    String(playerId ?? ''),
    String(Number(turnSeq) || 0),
    kind,
  ].join(':')
}

export function botEffectActionPrefix(matchId, playerId, turnSeq) {
  return `${BOT_EFFECT_PREFIX}:${String(matchId ?? '')}:${String(playerId ?? '')}:${Number(turnSeq) || 0}:`
}

export function hasBotEffectAction(lastActions, actionId) {
  if (!actionId || !lastActions || typeof lastActions !== 'object') return false
  return Object.prototype.hasOwnProperty.call(lastActions, String(actionId))
}

export function purchaseKindFromLandTile(landTile) {
  const t = String(landTile || '').toUpperCase()
  return PURCHASE_TILES.has(t) ? t : null
}

export function requiredEffectKinds(plan = {}) {
  const kinds = []
  if (plan.crossedStart === true) kinds.push('REVENUE')
  if (plan.crossedExpenses === true) kinds.push('EXPENSES')
  if (plan.processLandTile === true && String(plan.landTile || '').toUpperCase() === 'LUCK') {
    kinds.push('LUCK')
  }
  const purchase = purchaseKindFromLandTile(plan.landTile)
  if (plan.processLandTile === true && purchase) kinds.push(purchase)
  return kinds
}

export function buildBotTurnEffectPlan({
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
  settled,
  done,
  directBuyOpen = null,
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
    done: Array.isArray(done) ? [...done] : [],
    directBuyOpen: directBuyOpen != null ? String(directBuyOpen) : null,
    settled: false,
  }
  const required = requiredEffectKinds(plan)
  const settledNow =
    settled === true || required.every((k) => plan.done.includes(k))
  plan.settled = required.length === 0 ? true : settledNow
  return plan
}

export function readBotTurnEffects({
  players,
  matchId,
  turnPlayerId,
  turnSeq,
} = {}) {
  const seq = Number(turnSeq) || 0
  const botId = turnPlayerId != null ? String(turnPlayerId) : ''
  for (const player of Array.isArray(players) ? players : []) {
    const fx = player?.botTurnEffects
    if (!fx || typeof fx !== 'object') continue
    if (botId && String(fx.turnPlayerId ?? '') !== botId) continue
    if (Number(fx.turnSeq) !== seq) continue
    if (matchId && fx.matchId && String(fx.matchId) !== String(matchId)) continue
    return { ok: true, effects: fx, settled: fx.settled === true }
  }
  return { ok: false, effects: null, settled: null }
}

export function isBotTurnEffectsSettled(effects, plan = effects) {
  if (!effects && !plan) return true
  const src = effects || plan
  if (src.settled === true) return true
  const required = requiredEffectKinds(src)
  if (required.length === 0) return true
  const done = Array.isArray(src.done) ? src.done : []
  return required.every((k) => done.includes(k))
}

export function shouldBlockBotHandoffForEffects({
  isBotTurn,
  effects,
  plan,
  economicBusy = false,
} = {}) {
  if (economicBusy === true) return { block: true, reason: 'economic-busy' }
  if (!isBotTurn) return { block: false, reason: 'not-bot' }
  const src = effects || plan
  if (!src) return { block: false, reason: 'no-plan' }
  if (isBotTurnEffectsSettled(src)) return { block: false, reason: 'settled' }
  return { block: true, reason: 'effects-pending' }
}

export function markBotEffectDone(effects, kind, extra = {}) {
  const base = effects && typeof effects === 'object' ? { ...effects } : {}
  const done = Array.isArray(base.done) ? [...base.done] : []
  const k = String(kind || '')
  if (k && !done.includes(k)) done.push(k)
  const next = {
    ...base,
    ...extra,
    done,
  }
  next.settled = isBotTurnEffectsSettled(next)
  return next
}

export function isKindAlreadyProcessed(effects, lastActions, actionId, kind) {
  if (hasBotEffectAction(lastActions, actionId)) return true
  const done = Array.isArray(effects?.done) ? effects.done : []
  return kind != null && done.includes(String(kind))
}

/**
 * Aplica o mesmo builder humano. SKIP não muta economia.
 */
export function applyBotPurchasePayload(player, kind, payload) {
  if (!player) return { player, changed: false, skipped: true }
  if (!payload || payload.action === 'SKIP' || payload.action === 'BACK') {
    return { player, changed: false, skipped: true }
  }
  const k = String(kind || '').toUpperCase()
  if (k === 'CLIENTS' && payload.action === 'BUY') {
    return { player: applyDeltas(player, buildClientsPurchaseDeltas(payload)), changed: true, skipped: false }
  }
  if (k === 'COMMON' && payload.action === 'BUY') {
    return { player: applyDeltas(player, buildCommonSellersPurchaseDeltas(payload)), changed: true, skipped: false }
  }
  if (k === 'FIELD' && (payload.action === 'BUY' || payload.action === 'HIRE')) {
    return { player: applyDeltas(player, buildFieldSalesPurchaseDeltas(payload)), changed: true, skipped: false }
  }
  if (k === 'INSIDE' && (payload.action === 'BUY' || payload.action === 'HIRE')) {
    return { player: applyDeltas(player, buildInsideSalesPurchaseDeltas(payload)), changed: true, skipped: false }
  }
  if ((k === 'MANAGER' || k === 'MANAGERS') && (payload.action === 'BUY' || payload.action === 'HIRE')) {
    return { player: applyDeltas(player, buildManagerPurchaseDeltas(payload)), changed: true, skipped: false }
  }
  if (k === 'ERP' && payload.action === 'BUY') {
    return { player: applyDeltas(player, buildErpPurchaseDeltas(payload)), changed: true, skipped: false }
  }
  if (k === 'MIX' && payload.action === 'BUY') {
    return { player: applyDeltas(player, buildMixPurchaseDeltas(payload)), changed: true, skipped: false }
  }
  if (k === 'TRAINING' && payload.action === 'BUY') {
    return { player: applyTrainingPurchase(player, payload), changed: true, skipped: false }
  }
  return { player, changed: false, skipped: true }
}

/** Delta absoluto (valores-alvo) — retry não reaplica +=. */
export function buildBotEconomicPlayerDelta(before, after, actionId) {
  return buildPartialPlayerDelta(before, after, actionId != null ? { _actionId: actionId } : {})
}

export function nextPlayersWith(playerList, ownerId, nextPlayer) {
  return (Array.isArray(playerList) ? playerList : []).map((p) =>
    String(p?.id) === String(ownerId) ? nextPlayer : p,
  )
}

export function remainingEffectKinds(planOrEffects) {
  const required = requiredEffectKinds(planOrEffects)
  const done = Array.isArray(planOrEffects?.done) ? planOrEffects.done : []
  return required.filter((k) => !done.includes(k))
}

export function isClaimProofInTurnScope(claimProof, { matchId, turnPlayerId, turnSeq } = {}) {
  if (!claimProof || typeof claimProof !== 'object') return false
  if (claimProof.matchId != null && matchId != null && String(claimProof.matchId) !== String(matchId)) {
    return false
  }
  if (
    claimProof.turnPlayerId != null &&
    turnPlayerId != null &&
    String(claimProof.turnPlayerId) !== String(turnPlayerId)
  ) {
    return false
  }
  if (claimProof.turnSeq != null && turnSeq != null && Number(claimProof.turnSeq) !== Number(turnSeq)) {
    return false
  }
  return true
}

/** Seed do mesmo turno: claimProof.seed scoped ou botTurnSeed já do turno vivo. */
export function resolveBotLuckSeed({
  seed,
  claimProof,
  matchId,
  turnPlayerId,
  turnSeq,
} = {}) {
  if (isClaimProofInTurnScope(claimProof, { matchId, turnPlayerId, turnSeq })) {
    if (Array.isArray(claimProof.seed) && claimProof.seed.length > 0) return claimProof.seed
  }
  if (Array.isArray(seed) && seed.length > 0) return seed
  return null
}

export function reconstructBotLuckPayload({
  luckPayload,
  seed,
  player,
  matchId,
  turnPlayerId,
  turnSeq,
  claimProof,
} = {}) {
  if (luckPayload && luckPayload.action === 'APPLY_CARD') {
    return { ok: true, source: 'receipt', payload: luckPayload, reason: null }
  }
  const bytes = resolveBotLuckSeed({ seed, claimProof, matchId, turnPlayerId, turnSeq })
  if (bytes) {
    const card = pickSorteRevesCard(createBotRng(bytes))
    const resolved = resolveSorteRevesCard(card, player || {})
    const payload = resolved?.payload || null
    if (payload && payload.action === 'APPLY_CARD') {
      return { ok: true, source: 'seed', payload, reason: null }
    }
  }
  return {
    ok: false,
    source: 'fail-safe',
    payload: null,
    reason: 'luck-card-unreconstructable',
  }
}

export function botLuckRecoveryInfo({
  effects,
  seed,
  claimProof,
  matchId,
  turnPlayerId,
  turnSeq,
} = {}) {
  const needsLuck = requiredEffectKinds(effects).includes('LUCK')
  const hasReceipt = !!(effects?.luckPayload && effects.luckPayload.action === 'APPLY_CARD')
  const seedOk = !!resolveBotLuckSeed({ seed, claimProof, matchId, turnPlayerId, turnSeq })
  return {
    needsLuck,
    recoverable: !needsLuck || hasReceipt || seedOk,
    source: hasReceipt ? 'receipt' : (seedOk ? 'seed' : null),
  }
}

function settleRemainingBotEffects(effects) {
  let next = effects
  for (const kind of remainingEffectKinds(next)) {
    next = markBotEffectDone(next, kind)
  }
  return next
}

export function isSameBotTurnEffectsScope(effects, { matchId, turnPlayerId, turnSeq } = {}) {
  if (!effects) return false
  if (String(effects.turnPlayerId ?? '') !== String(turnPlayerId ?? '')) return false
  if (Number(effects.turnSeq) !== (Number(turnSeq) || 0)) return false
  if (matchId && effects.matchId && String(effects.matchId) !== String(matchId)) return false
  return true
}

export function normalizeBotPurchaseKind(kind) {
  const k = String(kind || '').toUpperCase()
  if (k === 'MANAGERS') return 'MANAGER'
  return k
}

export function hasBotEffectActionInRoster(players, actionId, extraLastActions = null) {
  if (hasBotEffectAction(extraLastActions, actionId)) return true
  for (const player of Array.isArray(players) ? players : []) {
    if (hasBotEffectAction(player?.lastActions, actionId)) return true
  }
  return false
}

export function applyBotPassageOrLuck(player, kind, payload = {}, extras = {}) {
  if (!player) return { player, changed: false, skipped: true }
  const k = String(kind || '').toUpperCase()
  if (k === 'REVENUE') {
    const fat = Number(
      extras.revenue ??
      payload.value ??
      payload.revenue ??
      0,
    )
    const next = {
      ...player,
      cash: (Number(player.cash) || 0) + Math.max(0, Math.floor(fat)),
    }
    if (Object.prototype.hasOwnProperty.call(extras, 'loanPending')) {
      next.loanPending = extras.loanPending
    }
    return { player: next, changed: fat !== 0, skipped: false }
  }
  if (k === 'EXPENSES') {
    const expense = Number(extras.expense ?? payload.expense ?? 0)
    const loanCharge = Number(extras.loanCharge ?? payload.loanCharge ?? 0)
    const total = Number(extras.totalCharge ?? payload.total ?? expense + loanCharge)
    const cash = Number(player.cash) || 0
    if (cash < total) {
      return { player, changed: false, skipped: true, unaffordable: true }
    }
    const next = {
      ...player,
      cash: cash - total,
    }
    if (Object.prototype.hasOwnProperty.call(extras, 'loanPending')) {
      next.loanPending = extras.loanPending
    }
    if (extras.lastChargedLoanId != null) {
      next.lastChargedLoanId = extras.lastChargedLoanId
    }
    return { player: next, changed: total !== 0, skipped: false }
  }
  if (k === 'LUCK') {
    const applied = applySorteRevesPayloadToPlayer(player, payload)
    if (!applied.applied) return { player, changed: false, skipped: true }
    return { player: applied.player, changed: true, skipped: false }
  }
  return { player, changed: false, skipped: true }
}

export function applyBotPurchaseIfAffordable(player, kind, payload) {
  const applied = applyBotPurchasePayload(player, normalizeBotPurchaseKind(kind), payload)
  if (applied.skipped) return applied
  if (Number(applied.player?.cash) < 0) {
    return { player, changed: false, skipped: true, unaffordable: true }
  }
  return applied
}

export function shouldResumeLeftoverBotEffects({
  players,
  matchId,
  turnPlayerId,
  turnSeq,
  myUid,
  lockOwner,
  gameOver = false,
  currentPlayer,
  executorId = null,
  remoteExecutorId = null,
  claimProof = null,
} = {}) {
  const actor =
    currentPlayer ||
    (Array.isArray(players) ? players.find((p) => String(p?.id) === String(turnPlayerId ?? '')) : null)
  const auth = shouldRunBotEconomicEffects({
    currentPlayer: actor,
    turnPlayerId,
    myUid,
    lockOwner,
    gameOver,
    executorId,
    remoteExecutorId,
    claimProof,
    matchId,
    turnSeq,
  })
  if (!auth.ok) {
    return {
      ok: false,
      reason: auth.reason,
      retry: auth.retry === true,
      terminal: auth.terminal === true,
      remaining: [],
      effects: null,
    }
  }
  const read = readBotTurnEffects({ players, matchId, turnPlayerId, turnSeq })
  if (!read.ok) return { ok: false, reason: 'no-effects-receipt', remaining: [], effects: null }
  if (isBotTurnEffectsSettled(read.effects)) {
    return { ok: false, reason: 'already-settled', remaining: [], effects: read.effects }
  }
  const remaining = remainingEffectKinds(read.effects)
  return {
    ok: remaining.length > 0,
    reason: remaining.length ? 'resume-leftover' : 'already-settled',
    remaining,
    effects: read.effects,
  }
}

function liveActor(live, turnPlayerId) {
  return (
    live?.currentPlayer ||
    (Array.isArray(live?.players)
      ? live.players.find((p) => String(p?.id) === String(turnPlayerId ?? ''))
      : null)
  )
}

function liveEconomicAuth(live, turnPlayerId, myUid, extra = {}) {
  return shouldRunBotEconomicEffects({
    currentPlayer: liveActor(live, turnPlayerId),
    turnPlayerId: live?.turnPlayerId ?? turnPlayerId,
    myUid,
    lockOwner: live?.remoteLockOwner ?? live?.lockOwner,
    gameOver: live?.gameOver === true,
    executorId: live?.executorId ?? live?.claimProof?.executorId,
    remoteExecutorId: live?.remoteExecutorId ?? live?.botClaimExecutor,
    claimProof: live?.claimProof ?? null,
    matchId: live?.matchId ?? extra.matchId,
    turnSeq: live?.turnSeq ?? extra.turnSeq,
  })
}

async function processLuckEffect({
  matchId,
  turnPlayerId,
  turnSeq,
  player,
  effects,
  live,
  decide,
  commit,
  getLive,
}) {
  let commits = 0
  let decisions = 0
  let nextEffects = { ...effects }
  const drawId = buildBotEffectActionId({
    matchId,
    playerId: turnPlayerId,
    turnSeq,
    effectKind: 'LUCK:draw',
  })

  let payload = nextEffects.luckPayload
  if (!payload || payload.action !== 'APPLY_CARD') {
    const reconstructed = reconstructBotLuckPayload({
      luckPayload: nextEffects.luckPayload,
      seed: live.botTurnSeed,
      player,
      matchId,
      turnPlayerId,
      turnSeq,
      claimProof: live.claimProof,
    })
    if (reconstructed.ok) {
      payload = reconstructed.payload
      if (!hasBotEffectActionInRoster(live.players, drawId, live.lastActions)) {
        nextEffects = {
          ...nextEffects,
          luckCardId: payload.id != null ? String(payload.id) : null,
          luckPayload: payload,
        }
        const drawCommit = await commit({
          before: player,
          after: { ...player, botTurnEffects: nextEffects },
          actionId: drawId,
          effects: nextEffects,
          skipped: true,
        })
        if (!drawCommit?.ok && !drawCommit?.alreadyApplied) {
          return { ok: false, reason: drawCommit?.reason || 'commit-failed', commits, decisions, effects: nextEffects }
        }
        if (!drawCommit?.alreadyApplied) commits += 1
      }
    } else if (!hasBotEffectActionInRoster(live.players, drawId, live.lastActions)) {
      payload = await decide({ kind: 'LUCK', player, effects: nextEffects })
      decisions += 1
      if (!payload || payload.action !== 'APPLY_CARD') {
        if (!payload && !nextEffects.luckCardId && !live.botTurnSeed) {
          return { ok: false, reason: 'luck-card-unreconstructable', commits, decisions, effects: nextEffects }
        }
        nextEffects = markBotEffectDone(nextEffects, 'LUCK')
        const after = { ...player, botTurnEffects: nextEffects }
        const committed = await commit({
          before: player,
          after,
          actionId: drawId,
          effects: nextEffects,
          skipped: true,
        })
        if (!committed?.ok && !committed?.alreadyApplied) {
          return { ok: false, reason: committed?.reason || 'commit-failed', commits, decisions, effects: nextEffects }
        }
        if (!committed?.alreadyApplied) commits += 1
        return { ok: true, commits, decisions, effects: nextEffects }
      }
      nextEffects = {
        ...nextEffects,
        luckCardId: payload.id != null ? String(payload.id) : null,
        luckPayload: payload,
      }
      const drawCommit = await commit({
        before: player,
        after: { ...player, botTurnEffects: nextEffects },
        actionId: drawId,
        effects: nextEffects,
        skipped: true,
      })
      if (!drawCommit?.ok && !drawCommit?.alreadyApplied) {
        return { ok: false, reason: drawCommit?.reason || 'commit-failed', commits, decisions, effects: nextEffects }
      }
      if (!drawCommit?.alreadyApplied) commits += 1
    } else {
      return { ok: false, reason: 'luck-card-unreconstructable', commits, decisions, effects: nextEffects }
    }
  }

  const cashDelta = Number.isFinite(payload.cashDelta) ? Number(payload.cashDelta) : 0
  let current = player
  if (cashDelta < 0) {
    const charge = await settleBotMandatoryCharge({
      player: current,
      effects: nextEffects,
      kind: 'LUCK:cash',
      requiredAmount: Math.abs(cashDelta),
      matchId,
      turnPlayerId,
      turnSeq,
      decide,
      commit,
      getLive,
      round: live.round || 1,
      deferParentDone: true,
    })
    commits += charge.commits
    decisions += charge.decisions
    nextEffects = charge.effects
    current = charge.player
    if (!charge.ok) return { ok: false, reason: charge.reason, commits, decisions, effects: nextEffects }
    if (charge.bankrupt) {
      nextEffects = markBotEffectDone(nextEffects, 'LUCK', { luckCardId: payload.id, luckPayload: payload })
      return { ok: true, commits, decisions, effects: nextEffects, bankrupt: true }
    }
    const applied = applySorteRevesPayloadToPlayer(current, payload, { skipNegativeCash: true })
    if (applied.applied && applied.player !== current) {
      const applyId = buildBotEffectActionId({
        matchId,
        playerId: turnPlayerId,
        turnSeq,
        effectKind: 'LUCK:apply',
      })
      if (!hasBotEffectActionInRoster(
        (typeof getLive === 'function' ? getLive()?.players : null) || live.players,
        applyId,
        live.lastActions,
      )) {
        nextEffects = markBotEffectDone(nextEffects, 'LUCK', { luckCardId: payload.id, luckPayload: payload })
        const applyCommit = await commit({
          before: current,
          after: { ...applied.player, botTurnEffects: nextEffects },
          actionId: applyId,
          effects: nextEffects,
        })
        if (!applyCommit?.ok && !applyCommit?.alreadyApplied) {
          return { ok: false, reason: applyCommit?.reason || 'commit-failed', commits, decisions, effects: nextEffects }
        }
        if (!applyCommit?.alreadyApplied) commits += 1
      } else {
        nextEffects = markBotEffectDone(nextEffects, 'LUCK')
      }
    }
    return { ok: true, commits, decisions, effects: nextEffects }
  }

  const applyId = buildBotEffectActionId({
    matchId,
    playerId: turnPlayerId,
    turnSeq,
    effectKind: 'LUCK',
  })
  if (hasBotEffectActionInRoster(live.players, applyId, live.lastActions)) {
    nextEffects = markBotEffectDone(nextEffects, 'LUCK', { luckCardId: payload.id, luckPayload: payload })
    return { ok: true, commits, decisions, effects: nextEffects }
  }
  const applied = applySorteRevesPayloadToPlayer(current, payload)
  nextEffects = markBotEffectDone(nextEffects, 'LUCK', { luckCardId: payload.id, luckPayload: payload })
  const applyCommit = await commit({
    before: current,
    after: { ...applied.player, botTurnEffects: nextEffects },
    actionId: applyId,
    effects: nextEffects,
    skipped: !applied.applied,
  })
  if (!applyCommit?.ok && !applyCommit?.alreadyApplied) {
    return { ok: false, reason: applyCommit?.reason || 'commit-failed', commits, decisions, effects: nextEffects }
  }
  if (!applyCommit?.alreadyApplied) commits += 1
  return { ok: true, commits, decisions, effects: nextEffects }
}

async function persistReceiptIfNeeded({
  commit,
  player,
  effects,
  actionId,
  alreadyApplied,
}) {
  if (alreadyApplied && typeof commit === 'function') {
    const after = { ...player, botTurnEffects: effects }
    const result = await commit({
      before: player,
      after,
      actionId,
      effects,
      skipped: true,
      alreadyApplied: true,
    })
    return result || { ok: true, alreadyApplied: true }
  }
  return { ok: true, alreadyApplied: true }
}

async function processDirectBuyEffect({
  matchId,
  turnPlayerId,
  turnSeq,
  player,
  effects,
  live,
  decide,
  commit,
}) {
  let commits = 0
  let decisions = 0
  let nextEffects = { ...effects }
  const openActionId = buildBotEffectActionId({
    matchId,
    playerId: turnPlayerId,
    turnSeq,
    effectKind: 'DIRECT_BUY',
  })
  const openAlready = hasBotEffectActionInRoster(live.players, openActionId, live.lastActions)
  let openType = nextEffects.directBuyOpen ? String(nextEffects.directBuyOpen).toUpperCase() : null

  if (!openAlready && !openType) {
    const openPayload = await decide({ kind: 'DIRECT_BUY', player, effects: nextEffects })
    decisions += 1
    if (!openPayload || openPayload.action === 'SKIP' || openPayload.action === 'BACK') {
      nextEffects = markBotEffectDone(nextEffects, 'DIRECT_BUY', { directBuyOpen: 'SKIP' })
      const after = { ...player, botTurnEffects: nextEffects }
      const committed = await commit({
        before: player,
        after,
        actionId: openActionId,
        effects: nextEffects,
        skipped: true,
      })
      if (!committed?.ok && !committed?.alreadyApplied) {
        return { ok: false, reason: committed?.reason || 'commit-failed', commits, decisions, effects: nextEffects }
      }
      if (!committed?.alreadyApplied) commits += 1
      return { ok: true, commits, decisions, effects: nextEffects }
    }
    openType = String(openPayload.open || '').toUpperCase()
    if (!openType) {
      nextEffects = markBotEffectDone(nextEffects, 'DIRECT_BUY', { directBuyOpen: 'SKIP' })
      const after = { ...player, botTurnEffects: nextEffects }
      const committed = await commit({
        before: player,
        after,
        actionId: openActionId,
        effects: nextEffects,
        skipped: true,
      })
      if (!committed?.ok && !committed?.alreadyApplied) {
        return { ok: false, reason: committed?.reason || 'commit-failed', commits, decisions, effects: nextEffects }
      }
      if (!committed?.alreadyApplied) commits += 1
      return { ok: true, commits, decisions, effects: nextEffects }
    }
    nextEffects = { ...nextEffects, directBuyOpen: openType }
    const afterOpen = { ...player, botTurnEffects: nextEffects }
    const openCommit = await commit({
      before: player,
      after: afterOpen,
      actionId: openActionId,
      effects: nextEffects,
      skipped: true,
      phase: 'DIRECT_BUY_OPEN',
    })
    if (!openCommit?.ok && !openCommit?.alreadyApplied) {
      return { ok: false, reason: openCommit?.reason || 'commit-failed', commits, decisions, effects: nextEffects }
    }
    if (!openCommit?.alreadyApplied) commits += 1
  }

  const buyKind = normalizeBotPurchaseKind(openType)
  const buyActionId = buildBotEffectActionId({
    matchId,
    playerId: turnPlayerId,
    turnSeq,
    effectKind: `DIRECT_BUY:${buyKind}`,
  })
  if (hasBotEffectActionInRoster(live.players, buyActionId, live.lastActions)) {
    nextEffects = markBotEffectDone(nextEffects, 'DIRECT_BUY', { directBuyOpen: buyKind })
    await persistReceiptIfNeeded({
      commit,
      player,
      effects: nextEffects,
      actionId: buyActionId,
      alreadyApplied: true,
    })
    return { ok: true, commits, decisions, effects: nextEffects }
  }

  const buyPayload = await decide({ kind: buyKind, player, effects: nextEffects, phase: 'DIRECT_BUY_TYPE' })
  decisions += 1
  const applied = applyBotPurchaseIfAffordable(player, buyKind, buyPayload)
  nextEffects = markBotEffectDone(nextEffects, 'DIRECT_BUY', { directBuyOpen: buyKind })
  const after = { ...applied.player, botTurnEffects: nextEffects }
  const buyCommit = await commit({
    before: player,
    after,
    actionId: buyActionId,
    effects: nextEffects,
    skipped: applied.skipped === true,
  })
  if (!buyCommit?.ok && !buyCommit?.alreadyApplied) {
    return { ok: false, reason: buyCommit?.reason || 'commit-failed', commits, decisions, effects: nextEffects }
  }
  if (!buyCommit?.alreadyApplied) commits += 1
  return { ok: true, commits, decisions, effects: nextEffects }
}

/**
 * Um ponto de entrada: percorre remaining kinds, decide, aplica builders,
 * commita valores absolutos e só então marca settled.
 */
export async function runBotEconomicEffectsLoop({
  matchId,
  turnPlayerId,
  turnSeq,
  myUid,
  getLive,
  decide: rawDecide,
  commit: rawCommit,
  shouldContinue,
  sleep = defaultEcoSleep,
} = {}) {
  let commits = 0
  let decisions = 0
  const logCtx = { matchId, turnPlayerId, turnSeq }
  if (typeof getLive !== 'function' || typeof rawDecide !== 'function' || typeof rawCommit !== 'function') {
    return { ok: false, reason: 'missing-deps', commits, decisions, effects: null }
  }

  const decide = async (args) => {
    const payload = await rawDecide(args)
    logBotEco('DECISION', {
      ...logCtx,
      effectKind: args?.kind ?? null,
      action: payload?.action ?? payload?.type ?? (payload === true ? 'BANKRUPT' : null),
    })
    return payload
  }

  const continueOrStop = () => {
    if (typeof shouldContinue !== 'function') return { ok: true }
    return shouldContinue() || { ok: true }
  }

  const commit = async (args) => retryBotEffectCommit({
    commit: rawCommit,
    args,
    getLive,
    shouldContinue: continueOrStop,
    sleep,
    logCtx: { ...logCtx, effectKind: args?.effects ? remainingEffectKinds(args.effects)[0] : null },
  })

  logBotEco('START', { ...logCtx, ...liveLog(getLive() || {}) })

  let live0 = getLive() || {}
  let auth0 = liveEconomicAuth(live0, turnPlayerId, myUid, { matchId, turnSeq })
  logBotEco('GATE', { ...logCtx, ok: auth0.ok, reason: auth0.reason, ...liveLog(live0) })
  let gateBackoff = BOT_EFFECT_RETRY_MS
  let gateAttempts = 0
  while (!auth0.ok && isTransientBotEconomicGate(auth0) && gateAttempts < BOT_EFFECT_MAX_ATTEMPTS) {
    gateAttempts += 1
    const cont = continueOrStop()
    if (!cont.ok) {
      logBotEco('FINALLY', { ...logCtx, ok: false, reason: cont.reason, settled: false })
      return { ok: false, reason: cont.reason || 'cancelled', commits, decisions, effects: null }
    }
    logBotEco('RETRY', { ...logCtx, reason: auth0.reason, ...liveLog(live0) })
    if (typeof sleep === 'function') await sleep(gateBackoff)
    gateBackoff = Math.min(BOT_EFFECT_MAX_BACKOFF_MS, Math.floor(gateBackoff * 1.25) + BOT_EFFECT_RETRY_MS)
    live0 = getLive() || {}
    auth0 = liveEconomicAuth(live0, turnPlayerId, myUid, { matchId, turnSeq })
    logBotEco('GATE', { ...logCtx, ok: auth0.ok, reason: auth0.reason, ...liveLog(live0) })
  }
  if (!auth0.ok) {
    logBotEco('FINALLY', { ...logCtx, ok: false, reason: auth0.reason, settled: false })
    return { ok: false, reason: auth0.reason, commits, decisions, effects: null }
  }

  const read0 = readBotTurnEffects({
    players: live0.players,
    matchId,
    turnPlayerId,
    turnSeq,
  })
  if (!read0.ok) return { ok: false, reason: 'no-effects-receipt', commits, decisions, effects: null }
  if (isBotTurnEffectsSettled(read0.effects)) {
    logBotEco('SETTLED', { ...logCtx, ok: true, reason: 'already-settled', settled: true })
    logBotEco('FINALLY', { ...logCtx, ok: true, reason: 'already-settled', settled: true })
    return { ok: true, reason: 'already-settled', commits, decisions, effects: read0.effects }
  }

  let effects = { ...read0.effects }
  const remaining = remainingEffectKinds(effects)

  for (const kind of remaining) {
    const cont = continueOrStop()
    if (!cont.ok) return { ok: false, reason: cont.reason || 'cancelled', commits, decisions, effects }

    const live = getLive() || {}
    if ((Number(live.turnSeq) || 0) !== (Number(turnSeq) || 0)) {
      return { ok: false, reason: 'turn-seq-changed', commits, decisions, effects }
    }
    if (String(live.turnPlayerId ?? turnPlayerId) !== String(turnPlayerId)) {
      return { ok: false, reason: 'turn-player-changed', commits, decisions, effects }
    }
    const actor = liveActor(live, turnPlayerId)
    const auth = liveEconomicAuth(live, turnPlayerId, myUid, { matchId, turnSeq })
    if (!auth.ok) return { ok: false, reason: auth.reason, commits, decisions, effects }

    const player = actor
    if (!player) return { ok: false, reason: 'no-actor', commits, decisions, effects }

    if (kind === 'LUCK') {
      const luck = await processLuckEffect({
        matchId,
        turnPlayerId,
        turnSeq,
        player,
        effects,
        live,
        decide,
        commit,
        getLive,
      })
      commits += luck.commits
      decisions += luck.decisions
      effects = luck.effects
      if (!luck.ok) return { ok: false, reason: luck.reason, commits, decisions, effects }
      if (luck.bankrupt) {
        effects = settleRemainingBotEffects(effects)
        return { ok: true, reason: 'bankrupt', bankrupt: true, commits, decisions, effects }
      }
      continue
    }

    if (kind === 'EXPENSES') {
      const extras = typeof live.extrasFor === 'function' ? live.extrasFor('EXPENSES', player) || {} : {}
      await decide({
        kind: 'EXPENSES',
        player,
        effects,
        extras,
      })
      decisions += 1
      const need = Number(extras.totalCharge ?? extras.expense ?? 0)
      let working = { ...player }
      if (Object.prototype.hasOwnProperty.call(extras, 'loanPending')) {
        working.loanPending = extras.loanPending
      }
      if (extras.lastChargedLoanId != null) {
        working.lastChargedLoanId = extras.lastChargedLoanId
      }
      const charge = await settleBotMandatoryCharge({
        player: working,
        effects,
        kind: 'EXPENSES',
        requiredAmount: need,
        matchId,
        turnPlayerId,
        turnSeq,
        decide,
        commit,
        getLive,
        round: live.round || 1,
      })
      commits += charge.commits
      decisions += charge.decisions
      effects = charge.effects
      if (!charge.ok) return { ok: false, reason: charge.reason, commits, decisions, effects }
      if (charge.bankrupt) {
        effects = settleRemainingBotEffects(effects)
        return { ok: true, reason: 'bankrupt', bankrupt: true, commits, decisions, effects }
      }
      continue
    }

    if (kind === 'DIRECT_BUY') {
      const direct = await processDirectBuyEffect({
        matchId,
        turnPlayerId,
        turnSeq,
        player,
        effects,
        live,
        decide,
        commit,
      })
      commits += direct.commits
      decisions += direct.decisions
      effects = direct.effects
      if (!direct.ok) return { ok: false, reason: direct.reason, commits, decisions, effects }
      continue
    }

    const actionId = buildBotEffectActionId({
      matchId,
      playerId: turnPlayerId,
      turnSeq,
      effectKind: kind,
    })
    const already = hasBotEffectActionInRoster(live.players, actionId, live.lastActions)
      || isKindAlreadyProcessed(effects, player.lastActions, actionId, kind)

    if (already) {
      effects = markBotEffectDone(effects, kind)
      await persistReceiptIfNeeded({
        commit,
        player,
        effects,
        actionId,
        alreadyApplied: true,
      })
      continue
    }

    const payload = await decide({
      kind,
      player,
      effects,
      extras: typeof live.extrasFor === 'function' ? live.extrasFor(kind, player) : {},
    })
    decisions += 1

    let applied
    if (kind === 'REVENUE' || kind === 'EXPENSES' || kind === 'LUCK') {
      const extras = typeof live.extrasFor === 'function' ? live.extrasFor(kind, player) || {} : {}
      applied = applyBotPassageOrLuck(player, kind, payload, extras)
    } else {
      applied = applyBotPurchaseIfAffordable(player, kind, payload)
    }
    effects = markBotEffectDone(effects, kind)
    const after = { ...applied.player, botTurnEffects: effects }
    const committed = await commit({
      before: player,
      after,
      actionId,
      effects,
      skipped: applied.skipped === true,
    })
    if (!committed?.ok && !committed?.alreadyApplied) {
      return { ok: false, reason: committed?.reason || 'commit-failed', commits, decisions, effects }
    }
    if (!committed?.alreadyApplied) commits += 1
  }

  const settledNow = isBotTurnEffectsSettled(effects)
  logBotEco('SETTLED', { ...logCtx, ok: true, reason: settledNow ? 'effects-settled' : 'partial', settled: settledNow })
  logBotEco('FINALLY', { ...logCtx, ok: true, reason: settledNow ? 'effects-settled' : 'partial', settled: settledNow })
  return {
    ok: true,
    reason: settledNow ? 'effects-settled' : 'partial',
    commits,
    decisions,
    effects,
  }
}

/**
 * Store autoritativo em memória — usado pelos testes e pelo mesmo contrato de CAS.
 * Retry com o mesmo actionId não reaplica delta relativo.
 */
export function createAuthoritativeEconomicStore({
  matchId,
  turnPlayerId,
  turnSeq,
  lockOwner,
  players,
  botClaimExecutor = null,
  botTurnSeed = null,
} = {}) {
  const state = {
    matchId: matchId != null ? String(matchId) : '',
    turnPlayerId: turnPlayerId != null ? String(turnPlayerId) : '',
    turnSeq: Number(turnSeq) || 0,
    lockOwner: lockOwner != null ? String(lockOwner) : '',
    botClaimExecutor: botClaimExecutor != null ? String(botClaimExecutor) : '',
    botTurnSeed,
    gameOver: false,
    players: (Array.isArray(players) ? players : []).map((p) => ({
      ...p,
      lastActions: p.lastActions ? { ...p.lastActions } : {},
    })),
    commits: 0,
    appliedActionIds: [],
  }

  function findPlayer(id) {
    return state.players.find((p) => String(p?.id) === String(id))
  }

  function commit({ before, after, actionId, effects, executorId } = {}) {
    if (state.gameOver) return { ok: false, reason: 'game-over' }
    if ((Number(state.turnSeq) || 0) !== (Number(turnSeq) || 0)) {
      return { ok: false, reason: 'stale-turn-seq' }
    }
    if (String(state.turnPlayerId) !== String(turnPlayerId)) {
      return { ok: false, reason: 'stale-turn-player' }
    }
    if (
      executorId != null &&
      state.botClaimExecutor &&
      String(executorId) !== String(state.botClaimExecutor)
    ) {
      return { ok: false, reason: 'executor-mismatch' }
    }
    const id = String(before?.id ?? after?.id ?? turnPlayerId)
    const current = findPlayer(id)
    if (!current) return { ok: false, reason: 'no-player' }
    if (actionId && current.lastActions && current.lastActions[actionId]) {
      if (effects) {
        current.botTurnEffects = effects
      }
      return { ok: true, alreadyApplied: true, reason: 'idempotent' }
    }
    const delta = buildBotEconomicPlayerDelta(current, after, actionId)
    for (const [key, value] of Object.entries(delta)) {
      if (key === '_actionId') continue
      current[key] = value
    }
    if (effects) current.botTurnEffects = effects
    if (actionId) {
      current.lastActions = { ...(current.lastActions || {}), [actionId]: Date.now() }
      state.appliedActionIds.push(actionId)
    }
    state.commits += 1
    return { ok: true, alreadyApplied: false, delta }
  }

  return {
    state,
    commit,
    getLive() {
      return {
        players: state.players,
        lastActions: findPlayer(turnPlayerId)?.lastActions || {},
        lockOwner: state.lockOwner,
        remoteLockOwner: state.lockOwner,
        turnPlayerId: state.turnPlayerId,
        turnSeq: state.turnSeq,
        matchId: state.matchId,
        gameOver: state.gameOver,
        currentPlayer: findPlayer(turnPlayerId),
        botClaimExecutor: state.botClaimExecutor,
        remoteExecutorId: state.botClaimExecutor,
        botTurnSeed: state.botTurnSeed,
      }
    },
    advanceTurnSeq() {
      state.turnSeq = (Number(state.turnSeq) || 0) + 1
    },
    setLockOwner(next) {
      state.lockOwner = next != null ? String(next) : ''
    },
    setBotClaimExecutor(next) {
      state.botClaimExecutor = next != null ? String(next) : ''
    },
  }
}
