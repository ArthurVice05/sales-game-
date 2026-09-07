/**
 * Runtime econômico da Máquina — ator, fila, builders, commit absoluto,
 * actionId estável, settled e F5. Não altera botPolicy.
 */
import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { applyDeltas, applyTrainingPurchase } from '../gameMath.js'
import { applySorteRevesPayloadToPlayer } from '../sorteRevesApply.js'
import { applyRecoveryPayloadToPlayer } from '../bots/botRecoveryApply.js'
import {
  applyBankruptcyState,
  decideEndgameAfterBankruptcy,
  resolveAftermathAfterBankruptcy,
  commitBankruptcyAftermath,
} from '../matchForfeit.js'
import { createBotRng } from '../bots/botRandom.js'
import { pickSorteRevesCard, resolveSorteRevesCard } from '../sorteRevesCards.js'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { applyMandatoryCashCharge } from '../bots/botEconomicCharge.js'
import { buildClientsPurchaseDeltas } from '../clientsPurchase.js'
import { buildCommonSellersPurchaseDeltas } from '../commonSellersPurchase.js'
import { buildFieldSalesPurchaseDeltas } from '../fieldSalesPurchase.js'
import { buildInsideSalesPurchaseDeltas } from '../insideSalesPurchase.js'
import { buildManagerPurchaseDeltas } from '../managersPurchase.js'
import { buildErpPurchaseDeltas } from '../erpPurchase.js'
import { buildMixPurchaseDeltas } from '../productMixPurchase.js'
import {
  ACTION_SKIP,
  buildClientsBuyPayload,
  buildCommonSellersBuyPayload,
  buildDirectOpenPayload,
  buildErpBuyPayload,
  buildFieldSalesBuyPayload,
  buildInsideSalesBuyPayload,
  buildManagerBuyPayload,
  buildMixBuyPayload,
  buildTrainingBuyPayload,
  buildLoanPayload,
  buildFirePayload,
  buildReducePayload,
  buildTriggerBankruptcyPayload,
} from '../bots/botModalContracts.js'
import {
  buildBotEconomicPlayerDelta,
  buildBotEffectActionId,
  buildBotTurnEffectPlan,
  createAuthoritativeEconomicStore,
  hasBotEffectAction,
  isBotTurnEffectsSettled,
  remainingEffectKinds,
  requiredEffectKinds,
  botLuckRecoveryInfo,
  reconstructBotLuckPayload,
  resolveBotLuckSeed,
  runBotEconomicEffectsLoop,
  shouldAcceptBotEconomicJob,
  shouldBlockBotHandoffForEffects,
  shouldRescheduleBotEconomicEffects,
  shouldResumeLeftoverBotEffects,
  shouldRunBotEconomicEffects,
} from '../bots/botEconomicRuntime.js'
import {
  classifyBotTurnRecovery,
  rebuildBotPendingAfterConfirmedMove,
} from '../bots/botReloadRecovery.js'
import { applyBroadcastCommitExpect, validateTurnCommit } from '../turnCommitValidation.js'
import { buildBotMoveActionId } from '../bots/botMoveBarrier.js'
import { shouldFinishAfterRoundTransition } from '../roundEndDecision.js'

const MATCH_ID = 'match-econ-1'
const BOT_ID = 'bot:match-econ-1:0'
const HUMAN_ID = 'human-A'
const TAB_X = 'tab-X'
const TAB_Y = 'tab-Y'
const TURN_SEQ = 4

function claimProofFor(executor = TAB_X) {
  return {
    matchId: MATCH_ID,
    turnPlayerId: BOT_ID,
    turnSeq: TURN_SEQ,
    turnKey: `${MATCH_ID}|${BOT_ID}|${TURN_SEQ}`,
    executorId: executor,
    lockOwner: HUMAN_ID,
    seed: [7, 3, 1, 9],
  }
}

function authFor(executor = TAB_X, remote = executor) {
  return {
    myUid: HUMAN_ID,
    lockOwner: HUMAN_ID,
    executorId: executor,
    remoteExecutorId: remote,
    claimProof: claimProofFor(executor),
  }
}

function botPlayer(extra = {}) {
  return {
    id: BOT_ID,
    name: 'Máquina 1',
    isBot: true,
    controller: 'BOT',
    pos: 5,
    cash: 18000,
    bens: 4000,
    clients: 1,
    vendedoresComuns: 1,
    fieldSales: 0,
    insideSales: 0,
    gestores: 0,
    erpLevel: 'D',
    mixProdutos: 'D',
    manutencao: 0,
    lastRevenueRound: 1,
    waitingAtRevenue: false,
    bankrupt: false,
    lastActions: {},
    ...extra,
  }
}

function humanPlayer(extra = {}) {
  return {
    id: HUMAN_ID,
    name: 'Arthur',
    isBot: false,
    pos: 2,
    cash: 12000,
    bens: 4000,
    lastRevenueRound: 1,
    waitingAtRevenue: false,
    bankrupt: false,
    ...extra,
  }
}

function planFor(kind, extra = {}) {
  const { luckPayload, luckCardId, ...planArgs } = extra
  const plan = buildBotTurnEffectPlan({
    matchId: MATCH_ID,
    turnPlayerId: BOT_ID,
    turnSeq: TURN_SEQ,
    fromPos: 3,
    toPos: 7,
    steps: 4,
    crossedStart: false,
    crossedExpenses: false,
    landTile: kind,
    processLandTile: true,
    settled: false,
    done: [],
    ...planArgs,
  })
  if (luckPayload) plan.luckPayload = luckPayload
  if (luckCardId != null) plan.luckCardId = luckCardId
  return plan
}

function storeWithPlan(kind, playerExtra = {}, planExtra = {}, storeExtra = {}) {
  const plan = planFor(kind, planExtra)
  const bot = botPlayer({ botTurnEffects: plan, ...playerExtra })
  const others = Array.isArray(storeExtra.others) ? storeExtra.others : [humanPlayer()]
  const store = createAuthoritativeEconomicStore({
    matchId: MATCH_ID,
    turnPlayerId: BOT_ID,
    turnSeq: TURN_SEQ,
    lockOwner: HUMAN_ID,
    botClaimExecutor: TAB_X,
    botTurnSeed: Object.prototype.hasOwnProperty.call(storeExtra, 'botTurnSeed')
      ? storeExtra.botTurnSeed
      : [7, 3, 1, 9],
    players: [...others, bot],
  })
  return { store, plan, bot }
}

function continueFromStore(store, extra = {}, auth = authFor(TAB_X)) {
  return () => {
    const live = store.getLive()
    const originSeq = extra.turnSeq ?? TURN_SEQ
    if (live.gameOver === true) return { ok: false, reason: 'game-over', terminal: true }
    if (String(live.turnPlayerId ?? BOT_ID) !== String(BOT_ID)) {
      return { ok: false, reason: 'turn-player-changed', terminal: true }
    }
    if ((Number(live.turnSeq) || 0) !== (Number(originSeq) || 0)) {
      return { ok: false, reason: 'turn-seq-changed', terminal: true }
    }
    const gate = shouldRunBotEconomicEffects({
      currentPlayer: live.currentPlayer,
      turnPlayerId: live.turnPlayerId ?? BOT_ID,
      myUid: extra.myUid ?? auth.myUid,
      lockOwner: live.remoteLockOwner || live.lockOwner,
      gameOver: live.gameOver === true,
      executorId: extra.executorId ?? auth.executorId,
      remoteExecutorId: live.botClaimExecutor || extra.remoteExecutorId || auth.remoteExecutorId,
      claimProof: extra.claimProof ?? auth.claimProof,
      matchId: live.matchId ?? MATCH_ID,
      turnSeq: originSeq,
    })
    if (gate.ok) return { ok: true }
    return {
      ok: false,
      reason: gate.reason,
      terminal: gate.terminal === true,
      retry: gate.retry === true,
    }
  }
}

async function runOnce(store, decide, extra = {}) {
  const auth = extra.auth || authFor(TAB_X)
  return runBotEconomicEffectsLoop({
    matchId: MATCH_ID,
    turnPlayerId: BOT_ID,
    turnSeq: extra.turnSeq ?? TURN_SEQ,
    myUid: extra.myUid ?? auth.myUid,
    getLive: () => {
      const live = store.getLive()
      return {
        ...live,
        extrasFor: extra.extrasFor,
        executorId: extra.executorId ?? auth.executorId,
        remoteExecutorId: live.botClaimExecutor || auth.remoteExecutorId,
        claimProof: extra.claimProof ?? auth.claimProof,
        botTurnSeed: live.botTurnSeed,
      }
    },
    decide,
    commit: (args) => store.commit({ ...args, executorId: extra.executorId ?? auth.executorId }),
    shouldContinue: extra.shouldContinue || continueFromStore(store, extra, auth),
    sleep: extra.sleep || (async () => {}),
  })
}

function actorOf(store) {
  return store.getLive().currentPlayer
}

function liveWithAuth(store, executor = TAB_X) {
  const live = store.getLive()
  const auth = authFor(executor, live.botClaimExecutor || TAB_X)
  return {
    ...live,
    executorId: executor,
    remoteExecutorId: live.botClaimExecutor,
    claimProof: { ...auth.claimProof, executorId: executor },
    botTurnSeed: live.botTurnSeed,
  }
}

