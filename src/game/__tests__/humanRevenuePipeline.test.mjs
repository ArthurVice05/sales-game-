import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import {
  applyDueHumanRevenuesToRoster,
  buildHumanRevenueActionId,
  buildHumanTurnEffectPlan,
  classifyHumanRevenueLifecycle,
  isHumanRevenueDue,
  listDueHumanRevenues,
  markHumanRevenueDone,
  planCoordinatorRevenueLiquidation,
  planHumanRevenuePersist,
  reconcileHumanRevenueAfterCommit,
  shouldResumeHumanTurnEffects,
} from '../humanRevenueCredit.js'
import {
  applyGamePatchToState,
  applyHumanRevenueCasToState,
  buildPartialPlayerDelta,
  shouldApplyIncomingState,
} from '../playerStateSync.js'
import { validateTurnCommit } from '../turnCommitValidation.js'
import { expirationPayloadForKind } from '../decisionTimeoutPolicy.js'

const NOW = 1_500_000
const MATCH_ID = 'match-human-revenue'
const HUMAN_ID = 'arthur'
const OTHER_ID = 'bot-1'
const OTHER_HUMAN_ID = 'bia'

function revenueEffects(turnSeq = 7, extra = {}) {
  return buildHumanTurnEffectPlan({
    matchId: MATCH_ID,
    turnPlayerId: HUMAN_ID,
    turnSeq,
    fromPos: 37,
    toPos: 2,
    steps: 5,
    crossedStart: true,
    crossedExpenses: false,
    landTile: 'NONE',
    processLandTile: false,
    revenueValue: 770,
    ...extra,
  })
}

function human(extra = {}) {
  return {
    id: HUMAN_ID,
    name: 'Arthur',
    cash: 18_000,
    pos: 2,
    bankrupt: false,
    lastActions: {},
    humanTurnEffects: revenueEffects(),
    ...extra,
  }
}

function other(extra = {}) {
  return {
    id: OTHER_ID,
    name: 'Bot 1',
    cash: 22_000,
    pos: 5,
    bankrupt: false,
    lastActions: {},
    ...extra,
  }
}

function state(extra = {}) {
  return {
    matchId: MATCH_ID,
    turnPlayerId: HUMAN_ID,
    turnSeq: 7,
    turnLock: false,
    lockOwner: null,
    gameOver: false,
    stateVersion: 11,
    stateId: 'state-11',
    players: [human(), other()],
    ...extra,
  }
}

function revenuePatch(turnState, plan) {
  return {
    playersDeltaById: plan.playersDeltaById,
    statePatch: {
      kind: 'PLAYER_DELTA',
      actionId: plan.actionId,
      _commitKind: 'HUMAN_REVENUE',
      _expectMatchId: turnState.matchId,
      _expectTurnPlayerId: turnState.turnPlayerId,
      _expectTurnSeq: turnState.turnSeq,
    },
  }
}

function handoffPatch(turnState) {
  return {
    kind: 'TURN',
    turnPlayerId: OTHER_ID,
    turnSeq: Number(turnState.turnSeq) + 1,
    turnLock: false,
    lockOwner: null,
    _commitKind: 'NORMAL_HANDOFF',
    _expectMatchId: turnState.matchId,
    _expectTurnPlayerId: turnState.turnPlayerId,
    _expectTurnSeq: turnState.turnSeq,
  }
}

function applyCas(prevState, patch, now = NOW) {
  return applyGamePatchToState(prevState, patch, { now })
}

