/**
 * Regressão: corridas entre timer, handoff normal e LOCK.
 * Executar: node --test src/game/__tests__/turnCommitRace.test.mjs
 */
import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { planOfflineTurnSkip } from '../offlineTurnSkip.js'
import { applyGamePatchToState } from '../playerStateSync.js'
import {
  validateTurnCommit,
  shouldProceedTimerAutoPassAfterAwait,
  resolveSkipGuardAction,
} from '../turnCommitValidation.js'
import { shouldAttemptTimerAutoPass } from '../turnTimerLogic.js'
import {
  __resetSharedTurnSkipGuardForTests,
  wasAlreadySkipped,
  markPendingSharedSkipKey,
  releaseSharedSkipKey,
} from '../sharedTurnSkipGuard.js'
import {
  shouldApplyRemoteRoomRow,
  shouldApplyDeferredLocalPatch,
  captureTurnEmissionSnapshot,
  isHandoffPendingObsolete,
} from '../turnStateMonotonic.js'

const NOW = 2_000_000

function playersABCD() {
  return [
    { id: 'a', name: 'A', bankrupt: false },
    { id: 'b', name: 'B', bankrupt: false },
    { id: 'c', name: 'C', bankrupt: false },
    { id: 'd', name: 'D', bankrupt: false },
  ]
}

function remoteBase(overrides = {}) {
  return {
    turnPlayerId: 'b',
    turnSeq: 7,
    turnLock: false,
    lockOwner: null,
    lastRollTurnKey: null,
    turnDeadlineAt: NOW - 1,
    gameOver: false,
    players: playersABCD(),
    ...overrides,
  }
}