describe('gate de ator', () => {
  it('O — só o holder do lease executa; outra aba viva recusa', () => {
    const bot = botPlayer()
    const local = shouldRunBotEconomicEffects({
      currentPlayer: bot,
      turnPlayerId: BOT_ID,
      ...authFor(TAB_X),
    })
    const otherTab = shouldRunBotEconomicEffects({
      currentPlayer: bot,
      turnPlayerId: BOT_ID,
      myUid: 'other-client',
      lockOwner: HUMAN_ID,
      executorId: TAB_X,
      remoteExecutorId: TAB_X,
      claimProof: claimProofFor(TAB_X),
    })
    const humanTurn = shouldRunBotEconomicEffects({
      currentPlayer: humanPlayer(),
      turnPlayerId: HUMAN_ID,
      myUid: HUMAN_ID,
      lockOwner: HUMAN_ID,
      executorId: TAB_X,
      remoteExecutorId: TAB_X,
    })
    assert.equal(local.ok, true)
    assert.equal(otherTab.ok, false)
    assert.equal(otherTab.reason, 'not-lease-holder')
    assert.equal(humanTurn.ok, false)
    assert.equal(humanTurn.reason, 'not-bot-turn')
  })

  it('H — mesma myUid, duas tabs: só o executor autorizado executa', () => {
    const bot = botPlayer()
    const x = shouldRunBotEconomicEffects({
      currentPlayer: bot,
      turnPlayerId: BOT_ID,
      ...authFor(TAB_X, TAB_X),
    })
    const y = shouldRunBotEconomicEffects({
      currentPlayer: bot,
      turnPlayerId: BOT_ID,
      ...authFor(TAB_Y, TAB_X),
    })
    assert.equal(x.ok, true)
    assert.equal(y.ok, false)
    assert.ok(['executor-mismatch', 'not-remote-executor', 'remote-contradicts-proof'].includes(y.reason))
  })

  it('N — actionId econômico não inclui executor/tab', () => {
    const a = buildBotEffectActionId({
      matchId: MATCH_ID,
      playerId: BOT_ID,
      turnSeq: TURN_SEQ,
      effectKind: 'CLIENTS',
    })
    const b = buildBotEffectActionId({
      matchId: MATCH_ID,
      playerId: BOT_ID,
      turnSeq: TURN_SEQ,
      effectKind: 'CLIENTS',
    })
    assert.equal(a, `bot-effect:${MATCH_ID}:${BOT_ID}:${TURN_SEQ}:CLIENTS`)
    assert.equal(a, b)
    assert.equal(a.includes(TAB_X), false)
    assert.equal(a.includes(TAB_Y), false)
    const moveX = buildBotMoveActionId({
      matchId: MATCH_ID,
      turnPlayerId: BOT_ID,
      turnSeq: TURN_SEQ,
      executorId: TAB_X,
    })
    const moveY = buildBotMoveActionId({
      matchId: MATCH_ID,
      turnPlayerId: BOT_ID,
      turnSeq: TURN_SEQ,
      executorId: TAB_Y,
    })
    assert.notEqual(moveX, moveY)
  })
})

describe('A — CLIENTS BUY', () => {
  it('cash cai, clients sobe, bens/manutenção do builder, 1 commit lógico', async () => {
    const { store } = storeWithPlan('CLIENTS')
    const payload = buildClientsBuyPayload(1)
    const before = { ...actorOf(store) }
    const humanAfter = applyDeltas(before, buildClientsPurchaseDeltas(payload))
    const result = await runOnce(store, async () => payload)
    const after = actorOf(store)
    assert.equal(result.ok, true)
    assert.equal(result.commits, 1)
    assert.equal(after.cash, before.cash - payload.totalCost)
    assert.equal(after.clients, before.clients + 1)
    assert.equal(after.bens, humanAfter.bens)
    assert.equal(after.manutencao, humanAfter.manutencao)
    assert.equal(after.cash, humanAfter.cash)
    assert.equal(isBotTurnEffectsSettled(after.botTurnEffects), true)
    assert.equal(store.state.appliedActionIds.length, 1)
  })
})

describe('B — CLIENTS SKIP', () => {
  it('zero alteração econômica e efeito settled', async () => {
    const { store } = storeWithPlan('CLIENTS')
    const before = { ...actorOf(store) }
    const result = await runOnce(store, async () => ({ ...ACTION_SKIP }))
    const after = actorOf(store)
    assert.equal(result.ok, true)
    assert.equal(after.cash, before.cash)
    assert.equal(after.clients, before.clients)
    assert.equal(after.bens, before.bens)
    assert.equal(isBotTurnEffectsSettled(after.botTurnEffects), true)
    assert.equal(after.botTurnEffects.done.includes('CLIENTS'), true)
  })
})

describe('C — ERP BUY', () => {
  it('mesmo builder humano', async () => {
    const { store } = storeWithPlan('ERP')
    const payload = buildErpBuyPayload('C')
    const before = { ...actorOf(store) }
    const humanAfter = applyDeltas(before, buildErpPurchaseDeltas(payload))
    await runOnce(store, async () => payload)
    const after = actorOf(store)
    assert.equal(after.cash, humanAfter.cash)
    assert.equal(after.erpLevel, humanAfter.erpLevel)
    assert.equal(isBotTurnEffectsSettled(after.botTurnEffects), true)
  })
})

describe('D — MIX BUY', () => {
  it('cash e mix iguais ao builder humano', async () => {
    const { store } = storeWithPlan('MIX')
    const payload = buildMixBuyPayload('C')
    const before = { ...actorOf(store) }
    const humanAfter = applyDeltas(before, buildMixPurchaseDeltas(payload))
    await runOnce(store, async () => payload)
    const after = actorOf(store)
    assert.equal(after.cash, humanAfter.cash)
    assert.equal(after.mixProdutos, humanAfter.mixProdutos)
    assert.equal(after.bens, humanAfter.bens)
  })
})

describe('E — COMMON / FIELD / INSIDE / MANAGER', () => {
  it('COMMON', async () => {
    const { store } = storeWithPlan('COMMON')
    const payload = buildCommonSellersBuyPayload(1)
    const before = { ...actorOf(store) }
    const humanAfter = applyDeltas(before, buildCommonSellersPurchaseDeltas(payload))
    await runOnce(store, async () => payload)
    const after = actorOf(store)
    assert.equal(after.cash, humanAfter.cash)
    assert.equal(after.vendedoresComuns, humanAfter.vendedoresComuns)
  })

  it('FIELD', async () => {
    const { store } = storeWithPlan('FIELD')
    const payload = buildFieldSalesBuyPayload(1)
    const before = { ...actorOf(store) }
    const humanAfter = applyDeltas(before, buildFieldSalesPurchaseDeltas(payload))
    await runOnce(store, async () => payload)
    assert.equal(actorOf(store).fieldSales, humanAfter.fieldSales)
    assert.equal(actorOf(store).cash, humanAfter.cash)
  })

  it('INSIDE', async () => {
    const { store } = storeWithPlan('INSIDE')
    const payload = buildInsideSalesBuyPayload(1)
    const before = { ...actorOf(store) }
    const humanAfter = applyDeltas(before, buildInsideSalesPurchaseDeltas(payload))
    await runOnce(store, async () => payload)
    assert.equal(actorOf(store).insideSales, humanAfter.insideSales)
    assert.equal(actorOf(store).cash, humanAfter.cash)
  })

  it('MANAGER', async () => {
    const { store } = storeWithPlan('MANAGER')
    const payload = buildManagerBuyPayload(1)
    const before = { ...actorOf(store) }
    const humanAfter = applyDeltas(before, buildManagerPurchaseDeltas(payload))
    await runOnce(store, async () => payload)
    assert.equal(actorOf(store).gestores, humanAfter.gestores)
    assert.equal(actorOf(store).cash, humanAfter.cash)
  })
})

describe('F — TRAINING', () => {
  it('mesmo applyTrainingPurchase humano', async () => {
    const { store } = storeWithPlan('TRAINING')
    const payload = buildTrainingBuyPayload({ vendorType: 'comum', productId: 'personalizado' })
    const before = { ...actorOf(store) }
    const humanAfter = applyTrainingPurchase(before, payload)
    await runOnce(store, async () => payload)
    const after = actorOf(store)
    assert.equal(after.cash, humanAfter.cash)
    assert.equal(after.bens, humanAfter.bens)
    assert.equal(after.onboarding, true)
  })
})

describe('G — DIRECT_BUY', () => {
  it('OPEN → escolha → exatamente uma compra', async () => {
    const { store } = storeWithPlan('DIRECT_BUY')
    const mix = buildMixBuyPayload('C')
    let phase = 0
    const before = { ...actorOf(store) }
    const humanAfter = applyDeltas(before, buildMixPurchaseDeltas(mix))
    await runOnce(store, async ({ kind }) => {
      phase += 1
      if (kind === 'DIRECT_BUY') return buildDirectOpenPayload('MIX')
      return mix
    })
    const after = actorOf(store)
    assert.equal(phase, 2)
    assert.equal(after.cash, humanAfter.cash)
    assert.equal(after.mixProdutos, humanAfter.mixProdutos)
    assert.equal(isBotTurnEffectsSettled(after.botTurnEffects), true)
    assert.equal(
      hasBotEffectAction(after.lastActions, buildBotEffectActionId({
        matchId: MATCH_ID,
        playerId: BOT_ID,
        turnSeq: TURN_SEQ,
        effectKind: 'DIRECT_BUY',
      })),
      true,
    )
    assert.equal(
      hasBotEffectAction(after.lastActions, buildBotEffectActionId({
        matchId: MATCH_ID,
        playerId: BOT_ID,
        turnSeq: TURN_SEQ,
        effectKind: 'DIRECT_BUY:MIX',
      })),
      true,
    )
  })
})

