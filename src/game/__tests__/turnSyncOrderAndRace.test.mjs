/**
 * Regressão: ordem de seats (joined_at) + races ROLL/TIMER/PLAYER_DELTA/HANDOFF/LOCK.
 * Executar: node --test src/game/__tests__/turnSyncOrderAndRace.test.mjs
 */
import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { findNextAliveIdx } from '../gameMath.js'
import {
  assignSeatsByJoinOrder,
  normalizeLobbyPlayersForStart,
  sortLobbyPlayersForSeats,
} from '../lobbySeatOrder.js'
import { planOfflineTurnSkip } from '../offlineTurnSkip.js'
import { applyGamePatchToState } from '../playerStateSync.js'
import {
  validateTurnCommit,
  inferCommitKind,
  ensurePlayerDeltaCommitMeta,
} from '../turnCommitValidation.js'
import { shouldApplyRemoteRoomRow } from '../turnStateMonotonic.js'

const NOW = 3_000_000

function playerDeltaPatch({ fromId, fromSeq, pos = 5, cash }) {
  return {
    playersDeltaById: {
      [fromId]: {
        pos,
        ...(cash != null ? { cash } : {}),
        _actionId: `roll-${fromId}-${fromSeq}`,
      },
    },
    statePatch: {
      kind: 'PLAYER_DELTA',
      _commitKind: 'PLAYER_DELTA',
      lastRollTurnKey: String(fromSeq),
      _expectTurnPlayerId: fromId,
      _expectTurnSeq: fromSeq,
    },
  }
}

function autoPassPatch(players, fromId, fromSeq) {
  const plan = planOfflineTurnSkip({
    players,
    turnPlayerId: fromId,
    turnSeq: fromSeq,
    round: 1,
    maxRounds: 20,
  })
  return {
    kind: 'TURN',
    turnPlayerId: plan.nextTurnPlayerId,
    turnSeq: plan.nextTurnSeq,
    turnLock: false,
    lockOwner: null,
    lastRollTurnKey: null,
    lastAction: 'AUTO_PASS_TIMER',
    _expectTurnPlayerId: fromId,
    _expectTurnSeq: fromSeq,
    _commitKind: 'AUTO_PASS',
  }
}

function handoffPatch(players, fromId, fromSeq) {
  const plan = planOfflineTurnSkip({
    players,
    turnPlayerId: fromId,
    turnSeq: fromSeq,
    round: 1,
    maxRounds: 20,
  })
  return {
    kind: 'TURN',
    turnPlayerId: plan.nextTurnPlayerId,
    turnSeq: plan.nextTurnSeq,
    turnLock: false,
    lockOwner: null,
    lastRollTurnKey: null,
    lastAction: 'NORMAL_HANDOFF',
    _expectTurnPlayerId: fromId,
    _expectTurnSeq: fromSeq,
    _commitKind: 'NORMAL_HANDOFF',
  }
}

function lockAcquirePatch(fromId, fromSeq, owner) {
  return {
    kind: 'LOCK',
    turnLock: true,
    lockOwner: owner,
    lockTs: NOW,
    _expectTurnPlayerId: fromId,
    _expectTurnSeq: fromSeq,
    _commitKind: 'LOCK_ACQUIRE',
  }
}

function cycleFromSeats(players, steps, startIdx = 0) {
  const ordered = [...players].sort((a, b) => a.seat - b.seat)
  let idx = startIdx
  const ids = []
  for (let i = 0; i < steps; i++) {
    ids.push(String(ordered[idx].id))
    idx = findNextAliveIdx(ordered, idx)
  }
  return ids
}

function assertCyclePattern(ids, pattern) {
  for (let i = 0; i < ids.length; i++) {
    assert.equal(ids[i], pattern[i % pattern.length], `step ${i}`)
  }
}

describe('TESTE 1 — ordem 2 jogadores (UUID invertido)', () => {
  it('seat 0=A seat 1=B apesar de id A > id B', () => {
    const raw = [
      { id: 'zzzz', name: 'A', joined_at: '2026-01-01T10:00:00.000Z' },
      { id: 'aaaa', name: 'B', joined_at: '2026-01-01T10:00:01.000Z' },
    ]
    // Embaralha array de propósito
    const seats = assignSeatsByJoinOrder([raw[1], raw[0]])
    assert.equal(seats[0].id, 'zzzz')
    assert.equal(seats[0].seat, 0)
    assert.equal(seats[1].id, 'aaaa')
    assert.equal(seats[1].seat, 1)
    assertCyclePattern(cycleFromSeats(seats, 6), ['zzzz', 'aaaa'])
  })
})

