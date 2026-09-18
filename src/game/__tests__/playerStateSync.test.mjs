/**
 * Robustez identidade + merge cash/players (node:test).
 * Executar: node --test src/game/__tests__/playerStateSync.test.mjs
 */
import { describe, it, beforeEach } from 'node:test'
import assert from 'node:assert/strict'
import {
  mergePlayerPartial,
  mergePlayersById,
  buildPartialPlayerDelta,
  buildPlayersDeltaById,
  resolveSeatIdentity,
  resolveMyCash,
  planRosterApply,
  mergeRosterPreserveMissing,
  shouldApplyIncomingState,
  applyGamePatchToState,
  isValidCashPatchValue,
  isAuthoritativeStartState,
} from '../playerStateSync.js'
import {
  __resetSharedTurnSkipGuardForTests,
  wasAlreadySkipped,
  markSharedSkipKey,
} from '../sharedTurnSkipGuard.js'
import { shouldAttemptTimerAutoPass } from '../turnTimerLogic.js'
import { mergeLobbyMatchSettings } from '../turnTimerLogic.js'

beforeEach(() => {
  __resetSharedTurnSkipGuardForTests()
})

describe('IDENTIDADE', () => {
  it('1. myUid válido encontra o player correto', () => {
    const roster = [
      { id: 'a', cash: 1000 },
      { id: 'b', cash: 12000 },
    ]
    const seat = resolveSeatIdentity({
      identityPlayerId: 'b',
      roster,
      currentMyUid: 'x',
    })
    assert.equal(seat.ok, true)
    assert.equal(seat.myUid, 'b')
    const cash = resolveMyCash({ myUid: seat.myUid, players: roster })
    assert.equal(cash.found, true)
    assert.equal(cash.cash, 12000)
  })

  it('2. identidade válida após refresh mantém o mesmo player', () => {
    const identityPlayerId = 'seat-uuid-1'
    const roster = [{ id: 'seat-uuid-1', name: 'Ana', cash: 9000 }]
    const before = resolveSeatIdentity({ identityPlayerId, roster })
    const afterRefresh = resolveSeatIdentity({
      identityPlayerId, // mesmo localStorage
      roster,
      currentMyUid: 'tab-other-uuid',
    })
    assert.equal(before.myUid, afterRefresh.myUid)
    assert.equal(afterRefresh.myUid, 'seat-uuid-1')
  })

  it('3. identidade inexistente NÃO produz player novo nem sobrescreve state', () => {
    const roster = [{ id: 'a', cash: 5000 }]
    const seat = resolveSeatIdentity({
      identityPlayerId: 'ghost',
      roster,
      currentMyUid: 'a',
    })
    assert.equal(seat.ok, false)
    assert.equal(seat.reason, 'identity-not-in-roster')
    const merged = mergePlayersById(roster, { ghost: { cash: 1 } }, { createMissing: false })
    assert.equal(merged.length, 1)
    assert.equal(merged[0].id, 'a')
    assert.equal(merged[0].cash, 5000)
  })
})