describe('H — caixa insuficiente', () => {
  it('não compra e não duplica no retry', async () => {
    const { store } = storeWithPlan('CLIENTS', { cash: 100 })
    const payload = buildClientsBuyPayload(1)
    await runOnce(store, async () => payload)
    const mid = actorOf(store)
    assert.equal(mid.cash, 100)
    assert.equal(mid.clients, 1)
    await runOnce(store, async () => payload)
    const after = actorOf(store)
    assert.equal(after.cash, 100)
    assert.equal(after.clients, 1)
    assert.equal(isBotTurnEffectsSettled(after.botTurnEffects), true)
  })
})

describe('I / J — tick hold vs handoff', () => {
  it('I — BOT_MOVE confirmado e efeito pendente bloqueia handoff', () => {
    const plan = planFor('CLIENTS')
    const gate = shouldBlockBotHandoffForEffects({
      isBotTurn: true,
      effects: plan,
      economicBusy: false,
    })
    assert.equal(gate.block, true)
    assert.equal(gate.reason, 'effects-pending')
    assert.equal(isBotTurnEffectsSettled(plan), false)
  })

  it('J — commit settled libera o tick', async () => {
    const { store } = storeWithPlan('CLIENTS')
    await runOnce(store, async () => buildClientsBuyPayload(1))
    const after = actorOf(store)
    const gate = shouldBlockBotHandoffForEffects({
      isBotTurn: true,
      effects: after.botTurnEffects,
      economicBusy: false,
    })
    assert.equal(gate.block, false)
    assert.equal(gate.reason, 'settled')
  })
})

describe('K L M — janelas F5', () => {
  it('K — F5 antes da decisão retoma uma vez', async () => {
    const { store } = storeWithPlan('CLIENTS')
    const leftover = shouldResumeLeftoverBotEffects({
      players: store.state.players,
      matchId: MATCH_ID,
      turnPlayerId: BOT_ID,
      turnSeq: TURN_SEQ,
      currentPlayer: actorOf(store),
      ...authFor(TAB_X),
    })
    assert.equal(leftover.ok, true)
    assert.deepEqual(leftover.remaining, ['CLIENTS'])
    let decisions = 0
    const result = await runOnce(store, async () => {
      decisions += 1
      return buildClientsBuyPayload(1)
    })
    assert.equal(decisions, 1)
    assert.equal(result.commits, 1)
    assert.equal(isBotTurnEffectsSettled(actorOf(store).botTurnEffects), true)
  })

  it('L — F5 depois da decisão e antes do commit não duplica BUY', async () => {
    const { store } = storeWithPlan('CLIENTS')
    const payload = buildClientsBuyPayload(1)
    const beforeCash = actorOf(store).cash
    let commitAttempts = 0
    let decideCalls = 0
    const flakyCommit = (args) => {
      commitAttempts += 1
      if (commitAttempts === 1) return { ok: false, reason: 'network' }
      return store.commit(args)
    }
    const decide = async () => {
      decideCalls += 1
      return payload
    }
    const first = await runBotEconomicEffectsLoop({
      matchId: MATCH_ID,
      turnPlayerId: BOT_ID,
      turnSeq: TURN_SEQ,
      myUid: HUMAN_ID,
      getLive: () => liveWithAuth(store),
      decide,
      commit: flakyCommit,
      shouldContinue: continueFromStore(store),
      sleep: async () => {},
    })
    assert.equal(first.ok, true)
    assert.equal(commitAttempts, 2)
    assert.equal(decideCalls, 1)
    assert.equal(actorOf(store).cash, beforeCash - payload.totalCost)
    assert.equal(actorOf(store).clients, 2)
    assert.equal(store.state.commits, 1)
    const second = await runBotEconomicEffectsLoop({
      matchId: MATCH_ID,
      turnPlayerId: BOT_ID,
      turnSeq: TURN_SEQ,
      myUid: HUMAN_ID,
      getLive: () => liveWithAuth(store),
      decide,
      commit: flakyCommit,
      shouldContinue: continueFromStore(store),
      sleep: async () => {},
    })
    assert.equal(second.reason, 'already-settled')
    assert.equal(actorOf(store).cash, beforeCash - payload.totalCost)
    assert.equal(decideCalls, 1)
  })

  it('L2 — retry do mesmo actionId não reaplica delta relativo', async () => {
    const { store } = storeWithPlan('CLIENTS')
    const payload = buildClientsBuyPayload(1)
    const before = { ...actorOf(store) }
    const after = applyDeltas(before, buildClientsPurchaseDeltas(payload))
    const actionId = buildBotEffectActionId({
      matchId: MATCH_ID,
      playerId: BOT_ID,
      turnSeq: TURN_SEQ,
      effectKind: 'CLIENTS',
    })
    const first = store.commit({
      before,
      after: { ...after, botTurnEffects: { ...planFor('CLIENTS'), done: ['CLIENTS'], settled: true } },
      actionId,
      effects: { ...planFor('CLIENTS'), done: ['CLIENTS'], settled: true },
    })
    const again = store.commit({
      before,
      after: applyDeltas(after, buildClientsPurchaseDeltas(payload)),
      actionId,
      effects: { ...planFor('CLIENTS'), done: ['CLIENTS'], settled: true },
    })
    assert.equal(first.alreadyApplied, false)
    assert.equal(again.alreadyApplied, true)
    assert.equal(actorOf(store).cash, after.cash)
    assert.equal(actorOf(store).clients, after.clients)
  })

  it('M — F5 depois do commit e antes do handoff não reaplica', async () => {
    const { store } = storeWithPlan('CLIENTS')
    await runOnce(store, async () => buildClientsBuyPayload(1))
    const cash = actorOf(store).cash
    const clients = actorOf(store).clients
    const leftover = shouldResumeLeftoverBotEffects({
      players: store.state.players,
      matchId: MATCH_ID,
      turnPlayerId: BOT_ID,
      turnSeq: TURN_SEQ,
      currentPlayer: actorOf(store),
      ...authFor(TAB_X),
    })
    assert.equal(leftover.ok, false)
    assert.equal(leftover.reason, 'already-settled')
    const again = await runOnce(store, async () => buildClientsBuyPayload(1))
    assert.equal(again.reason, 'already-settled')
    assert.equal(actorOf(store).cash, cash)
    assert.equal(actorOf(store).clients, clients)
    const gate = shouldBlockBotHandoffForEffects({
      isBotTurn: true,
      effects: actorOf(store).botTurnEffects,
    })
    assert.equal(gate.block, false)
  })
})

describe('P — StrictMode / retry', () => {
  it('duas execuções paralelas = 1 efeito lógico', async () => {
    const { store } = storeWithPlan('CLIENTS')
    const payload = buildClientsBuyPayload(1)
    const beforeCash = actorOf(store).cash
    const decide = async () => payload
    const [a, b] = await Promise.all([
      runOnce(store, decide),
      runOnce(store, decide),
    ])
    assert.equal(a.ok || b.ok, true)
    assert.equal(store.state.commits, 1)
    assert.equal(actorOf(store).cash, beforeCash - payload.totalCost)
    assert.equal(actorOf(store).clients, 2)
  })
})

describe('Q — turnSeq muda cancela commit antigo', () => {
  it('CAS do turno de origem recusa efeito velho', async () => {
    const { store } = storeWithPlan('CLIENTS')
    store.advanceTurnSeq()
    const payload = buildClientsBuyPayload(1)
    const before = { ...actorOf(store) }
    const after = applyDeltas(before, buildClientsPurchaseDeltas(payload))
    const committed = store.commit({
      before,
      after,
      actionId: buildBotEffectActionId({
        matchId: MATCH_ID,
        playerId: BOT_ID,
        turnSeq: TURN_SEQ,
        effectKind: 'CLIENTS',
      }),
      effects: { ...planFor('CLIENTS'), done: ['CLIENTS'], settled: true },
    })
    assert.equal(committed.ok, false)
    assert.equal(committed.reason, 'stale-turn-seq')
    assert.equal(actorOf(store).cash, before.cash)

    const cas = validateTurnCommit(
      {
        matchId: MATCH_ID,
        turnPlayerId: BOT_ID,
        turnSeq: TURN_SEQ + 1,
        lockOwner: HUMAN_ID,
        players: store.state.players,
      },
      {
        _commitKind: 'BOT_EFFECT',
        _expectMatchId: MATCH_ID,
        _expectTurnPlayerId: BOT_ID,
        _expectTurnSeq: TURN_SEQ,
        _expectLockOwner: HUMAN_ID,
      },
    )
    assert.equal(cas.ok, false)
    assert.equal(cas.reason, 'stale-turn-seq')
  })
})

describe('R — humano intacto', () => {
  it('ator humano não entra no runtime econômico da Máquina', () => {
    const gate = shouldRunBotEconomicEffects({
      currentPlayer: humanPlayer(),
      turnPlayerId: HUMAN_ID,
      myUid: HUMAN_ID,
      lockOwner: HUMAN_ID,
    })
    assert.equal(gate.ok, false)
    const hold = shouldBlockBotHandoffForEffects({
      isBotTurn: false,
      effects: planFor('CLIENTS'),
    })
    assert.equal(hold.block, false)
    assert.equal(hold.reason, 'not-bot')
  })
})