describe('TESTE 2 — ordem 3 jogadores', () => {
  it('A→B→C por vários ciclos com UUIDs embaralhados', () => {
    const raw = [
      { id: 'm-ccc', name: 'C', joined_at: '2026-01-01T10:00:02.000Z' },
      { id: 'm-aaa', name: 'A', joined_at: '2026-01-01T10:00:00.000Z' },
      { id: 'm-bbb', name: 'B', joined_at: '2026-01-01T10:00:01.000Z' },
    ]
    const seats = assignSeatsByJoinOrder(raw)
    assert.deepEqual(
      seats.map((p) => p.name),
      ['A', 'B', 'C'],
    )
    assertCyclePattern(cycleFromSeats(seats, 9), ['m-aaa', 'm-bbb', 'm-ccc'])
  })
})

describe('TESTE 3 — ordem 4 jogadores × 20 ciclos', () => {
  it('A→B→C→D apesar de UUIDs D,B,A,C', () => {
    const raw = [
      { id: 'uuid-d', name: 'D', joined_at: '2026-01-01T10:00:03.000Z' },
      { id: 'uuid-b', name: 'B', joined_at: '2026-01-01T10:00:01.000Z' },
      { id: 'uuid-a', name: 'A', joined_at: '2026-01-01T10:00:00.000Z' },
      { id: 'uuid-c', name: 'C', joined_at: '2026-01-01T10:00:02.000Z' },
    ]
    const seats = assignSeatsByJoinOrder(raw)
    assert.deepEqual(
      seats.map((p) => [p.name, p.seat]),
      [
        ['A', 0],
        ['B', 1],
        ['C', 2],
        ['D', 3],
      ],
    )
    assertCyclePattern(cycleFromSeats(seats, 80), ['uuid-a', 'uuid-b', 'uuid-c', 'uuid-d'])
  })
})

describe('TESTE 4 — 100+ UUIDs aleatórios', () => {
  it('joined_at A<B<C<D sempre vence UUID', () => {
    for (let n = 0; n < 120; n++) {
      const ids = [randomUUID(), randomUUID(), randomUUID(), randomUUID()]
      const raw = [
        { id: ids[0], name: 'A', joined_at: '2026-06-01T12:00:00.000Z' },
        { id: ids[1], name: 'B', joined_at: '2026-06-01T12:00:01.000Z' },
        { id: ids[2], name: 'C', joined_at: '2026-06-01T12:00:02.000Z' },
        { id: ids[3], name: 'D', joined_at: '2026-06-01T12:00:03.000Z' },
      ]
      // Embaralha
      const shuffled = [...raw].sort(() => Math.random() - 0.5)
      const seats = assignSeatsByJoinOrder(shuffled)
      assert.deepEqual(
        seats.map((p) => p.name),
        ['A', 'B', 'C', 'D'],
        `iter ${n}`,
      )
      assertCyclePattern(cycleFromSeats(seats, 8), ids)
    }
  })
})

describe('TESTE 5 — jogador eliminado', () => {
  it('A→B→D pula C falido', () => {
    const seats = assignSeatsByJoinOrder([
      { id: 'a', name: 'A', joined_at: 't0' },
      { id: 'b', name: 'B', joined_at: 't1' },
      { id: 'c', name: 'C', joined_at: 't2' },
      { id: 'd', name: 'D', joined_at: 't3' },
    ]).map((p) => (p.id === 'c' ? { ...p, bankrupt: true } : { ...p, bankrupt: false }))
    assertCyclePattern(cycleFromSeats(seats, 9), ['a', 'b', 'd'])
  })
})

