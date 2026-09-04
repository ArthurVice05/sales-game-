/**
 * Pipeline de ROLL da máquina: gate, retry persistente, handoff real e heartbeat.
 * Executa as funções reais — não prova por regex de source.
 */
import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import {
  ADVANCE_PENDING,
  interpretAdvanceStartResult,
  resolveAdvanceWhenModalsBusy,
  shouldMarkLastRollTurnKeyNow,
  toBotOnActionRollResult,
} from '../bots/botRollGate.js'
import {
  BOT_ROLL_RETRY_MAX,
  classifyHeartbeatTick,
  runBotRollPersistentRetry,
  runBotRollRetryLoop,
  sleepCancellable,
  waitForBotPipelineHandoff,
} from '../bots/botRollRetry.js'
import { runBotTurnPipeline } from '../bots/botTurnPipeline.js'
import {
  buildBotModalTypeIndex,
  inferBotDecisionKindFromElement,
} from '../bots/botDecisionKind.js'
import { isValidClaimProof } from '../bots/botClaimProof.js'
import {
  shouldDisableTimerAutoPassForTurn,
  validateTurnCommit,
} from '../turnCommitValidation.js'
import { assembleMatchRoster, normalizeBotConfig } from '../bots/botRoster.js'
import { isBotPlayer } from '../bots/botTypes.js'
import { mergeLobbyMatchSettings } from '../turnTimerLogic.js'

const MATCH_ID = 'match-roll-1'
const HUMAN_ID = 'human-host'
const BOT_ID = 'bot:match-roll-1:0'
const TAB_A = 'tab-A'
const TAB_B = 'tab-B'
const TURN_SEQ = 4

const human = { id: HUMAN_ID, name: 'Host', isBot: false }
const bot = {
  id: BOT_ID,
  name: 'Máquina 1',
  isBot: true,
  controller: 'BOT',
}

function autoPassPatch(expectId, expectSeq) {
  return {
    kind: 'TURN',
    turnPlayerId: HUMAN_ID,
    turnSeq: expectSeq + 1,
    lastAction: 'AUTO_PASS_TIMER',
    _expectTurnPlayerId: expectId,
    _expectTurnSeq: expectSeq,
    _commitKind: 'AUTO_PASS',
  }
}

function instantSleep() {
  return Promise.resolve()
}

function createHarness({
  commitResult = { ok: true },
  remoteExecutor = null,
  lastRollTurnKey = null,
  turnSeq = TURN_SEQ,
  presenceList = [{ playerId: HUMAN_ID, lastSeen: Date.now() }],
  hasAttemptedFetch = true,
  lastFetchError = null,
  authoritativeNetEnabled = true,
  remoteTurnPlayerId = BOT_ID,
  remoteTurnSeq = TURN_SEQ,
  remoteMatchId = MATCH_ID,
  executorId = TAB_A,
  onBotRoll = null,
  startHeartbeat = undefined,
  stopHeartbeat = undefined,
  ...extraPipeline
} = {}) {
  const live = {
    enabled: true,
    botsEnabled: true,
    authoritativeNetEnabled,
    matchId: MATCH_ID,
    turnPlayerId: BOT_ID,
    turnSeq,
    gameOver: false,
    turnLock: false,
    lockOwner: null,
    lockTs: null,
    lastRollTurnKey,
    currentPlayer: bot,
    remoteMatchId,
    remoteTurnPlayerId,
    remoteTurnSeq,
    remoteGameOver: false,
    botTurnKey: null,
    botTurnSeed: null,
    botClaimExecutor: remoteExecutor,
  }
  const rolls = []
  const claims = []
  const claimProofRef = { current: null }
  const ranKeysRef = { current: [] }
  const liveRef = { current: live }
  const abort = new AbortController()

  const args = {
    signal: abort.signal,
    liveRef,
    claimProofRef,
    ranKeysRef,
    executorId,
    matchId: MATCH_ID,
    turnPlayerId: BOT_ID,
    turnSeq,
    botPlayer: bot,
    myUidRef: { current: HUMAN_ID },
    lobbyHostIdRef: { current: HUMAN_ID },
    playersRef: { current: [human, bot] },
    presenceListRef: { current: presenceList },
    presenceFetchMetaRef: {
      current: { hasAttemptedFetch, lastFetchError },
    },
    commitClaimRef: {
      current: async (payload) => {
        claims.push(payload)
        return typeof commitResult === 'function' ? commitResult(payload, live) : commitResult
      },
    },
    onBotRollRef: {
      current: async (payload) => {
        rolls.push(payload)
        if (typeof onBotRoll === 'function') return onBotRoll(payload, live, rolls)
        live.lastRollTurnKey = String(turnSeq)
        live.turnPlayerId = HUMAN_ID
        live.remoteTurnPlayerId = HUMAN_ID
        live.turnSeq = turnSeq + 1
        live.remoteTurnSeq = turnSeq + 1
        return { ok: true }
      },
    },
    roundRef: { current: 1 },
    maxRoundsRef: { current: 5 },
    coordinatorIdRef: { current: null },
    thinkDelayMs: 0,
    waitDelayMs: 0,
    claimDelayMs: 0,
    handoffPollMs: 0,
    handoffMaxWaitMs: 1000,
    rollDelayMs: 0,
    rollMaxBackoffMs: 0,
    startHeartbeat,
    stopHeartbeat,
    ...extraPipeline,
  }

  return {
    live,
    liveRef,
    rolls,
    claims,
    claimProofRef,
    ranKeysRef,
    abort,
    run: () => runBotTurnPipeline(args),
    args,
  }
}

