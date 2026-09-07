/**
 * Recuperação do turno da máquina após F5/reload.
 * Executa helpers e o pipeline reais — não prova por regex de source.
 */
import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { runBotTurnPipeline, shouldContinueBotTurnCycle } from '../bots/botTurnPipeline.js'
import { validateClaimRetryContinue } from '../bots/botClaimRetry.js'
import {
  buildBotMoveCrossing,
  classifyBotTurnRecovery,
  classifyExecutorTakeover,
  findConfirmedBotMoveAction,
  hasConfirmedBotMoveForTurn,
  isBotTurnEligibleForReloadRecovery,
  isReloadRecoveryCurrent,
  buildLocallyStartedBotTurnKey,
  pendingOwnsCurrentBotTurn,
  planBotReloadHandoff,
  readBotMoveCrossing,
  rebuildBotPendingAfterConfirmedMove,
  replayBotStepsFromSeed,
  shouldAllowBotReloadRecovery,
} from '../bots/botReloadRecovery.js'
import { buildBotMoveActionId } from '../bots/botMoveBarrier.js'
import { createBotRng, rollFairDie } from '../bots/botRandom.js'
import { botTurnKey, BOT_LEASE_MS, isBotPlayer } from '../bots/botTypes.js'
import { shouldDiscardSameSeatHandoffPending } from '../turnStateMonotonic.js'
import {
  applyMatchTransientEndgameReset,
  decideMatchTransientEndgameReset,
} from '../matchEntryReadiness.js'
import { validateTurnCommit } from '../turnCommitValidation.js'
import { applyGamePatchToState } from '../playerStateSync.js'
import { pickWinnerByPatrimonio } from '../patrimonio.js'
import { shouldFinishAfterRoundTransition } from '../roundEndDecision.js'

const MATCH_ID = 'match-reload-1'
const HUMAN_ID = 'human-host'
const BOT_ID = 'bot:match-reload-1:0'
const TAB_X = 'tab-X'
const TAB_Y = 'tab-Y'
const TURN_SEQ = 7

const human = {
  id: HUMAN_ID,
  name: 'Arthur',
  isBot: false,
  pos: 4,
  cash: 18000,
  lastRevenueRound: 1,
  waitingAtRevenue: false,
}
const bot = {
  id: BOT_ID,
  name: 'Máquina 1',
  isBot: true,
  controller: 'BOT',
  pos: 9,
  cash: 18000,
  lastRevenueRound: 1,
  waitingAtRevenue: false,
}

function clonePlayer(p) {
  return {
    ...p,
    lastActions: p.lastActions ? { ...p.lastActions } : undefined,
  }
}

function moveActionId(executor = TAB_X) {
  return buildBotMoveActionId({
    matchId: MATCH_ID,
    turnPlayerId: BOT_ID,
    turnSeq: TURN_SEQ,
    executorId: executor,
  })
}

function createHarness({
  commitResult = { ok: true },
  remoteExecutor = null,
  lastRollTurnKey = null,
  lastRoll = null,
  lastActions = null,
  players = [clonePlayer(human), clonePlayer(bot)],
  turnSeq = TURN_SEQ,
  turnPlayerId = BOT_ID,
  lockTs = null,
  turnLock = false,
  lockOwner = null,
  executorId = TAB_Y,
  botTurnSeed = null,
  botTurnKeyValue = null,
  onBotRoll = null,
  onRecoverHandoff = null,
  handoffMaxWaitMs = 80,
  claimDelayMs = 0,
  lateMoveWaitMs = 0,
  ...extra
} = {}) {
  const live = {
    enabled: true,
    botsEnabled: true,
    authoritativeNetEnabled: true,
    matchId: MATCH_ID,
    turnPlayerId,
    turnSeq,
    gameOver: false,
    turnLock,
    lockOwner,
    lockTs,
    lastRollTurnKey,
    lastRoll,
    lastActions,
    currentPlayer: turnPlayerId === BOT_ID ? bot : human,
    players,
    remoteMatchId: MATCH_ID,
    remoteTurnPlayerId: turnPlayerId,
    remoteTurnSeq: turnSeq,
    remoteGameOver: false,
    botTurnKey: botTurnKeyValue,
    botTurnSeed,
    botClaimExecutor: remoteExecutor,
  }
  const rolls = []
  const claims = []
  const handoffs = []
  const liveRef = { current: live }
  const abort = new AbortController()
  const expectedKey = botTurnKey(MATCH_ID, BOT_ID, turnSeq)

  const args = {
    signal: abort.signal,
    liveRef,
    claimProofRef: { current: null },
    ranKeysRef: { current: [] },
    executorId,
    matchId: MATCH_ID,
    turnPlayerId: BOT_ID,
    turnSeq,
    botPlayer: bot,
    myUidRef: { current: HUMAN_ID },
    lobbyHostIdRef: { current: HUMAN_ID },
    playersRef: { current: players },
    presenceListRef: { current: [{ playerId: HUMAN_ID, lastSeen: Date.now() }] },
    presenceFetchMetaRef: { current: { hasAttemptedFetch: true, lastFetchError: null } },
    commitClaimRef: {
      current: async (payload) => {
        claims.push(payload)
        const result =
          typeof commitResult === 'function' ? commitResult(payload, live) : commitResult
        if (result?.ok === true) {
          live.botClaimExecutor = payload.claim?.executorId ?? executorId
          live.turnLock = true
          live.lockOwner = HUMAN_ID
          live.lockTs = Date.now()
          live.botTurnSeed = payload.seed
          live.botTurnKey = payload.turnKey || expectedKey
        }
        return result
      },
    },
    onBotRollRef: {
      current: async (payload) => {
        rolls.push(payload)
        if (typeof onBotRoll === 'function') return onBotRoll(payload, live, rolls)
        live.lastRollTurnKey = String(turnSeq)
        live.lastRoll = {
          playerId: BOT_ID,
          playerName: 'Máquina 1',
          steps: payload.steps,
          turnKey: String(turnSeq),
        }
        const actionId = moveActionId(executorId)
        const botRow = (live.players || []).find((p) => p.id === BOT_ID)
        if (botRow) {
          botRow.lastActions = { ...(botRow.lastActions || {}), [actionId]: Date.now() }
        }
        live.lastActions = { ...(live.lastActions || {}), [actionId]: Date.now() }
        live.turnPlayerId = HUMAN_ID
        live.remoteTurnPlayerId = HUMAN_ID
        live.turnSeq = turnSeq + 1
        live.remoteTurnSeq = turnSeq + 1
        return { ok: true }
      },
    },
    onRecoverHandoff: async (recovery) => {
      handoffs.push(recovery)
      if (typeof onRecoverHandoff === 'function') {
        return onRecoverHandoff(recovery, live, handoffs)
      }
      live.turnPlayerId = HUMAN_ID
      live.remoteTurnPlayerId = HUMAN_ID
      live.turnSeq = turnSeq + 1
      live.remoteTurnSeq = turnSeq + 1
      live.lastRollTurnKey = null
    },
    roundRef: { current: 1 },
    maxRoundsRef: { current: 5 },
    coordinatorIdRef: { current: null },
    thinkDelayMs: 0,
    waitDelayMs: 0,
    claimDelayMs,
    handoffPollMs: 0,
    handoffMaxWaitMs,
    rollDelayMs: 0,
    rollMaxBackoffMs: 0,
    lateMoveWaitMs,
    ...extra,
  }

  return {
    live,
    liveRef,
    rolls,
    claims,
    handoffs,
    abort,
    run: () => runBotTurnPipeline(args),
    args,
  }
}

