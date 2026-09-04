/**
 * Barreira BOT_MOVE: PLAYER_DELTA confirmado antes de NORMAL_HANDOFF.
 * Executa helpers reais — não prova por regex de source.
 */
import { describe, it, beforeEach } from 'node:test'
import assert from 'node:assert/strict'
import {
  BOT_MOVE_CONFIRMED,
  BOT_MOVE_FAILED,
  BOT_MOVE_PENDING,
  buildBotMoveActionId,
  canTickReleaseBotHandoff,
  classifyBotMoveCommitResult,
  createBotMoveBarrier,
  getLiveBotMoveBarrier,
  resolveBotTickHandoffGate,
  setLiveBotMoveBarrier,
  shouldAllowBotNormalHandoff,
  shouldApplyRemotePlayersDuringBotMove,
  shouldEmitLockAcquireAfterBotClaim,
  shouldPauseBotHeartbeat,
} from '../bots/botMoveBarrier.js'
import {
  __resetBotForegroundCommitForTests,
  createBotCommitSerializer,
  getBotForegroundCommitDepth,
  getSharedBotCommitSerializer,
  isBotForegroundCommitActive,
} from '../bots/botForegroundCommit.js'
import { persistBotMove } from '../bots/botMovePersist.js'
import { validateTurnCommit } from '../turnCommitValidation.js'
import { applyGamePatchToState } from '../playerStateSync.js'
import {
  assembleMatchRoster,
  normalizeBotConfig,
} from '../bots/botRoster.js'
import { isBotPlayer } from '../bots/botTypes.js'
import {
  shouldDisableTimerAutoPassForTurn,
  validateTurnCommit as validateCommit,
} from '../turnCommitValidation.js'
import { mergeLobbyMatchSettings } from '../turnTimerLogic.js'

const MATCH_ID = 'match-move-1'
const HUMAN_ID = 'human-host'
const BOT_ID = 'bot:match-move-1:0'
const EXEC = 'tab-A'
const TURN_SEQ = 4

const human = { id: HUMAN_ID, name: 'Host', isBot: false, pos: 0, cash: 25000 }
const bot = {
  id: BOT_ID,
  name: 'Máquina 1',
  isBot: true,
  controller: 'BOT',
  pos: 3,
  cash: 25000,
}

function barrier(extra = {}) {
  return createBotMoveBarrier({
    actionId: buildBotMoveActionId({
      matchId: MATCH_ID,
      turnPlayerId: BOT_ID,
      turnSeq: TURN_SEQ,
      executorId: EXEC,
    }),
    steps: 4,
    fromPos: 3,
    toPos: 7,
    playerId: BOT_ID,
    turnSeq: TURN_SEQ,
    matchId: MATCH_ID,
    executorId: EXEC,
    delta: { [BOT_ID]: { pos: 7, _actionId: 'bot-move:x' } },
    lastRollTurnKey: String(TURN_SEQ),
    ...extra,
  })
}

beforeEach(() => {
  __resetBotForegroundCommitForTests()
  setLiveBotMoveBarrier(null)
})

describe('A — PLAYER_DELTA {ok:false} → zero NORMAL_HANDOFF', () => {
  it('barreira FAILED não libera handoff', () => {
    const b = { ...barrier(), status: BOT_MOVE_FAILED, reason: 'cas-lost' }
    assert.equal(shouldAllowBotNormalHandoff(b), false)
    assert.equal(
      canTickReleaseBotHandoff({ isBotTurn: true, barrier: b, inflightCommits: 0 }),
      false,
    )
    assert.equal(
      resolveBotTickHandoffGate({ isBotTurn: true, barrier: b, inflightCommits: 0 }).action,
      'abort',
    )
  })
})

describe('B/2 — PLAYER_DELTA pendente bloqueia handoff', () => {
  it('PENDING não permite NORMAL_HANDOFF', () => {
    const b = barrier()
    assert.equal(b.status, BOT_MOVE_PENDING)
    assert.equal(shouldAllowBotNormalHandoff(b), false)
    assert.equal(
      canTickReleaseBotHandoff({ isBotTurn: true, barrier: b, inflightCommits: 0 }),
      false,
    )
    assert.equal(
      resolveBotTickHandoffGate({ isBotTurn: true, barrier: b, inflightCommits: 0 }).action,
      'wait',
    )
  })
})

