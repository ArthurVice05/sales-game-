/**
 * Estabilidade desktop + celular (1D+3M, 2D+2M, etc.).
 * Backtests de turno, timer e presença — sem browser.
 * Executar: node --test src/game/__tests__/desktopMobileStability.test.mjs
 */
import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { planOfflineTurnSkip } from '../offlineTurnSkip.js'
import {
  resolveTurnSkipAuthority,
  pickPresenceCoordinator,
  isTurnPlayerPresent,
  GAME_OFFLINE_THRESHOLD_MS,
} from '../canonicalPresence.js'
import {
  computeTurnDeadlineAt,
  remainingTurnMs,
  sanitizeTurnDeadlineOnHandoff,
  shouldAttemptTimerAutoPass,
  TURN_HANDOFF_STALE_REMAINING_MS,
} from '../turnTimerLogic.js'
import {
  validateTurnCommit,
  shouldProceedTimerAutoPassAfterAwait,
} from '../turnCommitValidation.js'
import { shouldAttemptPresenceAutoSkip } from '../presenceSkipLogic.js'
import { applyGamePatchToState } from '../playerStateSync.js'
import { formatRoundProgress } from '../roundDisplay.js'

const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..')
const NOW = 5_000_000

function roster(ids) {
  return ids.map((id) => ({ id, name: id, bankrupt: false }))
}

function presenceFresh(ids, offsetMs = 0) {
  return ids.map((id) => ({
    playerId: id,
    lastSeen: NOW - offsetMs,
  }))
}

function simulateTurnCycle(playerIds, cycles = 1) {
  const list = roster(playerIds)
  let turnId = playerIds[0]
  let seq = 0
  const log = []
  for (let c = 0; c < cycles * playerIds.length; c++) {
    const plan = planOfflineTurnSkip({
      players: list,
      turnPlayerId: turnId,
      turnSeq: seq,
      round: 1,
      maxRounds: 5,
    })
    assert.ok(plan, `skip plan null at ${turnId}|${seq}`)
    assert.notEqual(plan.nextTurnPlayerId, turnId, `stuck on ${turnId}`)
    log.push({ from: turnId, to: plan.nextTurnPlayerId, seq: plan.nextTurnSeq })
    turnId = plan.nextTurnPlayerId
    seq = plan.nextTurnSeq
  }
  return { turnId, seq, log }
}

function autoPassPatch(fromId, fromSeq, players) {
  const plan = planOfflineTurnSkip({
    players,
    turnPlayerId: fromId,
    turnSeq: fromSeq,
    round: 1,
    maxRounds: 5,
  })
  return {
    kind: 'TURN',
    turnPlayerId: plan.nextTurnPlayerId,
    turnSeq: plan.nextTurnSeq,
    turnLock: false,
    lastAction: 'AUTO_PASS_TIMER',
    _expectTurnPlayerId: fromId,
    _expectTurnSeq: fromSeq,
    _commitKind: 'AUTO_PASS',
  }
}

describe('mix desktop + celular — alternância de turno', () => {
  const mixes = [
    { label: '1 desktop + 3 celular', ids: ['desktop', 'm1', 'm2', 'm3'] },
    { label: '2 desktop + 2 celular', ids: ['d1', 'd2', 'm1', 'm2'] },
    { label: '3 desktop + 1 celular', ids: ['d1', 'd2', 'd3', 'm1'] },
    { label: '1 desktop + 1 celular', ids: ['desktop', 'm1'] },
    { label: '4 celular', ids: ['m1', 'm2', 'm3', 'm4'] },
    { label: '4 desktop', ids: ['d1', 'd2', 'd3', 'd4'] },
  ]

  for (const mix of mixes) {
    it(`${mix.label}: volta completa sem pular assento`, () => {
      const { turnId, seq } = simulateTurnCycle(mix.ids, 1)
      assert.equal(turnId, mix.ids[0])
      assert.equal(seq, mix.ids.length)
    })
  }

  it('1D+3M: duas voltas completas (8 handoffs) mantêm ordem', () => {
    const ids = ['desktop', 'm1', 'm2', 'm3']
    const { log } = simulateTurnCycle(ids, 2)
    assert.equal(log.length, 8)
    const expected = ['m1', 'm2', 'm3', 'desktop', 'm1', 'm2', 'm3', 'desktop']
    assert.deepEqual(log.map((x) => x.to), expected)
  })
})