describe('classificação A/B/C/D', () => {
  it('A — sem ROLL; B — roll sem evidência de move; C — BOT_MOVE; D — turno avançou', () => {
    const a = classifyBotTurnRecovery({
      expectedTurnPlayerId: BOT_ID,
      expectedTurnSeq: TURN_SEQ,
      turnPlayerId: BOT_ID,
      turnSeq: TURN_SEQ,
      lastRollTurnKey: null,
      matchId: MATCH_ID,
    })
    assert.equal(a.case, 'A')
    assert.equal(a.allowRoll, true)

    const b = classifyBotTurnRecovery({
      expectedTurnPlayerId: BOT_ID,
      expectedTurnSeq: TURN_SEQ,
      turnPlayerId: BOT_ID,
      turnSeq: TURN_SEQ,
      lastRollTurnKey: String(TURN_SEQ),
      matchId: MATCH_ID,
    })
    assert.equal(b.case, 'B')
    assert.equal(b.allowRoll, false)
    assert.equal(b.allowMove, false)
    assert.equal(b.reason, 'reload-recovery-unsafe')

    const actionId = moveActionId()
    const c = classifyBotTurnRecovery({
      expectedTurnPlayerId: BOT_ID,
      expectedTurnSeq: TURN_SEQ,
      turnPlayerId: BOT_ID,
      turnSeq: TURN_SEQ,
      lastRollTurnKey: String(TURN_SEQ),
      lastRoll: { playerId: BOT_ID, steps: 4, turnKey: String(TURN_SEQ) },
      players: [{ ...bot, lastActions: { [actionId]: 1 } }],
      matchId: MATCH_ID,
    })
    assert.equal(c.case, 'C')
    assert.equal(c.allowHandoff, true)
    assert.equal(c.allowRoll, false)
    assert.equal(c.allowMove, false)
    assert.equal(c.actionId, actionId)
    assert.equal(
      findConfirmedBotMoveAction({
        matchId: MATCH_ID,
        turnPlayerId: BOT_ID,
        turnSeq: TURN_SEQ,
        players: [{ ...bot, lastActions: { [actionId]: 1 } }],
      }).ok,
      true,
    )

    const d = classifyBotTurnRecovery({
      expectedTurnPlayerId: BOT_ID,
      expectedTurnSeq: TURN_SEQ,
      turnPlayerId: HUMAN_ID,
      turnSeq: TURN_SEQ + 1,
      lastRollTurnKey: null,
      matchId: MATCH_ID,
    })
    assert.equal(d.case, 'D')
    assert.equal(d.allowHandoff, false)
  })
})

describe('1 — F5 no turno humano antes do roll', () => {
  it('humano não entra no pipeline; o turno bot seguinte joga uma vez', async () => {
    assert.equal(isBotTurnEligibleForReloadRecovery(human), false)
    assert.equal(isBotPlayer(human), false)
    const humanState = classifyBotTurnRecovery({
      expectedTurnPlayerId: HUMAN_ID,
      expectedTurnSeq: 3,
      turnPlayerId: HUMAN_ID,
      turnSeq: 3,
      lastRollTurnKey: null,
    })
    assert.equal(humanState.case, 'A')

    const h = createHarness({ lastRollTurnKey: null, remoteExecutor: null })
    const result = await h.run()
    assert.equal(result.ok, true)
    assert.equal(h.rolls.length, 1)
    assert.ok(h.rolls[0].steps >= 1 && h.rolls[0].steps <= 6)
  })
})

describe('2 — F5 após humano passar para o bot, antes do BOT_CLAIM', () => {
  it('bot joga exatamente uma vez', async () => {
    const h = createHarness({
      lastRollTurnKey: null,
      remoteExecutor: null,
      turnLock: false,
    })
    const result = await h.run()
    assert.equal(result.ok, true)
    assert.equal(h.rolls.length, 1)
    assert.equal(h.claims.length, 1)
  })
})

describe('3 — F5 após BOT_CLAIM, antes do ROLL (executor X morto)', () => {
  it('Y assume o lease expirado e gera exatamente 1 ROLL', async () => {
    const h = createHarness({
      remoteExecutor: TAB_X,
      executorId: TAB_Y,
      turnLock: true,
      lockOwner: HUMAN_ID,
      lockTs: Date.now() - BOT_LEASE_MS - 50,
      lastRollTurnKey: null,
    })
    const takeover = classifyExecutorTakeover({
      localExecutorId: TAB_Y,
      remoteExecutorId: TAB_X,
      lockTs: Date.now() - BOT_LEASE_MS - 50,
    })
    assert.equal(takeover.action, 'proceed')
    assert.equal(takeover.reason, 'orphan-lease-expired')
    const result = await h.run()
    assert.equal(result.ok, true)
    assert.equal(h.rolls.length, 1)
  })
})