describe('C/3/4/5/6/7 — CAS duas vezes + sucesso persiste uma vez', () => {
  it('mesmo actionId, mesmo dado, movimento local=1, depois CONFIRMED', async () => {
    const b = barrier()
    const actionIds = []
    const stepsSeen = []
    let n = 0
    const result = await persistBotMove({
      barrier: b,
      delayMs: 0,
      maxBackoffMs: 0,
      sleep: () => Promise.resolve(),
      commit: async ({ actionId }) => {
        n += 1
        actionIds.push(actionId)
        stepsSeen.push(b.steps)
        if (n <= 2) return { ok: false, casLost: true, reason: 'cas-lost' }
        return { ok: true }
      },
    })
    assert.equal(result.ok, true)
    assert.equal(result.attempts, 3)
    assert.equal(result.localApplied, 1)
    assert.equal(result.steps, 4)
    assert.equal(new Set(actionIds).size, 1)
    assert.equal(actionIds[0], b.actionId)
    assert.equal(new Set(stepsSeen).size, 1)
    assert.equal(result.barrier.status, BOT_MOVE_CONFIRMED)
    assert.equal(
      canTickReleaseBotHandoff({ isBotTurn: true, barrier: result.barrier, inflightCommits: 0 }),
      true,
    )
  })
})

describe('D/10 — snapshot remoto antigo não reverte nem libera handoff', () => {
  it('PENDING/CONFIRMED recusam pos antiga e o tick não handoffa sem confirmação', () => {
    const pending = barrier()
    assert.equal(
      shouldApplyRemotePlayersDuringBotMove({
        barrier: pending,
        incomingPlayer: { id: BOT_ID, pos: 3 },
        localPlayer: { id: BOT_ID, pos: 7 },
      }),
      false,
    )
    const confirmed = { ...pending, status: BOT_MOVE_CONFIRMED }
    assert.equal(
      shouldApplyRemotePlayersDuringBotMove({
        barrier: confirmed,
        incomingPlayer: { id: BOT_ID, pos: 3 },
        localPlayer: { id: BOT_ID, pos: 7 },
      }),
      false,
    )
    assert.equal(
      canTickReleaseBotHandoff({ isBotTurn: true, barrier: pending, inflightCommits: 0 }),
      false,
    )
  })
})

describe('E/8 — heartbeat não concorre com BOT_MOVE', () => {
  it('serializer nunca dispara dois commits ao mesmo tempo; heartbeat pausa', async () => {
    const ser = createBotCommitSerializer()
    let active = 0
    let max = 0
    const work = (ms) =>
      ser.wrap(async () => {
        active += 1
        max = Math.max(max, active)
        await new Promise((r) => setTimeout(r, ms))
        active -= 1
        return true
      })
    const p1 = work(15)
    const p2 = work(5)
    assert.equal(shouldPauseBotHeartbeat({ foregroundDepth: 1 }), true)
    assert.equal(
      shouldPauseBotHeartbeat({ barrier: barrier(), foregroundDepth: 0 }),
      false,
    )
    await Promise.all([p1, p2])
    assert.equal(max, 1)
    assert.equal(ser.maxConcurrent, 1)
    assert.equal(isBotForegroundCommitActive(), false)
  })

  it('heartbeat enfileirado espera o BOT_MOVE no serializer compartilhado', async () => {
    const ser = getSharedBotCommitSerializer()
    const order = []
    let active = 0
    let max = 0
    const track = async (label, ms) => {
      active += 1
      max = Math.max(max, active)
      order.push(`start:${label}`)
      await new Promise((r) => setTimeout(r, ms))
      order.push(`end:${label}`)
      active -= 1
      return { ok: true, label }
    }
    const move = ser.enqueue(() => track('move', 20))
    const hb = ser.enqueue(() => track('heartbeat', 5))
    await Promise.all([move, hb])
    assert.equal(max, 1)
    assert.deepEqual(order, ['start:move', 'end:move', 'start:heartbeat', 'end:heartbeat'])
  })
})

describe('F/9 — sem LOCK_ACQUIRE redundante após BOT_CLAIM', () => {
  it('claim válido no turno bot não emite LOCK_ACQUIRE', () => {
    assert.equal(
      shouldEmitLockAcquireAfterBotClaim({ isBotTurn: true, claimHoldsLock: true }),
      false,
    )
    assert.equal(
      shouldEmitLockAcquireAfterBotClaim({ isBotTurn: true, claimHoldsLock: false }),
      true,
    )
  })
})

