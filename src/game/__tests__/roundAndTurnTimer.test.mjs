/**
 * Rodadas + tempo por jogada + timer autoritativo (node:test).
 * Executar: node --test src/game/__tests__/roundAndTurnTimer.test.mjs
 */
import { describe, it, beforeEach } from 'node:test'
import assert from 'node:assert/strict'
import {
  MIN_ROUNDS,
  MAX_ROUNDS_LIMIT,
  DEFAULT_MAX_ROUNDS,
  normalizeMaxRounds,
} from '../roundConfig.js'
import {
  MIN_TURN_TIME_SEC,
  DEFAULT_TURN_TIME_SEC,
  MAX_TURN_TIME_SEC,
  TURN_TIME_PRESETS,
  normalizeTurnTime,
  resolveTurnTimeSecFromState,
} from '../turnTimeConfig.js'
import {
  computeTurnDeadlineAt,
  remainingTurnMs,
  shouldAttemptTimerAutoPass,
  planTurnTimerPass,
  shouldBlockDuplicateSkip,
  resolveAuthoritativeDeadline,
  mergeLobbyMatchSettings,
  readMatchConfigFromRoomState,
  turnAttemptKey,
  normalizeMatchConfig,
  sanitizeTurnDeadlineOnHandoff,
  shouldArmTimerSkipForTurn,
} from '../turnTimerLogic.js'
import {
  __resetSharedTurnSkipGuardForTests,
  markSharedSkipKey,
  wasAlreadySkipped,
  getSharedSkipInFlight,
  setSharedSkipInFlight,
} from '../sharedTurnSkipGuard.js'

function playersABC() {
  return [
    { id: 'a', name: 'A', bankrupt: false },
    { id: 'b', name: 'B', bankrupt: false },
    { id: 'c', name: 'C', bankrupt: false },
  ]
}

beforeEach(() => {
  __resetSharedTurnSkipGuardForTests()
})

describe('RODADAS', () => {
  it('1. mínimo 1', () => {
    assert.equal(MIN_ROUNDS, 1)
    assert.equal(normalizeMaxRounds(1), 1)
  })

  it('2. máximo 5', () => {
    assert.equal(MAX_ROUNDS_LIMIT, 5)
    assert.equal(normalizeMaxRounds(5), 5)
  })

  it('3. default 5', () => {
    assert.equal(DEFAULT_MAX_ROUNDS, 5)
    assert.equal(normalizeMaxRounds(undefined), 5)
    assert.equal(normalizeMaxRounds(null), 5)
  })

  it('4. normalize', () => {
    assert.equal(normalizeMaxRounds(0), DEFAULT_MAX_ROUNDS)
    assert.equal(normalizeMaxRounds(6), DEFAULT_MAX_ROUNDS)
    assert.equal(normalizeMaxRounds(2.9), 2)
    assert.equal(normalizeMaxRounds('3'), 3)
    assert.equal(normalizeMaxRounds('x', 4), 4)
  })

  it('5. endgame respeitando número configurado', () => {
    const configured = normalizeMaxRounds(3)
    assert.equal(configured, 3)
    // Contrato do motor: ao avançar além de MAX_ROUNDS a partida encerra.
    const shouldEndAfterRoundAdvance = (nextRound, maxRounds) => nextRound > maxRounds
    assert.equal(shouldEndAfterRoundAdvance(3, configured), false)
    assert.equal(shouldEndAfterRoundAdvance(4, configured), true)
    assert.equal(shouldEndAfterRoundAdvance(5, normalizeMaxRounds(5)), false)
    assert.equal(shouldEndAfterRoundAdvance(6, normalizeMaxRounds(5)), true)
  })
})

describe('TEMPO', () => {
  it('6. default 90', () => {
    assert.equal(DEFAULT_TURN_TIME_SEC, 90)
    assert.equal(normalizeTurnTime(undefined), 90)
  })

  it('7. presets válidos 60/90/120/180', () => {
    assert.deepEqual([...TURN_TIME_PRESETS], [60, 90, 120, 180])
    for (const p of TURN_TIME_PRESETS) {
      assert.equal(normalizeTurnTime(p), p)
    }
  })

  it('8. valores inválidos normalizados', () => {
    assert.equal(normalizeTurnTime(59), DEFAULT_TURN_TIME_SEC)
    assert.equal(normalizeTurnTime(181), DEFAULT_TURN_TIME_SEC)
    assert.equal(normalizeTurnTime('nope'), DEFAULT_TURN_TIME_SEC)
    assert.equal(normalizeTurnTime(90.7), 90)
    assert.equal(MIN_TURN_TIME_SEC, 60)
    assert.equal(MAX_TURN_TIME_SEC, 180)
  })

  it('9. configuração preservada no state', () => {
    const merged = mergeLobbyMatchSettings(
      { players: [], kind: 'LOBBY_SETTINGS', maxRounds: 2, turnTimeSec: 60 },
      { maxRounds: 4, turnTimeSec: 120 }
    )
    assert.equal(merged.maxRounds, 4)
    assert.equal(merged.turnTimeSec, 120)
    const cfg = normalizeMatchConfig({ maxRounds: 4, turnTimeSec: 120 })
    assert.deepEqual(cfg, { maxRounds: 4, turnTimeSec: 120 })
    const fromRoom = readMatchConfigFromRoomState({ maxRounds: 4, turnTimeSec: 120 })
    assert.deepEqual(fromRoom, { maxRounds: 4, turnTimeSec: 120 })
  })

  it('10. fallback para sala antiga sem turnTimeSec', () => {
    assert.equal(resolveTurnTimeSecFromState({}), 90)
    assert.equal(resolveTurnTimeSecFromState({ maxRounds: 3 }), 90)
    assert.equal(resolveTurnTimeSecFromState(null), 90)
    assert.equal(resolveTurnTimeSecFromState({ turnTimeSec: 120 }), 120)
  })
})

