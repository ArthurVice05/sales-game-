/**
 * Faturamento humano: recibo por turno, valor congelado e confirmação idempotente.
 * node --test src/game/__tests__/humanRevenueCredit.test.mjs
 */
import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import {
  HUMAN_REVENUE_COMMIT_KIND,
  applyHumanRevenueCreditToBaseline,
  buildHumanRevenueActionId,
  buildHumanTurnEffectPlan,
  classifyHumanRevenueLifecycle,
  hasUnsettledHumanRevenue,
  isFaturamentoEconomicallyDone,
  isFaturamentoOnceBlocking,
  isHumanRevenueDue,
  isHumanRevenuePaid,
  markHumanRevenueDone,
  planCoordinatorRevenueLiquidation,
  planHumanRevenuePersist,
  readHumanTurnEffects,
  reconcileHumanRevenueAfterCommit,
  shouldBlockHumanHandoffForEffects,
  shouldBlockOfflineSkipForHumanEffects,
  simulateAwaitedRevenueCredit,
  simulateLegacyFireAndForgetRevenueRace,
  stampHumanRevenueLastActions,
} from '../humanRevenueCredit.js'
import { createLoanPending } from '../loanCycle.js'
import { mergePlayerPartial, planRosterApply } from '../playerStateSync.js'

const PLAYER_ID = 'player-stable-uuid-aaaa'
const MATCH_ID = 'match-stable-bbbb'
const TURN_SEQ = 12

function effectPlan(extra = {}) {
  return buildHumanTurnEffectPlan({
    matchId: MATCH_ID,
    turnPlayerId: PLAYER_ID,
    turnSeq: TURN_SEQ,
    fromPos: 37,
    toPos: 2,
    steps: 5,
    crossedStart: true,
    crossedExpenses: false,
    landTile: 'NONE',
    processLandTile: false,
    revenueValue: 3_333.9,
    ...extra,
  })
}

function playerWithEffects(extra = {}) {
  return {
    id: PLAYER_ID,
    cash: 10_000,
    name: 'Host',
    bankrupt: false,
    lastActions: {},
    humanTurnEffects: effectPlan(),
    ...extra,
  }
}

describe('reprodução — fire-and-forget perde crédito após snapshot stale', () => {
  it('crédito local + log de sucesso + snapshot pré-faturamento ⇒ caixa local sem +fat e commit no-op', () => {
    const cashBefore = 18_000
    const fat = 4_250
    const race = simulateLegacyFireAndForgetRevenueRace({
      cashBefore,
      fat,
      applyStaleSnapshot: true,
    })
    assert.equal(race.loggedSuccess, true)
    assert.equal(race.lost, true)
    assert.equal(race.localCash, cashBefore)
    assert.equal(race.remoteCash, cashBefore)
    assert.equal(race.commitCompleted, false)
    assert.equal(race.cashDeltaBuilt, cashBefore + fat)
  })

  it('merge de snapshot remoto com cash antigo sobrescreve crédito local otimista', () => {
    const local = { id: PLAYER_ID, cash: 22_250, name: 'Host' }
    const staleRemote = { id: PLAYER_ID, cash: 18_000, name: 'Host', pos: 3 }
    const merged = mergePlayerPartial(local, staleRemote)
    assert.equal(merged.cash, 18_000)
    const plan = planRosterApply({
      incomingPlayers: [staleRemote],
      currentPlayers: [local],
      hydrated: true,
      isStart: false,
    })
    assert.equal(plan.players[0].cash, 18_000)
  })
})