describe('S / T — round e ENDGAME intactos após compra / F5', () => {
  it('S — settled não muda regra de incremento/ENDGAME', async () => {
    const { store } = storeWithPlan('CLIENTS')
    await runOnce(store, async () => buildClientsBuyPayload(1))
    const players = store.state.players.map((p) =>
      String(p.id) === BOT_ID
        ? { ...p, lastRevenueRound: 1, waitingAtRevenue: false }
        : { ...p, lastRevenueRound: 1, waitingAtRevenue: false },
    )
    const pending = rebuildBotPendingAfterConfirmedMove({
      players,
      turnPlayerId: BOT_ID,
      turnSeq: TURN_SEQ,
      turnIdx: 1,
      round: 1,
      maxRounds: 2,
      roundFlags: [true, true],
      crossedStart: true,
      matchId: MATCH_ID,
    })
    assert.equal(pending.shouldIncrementRound, true)
    assert.equal(pending.nextRound, 2)
    assert.equal(pending.endGame, false)
    assert.equal(pending.effectsSettled, true)
    assert.equal(
      shouldFinishAfterRoundTransition({
        endGame: pending.endGame,
        shouldIncrementRound: pending.shouldIncrementRound,
        nextRound: pending.nextRound,
        maxRounds: 2,
      }),
      false,
    )
  })

  it('T — F5 + ENDGAME na rodada final continua igual', () => {
    const plan = planFor('CLIENTS')
    plan.done = ['CLIENTS']
    plan.settled = true
    const players = [
      { ...humanPlayer(), lastRevenueRound: 2 },
      { ...botPlayer({ botTurnEffects: plan }), lastRevenueRound: 2 },
    ]
    const pending = rebuildBotPendingAfterConfirmedMove({
      players,
      turnPlayerId: BOT_ID,
      turnSeq: TURN_SEQ,
      turnIdx: 1,
      round: 2,
      maxRounds: 2,
      roundFlags: [true, true],
      crossedStart: true,
      matchId: MATCH_ID,
    })
    assert.equal(pending.endGame, true)
    assert.equal(pending.shouldIncrementRound, false)
    assert.equal(pending.effectsSettled, true)
    assert.equal(
      shouldFinishAfterRoundTransition({
        endGame: true,
        shouldIncrementRound: false,
        nextRound: 2,
        maxRounds: 2,
      }),
      true,
    )
  })
})

describe('plano e ordem', () => {
  it('REVENUE → EXPENSES → compra; F5 reconstrói os kinds do receipt', () => {
    const plan = buildBotTurnEffectPlan({
      matchId: MATCH_ID,
      turnPlayerId: BOT_ID,
      turnSeq: TURN_SEQ,
      fromPos: 22,
      toPos: 4,
      steps: 6,
      crossedStart: true,
      crossedExpenses: true,
      landTile: 'CLIENTS',
      processLandTile: true,
    })
    assert.deepEqual(requiredEffectKinds(plan), ['REVENUE', 'EXPENSES', 'CLIENTS'])
    const mid = { ...plan, done: ['REVENUE'] }
    assert.deepEqual(remainingEffectKinds(mid), ['EXPENSES', 'CLIENTS'])
    assert.equal(isBotTurnEffectsSettled(mid), false)
  })

  it('caso C com efeitos pendentes não está settled; sem receipt legado não inventa kinds', () => {
    const actionId = buildBotMoveActionId({
      matchId: MATCH_ID,
      turnPlayerId: BOT_ID,
      turnSeq: TURN_SEQ,
      executorId: TAB_X,
    })
    const pendingPlan = planFor('ERP')
    const classified = classifyBotTurnRecovery({
      expectedTurnPlayerId: BOT_ID,
      expectedTurnSeq: TURN_SEQ,
      turnPlayerId: BOT_ID,
      turnSeq: TURN_SEQ,
      lastRollTurnKey: String(TURN_SEQ),
      lastRoll: { playerId: BOT_ID, steps: 3, turnKey: String(TURN_SEQ) },
      players: [{
        ...botPlayer({ botTurnEffects: pendingPlan, lastActions: { [actionId]: 1 } }),
      }],
      matchId: MATCH_ID,
    })
    assert.equal(classified.case, 'C')
    assert.equal(classified.effectsSettled, false)

    const legacy = classifyBotTurnRecovery({
      expectedTurnPlayerId: BOT_ID,
      expectedTurnSeq: TURN_SEQ,
      turnPlayerId: BOT_ID,
      turnSeq: TURN_SEQ,
      lastRollTurnKey: String(TURN_SEQ),
      lastRoll: { playerId: BOT_ID, steps: 3, turnKey: String(TURN_SEQ) },
      players: [{ ...botPlayer({ lastActions: { [actionId]: 1 } }) }],
      matchId: MATCH_ID,
    })
    assert.equal(legacy.case, 'C')
    assert.equal(legacy.effectsSettled, false)
  })
})

describe('commit BOT_EFFECT', () => {
  it('CAS recusa outro lock owner', () => {
    const cas = validateTurnCommit(
      {
        matchId: MATCH_ID,
        turnPlayerId: BOT_ID,
        turnSeq: TURN_SEQ,
        lockOwner: HUMAN_ID,
        players: [botPlayer()],
      },
      {
        _commitKind: 'BOT_EFFECT',
        _expectMatchId: MATCH_ID,
        _expectTurnPlayerId: BOT_ID,
        _expectTurnSeq: TURN_SEQ,
        _expectLockOwner: TAB_Y,
      },
    )
    assert.equal(cas.ok, false)
    assert.equal(cas.reason, 'lock-owner-mismatch')
  })

  it('CAS recusa executor diferente com o mesmo lockOwner', () => {
    const cas = validateTurnCommit(
      {
        matchId: MATCH_ID,
        turnPlayerId: BOT_ID,
        turnSeq: TURN_SEQ,
        lockOwner: HUMAN_ID,
        botClaimExecutor: TAB_X,
        players: [botPlayer()],
      },
      {
        _commitKind: 'BOT_EFFECT',
        _expectMatchId: MATCH_ID,
        _expectTurnPlayerId: BOT_ID,
        _expectTurnSeq: TURN_SEQ,
        _expectLockOwner: HUMAN_ID,
        _expectBotExecutor: TAB_Y,
      },
    )
    assert.equal(cas.ok, false)
    assert.equal(cas.reason, 'executor-mismatch')
  })

  it('delta econômico é absoluto, não relativo', () => {
    const before = botPlayer({ cash: 18000, clients: 1, bens: 4000 })
    const payload = buildClientsBuyPayload(1)
    const after = applyDeltas(before, buildClientsPurchaseDeltas(payload))
    const delta = buildBotEconomicPlayerDelta(before, after, 'bot-effect:x')
    assert.equal(delta.cash, after.cash)
    assert.equal(delta.clients, after.clients)
    assert.equal(Object.prototype.hasOwnProperty.call(delta, 'cashDelta'), false)
  })
})

function expensesExtras(amount) {
  return () => ({ expense: amount, totalCharge: amount, loanCharge: 0 })
}

function recoveryDecide({ expenseOk = { action: 'OK' }, funds, recovery, bankrupt = true }) {
  return async ({ kind }) => {
    if (kind === 'EXPENSES') return expenseOk
    if (kind === 'INSUFFICIENT_FUNDS') return funds
    if (kind === 'RECOVERY') return typeof recovery === 'function' ? recovery() : recovery
    if (kind === 'BANKRUPT') return bankrupt
    return { action: 'SKIP' }
  }
}