describe('4 — F5 depois do ROLL e antes do BOT_MOVE', () => {
  it('lastRollTurnKey sem evidência de move: NÃO gera segundo ROLL nem inventa movimento', async () => {
    const h = createHarness({
      lastRollTurnKey: String(TURN_SEQ),
      lastRoll: null,
      lastActions: null,
    })
    const result = await h.run()
    assert.equal(h.rolls.length, 0)
    assert.equal(result.ok, false)
    assert.equal(result.reason, 'reload-recovery-unsafe')
  })

  it('persist incompleto (sem lastRollTurnKey) reusa a semente e gera o mesmo steps uma vez', async () => {
    const seed = [11, 22, 33, 44, 55, 66, 77, 88]
    const expectedSteps = rollFairDie(createBotRng(seed))
    const again = rollFairDie(createBotRng(seed))
    assert.equal(again, expectedSteps)

    const h = createHarness({
      lastRollTurnKey: null,
      botTurnSeed: seed,
      botTurnKeyValue: botTurnKey(MATCH_ID, BOT_ID, TURN_SEQ),
    })
    const result = await h.run()
    assert.equal(result.ok, true)
    assert.equal(h.rolls.length, 1)
    assert.equal(h.rolls[0].steps, expectedSteps)
  })
})

describe('5 — F5 depois de BOT_MOVE confirmado, antes do handoff', () => {
  it('NÃO rola, NÃO move, exatamente 1 HANDOFF; tentativas extras são idempotentes', async () => {
    const actionId = moveActionId(TAB_X)
    const players = [
      human,
      { ...bot, lastActions: { [actionId]: Date.now() } },
    ]
    const lastRoll = {
      playerId: BOT_ID,
      playerName: 'Máquina 1',
      steps: 5,
      turnKey: String(TURN_SEQ),
    }
    const h1 = createHarness({
      lastRollTurnKey: String(TURN_SEQ),
      lastRoll,
      lastActions: { [actionId]: Date.now() },
      players,
    })
    const first = await h1.run()
    assert.equal(h1.rolls.length, 0)
    assert.equal(h1.handoffs.length, 1)
    assert.equal(first.recovered, 'handoff')
    assert.equal(first.ok, true)

    const again = await h1.run()
    assert.equal(h1.rolls.length, 0)
    assert.equal(h1.handoffs.length, 1)
    assert.ok(['turn-advanced', 'turn-seq-changed', 'turn-player-changed'].includes(again.reason))
  })
})

describe('6 — executor antigo ainda vivo', () => {
  it('Y não executa concorrente enquanto o lease de X é válido', async () => {
    const cycle = shouldContinueBotTurnCycle({
      getLive: () => ({
        enabled: true,
        botsEnabled: true,
        gameOver: false,
        matchId: MATCH_ID,
        turnPlayerId: BOT_ID,
        turnSeq: TURN_SEQ,
        lastRollTurnKey: null,
        botClaimExecutor: TAB_X,
        lockTs: Date.now(),
      }),
      expectedMatchId: MATCH_ID,
      expectedTurnPlayerId: BOT_ID,
      expectedTurnSeq: TURN_SEQ,
      localExecutorId: TAB_Y,
    })
    assert.equal(cycle.ok, false)
    assert.equal(cycle.waiting, true)
    assert.equal(cycle.terminal, false)
    assert.equal(cycle.reason, 'other-executor')

    const claimGate = validateClaimRetryContinue({
      enabled: true,
      botsEnabled: true,
      expectedMatchId: MATCH_ID,
      expectedTurnPlayerId: BOT_ID,
      expectedTurnSeq: TURN_SEQ,
      expectedTurnKey: botTurnKey(MATCH_ID, BOT_ID, TURN_SEQ),
      lastRollTurnKey: null,
      localExecutorId: TAB_Y,
      remoteExecutorId: TAB_X,
      lockTs: Date.now(),
      requireRemote: true,
      remoteMatchId: MATCH_ID,
      remoteTurnPlayerId: BOT_ID,
      remoteTurnSeq: TURN_SEQ,
      remoteGameOver: false,
    })
    assert.equal(claimGate.ok, false)
    assert.equal(claimGate.terminal, false)
    assert.equal(claimGate.reason, 'other-executor')

    const h = createHarness({
      remoteExecutor: TAB_X,
      executorId: TAB_Y,
      turnLock: true,
      lockOwner: HUMAN_ID,
      lockTs: Date.now(),
      claimDelayMs: 5,
    })
    const pending = h.run()
    setTimeout(() => h.abort.abort(), 25)
    const result = await pending
    assert.equal(h.rolls.length, 0)
    assert.equal(result.ok, false)
  })
})

describe('7 — executor órfão / lease expirado', () => {
  it('Y continua sem deadlock e joga uma vez', async () => {
    const takeover = classifyExecutorTakeover({
      localExecutorId: TAB_Y,
      remoteExecutorId: TAB_X,
      lockTs: Date.now() - BOT_LEASE_MS - 10,
    })
    assert.equal(takeover.action, 'proceed')

    const h = createHarness({
      remoteExecutor: TAB_X,
      executorId: TAB_Y,
      turnLock: true,
      lockOwner: HUMAN_ID,
      lockTs: Date.now() - BOT_LEASE_MS - 10,
    })
    const result = await h.run()
    assert.equal(result.ok, true)
    assert.equal(h.rolls.length, 1)
  })
})

describe('8 — turnSeq muda enquanto recovery aguarda', () => {
  it('recovery antigo cancela e não altera o turno novo', async () => {
    const h = createHarness({
      remoteExecutor: TAB_X,
      executorId: TAB_Y,
      turnLock: true,
      lockOwner: HUMAN_ID,
      lockTs: Date.now(),
      claimDelayMs: 5,
    })
    const pending = h.run()
    setTimeout(() => {
      h.live.turnSeq = TURN_SEQ + 1
      h.live.remoteTurnSeq = TURN_SEQ + 1
      h.live.turnPlayerId = HUMAN_ID
      h.live.remoteTurnPlayerId = HUMAN_ID
    }, 12)
    const result = await pending
    assert.equal(h.rolls.length, 0)
    assert.ok(['turn-seq-changed', 'turn-player-changed', 'cancelled'].includes(result.reason))
  })
})

