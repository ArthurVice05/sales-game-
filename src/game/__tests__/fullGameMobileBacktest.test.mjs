/**
 * Backtest profundo: partida completa 1D+3M, deadline stale, presença mobile.
 * Executar: node --test src/game/__tests__/fullGameMobileBacktest.test.mjs
 */
import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import {
  resolveTurnDeadlineAfterHandoff,
  remainingTurnMs,
  TURN_HANDOFF_STALE_REMAINING_MS,
} from '../turnTimerLogic.js'
import {
  simulateFullGame,
  scenarioStaleDeadlineHandoffToMobile,
  applyNetSnapshotToClient,
  evaluateCoordinatorTimer,
  freshPresence,
  createMatchState,
  handoffAfterPlay,
} from '../sim/fullGameMobileSimulator.js'

const IDS = ['desktop', 'm1', 'm2', 'm3']

describe('resolveTurnDeadlineAfterHandoff — net apply', () => {
  it('handoff sem turnDeadlineAt no patch herda stale → sanitize renova', () => {
    const now = 1_000_000
    const stale = now + 5_000
    const resolved = resolveTurnDeadlineAfterHandoff({
      prevTurnPlayerId: 'desktop',
      prevTurnSeq: 1,
      nextTurnPlayerId: 'm1',
      nextTurnSeq: 2,
      currentDeadlineAt: stale,
      now,
      turnTimeSec: 90,
      hasIncomingDeadline: false,
    })
    assert.equal(resolved, now + 90_000)
    assert.ok(remainingTurnMs(resolved, now) >= TURN_HANDOFF_STALE_REMAINING_MS)
  })

  it('handoff com deadline válido (45s) mantém', () => {
    const now = 2_000_000
    const good = now + 45_000
    const resolved = resolveTurnDeadlineAfterHandoff({
      prevTurnPlayerId: 'desktop',
      prevTurnSeq: 1,
      nextTurnPlayerId: 'm1',
      nextTurnSeq: 2,
      incomingDeadlineAt: good,
      currentDeadlineAt: good,
      now,
      turnTimeSec: 90,
      hasIncomingDeadline: true,
    })
    assert.equal(resolved, good)
  })
})

describe('cenário regressão — desktop termina tarde, mobile herda deadline', () => {
  it('patch SEM deadline: sanitize impede skip imediato do mobile', () => {
    const r = scenarioStaleDeadlineHandoffToMobile({
      playerIds: IDS,
      includeDeadlineInPatch: false,
    })
    assert.equal(r.ok, true)
    assert.equal(r.nextPlayer, 'm1')
    assert.ok(r.remainingMs >= TURN_HANDOFF_STALE_REMAINING_MS, `remaining=${r.remainingMs}`)
    assert.equal(r.immediateSkip, false, 'm1 não deve ser pulado na hora')
  })

  it('visão mobile após snapshot sem deadline fica com tempo jogável', () => {
    const now = 3_000_000
    const client = {
      turnPlayerId: 'desktop',
      turnSeq: 1,
      turnDeadlineAt: now - 80_000,
      turnTimeSec: 90,
    }
    const synced = applyNetSnapshotToClient(
      client,
      { turnPlayerId: 'm1', turnSeq: 2 },
      now,
    )
    assert.equal(synced.turnPlayerId, 'm1')
    assert.ok(
      remainingTurnMs(synced.turnDeadlineAt, now) >= TURN_HANDOFF_STALE_REMAINING_MS,
    )
    const presence = freshPresence(IDS, now)
    const evalTimer = evaluateCoordinatorTimer(
      {
        ...createMatchState({ playerIds: IDS, now }),
        turnPlayerId: 'm1',
        turnSeq: 2,
        turnDeadlineAt: synced.turnDeadlineAt,
      },
      presence,
      now + 500,
    )
    assert.notEqual(evalTimer.action, 'auto-pass')
  })
})