describe('paridade EXPENSES / recovery', () => {
  it('A — EXPENSES com saldo suficiente igual ao humano', async () => {
    const need = 3000
    const { store } = storeWithPlan('EXPENSES', { cash: 10000 }, { landTile: 'NONE', crossedExpenses: true, processLandTile: false })
    const before = { ...actorOf(store) }
    const human = applyMandatoryCashCharge(before, need)
    await runOnce(store, recoveryDecide({ funds: { action: 'ACK' } }), {
      extrasFor: expensesExtras(need),
    })
    const after = actorOf(store)
    assert.equal(after.cash, human.cash)
    assert.equal(isBotTurnEffectsSettled(after.botTurnEffects), true)
  })

  it('B — EXPENSES + LOAN igual ao humano', async () => {
    const need = 3000
    const { store } = storeWithPlan('EXPENSES', { cash: 400, bens: 20000 }, {
      landTile: 'NONE',
      crossedExpenses: true,
      processLandTile: false,
    })
    const before = { ...actorOf(store) }
    const loan = applyRecoveryPayloadToPlayer(before, buildLoanPayload(3000), { round: 1 })
    const human = applyMandatoryCashCharge(loan.player, need)
    await runOnce(store, recoveryDecide({
      funds: { action: 'RECOVERY' },
      recovery: buildLoanPayload(3000),
    }), { extrasFor: expensesExtras(need) })
    const after = actorOf(store)
    assert.equal(after.cash, human.cash)
    assert.equal(!!after.loanTakenInMatch, !!human.loanTakenInMatch)
    assert.equal(isBotTurnEffectsSettled(after.botTurnEffects), true)
  })

  it('C — FIRE/REDUCE gera o mesmo crédito', async () => {
    const need = 800
    const { store } = storeWithPlan('EXPENSES', {
      cash: 100,
      vendedoresComuns: 2,
    }, { landTile: 'NONE', crossedExpenses: true, processLandTile: false })
    const before = { ...actorOf(store) }
    const fire = buildFirePayload(before, { comum: 1 })
    const humanRec = applyRecoveryPayloadToPlayer(before, fire, { round: 1 })
    const human = applyMandatoryCashCharge(humanRec.player, need)
    await runOnce(store, recoveryDecide({
      funds: { action: 'RECOVERY' },
      recovery: fire,
    }), { extrasFor: expensesExtras(need) })
    const after = actorOf(store)
    assert.equal(after.cash, human.cash)
    assert.equal(after.vendedoresComuns, human.vendedoresComuns)
    assert.equal(isBotTurnEffectsSettled(after.botTurnEffects), true)
  })

  it('C2 — REDUCE gera o mesmo crédito/nível', async () => {
    const need = 500
    const reduce = buildReducePayload([{ group: 'MIX', level: 'C', credit: 2000 }])
    const { store } = storeWithPlan('EXPENSES', {
      cash: 100,
      mixProdutos: 'C',
      mixOwned: { A: false, B: false, C: true, D: true },
    }, { landTile: 'NONE', crossedExpenses: true, processLandTile: false })
    const before = { ...actorOf(store) }
    const humanRec = applyRecoveryPayloadToPlayer(before, reduce, { round: 1 })
    const human = applyMandatoryCashCharge(humanRec.player, need)
    await runOnce(store, recoveryDecide({
      funds: { action: 'RECOVERY' },
      recovery: reduce,
    }), { extrasFor: expensesExtras(need) })
    const after = actorOf(store)
    assert.equal(after.cash, human.cash)
    assert.equal(after.mixProdutos, human.mixProdutos)
  })

  it('D — recovery insuficiente → BANKRUPTCY', async () => {
    const { store } = storeWithPlan('EXPENSES', { cash: 0, bens: 0, vendedoresComuns: 0 }, {
      landTile: 'NONE',
      crossedExpenses: true,
      processLandTile: false,
    })
    const result = await runOnce(store, recoveryDecide({
      funds: { action: 'RECOVERY' },
      recovery: buildTriggerBankruptcyPayload(),
      bankrupt: true,
    }), { extrasFor: expensesExtras(4000) })
    const after = actorOf(store)
    const human = applyBankruptcyState(botPlayer({ cash: 0, bens: 0 }))
    assert.equal(result.ok, true)
    assert.equal(result.bankrupt, true)
    assert.equal(after.bankrupt, true)
    assert.equal(after.cash, human.cash)
    assert.equal(isBotTurnEffectsSettled(after.botTurnEffects), true)
  })

  it('E / F — settled false durante recovery e true só no final', async () => {
    const need = 8000
    const { store } = storeWithPlan('EXPENSES', { cash: 100, bens: 4000 }, {
      landTile: 'NONE',
      crossedExpenses: true,
      processLandTile: false,
    })
    let sawMid = false
    const wrapped = (args) => {
      const result = store.commit(args)
      if (String(args.actionId || '').includes(':r0')) {
        sawMid = true
        assert.equal(isBotTurnEffectsSettled(args.effects), false)
      }
      return result
    }
    const result = await runBotEconomicEffectsLoop({
      matchId: MATCH_ID,
      turnPlayerId: BOT_ID,
      turnSeq: TURN_SEQ,
      myUid: HUMAN_ID,
      getLive: () => ({
        ...liveWithAuth(store),
        extrasFor: expensesExtras(need),
      }),
      decide: recoveryDecide({
        funds: { action: 'RECOVERY' },
        recovery: buildLoanPayload(2000),
      }),
      commit: wrapped,
    })
    assert.equal(sawMid, true)
    assert.equal(result.ok, false)
    assert.equal(isBotTurnEffectsSettled(actorOf(store).botTurnEffects), false)
    const finish = await runOnce(store, recoveryDecide({
      funds: { action: 'BANKRUPT' },
      recovery: buildTriggerBankruptcyPayload(),
    }), { extrasFor: expensesExtras(need) })
    assert.equal(finish.ok, true)
    assert.equal(finish.bankrupt, true)
    assert.equal(actorOf(store).bankrupt, true)
    assert.equal(isBotTurnEffectsSettled(actorOf(store).botTurnEffects), true)
  })
})

describe('paridade LUCK', () => {
  it('G — certificados/gestor: bot === humano campo a campo', async () => {
    const payload = {
      action: 'APPLY_CARD',
      id: 'test_mgr_bonus',
      cashDelta: 100,
      perCertifiedManagerBonus: 5000,
      perClientBonus: 10,
    }
    const { store } = storeWithPlan('LUCK', {
      cash: 2000,
      clients: 3,
      trainingsByVendor: { gestor: ['personalizado', 'fieldsales'] },
    }, { luckPayload: payload, luckCardId: payload.id })
    const before = { ...actorOf(store) }
    const human = applySorteRevesPayloadToPlayer(before, payload).player
    await runOnce(store, async ({ kind }) => (kind === 'LUCK' ? payload : { action: 'SKIP' }))
    const after = actorOf(store)
    assert.equal(after.cash, human.cash)
    assert.equal(after.clients, human.clients)
    assert.deepEqual(after.trainingsByVendor, human.trainingsByVendor)
  })

  it('K — F5 no meio de LUCK: mesma carta, 1 efeito', async () => {
    const payload = { action: 'APPLY_CARD', id: 'referral_bonus', cashDelta: 800 }
    const { store } = storeWithPlan('LUCK', { cash: 2000 }, {
      luckPayload: payload,
      luckCardId: payload.id,
    })
    let applyAttempts = 0
    const flaky = (args) => {
      if (String(args.actionId || '').endsWith(':LUCK') && !String(args.actionId).includes('draw')) {
        applyAttempts += 1
        if (applyAttempts === 1) return { ok: false, reason: 'network' }
      }
      return store.commit(args)
    }
    const decide = async ({ kind }) => (kind === 'LUCK' ? payload : { action: 'SKIP' })
    const first = await runBotEconomicEffectsLoop({
      matchId: MATCH_ID,
      turnPlayerId: BOT_ID,
      turnSeq: TURN_SEQ,
      myUid: HUMAN_ID,
      getLive: () => liveWithAuth(store),
      decide,
      commit: flaky,
      sleep: async () => {},
    })
    assert.equal(first.ok, true)
    assert.equal(applyAttempts, 2)
    assert.equal(actorOf(store).botTurnEffects.luckCardId, 'referral_bonus')
    assert.equal(isBotTurnEffectsSettled(actorOf(store).botTurnEffects), true)
    const second = await runBotEconomicEffectsLoop({
      matchId: MATCH_ID,
      turnPlayerId: BOT_ID,
      turnSeq: TURN_SEQ,
      myUid: HUMAN_ID,
      getLive: () => liveWithAuth(store),
      decide: async () => {
        throw new Error('não pode sortear outra carta')
      },
      commit: flaky,
      sleep: async () => {},
    })
    assert.equal(second.reason, 'already-settled')
    assert.equal(actorOf(store).cash, 2800)
    assert.equal(store.state.appliedActionIds.filter((id) => id.endsWith(':LUCK')).length, 1)
  })
})

describe('executor X → Y e F5 recovery', () => {
  it('I — X morre, Y retoma a mesma actionId, 1 BUY', async () => {
    const { store } = storeWithPlan('CLIENTS')
    const blocked = await runOnce(store, async () => buildClientsBuyPayload(1), {
      auth: authFor(TAB_Y, TAB_X),
      executorId: TAB_Y,
    })
    assert.equal(blocked.ok, false)
    assert.equal(actorOf(store).clients, 1)
    store.setBotClaimExecutor(TAB_Y)
    const resumed = await runOnce(store, async () => buildClientsBuyPayload(1), {
      auth: authFor(TAB_Y, TAB_Y),
      executorId: TAB_Y,
    })
    assert.equal(resumed.ok, true)
    assert.equal(actorOf(store).clients, 2)
    assert.equal(
      store.state.appliedActionIds[0],
      buildBotEffectActionId({
        matchId: MATCH_ID,
        playerId: BOT_ID,
        turnSeq: TURN_SEQ,
        effectKind: 'CLIENTS',
      }),
    )
    const again = await runOnce(store, async () => buildClientsBuyPayload(1), {
      auth: authFor(TAB_Y, TAB_Y),
      executorId: TAB_Y,
    })
    assert.equal(again.reason, 'already-settled')
    assert.equal(actorOf(store).clients, 2)
  })

  it('J — F5 no meio do recovery financeiro: um empréstimo, uma cobrança', async () => {
    const need = 3000
    const { store } = storeWithPlan('EXPENSES', { cash: 400, bens: 20000 }, {
      landTile: 'NONE',
      crossedExpenses: true,
      processLandTile: false,
    })
    let chargeFails = 0
    const flaky = (args) => {
      const id = String(args.actionId || '')
      if (id.endsWith(':EXPENSES') && !id.includes(':r') && !id.includes('BANKRUPT')) {
        chargeFails += 1
        if (chargeFails === 1) return { ok: false, reason: 'network' }
      }
      return store.commit(args)
    }
    const decide = recoveryDecide({
      funds: { action: 'RECOVERY' },
      recovery: buildLoanPayload(3000),
    })
    const first = await runBotEconomicEffectsLoop({
      matchId: MATCH_ID,
      turnPlayerId: BOT_ID,
      turnSeq: TURN_SEQ,
      myUid: HUMAN_ID,
      getLive: () => ({ ...liveWithAuth(store), extrasFor: expensesExtras(need) }),
      decide,
      commit: flaky,
      sleep: async () => {},
    })
    assert.equal(first.ok, true)
    assert.equal(chargeFails, 2)
    assert.equal(actorOf(store).loanTakenInMatch, true)
    assert.equal(actorOf(store).cash, 400)
    assert.equal(store.state.appliedActionIds.filter((id) => id.includes(':r0')).length, 1)
    assert.equal(isBotTurnEffectsSettled(actorOf(store).botTurnEffects), true)
    const second = await runBotEconomicEffectsLoop({
      matchId: MATCH_ID,
      turnPlayerId: BOT_ID,
      turnSeq: TURN_SEQ,
      myUid: HUMAN_ID,
      getLive: () => ({ ...liveWithAuth(store), extrasFor: expensesExtras(need) }),
      decide,
      commit: flaky,
      sleep: async () => {},
    })
    assert.equal(second.reason, 'already-settled')
    assert.equal(actorOf(store).cash, 400)
  })
})