describe('human revenue pipeline', () => {
  it('Attempt TURN with unsettled → reject', () => {
    const prev = state({ players: [human({ humanTurnEffects: revenueEffects(7) }), other()] })
    const patch = handoffPatch(prev)
    const v = validateTurnCommit(prev, patch, { now: NOW })
    assert.equal(v.ok, false)
    assert.equal(v.reason, 'human-revenue-pending')

    const applied = applyCas(prev, { statePatch: patch })
    assert.equal(applied.ok, false)
    assert.equal(applied.reason, 'human-revenue-pending')
  })

  it('movimento persiste plano congelado, modal usa esse valor, updater credita e handoff avança', () => {
    const beforeMove = state({
      players: [human({ cash: 18_000, pos: 37, humanTurnEffects: null }), other()],
    })
    const plan = buildHumanTurnEffectPlan({
      matchId: MATCH_ID,
      turnPlayerId: HUMAN_ID,
      turnSeq: 7,
      fromPos: 37,
      toPos: 2,
      steps: 5,
      crossedStart: true,
      crossedExpenses: true,
      landTile: 'NONE',
      processLandTile: false,
      revenueValue: 770.9,
    })
    const moved = applyCas(beforeMove, {
      playersDeltaById: { [HUMAN_ID]: { pos: 2, humanTurnEffects: plan } },
      statePatch: {
        kind: 'PLAYER_DELTA',
        _commitKind: 'PLAYER_DELTA',
        _expectMatchId: MATCH_ID,
        _expectTurnPlayerId: HUMAN_ID,
        _expectTurnSeq: 7,
      },
    })
    assert.equal(moved.ok, true)
    const afterMove = moved.state.players.find((p) => p.id === HUMAN_ID)
    assert.equal(afterMove.humanTurnEffects.revenueValue, 770)
    assert.equal(afterMove.cash, 18_000)
    const modalValue = afterMove.humanTurnEffects.revenueValue
    const persist = planHumanRevenuePersist({
      matchId: MATCH_ID,
      playerId: HUMAN_ID,
      turnSeq: 7,
      playerBefore: afterMove,
      fat: 50_000,
      roster: moved.state.players,
    })
    assert.equal(persist.fat, modalValue)
    const paid = applyCas(moved.state, revenuePatch(moved.state, persist))
    assert.equal(paid.ok, true)
    const afterPay = paid.state.players.find((p) => p.id === HUMAN_ID)
    assert.equal(afterPay.cash, 18_770)
    assert.deepEqual(afterPay.humanTurnEffects.done, ['REVENUE'])
    assert.ok(afterPay.lastActions[persist.actionId])
    const handoff = applyCas(paid.state, { statePatch: handoffPatch(paid.state) })
    assert.equal(handoff.ok, true)
    assert.equal(handoff.state.turnPlayerId, OTHER_ID)
    assert.equal(handoff.state.turnSeq, 8)
  })

  it('updater CAS aplica crédito sobre saldo vigente, não sobre cash absoluto stale', () => {
    const live = state({ players: [human({ cash: 17_000 }), other()] })
    const stalePlan = planHumanRevenuePersist({
      matchId: MATCH_ID,
      playerId: HUMAN_ID,
      turnSeq: 7,
      playerBefore: human({ cash: 18_000 }),
      fat: 770,
      roster: [human({ cash: 18_000 })],
    })
    assert.equal(stalePlan.playersDeltaById[HUMAN_ID].cash, 18_770)
    const applied = applyHumanRevenueCasToState(live, revenuePatch(live, stalePlan), { now: NOW })
    assert.equal(applied.ok, true)
    assert.equal(applied.state.players.find((p) => p.id === HUMAN_ID).cash, 17_770)
    assert.deepEqual(
      applied.state.players.find((p) => p.id === HUMAN_ID).humanTurnEffects.done,
      ['REVENUE'],
    )
  })

  it('lost ack + retry do mesmo actionId reconcilia pelo autoritativo sem duplicar crédito', () => {
    const prev = state()
    const before = prev.players.find((p) => p.id === HUMAN_ID)
    const plan = planHumanRevenuePersist({
      matchId: MATCH_ID,
      playerId: HUMAN_ID,
      turnSeq: 7,
      playerBefore: before,
      fat: 770,
      roster: prev.players,
    })
    const first = applyCas(prev, revenuePatch(prev, plan))
    assert.equal(first.ok, true)
    assert.equal(first.state.players.find((p) => p.id === HUMAN_ID).cash, 18_770)

    const recon = reconcileHumanRevenueAfterCommit({
      actionId: plan.actionId,
      authoritativePlayer: first.state.players.find((p) => p.id === HUMAN_ID),
    })
    assert.equal(recon.applied, true)

    const retry = applyCas(first.state, revenuePatch(prev, plan), NOW + 1)
    assert.equal(retry.ok, true)
    assert.equal(retry.alreadyApplied, true)
    assert.equal(retry.state.players.find((p) => p.id === HUMAN_ID).cash, 18_770)
  })

  it('CAS conflict retry preserva idempotência e não reaplica o +770', () => {
    const prev = state()
    const before = prev.players.find((p) => p.id === HUMAN_ID)
    const plan = planHumanRevenuePersist({
      matchId: MATCH_ID,
      playerId: HUMAN_ID,
      turnSeq: 7,
      playerBefore: before,
      fat: 770,
      roster: prev.players,
    })
    const remoteAfterSameAction = applyCas(prev, revenuePatch(prev, plan))
    const retried = applyCas(remoteAfterSameAction.state, revenuePatch(prev, plan), NOW + 5)
    assert.equal(retried.ok, true)
    assert.equal(retried.state.players.find((p) => p.id === HUMAN_ID).cash, 18_770)
    assert.equal(
      retried.state.players.find((p) => p.id === HUMAN_ID).lastActions[plan.actionId] > 0,
      true,
    )
  })

  it('debit after paid mantém lifecycle PAID mesmo quando o cash muda depois', () => {
    const prev = state()
    const before = prev.players.find((p) => p.id === HUMAN_ID)
    const plan = planHumanRevenuePersist({
      matchId: MATCH_ID,
      playerId: HUMAN_ID,
      turnSeq: 7,
      playerBefore: before,
      fat: 770,
      roster: prev.players,
    })
    const paid = applyCas(prev, revenuePatch(prev, plan))
    const paidPlayer = paid.state.players.find((p) => p.id === HUMAN_ID)
    const afterDebitPlayer = { ...paidPlayer, cash: 17_500 }
    const debitDelta = buildPartialPlayerDelta(paidPlayer, afterDebitPlayer, { _actionId: 'expense-1' })
    const debited = applyCas(
      paid.state,
      {
        playersDeltaById: { [HUMAN_ID]: debitDelta },
        statePatch: {
          kind: 'PLAYER_DELTA',
          actionId: 'expense-1',
          _commitKind: 'PLAYER_DELTA',
          _expectMatchId: MATCH_ID,
          _expectTurnPlayerId: HUMAN_ID,
          _expectTurnSeq: 7,
        },
      },
      NOW + 10,
    )
    assert.equal(debited.ok, true)
    const current = debited.state.players.find((p) => p.id === HUMAN_ID)
    assert.equal(current.cash, 17_500)
    assert.equal(
      classifyHumanRevenueLifecycle({
        player: current,
        matchId: MATCH_ID,
        turnPlayerId: HUMAN_ID,
        turnSeq: 7,
      }),
      'PAID',
    )
    assert.equal(
      isHumanRevenueDue({
        player: current,
        matchId: MATCH_ID,
        turnPlayerId: HUMAN_ID,
        turnSeq: 7,
      }),
      false,
    )
  })

  it('stale version não reaplica snapshot antigo após faturamento confirmado', () => {
    const gate = shouldApplyIncomingState({
      incomingVersion: 11,
      lastAppliedVersion: 12,
      incomingStateId: 'state-11',
      lastAppliedStateId: 'state-12',
    })
    assert.equal(gate.apply, false)
    assert.equal(gate.reason, 'stale-version')
  })

  it('receipt trimmed but done has REVENUE continua PAID', () => {
    const prev = state()
    const before = prev.players.find((p) => p.id === HUMAN_ID)
    const plan = planHumanRevenuePersist({
      matchId: MATCH_ID,
      playerId: HUMAN_ID,
      turnSeq: 7,
      playerBefore: before,
      fat: 770,
      roster: prev.players,
    })
    const paid = applyCas(prev, revenuePatch(prev, plan))
    const current = {
      ...paid.state.players.find((p) => p.id === HUMAN_ID),
      lastActions: {},
    }
    assert.equal(current.lastActions[plan.actionId], undefined)
    assert.deepEqual(current.humanTurnEffects.done, ['REVENUE'])
    assert.equal(
      classifyHumanRevenueLifecycle({
        player: current,
        matchId: MATCH_ID,
        turnPlayerId: HUMAN_ID,
        turnSeq: 7,
      }),
      'PAID',
    )
  })

  it('refresh pending retoma pagamento até PAID', () => {
    const refreshed = state({
      players: [human({ lastActions: {}, humanTurnEffects: revenueEffects(7) }), other()],
      stateVersion: 12,
      stateId: 'state-12',
    })
    assert.equal(
      shouldApplyIncomingState({
        incomingVersion: refreshed.stateVersion,
        lastAppliedVersion: 11,
        incomingStateId: refreshed.stateId,
        lastAppliedStateId: 'state-11',
      }).apply,
      true,
    )
    assert.equal(
      classifyHumanRevenueLifecycle({
        player: refreshed.players[0],
        matchId: MATCH_ID,
        turnPlayerId: HUMAN_ID,
        turnSeq: 7,
      }),
      'PAYMENT_PENDING',
    )
    const resume = shouldResumeHumanTurnEffects({
      isHumanTurn: true,
      player: refreshed.players[0],
      matchId: MATCH_ID,
      turnPlayerId: HUMAN_ID,
      turnSeq: 7,
    })
    assert.equal(resume.ok, true)
    assert.equal(resume.frozenRevenue, 770)
    const plan = planHumanRevenuePersist({
      matchId: MATCH_ID,
      playerId: HUMAN_ID,
      turnSeq: 7,
      playerBefore: refreshed.players[0],
      fat: resume.frozenRevenue,
      roster: refreshed.players,
    })
    const recovered = applyCas(refreshed, revenuePatch(refreshed, plan))
    assert.equal(recovered.ok, true)
    assert.equal(
      classifyHumanRevenueLifecycle({
        player: recovered.state.players[0],
        matchId: MATCH_ID,
        turnPlayerId: HUMAN_ID,
        turnSeq: 7,
      }),
      'PAID',
    )
    assert.equal(recovered.state.players[0].cash, 18_770)
  })

  it('two legitimate turnSeqs produzem actionIds distintos e o turno novo pode ficar pendente', () => {
    const action7 = buildHumanRevenueActionId({
      matchId: MATCH_ID,
      playerId: HUMAN_ID,
      turnSeq: 7,
    })
    const oldPaidPlayer = human({
      lastActions: { [action7]: NOW },
      humanTurnEffects: markHumanRevenueDone(revenueEffects(7)),
    })
    const nextTurnPlayer = {
      ...oldPaidPlayer,
      humanTurnEffects: revenueEffects(8, { turnSeq: 8, revenueValue: 880 }),
    }
    const plan8 = planHumanRevenuePersist({
      matchId: MATCH_ID,
      playerId: HUMAN_ID,
      turnSeq: 8,
      playerBefore: nextTurnPlayer,
      fat: 999,
      roster: [nextTurnPlayer, other()],
    })
    assert.equal(plan8.skip, false)
    assert.notEqual(plan8.actionId, action7)
    assert.equal(plan8.playersDeltaById[HUMAN_ID].humanTurnEffects.turnSeq, 8)
    assert.equal(
      classifyHumanRevenueLifecycle({
        player: nextTurnPlayer,
        matchId: MATCH_ID,
        turnPlayerId: HUMAN_ID,
        turnSeq: 8,
      }),
      'PAYMENT_PENDING',
    )
  })

  it('dono offline: coordenador liquida uma vez e retry não duplica', () => {
    const prev = state()
    const liq = planCoordinatorRevenueLiquidation({
      matchId: MATCH_ID,
      turnPlayerId: HUMAN_ID,
      turnSeq: 7,
      players: prev.players,
      playerBefore: prev.players[0],
    })
    assert.equal(liq.skip, false)
    const first = applyCas(prev, revenuePatch(prev, liq))
    assert.equal(first.ok, true)
    assert.equal(first.state.players[0].cash, 18_770)
    const second = planCoordinatorRevenueLiquidation({
      matchId: MATCH_ID,
      turnPlayerId: HUMAN_ID,
      turnSeq: 7,
      players: first.state.players,
      playerBefore: first.state.players[0],
    })
    assert.equal(second.skip, true)
    const retry = applyCas(first.state, revenuePatch(first.state, liq), NOW + 2)
    assert.equal(retry.state.players[0].cash, 18_770)
  })

  it('AUTO_PASS e AUTO_SKIP_OFFLINE rejeitam com faturamento pendente', () => {
    const prev = state({ turnDeadlineAt: NOW - 1000 })
    assert.equal(
      validateTurnCommit(prev, {
        kind: 'TURN',
        _commitKind: 'AUTO_PASS',
        turnPlayerId: OTHER_ID,
        turnSeq: 8,
        _expectTurnPlayerId: HUMAN_ID,
        _expectTurnSeq: 7,
        lastAction: 'AUTO_PASS_TIMER',
      }, { now: NOW }).ok,
      false,
    )
    assert.equal(
      validateTurnCommit(prev, {
        kind: 'TURN',
        _commitKind: 'AUTO_SKIP_OFFLINE',
        turnPlayerId: OTHER_ID,
        turnSeq: 8,
        _expectTurnPlayerId: HUMAN_ID,
        _expectTurnSeq: 7,
        lastAction: 'AUTO_SKIP_OFFLINE',
      }, { now: NOW }).reason,
      'human-revenue-pending',
    )
  })

  it('ENDGAME rejeita validate com pendência, mas o updater liquida todos os devidos na última rodada', () => {
    const otherHuman = {
      id: OTHER_HUMAN_ID,
      name: 'Bia',
      cash: 10_000,
      pos: 0,
      bankrupt: false,
      lastActions: {},
      humanTurnEffects: buildHumanTurnEffectPlan({
        matchId: MATCH_ID,
        turnPlayerId: OTHER_HUMAN_ID,
        turnSeq: 5,
        crossedStart: true,
        revenueValue: 400,
      }),
    }
    const prev = state({
      players: [human(), otherHuman],
      turnPlayerId: HUMAN_ID,
      turnSeq: 7,
    })
    assert.equal(
      validateTurnCommit(prev, {
        kind: 'ENDGAME',
        gameOver: true,
        _expectTurnPlayerId: HUMAN_ID,
        _expectTurnSeq: 7,
      }, { now: NOW }).reason,
      'human-revenue-pending',
    )
    assert.equal(listDueHumanRevenues(prev).length, 2)
    const finished = applyCas(prev, {
      statePatch: {
        kind: 'ENDGAME',
        gameOver: true,
        _expectTurnPlayerId: HUMAN_ID,
        _expectTurnSeq: 7,
      },
    })
    assert.equal(finished.ok, true)
    assert.equal(finished.state.gameOver, true)
    assert.equal(finished.state.players.find((p) => p.id === HUMAN_ID).cash, 18_770)
    assert.equal(finished.state.players.find((p) => p.id === OTHER_HUMAN_ID).cash, 10_400)
    assert.equal(listDueHumanRevenues(finished.state).length, 0)
  })

  it('timeout do modal REVENUE é OK e o updater conclui o pagamento', () => {
    const payload = expirationPayloadForKind('REVENUE', { reason: 'AUTO_PASS_TIMER' })
    assert.equal(payload.action, 'OK')
    const prev = state()
    const plan = planHumanRevenuePersist({
      matchId: MATCH_ID,
      playerId: HUMAN_ID,
      turnSeq: 7,
      playerBefore: prev.players[0],
      fat: 770,
      roster: prev.players,
    })
    const paid = applyCas(prev, revenuePatch(prev, plan))
    assert.equal(paid.ok, true)
    assert.equal(paid.state.players[0].cash, 18_770)
    assert.equal(
      classifyHumanRevenueLifecycle({
        player: paid.state.players[0],
        matchId: MATCH_ID,
        turnPlayerId: HUMAN_ID,
        turnSeq: 7,
      }),
      'PAID',
    )
  })

  it('plan usa revenueValue congelado e ignora fat recalculado maior', () => {
    const before = human({
      clients: 99,
      humanTurnEffects: revenueEffects(7, { revenueValue: 770 }),
    })
    const plan = planHumanRevenuePersist({
      matchId: MATCH_ID,
      playerId: HUMAN_ID,
      turnSeq: 7,
      playerBefore: before,
      fat: 50_000,
      revenueValue: 770,
      roster: [before],
    })
    assert.equal(plan.fat, 770)
    assert.equal(plan.playersDeltaById[HUMAN_ID].cash, 18_000 + 770)
  })

  it('applyDueHumanRevenuesToRoster cobre todos os devidos, não só o jogador da vez', () => {
    const otherHuman = {
      id: OTHER_HUMAN_ID,
      cash: 9_000,
      bankrupt: false,
      lastActions: {},
      humanTurnEffects: buildHumanTurnEffectPlan({
        matchId: MATCH_ID,
        turnPlayerId: OTHER_HUMAN_ID,
        turnSeq: 4,
        crossedStart: true,
        revenueValue: 250,
      }),
    }
    const prev = state({ players: [human(), otherHuman] })
    const liq = applyDueHumanRevenuesToRoster(prev, { now: NOW })
    assert.equal(liq.applied.length, 2)
    assert.equal(liq.players.find((p) => p.id === HUMAN_ID).cash, 18_770)
    assert.equal(liq.players.find((p) => p.id === OTHER_HUMAN_ID).cash, 9_250)
  })
})
