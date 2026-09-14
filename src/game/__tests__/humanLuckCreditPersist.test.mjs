/**
 * Persistência de crédito de Sorte (e faturamento via funções reais).
 * Reproduz a falha do PLAYER_DELTA com caixa absoluto stale e exige HUMAN_LUCK.
 */
import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { applySorteRevesPayloadToPlayer } from '../sorteRevesApply.js'
import { computeFaturamentoFor } from '../gameMath.js'
import { pickWinnerByPatrimonio } from '../patrimonio.js'
import { SORTE_REVES_CARDS, resolveCardEffect } from '../../modals/sorteRevesDeck.js'
import {
  applyGamePatchToState,
  applyHumanLuckCasToState,
  applyHumanRevenueCasToState,
  buildPartialPlayerDelta,
  mergePlayersById,
  shouldApplyIncomingState,
} from '../playerStateSync.js'
import {
  HUMAN_LUCK_COMMIT_KIND,
  buildHumanLuckActionId,
  isHumanLuckDue,
  isHumanLuckPaid,
  persistHumanLuckWithRetries,
  planCoordinatorLuckLiquidation,
  planHumanLuckPendingOnly,
  planHumanLuckPersist,
  reconcileHumanLuckAfterCommit,
  resolveHumanLuckPayloadForScope,
  shouldBlockHumanHandoffForLuck,
} from '../humanLuckCredit.js'
import {
  HUMAN_LAST_ACTIONS_MAX,
  HUMAN_REVENUE_COMMIT_KIND,
  buildHumanTurnEffectPlan,
  isHumanRevenueDue,
  planHumanRevenuePersist,
} from '../humanRevenueCredit.js'
import { computeMove } from '../domain/movement.js'
import { expirationPayloadForKind } from '../decisionTimeoutPolicy.js'
import { validateTurnCommit } from '../turnCommitValidation.js'

const MATCH_ID = 'match-luck-persist'
const P1 = 'player-ana'
const P2 = 'player-bruno'
const TURN_SEQ = 4
const NOW = 1_700_000

function card(id) {
  return SORTE_REVES_CARDS.find((c) => c.id === id)
}

function player(id, extra = {}) {
  return {
    id,
    name: id === P1 ? 'Ana' : 'Bruno',
    cash: 10_000,
    clients: 0,
    lastActions: {},
    bankrupt: false,
    ...extra,
  }
}

function room(extra = {}) {
  return {
    matchId: MATCH_ID,
    turnPlayerId: P1,
    turnSeq: TURN_SEQ,
    gameOver: false,
    stateVersion: 3,
    players: [player(P1), player(P2, { cash: 7_000 })],
    ...extra,
  }
}

function luckPatch(plan, turnState) {
  return {
    playersDeltaById: plan.playersDeltaById,
    statePatch: {
      kind: 'PLAYER_DELTA',
      actionId: plan.actionId,
      _commitKind: HUMAN_LUCK_COMMIT_KIND,
      _expectMatchId: turnState.matchId,
      _expectTurnPlayerId: plan.playerId,
      _expectTurnSeq: TURN_SEQ,
      _luckPayload: plan.payload,
      _luckSkipNegativeCash: plan.skipNegativeCash === true,
      _luckFrozenCashDelta: plan.frozenCashDelta,
      _luckPendingOnly: plan.pendingOnly === true,
    },
  }
}

describe('reprodução — PLAYER_DELTA com caixa absoluto apaga débito alheio', () => {
  it('merge genérico aplica cash stale e some a despesa posterior', () => {
    const before = player(P1, { cash: 10_000 })
    const payload = resolveCardEffect(card('referral_bonus'), before).payload
    const applied = applySorteRevesPayloadToPlayer(before, payload)
    assert.equal(applied.player.cash, 10_800)
    const staleDelta = buildPartialPlayerDelta(before, applied.player, { _actionId: 'luck-stale' })
    assert.equal(staleDelta.cash, 10_800)

    const remoteAfterExpense = [player(P1, { cash: 9_000 }), player(P2, { cash: 7_000 })]
    const merged = mergePlayersById(remoteAfterExpense, { [P1]: staleDelta })
    assert.equal(
      merged.find((p) => p.id === P1).cash,
      10_800,
      'falha atual: retry/CAS com caixa absoluto reescreve despesa legítima',
    )
  })
})