describe('A — advanceAndMaybeLap PENDING não é ok:true', () => {
  it('quando o retry interno é da máquina, o resultado é PENDING e o bot não recebe ok:true', () => {
    const started = resolveAdvanceWhenModalsBusy(false)
    assert.equal(started, ADVANCE_PENDING)
    const mapped = interpretAdvanceStartResult(started)
    assert.equal(mapped.ok, false)
    assert.equal(mapped.reason, 'roll-pending-modals')
    assert.equal(mapped.retry, true)
    assert.equal(toBotOnActionRollResult(started).ok, false)
  })

  it('humano continua agendando retry interno e devolve true (assinatura antiga)', () => {
    assert.equal(resolveAdvanceWhenModalsBusy(true), true)
    assert.equal(resolveAdvanceWhenModalsBusy(), true)
  })
})

describe('B — lastRollTurnKey só depois de STARTED', () => {
  it('máquina não marca a chave antes do movimento nem em PENDING/REJECTED', () => {
    assert.equal(
      shouldMarkLastRollTurnKeyNow({ isBotRoll: true, phase: 'before-advance' }),
      false,
    )
    assert.equal(
      shouldMarkLastRollTurnKeyNow({
        isBotRoll: true,
        phase: 'after-advance',
        advanceResult: ADVANCE_PENDING,
      }),
      false,
    )
    assert.equal(
      shouldMarkLastRollTurnKeyNow({
        isBotRoll: true,
        phase: 'after-advance',
        advanceResult: false,
      }),
      false,
    )
  })

  it('máquina marca somente após STARTED; humano preserva proteção de duplo clique', () => {
    assert.equal(
      shouldMarkLastRollTurnKeyNow({
        isBotRoll: true,
        phase: 'after-advance',
        advanceResult: true,
      }),
      true,
    )
    assert.equal(
      shouldMarkLastRollTurnKeyNow({ isBotRoll: false, phase: 'before-advance' }),
      true,
    )
    assert.equal(
      shouldMarkLastRollTurnKeyNow({ isBotRoll: false, phase: 'after-advance', advanceResult: true }),
      false,
    )
  })
})