describe('partida completa simulada — 1D+3M', () => {
  it('2 rodadas × 4 jogadores: todos rolam, zero skip injusto', () => {
    const game = simulateFullGame({
      playerIds: IDS,
      turnTimeSec: 90,
      maxRounds: 2,
      playDurationMs: 40_000,
      handoffIncludesDeadline: true,
    })
    assert.equal(game.unfairSkips.length, 0, JSON.stringify(game.unfairSkips))
    assert.equal(game.stats.skipsByPlayer.desktop, 0)
    assert.equal(game.stats.mobileUnfair, 0)
    for (const id of IDS) {
      assert.ok(game.stats.rollsByPlayer[id] >= 2, `${id} should roll at least twice`)
    }
  })

  it('handoff SEM deadline no patch: sanitize evita pulo mobile em partida inteira', () => {
    const game = simulateFullGame({
      playerIds: IDS,
      turnTimeSec: 90,
      maxRounds: 2,
      playDurationMs: 35_000,
      handoffIncludesDeadline: false,
    })
    const staleOnly = game.unfairSkips.filter((u) =>
      u.reason === 'mobile-view-stale-deadline' || u.reason === 'skip-before-deadline',
    )
    assert.equal(staleOnly.length, 0, JSON.stringify(staleOnly))
  })

  it('presença mobile com lag 40s: nenhum skip por presença (só timer)', () => {
    const lag = { m1: 40_000, m2: 40_000, m3: 40_000 }
    const game = simulateFullGame({
      playerIds: IDS,
      maxRounds: 1,
      playDurationMs: 30_000,
      presenceLagById: lag,
    })
    const presenceSkips = game.unfairSkips.filter((u) =>
      String(u.reason).includes('presence'),
    )
    assert.equal(presenceSkips.length, 0)
  })
})

describe('varredura — cada mobile como próximo após desktop', () => {
  for (const mobileId of ['m1', 'm2', 'm3']) {
    it(`${mobileId}: handoff tardio não causa auto-pass imediato`, () => {
      const now = 5_000_000
      let state = createMatchState({ playerIds: IDS, turnTimeSec: 90, now: now - 88_000 })
      while (String(state.turnPlayerId) !== 'desktop') {
        const h = handoffAfterPlay(state, now - 88_000, { includeDeadline: true })
        state = h.state
      }
      state = { ...state, turnSeq: state.turnSeq, turnPlayerId: 'desktop' }
      const late = handoffAfterPlay(state, now, { includeDeadline: false })
      assert.equal(late.ok, true)
      if (String(late.state.turnPlayerId) !== mobileId) return
      assert.ok(remainingTurnMs(late.state.turnDeadlineAt, now) >= 20_000)
      const presence = freshPresence(IDS, now)
      const timer = evaluateCoordinatorTimer(late.state, presence, now + 500)
      assert.notEqual(timer.action, 'auto-pass')
    })
  }
})

describe('stress — durações aleatórias de jogada', () => {
  it('50 turnos pseudo-aleatórios sem skip antes do deadline', () => {
    const unfair = []
    let state = createMatchState({
      playerIds: IDS,
      turnTimeSec: 60,
      maxRounds: 13,
      now: 10_000_000,
    })
    let now = 10_000_000
    const durations = [20, 35, 50, 25, 40, 55, 30, 45, 38, 42]

    for (let i = 0; i < 50; i += 1) {
      const dur = durations[i % durations.length] * 1000
      const presence = freshPresence(IDS, now)
      const end = now + dur
      let t = now
      while (t <= end) {
        const ev = evaluateCoordinatorTimer(state, presence, t)
        if (ev.action === 'auto-pass') {
          const rem = remainingTurnMs(state.turnDeadlineAt, t)
          if (rem > 0) {
            unfair.push({ player: state.turnPlayerId, rem, t })
          }
          break
        }
        t += 500
      }
      const h = handoffAfterPlay(state, end, { includeDeadline: i % 3 !== 0 })
      if (!h.ok) break
      state = h.state
      now = end
    }
    assert.equal(unfair.length, 0, JSON.stringify(unfair))
  })
})