describe('CASH / MERGE', () => {
  it('4. cash ausente no delta preserva cash', () => {
    const merged = mergePlayerPartial({ id: 'a', cash: 12000, pos: 3 }, { pos: 4 })
    assert.equal(merged.cash, 12000)
    assert.equal(merged.pos, 4)
  })

  it('5. cash undefined preserva cash', () => {
    const merged = mergePlayerPartial({ id: 'a', cash: 12000 }, { cash: undefined, pos: 1 })
    assert.equal(merged.cash, 12000)
  })

  it('6. cash null preserva cash', () => {
    assert.equal(isValidCashPatchValue(null), false)
    const merged = mergePlayerPartial({ id: 'a', cash: 12000 }, { cash: null })
    assert.equal(merged.cash, 12000)
  })

  it('7. cash menor legítimo é aceito', () => {
    const merged = mergePlayerPartial({ id: 'a', cash: 12000 }, { cash: 8000 })
    assert.equal(merged.cash, 8000)
  })

  it('8. cash maior legítimo é aceito', () => {
    const merged = mergePlayerPartial({ id: 'a', cash: 8000 }, { cash: 15000 })
    assert.equal(merged.cash, 15000)
  })

  it('9. patch de outro campo não altera cash', () => {
    const merged = mergePlayerPartial(
      { id: 'a', cash: 12000, ready: false },
      { ready: true, pos: 9 }
    )
    assert.equal(merged.cash, 12000)
    assert.equal(merged.ready, true)
    assert.equal(merged.pos, 9)
  })

  it('10. player parcial não remove campos existentes', () => {
    const merged = mergePlayerPartial(
      { id: 'a', cash: 12000, bens: 4000, clients: 2 },
      { clients: 3 }
    )
    assert.equal(merged.bens, 4000)
    assert.equal(merged.cash, 12000)
    assert.equal(merged.clients, 3)
  })

  it('10b. bankrupt sticky: delta false não ressuscita falido', () => {
    const merged = mergePlayerPartial(
      { id: 'a', cash: 0, bankrupt: true },
      { bankrupt: false, cash: 12000 }
    )
    assert.equal(merged.bankrupt, true)
    assert.equal(merged.cash, 12000)
  })

  it('10c. snapshot atrasado não ressuscita falido durante a troca de turno', () => {
    const localLiveRoster = [
      { id: 'arthur', cash: 0, bankrupt: true, pos: 8 },
      { id: 'teste-1', cash: 12000, bankrupt: false, pos: 3 },
      { id: 'teste-2', cash: 12000, bankrupt: false, pos: 1 },
    ]
    const staleRoomSnapshot = [
      { id: 'arthur', cash: 500, bankrupt: false, pos: 8 },
      { id: 'teste-1', cash: 12000, bankrupt: false, pos: 3 },
      { id: 'teste-2', cash: 12000, bankrupt: false, pos: 1 },
    ]

    const plan = planRosterApply({
      incomingPlayers: staleRoomSnapshot,
      currentPlayers: localLiveRoster,
      hydrated: true,
      isStart: false,
    })

    const arthur = plan.players.find((player) => player.id === 'arthur')
    assert.equal(plan.action, 'merge')
    assert.equal(arthur.bankrupt, true)
  })

  it('11. roster parcial não zera jogadores ausentes', () => {
    const current = [
      { id: 'a', cash: 1000 },
      { id: 'b', cash: 2000 },
      { id: 'c', cash: 3000 },
    ]
    const incoming = [{ id: 'b', cash: 2500 }]
    const plan = planRosterApply({
      incomingPlayers: incoming,
      currentPlayers: current,
      hydrated: true,
      isStart: false,
    })
    assert.equal(plan.action, 'merge')
    assert.equal(plan.players.length, 3)
    assert.equal(plan.players.find((p) => p.id === 'a').cash, 1000)
    assert.equal(plan.players.find((p) => p.id === 'b').cash, 2500)
    assert.equal(plan.players.find((p) => p.id === 'c').cash, 3000)
  })
})

describe('SNAPSHOT / VERSÃO', () => {
  it('12. snapshot stale não vence state mais novo', () => {
    const gate = shouldApplyIncomingState({
      isStart: false,
      incomingVersion: 3,
      lastAppliedVersion: 5,
      incomingStateId: 'fresh-id',
      lastAppliedStateId: 'old-id',
    })
    assert.equal(gate.apply, false)
    assert.equal(gate.reason, 'stale-version')
  })

  it('13. players: [] não apaga roster válido após hydrate', () => {
    const plan = planRosterApply({
      incomingPlayers: [],
      currentPlayers: [{ id: 'a', cash: 1 }],
      hydrated: true,
      isStart: false,
    })
    assert.equal(plan.action, 'skip')
    assert.equal(plan.reason, 'empty-wipe-blocked')
  })
})

