/**
 * Cobrança obrigatória da Máquina: reutiliza recovery/falência já existentes.
 * Não marca o efeito-pai como done até pagar ou falir.
 */
import { applyBankruptcyState } from '../matchForfeit.js'
import { applyRecoveryPayloadToPlayer } from './botRecoveryApply.js'
import { interpretInsufficientFundsDecision } from './botModalRecognition.js'
import { MAX_RECOVERY_STEPS } from './botDecisionProvider.js'

function buildChargeActionId({ matchId, playerId, turnSeq, effectKind } = {}) {
  return [
    'bot-effect',
    String(matchId ?? ''),
    String(playerId ?? ''),
    String(Number(turnSeq) || 0),
    String(effectKind || '').trim(),
  ].join(':')
}

function hasChargeAction(players, actionId, extraLastActions = null) {
  if (!actionId) return false
  if (extraLastActions && Object.prototype.hasOwnProperty.call(extraLastActions, String(actionId))) {
    return true
  }
  for (const player of Array.isArray(players) ? players : []) {
    if (player?.lastActions && Object.prototype.hasOwnProperty.call(player.lastActions, String(actionId))) {
      return true
    }
  }
  return false
}

function markChargeDone(effects, kind, extra = {}) {
  const base = effects && typeof effects === 'object' ? { ...effects } : {}
  const done = Array.isArray(base.done) ? [...base.done] : []
  const k = String(kind || '')
  if (k && !done.includes(k)) done.push(k)
  const required = []
  if (base.crossedStart === true) required.push('REVENUE')
  if (base.crossedExpenses === true) required.push('EXPENSES')
  if (base.processLandTile === true && String(base.landTile || '').toUpperCase() === 'LUCK') {
    required.push('LUCK')
  }
  const land = String(base.landTile || '').toUpperCase()
  const purchases = ['CLIENTS', 'COMMON', 'FIELD', 'INSIDE', 'MANAGER', 'ERP', 'MIX', 'TRAINING', 'DIRECT_BUY']
  if (base.processLandTile === true && purchases.includes(land)) required.push(land)
  const next = { ...base, ...extra, done }
  next.settled = required.length === 0 || required.every((x) => next.done.includes(x))
  return next
}

export function applyMandatoryCashCharge(player, amount) {
  const need = Math.max(0, Number(amount) || 0)
  return {
    ...player,
    cash: Math.max(0, (Number(player.cash) || 0) - need),
    pos: player.pos,
  }
}

function recoveryActionId(matchId, turnPlayerId, turnSeq, kind, step) {
  return buildChargeActionId({
    matchId,
    playerId: turnPlayerId,
    turnSeq,
    effectKind: `${kind}:r${step}`,
  })
}

function bankruptActionId(matchId, turnPlayerId, turnSeq, kind) {
  return buildChargeActionId({
    matchId,
    playerId: turnPlayerId,
    turnSeq,
    effectKind: `${kind}:BANKRUPT`,
  })
}

async function commitStep({ commit, player, after, actionId, effects }) {
  const result = await commit({
    before: player,
    after: { ...after, botTurnEffects: effects },
    actionId,
    effects,
  })
  if (!result?.ok && !result?.alreadyApplied) {
    return { ok: false, reason: result?.reason || 'commit-failed', result }
  }
  return { ok: true, alreadyApplied: result?.alreadyApplied === true, result }
}

/**
 * Paga `requiredAmount` com as mesmas consequências do handleInsufficientFunds:
 * ACK se já tem caixa; senão RECOVERY (LOAN/FIRE/REDUCE) ou BANKRUPT.
 */
