import test from 'node:test'
import assert from 'node:assert/strict'
import {
  resolveTimerAttemptAuthority,
  shouldAttemptTimerAutoPass,
  TIMER_FALLBACK_STAGGER_MS,
} from '../turnTimerLogic.js'
import { validateTurnCommit } from '../turnCommitValidation.js'
import { findUniqueRecoverableSeatByName } from '../resumeSeatRecovery.js'

const NOW = 2_000_000

test('timer usa jogadores vivos como backups sem depender de presence', () => {
  const roster = [
    { id: 'offline', bankrupt: false },
    { id: 'connected', bankrupt: false },
    { id: 'bankrupt', bankrupt: true },
    { id: 'bot:m:1', isBot: true },
  ]
  assert.equal(resolveTimerAttemptAuthority({
    rosterPlayers: roster,
    myUid: 'connected',
    now: NOW,
    turnDeadlineAt: NOW,
  }).authorized, false)
  const fallback = resolveTimerAttemptAuthority({
    rosterPlayers: roster,
    myUid: 'connected',
    now: NOW + TIMER_FALLBACK_STAGGER_MS,
    turnDeadlineAt: NOW,
  })
  assert.equal(fallback.authorized, true)
  assert.equal(fallback.reason, 'roster-fallback')
})

test('lock orfao pos-rolagem pode ser recuperado depois do prazo', () => {
  const decision = shouldAttemptTimerAutoPass({
    now: NOW,
    turnDeadlineAt: NOW - 20_000,
    turnLock: true,
    gameOver: false,
    amCoordinator: true,
    turnPlayerId: 'p1',
    turnSeq: 7,
    lastRollTurnKey: '7',
    allowOrphanedPostRoll: true,
    decisionHold: null,
    lastAttemptKey: null,
    inFlight: false,
  })
  assert.equal(decision.ok, true)

  const remote = {
    matchId: 'm1',
    players: [{ id: 'p1' }, { id: 'p2' }],
    turnPlayerId: 'p1',
    turnSeq: 7,
    turnDeadlineAt: NOW - 20_000,
    turnLock: true,
    lockTs: NOW - 60_000,
    lastRollTurnKey: '7',
    decisionHold: null,
    gameOver: false,
  }
  const patch = {
    kind: 'TURN',
    lastAction: 'AUTO_PASS_TIMER',
    turnPlayerId: 'p2',
    turnSeq: 8,
    _expectTurnPlayerId: 'p1',
    _expectTurnSeq: 7,
    _commitKind: 'AUTO_PASS',
  }
  assert.equal(validateTurnCommit(remote, patch, { now: NOW }).ok, true)
  assert.equal(validateTurnCommit({ ...remote, turnLock: false }, patch, { now: NOW }).ok, true)
})

test('lock pos-rolagem nao ignora efeitos humanos obrigatorios', () => {
  const remote = {
    matchId: 'm1',
    players: [{
      id: 'p1',
      humanTurnEffects: {
        matchId: 'm1', turnPlayerId: 'p1', turnSeq: 7,
        crossedStart: false, crossedExpenses: true,
        landTile: 'NONE', processLandTile: false,
        done: [], settled: false,
      },
    }, { id: 'p2' }],
    turnPlayerId: 'p1', turnSeq: 7, turnDeadlineAt: NOW - 20_000,
    turnLock: true, lockTs: NOW - 60_000, lastRollTurnKey: '7', decisionHold: null, gameOver: false,
  }
  const patch = {
    kind: 'TURN', lastAction: 'AUTO_PASS_TIMER', turnPlayerId: 'p2', turnSeq: 8,
    _expectTurnPlayerId: 'p1', _expectTurnSeq: 7, _commitKind: 'AUTO_PASS',
  }
  assert.equal(validateTurnCommit(remote, patch, { now: NOW }).ok, false)
  assert.equal(validateTurnCommit({ ...remote, turnLock: false }, patch, { now: NOW }).ok, false)
})

test('celular sem storage recupera somente nome humano exato e unico', () => {
  const unique = findUniqueRecoverableSeatByName({
    players: [
      { id: 'a', name: '  Gabriela   Kowacic ' },
      { id: 'bot:m:1', name: 'Maquina 1', isBot: true },
    ],
  }, 'gabriela kowacic')
  assert.equal(unique.ok, true)
  assert.equal(unique.player.id, 'a')

  const ambiguous = findUniqueRecoverableSeatByName({
    players: [{ id: 'a', name: 'Ana' }, { id: 'b', name: 'ANA' }],
  }, 'Ana')
  assert.equal(ambiguous.ok, false)
  assert.equal(ambiguous.reason, 'ambiguous-name')
})
