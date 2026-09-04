/**
 * FASE 1 — reprodução no código atual (somente APIs já exportadas).
 * Esperado: falhas em C, D e G antes da correção.
 */
import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { ADVANCE_PENDING, interpretAdvanceStartResult } from '../bots/botRollGate.js'
import { sleepCancellable, waitForBotPipelineHandoff } from '../bots/botRollRetry.js'
import { inferBotDecisionKindFromElement } from '../bots/botDecisionKind.js'
import { runBotTurnPipeline } from '../bots/botTurnPipeline.js'

const BOT_ID = 'bot:match-roll-1:0'
const TURN_SEQ = 4

describe('FASE 1 reprodução — código anterior', () => {
  it('A: PENDING interpretado não pode ser ok:true (ADVANCE_PENDING já existe; engine ainda devolve true)', () => {
    const pending = interpretAdvanceStartResult(ADVANCE_PENDING)
    assert.equal(pending.ok, false)
    assert.equal(pending.reason, 'roll-pending-modals')
    // O motor hoje devolve true ao agendar retry. true é STARTED — o bot não pode receber isso.
    const engineSchedulesAsTrue = interpretAdvanceStartResult(true)
    assert.equal(engineSchedulesAsTrue.ok, true, 'documenta que true=STARTED; o motor precisa deixar de devolver true no PENDING')
  })

  it('C: 25 falhas transitórias + 26ª ok — a máquina deve rolar exatamente uma vez', async () => {
    let n = 0
    const MATCH_ID = 'match-roll-1'
    const HUMAN_ID = 'human-host'
    const BOT_ID = 'bot:match-roll-1:0'
    const bot = { id: BOT_ID, name: 'Máquina 1', isBot: true, controller: 'BOT' }
    const human = { id: HUMAN_ID, name: 'Host', isBot: false }
    const live = {
      enabled: true,
      botsEnabled: true,
      authoritativeNetEnabled: true,
      matchId: MATCH_ID,
      turnPlayerId: BOT_ID,
      turnSeq: 4,
      gameOver: false,
      turnLock: false,
      lockOwner: null,
      lockTs: null,
      lastRollTurnKey: null,
      currentPlayer: bot,
      remoteMatchId: MATCH_ID,
      remoteTurnPlayerId: BOT_ID,
      remoteTurnSeq: 4,
      remoteGameOver: false,
      botTurnKey: null,
      botTurnSeed: null,
      botClaimExecutor: null,
    }
    const result = await runBotTurnPipeline({
      signal: new AbortController().signal,
      liveRef: { current: live },
      claimProofRef: { current: null },
      ranKeysRef: { current: [] },
      executorId: 'tab-A',
      matchId: MATCH_ID,
      turnPlayerId: BOT_ID,
      turnSeq: 4,
      botPlayer: bot,
      myUidRef: { current: HUMAN_ID },
      lobbyHostIdRef: { current: HUMAN_ID },
      playersRef: { current: [human, bot] },
      presenceListRef: { current: [{ playerId: HUMAN_ID, lastSeen: Date.now() }] },
      presenceFetchMetaRef: { current: { hasAttemptedFetch: true, lastFetchError: null } },
      commitClaimRef: { current: async () => ({ ok: true }) },
      onBotRollRef: {
        current: async () => {
          n += 1
          if (n <= 25) return { ok: false, reason: 'roll-pending-modals' }
          live.lastRollTurnKey = '4'
          live.turnPlayerId = HUMAN_ID
          live.remoteTurnPlayerId = HUMAN_ID
          live.turnSeq = 5
          live.remoteTurnSeq = 5
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
      handoffMaxWaitMs: 200,
      rollDelayMs: 0,
      rollMaxBackoffMs: 0,
    })
    assert.equal(result.ok, true)
    assert.equal(n, 26)
  })

  it('D: lastRollTurnKey com o mesmo turno NÃO declara handoff', async () => {
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
      maxWaitMs: 80,
      sleep: (ms, signal) => sleepCancellable(ms, signal),
    })
    await new Promise((r) => setTimeout(r, 20))
    assert.ok(polls >= 2, `handoff não pode encerrar no first poll (polls=${polls})`)
    live.turnPlayerId = 'human-host'
    live.turnSeq = TURN_SEQ + 1
    const result = await pending
    assert.equal(result.reason, 'handoff')
    assert.notEqual(result.reason, 'rolled')
  })

  it('G: nome minificado não pode virar PURCHASE', () => {
    function n() {
      return null
    }
    Object.defineProperty(n, 'name', { value: 'n' })
    n.displayName = 'n'
    const kind = inferBotDecisionKindFromElement({ type: n, props: {} })
    assert.equal(kind, 'UNKNOWN')
    assert.notEqual(kind, 'PURCHASE')
  })
})