describe('G/1 — commit confirmado → então NORMAL_HANDOFF', () => {
  it('CONFIRMED e fila idle liberam o tick', () => {
    const b = { ...barrier(), status: BOT_MOVE_CONFIRMED }
    assert.equal(shouldAllowBotNormalHandoff(b), true)
    assert.equal(
      canTickReleaseBotHandoff({ isBotTurn: true, barrier: b, inflightCommits: 0 }),
      true,
    )
    assert.equal(
      canTickReleaseBotHandoff({ isBotTurn: true, barrier: b, inflightCommits: 1 }),
      false,
    )
    assert.equal(
      resolveBotTickHandoffGate({ isBotTurn: true, barrier: b, inflightCommits: 0 }).action,
      'allow',
    )
  })
})

describe('H/16 — caminho humano original', () => {
  it('sem barreira o humano handoffa e emite lock; ROLL humano não usa BOT_MOVE', () => {
    assert.equal(shouldAllowBotNormalHandoff(null), true)
    assert.equal(
      canTickReleaseBotHandoff({ isBotTurn: false, barrier: null, inflightCommits: 2 }),
      true,
    )
    assert.equal(
      resolveBotTickHandoffGate({
        isBotTurn: false,
        barrier: { ...barrier(), status: BOT_MOVE_FAILED },
        inflightCommits: 9,
      }).action,
      'allow',
    )
    assert.equal(
      shouldEmitLockAcquireAfterBotClaim({ isBotTurn: false, claimHoldsLock: true }),
      true,
    )
    assert.equal(
      shouldApplyRemotePlayersDuringBotMove({
        barrier: null,
        incomingPlayer: { id: HUMAN_ID, pos: 0 },
        localPlayer: { id: HUMAN_ID, pos: 4 },
      }),
      true,
    )
    const humanPatch = { kind: 'PLAYER_DELTA', lastRollTurnKey: '4' }
    const v = validateTurnCommit(
      { turnPlayerId: HUMAN_ID, turnSeq: 4, players: [human], gameOver: false },
      humanPatch,
    )
    assert.equal(v.ok, true)
    assert.equal(v.reason, 'no-guard')
  })
})

describe('BOT_MOVE CAS — expectativas', () => {
  it('commit da posição exige turno da máquina e origens', () => {
    const prev = {
      matchId: MATCH_ID,
      turnPlayerId: BOT_ID,
      turnSeq: TURN_SEQ,
      gameOver: false,
      turnLock: true,
      lockOwner: HUMAN_ID,
      players: [human, bot],
    }
    const ok = validateTurnCommit(prev, {
      kind: 'PLAYER_DELTA',
      _commitKind: 'BOT_MOVE',
      lastRollTurnKey: String(TURN_SEQ),
      _expectMatchId: MATCH_ID,
      _expectTurnPlayerId: BOT_ID,
      _expectTurnSeq: TURN_SEQ,
      _expectLockOwner: HUMAN_ID,
    })
    assert.equal(ok.ok, true)

    const stale = validateTurnCommit(
      { ...prev, turnSeq: TURN_SEQ + 1 },
      {
        _commitKind: 'BOT_MOVE',
        _expectTurnPlayerId: BOT_ID,
        _expectTurnSeq: TURN_SEQ,
      },
    )
    assert.equal(stale.ok, false)
  })

  it('applyGamePatchToState aplica pos + lastRollTurnKey no mesmo patch', () => {
    const actionId = buildBotMoveActionId({
      matchId: MATCH_ID,
      turnPlayerId: BOT_ID,
      turnSeq: TURN_SEQ,
      executorId: EXEC,
    })
    const prev = {
      matchId: MATCH_ID,
      turnPlayerId: BOT_ID,
      turnSeq: TURN_SEQ,
      gameOver: false,
      lockOwner: HUMAN_ID,
      players: [human, { ...bot, pos: 3 }],
    }
    const applied = applyGamePatchToState(prev, {
      playersDeltaById: { [BOT_ID]: { pos: 7, _actionId: actionId } },
      statePatch: {
        _commitKind: 'BOT_MOVE',
        lastRollTurnKey: String(TURN_SEQ),
        _expectTurnPlayerId: BOT_ID,
        _expectTurnSeq: TURN_SEQ,
        _expectLockOwner: HUMAN_ID,
        _expectMatchId: MATCH_ID,
      },
    })
    assert.equal(applied.ok, true)
    const moved = applied.state.players.find((p) => p.id === BOT_ID)
    assert.equal(moved.pos, 7)
    assert.equal(applied.state.lastRollTurnKey, String(TURN_SEQ))
  })
})