describe('9 — MATCH A → Lobby → MATCH B continua intacto', () => {
  it('só a mudança de matchId reseta refs; o mesmo match não dispara recovery obsoleto', () => {
    const refs = {
      endGameFinalized: true,
      endGamePending: true,
      pendingTurnData: { nextTurnIdx: 1, originTurnSeq: 47 },
      turnChangeInProgress: true,
    }
    const lobby = decideMatchTransientEndgameReset({
      previousMatchId: 'match-A',
      nextMatchId: null,
    })
    assert.equal(lobby.reset, false)
    const toB = decideMatchTransientEndgameReset({
      previousMatchId: 'match-A',
      nextMatchId: 'match-B',
    })
    assert.equal(toB.reset, true)
    applyMatchTransientEndgameReset(refs)
    assert.equal(refs.pendingTurnData, null)
    assert.equal(refs.endGameFinalized, false)

    const stale = classifyBotTurnRecovery({
      expectedTurnPlayerId: BOT_ID,
      expectedTurnSeq: 47,
      turnPlayerId: HUMAN_ID,
      turnSeq: 0,
      lastRollTurnKey: null,
      matchId: 'match-B',
    })
    assert.equal(stale.case, 'D')
  })
})

describe('10 — same-seat continua intacto', () => {
  it('Arthur waitingAtRevenue: o plano de reload permite o mesmo assento', () => {
    const arthur = { ...human, waitingAtRevenue: true, bankrupt: false }
    const machine = { ...bot, waitingAtRevenue: false }
    const plan = planBotReloadHandoff({
      players: [arthur, machine],
      turnPlayerId: BOT_ID,
      turnSeq: 47,
      turnIdx: 1,
      round: 1,
      maxRounds: 1,
    })
    assert.ok(plan)
    assert.equal(plan.nextTurnPlayerId, BOT_ID)
    assert.equal(plan.sameSeat, true)
    assert.equal(
      shouldDiscardSameSeatHandoffPending(
        {
          nextTurnIdx: 1,
          nextTurnPlayerId: BOT_ID,
          originTurnSeq: 47,
          originTurnPlayerId: BOT_ID,
        },
        { turnIdx: 1, turnPlayerId: BOT_ID, turnSeq: 47 },
      ),
      false,
    )
  })
})

describe('11 — waitingAtRevenue / lastRevenueRound continuam intactos', () => {
  it('o plano de handoff não muta lastRevenueRound nem waitingAtRevenue', () => {
    const arthur = {
      ...human,
      lastRevenueRound: 5,
      waitingAtRevenue: true,
    }
    const machine = {
      ...bot,
      lastRevenueRound: 4,
      waitingAtRevenue: false,
    }
    const before = {
      arthurLrr: arthur.lastRevenueRound,
      arthurWait: arthur.waitingAtRevenue,
      botLrr: machine.lastRevenueRound,
      botWait: machine.waitingAtRevenue,
    }
    const plan = planBotReloadHandoff({
      players: [arthur, machine],
      turnPlayerId: BOT_ID,
      turnSeq: TURN_SEQ,
      turnIdx: 1,
      round: 5,
      maxRounds: 5,
    })
    assert.equal(arthur.lastRevenueRound, before.arthurLrr)
    assert.equal(arthur.waitingAtRevenue, before.arthurWait)
    assert.equal(machine.lastRevenueRound, before.botLrr)
    assert.equal(machine.waitingAtRevenue, before.botWait)
    assert.equal(plan.nextTurnPlayerId, BOT_ID)
    assert.equal(plan.shouldIncrementRound, false)
    assert.equal(plan.endGame, false)
  })
})

describe('idempotência lógica', () => {
  it('mesmo turnSeq + BOT_MOVE persistido + várias recuperações = 1 ROLL, 1 MOVE, 1 HANDOFF', async () => {
    const actionId = moveActionId(TAB_X)
    const players = [{ ...bot, lastActions: { [actionId]: 1 } }, human]
    const h = createHarness({
      lastRollTurnKey: String(TURN_SEQ),
      lastRoll: { playerId: BOT_ID, steps: 3, turnKey: String(TURN_SEQ) },
      lastActions: { [actionId]: 1 },
      players,
    })
    const first = await h.run()
    const second = await h.run()
    const third = await h.run()
    assert.equal(first.recovered, 'handoff')
    assert.ok(['turn-advanced', 'turn-seq-changed', 'turn-player-changed'].includes(second.reason))
    assert.ok(['turn-advanced', 'turn-seq-changed', 'turn-player-changed'].includes(third.reason))
    assert.equal(h.rolls.length, 0)
    assert.equal(h.handoffs.length, 1)
  })

  it('already-rolled no ciclo de ROLL continua terminal (não é segundo dado)', () => {
    const cycle = shouldContinueBotTurnCycle({
      getLive: () => ({
        enabled: true,
        botsEnabled: true,
        gameOver: false,
        matchId: MATCH_ID,
        turnPlayerId: BOT_ID,
        turnSeq: TURN_SEQ,
        lastRollTurnKey: String(TURN_SEQ),
        botClaimExecutor: TAB_Y,
        lockTs: Date.now(),
      }),
      expectedMatchId: MATCH_ID,
      expectedTurnPlayerId: BOT_ID,
      expectedTurnSeq: TURN_SEQ,
      localExecutorId: TAB_Y,
    })
    assert.equal(cycle.ok, false)
    assert.equal(cycle.reason, 'already-rolled')
    assert.equal(cycle.terminal, true)
  })
})