describe('TESTE 6 — ROLL × TIMER', () => {
  const players = [
    { id: 'a', name: 'A', bankrupt: false, pos: 0, cash: 100 },
    { id: 'b', name: 'B', bankrupt: false, pos: 0, cash: 100 },
  ]

  it('cenário A: LOCK vence → AUTO_PASS rejeitado', () => {
    let remote = {
      turnPlayerId: 'a',
      turnSeq: 10,
      turnLock: false,
      lockOwner: null,
      lastRollTurnKey: null,
      turnDeadlineAt: NOW - 1,
      gameOver: false,
      players: structuredClone(players),
    }
    const lock = applyGamePatchToState(remote, {
      statePatch: lockAcquirePatch('a', 10, 'a'),
    }, { now: NOW })
    assert.equal(lock.ok, true)
    remote = lock.state

    const pass = applyGamePatchToState(remote, {
      statePatch: autoPassPatch(players, 'a', 10),
    }, { now: NOW })
    assert.equal(pass.ok, false)
    assert.equal(pass.reason, 'turn-locked')
    assert.equal(remote.turnPlayerId, 'a')
    assert.equal(remote.turnSeq, 10)
  })

  it('cenário B: AUTO_PASS vence → PLAYER_DELTA de A rejeitado', () => {
    let remote = {
      turnPlayerId: 'a',
      turnSeq: 10,
      turnLock: false,
      lockOwner: null,
      lastRollTurnKey: null,
      turnDeadlineAt: NOW - 1,
      gameOver: false,
      players: structuredClone(players),
    }
    const pass = applyGamePatchToState(remote, {
      statePatch: autoPassPatch(players, 'a', 10),
    }, { now: NOW })
    assert.equal(pass.ok, true)
    remote = pass.state
    assert.equal(remote.turnPlayerId, 'b')
    assert.equal(remote.turnSeq, 11)

    const before = structuredClone(remote.players)
    const delta = applyGamePatchToState(remote, playerDeltaPatch({ fromId: 'a', fromSeq: 10, pos: 99 }), {
      now: NOW,
    })
    assert.equal(delta.ok, false)
    assert.match(delta.reason, /stale-turn/)
    assert.deepEqual(remote.players, before)
    assert.equal(remote.players.find((p) => p.id === 'a').pos, 0)
  })
})

describe('TESTE 7 — PLAYER_DELTA stale', () => {
  it('rejeita e não altera players', () => {
    const remote = {
      turnPlayerId: 'b',
      turnSeq: 11,
      gameOver: false,
      players: [
        { id: 'a', pos: 1, cash: 50 },
        { id: 'b', pos: 2, cash: 50 },
      ],
    }
    const before = structuredClone(remote.players)
    const r = applyGamePatchToState(remote, playerDeltaPatch({ fromId: 'a', fromSeq: 10, pos: 40, cash: 1 }))
    assert.equal(r.ok, false)
    assert.deepEqual(r.state.players, before)
  })
})

describe('TESTE 8 — PLAYER_DELTA válido', () => {
  it('aceita quando turno bate', () => {
    const remote = {
      turnPlayerId: 'a',
      turnSeq: 10,
      gameOver: false,
      players: [
        { id: 'a', pos: 1, cash: 50 },
        { id: 'b', pos: 2, cash: 50 },
      ],
    }
    const r = applyGamePatchToState(remote, playerDeltaPatch({ fromId: 'a', fromSeq: 10, pos: 7 }))
    assert.equal(r.ok, true)
    assert.equal(r.state.players.find((p) => p.id === 'a').pos, 7)
  })

  it('PLAYER_DELTA sem expect é rejeitado (não no-guard)', () => {
    const v = validateTurnCommit(
      { turnPlayerId: 'a', turnSeq: 10, gameOver: false, players: [{ id: 'a' }] },
      { kind: 'PLAYER_DELTA', lastRollTurnKey: '10' },
    )
    assert.equal(v.ok, false)
    assert.equal(v.reason, 'player-delta-missing-expect')
    assert.equal(inferCommitKind({ kind: 'PLAYER_DELTA' }), 'PLAYER_DELTA')
  })
})

describe('TESTE 9 — duplo AUTO_PASS', () => {
  it('só um avança A/10 → B/11', () => {
    const players = [
      { id: 'a', bankrupt: false },
      { id: 'b', bankrupt: false },
      { id: 'c', bankrupt: false },
    ]
    let remote = {
      turnPlayerId: 'a',
      turnSeq: 10,
      turnLock: false,
      lastRollTurnKey: null,
      turnDeadlineAt: NOW - 1,
      gameOver: false,
      players,
    }
    const p1 = applyGamePatchToState(remote, { statePatch: autoPassPatch(players, 'a', 10) }, { now: NOW })
    assert.equal(p1.ok, true)
    remote = p1.state
    const p2 = applyGamePatchToState(remote, { statePatch: autoPassPatch(players, 'a', 10) }, { now: NOW })
    assert.equal(p2.ok, false)
    assert.equal(remote.turnPlayerId, 'b')
    assert.equal(remote.turnSeq, 11)
  })
})