function autoPassPatch(fromId, fromSeq) {
  const plan = planOfflineTurnSkip({
    players: playersABCD(),
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
    lockOwner: null,
    lastRollTurnKey: null,
    lastAction: 'AUTO_PASS_TIMER',
    _expectTurnPlayerId: fromId,
    _expectTurnSeq: fromSeq,
    _commitKind: 'AUTO_PASS',
  }
}

function normalHandoffPatch(fromId, fromSeq) {
  const plan = planOfflineTurnSkip({
    players: playersABCD(),
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
    lockOwner: null,
    lastRollTurnKey: null,
    _expectTurnPlayerId: fromId,
    _expectTurnSeq: fromSeq,
    _commitKind: 'NORMAL_HANDOFF',
  }
}

describe('quatro vivos — alternância planejada', () => {
  it('A → B → C → D → A', () => {
    const roster = playersABCD()
    let id = 'a'
    let seq = 0
    const order = []
    for (let i = 0; i < 4; i++) {
      const plan = planOfflineTurnSkip({
        players: roster,
        turnPlayerId: id,
        turnSeq: seq,
        round: 1,
        maxRounds: 5,
      })
      assert.ok(plan)
      order.push(plan.nextTurnPlayerId)
      id = plan.nextTurnPlayerId
      seq = plan.nextTurnSeq
    }
    assert.deepEqual(order, ['b', 'c', 'd', 'a'])
  })
})

describe('auto-pass vs ação real', () => {
  it('timer B/7 recusado com lock+ROLL ativo', () => {
    const remote = remoteBase({
      turnLock: true,
      lockOwner: 'b',
      lastRollTurnKey: '7',
    })
    const patch = autoPassPatch('b', 7)
    const v = validateTurnCommit(remote, patch, { now: NOW })
    assert.equal(v.ok, false)
    assert.match(String(v.reason), /turn-locked/)

    const applied = applyGamePatchToState(remote, { statePatch: patch }, { now: NOW })
    assert.equal(applied.ok, false)
    assert.equal(applied.state.turnPlayerId, 'b')
    assert.equal(applied.state.turnSeq, 7)
  })

  it('timer recusado com prazo remoto no futuro', () => {
    const remote = remoteBase({ turnDeadlineAt: NOW + 60_000 })
    const patch = autoPassPatch('b', 7)
    const v = validateTurnCommit(remote, patch, { now: NOW })
    assert.equal(v.ok, false)
    assert.equal(v.reason, 'not-expired')
  })

  it('handoff normal aceito com lock próprio e rolagem', () => {
    const remote = remoteBase({
      turnLock: true,
      lockOwner: 'b',
      lastRollTurnKey: '7',
    })
    const patch = normalHandoffPatch('b', 7)
    const v = validateTurnCommit(remote, patch, { now: NOW })
    assert.equal(v.ok, true)
    assert.equal(v.reason, 'normal-handoff-ok')
  })
})

describe('LOCK atrasado', () => {
  it('liberação antiga de B/7 não limpa lock de C/8', () => {
    const remote = remoteBase({
      turnPlayerId: 'c',
      turnSeq: 8,
      turnLock: true,
      lockOwner: 'c',
    })
    const patch = {
      kind: 'LOCK',
      turnLock: false,
      lockOwner: null,
      _expectTurnPlayerId: 'b',
      _expectTurnSeq: 7,
      _expectLockOwner: 'b',
      _commitKind: 'LOCK_RELEASE',
    }
    const v = validateTurnCommit(remote, patch, { now: NOW })
    assert.equal(v.ok, false)
    assert.equal(v.reason, 'stale-turn-player')
  })

  it('liberação legítima do mesmo turno/dono', () => {
    const remote = remoteBase({
      turnLock: true,
      lockOwner: 'b',
    })
    const patch = {
      kind: 'LOCK',
      turnLock: false,
      lockOwner: null,
      _expectTurnPlayerId: 'b',
      _expectTurnSeq: 7,
      _expectLockOwner: 'b',
      _commitKind: 'LOCK_RELEASE',
    }
    const v = validateTurnCommit(remote, patch, { now: NOW })
    assert.equal(v.ok, true)
  })

  it('LOCK_RELEASE com expectLockOwner null não apaga lock remoto ativo', () => {
    const remote = remoteBase({ turnLock: true, lockOwner: 'b' })
    const patch = {
      kind: 'LOCK',
      turnLock: false,
      lockOwner: null,
      _expectTurnPlayerId: 'b',
      _expectTurnSeq: 7,
      _expectLockOwner: null,
      _commitKind: 'LOCK_RELEASE',
    }
    const v = validateTurnCommit(remote, patch, { now: NOW })
    assert.equal(v.ok, false)
    assert.equal(v.reason, 'lock-owner-unknown')
  })

  it('sequência: lock release rejeitado mantém B/7 protegido contra auto-pass', () => {
    const state = remoteBase({ turnLock: true, lockOwner: 'b' })
    const lockRel = {
      kind: 'LOCK',
      turnLock: false,
      _expectTurnPlayerId: 'b',
      _expectTurnSeq: 7,
      _expectLockOwner: null,
      _commitKind: 'LOCK_RELEASE',
    }
    const lockResult = applyGamePatchToState(state, { statePatch: lockRel })
    assert.equal(lockResult.ok, false)
    assert.equal(lockResult.state.turnLock, true)
    const passResult = applyGamePatchToState(
      lockResult.state,
      { statePatch: autoPassPatch('b', 7) },
      { now: NOW },
    )
    assert.equal(passResult.ok, false)
    assert.equal(passResult.state.turnPlayerId, 'b')
  })
})

describe('handoff normal atrasado', () => {
  it('TURN atrasado para C/8 sobre remoto D/9 é recusado', () => {
    const remote = remoteBase({
      turnPlayerId: 'd',
      turnSeq: 9,
    })
    const patch = normalHandoffPatch('b', 7)
    const v = validateTurnCommit(remote, patch, { now: NOW })
    assert.equal(v.ok, false)
    assert.match(v.reason, /stale-turn/)
  })
})

describe('timer hook — pós-await', () => {
  it('prazo renovado durante segunda consulta bloqueia skip', () => {
    const proceed = shouldProceedTimerAutoPassAfterAwait({
      now: NOW,
      turnDeadlineAt: NOW + 60_000,
      turnLock: false,
      gameOver: false,
      capturedTurnPlayerId: 'b',
      capturedTurnSeq: 7,
      currentTurnPlayerId: 'b',
      currentTurnSeq: 7,
      lastAttemptKey: null,
      amCoordinator: true,
    })
    assert.equal(proceed.ok, false)
    assert.equal(proceed.reason, 'not-expired')
  })

  it('identidade preservada com prazo expirado permite prosseguir', () => {
    const proceed = shouldProceedTimerAutoPassAfterAwait({
      now: NOW,
      turnDeadlineAt: NOW,
      turnLock: false,
      gameOver: false,
      capturedTurnPlayerId: 'b',
      capturedTurnSeq: 7,
      currentTurnPlayerId: 'b',
      currentTurnSeq: 7,
      lastAttemptKey: null,
      amCoordinator: true,
    })
    assert.equal(proceed.ok, true)
  })
})

describe('guard de skip vs LOCK', () => {
  it('LOCK release não confirma skip key', () => {
    __resetSharedTurnSkipGuardForTests()
    const action = resolveSkipGuardAction(
      {
        kind: 'LOCK',
        _commitKind: 'LOCK_RELEASE',
        _expectTurnPlayerId: 'b',
        _expectTurnSeq: 7,
      },
      { casLost: false, commitOk: true },
    )
    assert.equal(action.action, 'none')
  })

  it('rejeição de auto-pass seguida de lock não bloqueia retry válido', () => {
    __resetSharedTurnSkipGuardForTests()
    markPendingSharedSkipKey('b', 7)
    releaseSharedSkipKey('b', 7)

    const lockAction = resolveSkipGuardAction(
      { kind: 'LOCK', _commitKind: 'LOCK_RELEASE' },
      { casLost: false, commitOk: true },
    )
    assert.equal(lockAction.action, 'none')
    assert.equal(wasAlreadySkipped('b', 7), false)

    const remote = remoteBase()
    const v = validateTurnCommit(remote, autoPassPatch('b', 7), { now: NOW })
    assert.equal(v.ok, true)
  })

  it('somente AUTO_PASS confirma skip key', () => {
    __resetSharedTurnSkipGuardForTests()
    const confirm = resolveSkipGuardAction(
      { _commitKind: 'AUTO_PASS', _expectTurnPlayerId: 'b', _expectTurnSeq: 7 },
      { casLost: false, commitOk: true },
    )
    assert.equal(confirm.action, 'confirm')
    const handoff = resolveSkipGuardAction(
      { _commitKind: 'NORMAL_HANDOFF', _expectTurnPlayerId: 'b', _expectTurnSeq: 7 },
      { casLost: false, commitOk: true },
    )
    assert.equal(handoff.action, 'none')
  })
})

describe('deadline remoto futuro — commit', () => {
  it('auto-pass rejeitado não altera snapshot remoto', () => {
    const remote = remoteBase({ turnDeadlineAt: NOW + 45_000 })
    const applied = applyGamePatchToState(
      remote,
      { statePatch: autoPassPatch('b', 7) },
      { now: NOW },
    )
    assert.equal(applied.ok, false)
    assert.equal(applied.state.turnPlayerId, 'b')
    assert.equal(applied.state.turnSeq, 7)
    assert.equal(applied.state.turnDeadlineAt, NOW + 45_000)
  })
})

describe('handoff normal rejeitado — snapshot', () => {
  it('TURN atrasado não avança remoto D/9', () => {
    const remote = remoteBase({ turnPlayerId: 'd', turnSeq: 9 })
    const applied = applyGamePatchToState(
      remote,
      { statePatch: normalHandoffPatch('b', 7) },
      { now: NOW },
    )
    assert.equal(applied.ok, false)
    assert.equal(applied.state.turnPlayerId, 'd')
    assert.equal(applied.state.turnSeq, 9)
  })
})

describe('CAS concorrente', () => {
  it('dois auto-pass B/7: primeiro vence, segundo recusado por seq', () => {
    let state = remoteBase()
    const first = applyGamePatchToState(
      state,
      { statePatch: autoPassPatch('b', 7) },
      { now: NOW },
    )
    assert.equal(first.ok, true)
    assert.equal(first.state.turnPlayerId, 'c')
    assert.equal(first.state.turnSeq, 8)

    const second = applyGamePatchToState(
      first.state,
      { statePatch: autoPassPatch('b', 7) },
      { now: NOW },
    )
    assert.equal(second.ok, false)
    assert.equal(second.state.turnPlayerId, 'c')
    assert.equal(second.state.turnSeq, 8)
  })
})

describe('deadline inválido', () => {
  it('null é tratado como 0 (expirado) em shouldAttemptTimerAutoPass isolado', () => {
    const d = shouldAttemptTimerAutoPass({
      now: NOW,
      turnDeadlineAt: null,
      turnLock: false,
      gameOver: false,
      amCoordinator: true,
      turnPlayerId: 'b',
      turnSeq: 7,
      lastAttemptKey: null,
      inFlight: false,
    })
    assert.equal(d.ok, true)
    assert.equal(d.reason, 'expired')
  })

  it('commit remoto rejeita auto-pass sem deadline finito no snapshot', () => {
    const remote = remoteBase({ turnDeadlineAt: null })
    const patch = autoPassPatch('b', 7)
    const v = validateTurnCommit(remote, patch, { now: NOW })
    assert.equal(v.ok, false)
    assert.equal(v.reason, 'no-deadline')
  })

  it('zero legítimo autoriza uma tentativa', () => {
    const d = shouldAttemptTimerAutoPass({
      now: NOW,
      turnDeadlineAt: NOW,
      turnLock: false,
      gameOver: false,
      amCoordinator: true,
      turnPlayerId: 'b',
      turnSeq: 7,
      lastAttemptKey: null,
      inFlight: false,
    })
    assert.equal(d.ok, true)
  })
})

describe('ENDGAME', () => {
  it('auto-pass não altera partida encerrada', () => {
    const remote = remoteBase({ gameOver: true })
    const patch = autoPassPatch('b', 7)
    const v = validateTurnCommit(remote, patch, { now: NOW })
    assert.equal(v.ok, false)
    assert.equal(v.reason, 'game-over')
  })
})

describe('controles positivos', () => {
  it('auto-pass expirado avança uma vez', () => {
    const remote = remoteBase()
    const patch = autoPassPatch('b', 7)
    const applied = applyGamePatchToState(remote, { statePatch: patch }, { now: NOW })
    assert.equal(applied.ok, true)
    assert.equal(applied.state.turnPlayerId, 'c')
    assert.equal(applied.state.turnSeq, 8)
  })

  it('LOCK acquire no turno correto', () => {
    const remote = remoteBase({ turnLock: false })
    const patch = {
      kind: 'LOCK',
      turnLock: true,
      lockOwner: 'b',
      _expectTurnPlayerId: 'b',
      _expectTurnSeq: 7,
      _expectLockOwner: 'b',
      _commitKind: 'LOCK_ACQUIRE',
    }
    const v = validateTurnCommit(remote, patch, { now: NOW })
    assert.equal(v.ok, true)
  })
})

describe('monotonic gates', () => {
  it('resposta HTTP antiga não regrede versão/turno mais novo', () => {
    const local = remoteBase({
      turnPlayerId: 'd',
      turnSeq: 9,
      turnLock: true,
      lockOwner: 'd',
      lastRollTurnKey: '9',
    })
    const incoming = remoteBase({
      turnPlayerId: 'c',
      turnSeq: 8,
      turnLock: false,
      lockOwner: null,
    })
    const gate = shouldApplyRemoteRoomRow({
      incomingVersion: 11,
      incomingState: incoming,
      localVersion: 12,
      localState: local,
    })
    assert.equal(gate.apply, false)
    assert.equal(gate.reason, 'stale-version')
  })

  it('confirmação C/8 não apaga lock/roll mais recente do mesmo turno', () => {
    const emission = captureTurnEmissionSnapshot({
      turnPlayerId: 'b',
      turnSeq: 7,
      turnLock: false,
      lockOwner: null,
      lastRollTurnKey: null,
    })
    const patch = autoPassPatch('b', 7)
    const current = remoteBase({
      turnPlayerId: 'c',
      turnSeq: 8,
      turnLock: true,
      lockOwner: 'c',
      lastRollTurnKey: '8',
    })
    const gate = shouldApplyDeferredLocalPatch({ emission, current, patch })
    assert.equal(gate.apply, false)
    assert.ok(
      gate.reason === 'lock-evolved' || gate.reason === 'origin-superseded',
      `expected lock-evolved or origin-superseded, got ${gate.reason}`,
    )
  })

  it('handoff B/7→C/8 obsoleto após D/9', () => {
    const emission = captureTurnEmissionSnapshot({ turnPlayerId: 'b', turnSeq: 7 })
    const patch = normalHandoffPatch('b', 7)
    const current = remoteBase({ turnPlayerId: 'd', turnSeq: 9 })
    const gate = shouldApplyDeferredLocalPatch({ emission, current, patch })
    assert.equal(gate.apply, false)
    assert.equal(gate.reason, 'origin-superseded')
  })

  it('pendência de handoff obsoleta após avanço remoto', () => {
    const pending = {
      originTurnPlayerId: 'b',
      originTurnSeq: 7,
      nextTurnPlayerId: 'c',
      nextTurnIdx: 2,
    }
    assert.equal(
      isHandoffPendingObsolete(pending, { turnPlayerId: 'd', turnSeq: 9 }),
      true,
    )
    assert.equal(
      isHandoffPendingObsolete(pending, { turnPlayerId: 'b', turnSeq: 7 }),
      false,
    )
  })

  it('versão mais nova aplica normalmente', () => {
    const local = remoteBase({ turnPlayerId: 'c', turnSeq: 8 })
    const incoming = remoteBase({
      turnPlayerId: 'd',
      turnSeq: 9,
      turnLock: true,
      lockOwner: 'd',
    })
    const gate = shouldApplyRemoteRoomRow({
      incomingVersion: 13,
      incomingState: incoming,
      localVersion: 12,
      localState: local,
    })
    assert.equal(gate.apply, true)
  })

  it('desbloqueio legítimo em versão mais nova é aceito', () => {
    const local = remoteBase({
      turnLock: true,
      lockOwner: 'b',
      lastRollTurnKey: '7',
    })
    const incoming = {
      ...local,
      kind: 'LOCK',
      turnLock: false,
      lockOwner: null,
    }
    const gate = shouldApplyRemoteRoomRow({
      incomingVersion: 11,
      incomingState: incoming,
      localVersion: 10,
      localState: local,
    })
    assert.equal(gate.apply, true)
  })

  it('desbloqueio antigo em versão menor continua recusado', () => {
    const local = remoteBase({
      turnLock: true,
      lockOwner: 'b',
      lastRollTurnKey: '7',
    })
    const incoming = { ...local, turnLock: false, lockOwner: null }
    const gate = shouldApplyRemoteRoomRow({
      incomingVersion: 11,
      incomingState: incoming,
      localVersion: 12,
      localState: local,
    })
    assert.equal(gate.apply, false)
    assert.equal(gate.reason, 'stale-version')
  })

  it('ENDGAME autoritativo em versão mais nova é aceito', () => {
    const local = remoteBase({
      round: 5,
      maxRounds: 5,
      turnLock: true,
      lockOwner: 'b',
      lastRollTurnKey: '7',
    })
    const incoming = {
      ...local,
      kind: 'ENDGAME',
      turnLock: false,
      lockOwner: null,
      gameOver: true,
      winner: { id: 'd' },
      turnDeadlineAt: null,
    }
    const gate = shouldApplyRemoteRoomRow({
      incomingVersion: 12,
      incomingState: incoming,
      localVersion: 10,
      localState: local,
    })
    assert.equal(gate.apply, true)
  })

  it('origem sequência zero obsoleta após avanço para C/1', () => {
    const pending = {
      originTurnPlayerId: 'b',
      originTurnSeq: 0,
      nextTurnPlayerId: 'c',
      nextTurnIdx: 2,
    }
    assert.equal(
      isHandoffPendingObsolete(pending, { turnPlayerId: 'c', turnSeq: 1 }),
      true,
    )
  })

  it('auto-pass B/0 bloqueado quando C/1 já tem lock', () => {
    const emission = captureTurnEmissionSnapshot({
      turnPlayerId: 'b',
      turnSeq: 0,
    })
    const patch = {
      kind: 'TURN',
      turnPlayerId: 'c',
      turnSeq: 1,
      turnLock: false,
      lockOwner: null,
      lastRollTurnKey: null,
      _expectTurnPlayerId: 'b',
      _expectTurnSeq: 0,
      _commitKind: 'AUTO_PASS',
    }
    const current = remoteBase({
      turnPlayerId: 'c',
      turnSeq: 1,
      turnLock: true,
      lockOwner: 'c',
      lastRollTurnKey: '1',
    })
    const gate = shouldApplyDeferredLocalPatch({ emission, current, patch })
    assert.equal(gate.apply, false)
    assert.equal(gate.reason, 'origin-superseded')
  })
})