function decideTickFromPending(pending, maxRounds) {
  if (
    shouldFinishAfterRoundTransition({
      endGame: pending.endGame,
      shouldIncrementRound: pending.shouldIncrementRound,
      nextRound: pending.nextRound,
      maxRounds,
    })
  ) {
    return {
      kind: 'ENDGAME',
      winner: pickWinnerByPatrimonio(pending.nextPlayers),
      handoff: false,
    }
  }
  return {
    kind: 'NORMAL_HANDOFF',
    winner: null,
    handoff: true,
    nextTurnPlayerId: pending.nextTurnPlayerId,
    nextRound: pending.nextRound,
    shouldIncrementRound: pending.shouldIncrementRound,
  }
}

function persistCrossingOnBot(players, crossedStart, executor = TAB_X) {
  const actionId = moveActionId(executor)
  return players.map((p) =>
    p.id === BOT_ID
      ? {
          ...p,
          lastActions: { ...(p.lastActions || {}), [actionId]: Date.now() },
          botMoveCrossing: buildBotMoveCrossing({
            matchId: MATCH_ID,
            turnPlayerId: BOT_ID,
            turnSeq: TURN_SEQ,
            actionId,
            crossedStart,
          }),
        }
      : p,
  )
}

describe('A — round normal 1→2 após BOT_MOVE + F5', () => {
  it('Máquina última a completar round 1: pending incrementa; tick faz 1 HANDOFF sem ENDGAME', () => {
    const players = persistCrossingOnBot(
      [
        { ...human, lastRevenueRound: 1, waitingAtRevenue: false },
        { ...bot, lastRevenueRound: 1, waitingAtRevenue: false, pos: 2 },
      ],
      true,
    )
    const crossing = readBotMoveCrossing({
      players,
      matchId: MATCH_ID,
      turnPlayerId: BOT_ID,
      turnSeq: TURN_SEQ,
    })
    assert.equal(crossing.ok, true)
    assert.equal(crossing.crossedStart, true)

    const pending = rebuildBotPendingAfterConfirmedMove({
      players,
      turnPlayerId: BOT_ID,
      turnSeq: TURN_SEQ,
      turnIdx: 1,
      round: 1,
      maxRounds: 2,
      roundFlags: [true, true],
      crossedStart: crossing.crossedStart,
    })
    assert.equal(pending.shouldIncrementRound, true)
    assert.equal(pending.nextRound, 2)
    assert.equal(pending.endGame, false)
    assert.equal(pending.effectsSettled, false)

    const tick = decideTickFromPending(pending, 2)
    assert.equal(tick.kind, 'NORMAL_HANDOFF')
    assert.equal(tick.shouldIncrementRound, true)
    assert.equal(tick.nextRound, 2)

    const commit = validateTurnCommit(
      {
        matchId: MATCH_ID,
        turnPlayerId: BOT_ID,
        turnSeq: TURN_SEQ,
        players,
        gameOver: false,
        turnLock: true,
        lockOwner: HUMAN_ID,
        lastRollTurnKey: String(TURN_SEQ),
        round: 1,
      },
      {
        kind: 'TURN',
        turnPlayerId: HUMAN_ID,
        turnSeq: TURN_SEQ + 1,
        lastRollTurnKey: null,
        round: 2,
        _expectTurnPlayerId: BOT_ID,
        _expectTurnSeq: TURN_SEQ,
        _commitKind: 'NORMAL_HANDOFF',
      },
    )
    assert.equal(commit.ok, true)
  })
})

describe('B — allAliveDone sem crossedStart deste BOT_MOVE', () => {
  it('não incrementa round: allAliveDone sozinho não basta', () => {
    const players = persistCrossingOnBot(
      [
        { ...human, lastRevenueRound: 1 },
        { ...bot, lastRevenueRound: 1, pos: 18 },
      ],
      false,
    )
    const pending = rebuildBotPendingAfterConfirmedMove({
      players,
      turnPlayerId: BOT_ID,
      turnSeq: TURN_SEQ,
      turnIdx: 1,
      round: 1,
      maxRounds: 2,
      crossedStart: false,
    })
    assert.equal(pending.shouldIncrementRound, false)
    assert.equal(pending.nextRound, 1)
    assert.equal(pending.endGame, false)
  })
})

describe('C — ENDGAME após BOT_MOVE + F5 na rodada final', () => {
  it('pending.endGame; tick existente calcula winner; zero NORMAL_HANDOFF', () => {
    const players = persistCrossingOnBot(
      [
        { ...human, lastRevenueRound: 5, cash: 10_000, bens: 0 },
        { ...bot, lastRevenueRound: 5, cash: 40_000, bens: 0, pos: 1 },
      ],
      true,
    )
    const pending = rebuildBotPendingAfterConfirmedMove({
      players,
      turnPlayerId: BOT_ID,
      turnSeq: TURN_SEQ,
      turnIdx: 1,
      round: 5,
      maxRounds: 5,
      crossedStart: true,
    })
    assert.equal(pending.endGame, true)
    assert.equal(pending.shouldIncrementRound, false)

    const first = decideTickFromPending(pending, 5)
    const second = decideTickFromPending(pending, 5)
    assert.equal(first.kind, 'ENDGAME')
    assert.equal(second.kind, 'ENDGAME')
    assert.equal(first.handoff, false)
    assert.equal(first.winner?.id, BOT_ID)
    assert.equal(second.winner?.id, first.winner?.id)

    const endgame = validateTurnCommit(
      {
        matchId: MATCH_ID,
        turnPlayerId: BOT_ID,
        turnSeq: TURN_SEQ,
        players,
        gameOver: false,
        turnLock: true,
        lockOwner: HUMAN_ID,
        lastRollTurnKey: String(TURN_SEQ),
        round: 5,
      },
      {
        kind: 'ENDGAME',
        lastAction: 'ENDGAME',
        round: 5,
        maxRounds: 5,
        gameOver: true,
        winner: first.winner,
      },
    )
    assert.equal(endgame.ok, true)
  })
})

