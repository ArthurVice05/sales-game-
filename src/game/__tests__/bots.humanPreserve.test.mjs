/**
 * botCount=0 e flag desligada devem preservar o caminho humano da base 8eb3e41.
 */
import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import {
  assembleMatchRoster,
  lobbyStartGate,
  effectiveBotCount,
  normalizeBotConfig,
} from '../bots/botRoster.js'
import { isBotPlayer } from '../bots/botTypes.js'
import {
  shouldDisableTimerAutoPassForTurn,
  validateTurnCommit,
} from '../turnCommitValidation.js'
import {
  mergeLobbyMatchSettings,
  readMatchConfigFromRoomState,
  shouldArmCoordinatorTimer,
} from '../turnTimerLogic.js'
import { shouldFinishAfterRoundTransition } from '../roundEndDecision.js'

function humans(n, extra = {}) {
  return Array.from({ length: n }, (_, i) => ({
    id: `h${i}`,
    name: `Humano ${i + 1}`,
    cash: 25000,
    pos: 0,
    seat: i,
    ready: true,
    ...extra,
  }))
}

function autoPassPatch(expectId, expectSeq) {
  return {
    kind: 'TURN',
    turnPlayerId: 'h1',
    turnSeq: expectSeq + 1,
    lastAction: 'AUTO_PASS_TIMER',
    _expectTurnPlayerId: expectId,
    _expectTurnSeq: expectSeq,
    _commitKind: 'AUTO_PASS',
  }
}

describe('botCount=0 preserva humanos', () => {
  it('roster humano idêntico — mesmos ids, ordem e campos', () => {
    const src = humans(2)
    const out = assembleMatchRoster({
      humans: src,
      matchId: 'm',
      botCount: 0,
      botsEnabled: true,
    })
    assert.deepEqual(
      out.map((p) => ({ id: p.id, name: p.name, cash: p.cash, pos: p.pos, seat: p.seat })),
      src.map((p) => ({ id: p.id, name: p.name, cash: p.cash, pos: p.pos, seat: p.seat })),
    )
    assert.equal(out.some(isBotPlayer), false)
    assert.equal(out.every((p) => p.isBot == null || p.isBot === false), true)
  })

  it('START humano equivalente: 1 humano pronto continua podendo iniciar', () => {
    const gate = lobbyStartGate({
      humans: [{ player_id: 'h0', ready: true }],
      botCount: 0,
      botsEnabled: true,
      amHost: true,
      lobbyOpen: true,
    })
    assert.equal(gate.canStart, true)
    assert.equal(gate.reason, 'human-only')
    assert.equal(gate.effectiveBotCount, 0)
  })

  it('ordem dos turnos equivalente: humanos na ordem original', () => {
    const src = humans(3)
    const out = assembleMatchRoster({
      humans: src,
      matchId: 'm',
      botCount: 0,
      botsEnabled: true,
    })
    assert.deepEqual(out.map((p) => p.id), ['h0', 'h1', 'h2'])
  })

  it('timer humano equivalente', () => {
    const roster = humans(2)
    assert.equal(shouldDisableTimerAutoPassForTurn(roster, 'h0'), false)
    assert.equal(
      shouldArmCoordinatorTimer({ remainingMs: 100, turnDeadlineAt: Date.now() - 1 }),
      true,
    )
  })

  it('auto-pass humano equivalente', () => {
    const roster = humans(2)
    const prev = {
      turnPlayerId: 'h0',
      turnSeq: 3,
      turnDeadlineAt: Date.now() - 1000,
      players: roster,
      gameOver: false,
      turnLock: false,
    }
    const v = validateTurnCommit(prev, autoPassPatch('h0', 3), { now: Date.now() })
    assert.equal(v.ok, true)
    assert.equal(v.reason, 'auto-pass-ok')
  })

  it('fim de rodadas equivalente', () => {
    assert.equal(
      shouldFinishAfterRoundTransition({
        shouldIncrementRound: true,
        nextRound: 6,
        maxRounds: 5,
      }),
      true,
    )
    assert.equal(
      shouldFinishAfterRoundTransition({
        shouldIncrementRound: true,
        nextRound: 5,
        maxRounds: 5,
      }),
      false,
    )
  })

  it('nenhuma gravação de campos bot quando não existem bots', () => {
    const merged = mergeLobbyMatchSettings(
      { players: humans(2), kind: 'TURN', maxRounds: 5, turnTimeSec: 90 },
      { maxRounds: 5, turnTimeSec: 90 },
    )
    assert.equal(Object.prototype.hasOwnProperty.call(merged, 'botConfig'), false)
    const fromRoom = readMatchConfigFromRoomState({ maxRounds: 5, turnTimeSec: 90 })
    assert.deepEqual(fromRoom, { maxRounds: 5, turnTimeSec: 90 })
    assert.equal(effectiveBotCount({ humanCount: 2, requestedCount: 0, botsEnabled: true }), 0)
    const cfg = normalizeBotConfig({ count: 0 })
    assert.equal(cfg.count, 0)
  })

  it('flag desligada zera máquinas mesmo com requestedCount>0', () => {
    const src = humans(1)
    const out = assembleMatchRoster({
      humans: src,
      matchId: 'm',
      botCount: 3,
      botsEnabled: false,
    })
    assert.equal(out.length, 1)
    assert.equal(out[0].id, 'h0')
    assert.equal(out.some(isBotPlayer), false)
  })
})