describe('C/3 — 25 falhas transitórias + sucesso posterior → uma rolagem', () => {
  it('retry persistente: 25 pendências e a 26ª inicia exatamente um movimento', async () => {
    let n = 0
    const r = await runBotRollPersistentRetry({
      turnKey: 'k',
      onBotRoll: async () => {
        n += 1
        if (n <= 25) return { ok: false, reason: 'roll-pending-modals' }
        return { ok: true }
      },
      delayMs: 0,
      maxBackoffMs: 0,
      sleep: instantSleep,
      innerMaxAttempts: BOT_ROLL_RETRY_MAX,
    })
    assert.equal(r.ok, true)
    assert.equal(r.rollCalls, 26)
    assert.equal(r.movementStarted, 1)
  })

  it('o loop interno isolado de 25 não pode ser o abandono definitivo do turno', async () => {
    let n = 0
    const inner = await runBotRollRetryLoop({
      turnKey: 'k',
      onBotRoll: async () => {
        n += 1
        if (n <= 25) return { ok: false, reason: 'roll-pending-modals' }
        return { ok: true }
      },
      maxAttempts: BOT_ROLL_RETRY_MAX,
      delayMs: 0,
      sleep: instantSleep,
    })
    assert.equal(inner.ok, false)
    assert.equal(inner.reason, 'retry-exhausted')
    assert.notEqual(inner.terminal, true)
  })
})

describe('D/8 — lastRollTurnKey não declara handoff', () => {
  it('lastRoll marcado com o mesmo turnPlayerId/turnSeq continua aguardando', async () => {
    let polls = 0
    const live = {
      lastRollTurnKey: String(TURN_SEQ),
      turnPlayerId: BOT_ID,
      turnSeq: TURN_SEQ,
      gameOver: false,
    }
    const pending = waitForBotPipelineHandoff({
      getLive: () => {
        polls += 1
        return live
      },
      expectedTurnPlayerId: BOT_ID,
      expectedTurnSeq: TURN_SEQ,
      pollMs: 1,
      maxWaitMs: 200,
      sleep: (ms, signal) => sleepCancellable(ms, signal),
    })
    await new Promise((r) => setTimeout(r, 20))
    assert.ok(polls >= 2, `handoff não pode encerrar no first poll (polls=${polls})`)
    live.turnPlayerId = HUMAN_ID
    live.turnSeq = TURN_SEQ + 1
    const result = await pending
    assert.equal(result.ok, true)
    assert.equal(result.reason, 'handoff')
    assert.notEqual(result.reason, 'rolled')
  })
})

describe('E/7 — heartbeat CAS transitório não cancela', () => {
  it('uma ou duas falhas 406/CAS se recuperam', () => {
    const live = {
      gameOver: false,
      turnPlayerId: BOT_ID,
      turnSeq: TURN_SEQ,
      botClaimExecutor: TAB_A,
    }
    const base = {
      live,
      expectedTurnPlayerId: BOT_ID,
      expectedTurnSeq: TURN_SEQ,
      localExecutorId: TAB_A,
      claimProof: { executorId: TAB_A, ok: true },
    }
    const first = classifyHeartbeatTick({ ...base, result: { ok: false, casLost: true } })
    const second = classifyHeartbeatTick({ ...base, result: { ok: false, status: 406 } })
    const recovered = classifyHeartbeatTick({ ...base, result: { ok: true } })
    assert.equal(first.kind, 'transient')
    assert.equal(first.action, 'retry')
    assert.equal(second.kind, 'transient')
    assert.equal(recovered.action, 'ok')
  })

  it('undefined e erro de rede são transitórios se o turno continua da máquina', () => {
    const live = {
      gameOver: false,
      turnPlayerId: BOT_ID,
      turnSeq: TURN_SEQ,
      botClaimExecutor: null,
    }
    const undefinedTick = classifyHeartbeatTick({
      live,
      result: undefined,
      expectedTurnPlayerId: BOT_ID,
      expectedTurnSeq: TURN_SEQ,
      localExecutorId: TAB_A,
    })
    const netTick = classifyHeartbeatTick({
      live,
      error: new Error('network'),
      expectedTurnPlayerId: BOT_ID,
      expectedTurnSeq: TURN_SEQ,
      localExecutorId: TAB_A,
    })
    assert.equal(undefinedTick.kind, 'transient')
    assert.equal(netTick.kind, 'transient')
  })
})