describe('D — Máquina termina a volta final antes dos outros', () => {
  it('permanece parked; demais continuam; zero novo turno para Máquina', () => {
    const players = persistCrossingOnBot(
      [
        { ...human, lastRevenueRound: 4, waitingAtRevenue: false },
        { ...bot, lastRevenueRound: 5, waitingAtRevenue: true, pos: 0 },
      ],
      true,
    )
    const pending = rebuildBotPendingAfterConfirmedMove({
      players,
      turnPlayerId: BOT_ID,
      turnSeq: TURN_SEQ,
      turnIdx: 1,
      round: 5,
      maxRounds: 5,
      crossedStart: true,
    })
    assert.equal(pending.endGame, false)
    assert.equal(pending.shouldIncrementRound, false)
    assert.equal(pending.nextTurnPlayerId, HUMAN_ID)
    assert.equal(players[1].waitingAtRevenue, true)
    assert.notEqual(pending.nextTurnPlayerId, BOT_ID)
  })
})

describe('E — BOT_MOVE comum sem cruzar start', () => {
  it('handoff normal, sem incremento e sem ENDGAME', () => {
    const players = persistCrossingOnBot(
      [
        { ...human, lastRevenueRound: 0 },
        { ...bot, lastRevenueRound: 0, pos: 12 },
      ],
      false,
    )
    const pending = rebuildBotPendingAfterConfirmedMove({
      players,
      turnPlayerId: BOT_ID,
      turnSeq: TURN_SEQ,
      turnIdx: 1,
      round: 1,
      maxRounds: 5,
      crossedStart: false,
    })
    assert.equal(pending.shouldIncrementRound, false)
    assert.equal(pending.endGame, false)
    assert.equal(decideTickFromPending(pending, 5).kind, 'NORMAL_HANDOFF')
  })
})

describe('F — commit X atrasado após F5', () => {
  it('Y não gera segundo ROLL/BOT_MOVE; um único HANDOFF lógico', async () => {
    const h = createHarness({
      remoteExecutor: TAB_X,
      executorId: TAB_Y,
      turnLock: true,
      lockOwner: HUMAN_ID,
      lockTs: Date.now() - BOT_LEASE_MS - 20,
      lastRollTurnKey: null,
      lastActions: null,
      lateMoveWaitMs: 80,
      claimDelayMs: 5,
    })
    const pending = h.run()
    setTimeout(() => {
      const actionId = moveActionId(TAB_X)
      h.live.lastRollTurnKey = String(TURN_SEQ)
      h.live.lastRoll = {
        playerId: BOT_ID,
        steps: 4,
        turnKey: String(TURN_SEQ),
      }
      h.live.lastActions = { [actionId]: Date.now() }
      const botRow = (h.live.players || []).find((p) => p.id === BOT_ID)
      if (botRow) {
        botRow.lastActions = { [actionId]: Date.now() }
        botRow.botMoveCrossing = buildBotMoveCrossing({
          matchId: MATCH_ID,
          turnPlayerId: BOT_ID,
          turnSeq: TURN_SEQ,
          actionId,
          crossedStart: false,
        })
      }
    }, 15)
    const result = await pending
    assert.equal(h.rolls.length, 0)
    assert.equal(h.handoffs.length, 1)
    assert.equal(result.recovered, 'handoff')
    assert.equal(
      hasConfirmedBotMoveForTurn({
        matchId: MATCH_ID,
        turnPlayerId: BOT_ID,
        turnSeq: TURN_SEQ,
        players: h.live.players,
        lastActions: h.live.lastActions,
        lastRoll: h.live.lastRoll,
      }).ok,
      true,
    )
  })
})

describe('G — recovery repetido é idempotente', () => {
  it('mesmo pending reconstruído duas vezes e o mesmo pipeline duas vezes = um efeito', async () => {
    const players = persistCrossingOnBot(
      [
        { ...human, lastRevenueRound: 1 },
        { ...bot, lastRevenueRound: 1 },
      ],
      true,
    )
    const a = rebuildBotPendingAfterConfirmedMove({
      players,
      turnPlayerId: BOT_ID,
      turnSeq: TURN_SEQ,
      turnIdx: 1,
      round: 1,
      maxRounds: 2,
      crossedStart: true,
    })
    const b = rebuildBotPendingAfterConfirmedMove({
      players,
      turnPlayerId: BOT_ID,
      turnSeq: TURN_SEQ,
      turnIdx: 1,
      round: 1,
      maxRounds: 2,
      crossedStart: true,
    })
    assert.equal(a.shouldIncrementRound, b.shouldIncrementRound)
    assert.equal(a.nextRound, b.nextRound)
    assert.equal(a.endGame, b.endGame)
    assert.equal(a.nextTurnPlayerId, b.nextTurnPlayerId)

    const actionId = moveActionId(TAB_X)
    const h = createHarness({
      lastRollTurnKey: String(TURN_SEQ),
      lastRoll: { playerId: BOT_ID, steps: 3, turnKey: String(TURN_SEQ) },
      lastActions: { [actionId]: 1 },
      players,
    })
    const first = await h.run()
    const second = await h.run()
    assert.equal(first.recovered, 'handoff')
    assert.equal(h.handoffs.length, 1)
    assert.equal(h.rolls.length, 0)
    assert.ok(['turn-advanced', 'turn-seq-changed', 'turn-player-changed'].includes(second.reason))
  })
})

describe('H — turnSeq muda no meio do recovery', () => {
  it('recovery antigo aborta e não rola', async () => {
    const actionId = moveActionId(TAB_X)
    const h = createHarness({
      lastRollTurnKey: String(TURN_SEQ),
      lastRoll: { playerId: BOT_ID, steps: 2, turnKey: String(TURN_SEQ) },
      lastActions: { [actionId]: 1 },
      players: [{ ...bot, lastActions: { [actionId]: 1 } }, human],
      onRecoverHandoff: async () => {
        await new Promise((resolve) => setTimeout(resolve, 25))
      },
      handoffMaxWaitMs: 80,
    })
    const pending = h.run()
    setTimeout(() => {
      h.live.turnSeq = TURN_SEQ + 1
      h.live.remoteTurnSeq = TURN_SEQ + 1
      h.live.turnPlayerId = HUMAN_ID
      h.live.remoteTurnPlayerId = HUMAN_ID
    }, 5)
    const result = await pending
    assert.equal(h.rolls.length, 0)
    assert.equal(
      isReloadRecoveryCurrent({
        expectedTurnPlayerId: BOT_ID,
        expectedTurnSeq: TURN_SEQ,
        turnPlayerId: h.live.turnPlayerId,
        turnSeq: h.live.turnSeq,
      }),
      false,
    )
    assert.ok(result.ok === true || result.reason === 'handoff-timeout' || result.recovered)
  })
})