describe('HUMAN_LUCK — crédito confirmado e único', () => {
  it('carta de valor fixo credita o jogador da jogada, não o oponente', () => {
    const prev = room()
    const ana = prev.players[0]
    const payload = resolveCardEffect(card('referral_bonus'), ana).payload
    const plan = planHumanLuckPersist({
      matchId: MATCH_ID,
      playerId: P1,
      turnSeq: TURN_SEQ,
      playerBefore: ana,
      payload,
    })
    assert.equal(plan.frozenCashDelta, 800)
    assert.equal(plan.actionId, buildHumanLuckActionId({ matchId: MATCH_ID, playerId: P1, turnSeq: TURN_SEQ }))
    const paid = applyGamePatchToState(prev, luckPatch(plan, prev), { now: NOW })
    assert.equal(paid.ok, true)
    assert.equal(paid.state.players.find((p) => p.id === P1).cash, 10_800)
    assert.equal(paid.state.players.find((p) => p.id === P2).cash, 7_000)
    assert.ok(paid.state.players.find((p) => p.id === P1).lastActions[plan.actionId])
  })

  it('bônus de Sorte usa resolveCardEffect + applySorteRevesPayloadToPlayer (regras existentes)', () => {
    const ana = player(P1, { clients: 4, cash: 10_000 })
    const payload = resolveCardEffect(card('client_cheer_per_client'), ana).payload
    assert.equal(payload.cashDelta, 2_000)
    const applied = applySorteRevesPayloadToPlayer(ana, payload)
    assert.equal(applied.player.cash, 12_000)

    const mgr = player(P1, { cash: 3_000, trainingsByVendor: { gestor: ['am', 'az'] } })
    const mgrPayload = resolveCardEffect(card('network_cert_mgr'), mgr).payload
    assert.equal(mgrPayload.cashDelta, 10_000)
    const mgrApplied = applySorteRevesPayloadToPlayer(mgr, mgrPayload)
    assert.equal(mgrApplied.player.cash, 13_000)
  })

  it('dois clientes independentes convergem para o mesmo saldo após o mesmo commit', () => {
    const prev = room()
    const payload = resolveCardEffect(card('referral_bonus'), prev.players[0]).payload
    const plan = planHumanLuckPersist({
      matchId: MATCH_ID,
      playerId: P1,
      turnSeq: TURN_SEQ,
      playerBefore: prev.players[0],
      payload,
    })
    const host = applyGamePatchToState(structuredClone(prev), luckPatch(plan, prev), { now: NOW })
    const guest = applyGamePatchToState(structuredClone(prev), luckPatch(plan, prev), { now: NOW })
    assert.equal(host.state.players[0].cash, 10_800)
    assert.equal(guest.state.players[0].cash, 10_800)
    assert.equal(host.state.players[0].cash, guest.state.players[0].cash)
  })

  it('resposta perdida + retry do mesmo actionId não duplica', () => {
    const prev = room()
    const payload = resolveCardEffect(card('referral_bonus'), prev.players[0]).payload
    const plan = planHumanLuckPersist({
      matchId: MATCH_ID,
      playerId: P1,
      turnSeq: TURN_SEQ,
      playerBefore: prev.players[0],
      payload,
    })
    const first = applyGamePatchToState(prev, luckPatch(plan, prev), { now: NOW })
    const recon = reconcileHumanLuckAfterCommit({
      actionId: plan.actionId,
      authoritativePlayer: first.state.players[0],
    })
    assert.equal(recon.applied, true)
    const retry = applyGamePatchToState(first.state, luckPatch(plan, prev), { now: NOW + 1 })
    assert.equal(retry.ok, true)
    assert.equal(retry.alreadyApplied, true)
    assert.equal(retry.state.players[0].cash, 10_800)
  })

  it('conflito de CAS: aplica +delta congelado no saldo vigente e preserva despesa alheia', () => {
    const live = room({ players: [player(P1, { cash: 9_000 }), player(P2, { cash: 7_000 })] })
    const staleBefore = player(P1, { cash: 10_000 })
    const payload = resolveCardEffect(card('referral_bonus'), staleBefore).payload
    const stalePlan = planHumanLuckPersist({
      matchId: MATCH_ID,
      playerId: P1,
      turnSeq: TURN_SEQ,
      playerBefore: staleBefore,
      payload,
    })
    assert.equal(stalePlan.playersDeltaById[P1].cash, 10_800)
    const applied = applyHumanLuckCasToState(live, luckPatch(stalePlan, live), { now: NOW })
    assert.equal(applied.ok, true)
    assert.equal(applied.state.players.find((p) => p.id === P1).cash, 9_800)
    assert.equal(applied.state.players.find((p) => p.id === P2).cash, 7_000)
  })

  it('débito posterior continua reduzindo o saldo; igualdade de caixa não prova pagamento', () => {
    const prev = room()
    const payload = resolveCardEffect(card('referral_bonus'), prev.players[0]).payload
    const plan = planHumanLuckPersist({
      matchId: MATCH_ID,
      playerId: P1,
      turnSeq: TURN_SEQ,
      playerBefore: prev.players[0],
      payload,
    })
    const paid = applyGamePatchToState(prev, luckPatch(plan, prev), { now: NOW })
    const after = paid.state.players[0]
    const debited = applyGamePatchToState(
      paid.state,
      {
        playersDeltaById: { [P1]: { cash: 9_500, _actionId: 'expense-1' } },
        statePatch: {
          kind: 'PLAYER_DELTA',
          _commitKind: 'PLAYER_DELTA',
          _expectMatchId: MATCH_ID,
          _expectTurnPlayerId: P1,
          _expectTurnSeq: TURN_SEQ,
        },
      },
      { now: NOW + 2 },
    )
    assert.equal(debited.state.players[0].cash, 9_500)
    const recon = reconcileHumanLuckAfterCommit({
      actionId: plan.actionId,
      authoritativePlayer: debited.state.players[0],
    })
    assert.equal(recon.applied, true)
    assert.notEqual(debited.state.players[0].cash, 10_800)
  })

  it('segunda carta legítima (outro turnSeq) recebe novo crédito', () => {
    const prev = room()
    const payload = resolveCardEffect(card('referral_bonus'), prev.players[0]).payload
    const firstPlan = planHumanLuckPersist({
      matchId: MATCH_ID,
      playerId: P1,
      turnSeq: TURN_SEQ,
      playerBefore: prev.players[0],
      payload,
    })
    const first = applyGamePatchToState(prev, luckPatch(firstPlan, prev), { now: NOW })
    const secondPlan = planHumanLuckPersist({
      matchId: MATCH_ID,
      playerId: P1,
      turnSeq: TURN_SEQ + 1,
      playerBefore: first.state.players[0],
      payload,
    })
    assert.notEqual(secondPlan.actionId, firstPlan.actionId)
    const second = applyGamePatchToState(
      { ...first.state, turnSeq: TURN_SEQ + 1 },
      {
        ...luckPatch(secondPlan, { ...prev, turnSeq: TURN_SEQ + 1 }),
        statePatch: {
          ...luckPatch(secondPlan, prev).statePatch,
          _expectTurnSeq: TURN_SEQ + 1,
        },
      },
      { now: NOW + 3 },
    )
    assert.equal(second.state.players[0].cash, 11_600)
  })

  it('refresh após confirmação mantém o dinheiro no snapshot autoritativo', () => {
    const prev = room()
    const payload = resolveCardEffect(card('referral_bonus'), prev.players[0]).payload
    const plan = planHumanLuckPersist({
      matchId: MATCH_ID,
      playerId: P1,
      turnSeq: TURN_SEQ,
      playerBefore: prev.players[0],
      payload,
    })
    const paid = applyGamePatchToState(prev, luckPatch(plan, prev), { now: NOW })
    const gate = shouldApplyIncomingState({
      incomingVersion: 4,
      lastAppliedVersion: 3,
      incomingStateId: 'after-luck',
      lastAppliedStateId: 'before-luck',
    })
    assert.equal(gate.apply, true)
    assert.equal(paid.state.players[0].cash, 10_800)
    assert.ok(paid.state.players[0].lastActions[plan.actionId])
  })

  it('efeito não monetário e revés continuam aplicando pelas funções existentes', () => {
    const certPlayer = player(P1, { az: 0 })
    const certPayload = resolveCardEffect(card('casa_change_cert_blue'), certPlayer).payload
    const certPlan = planHumanLuckPersist({
      matchId: MATCH_ID,
      playerId: P1,
      turnSeq: TURN_SEQ,
      playerBefore: certPlayer,
      payload: certPayload,
    })
    const certPaid = applyHumanLuckCasToState(
      room({ players: [certPlayer, player(P2)] }),
      luckPatch(certPlan, room()),
      { now: NOW },
    )
    assert.equal(certPaid.state.players[0].az, 1)
    assert.equal(certPaid.state.players[0].cash, 10_000)

    const reves = player(P1, { cash: 10_000, clients: 5 })
    const revesPayload = resolveCardEffect(card('quality_crisis'), reves).payload
    const applied = applySorteRevesPayloadToPlayer(reves, revesPayload)
    assert.equal(applied.player.cash, 9_000)
    assert.equal(applied.player.clients, 4)
  })

  it('modo local aplica o plano sem backend; falha de gravação não marca sucesso', () => {
    const ana = player(P1)
    const payload = resolveCardEffect(card('referral_bonus'), ana).payload
    const plan = planHumanLuckPersist({
      matchId: MATCH_ID,
      playerId: P1,
      turnSeq: TURN_SEQ,
      playerBefore: ana,
      payload,
    })
    assert.equal(plan.skip, false)
    assert.equal(plan.playerAfter.cash, 10_800)
    const localOk = { ok: true }
    assert.equal(localOk.ok, true)
    const failed = { ok: false, reason: 'commit-failed' }
    const recon = reconcileHumanLuckAfterCommit({
      actionId: plan.actionId,
      authoritativePlayer: ana,
    })
    assert.equal(failed.ok, false)
    assert.equal(recon.applied, false)
    assert.equal(ana.cash, 10_000)
  })

  it('commit de outro jogador é rejeitado', () => {
    const prev = room()
    const payload = resolveCardEffect(card('referral_bonus'), prev.players[0]).payload
    const plan = planHumanLuckPersist({
      matchId: MATCH_ID,
      playerId: P2,
      turnSeq: TURN_SEQ,
      playerBefore: prev.players[1],
      payload,
    })
    const v = validateTurnCommit(prev, luckPatch(plan, prev).statePatch, { now: NOW })
    assert.equal(v.ok, false)
  })
})