describe('F/6 — executor remoto diferente cancela imediatamente', () => {
  it('heartbeat com executor remoto ≠ local é terminal', () => {
    const tick = classifyHeartbeatTick({
      live: {
        gameOver: false,
        turnPlayerId: BOT_ID,
        turnSeq: TURN_SEQ,
        botClaimExecutor: TAB_B,
      },
      result: { ok: true },
      expectedTurnPlayerId: BOT_ID,
      expectedTurnSeq: TURN_SEQ,
      localExecutorId: TAB_A,
    })
    assert.equal(tick.kind, 'terminal')
    assert.equal(tick.action, 'abort')
    assert.equal(tick.reason, 'other-executor')
  })

  it('pipeline cancela no retry se o executor remoto mudar', async () => {
    const h = createHarness({
      commitResult: { ok: true },
      remoteExecutor: null,
      onBotRoll: async (_payload, live) => {
        live.botClaimExecutor = TAB_B
        return { ok: false, reason: 'roll-pending-modals' }
      },
    })
    const result = await h.run()
    assert.equal(result.ok, false)
    assert.equal(h.rolls.length, 1)
    assert.ok(['other-executor', 'executor-mismatch', 'remote-contradicts-proof', 'stale-turn'].includes(result.reason))
  })
})

describe('G/10 — classificação de modal sem Function.name', () => {
  it('componente minificado não cai em PURCHASE e a referência classifica InsufficientFunds', () => {
    function n() {
      return null
    }
    Object.defineProperty(n, 'name', { value: 'n' })
    n.displayName = 'n'
    const minified = inferBotDecisionKindFromElement({ type: n, props: {} })
    assert.equal(minified, 'UNKNOWN')
    assert.notEqual(minified, 'PURCHASE')
    assert.notEqual(minified, 'INSUFFICIENT_FUNDS')

    const InsufficientFundsModal = n
    const index = buildBotModalTypeIndex({ InsufficientFundsModal })
    assert.equal(
      inferBotDecisionKindFromElement({ type: InsufficientFundsModal, props: {} }, index),
      'INSUFFICIENT_FUNDS',
    )
  })
})

describe('1 — modal ocupada → PENDING → libera → um movimento', () => {
  it('pipeline: pendências depois um único ROLL e handoff', async () => {
    let n = 0
    const h = createHarness({
      commitResult: { ok: true },
      onBotRoll: async (payload, live) => {
        n += 1
        if (n < 3) return { ok: false, reason: 'roll-pending-modals' }
        live.lastRollTurnKey = String(TURN_SEQ)
        live.turnPlayerId = HUMAN_ID
        live.remoteTurnPlayerId = HUMAN_ID
        live.turnSeq = TURN_SEQ + 1
        live.remoteTurnSeq = TURN_SEQ + 1
        return { ok: true }
      },
    })
    const result = await h.run()
    assert.equal(result.ok, true)
    assert.equal(h.rolls.length, 3)
    assert.equal(n, 3)
  })
})

describe('2 — PENDING não grava lastRollTurnKey', () => {
  it('toBotOnActionRollResult(PENDING) é falha retryable e não implica STARTED', () => {
    const mapped = toBotOnActionRollResult(ADVANCE_PENDING)
    assert.equal(mapped.ok, false)
    assert.equal(
      shouldMarkLastRollTurnKeyNow({
        isBotRoll: true,
        phase: 'after-advance',
        advanceResult: ADVANCE_PENDING,
      }),
      false,
    )
  })
})

describe('4 — retry mantém exatamente o mesmo dado e seed', () => {
  it('todas as tentativas do pipeline usam o mesmo steps do payload', async () => {
    const seen = []
    const h = createHarness({
      commitResult: { ok: true },
      onBotRoll: async (payload, live) => {
        seen.push(payload.steps)
        if (seen.length < 4) return { ok: false, reason: 'roll-pending-modals' }
        live.lastRollTurnKey = String(TURN_SEQ)
        live.turnPlayerId = HUMAN_ID
        live.remoteTurnPlayerId = HUMAN_ID
        live.turnSeq = TURN_SEQ + 1
        live.remoteTurnSeq = TURN_SEQ + 1
        return { ok: true }
      },
    })
    await h.run()
    assert.equal(seen.length, 4)
    assert.equal(new Set(seen).size, 1)
    assert.ok(seen[0] >= 1 && seen[0] <= 6)
    assert.equal(isValidClaimProof(h.rolls[0].botClaim.claimProof), true)
  })
})