describe('botMoveCrossing persiste no mesmo BOT_MOVE', () => {
  it('PLAYER_DELTA aplica crossedStart vinculado a match/turn/actionId', () => {
    const actionId = moveActionId(TAB_X)
    const crossing = buildBotMoveCrossing({
      matchId: MATCH_ID,
      turnPlayerId: BOT_ID,
      turnSeq: TURN_SEQ,
      actionId,
      crossedStart: true,
    })
    const applied = applyGamePatchToState(
      {
        matchId: MATCH_ID,
        turnPlayerId: BOT_ID,
        turnSeq: TURN_SEQ,
        players: [human, bot],
        gameOver: false,
        turnLock: true,
        lockOwner: HUMAN_ID,
      },
      {
        playersDeltaById: {
          [BOT_ID]: { pos: 3, _actionId: actionId, botMoveCrossing: crossing },
        },
        statePatch: {
          kind: 'PLAYER_DELTA',
          actionId,
          lastRollTurnKey: String(TURN_SEQ),
          _commitKind: 'BOT_MOVE',
          _expectTurnPlayerId: BOT_ID,
          _expectTurnSeq: TURN_SEQ,
        },
      },
    )
    assert.equal(applied.ok, true)
    const stored = readBotMoveCrossing({
      players: applied.state.players,
      matchId: MATCH_ID,
      turnPlayerId: BOT_ID,
      turnSeq: TURN_SEQ,
    })
    assert.equal(stored.ok, true)
    assert.equal(stored.crossedStart, true)
    assert.equal(stored.actionId, actionId)
  })
})

describe('caso B: seed não destrava lastRollTurnKey', () => {
  it('replay da seed reproduz o dado, mas o fail-safe permanece', () => {
    const seed = [11, 22, 33, 44, 55, 66, 77, 88]
    const steps = replayBotStepsFromSeed(seed, rollFairDie, createBotRng)
    assert.ok(steps >= 1 && steps <= 6)
    const b = classifyBotTurnRecovery({
      expectedTurnPlayerId: BOT_ID,
      expectedTurnSeq: TURN_SEQ,
      turnPlayerId: BOT_ID,
      turnSeq: TURN_SEQ,
      lastRollTurnKey: String(TURN_SEQ),
      matchId: MATCH_ID,
    })
    assert.equal(b.case, 'B')
    assert.equal(b.reason, 'reload-recovery-unsafe')
    assert.equal(b.allowMove, false)
  })
})

describe('NORMAL_HANDOFF de recovery não inventa AUTO_PASS', () => {
  it('validateTurnCommit aceita NORMAL_HANDOFF +1 e recusa AUTO_PASS em turno bot', () => {
    const prev = {
      matchId: MATCH_ID,
      turnPlayerId: BOT_ID,
      turnSeq: TURN_SEQ,
      players: [human, bot],
      gameOver: false,
      turnLock: true,
      lockOwner: HUMAN_ID,
      lastRollTurnKey: String(TURN_SEQ),
    }
    const handoff = validateTurnCommit(prev, {
      kind: 'TURN',
      turnPlayerId: HUMAN_ID,
      turnSeq: TURN_SEQ + 1,
      lastRollTurnKey: null,
      _expectTurnPlayerId: BOT_ID,
      _expectTurnSeq: TURN_SEQ,
      _commitKind: 'NORMAL_HANDOFF',
    })
    assert.equal(handoff.ok, true)
    const autoPass = validateTurnCommit(prev, {
      kind: 'TURN',
      turnPlayerId: HUMAN_ID,
      turnSeq: TURN_SEQ + 1,
      _expectTurnPlayerId: BOT_ID,
      _expectTurnSeq: TURN_SEQ,
      _commitKind: 'AUTO_PASS',
      turnDeadlineAt: Date.now() - 1000,
    })
    assert.equal(autoPass.ok, false)
    assert.equal(autoPass.reason, 'bot-timer-auto-pass')
  })
})

function normalPendingFromAdvance(extra = {}) {
  return {
    nextTurnIdx: 0,
    nextTurnPlayerId: HUMAN_ID,
    originTurnPlayerId: BOT_ID,
    originTurnSeq: TURN_SEQ,
    matchId: MATCH_ID,
    shouldIncrementRound: false,
    endGame: false,
    nextRound: 1,
    recovered: undefined,
    ...extra,
  }
}