function applyLoopBankruptcyAftermath(store, { initialPlayerCount, pending }) {
  const players = store.state.players
  const aftermath = resolveAftermathAfterBankruptcy({
    players,
    initialPlayerCount,
    bankruptPlayerId: BOT_ID,
  })
  return {
    aftermath,
    human: decideEndgameAfterBankruptcy(players, initialPlayerCount),
    commit: commitBankruptcyAftermath({ aftermath }),
    pendingAfter: commitBankruptcyAftermath({ aftermath }).clearPending
      ? null
      : {
          ...pending,
          nextPlayers: aftermath.nextPlayers,
          nextTurnIdx: aftermath.nextTurnIdx,
          nextTurnPlayerId: aftermath.nextTurnPlayerId,
        },
    tickWouldEnd: shouldFinishAfterRoundTransition({
      endGame: pending?.endGame,
      shouldIncrementRound: pending?.shouldIncrementRound,
      nextRound: pending?.nextRound ?? 1,
      maxRounds: 12,
    }),
  }
}

describe('BANKRUPTCY → ENDGAME (mesmo helper do humano)', () => {
  it('2 vivos: Máquina falida, Arthur vence, ENDGAME uma vez, tick sozinho não encerra', async () => {
    const { store } = storeWithPlan('EXPENSES', { cash: 0, bens: 0, vendedoresComuns: 0 }, {
      landTile: 'NONE',
      crossedExpenses: true,
      processLandTile: false,
    })
    const pending = {
      endGame: false,
      shouldIncrementRound: false,
      nextRound: 1,
      originTurnPlayerId: BOT_ID,
      nextTurnPlayerId: HUMAN_ID,
      nextTurnIdx: 0,
    }
    const loop = await runOnce(store, recoveryDecide({
      funds: { action: 'RECOVERY' },
      recovery: buildTriggerBankruptcyPayload(),
      bankrupt: true,
    }), { extrasFor: expensesExtras(4000) })
    assert.equal(loop.ok, true)
    assert.equal(loop.bankrupt, true)
    assert.equal(actorOf(store).bankrupt, true)
    assert.equal(store.state.players.find((p) => p.id === HUMAN_ID)?.bankrupt, false)

    const first = applyLoopBankruptcyAftermath(store, { initialPlayerCount: 2, pending })
    assert.equal(first.tickWouldEnd, false, 'tick de rodada NÃO dispara ENDGAME de falência')
    assert.equal(first.human.shouldEnd, true)
    assert.equal(first.human.winner?.id, HUMAN_ID)
    assert.equal(first.aftermath.winner?.id, first.human.winner?.id)
    assert.equal(first.commit.emitEndgame, true)
    assert.equal(first.commit.emitHandoff, false)
    assert.equal(first.commit.kind, 'ENDGAME')
    assert.equal(first.commit.lastAction, 'BANKRUPT')
    assert.equal(first.pendingAfter, null)
    assert.equal(first.commit.winner?.name, 'Arthur')

    const second = commitBankruptcyAftermath({
      aftermath: first.aftermath,
      endGameFinalized: true,
      gameOver: true,
    })
    assert.equal(second.emitEndgame, false)
    assert.equal(second.alreadyFinalized, true)
    assert.equal(second.emitHandoff, false)
    assert.notEqual(second.rewritePending?.nextTurnPlayerId, BOT_ID)
  })

  it('3 vivos: 1 bot falha, 2 restam, partida continua sem ENDGAME', async () => {
    const carol = humanPlayer({ id: 'human-C', name: 'Carol', pos: 8 })
    const { store } = storeWithPlan(
      'EXPENSES',
      { cash: 0, bens: 0, vendedoresComuns: 0 },
      { landTile: 'NONE', crossedExpenses: true, processLandTile: false },
      { others: [humanPlayer(), carol] },
    )
    const pending = {
      endGame: false,
      shouldIncrementRound: false,
      nextRound: 1,
      originTurnPlayerId: BOT_ID,
      nextTurnPlayerId: HUMAN_ID,
      nextTurnIdx: 0,
    }
    const loop = await runOnce(store, recoveryDecide({
      funds: { action: 'RECOVERY' },
      recovery: buildTriggerBankruptcyPayload(),
      bankrupt: true,
    }), { extrasFor: expensesExtras(4000) })
    assert.equal(loop.bankrupt, true)
    const alive = store.state.players.filter((p) => !p.bankrupt)
    assert.equal(alive.length, 2)
    assert.equal(actorOf(store).bankrupt, true)

    const got = applyLoopBankruptcyAftermath(store, { initialPlayerCount: 3, pending })
    assert.equal(got.human.shouldEnd, false)
    assert.equal(got.aftermath.shouldEnd, false)
    assert.equal(got.commit.emitEndgame, false)
    assert.equal(got.commit.emitHandoff, true)
    assert.equal(got.pendingAfter.nextTurnPlayerId, HUMAN_ID)
    assert.notEqual(got.pendingAfter.nextTurnPlayerId, BOT_ID)
    assert.equal(got.tickWouldEnd, false)
  })

  it('motor reutiliza o mesmo helper/caminho BANKRUPT do humano', () => {
    const root = join(dirname(fileURLToPath(import.meta.url)), '../../..')
    const engine = readFileSync(join(root, 'src/game/useTurnEngine.jsx'), 'utf8')
    assert.ok(engine.includes('resolveAftermathAfterBankruptcy'))
    assert.ok(engine.includes('commitBankruptcyAftermath'))
    const loopAt = engine.indexOf('const result = await runBotEconomicEffectsLoop')
    const botBlock = engine.slice(loopAt, loopAt + 20000)
    const endgamePos = botBlock.indexOf("kind: 'ENDGAME'")
    const bankruptPos = botBlock.indexOf("lastAction: 'BANKRUPT'")
    assert.ok(loopAt >= 0, 'loop econômico captura o resultado')
    assert.ok(endgamePos >= 0, 'bot emite ENDGAME no mesmo kind do humano')
    assert.ok(bankruptPos >= 0, 'bot usa lastAction BANKRUPT do handleInsufficientFunds')
  })
})

describe('LUCK reconstruction (seed / receipt / fail-safe)', () => {
  it('BOT_MOVE novo que cai em LUCK tem seed scoped o suficiente para F5 pré-draw', () => {
    const plan = planFor('LUCK')
    const proof = claimProofFor(TAB_X)
    const info = botLuckRecoveryInfo({
      effects: plan,
      seed: proof.seed,
      claimProof: proof,
      matchId: MATCH_ID,
      turnPlayerId: BOT_ID,
      turnSeq: TURN_SEQ,
    })
    assert.equal(info.needsLuck, true)
    assert.equal(info.recoverable, true)
    assert.equal(info.source, 'seed')
    assert.deepEqual(
      resolveBotLuckSeed({
        seed: proof.seed,
        claimProof: proof,
        matchId: MATCH_ID,
        turnPlayerId: BOT_ID,
        turnSeq: TURN_SEQ,
      }),
      proof.seed,
    )
    const stale = resolveBotLuckSeed({
      seed: null,
      claimProof: { ...proof, turnSeq: TURN_SEQ + 1 },
      matchId: MATCH_ID,
      turnPlayerId: BOT_ID,
      turnSeq: TURN_SEQ,
    })
    assert.equal(stale, null)
  })

  it('F5 antes do draw reconstrói a mesma carta; decide não sorteia', async () => {
    const seed = [7, 3, 1, 9]
    const { store, bot } = storeWithPlan('LUCK', { cash: 100000 })
    assert.equal(actorOf(store).botTurnEffects.luckPayload, undefined)
    const expected = reconstructBotLuckPayload({
      seed,
      player: bot,
      matchId: MATCH_ID,
      turnPlayerId: BOT_ID,
      turnSeq: TURN_SEQ,
      claimProof: claimProofFor(TAB_X),
    })
    assert.equal(expected.ok, true)
    assert.equal(expected.source, 'seed')
    const catalog = resolveSorteRevesCard(pickSorteRevesCard(createBotRng(seed)), bot).payload
    assert.equal(expected.payload.id, catalog.id)
    assert.equal(expected.payload.cashDelta, catalog.cashDelta)

    let luckDecides = 0
    const first = await runOnce(store, async ({ kind }) => {
      if (kind === 'LUCK') {
        luckDecides += 1
        throw new Error('não pode sortear após F5 pré-draw')
      }
      return { action: 'SKIP' }
    })
    assert.equal(first.ok, true)
    assert.equal(luckDecides, 0)
    assert.equal(actorOf(store).botTurnEffects.luckCardId, expected.payload.id)
    assert.deepEqual(actorOf(store).botTurnEffects.luckPayload.id, expected.payload.id)
    const cashDelta = Number(expected.payload.cashDelta || 0)
    if (cashDelta >= 0) {
      assert.equal(actorOf(store).cash, 100000 + cashDelta)
    }
  })

  it('receipt com luckPayload: F5 não sorteia novamente', async () => {
    const payload = { action: 'APPLY_CARD', id: 'referral_bonus', cashDelta: 800 }
    const { store } = storeWithPlan('LUCK', { cash: 2000 }, {
      luckPayload: payload,
      luckCardId: payload.id,
    })
    let luckDecides = 0
    const result = await runOnce(store, async ({ kind }) => {
      if (kind === 'LUCK') {
        luckDecides += 1
        throw new Error('não pode sortear com receipt')
      }
      return { action: 'SKIP' }
    })
    assert.equal(result.ok, true)
    assert.equal(luckDecides, 0)
    assert.equal(actorOf(store).cash, 2800)
    assert.equal(actorOf(store).botTurnEffects.luckCardId, 'referral_bonus')
  })

  it('fail-safe legado: sem payload e sem seed → luck-card-unreconstructable', async () => {
    const { store } = storeWithPlan('LUCK', { cash: 2000 }, {}, { botTurnSeed: null })
    const result = await runOnce(store, async ({ kind }) => {
      if (kind === 'LUCK') return null
      return { action: 'SKIP' }
    }, {
      claimProof: {
        ...claimProofFor(TAB_X),
        seed: null,
      },
    })
    assert.equal(result.ok, false)
    assert.equal(result.reason, 'luck-card-unreconstructable')
    assert.equal(isBotTurnEffectsSettled(actorOf(store).botTurnEffects), false)
  })
})