describe('recibo de faturamento humano', () => {
  it('actionId permanece estável por match+playerId+turnSeq', () => {
    const a = buildHumanRevenueActionId({
      matchId: MATCH_ID,
      playerId: PLAYER_ID,
      turnSeq: TURN_SEQ,
    })
    const b = buildHumanRevenueActionId({
      matchId: MATCH_ID,
      playerId: PLAYER_ID,
      turnSeq: TURN_SEQ,
    })
    const otherTurn = buildHumanRevenueActionId({
      matchId: MATCH_ID,
      playerId: PLAYER_ID,
      turnSeq: TURN_SEQ + 1,
    })
    assert.equal(a, b)
    assert.notEqual(a, otherTurn)
    assert.match(a, /^hum-revenue:/)
  })

  it('plano congela revenueValue inteiro e permanece pendente até REVENUE entrar em done', () => {
    const plan = effectPlan({
      crossedExpenses: true,
      landTile: 'CLIENTS',
      processLandTile: true,
    })
    assert.equal(plan.revenueValue, 3_333)
    assert.deepEqual(plan.done, [])
    assert.equal(plan.settled, false)
  })

  it('readHumanTurnEffects lê o recibo do turno correto', () => {
    const match = readHumanTurnEffects({
      players: [playerWithEffects(), { id: 'other', cash: 0 }],
      matchId: MATCH_ID,
      turnPlayerId: PLAYER_ID,
      turnSeq: TURN_SEQ,
    })
    assert.equal(match.ok, true)
    assert.equal(match.effects.revenueValue, 3_333)
    assert.equal(match.settled, false)
  })

  it('isHumanRevenuePaid aceita done no recibo mesmo sem lastActions', () => {
    const paidEffects = markHumanRevenueDone(effectPlan())
    assert.equal(
      isHumanRevenuePaid({
        player: { id: PLAYER_ID, lastActions: {} },
        actionId: buildHumanRevenueActionId({ matchId: MATCH_ID, playerId: PLAYER_ID, turnSeq: TURN_SEQ }),
        effects: paidEffects,
      }),
      true,
    )
  })

  it('isHumanRevenueDue só vale quando crossedStart no mesmo turno e ainda não foi pago', () => {
    const due = isHumanRevenueDue({
      player: playerWithEffects(),
      matchId: MATCH_ID,
      turnPlayerId: PLAYER_ID,
      turnSeq: TURN_SEQ,
    })
    assert.equal(due, true)

    const paid = isHumanRevenueDue({
      player: { ...playerWithEffects(), humanTurnEffects: markHumanRevenueDone(effectPlan()) },
      matchId: MATCH_ID,
      turnPlayerId: PLAYER_ID,
      turnSeq: TURN_SEQ,
    })
    assert.equal(paid, false)
  })

  it('applyHumanRevenueCreditToBaseline usa revenueValue congelado e arma empréstimo elegível', () => {
    const lp = createLoanPending(1000, 2)
    const before = { id: PLAYER_ID, cash: 5_000, loanPending: lp }
    const applied = applyHumanRevenueCreditToBaseline(before, {
      revenueValue: 2_000.9,
      actionId: 'x',
    })
    assert.equal(applied.cashBefore, 5_000)
    assert.equal(applied.cashAfter, 7_000)
    assert.equal(applied.player.loanPending.eligibleOnExpenses, true)
    assert.equal(applied.player.lastActions, undefined)
  })

  it('markHumanRevenueDone adiciona REVENUE sem duplicar e recalcula settled', () => {
    const pending = effectPlan({ crossedExpenses: false })
    const once = markHumanRevenueDone(pending)
    const twice = markHumanRevenueDone(once)
    assert.deepEqual(once.done, ['REVENUE'])
    assert.equal(once.settled, true)
    assert.deepEqual(twice.done, ['REVENUE'])
  })
})

describe('planejamento do crédito persistido', () => {
  it('planHumanRevenuePersist usa o valor congelado do recibo e marca REVENUE em done', () => {
    const before = playerWithEffects({
      humanTurnEffects: effectPlan({ revenueValue: 1_777 }),
    })
    const plan = planHumanRevenuePersist({
      matchId: MATCH_ID,
      playerId: PLAYER_ID,
      turnSeq: TURN_SEQ,
      playerBefore: before,
      fat: 9_999,
      roster: [before],
    })
    assert.equal(plan.skip, false)
    assert.equal(plan.fat, 1_777)
    assert.equal(plan.cashAfter, 11_777)
    assert.equal(plan.playersDeltaById[PLAYER_ID].cash, 11_777)
    assert.equal(plan.playersDeltaById[PLAYER_ID]._actionId, plan.actionId)
    assert.deepEqual(plan.playersDeltaById[PLAYER_ID].humanTurnEffects.done, ['REVENUE'])
    assert.equal(plan.playersDeltaById[PLAYER_ID].humanTurnEffects.revenueValue, 1_777)
    assert.equal(plan.commitKind, HUMAN_REVENUE_COMMIT_KIND)
  })

  it('já pago via lastActions ⇒ skip idempotente no mesmo turnSeq', () => {
    const actionId = buildHumanRevenueActionId({
      matchId: MATCH_ID,
      playerId: PLAYER_ID,
      turnSeq: TURN_SEQ,
    })
    const before = stampHumanRevenueLastActions(playerWithEffects(), actionId)
    const plan = planHumanRevenuePersist({
      matchId: MATCH_ID,
      playerId: PLAYER_ID,
      turnSeq: TURN_SEQ,
      playerBefore: before,
      fat: 3_333,
      roster: [before],
    })
    assert.equal(plan.skip, true)
    assert.equal(plan.reason, 'already-paid')
  })

  it('já pago via done do recibo continua skip mesmo sem actionId na janela local', () => {
    const before = playerWithEffects({
      humanTurnEffects: markHumanRevenueDone(effectPlan()),
      lastActions: {},
    })
    const plan = planHumanRevenuePersist({
      matchId: MATCH_ID,
      playerId: PLAYER_ID,
      turnSeq: TURN_SEQ,
      playerBefore: before,
      fat: 3_333,
      roster: [before],
    })
    assert.equal(plan.skip, true)
    assert.equal(plan.reason, 'already-paid')
  })

  it('planCoordinatorRevenueLiquidation credita o valor congelado para recovery offline', () => {
    const before = playerWithEffects({
      cash: 4_000,
      humanTurnEffects: effectPlan({ revenueValue: 1_250 }),
    })
    const plan = planCoordinatorRevenueLiquidation({
      matchId: MATCH_ID,
      turnPlayerId: PLAYER_ID,
      turnSeq: TURN_SEQ,
      players: [before],
    })
    assert.equal(plan.skip, false)
    assert.equal(plan.fat, 1_250)
    assert.equal(plan.playersDeltaById[PLAYER_ID].cash, 5_250)
  })
})