export async function settleBotMandatoryCharge({
  player,
  effects,
  kind,
  requiredAmount,
  matchId,
  turnPlayerId,
  turnSeq,
  decide,
  commit,
  getLive,
  round = 1,
  deferParentDone = false,
} = {}) {
  const need = Math.max(0, Number(requiredAmount) || 0)
  const chargeId = buildChargeActionId({
    matchId,
    playerId: turnPlayerId,
    turnSeq,
    effectKind: kind,
  })
  let commits = 0
  let decisions = 0
  let nextEffects = {
    ...(effects || {}),
    recoveryNeed: need,
    recoveryKind: kind,
  }
  let current = player

  const liveActions = () => {
    const live = typeof getLive === 'function' ? getLive() || {} : {}
    return { players: live.players, lastActions: live.lastActions }
  }

  const already = (actionId) => {
    const live = liveActions()
    return hasChargeAction(live.players, actionId, live.lastActions)
  }

  const finishParent = (fx, extra) => (
    deferParentDone ? { ...fx, ...extra } : markChargeDone(fx, kind, extra)
  )

  if (already(chargeId)) {
    nextEffects = finishParent(nextEffects, {
      recoveryResolved: nextEffects.recoveryResolved || 'PAID',
      recoveryNeed: null,
    })
    return { ok: true, commits, decisions, effects: nextEffects, player: current, paid: true }
  }

  let step = Number(nextEffects.recoveryStep) || 0

  while ((Number(current.cash) || 0) < need) {
    if (already(chargeId)) break
    if (step >= MAX_RECOVERY_STEPS) {
      const bid = bankruptActionId(matchId, turnPlayerId, turnSeq, kind)
      if (!already(bid)) {
        nextEffects = markChargeDone(nextEffects, kind, {
          recoveryResolved: 'BANKRUPT',
          recoveryNeed: null,
        })
        const after = applyBankruptcyState(current)
        const committed = await commitStep({
          commit,
          player: current,
          after,
          actionId: bid,
          effects: nextEffects,
        })
        if (!committed.ok) {
          return { ok: false, reason: committed.reason, commits, decisions, effects: nextEffects }
        }
        if (!committed.alreadyApplied) commits += 1
        current = after
      } else {
        nextEffects = markChargeDone(nextEffects, kind, { recoveryResolved: 'BANKRUPT', recoveryNeed: null })
      }
      return {
        ok: true,
        commits,
        decisions,
        effects: nextEffects,
        player: current,
        bankrupt: true,
      }
    }

    const stepId = recoveryActionId(matchId, turnPlayerId, turnSeq, kind, step)
    if (already(stepId)) {
      const live = typeof getLive === 'function' ? getLive() || {} : {}
      current = live.currentPlayer || current
      nextEffects = live.currentPlayer?.botTurnEffects || nextEffects
      step += 1
      nextEffects = { ...nextEffects, recoveryStep: step }
      continue
    }

    const fundsPayload = await decide({
      kind: 'INSUFFICIENT_FUNDS',
      player: current,
      extras: { requiredAmount: need, currentCash: Number(current.cash) || 0 },
    })
    decisions += 1
    const read = interpretInsufficientFundsDecision(fundsPayload)

    if (read.action === 'ACK') {
      if ((Number(current.cash) || 0) < need) {
        return { ok: false, reason: 'ack-without-funds', commits, decisions, effects: nextEffects }
      }
      break
    }

    if (read.action === 'BANKRUPT' || fundsPayload?.type === 'TRIGGER_BANKRUPTCY') {
      const confirm = await decide({ kind: 'BANKRUPT', player: current })
      decisions += 1
      if (confirm !== true && confirm?.action !== 'BANKRUPT') {
        return { ok: false, reason: 'bankruptcy-unconfirmed', commits, decisions, effects: nextEffects }
      }
      const bid = bankruptActionId(matchId, turnPlayerId, turnSeq, kind)
      nextEffects = markChargeDone(nextEffects, kind, {
        recoveryResolved: 'BANKRUPT',
        recoveryNeed: null,
      })
      const after = applyBankruptcyState(current)
      const committed = await commitStep({
        commit,
        player: current,
        after,
        actionId: bid,
        effects: nextEffects,
      })
      if (!committed.ok) {
        return { ok: false, reason: committed.reason, commits, decisions, effects: nextEffects }
      }
      if (!committed.alreadyApplied) commits += 1
      return {
        ok: true,
        commits,
        decisions,
        effects: nextEffects,
        player: after,
        bankrupt: true,
      }
    }

    if (read.action !== 'RECOVERY') {
      return { ok: false, reason: 'recovery-unresolved', commits, decisions, effects: nextEffects }
    }

    const recoveryPayload = await decide({
      kind: 'RECOVERY',
      player: current,
      extras: { requiredAmount: need, recoveryStep: step, currentCash: Number(current.cash) || 0 },
    })
    decisions += 1

    if (!recoveryPayload || recoveryPayload.type === 'TRIGGER_BANKRUPTCY') {
      const confirm = await decide({ kind: 'BANKRUPT', player: current })
      decisions += 1
      if (confirm !== true && confirm?.action !== 'BANKRUPT') {
        return { ok: false, reason: 'bankruptcy-unconfirmed', commits, decisions, effects: nextEffects }
      }
      const bid = bankruptActionId(matchId, turnPlayerId, turnSeq, kind)
      nextEffects = markChargeDone(nextEffects, kind, {
        recoveryResolved: 'BANKRUPT',
        recoveryNeed: null,
      })
      const after = applyBankruptcyState(current)
      const committed = await commitStep({
        commit,
        player: current,
        after,
        actionId: bid,
        effects: nextEffects,
      })
      if (!committed.ok) {
        return { ok: false, reason: committed.reason, commits, decisions, effects: nextEffects }
      }
      if (!committed.alreadyApplied) commits += 1
      return {
        ok: true,
        commits,
        decisions,
        effects: nextEffects,
        player: after,
        bankrupt: true,
      }
    }

    const applied = applyRecoveryPayloadToPlayer(current, recoveryPayload, { round })
    if (!applied.applied) {
      if (recoveryPayload.type === 'LOAN' && applied.reason === 'loan-unavailable') {
        const confirm = await decide({
          kind: 'INSUFFICIENT_FUNDS',
          player: current,
          extras: {
            requiredAmount: need,
            currentCash: Number(current.cash) || 0,
            canClose: false,
            showRecoveryOptions: false,
          },
        })
        decisions += 1
        if (confirm?.action !== 'BANKRUPT') {
          return { ok: false, reason: 'loan-unavailable', commits, decisions, effects: nextEffects }
        }
        const bid = bankruptActionId(matchId, turnPlayerId, turnSeq, kind)
        nextEffects = markChargeDone(nextEffects, kind, {
          recoveryResolved: 'BANKRUPT',
          recoveryNeed: null,
        })
        const after = applyBankruptcyState(current)
        const committed = await commitStep({
          commit,
          player: current,
          after,
          actionId: bid,
          effects: nextEffects,
        })
        if (!committed.ok) {
          return { ok: false, reason: committed.reason, commits, decisions, effects: nextEffects }
        }
        if (!committed.alreadyApplied) commits += 1
        return {
          ok: true,
          commits,
          decisions,
          effects: nextEffects,
          player: after,
          bankrupt: true,
        }
      }
      return { ok: false, reason: applied.reason || 'recovery-not-applied', commits, decisions, effects: nextEffects }
    }

    nextEffects = {
      ...nextEffects,
      recoveryStep: step + 1,
      lastRecoveryType: applied.type,
    }
    const committed = await commitStep({
      commit,
      player: current,
      after: applied.player,
      actionId: stepId,
      effects: nextEffects,
    })
    if (!committed.ok) {
      return { ok: false, reason: committed.reason, commits, decisions, effects: nextEffects }
    }
    if (!committed.alreadyApplied) commits += 1
    current = applied.player
    step += 1
  }

  if (already(chargeId)) {
    nextEffects = finishParent(nextEffects, { recoveryResolved: 'PAID', recoveryNeed: null })
    return { ok: true, commits, decisions, effects: nextEffects, player: current, paid: true }
  }

  const afterCharge = applyMandatoryCashCharge(current, need)
  nextEffects = finishParent(nextEffects, { recoveryResolved: 'PAID', recoveryNeed: null })
  const committed = await commitStep({
    commit,
    player: current,
    after: afterCharge,
    actionId: chargeId,
    effects: nextEffects,
  })
  if (!committed.ok) {
    return { ok: false, reason: committed.reason, commits, decisions, effects: nextEffects }
  }
  if (!committed.alreadyApplied) commits += 1
  return {
    ok: true,
    commits,
    decisions,
    effects: nextEffects,
    player: afterCharge,
    paid: true,
  }
}
