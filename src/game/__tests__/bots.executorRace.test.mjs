/**
 * Regressão física: BOT_CLAIM ok com netState.botClaimExecutor ainda null.
 * Executa runBotTurnPipeline real — não um helper paralelo.
 */
import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { runBotTurnPipeline } from '../bots/botTurnPipeline.js'
import { isValidClaimProof } from '../bots/botClaimProof.js'
import {
  shouldDisableTimerAutoPassForTurn,
  validateTurnCommit,
} from '../turnCommitValidation.js'
import { shouldArmCoordinatorTimer } from '../turnTimerLogic.js'

const MATCH_ID = 'match-race-1'
const HUMAN_ID = 'human-host'
const BOT_ID = 'bot:match-race-1:0'
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

function createHarness({
  commitResult,
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
  onAfterClaim = null,
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
        const result =
          typeof commitResult === 'function' ? commitResult(payload, live) : commitResult
        if (typeof onAfterClaim === 'function') onAfterClaim(live, result)
        return result
      },
    },
    onBotRollRef: {
      current: async (payload) => {
        rolls.push(payload)
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

describe('corrida do executor — pipeline real', () => {
  it('claim ok + botClaimExecutor null → prova local tab-A → um ROLL; eco posterior não gera segunda rolagem', async () => {
    const h = createHarness({
      commitResult: { ok: true },
      remoteExecutor: null,
    })

    const first = await h.run()
    assert.equal(first.ok, true)
    assert.equal(h.claims.length, 1)
    assert.equal(h.rolls.length, 1)
    assert.equal(isValidClaimProof(h.claimProofRef.current), true)
    assert.equal(h.claimProofRef.current.executorId, TAB_A)
    assert.equal(h.live.botClaimExecutor, null)
    assert.equal(h.rolls[0].botClaim.claimProof.executorId, TAB_A)

    h.live.botClaimExecutor = TAB_A
    h.live.turnPlayerId = BOT_ID
    h.live.remoteTurnPlayerId = BOT_ID
    h.live.turnSeq = TURN_SEQ
    h.live.remoteTurnSeq = TURN_SEQ
    h.live.lastRollTurnKey = String(TURN_SEQ)

    const echo = createHarness({
      commitResult: { ok: true },
      remoteExecutor: TAB_A,
      lastRollTurnKey: String(TURN_SEQ),
    })
    echo.ranKeysRef.current = h.ranKeysRef.current
    echo.claimProofRef.current = h.claimProofRef.current
    const second = await echo.run()
    assert.equal(echo.rolls.length, 0)
    assert.notEqual(second.reason, undefined)
  })

  it('claim casLost:true → zero ROLL', async () => {
    const h = createHarness({
      commitResult: () => {
        queueMicrotask(() => h.abort.abort())
        return { ok: false, casLost: true }
      },
      claimDelayMs: 5,
    })
    const result = await h.run()
    assert.equal(result.ok, false)
    assert.equal(h.rolls.length, 0)
    assert.equal(h.claimProofRef.current, null)
  })

  it('claim ok:false → zero ROLL', async () => {
    const h = createHarness({
      commitResult: () => {
        queueMicrotask(() => h.abort.abort())
        return { ok: false }
      },
      claimDelayMs: 5,
    })
    const result = await h.run()
    assert.equal(result.ok, false)
    assert.equal(h.rolls.length, 0)
  })

  it('executor remoto diferente aborta sem ROLL', async () => {
    const h = createHarness({
      commitResult: { ok: true },
      remoteExecutor: TAB_B,
      executorId: TAB_A,
    })
    const result = await h.run()
    assert.equal(result.ok, false)
    assert.equal(h.rolls.length, 0)
  })

  it('mudança de turnSeq aborta', async () => {
    const h = createHarness({
      commitResult: { ok: true },
    })
    h.live.turnSeq = TURN_SEQ + 1
    h.live.remoteTurnSeq = TURN_SEQ + 1
    const result = await h.run()
    assert.equal(result.ok, false)
    assert.equal(h.rolls.length, 0)
  })

  it('lastRollTurnKey já presente → zero ROLL', async () => {
    const h = createHarness({
      commitResult: { ok: true },
      lastRollTurnKey: String(TURN_SEQ),
    })
    const result = await h.run()
    assert.equal(h.rolls.length, 0)
    assert.equal(result.ok, false)
  })

  it('StrictMode/double start: abort e restart produzem uma rolagem', async () => {
    const h1 = createHarness({ commitResult: { ok: true }, thinkDelayMs: 40 })
    const p1 = h1.run()
    setTimeout(() => h1.abort.abort(), 5)
    await p1
    assert.equal(h1.rolls.length, 0)

    const h2 = createHarness({ commitResult: { ok: true } })
    await h2.run()
    assert.equal(h2.rolls.length, 1)
  })

  it('presença carregada e vazia com host único: fallback válido e um ROLL', async () => {
    const h = createHarness({
      commitResult: { ok: true },
      presenceList: [],
      hasAttemptedFetch: true,
    })
    const result = await h.run()
    assert.equal(result.ok, true)
    assert.equal(h.rolls.length, 1)
  })

  it('presença ainda carregando: nenhum claim', async () => {
    const h = createHarness({
      commitResult: { ok: true },
      hasAttemptedFetch: false,
      waitDelayMs: 5,
    })
    setTimeout(() => h.abort.abort(), 20)
    const result = await h.run()
    assert.equal(h.claims.length, 0)
    assert.equal(h.rolls.length, 0)
    assert.equal(result.ok, false)
  })

  it('handoff remoto atrasado: aguarda e depois prossegue com um ROLL', async () => {
    const h = createHarness({
      commitResult: { ok: true },
      remoteTurnPlayerId: null,
      remoteTurnSeq: null,
      waitDelayMs: 5,
    })
    setTimeout(() => {
      h.live.remoteTurnPlayerId = BOT_ID
      h.live.remoteTurnSeq = TURN_SEQ
      h.live.remoteMatchId = MATCH_ID
    }, 12)
    const result = await h.run()
    assert.equal(result.ok, true)
    assert.equal(h.rolls.length, 1)
  })
})

describe('timer durante e após turno de máquina', () => {
  it('timer zerado durante turno bot: não auto-passa', () => {
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

  it('próximo turno humano: timer normal volta a funcionar', () => {
    const roster = [human, bot]
    assert.equal(shouldDisableTimerAutoPassForTurn(roster, HUMAN_ID), false)
    const arm = shouldArmCoordinatorTimer({
      remainingMs: 100,
      turnDeadlineAt: Date.now() - 1,
    })
    assert.equal(arm, true)
    const prev = {
      matchId: MATCH_ID,
      turnPlayerId: HUMAN_ID,
      turnSeq: TURN_SEQ + 1,
      turnDeadlineAt: Date.now() - 1000,
      players: roster,
      gameOver: false,
      turnLock: false,
    }
    const v = validateTurnCommit(prev, autoPassPatch(HUMAN_ID, TURN_SEQ + 1), { now: Date.now() })
    assert.equal(v.ok, true)
    assert.equal(v.reason, 'auto-pass-ok')
  })
})