describe('BASELINE / STALE PATCH', () => {
  it('14. playersBeforeRef é atualizado após commit (simulado)', () => {
    let playersBeforeRef = [{ id: 'a', cash: 12000, pos: 0 }]
    const next = [{ id: 'a', cash: 11000, pos: 2 }]
    const delta = buildPlayersDeltaById(playersBeforeRef, next, 'act-1')
    const applied = applyGamePatchToState(
      { players: playersBeforeRef, turnSeq: 1, turnPlayerId: 'a' },
      {
        playersDeltaById: delta,
        statePatch: {
          kind: 'PLAYER_DELTA',
          _expectTurnPlayerId: 'a',
          _expectTurnSeq: 1,
        },
      }
    )
    assert.equal(applied.ok, true)
    playersBeforeRef = applied.state.players
    assert.equal(playersBeforeRef[0].cash, 11000)
    assert.equal(playersBeforeRef[0].pos, 2)
  })

  it('15. dois patches consecutivos não reenviam cash antigo', () => {
    let baseline = [{ id: 'a', cash: 12000, pos: 0 }]
    const afterSpend = [{ id: 'a', cash: 10000, pos: 0 }]
    const d1 = buildPlayersDeltaById(baseline, afterSpend, 'a1')
    assert.equal(d1.a.cash, 10000)
    baseline = afterSpend

    const afterMove = [{ id: 'a', cash: 10000, pos: 5 }]
    const d2 = buildPlayersDeltaById(baseline, afterMove, 'a2')
    assert.equal(Object.prototype.hasOwnProperty.call(d2.a, 'cash'), false)
    assert.equal(d2.a.pos, 5)
  })

  it('16. CAS conflict/retry não reaplica player stale completo', () => {
    const remote = {
      players: [{ id: 'a', cash: 12000, pos: 3 }],
      turnPlayerId: 'a',
      turnSeq: 2,
    }
    // Local stale tenta mandar cash 0 + pos (full player) — merge parcial preserva 12000 se cash omitido;
    // se cash 0 explícito, aceita (legítimo). Aqui o bug era cash undefined no full replace:
    const staleFull = { id: 'a', cash: undefined, pos: 4, name: 'A' }
    const merged = mergePlayerPartial(remote.players[0], staleFull)
    assert.equal(merged.cash, 12000)
    assert.equal(merged.pos, 4)

    const retry = applyGamePatchToState(remote, {
      playersDeltaById: { a: { pos: 4 } },
      statePatch: {
        kind: 'PLAYER_DELTA',
        _expectTurnPlayerId: 'a',
        _expectTurnSeq: 2,
      },
    })
    assert.equal(retry.ok, true)
    assert.equal(retry.state.players[0].cash, 12000)
  })

  it('17. rooms 12000 + local stale 0 + patch não relacionado → continua 12000', () => {
    const roomsState = {
      players: [
        { id: 'a', cash: 12000, pos: 1 },
        { id: 'b', cash: 8000, pos: 2 },
      ],
      turnSeq: 4,
      turnPlayerId: 'a',
    }
    // Patch só de turno / pos de outro fluxo sem cash
    const result = applyGamePatchToState(roomsState, {
      playersDeltaById: {
        a: { pos: 2 }, // sem cash
      },
      statePatch: {
        kind: 'PLAYER_DELTA',
        _expectTurnPlayerId: 'a',
        _expectTurnSeq: 4,
      },
    })
    assert.equal(result.ok, true)
    assert.equal(result.state.players.find((p) => p.id === 'a').cash, 12000)
  })

  it('18. topbar: identidade correta + cash 12000 → myCash 12000', () => {
    const players = [
      { id: 'me', cash: 12000 },
      { id: 'other', cash: 500 },
    ]
    const seat = resolveSeatIdentity({
      identityPlayerId: 'me',
      roster: players,
    })
    assert.equal(seat.ok, true)
    const cash = resolveMyCash({ myUid: seat.myUid, players })
    assert.equal(cash.found, true)
    assert.equal(cash.cash, 12000)
    assert.notEqual(cash.cash, 0)
  })

  it('18b. LOCK no início da partida não é START', () => {
    const players = [
      { id: 'a', pos: 0 },
      { id: 'b', pos: 0 },
    ]
    assert.equal(
      isAuthoritativeStartState({
        kind: 'LOCK',
        round: 1,
        players,
        turnLock: true,
      }),
      false
    )
    assert.equal(
      isAuthoritativeStartState({ kind: 'START', round: 1, players }),
      true
    )
    assert.equal(
      isAuthoritativeStartState({ round: 1, players, gameOver: false }),
      true
    )
  })
})