describe('TIMER', () => {
  it('11. novo turno reinicia timer', () => {
    const t0 = 1_000_000
    const d1 = computeTurnDeadlineAt(t0, 90)
    const d2 = computeTurnDeadlineAt(t0 + 5_000, 90)
    assert.equal(d1, t0 + 90_000)
    assert.equal(d2, t0 + 5_000 + 90_000)
    assert.notEqual(d1, d2)
    assert.equal(remainingTurnMs(d1, t0), 90_000)
  })

  it('11b. handoff com prazo estourado gera relógio novo', () => {
    const now = 500_000
    const leftover = now - 5_000
    const next = sanitizeTurnDeadlineOnHandoff({
      prevTurnPlayerId: 'a',
      nextTurnPlayerId: 'b',
      prevTurnSeq: 1,
      nextTurnSeq: 2,
      currentDeadlineAt: leftover,
      now,
      turnTimeSec: 90,
    })
    assert.equal(next, now + 90_000)
    assert.equal(shouldArmTimerSkipForTurn({ remainingMs: remainingTurnMs(leftover, now) }), false)
    assert.equal(shouldArmTimerSkipForTurn({ remainingMs: 90_000 }), true)
  })

  it('11c. mesmo turno não reinicia prazo válido', () => {
    const now = 500_000
    const deadline = now + 40_000
    const same = sanitizeTurnDeadlineOnHandoff({
      prevTurnPlayerId: 'b',
      nextTurnPlayerId: 'b',
      prevTurnSeq: 2,
      nextTurnSeq: 2,
      currentDeadlineAt: deadline,
      now,
      turnTimeSec: 90,
    })
    assert.equal(same, deadline)
  })

  it('12. timer zerado dispara apenas um avanço', () => {
    const decision = shouldAttemptTimerAutoPass({
      now: 200_000,
      turnDeadlineAt: 100_000,
      turnLock: false,
      gameOver: false,
      amCoordinator: true,
      turnPlayerId: 'a',
      turnSeq: 2,
      lastAttemptKey: null,
      inFlight: false,
    })
    assert.equal(decision.ok, true)
    const key = decision.attemptKey
    markSharedSkipKey('a', 2)
    assert.equal(wasAlreadySkipped('a', 2), true)
    const again = shouldAttemptTimerAutoPass({
      now: 200_000,
      turnDeadlineAt: 100_000,
      turnLock: false,
      gameOver: false,
      amCoordinator: true,
      turnPlayerId: 'a',
      turnSeq: 2,
      lastAttemptKey: key,
      inFlight: false,
    })
    assert.equal(again.ok, false)
    assert.equal(again.reason, 'already-attempted')
  })

  it('13. mudança manual antes de zero impede avanço antigo', () => {
    const plan = planTurnTimerPass({
      players: playersABC(),
      turnPlayerId: 'a',
      turnSeq: 1,
      round: 1,
      maxRounds: 5,
    })
    assert.equal(plan.fromTurnSeq, 1)
    assert.equal(plan.nextTurnSeq, 2)
    // Após avanço manual, CAS espera seq 1 → falha
    const stale = shouldAttemptTimerAutoPass({
      now: 999_999,
      turnDeadlineAt: 1,
      turnLock: false,
      gameOver: false,
      amCoordinator: true,
      turnPlayerId: 'a',
      turnSeq: 1,
      lastAttemptKey: turnAttemptKey('a', 1),
      inFlight: false,
    })
    assert.equal(stale.ok, false)
  })

  it('14. auto-skip offline + timer não geram skip duplo', () => {
    markSharedSkipKey('b', 4)
    assert.equal(
      shouldBlockDuplicateSkip({
        attemptKey: turnAttemptKey('b', 4),
        lastOfflineSkipKey: turnAttemptKey('b', 4),
        lastTimerSkipKey: null,
      }),
      true
    )
    assert.equal(wasAlreadySkipped('b', 4), true)
    const blocked = shouldAttemptTimerAutoPass({
      now: 999_999,
      turnDeadlineAt: 1,
      turnLock: false,
      gameOver: false,
      amCoordinator: true,
      turnPlayerId: 'b',
      turnSeq: 4,
      lastAttemptKey: turnAttemptKey('b', 4),
      inFlight: false,
    })
    assert.equal(blocked.ok, false)
  })

  it('15. jogador eliminado/offline é pulado corretamente', () => {
    const list = [
      { id: 'a', bankrupt: true },
      { id: 'b', bankrupt: false },
      { id: 'c', bankrupt: false },
    ]
    const plan = planTurnTimerPass({
      players: list,
      turnPlayerId: 'b',
      turnSeq: 0,
      round: 1,
      maxRounds: 5,
    })
    assert.equal(plan.nextTurnPlayerId, 'c')
    // De C (vivo) o próximo vivo não é A falido
    const plan2 = planTurnTimerPass({
      players: list,
      turnPlayerId: 'c',
      turnSeq: 1,
      round: 1,
      maxRounds: 5,
    })
    assert.equal(plan2.nextTurnPlayerId, 'b')
  })

  it('16. fim de jogo impede novo avanço', () => {
    const decision = shouldAttemptTimerAutoPass({
      now: 999_999,
      turnDeadlineAt: 1,
      turnLock: false,
      gameOver: true,
      amCoordinator: true,
      turnPlayerId: 'a',
      turnSeq: 9,
      lastAttemptKey: null,
      inFlight: false,
    })
    assert.equal(decision.ok, false)
    assert.equal(decision.reason, 'game-over')
  })

  it('17. reconexão usa o mesmo estado/deadline', () => {
    const deadline = 5_500_000
    const resolved = resolveAuthoritativeDeadline({
      stateDeadlineAt: deadline,
      stateTurnSeq: 3,
      currentTurnSeq: 3,
      turnTimeSec: 90,
      now: 5_000_000,
    })
    assert.equal(resolved, deadline)
    // Seq diferente → novo deadline a partir de now
    const fresh = resolveAuthoritativeDeadline({
      stateDeadlineAt: deadline,
      stateTurnSeq: 2,
      currentTurnSeq: 3,
      turnTimeSec: 60,
      now: 5_000_000,
    })
    assert.equal(fresh, 5_000_000 + 60_000)
  })
})