describe('coordenador desktop vs celular — timer', () => {
  const players = roster(['desktop', 'm1', 'm2', 'm3'])
  const presence = presenceFresh(['desktop', 'm1', 'm2', 'm3'])

  it('desktop é coordinator com todos online', () => {
    const coord = pickPresenceCoordinator(players, presence, NOW)
    assert.equal(coord, 'desktop')
    const auth = resolveTurnSkipAuthority({
      rosterPlayers: players,
      presenceList: presence,
      now: NOW,
      myUid: 'desktop',
      lobbyHostId: 'desktop',
    })
    assert.equal(auth.authorized, true)
    assert.equal(auth.reason, 'presence-coordinator')
  })

  it('celular NÃO é coordinator enquanto desktop está online', () => {
    const auth = resolveTurnSkipAuthority({
      rosterPlayers: players,
      presenceList: presence,
      now: NOW,
      myUid: 'm2',
      lobbyHostId: 'desktop',
    })
    assert.equal(auth.authorized, false)
    assert.equal(auth.reason, 'not-authority')
  })

  it('desktop NÃO pula m2 com 45s restantes (turnTime 60)', () => {
    const deadline = NOW + 45_000
    const d = shouldAttemptTimerAutoPass({
      now: NOW,
      turnDeadlineAt: deadline,
      turnLock: false,
      gameOver: false,
      amCoordinator: true,
      turnPlayerId: 'm2',
      turnSeq: 3,
      lastAttemptKey: null,
      inFlight: false,
    })
    assert.equal(d.ok, false)
    assert.equal(d.reason, 'not-expired')
    assert.equal(remainingTurnMs(deadline, NOW), 45_000)
  })

  it('presença NÃO avança turno (só HUD) mesmo com m3 “offline”', () => {
    const stalePresence = presenceFresh(['desktop', 'm1', 'm2'], 0).concat([
      { playerId: 'm3', lastSeen: NOW - GAME_OFFLINE_THRESHOLD_MS - 1 },
    ])
    assert.equal(
      isTurnPlayerPresent({
        turnPlayerId: 'm3',
        presenceList: stalePresence,
        now: NOW,
      }),
      false,
    )
    const skip = shouldAttemptPresenceAutoSkip({
      turnPresent: false,
      turnLock: false,
      amCoordinator: true,
      turnPlayerId: 'm3',
      turnSeq: 4,
      waitingSinceMs: NOW - 120_000,
      now: NOW,
    })
    assert.equal(skip.ok, false)
    assert.equal(skip.reason, 'hud-only-wait')
  })

  it('host-fallback só quando ninguém tem presença fresca', () => {
    const allStale = players.map((p) => ({
      playerId: p.id,
      lastSeen: NOW - GAME_OFFLINE_THRESHOLD_MS - 5_000,
    }))
    assert.equal(pickPresenceCoordinator(players, allStale, NOW), null)
    const hostAuth = resolveTurnSkipAuthority({
      rosterPlayers: players,
      presenceList: allStale,
      now: NOW,
      myUid: 'desktop',
      lobbyHostId: 'desktop',
    })
    assert.equal(hostAuth.authorized, true)
    assert.equal(hostAuth.reason, 'lobby-host-fallback')
  })
})