function broadcastThenCas(prevState, enginePatch) {
  const statePatch = { kind: enginePatch.kind || 'PLAYER_DELTA' }
  applyBroadcastCommitExpect(statePatch, enginePatch)
  return { statePatch, cas: validateTurnCommit(prevState, statePatch) }
}

describe('freeze Máquina pensando — A–L', () => {
  it('A — Máquina primeira: lockOwnerRef vazio + claimProof autoriza e conclui', async () => {
    const { store } = storeWithPlan('CLIENTS')
    store.setLockOwner('')
    const proof = claimProofFor(TAB_X)
    const staleGate = shouldRunBotEconomicEffects({
      currentPlayer: actorOf(store),
      turnPlayerId: BOT_ID,
      myUid: HUMAN_ID,
      lockOwner: '',
      executorId: TAB_X,
      remoteExecutorId: TAB_X,
      claimProof: proof,
      matchId: MATCH_ID,
      turnSeq: TURN_SEQ,
    })
    assert.equal(staleGate.ok, true, staleGate.reason)
    const payload = buildClientsBuyPayload(1)
    const beforeCash = actorOf(store).cash
    const result = await runBotEconomicEffectsLoop({
      matchId: MATCH_ID,
      turnPlayerId: BOT_ID,
      turnSeq: TURN_SEQ,
      myUid: HUMAN_ID,
      getLive: () => ({
        ...store.getLive(),
        lockOwner: '',
        remoteLockOwner: '',
        executorId: TAB_X,
        remoteExecutorId: TAB_X,
        claimProof: proof,
      }),
      decide: async () => payload,
      commit: (args) => store.commit({ ...args, executorId: TAB_X }),
      sleep: async () => {},
    })
    assert.equal(result.ok, true)
    assert.equal(result.commits, 1)
    assert.equal(actorOf(store).cash, beforeCash - payload.totalCost)
    assert.equal(isBotTurnEffectsSettled(actorOf(store).botTurnEffects), true)
  })

  it('B — gate não pronto depois fica pronto: runtime reentra sozinho', async () => {
    const { store } = storeWithPlan('CLIENTS')
    let ready = false
    let sleeps = 0
    const proof = claimProofFor(TAB_X)
    const payload = buildClientsBuyPayload(1)
    const result = await runBotEconomicEffectsLoop({
      matchId: MATCH_ID,
      turnPlayerId: BOT_ID,
      turnSeq: TURN_SEQ,
      myUid: HUMAN_ID,
      getLive: () => {
        const live = store.getLive()
        if (!ready) {
          return {
            ...live,
            lockOwner: '',
            remoteLockOwner: '',
            executorId: null,
            remoteExecutorId: null,
            claimProof: null,
          }
        }
        return {
          ...live,
          executorId: TAB_X,
          remoteExecutorId: TAB_X,
          claimProof: proof,
        }
      },
      decide: async () => payload,
      commit: (args) => store.commit({ ...args, executorId: TAB_X }),
      sleep: async () => {
        sleeps += 1
        ready = true
      },
    })
    assert.ok(sleeps >= 1)
    assert.equal(result.ok, true)
    assert.equal(isBotTurnEffectsSettled(actorOf(store).botTurnEffects), true)
    assert.equal(store.state.commits, 1)
  })

  it('C — primeiro CAS falha, segundo confirma, 1 BUY', async () => {
    const { store } = storeWithPlan('CLIENTS')
    const payload = buildClientsBuyPayload(1)
    const beforeCash = actorOf(store).cash
    let attempts = 0
    const flaky = (args) => {
      attempts += 1
      if (attempts === 1) return { ok: false, casLost: true, reason: 'cas-lost' }
      return store.commit(args)
    }
    const got = await runBotEconomicEffectsLoop({
      matchId: MATCH_ID,
      turnPlayerId: BOT_ID,
      turnSeq: TURN_SEQ,
      myUid: HUMAN_ID,
      getLive: () => liveWithAuth(store),
      decide: async () => payload,
      commit: flaky,
      shouldContinue: continueFromStore(store),
      sleep: async () => {},
    })
    assert.equal(got.ok, true)
    assert.equal(attempts, 2)
    assert.equal(store.state.commits, 1)
    assert.equal(actorOf(store).cash, beforeCash - payload.totalCost)
    assert.equal(actorOf(store).clients, 2)
  })

  it('D — 5 CAS transitórios depois sucesso = 1 BUY', async () => {
    const { store } = storeWithPlan('CLIENTS')
    const payload = buildClientsBuyPayload(1)
    const beforeCash = actorOf(store).cash
    let attempts = 0
    const flaky = (args) => {
      attempts += 1
      if (attempts <= 5) return { ok: false, casLost: true, reason: 'cas-lost' }
      return store.commit(args)
    }
    const got = await runBotEconomicEffectsLoop({
      matchId: MATCH_ID,
      turnPlayerId: BOT_ID,
      turnSeq: TURN_SEQ,
      myUid: HUMAN_ID,
      getLive: () => liveWithAuth(store),
      decide: async () => payload,
      commit: flaky,
      shouldContinue: continueFromStore(store),
      sleep: async () => {},
    })
    assert.equal(got.ok, true)
    assert.equal(attempts, 6)
    assert.equal(store.state.commits, 1)
    assert.equal(actorOf(store).cash, beforeCash - payload.totalCost)
  })

  it('E — SKIP + primeiro commit falha → retry → settled → handoff livre', async () => {
    const { store } = storeWithPlan('CLIENTS')
    const before = { ...actorOf(store) }
    let attempts = 0
    const flaky = (args) => {
      attempts += 1
      if (attempts === 1) return { ok: false, reason: 'network' }
      return store.commit(args)
    }
    const got = await runBotEconomicEffectsLoop({
      matchId: MATCH_ID,
      turnPlayerId: BOT_ID,
      turnSeq: TURN_SEQ,
      myUid: HUMAN_ID,
      getLive: () => liveWithAuth(store),
      decide: async () => ({ ...ACTION_SKIP }),
      commit: flaky,
      shouldContinue: continueFromStore(store),
      sleep: async () => {},
    })
    assert.equal(got.ok, true)
    assert.equal(attempts, 2)
    assert.equal(actorOf(store).cash, before.cash)
    assert.equal(actorOf(store).clients, before.clients)
    assert.equal(isBotTurnEffectsSettled(actorOf(store).botTurnEffects), true)
    const hold = shouldBlockBotHandoffForEffects({
      isBotTurn: true,
      effects: actorOf(store).botTurnEffects,
      economicBusy: false,
    })
    assert.equal(hold.block, false)
  })

  it('F — mesma actionId no retry não duplica cash/recurso', async () => {
    const { store } = storeWithPlan('CLIENTS')
    const payload = buildClientsBuyPayload(1)
    const beforeCash = actorOf(store).cash
    const actionId = buildBotEffectActionId({
      matchId: MATCH_ID,
      playerId: BOT_ID,
      turnSeq: TURN_SEQ,
      effectKind: 'CLIENTS',
    })
    let attempts = 0
    const flaky = (args) => {
      attempts += 1
      assert.equal(args.actionId, actionId)
      if (attempts === 1) return { ok: false, casLost: true, reason: 'cas-lost' }
      return store.commit(args)
    }
    await runBotEconomicEffectsLoop({
      matchId: MATCH_ID,
      turnPlayerId: BOT_ID,
      turnSeq: TURN_SEQ,
      myUid: HUMAN_ID,
      getLive: () => liveWithAuth(store),
      decide: async () => payload,
      commit: flaky,
      shouldContinue: continueFromStore(store),
      sleep: async () => {},
    })
    const again = await runOnce(store, async () => payload)
    assert.equal(attempts, 2)
    assert.equal(store.state.commits, 1)
    assert.equal(actorOf(store).cash, beforeCash - payload.totalCost)
    assert.equal(actorOf(store).clients, 2)
    assert.equal(again.reason, 'already-settled')
    assert.equal(store.state.appliedActionIds.filter((id) => id === actionId).length, 1)
  })

  it('G — duas tabs mesmo myUid: só botClaimExecutor autorizado executa', async () => {
    const { store } = storeWithPlan('CLIENTS')
    const payload = buildClientsBuyPayload(1)
    const beforeCash = actorOf(store).cash
    const blocked = await runOnce(store, async () => payload, {
      auth: authFor(TAB_Y, TAB_X),
      executorId: TAB_Y,
    })
    const allowed = await runOnce(store, async () => payload, {
      auth: authFor(TAB_X, TAB_X),
      executorId: TAB_X,
    })
    assert.equal(blocked.ok, false)
    assert.ok(['executor-mismatch', 'not-remote-executor', 'remote-contradicts-proof'].includes(blocked.reason))
    assert.equal(allowed.ok, true)
    assert.equal(store.state.commits, 1)
    assert.equal(actorOf(store).cash, beforeCash - payload.totalCost)
  })

  it('H — broadcastState preserva _expectBotExecutor e o CAS remoto valida', () => {
    const root = join(dirname(fileURLToPath(import.meta.url)), '../../..')
    const app = readFileSync(join(root, 'src/App.jsx'), 'utf8')
    const engine = readFileSync(join(root, 'src/game/useTurnEngine.jsx'), 'utf8')
    assert.ok(app.includes('applyBroadcastCommitExpect(statePatch, patch)'))
    assert.ok(engine.includes("_expectBotExecutor: claimProofRef?.current?.executorId"))
    const prev = {
      matchId: MATCH_ID,
      turnPlayerId: BOT_ID,
      turnSeq: TURN_SEQ,
      lockOwner: HUMAN_ID,
      botClaimExecutor: TAB_X,
      players: [botPlayer()],
    }
    const enginePatch = {
      kind: 'PLAYER_DELTA',
      _commitKind: 'BOT_EFFECT',
      _expectMatchId: MATCH_ID,
      _expectTurnPlayerId: BOT_ID,
      _expectTurnSeq: TURN_SEQ,
      _expectLockOwner: HUMAN_ID,
      _expectBotExecutor: TAB_X,
    }
    const okPath = broadcastThenCas(prev, enginePatch)
    assert.equal(okPath.statePatch._expectBotExecutor, TAB_X)
    assert.equal(okPath.cas.ok, true)
    const rejected = broadcastThenCas(prev, { ...enginePatch, _expectBotExecutor: TAB_Y })
    assert.equal(rejected.statePatch._expectBotExecutor, TAB_Y)
    assert.equal(rejected.cas.ok, false)
    assert.equal(rejected.cas.reason, 'executor-mismatch')
  })

  it('I — broadcastState preserva _expectMatchId e o CAS remoto valida', () => {
    const root = join(dirname(fileURLToPath(import.meta.url)), '../../..')
    const app = readFileSync(join(root, 'src/App.jsx'), 'utf8')
    const engine = readFileSync(join(root, 'src/game/useTurnEngine.jsx'), 'utf8')
    assert.ok(app.includes('applyBroadcastCommitExpect(statePatch, patch)'))
    assert.ok(engine.includes('_expectMatchId: matchId'))
    const prev = {
      matchId: MATCH_ID,
      turnPlayerId: BOT_ID,
      turnSeq: TURN_SEQ,
      lockOwner: HUMAN_ID,
      botClaimExecutor: TAB_X,
      players: [botPlayer()],
    }
    const enginePatch = {
      kind: 'PLAYER_DELTA',
      _commitKind: 'BOT_EFFECT',
      _expectMatchId: MATCH_ID,
      _expectTurnPlayerId: BOT_ID,
      _expectTurnSeq: TURN_SEQ,
      _expectLockOwner: HUMAN_ID,
      _expectBotExecutor: TAB_X,
    }
    const okPath = broadcastThenCas(prev, enginePatch)
    assert.equal(okPath.statePatch._expectMatchId, MATCH_ID)
    assert.equal(okPath.cas.ok, true)
    const rejected = broadcastThenCas(prev, { ...enginePatch, _expectMatchId: 'other-match' })
    assert.equal(rejected.statePatch._expectMatchId, 'other-match')
    assert.equal(rejected.cas.ok, false)
    assert.equal(rejected.cas.reason, 'stale-match-id')
  })

  it('J — settled=false + busy=false reagenda; não fica tick sem trabalho', () => {
    const plan = planFor('CLIENTS')
    const gate = shouldRunBotEconomicEffects({
      currentPlayer: botPlayer({ botTurnEffects: plan }),
      turnPlayerId: BOT_ID,
      ...authFor(TAB_X),
    })
    const resched = shouldRescheduleBotEconomicEffects({
      isBotTurn: true,
      effects: plan,
      economicBusy: false,
      eventsInProgress: false,
      gate,
    })
    assert.equal(resched.ok, true)
    const inFlight = shouldRescheduleBotEconomicEffects({
      isBotTurn: true,
      effects: plan,
      economicBusy: true,
      eventsInProgress: false,
      gate,
    })
    assert.equal(inFlight.ok, false)
    const acceptBusy = shouldAcceptBotEconomicJob({
      busy: true,
      activeKey: `${MATCH_ID}|${BOT_ID}|${TURN_SEQ}`,
      nextKey: `${MATCH_ID}|${BOT_ID}|${TURN_SEQ}`,
    })
    assert.equal(acceptBusy.ok, false)
    assert.equal(acceptBusy.reason, 'single-flight')
    let jobs = 0
    let busy = false
    let settled = false
    for (let i = 0; i < 8; i += 1) {
      const effects = settled
        ? { ...plan, done: ['CLIENTS'], settled: true }
        : plan
      const hold = shouldBlockBotHandoffForEffects({
        isBotTurn: true,
        effects,
        economicBusy: busy,
      })
      if (!hold.block) break
      const again = shouldRescheduleBotEconomicEffects({
        isBotTurn: true,
        effects,
        economicBusy: busy,
        eventsInProgress: false,
        gate,
      })
      const accept = shouldAcceptBotEconomicJob({ busy, nextKey: 'job' })
      if (again.ok && accept.ok) {
        jobs += 1
        busy = true
        settled = true
        busy = false
      }
    }
    assert.equal(jobs, 1)
    assert.equal(
      shouldBlockBotHandoffForEffects({
        isBotTurn: true,
        effects: { ...plan, done: ['CLIENTS'], settled: true },
        economicBusy: false,
      }).block,
      false,
    )
  })

  it('K — executor muda durante retry: aba antiga cancela', async () => {
    const { store } = storeWithPlan('CLIENTS')
    const payload = buildClientsBuyPayload(1)
    const beforeCash = actorOf(store).cash
    let attempts = 0
    const flaky = (args) => {
      attempts += 1
      if (attempts === 1) {
        store.setBotClaimExecutor(TAB_Y)
        return { ok: false, casLost: true, reason: 'cas-lost' }
      }
      return store.commit({ ...args, executorId: TAB_X })
    }
    const got = await runBotEconomicEffectsLoop({
      matchId: MATCH_ID,
      turnPlayerId: BOT_ID,
      turnSeq: TURN_SEQ,
      myUid: HUMAN_ID,
      getLive: () => ({
        ...liveWithAuth(store, TAB_X),
        remoteExecutorId: store.state.botClaimExecutor,
        botClaimExecutor: store.state.botClaimExecutor,
      }),
      decide: async () => payload,
      commit: flaky,
      shouldContinue: continueFromStore(store, { executorId: TAB_X }, authFor(TAB_X, TAB_X)),
      sleep: async () => {},
    })
    assert.equal(got.ok, false)
    assert.ok(['executor-mismatch', 'remote-contradicts-proof', 'not-remote-executor'].includes(got.reason))
    assert.equal(actorOf(store).cash, beforeCash)
    assert.equal(store.state.commits, 0)
    assert.equal(isBotTurnEffectsSettled(actorOf(store).botTurnEffects), false)
  })

  it('L — turnSeq muda durante retry: commit antigo cancela', async () => {
    const { store } = storeWithPlan('CLIENTS')
    const payload = buildClientsBuyPayload(1)
    const beforeCash = actorOf(store).cash
    let attempts = 0
    const flaky = (args) => {
      attempts += 1
      if (attempts === 1) {
        store.advanceTurnSeq()
        return { ok: false, casLost: true, reason: 'cas-lost' }
      }
      return store.commit(args)
    }
    const got = await runBotEconomicEffectsLoop({
      matchId: MATCH_ID,
      turnPlayerId: BOT_ID,
      turnSeq: TURN_SEQ,
      myUid: HUMAN_ID,
      getLive: () => liveWithAuth(store),
      decide: async () => payload,
      commit: flaky,
      shouldContinue: continueFromStore(store),
      sleep: async () => {},
    })
    assert.equal(got.ok, false)
    assert.equal(got.reason, 'turn-seq-changed')
    assert.equal(actorOf(store).cash, beforeCash)
    assert.equal(store.state.commits, 0)
  })
})