describe('TESTE 10 — handoff duplicado', () => {
  it('apenas um NORMAL_HANDOFF aceito', () => {
    const players = [
      { id: 'a', bankrupt: false },
      { id: 'b', bankrupt: false },
    ]
    let remote = {
      turnPlayerId: 'a',
      turnSeq: 5,
      gameOver: false,
      players,
    }
    const h1 = applyGamePatchToState(remote, { statePatch: handoffPatch(players, 'a', 5) })
    assert.equal(h1.ok, true)
    remote = h1.state
    const h2 = applyGamePatchToState(remote, { statePatch: handoffPatch(players, 'a', 5) })
    assert.equal(h2.ok, false)
    assert.equal(remote.turnSeq, 6)
    assert.equal(remote.turnPlayerId, 'b')
  })
})

describe('TESTE 11 — LOCK stale', () => {
  it('LOCK de A/10 não aplica em B/11', () => {
    const remote = {
      turnPlayerId: 'b',
      turnSeq: 11,
      turnLock: false,
      lockOwner: null,
      gameOver: false,
      players: [{ id: 'a' }, { id: 'b' }],
    }
    const r = applyGamePatchToState(remote, {
      statePatch: lockAcquirePatch('a', 10, 'a'),
    })
    assert.equal(r.ok, false)
    assert.match(r.reason, /stale-turn/)
    assert.equal(r.state.turnLock, false)
  })
})

describe('TESTE 12 — aba stale (turnSeq antigo)', () => {
  it('handoff/lock/delta da aba antiga não regridem', () => {
    const players = [
      { id: 'a', bankrupt: false, pos: 3 },
      { id: 'b', bankrupt: false, pos: 4 },
    ]
    const remote = {
      turnPlayerId: 'b',
      turnSeq: 21,
      turnLock: true,
      lockOwner: 'b',
      gameOver: false,
      players: structuredClone(players),
    }
    assert.equal(
      applyGamePatchToState(remote, { statePatch: handoffPatch(players, 'a', 20) }).ok,
      false,
    )
    assert.equal(
      applyGamePatchToState(remote, { statePatch: lockAcquirePatch('a', 20, 'a') }).ok,
      false,
    )
    assert.equal(
      applyGamePatchToState(remote, playerDeltaPatch({ fromId: 'a', fromSeq: 20, pos: 99 })).ok,
      false,
    )
    assert.equal(remote.turnSeq, 21)
    assert.equal(remote.turnPlayerId, 'b')
    assert.equal(remote.players.find((p) => p.id === 'a').pos, 3)
  })
})

describe('TESTE 13 — reconexão / snapshot', () => {
  it('snapshot autoritativo não reordena seats nem regrede seq', () => {
    const seats = assignSeatsByJoinOrder([
      { id: 'z', joined_at: 't0' },
      { id: 'a', joined_at: 't1' },
    ])
    const remote = {
      turnPlayerId: 'a',
      turnSeq: 14,
      players: seats,
      matchId: 'm1',
    }
    // Cliente B reconecta: deve aceitar remoto mais novo, seats intactos
    const gate = shouldApplyRemoteRoomRow({
      localVersion: 3,
      incomingVersion: 9,
      localState: { turnSeq: 10, turnPlayerId: 'z', players: seats },
      incomingState: remote,
    })
    assert.equal(gate.apply, true)
    assert.deepEqual(
      remote.players.map((p) => p.seat),
      [0, 1],
    )
    assert.equal(remote.players[0].id, 'z')
  })
})

describe('TESTE 14 — presença não altera rotação', () => {
  it('last_seen atrasado não entra na ordem de seats nem no ciclo', () => {
    const seats = assignSeatsByJoinOrder([
      { id: 'a', joined_at: 't0', last_seen: '2020-01-01' },
      { id: 'b', joined_at: 't1', last_seen: '2099-01-01' },
      { id: 'c', joined_at: 't2', last_seen: null },
    ])
    assertCyclePattern(cycleFromSeats(seats, 6), ['a', 'b', 'c'])
  })
})

describe('TESTE 15 — solo 1 jogador', () => {
  it('ciclo permanece no único jogador (sem auto-skip lógico de inexistente)', () => {
    const seats = assignSeatsByJoinOrder([{ id: 'solo', joined_at: 't0' }])
    assertCyclePattern(cycleFromSeats(seats, 5), ['solo'])
  })
})

describe('TESTE 16 — 2 jogadores × 50 trocas', () => {
  it('A B A B…', () => {
    const seats = assignSeatsByJoinOrder([
      { id: 'A', joined_at: 't0' },
      { id: 'B', joined_at: 't1' },
    ])
    assertCyclePattern(cycleFromSeats(seats, 50), ['A', 'B'])
  })
})