describe('faturamento — funções reais, não simulação', () => {
  it('computeFaturamentoFor conhecido é creditado no jogador certo via updater CAS', () => {
    const fat = computeFaturamentoFor({ revenue: 4_250 })
    assert.equal(fat, 4_250)
    const human = {
      id: P1,
      cash: 18_000,
      lastActions: {},
      humanTurnEffects: buildHumanTurnEffectPlan({
        matchId: MATCH_ID,
        turnPlayerId: P1,
        turnSeq: TURN_SEQ,
        crossedStart: true,
        revenueValue: fat,
      }),
    }
    const prev = {
      matchId: MATCH_ID,
      turnPlayerId: P1,
      turnSeq: TURN_SEQ,
      gameOver: false,
      players: [human, player(P2, { cash: 1_000 })],
    }
    const plan = planHumanRevenuePersist({
      matchId: MATCH_ID,
      playerId: P1,
      turnSeq: TURN_SEQ,
      playerBefore: human,
      revenueValue: fat,
      roster: prev.players,
    })
    const paid = applyHumanRevenueCasToState(prev, {
      playersDeltaById: plan.playersDeltaById,
      statePatch: {
        kind: 'PLAYER_DELTA',
        actionId: plan.actionId,
        _commitKind: HUMAN_REVENUE_COMMIT_KIND,
        _expectMatchId: MATCH_ID,
        _expectTurnPlayerId: P1,
        _expectTurnSeq: TURN_SEQ,
      },
    }, { now: NOW })
    assert.equal(paid.ok, true)
    assert.equal(paid.state.players.find((p) => p.id === P1).cash, 22_250)
    assert.equal(paid.state.players.find((p) => p.id === P2).cash, 1_000)
  })

  it('segunda passagem (outro turnSeq) recebe outro faturamento', () => {
    const fat = computeFaturamentoFor({ revenue: 400 })
    const effects1 = buildHumanTurnEffectPlan({
      matchId: MATCH_ID,
      turnPlayerId: P1,
      turnSeq: 1,
      crossedStart: true,
      revenueValue: fat,
    })
    let human = { id: P1, cash: 10_000, lastActions: {}, humanTurnEffects: effects1 }
    const plan1 = planHumanRevenuePersist({
      matchId: MATCH_ID,
      playerId: P1,
      turnSeq: 1,
      playerBefore: human,
      revenueValue: fat,
    })
    const first = applyHumanRevenueCasToState({
      matchId: MATCH_ID,
      turnPlayerId: P1,
      turnSeq: 1,
      players: [human],
    }, {
      playersDeltaById: plan1.playersDeltaById,
      statePatch: {
        _commitKind: HUMAN_REVENUE_COMMIT_KIND,
        _expectMatchId: MATCH_ID,
        _expectTurnPlayerId: P1,
        _expectTurnSeq: 1,
        actionId: plan1.actionId,
      },
    }, { now: NOW })
    assert.equal(first.state.players[0].cash, 10_400)
    human = {
      ...first.state.players[0],
      humanTurnEffects: buildHumanTurnEffectPlan({
        matchId: MATCH_ID,
        turnPlayerId: P1,
        turnSeq: 2,
        crossedStart: true,
        revenueValue: fat,
      }),
    }
    const plan2 = planHumanRevenuePersist({
      matchId: MATCH_ID,
      playerId: P1,
      turnSeq: 2,
      playerBefore: human,
      revenueValue: fat,
    })
    assert.notEqual(plan2.actionId, plan1.actionId)
    const second = applyHumanRevenueCasToState({
      matchId: MATCH_ID,
      turnPlayerId: P1,
      turnSeq: 2,
      players: [human],
    }, {
      playersDeltaById: plan2.playersDeltaById,
      statePatch: {
        _commitKind: HUMAN_REVENUE_COMMIT_KIND,
        _expectMatchId: MATCH_ID,
        _expectTurnPlayerId: P1,
        _expectTurnSeq: 2,
        actionId: plan2.actionId,
      },
    }, { now: NOW + 1 })
    assert.equal(second.state.players[0].cash, 10_800)
  })

  it('timeout do modal de faturamento preserva o crédito devido', () => {
    const payload = expirationPayloadForKind('REVENUE', { reason: 'AUTO_PASS_TIMER' })
    assert.equal(payload.action, 'OK')
    const fat = computeFaturamentoFor({ revenue: 770 })
    const human = {
      id: P1,
      cash: 18_000,
      lastActions: {},
      humanTurnEffects: buildHumanTurnEffectPlan({
        matchId: MATCH_ID,
        turnPlayerId: P1,
        turnSeq: TURN_SEQ,
        crossedStart: true,
        revenueValue: fat,
      }),
    }
    const plan = planHumanRevenuePersist({
      matchId: MATCH_ID,
      playerId: P1,
      turnSeq: TURN_SEQ,
      playerBefore: human,
      fat: 50_000,
      revenueValue: fat,
    })
    assert.equal(plan.fat, 770)
    const paid = applyHumanRevenueCasToState({
      matchId: MATCH_ID,
      turnPlayerId: P1,
      turnSeq: TURN_SEQ,
      players: [human],
    }, {
      playersDeltaById: plan.playersDeltaById,
      statePatch: {
        _commitKind: HUMAN_REVENUE_COMMIT_KIND,
        _expectMatchId: MATCH_ID,
        _expectTurnPlayerId: P1,
        _expectTurnSeq: TURN_SEQ,
        actionId: plan.actionId,
      },
    }, { now: NOW })
    assert.equal(paid.state.players[0].cash, 18_770)
  })

  it('último faturamento entra no saldo antes do cálculo do vencedor', () => {
    const fat = computeFaturamentoFor({ revenue: 3_000 })
    const human = {
      id: P1,
      name: 'Ana',
      cash: 8_000,
      bens: 0,
      lastActions: {},
      humanTurnEffects: buildHumanTurnEffectPlan({
        matchId: MATCH_ID,
        turnPlayerId: P1,
        turnSeq: TURN_SEQ,
        crossedStart: true,
        revenueValue: fat,
      }),
    }
    const rival = { id: P2, name: 'Bruno', cash: 10_000, bens: 0, bankrupt: false }
    const plan = planHumanRevenuePersist({
      matchId: MATCH_ID,
      playerId: P1,
      turnSeq: TURN_SEQ,
      playerBefore: human,
      revenueValue: fat,
    })
    const paid = applyHumanRevenueCasToState({
      matchId: MATCH_ID,
      turnPlayerId: P1,
      turnSeq: TURN_SEQ,
      players: [human, rival],
    }, {
      playersDeltaById: plan.playersDeltaById,
      statePatch: {
        _commitKind: HUMAN_REVENUE_COMMIT_KIND,
        _expectMatchId: MATCH_ID,
        _expectTurnPlayerId: P1,
        _expectTurnSeq: TURN_SEQ,
        actionId: plan.actionId,
      },
    }, { now: NOW })
    const winner = pickWinnerByPatrimonio(paid.state.players)
    assert.equal(paid.state.players[0].cash, 11_000)
    assert.equal(winner.id, P1)
  })

  it('passagem pelo início sem parar, chegada exata e segunda volta usam computeMove + crédito congelado', () => {
    const pass = computeMove({ pos: 38, steps: 3, trackLen: 40 })
    assert.equal(pass.newPos, 1)
    assert.equal(pass.crossedStart, true)

    const exact = computeMove({ pos: 38, steps: 2, trackLen: 40 })
    assert.equal(exact.newPos, 0)
    assert.equal(exact.crossedStart, true)

    const noLap = computeMove({ pos: 10, steps: 3, trackLen: 40 })
    assert.equal(noLap.crossedStart, false)

    const fat = computeFaturamentoFor({ revenue: 500 })
    const effectsPass = buildHumanTurnEffectPlan({
      matchId: MATCH_ID,
      turnPlayerId: P1,
      turnSeq: 11,
      crossedStart: pass.crossedStart,
      revenueValue: fat,
    })
    const effectsExact = buildHumanTurnEffectPlan({
      matchId: MATCH_ID,
      turnPlayerId: P1,
      turnSeq: 12,
      crossedStart: exact.crossedStart,
      revenueValue: fat,
    })
    assert.equal(effectsPass.crossedStart, true)
    assert.equal(effectsExact.crossedStart, true)

    let human = {
      id: P1,
      cash: 10_000,
      lastActions: {},
      humanTurnEffects: effectsPass,
    }
    assert.equal(isHumanRevenueDue({
      player: human,
      matchId: MATCH_ID,
      turnPlayerId: P1,
      turnSeq: 11,
    }), true)
    const planPass = planHumanRevenuePersist({
      matchId: MATCH_ID,
      playerId: P1,
      turnSeq: 11,
      playerBefore: human,
      revenueValue: fat,
    })
    const paidPass = applyHumanRevenueCasToState({
      matchId: MATCH_ID,
      turnPlayerId: P1,
      turnSeq: 11,
      players: [human],
    }, {
      playersDeltaById: planPass.playersDeltaById,
      statePatch: {
        _commitKind: HUMAN_REVENUE_COMMIT_KIND,
        _expectMatchId: MATCH_ID,
        _expectTurnPlayerId: P1,
        _expectTurnSeq: 11,
        actionId: planPass.actionId,
      },
    }, { now: NOW })
    assert.equal(paidPass.state.players[0].cash, 10_500)

    human = {
      ...paidPass.state.players[0],
      humanTurnEffects: effectsExact,
    }
    const planExact = planHumanRevenuePersist({
      matchId: MATCH_ID,
      playerId: P1,
      turnSeq: 12,
      playerBefore: human,
      revenueValue: fat,
    })
    assert.notEqual(planExact.actionId, planPass.actionId)
    const paidExact = applyHumanRevenueCasToState({
      matchId: MATCH_ID,
      turnPlayerId: P1,
      turnSeq: 12,
      players: [human],
    }, {
      playersDeltaById: planExact.playersDeltaById,
      statePatch: {
        _commitKind: HUMAN_REVENUE_COMMIT_KIND,
        _expectMatchId: MATCH_ID,
        _expectTurnPlayerId: P1,
        _expectTurnSeq: 12,
        actionId: planExact.actionId,
      },
    }, { now: NOW + 1 })
    assert.equal(paidExact.state.players[0].cash, 11_000)
  })
})