describe('11/12 — executor/turnSeq cancelam persistência', () => {
  it('turnSeq alterado é terminal e não confirma', async () => {
    let liveSeq = TURN_SEQ
    const result = await persistBotMove({
      barrier: barrier(),
      delayMs: 0,
      sleep: () => Promise.resolve(),
      shouldContinue: () =>
        liveSeq === TURN_SEQ ? { ok: true } : { ok: false, reason: 'turn-seq-changed' },
      commit: async () => {
        liveSeq = TURN_SEQ + 1
        return { ok: false, casLost: true }
      },
    })
    assert.equal(result.ok, false)
    assert.equal(result.terminal, true)
    assert.equal(shouldAllowBotNormalHandoff(result.barrier), false)
  })

  it('executor diferente no shouldContinue cancela', async () => {
    const result = await persistBotMove({
      barrier: barrier(),
      delayMs: 0,
      sleep: () => Promise.resolve(),
      shouldContinue: () => ({ ok: false, reason: 'executor-mismatch' }),
      commit: async () => ({ ok: true }),
    })
    assert.equal(result.ok, false)
    assert.equal(result.reason, 'executor-mismatch')
    assert.equal(result.barrier.status, BOT_MOVE_FAILED)
  })
})

describe('13 — inflight de modal/evento bloqueia handoff', () => {
  it('CONFIRMED com commits abertos não libera tick', () => {
    const b = { ...barrier(), status: BOT_MOVE_CONFIRMED }
    assert.equal(
      canTickReleaseBotHandoff({ isBotTurn: true, barrier: b, inflightCommits: 2 }),
      false,
    )
  })
})

describe('14/15 — botCount=0 e AUTO_PASS humano', () => {
  it('flag/botCount=0 não anexa máquinas', () => {
    const roster = assembleMatchRoster({
      humans: [human],
      matchId: MATCH_ID,
      botCount: 0,
      botsEnabled: true,
    })
    assert.equal(roster.some(isBotPlayer), false)
    const merged = mergeLobbyMatchSettings(
      { players: [human], kind: 'TURN', maxRounds: 5, turnTimeSec: 90 },
      { maxRounds: 5, turnTimeSec: 90 },
    )
    assert.equal(Object.prototype.hasOwnProperty.call(merged, 'botConfig'), false)
    assert.equal(normalizeBotConfig({ count: 0 }).count, 0)
  })

  it('AUTO_PASS humano permanece', () => {
    const roster = [human, { id: 'h2', name: 'P2', isBot: false }]
    assert.equal(shouldDisableTimerAutoPassForTurn(roster, HUMAN_ID), false)
    const v = validateCommit(
      {
        turnPlayerId: HUMAN_ID,
        turnSeq: 3,
        turnDeadlineAt: Date.now() - 1000,
        players: roster,
        gameOver: false,
        turnLock: false,
      },
      {
        kind: 'TURN',
        turnPlayerId: 'h2',
        turnSeq: 4,
        lastAction: 'AUTO_PASS_TIMER',
        _expectTurnPlayerId: HUMAN_ID,
        _expectTurnSeq: 3,
        _commitKind: 'AUTO_PASS',
      },
      { now: Date.now() },
    )
    assert.equal(v.ok, true)
    assert.equal(v.reason, 'auto-pass-ok')
  })
})

describe('classificação de commit e live barrier', () => {
  it('406/casLost é retry; game-over é terminal', () => {
    assert.equal(classifyBotMoveCommitResult({ ok: false, casLost: true }).retry, true)
    assert.equal(classifyBotMoveCommitResult({ ok: false, reason: 'game-over' }).terminal, true)
    assert.equal(classifyBotMoveCommitResult({ ok: true }).ok, true)
  })

  it('persist atualiza a barreira live', async () => {
    const result = await persistBotMove({
      barrier: barrier(),
      delayMs: 0,
      sleep: () => Promise.resolve(),
      commit: async () => ({ ok: true }),
    })
    assert.equal(getLiveBotMoveBarrier()?.status, BOT_MOVE_CONFIRMED)
    assert.equal(result.ok, true)
    assert.equal(getBotForegroundCommitDepth(), 0)
  })
})