describe('TESTE 17 — 3 jogadores × 50 trocas', () => {
  it('A B C…', () => {
    const seats = assignSeatsByJoinOrder([
      { id: 'A', joined_at: 't0' },
      { id: 'B', joined_at: 't1' },
      { id: 'C', joined_at: 't2' },
    ])
    assertCyclePattern(cycleFromSeats(seats, 50), ['A', 'B', 'C'])
  })
})

describe('TESTE 18 — 4 jogadores × 100 trocas', () => {
  it('A B C D…', () => {
    const seats = assignSeatsByJoinOrder([
      { id: 'A', joined_at: 't0' },
      { id: 'B', joined_at: 't1' },
      { id: 'C', joined_at: 't2' },
      { id: 'D', joined_at: 't3' },
    ])
    assertCyclePattern(cycleFromSeats(seats, 100), ['A', 'B', 'C', 'D'])
  })
})

describe('TESTE 19 — latência artificial (ordem de commits)', () => {
  it('commits com delays relativos permanecem monotônicos', async () => {
    const players = [
      { id: 'a', bankrupt: false, pos: 0 },
      { id: 'b', bankrupt: false, pos: 0 },
      { id: 'c', bankrupt: false, pos: 0 },
      { id: 'd', bankrupt: false, pos: 0 },
    ]
    let remote = {
      turnPlayerId: 'a',
      turnSeq: 0,
      turnLock: false,
      lastRollTurnKey: null,
      turnDeadlineAt: NOW + 60_000,
      gameOver: false,
      players: structuredClone(players),
    }

    const delays = { a: 20, b: 150, c: 400, d: 800 }
    const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

    async function clientMove(id, seq, delayMs) {
      await sleep(delayMs)
      const locked = applyGamePatchToState(remote, {
        statePatch: lockAcquirePatch(id, seq, id),
      }, { now: NOW })
      if (!locked.ok) return locked
      remote = locked.state
      const moved = applyGamePatchToState(
        remote,
        playerDeltaPatch({ fromId: id, fromSeq: seq, pos: seq + 1 }),
        { now: NOW },
      )
      if (!moved.ok) return moved
      remote = moved.state
      const hand = applyGamePatchToState(remote, { statePatch: handoffPatch(players, id, seq) }, { now: NOW })
      if (hand.ok) remote = hand.state
      return hand
    }

    // Sequência autoritativa A→B→C→D com latências diferentes por cliente
    const r0 = await clientMove('a', 0, delays.a)
    assert.equal(r0.ok, true)
    const r1 = await clientMove('b', 1, delays.b)
    assert.equal(r1.ok, true)
    const r2 = await clientMove('c', 2, delays.c)
    assert.equal(r2.ok, true)
    const r3 = await clientMove('d', 3, delays.d)
    assert.equal(r3.ok, true)
    assert.equal(remote.turnSeq, 4)
    assert.equal(remote.turnPlayerId, 'a')

    // Stale de A/0 chega tarde
    const late = applyGamePatchToState(remote, playerDeltaPatch({ fromId: 'a', fromSeq: 0, pos: 999 }))
    assert.equal(late.ok, false)
  })
})

describe('TESTE 20 — eventos fora de ordem (versão)', () => {
  it('após seq 32, snapshot 31 não regride', () => {
    const g32 = shouldApplyRemoteRoomRow({
      localVersion: 32,
      incomingVersion: 31,
      localState: { turnSeq: 32, turnPlayerId: 'a' },
      incomingState: { turnSeq: 31, turnPlayerId: 'a' },
    })
    assert.equal(g32.apply, false)
  })
})