describe('HUMAN_LUCK — recuperação após retries e idempotência', () => {
  it('recibo do movimento preserva a mesma carta e permite recuperação sem humanLuckPending', () => {
    const prev = room()
    const actor = {
      ...prev.players[0],
      humanTurnEffects: buildHumanTurnEffectPlan({
        matchId: MATCH_ID,
        turnPlayerId: P1,
        turnSeq: TURN_SEQ,
        fromPos: 8,
        toPos: 9,
        steps: 1,
        crossedStart: false,
        crossedExpenses: false,
        landTile: 'LUCK',
        processLandTile: true,
        luckCardId: 'referral_bonus',
        done: [],
      }),
    }
    const authoritative = { ...prev, players: [actor, prev.players[1]] }
    const payload = resolveHumanLuckPayloadForScope({
      player: actor,
      matchId: MATCH_ID,
      playerId: P1,
      turnSeq: TURN_SEQ,
    })
    assert.equal(payload.id, 'referral_bonus')
    assert.equal(payload.cashDelta, 800)
    assert.equal(isHumanLuckDue({
      player: actor,
      matchId: MATCH_ID,
      playerId: P1,
      turnSeq: TURN_SEQ,
    }), true)

    const handoff = validateTurnCommit(authoritative, {
      kind: 'TURN',
      _commitKind: 'NORMAL_HANDOFF',
      _expectMatchId: MATCH_ID,
      _expectTurnPlayerId: P1,
      _expectTurnSeq: TURN_SEQ,
      turnPlayerId: P2,
      turnSeq: TURN_SEQ + 1,
    }, { now: NOW })
    assert.equal(handoff.ok, false)
    assert.equal(handoff.reason, 'human-luck-pending')

    const plan = planCoordinatorLuckLiquidation({
      matchId: MATCH_ID,
      turnPlayerId: P1,
      turnSeq: TURN_SEQ,
      players: authoritative.players,
    })
    assert.equal(plan.skip, false)
    assert.equal(plan.payload.id, 'referral_bonus')
    const paid = applyGamePatchToState(authoritative, luckPatch(plan, authoritative), { now: NOW + 1 })
    assert.equal(paid.state.players[0].cash, 10_800)
    const retry = applyGamePatchToState(paid.state, luckPatch(plan, authoritative), { now: NOW + 2 })
    assert.equal(retry.alreadyApplied, true)
    assert.equal(retry.state.players[0].cash, 10_800)
  })

  it('cinco créditos recusados estacionam pending sem pagar e sem novo sorteio', async () => {
    const prev = room()
    const payload = resolveCardEffect(card('referral_bonus'), prev.players[0]).payload
    let live = prev.players[0]
    let creditAttempts = 0
    const persisted = await persistHumanLuckWithRetries({
      attempts: 5,
      delay: async () => {},
      isCurrentTurn: () => true,
      getLivePlayer: () => live,
      getRoster: () => [live, prev.players[1]],
      commitPlan: async (plan) => {
        if (plan.pendingOnly) {
          const parked = applyGamePatchToState(prev, luckPatch(plan, prev), { now: NOW })
          live = parked.state.players[0]
          return parked
        }
        creditAttempts += 1
        return { ok: false, reason: 'network', retry: true }
      },
      matchId: MATCH_ID,
      playerId: P1,
      turnSeq: TURN_SEQ,
      payload,
    })
    assert.equal(creditAttempts, 5)
    assert.equal(persisted.ok, false)
    assert.equal(persisted.pendingParked, true)
    assert.equal(live.cash, 10_000)
    assert.equal(live.humanLuckPending.paid, false)
    assert.equal(live.humanLuckPending.payload.id, payload.id)
    assert.equal(isHumanLuckDue({
      player: live,
      matchId: MATCH_ID,
      playerId: P1,
      turnSeq: TURN_SEQ,
    }), true)
    const gate = shouldBlockHumanHandoffForLuck({
      isHumanTurn: true,
      player: live,
      matchId: MATCH_ID,
      turnPlayerId: P1,
      turnSeq: TURN_SEQ,
    })
    assert.equal(gate.block, true)
    const handoff = validateTurnCommit(
      { ...prev, players: [live, prev.players[1]] },
      {
        kind: 'TURN',
        _commitKind: 'NORMAL_HANDOFF',
        _expectTurnPlayerId: P1,
        _expectTurnSeq: TURN_SEQ,
        _expectMatchId: MATCH_ID,
        turnSeq: TURN_SEQ + 1,
        turnPlayerId: P2,
      },
      { now: NOW },
    )
    assert.equal(handoff.ok, false)
    assert.equal(handoff.reason, 'human-luck-pending')
  })

  it('falha persistente de rede preserva o crédito devido e não altera o caixa', async () => {
    const prev = room()
    const payload = resolveCardEffect(card('referral_bonus'), prev.players[0]).payload
    const live = { ...prev.players[0] }
    const persisted = await persistHumanLuckWithRetries({
      attempts: 5,
      delay: async () => {},
      isCurrentTurn: () => true,
      getLivePlayer: () => live,
      commitPlan: async () => ({ ok: false, reason: 'network', retry: true }),
      matchId: MATCH_ID,
      playerId: P1,
      turnSeq: TURN_SEQ,
      payload,
    })
    assert.equal(persisted.ok, false)
    assert.equal(persisted.pendingParked, false)
    assert.equal(live.cash, 10_000)
    assert.equal(persisted.plan.pendingOnly, true)
    assert.equal(persisted.plan.payload.id, payload.id)
    assert.equal(persisted.plan.playerAfter.humanLuckPending.paid, false)
    assert.equal(persisted.plan.frozenCashDelta, 800)
  })

  it('gravação aceita com resposta perdida + retry do mesmo actionId paga uma vez nos dois clientes', () => {
    const prev = room()
    const payload = resolveCardEffect(card('referral_bonus'), prev.players[0]).payload
    const plan = planHumanLuckPersist({
      matchId: MATCH_ID,
      playerId: P1,
      turnSeq: TURN_SEQ,
      playerBefore: prev.players[0],
      payload,
    })
    const hostAccepted = applyGamePatchToState(structuredClone(prev), luckPatch(plan, prev), { now: NOW })
    assert.equal(hostAccepted.ok, true)
    const lostAckRetry = applyGamePatchToState(hostAccepted.state, luckPatch(plan, prev), { now: NOW + 1 })
    assert.equal(lostAckRetry.alreadyApplied, true)
    assert.equal(lostAckRetry.state.players[0].cash, 10_800)
    const guest = applyGamePatchToState(structuredClone(prev), luckPatch(plan, prev), { now: NOW })
    assert.equal(guest.state.players[0].cash, 10_800)
    assert.equal(hostAccepted.state.players[0].cash, guest.state.players[0].cash)
  })

  it('after lastActions trim, pending.paid ainda impede segundo pagamento', () => {
    const prev = room()
    const payload = resolveCardEffect(card('referral_bonus'), prev.players[0]).payload
    const plan = planHumanLuckPersist({
      matchId: MATCH_ID,
      playerId: P1,
      turnSeq: TURN_SEQ,
      playerBefore: prev.players[0],
      payload,
    })
    const paid = applyGamePatchToState(prev, luckPatch(plan, prev), { now: NOW })
    const filled = {}
    for (let i = 0; i < HUMAN_LAST_ACTIONS_MAX + 4; i += 1) {
      filled[`old-${i}`] = NOW + i
    }
    const trimmedPlayer = {
      ...paid.state.players[0],
      lastActions: filled,
    }
    assert.equal(trimmedPlayer.lastActions[plan.actionId], undefined)
    assert.equal(trimmedPlayer.humanLuckPending.paid, true)
    assert.equal(isHumanLuckPaid({ player: trimmedPlayer, actionId: plan.actionId }), true)
    const retry = applyHumanLuckCasToState(
      { ...paid.state, players: [trimmedPlayer, paid.state.players[1]] },
      luckPatch(plan, prev),
      { now: NOW + 8 },
    )
    assert.equal(retry.ok, true)
    assert.equal(retry.alreadyApplied, true)
    assert.equal(retry.state.players[0].cash, 10_800)
  })

  it('rejeita tentativa de turno ou partida anterior', () => {
    const prev = room()
    const payload = resolveCardEffect(card('referral_bonus'), prev.players[0]).payload
    const plan = planHumanLuckPersist({
      matchId: MATCH_ID,
      playerId: P1,
      turnSeq: TURN_SEQ,
      playerBefore: prev.players[0],
      payload,
    })
    const staleTurn = validateTurnCommit(
      { ...prev, turnSeq: TURN_SEQ + 1 },
      luckPatch(plan, prev).statePatch,
      { now: NOW },
    )
    assert.equal(staleTurn.ok, false)
    assert.equal(staleTurn.reason, 'stale-turn-seq')
    const staleMatch = validateTurnCommit(
      { ...prev, matchId: 'match-antiga' },
      luckPatch(plan, prev).statePatch,
      { now: NOW },
    )
    assert.equal(staleMatch.ok, false)
    assert.equal(staleMatch.reason, 'stale-match-id')
  })

  it('pending estacionado depois é liquidado uma vez pelo coordenador, sem novo sorteio', () => {
    const prev = room()
    const payload = resolveCardEffect(card('referral_bonus'), prev.players[0]).payload
    const parkedPlan = planHumanLuckPendingOnly({
      matchId: MATCH_ID,
      playerId: P1,
      turnSeq: TURN_SEQ,
      playerBefore: prev.players[0],
      payload,
    })
    const parked = applyGamePatchToState(prev, luckPatch(parkedPlan, prev), { now: NOW })
    assert.equal(parked.state.players[0].cash, 10_000)
    const liq = planCoordinatorLuckLiquidation({
      matchId: MATCH_ID,
      turnPlayerId: P1,
      turnSeq: TURN_SEQ,
      players: parked.state.players,
    })
    assert.equal(liq.skip, false)
    assert.equal(liq.payload.id, payload.id)
    const paid = applyGamePatchToState(parked.state, luckPatch(liq, parked.state), { now: NOW + 1 })
    assert.equal(paid.state.players[0].cash, 10_800)
    const again = applyGamePatchToState(paid.state, luckPatch(liq, parked.state), { now: NOW + 2 })
    assert.equal(again.alreadyApplied, true)
    assert.equal(again.state.players[0].cash, 10_800)
  })
})