describe('5 — mudança de turnSeq durante retry cancela', () => {
  it('após falha transitória, turnSeq novo encerra sem movimento', async () => {
    let n = 0
    const h = createHarness({
      commitResult: { ok: true },
      onBotRoll: async (_payload, live) => {
        n += 1
        if (n === 1) {
          live.turnSeq = TURN_SEQ + 1
          live.remoteTurnSeq = TURN_SEQ + 1
        }
        return { ok: false, reason: 'roll-pending-modals' }
      },
    })
    const result = await h.run()
    assert.equal(result.ok, false)
    assert.equal(h.rolls.length, 1)
    assert.ok(['stale-turn', 'turn-seq-changed', 'turn-seq'].includes(result.reason))
  })
})

describe('9 — handoff real encerra heartbeat', () => {
  it('startHeartbeat liga e stopHeartbeat dispara após mudança de turno', async () => {
    let beating = false
    let stopped = 0
    const h = createHarness({
      commitResult: { ok: true },
      startHeartbeat: () => {
        beating = true
      },
      stopHeartbeat: () => {
        beating = false
        stopped += 1
      },
    })
    const result = await h.run()
    assert.equal(result.ok, true)
    assert.equal(beating, false)
    assert.ok(stopped >= 1)
  })
})

describe('11/12 — botCount=0 e flag desligada', () => {
  it('botCount=0 não anexa máquinas', () => {
    const roster = assembleMatchRoster({
      humans: [human],
      matchId: MATCH_ID,
      botCount: 0,
      botsEnabled: true,
    })
    assert.equal(roster.length, 1)
    assert.equal(roster.some(isBotPlayer), false)
  })

  it('flag desligada não cria botConfig nem altera o roster', () => {
    const roster = assembleMatchRoster({
      humans: [human],
      matchId: MATCH_ID,
      botCount: 2,
      botsEnabled: false,
    })
    assert.equal(roster.length, 1)
    assert.equal(roster[0].id, HUMAN_ID)
    const merged = mergeLobbyMatchSettings(
      { players: [human], kind: 'TURN', maxRounds: 5, turnTimeSec: 90 },
      { maxRounds: 5, turnTimeSec: 90 },
    )
    assert.equal(Object.prototype.hasOwnProperty.call(merged, 'botConfig'), false)
    assert.equal(normalizeBotConfig({ count: 0 }).count, 0)
  })
})

describe('13/14 — AUTO_PASS bot vs humano', () => {
  it('nenhum AUTO_PASS em turno bot', () => {
    const roster = [human, bot]
    assert.equal(shouldDisableTimerAutoPassForTurn(roster, BOT_ID), true)
    const prev = {
      matchId: MATCH_ID,
      turnPlayerId: BOT_ID,
      turnSeq: TURN_SEQ,
      turnDeadlineAt: Date.now() - 1000,
      players: roster,
      gameOver: false,
      turnLock: false,
    }
    const v = validateTurnCommit(prev, autoPassPatch(BOT_ID, TURN_SEQ), { now: Date.now() })
    assert.equal(v.ok, false)
    assert.equal(v.reason, 'bot-timer-auto-pass')
  })

  it('AUTO_PASS humano permanece idêntico', () => {
    const roster = [human, { id: 'h2', name: 'P2', isBot: false }]
    assert.equal(shouldDisableTimerAutoPassForTurn(roster, HUMAN_ID), false)
    const prev = {
      turnPlayerId: HUMAN_ID,
      turnSeq: 3,
      turnDeadlineAt: Date.now() - 1000,
      players: roster,
      gameOver: false,
      turnLock: false,
    }
    const v = validateTurnCommit(prev, autoPassPatch(HUMAN_ID, 3), { now: Date.now() })
    assert.equal(v.ok, true)
    assert.equal(v.reason, 'auto-pass-ok')
  })
})

describe('STARTED/PENDING/REJECTED no gate', () => {
  it('STARTED → ok:true; REJECTED → ok:false', () => {
    assert.equal(toBotOnActionRollResult(true).ok, true)
    const rejected = toBotOnActionRollResult(false)
    assert.equal(rejected.ok, false)
    assert.equal(rejected.reason, 'roll-not-started')
  })
})