describe('handoff com prazo herdado — regressão skip imediato', () => {
  it('m2 herda deadline com 5s → sanitize gera turnTime completo', () => {
    const now = NOW
    const staleDeadline = now + 5_000
    const fresh = sanitizeTurnDeadlineOnHandoff({
      prevTurnPlayerId: 'desktop',
      nextTurnPlayerId: 'm1',
      prevTurnSeq: 1,
      nextTurnSeq: 2,
      currentDeadlineAt: staleDeadline,
      now,
      turnTimeSec: 90,
    })
    assert.equal(fresh, now + 90_000)
    assert.ok(remainingTurnMs(fresh, now) >= TURN_HANDOFF_STALE_REMAINING_MS)
  })

  it('auto-pass rejeitado se snapshot remoto ainda tem prazo futuro', () => {
    const remote = {
      turnPlayerId: 'm1',
      turnSeq: 2,
      turnLock: false,
      turnDeadlineAt: NOW + 30_000,
      gameOver: false,
      players: roster(['desktop', 'm1', 'm2', 'm3']),
    }
    const patch = autoPassPatch('m1', 2, remote.players)
    const v = validateTurnCommit(remote, patch, { now: NOW })
    assert.equal(v.ok, false)
    assert.equal(v.reason, 'not-expired')
  })

  it('barreira pós-await bloqueia se prazo voltou a ser futuro', () => {
    const proceed = shouldProceedTimerAutoPassAfterAwait({
      now: NOW,
      turnDeadlineAt: NOW + 10_000,
      turnLock: false,
      gameOver: false,
      capturedTurnPlayerId: 'm2',
      capturedTurnSeq: 3,
      currentTurnPlayerId: 'm2',
      currentTurnSeq: 3,
      lastAttemptKey: null,
      inFlight: false,
      amCoordinator: true,
    })
    assert.equal(proceed.ok, false)
    assert.equal(proceed.reason, 'not-expired')
  })
})

describe('backtest — partida 1D+3M turno a turno', () => {
  it('4 jogadores: nenhum AUTO_PASS antes do zero em cadeia simulada', () => {
    const ids = ['desktop', 'm1', 'm2', 'm3']
    const list = roster(ids)
    let turnId = ids[0]
    let seq = 0
    const turnTimeSec = 60

    for (let step = 0; step < 4; step++) {
      const deadline = computeTurnDeadlineAt(NOW + step * 1000, turnTimeSec)
      const mid = NOW + step * 1000 + 30_000
      const d = shouldAttemptTimerAutoPass({
        now: mid,
        turnDeadlineAt: deadline,
        turnLock: false,
        gameOver: false,
        amCoordinator: true,
        turnPlayerId: turnId,
        turnSeq: seq,
        lastAttemptKey: null,
        inFlight: false,
      })
      assert.equal(d.ok, false, `premature skip ${turnId} step ${step}`)

      const plan = planOfflineTurnSkip({
        players: list,
        turnPlayerId: turnId,
        turnSeq: seq,
        round: 1,
        maxRounds: 2,
      })
      turnId = plan.nextTurnPlayerId
      seq = plan.nextTurnSeq
    }
    assert.equal(turnId, 'desktop')
    assert.equal(formatRoundProgress(1, 2).label, '0/2')
  })

  it('commit CAS: auto-pass só após deadline real', () => {
    const playersList = roster(['desktop', 'm1', 'm2', 'm3'])
    const remote = {
      turnPlayerId: 'm1',
      turnSeq: 1,
      turnLock: false,
      turnDeadlineAt: NOW,
      gameOver: false,
      players: playersList,
    }
    const patch = autoPassPatch('m1', 1, playersList)
    const applied = applyGamePatchToState(remote, { statePatch: patch }, { now: NOW })
    assert.equal(applied.ok, true)
    assert.equal(applied.state.turnPlayerId, 'm2')
  })
})

describe('plataforma mobile — wiring Android/iOS', () => {
  const app = readFileSync(join(root, 'src', 'App.jsx'), 'utf8')
  const lobby = readFileSync(join(root, 'src', 'pages', 'PlayersLobby.jsx'), 'utf8')
  const presenceHook = readFileSync(
    join(root, 'src', 'game', 'useGamePresenceAutoSkip.js'),
    'utf8',
  )
  const main = readFileSync(join(root, 'src', 'main.jsx'), 'utf8')

  it('App não remove assento em pagehide/beforeunload', () => {
    assert.match(app, /NÃO remove assento em pagehide/)
    assert.doesNotMatch(app, /beforeunload.*leaveLobby/)
  })

  it('PlayersLobby documenta remoção de auto-eject Android', () => {
    assert.match(lobby, /pagehide|Android Chrome/)
  })

  it('heartbeat pausa em aba oculta (throttle mobile)', () => {
    assert.match(presenceHook, /visibilityState === 'hidden'/)
  })

  it('iOS viewport hook isolado do Android', () => {
    assert.match(main, /useIosVisualViewport/)
    assert.match(main, /useMobilePinchZoom/)
  })

  it('App usa formatRoundProgress no HUD', () => {
    assert.match(app, /formatRoundProgress/)
  })
})