describe('isolamento — SEM F5 o recovery não entra no caminho normal', () => {
  it('A — BOT_MOVE confirma, classify C, gate recusa; um ROLL/MOVE, zero rebuild', async () => {
    const actionId = moveActionId(TAB_Y)
    const players = persistCrossingOnBot([human, bot], false, TAB_Y)
    const recovery = classifyBotTurnRecovery({
      expectedTurnPlayerId: BOT_ID,
      expectedTurnSeq: TURN_SEQ,
      turnPlayerId: BOT_ID,
      turnSeq: TURN_SEQ,
      lastRollTurnKey: String(TURN_SEQ),
      lastRoll: { playerId: BOT_ID, steps: 3, turnKey: String(TURN_SEQ) },
      players,
      lastActions: { [actionId]: 1 },
      matchId: MATCH_ID,
    })
    assert.equal(recovery.case, 'C')

    const localKey = buildLocallyStartedBotTurnKey({
      matchId: MATCH_ID,
      turnPlayerId: BOT_ID,
      turnSeq: TURN_SEQ,
    })
    const pending = normalPendingFromAdvance()
    const gate = shouldAllowBotReloadRecovery({
      matchId: MATCH_ID,
      turnPlayerId: BOT_ID,
      turnSeq: TURN_SEQ,
      pending,
      locallyStartedTurnKey: localKey,
    })
    assert.equal(gate.ok, false)
    assert.ok(['locally-started-turn', 'normal-pending-owns-turn'].includes(gate.reason))

    const h = createHarness({ lastRollTurnKey: null, remoteExecutor: null })
    const result = await h.run()
    assert.equal(result.ok, true)
    assert.equal(h.rolls.length, 1)
    assert.equal(h.handoffs.length, 0)
  })

  it('B — recovery não substitui pending original desta montagem', () => {
    const original = normalPendingFromAdvance({
      shouldIncrementRound: true,
      nextRound: 2,
      nextTurnPlayerId: HUMAN_ID,
    })
    assert.equal(
      pendingOwnsCurrentBotTurn({
        pending: original,
        matchId: MATCH_ID,
        turnPlayerId: BOT_ID,
        turnSeq: TURN_SEQ,
      }),
      true,
    )
    const gate = shouldAllowBotReloadRecovery({
      matchId: MATCH_ID,
      turnPlayerId: BOT_ID,
      turnSeq: TURN_SEQ,
      pending: original,
      locallyStartedTurnKey: '',
    })
    assert.equal(gate.ok, false)
    assert.equal(gate.reason, 'normal-pending-owns-turn')
    assert.equal(original.shouldIncrementRound, true)
    assert.equal(original.nextRound, 2)
    assert.notEqual(original.recovered, true)
  })

  it('C — pending já consumido, remoto ainda no mesmo seq: marcador local impede recovery tardio', () => {
    const localKey = buildLocallyStartedBotTurnKey({
      matchId: MATCH_ID,
      turnPlayerId: BOT_ID,
      turnSeq: TURN_SEQ,
    })
    const gate = shouldAllowBotReloadRecovery({
      matchId: MATCH_ID,
      turnPlayerId: BOT_ID,
      turnSeq: TURN_SEQ,
      pending: null,
      locallyStartedTurnKey: localKey,
    })
    assert.equal(gate.ok, false)
    assert.equal(gate.reason, 'locally-started-turn')
  })
})

describe('isolamento — COM F5 a nova montagem pode recuperar', () => {
  it('D — sem pending/marcador local: recovery C exatamente uma vez', async () => {
    const actionId = moveActionId(TAB_X)
    const players = persistCrossingOnBot([human, bot], false)
    const gate = shouldAllowBotReloadRecovery({
      matchId: MATCH_ID,
      turnPlayerId: BOT_ID,
      turnSeq: TURN_SEQ,
      pending: null,
      locallyStartedTurnKey: '',
    })
    assert.equal(gate.ok, true)
    assert.equal(gate.reason, 'inherited-incomplete-turn')

    const h = createHarness({
      lastRollTurnKey: String(TURN_SEQ),
      lastRoll: { playerId: BOT_ID, steps: 4, turnKey: String(TURN_SEQ) },
      lastActions: { [actionId]: 1 },
      players,
    })
    const first = await h.run()
    const second = await h.run()
    assert.equal(first.recovered, 'handoff')
    assert.equal(h.handoffs.length, 1)
    assert.equal(h.rolls.length, 0)
    assert.ok(['turn-advanced', 'turn-seq-changed', 'turn-player-changed'].includes(second.reason))
  })

  it('E — F5 no fechamento de round 1→2 continua correto', () => {
    const pending = rebuildBotPendingAfterConfirmedMove({
      players: persistCrossingOnBot(
        [
          { ...human, lastRevenueRound: 1 },
          { ...bot, lastRevenueRound: 1 },
        ],
        true,
      ),
      turnPlayerId: BOT_ID,
      turnSeq: TURN_SEQ,
      turnIdx: 1,
      round: 1,
      maxRounds: 2,
      crossedStart: true,
    })
    assert.equal(pending.shouldIncrementRound, true)
    assert.equal(pending.nextRound, 2)
    assert.equal(pending.endGame, false)
    assert.equal(
      shouldAllowBotReloadRecovery({
        matchId: MATCH_ID,
        turnPlayerId: BOT_ID,
        turnSeq: TURN_SEQ,
        pending,
        locallyStartedTurnKey: '',
      }).ok,
      true,
    )
  })

  it('F — F5 no ENDGAME continua winner pelo caminho existente', () => {
    const pending = rebuildBotPendingAfterConfirmedMove({
      players: persistCrossingOnBot(
        [
          { ...human, lastRevenueRound: 5, cash: 8000 },
          { ...bot, lastRevenueRound: 5, cash: 30000 },
        ],
        true,
      ),
      turnPlayerId: BOT_ID,
      turnSeq: TURN_SEQ,
      turnIdx: 1,
      round: 5,
      maxRounds: 5,
      crossedStart: true,
    })
    assert.equal(pending.endGame, true)
    assert.equal(decideTickFromPending(pending, 5).kind, 'ENDGAME')
    assert.equal(decideTickFromPending(pending, 5).winner?.id, BOT_ID)
    assert.equal(
      shouldAllowBotReloadRecovery({
        matchId: MATCH_ID,
        turnPlayerId: BOT_ID,
        turnSeq: TURN_SEQ,
        pending,
        locallyStartedTurnKey: '',
      }).ok,
      true,
    )
  })

  it('G — duas abas vivas: lease continua impedindo concorrência', () => {
    const cycle = shouldContinueBotTurnCycle({
      getLive: () => ({
        enabled: true,
        botsEnabled: true,
        gameOver: false,
        matchId: MATCH_ID,
        turnPlayerId: BOT_ID,
        turnSeq: TURN_SEQ,
        lastRollTurnKey: null,
        botClaimExecutor: TAB_X,
        lockTs: Date.now(),
      }),
      expectedMatchId: MATCH_ID,
      expectedTurnPlayerId: BOT_ID,
      expectedTurnSeq: TURN_SEQ,
      localExecutorId: TAB_Y,
    })
    assert.equal(cycle.ok, false)
    assert.equal(cycle.waiting, true)
    assert.equal(cycle.reason, 'other-executor')
  })
})