describe('SKIP / HOST CONFIG', () => {
  it('19. auto-skip/timer continuam passando', () => {
    markSharedSkipKey('a', 1)
    assert.equal(wasAlreadySkipped('a', 1), true)
    const decision = shouldAttemptTimerAutoPass({
      now: 999,
      turnDeadlineAt: 1,
      turnLock: false,
      gameOver: false,
      amCoordinator: true,
      turnPlayerId: 'a',
      turnSeq: 1,
      lastAttemptKey: 'a|1',
      inFlight: false,
    })
    assert.equal(decision.ok, false)
    assert.equal(decision.reason, 'already-attempted')

    const ok = shouldAttemptTimerAutoPass({
      now: 999,
      turnDeadlineAt: 1,
      turnLock: false,
      gameOver: false,
      amCoordinator: true,
      turnPlayerId: 'b',
      turnSeq: 2,
      lastAttemptKey: null,
      inFlight: false,
    })
    assert.equal(ok.ok, true)
  })

  it('20. host migration continua passando (config preservada)', () => {
    const before = mergeLobbyMatchSettings(
      { maxRounds: 3, turnTimeSec: 120, players: [{ id: '1' }], kind: 'TURN' },
      { maxRounds: 3, turnTimeSec: 120 }
    )
    assert.equal(before.maxRounds, 3)
    assert.equal(before.turnTimeSec, 120)
    assert.equal(before.players.length, 1)
  })
})

describe('helpers extras', () => {
  it('buildPartialPlayerDelta omite cash igual', () => {
    const d = buildPartialPlayerDelta({ cash: 10, pos: 1 }, { cash: 10, pos: 2 })
    assert.equal(Object.prototype.hasOwnProperty.call(d, 'cash'), false)
    assert.equal(d.pos, 2)
  })

  it('mergeRosterPreserveMissing', () => {
    const m = mergeRosterPreserveMissing(
      [{ id: 'a', cash: 1 }, { id: 'b', cash: 2 }],
      [{ id: 'a', pos: 9 }]
    )
    assert.equal(m.find((p) => p.id === 'a').cash, 1)
    assert.equal(m.find((p) => p.id === 'a').pos, 9)
    assert.equal(m.find((p) => p.id === 'b').cash, 2)
  })

  it('merge cash + loanPending entre clientes (2–3 players)', () => {
    const local = [
      { id: 'a', cash: 10000, loanPending: null, loanTakenInMatch: false },
      { id: 'b', cash: 8000, loanPending: null },
    ]
    const remoteDelta = {
      a: {
        cash: 12000,
        loanTakenInMatch: true,
        loanPending: {
          amount: 2000,
          waitingFullLap: true,
          eligibleOnExpenses: false,
          charged: false,
        },
      },
      b: { cash: 7500 },
    }
    const merged = mergePlayersById(local, remoteDelta, { createMissing: false })
    const a = merged.find((p) => p.id === 'a')
    const b = merged.find((p) => p.id === 'b')
    assert.equal(a.cash, 12000)
    assert.equal(a.loanTakenInMatch, true)
    assert.equal(a.loanPending.amount, 2000)
    assert.equal(b.cash, 7500)
  })

  it('START replace permitido', () => {
    const plan = planRosterApply({
      incomingPlayers: [{ id: 'a', cash: 18000 }],
      currentPlayers: [{ id: 'old', cash: 1 }],
      hydrated: true,
      isStart: true,
    })
    assert.equal(plan.action, 'replace')
  })
})