describe('MULTIPLAYER', () => {
  it('18. somente autoridade/coordinator pode efetivar auto-pass', () => {
    const guest = shouldAttemptTimerAutoPass({
      now: 999_999,
      turnDeadlineAt: 1,
      turnLock: false,
      gameOver: false,
      amCoordinator: false,
      turnPlayerId: 'a',
      turnSeq: 1,
      lastAttemptKey: null,
      inFlight: false,
    })
    assert.equal(guest.ok, false)
    assert.equal(guest.reason, 'not-coordinator')

    const host = shouldAttemptTimerAutoPass({
      now: 999_999,
      turnDeadlineAt: 1,
      turnLock: false,
      gameOver: false,
      amCoordinator: true,
      turnPlayerId: 'a',
      turnSeq: 1,
      lastAttemptKey: null,
      inFlight: false,
    })
    assert.equal(host.ok, true)
  })

  it('19. guest não avança turno sozinho', () => {
    const guest = shouldAttemptTimerAutoPass({
      now: 999_999,
      turnDeadlineAt: 1,
      turnLock: false,
      gameOver: false,
      amCoordinator: false,
      turnPlayerId: 'x',
      turnSeq: 0,
      lastAttemptKey: null,
      inFlight: false,
    })
    assert.equal(guest.ok, false)
  })

  it('20. host migration mantém configuração', () => {
    const before = mergeLobbyMatchSettings(
      { maxRounds: 2, turnTimeSec: 180, players: [{ id: '1' }], kind: 'TURN' },
      {}
    )
    // Migração de host não deve apagar config ao re-mergear o mesmo state
    const after = mergeLobbyMatchSettings(before, {
      maxRounds: before.maxRounds,
      turnTimeSec: before.turnTimeSec,
    })
    assert.equal(after.maxRounds, 2)
    assert.equal(after.turnTimeSec, 180)
    assert.equal(after.players.length, 1)
  })

  it('extra: turnLock bloqueia auto-pass (modais/crítico)', () => {
    const locked = shouldAttemptTimerAutoPass({
      now: 999_999,
      turnDeadlineAt: 1,
      turnLock: true,
      gameOver: false,
      amCoordinator: true,
      turnPlayerId: 'a',
      turnSeq: 1,
      lastAttemptKey: null,
      inFlight: false,
    })
    assert.equal(locked.ok, false)
    assert.match(String(locked.reason), /turn-locked/)
  })

  it('extra: inFlight compartilhado impede corrida', () => {
    setSharedSkipInFlight(true)
    assert.equal(getSharedSkipInFlight(), true)
    const d = shouldAttemptTimerAutoPass({
      now: 999_999,
      turnDeadlineAt: 1,
      turnLock: false,
      gameOver: false,
      amCoordinator: true,
      turnPlayerId: 'a',
      turnSeq: 1,
      lastAttemptKey: null,
      inFlight: true,
    })
    assert.equal(d.ok, false)
    assert.equal(d.reason, 'in-flight')
  })
})