describe('Invariantes / propriedade', () => {
  it('turnSeq monotônico + um dono por seq + sem skip em ciclo', () => {
    const players = assignSeatsByJoinOrder([
      { id: 'A', joined_at: 't0' },
      { id: 'B', joined_at: 't1' },
      { id: 'C', joined_at: 't2' },
      { id: 'D', joined_at: 't3' },
    ]).map((p) => ({ ...p, bankrupt: false }))

    let remote = {
      turnPlayerId: 'A',
      turnSeq: 0,
      turnLock: false,
      lastRollTurnKey: null,
      turnDeadlineAt: NOW + 999999,
      gameOver: false,
      players,
    }

    const ownersBySeq = new Map()
    ownersBySeq.set(0, 'A')

    for (let step = 0; step < 40; step++) {
      const curId = remote.turnPlayerId
      const curSeq = remote.turnSeq
      const moved = applyGamePatchToState(
        remote,
        playerDeltaPatch({ fromId: curId, fromSeq: curSeq, pos: step + 1 }),
      )
      assert.equal(moved.ok, true)
      remote = moved.state
      const hand = applyGamePatchToState(remote, { statePatch: handoffPatch(players, curId, curSeq) })
      assert.equal(hand.ok, true)
      remote = hand.state
      assert.ok(remote.turnSeq > curSeq)
      assert.equal(remote.turnSeq, curSeq + 1)
      const prevOwner = ownersBySeq.get(remote.turnSeq)
      if (prevOwner != null) assert.equal(prevOwner, remote.turnPlayerId)
      ownersBySeq.set(remote.turnSeq, remote.turnPlayerId)
      // Nunca dois turnos seguidos (4 vivos)
      assert.notEqual(remote.turnPlayerId, curId)
    }

    // Ciclo completo: cada elegível aparece
    const window = []
    let idx = players.findIndex((p) => p.id === 'A')
    for (let i = 0; i < 4; i++) {
      window.push(players[idx].id)
      idx = findNextAliveIdx(players, idx)
    }
    assert.deepEqual(window.sort(), ['A', 'B', 'C', 'D'])
  })
})

describe('Integrado 4 clientes (cópias locais + commits no remoto)', () => {
  it('converge turnPlayerId/turnSeq/seats após rodada', () => {
    const seats = assignSeatsByJoinOrder([
      { id: 'A', joined_at: 't0' },
      { id: 'B', joined_at: 't1' },
      { id: 'C', joined_at: 't2' },
      { id: 'D', joined_at: 't3' },
    ]).map((p) => ({ ...p, bankrupt: false, pos: 0 }))

    let remote = {
      turnPlayerId: 'A',
      turnSeq: 0,
      turnLock: false,
      gameOver: false,
      players: structuredClone(seats),
    }
    const clients = {
      A: structuredClone(remote),
      B: structuredClone(remote),
      C: structuredClone(remote),
      D: structuredClone(remote),
    }

    function syncAll() {
      for (const k of Object.keys(clients)) clients[k] = structuredClone(remote)
    }

    for (const id of ['A', 'B', 'C', 'D']) {
      const seq = remote.turnSeq
      assert.equal(remote.turnPlayerId, id)
      const r = applyGamePatchToState(remote, playerDeltaPatch({ fromId: id, fromSeq: seq, pos: 1 }))
      assert.equal(r.ok, true)
      remote = r.state
      const h = applyGamePatchToState(remote, { statePatch: handoffPatch(seats, id, seq) })
      assert.equal(h.ok, true)
      remote = h.state
      syncAll()
    }

    for (const k of Object.keys(clients)) {
      assert.equal(clients[k].turnPlayerId, remote.turnPlayerId)
      assert.equal(clients[k].turnSeq, remote.turnSeq)
      assert.deepEqual(
        clients[k].players.map((p) => [p.id, p.seat]),
        remote.players.map((p) => [p.id, p.seat]),
      )
    }
    assert.equal(remote.turnPlayerId, 'A')
    assert.equal(remote.turnSeq, 4)
  })
})

describe('Lobby payload preserva joined_at', () => {
  it('normalizeLobbyPlayersForStart + sort sem UUID', () => {
    const rows = [
      { player_id: 'zzzz', player_name: 'A', joined_at: '2026-01-01T10:00:00Z' },
      { player_id: 'aaaa', player_name: 'B', joined_at: '2026-01-01T10:00:01Z' },
    ]
    const payload = normalizeLobbyPlayersForStart(rows)
    assert.ok(payload[0].joined_at)
    const sorted = sortLobbyPlayersForSeats([{ ...payload[1] }, { ...payload[0] }])
    assert.equal(sorted[0].id, 'zzzz')
  })
})

describe('ensurePlayerDeltaCommitMeta', () => {
  it('injeta expects a partir de lastRoll / turn refs', () => {
    const patch = ensurePlayerDeltaCommitMeta(
      { kind: 'PLAYER_DELTA', lastRollTurnKey: '10', lastRoll: { playerId: 'a' } },
      { turnPlayerId: 'b', turnSeq: 99 },
    )
    assert.equal(patch._commitKind, 'PLAYER_DELTA')
    assert.equal(patch._expectTurnPlayerId, 'a')
    assert.equal(patch._expectTurnSeq, 10)
  })
})