describe('reconcile e lifecycle', () => {
  it('reconcile: lastActions no autoritativo evita reenvio após ack perdido', () => {
    const actionId = buildHumanRevenueActionId({
      matchId: MATCH_ID,
      playerId: PLAYER_ID,
      turnSeq: 9,
    })
    const auth = stampHumanRevenueLastActions(
      { id: PLAYER_ID, cash: 11_000 },
      actionId,
    )
    const r = reconcileHumanRevenueAfterCommit({
      actionId,
      authoritativePlayer: auth,
    })
    assert.equal(r.applied, true)
    assert.equal(r.reason, 'lastActions')
  })

  it('reconcile: done no recibo confirma pagamento sem depender de cash-match', () => {
    const actionId = buildHumanRevenueActionId({
      matchId: MATCH_ID,
      playerId: PLAYER_ID,
      turnSeq: TURN_SEQ,
    })
    const auth = {
      id: PLAYER_ID,
      cash: 11_000,
      lastActions: {},
      humanTurnEffects: markHumanRevenueDone(effectPlan()),
    }
    const r = reconcileHumanRevenueAfterCommit({
      actionId,
      authoritativePlayer: auth,
    })
    assert.equal(r.applied, true)
    assert.equal(r.reason, 'effects-done')
  })

  it('reconcile não aceita sucesso só porque o cash bate', () => {
    const actionId = buildHumanRevenueActionId({
      matchId: MATCH_ID,
      playerId: PLAYER_ID,
      turnSeq: TURN_SEQ,
    })
    const auth = {
      id: PLAYER_ID,
      cash: 13_333,
      lastActions: {},
      humanTurnEffects: effectPlan(),
    }
    const r = reconcileHumanRevenueAfterCommit({
      actionId,
      authoritativePlayer: auth,
    })
    assert.equal(r.applied, false)
    assert.equal(r.reason, 'unconfirmed')
  })

  it('classifyHumanRevenueLifecycle distingue pending, paid e cancelamento por match', () => {
    const pending = classifyHumanRevenueLifecycle({
      player: playerWithEffects(),
      matchId: MATCH_ID,
      turnPlayerId: PLAYER_ID,
      turnSeq: TURN_SEQ,
    })
    assert.equal(pending, 'PAYMENT_PENDING')

    const paid = classifyHumanRevenueLifecycle({
      player: {
        ...playerWithEffects(),
        humanTurnEffects: markHumanRevenueDone(effectPlan()),
      },
      matchId: MATCH_ID,
      turnPlayerId: PLAYER_ID,
      turnSeq: TURN_SEQ,
    })
    assert.equal(paid, 'PAID')

    const cancelled = classifyHumanRevenueLifecycle({
      player: playerWithEffects(),
      matchId: 'other-match',
      turnPlayerId: PLAYER_ID,
      turnSeq: TURN_SEQ,
    })
    assert.equal(cancelled, 'CANCELLED_MATCH')
  })

  it('hasUnsettledHumanRevenue detecta pendência no turno atual e libera após done', () => {
    const pendingState = {
      matchId: MATCH_ID,
      turnPlayerId: PLAYER_ID,
      turnSeq: TURN_SEQ,
      players: [playerWithEffects()],
    }
    assert.equal(hasUnsettledHumanRevenue(pendingState), true)

    const paidState = {
      ...pendingState,
      players: [{ ...playerWithEffects(), humanTurnEffects: markHumanRevenueDone(effectPlan()) }],
    }
    assert.equal(hasUnsettledHumanRevenue(paidState), false)
  })

  it('shouldBlockHumanHandoffForEffects bloqueia só faturamento devido', () => {
    const block = shouldBlockHumanHandoffForEffects({
      isHumanTurn: true,
      effects: effectPlan(),
      matchId: MATCH_ID,
      turnPlayerId: PLAYER_ID,
      turnSeq: TURN_SEQ,
    })
    assert.deepEqual(block, { block: true, reason: 'revenue-pending' })

    const release = shouldBlockHumanHandoffForEffects({
      isHumanTurn: true,
      player: {
        id: PLAYER_ID,
        humanTurnEffects: markHumanRevenueDone(effectPlan()),
        lastActions: {},
      },
      effects: markHumanRevenueDone(effectPlan()),
      matchId: MATCH_ID,
      turnPlayerId: PLAYER_ID,
      turnSeq: TURN_SEQ,
    })
    assert.deepEqual(release, { block: false, reason: 'revenue-settled' })
  })

  it('skip offline não avança após liquidar fat se despesas/outros efeitos restam', () => {
    const paidRevenueOnly = markHumanRevenueDone(
      effectPlan({ crossedExpenses: true, revenueValue: 900 }),
    )
    const blocked = shouldBlockOfflineSkipForHumanEffects({
      player: { id: PLAYER_ID, humanTurnEffects: paidRevenueOnly, lastActions: {} },
      matchId: MATCH_ID,
      turnPlayerId: PLAYER_ID,
      turnSeq: TURN_SEQ,
    })
    assert.equal(blocked.block, true)
    assert.equal(blocked.reason, 'mandatory-effects-remaining')
    assert.ok(blocked.remaining.includes('EXPENSES'))

    const clear = shouldBlockOfflineSkipForHumanEffects({
      player: {
        id: PLAYER_ID,
        humanTurnEffects: markHumanRevenueDone(effectPlan({ crossedExpenses: false })),
        lastActions: {},
      },
      matchId: MATCH_ID,
      turnPlayerId: PLAYER_ID,
      turnSeq: TURN_SEQ,
    })
    assert.deepEqual(clear, { block: false, reason: 'clear', remaining: [] })
  })
})
describe('pipeline corrigido — await + idempotência', () => {
  it('após commit ok, caixa local e remoto convergem no +fat', () => {
    const cashBefore = 18_000
    const fat = 4_250
    const sim = simulateAwaitedRevenueCredit({
      cashBefore,
      fat,
      matchId: MATCH_ID,
      playerId: PLAYER_ID,
      turnSeq: TURN_SEQ,
      staleOverwriteAfterConfirm: true,
    })
    assert.equal(sim.commitOk, true)
    assert.equal(sim.remoteCash, cashBefore + fat)
    assert.equal(sim.localCash, cashBefore + fat)
    assert.equal(sim.localCash, sim.expectedCash)
  })

  it('retry / ack perdido do mesmo actionId não duplica e uma nova volta legítima cria novo id', () => {
    const sim = simulateAwaitedRevenueCredit({
      cashBefore: 9_000,
      fat: 1_000,
      matchId: MATCH_ID,
      playerId: PLAYER_ID,
      turnSeq: 3,
      commitFailsFirst: true,
    })
    assert.equal(sim.retrySameSkip, true)
    assert.equal(sim.remoteCash, 10_000)
    assert.equal(sim.secondSkip, false)
    assert.notEqual(sim.secondActionId, sim.actionId)
  })
})

describe('flags _once', () => {
  it('queued bloqueia re-enqueue; só done/true conta como econômico', () => {
    assert.equal(isFaturamentoOnceBlocking('queued'), true)
    assert.equal(isFaturamentoEconomicallyDone('queued'), false)
    assert.equal(isFaturamentoEconomicallyDone('done'), true)
    assert.equal(isFaturamentoEconomicallyDone(true), true)
    assert.equal(isFaturamentoOnceBlocking(false), false)
  })
})
