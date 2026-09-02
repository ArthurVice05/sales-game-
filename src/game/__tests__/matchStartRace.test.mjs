/**
 * Corrida START vs navegação por linha em matches.
 * Executar: node --test src/game/__tests__/matchStartRace.test.mjs
 */
import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { formatRoundProgress } from '../roundDisplay.js'
import {
  MATCH_ENTRY,
  evaluateMatchEntryReadiness,
  isStartCommitSuccess,
  hasStartResetFields,
  buildStartMatchPatch,
  shouldApplyRoomStateForMatch,
} from '../matchEntryReadiness.js'

const oldState = {
  matchId: 'match-anterior',
  kind: 'TURN',
  round: 2,
  maxRounds: 5,
  gameOver: false,
  winner: null,
  turnSeq: 4,
  turnLock: false,
  lockOwner: null,
  lastRollTurnKey: '4',
  lastRoll: { total: 5 },
  players: [
    { id: 'a', name: 'A', pos: 12 },
    { id: 'b', name: 'B', pos: 8 },
  ],
}

function legacyNavigateIfMatchRow(latestMatchId) {
  if (latestMatchId) return 'enter'
  return 'wait'
}

describe('HUD 0/N com round 1-based', () => {
  it('round=1 maxRounds=1 → 0/1', () => {
    assert.equal(formatRoundProgress(1, 1).label, '0/1')
  })
  it('round=1 maxRounds=2 → 0/2', () => {
    assert.equal(formatRoundProgress(1, 2).label, '0/2')
  })
  it('round=1 maxRounds=3 → 0/3', () => {
    assert.equal(formatRoundProgress(1, 3).label, '0/3')
  })
  it('round=1 maxRounds=4 → 0/4', () => {
    assert.equal(formatRoundProgress(1, 4).label, '0/4')
  })
  it('round=1 maxRounds=5 → 0/5', () => {
    assert.equal(formatRoundProgress(1, 5).label, '0/5')
  })
  it('round=2 com limite 1 é mascarado como 0/1 pelo clamp (não é início real)', () => {
    assert.equal(formatRoundProgress(2, 1).label, '0/1')
  })
  it('round=2 com limites 2–5 exibe 1/N', () => {
    assert.equal(formatRoundProgress(2, 2).label, '1/2')
    assert.equal(formatRoundProgress(2, 3).label, '1/3')
    assert.equal(formatRoundProgress(2, 4).label, '1/4')
    assert.equal(formatRoundProgress(2, 5).label, '1/5')
  })
})

describe('corrida matchId antigo vs partida nova', () => {
  it('estado antigo match-anterior/round=2 não autoriza entrada em match-novo', () => {
    const d = evaluateMatchEntryReadiness({
      latestMatchId: 'match-novo',
      roomState: oldState,
      persistedPlayerId: 'a',
      mode: 'guest-wait',
    })
    assert.equal(d.action, MATCH_ENTRY.WAIT_NEW_START)
    assert.equal(d.reason, 'stale-match-id')
  })

  it('existência isolada da linha em matches não autoriza entrada', () => {
    const d = evaluateMatchEntryReadiness({
      latestMatchId: 'match-novo',
      roomState: null,
      mode: 'guest-wait',
    })
    assert.equal(d.action, MATCH_ENTRY.WAIT_NEW_START)
    assert.notEqual(legacyNavigateIfMatchRow('match-novo'), d.action)
  })

  it('convidado aguarda enquanto START de match-novo está pendente', () => {
    const d = evaluateMatchEntryReadiness({
      latestMatchId: 'match-novo',
      roomState: { ...oldState },
      mode: 'guest-wait',
    })
    assert.equal(d.action, MATCH_ENTRY.WAIT_NEW_START)
  })

  it('START confirmado de match-novo autoriza entrada com round=1 → 0/5', () => {
    const start = {
      matchId: 'match-novo',
      kind: 'START',
      round: 1,
      maxRounds: 5,
      gameOver: false,
      winner: null,
      turnSeq: 0,
      turnLock: false,
      lockOwner: null,
      lastRollTurnKey: null,
      lastRoll: null,
      roundFlags: [false, false],
      players: [{ id: 'a' }, { id: 'b' }],
      turnPlayerId: 'a',
    }
    const d = evaluateMatchEntryReadiness({
      latestMatchId: 'match-novo',
      roomState: start,
      mode: 'guest-wait',
    })
    assert.equal(d.action, MATCH_ENTRY.ENTER_CURRENT_MATCH)
    assert.equal(formatRoundProgress(start.round, start.maxRounds).label, '0/5')
    assert.equal(hasStartResetFields(start), true)
  })

  it('snapshot START inclui campos explícitos de reset', () => {
    const patch = buildStartMatchPatch({
      matchId: 'match-novo',
      maxRounds: 5,
      turnTimeSec: 90,
      turnDeadlineAt: 1_000_000,
      turnPlayerId: 'a',
      boardVersion: 'v2-40',
      playersCount: 3,
    })
    const snapshot = {
      ...patch,
      players: [{ id: 'a' }, { id: 'b' }, { id: 'c' }],
    }
    assert.equal(hasStartResetFields(snapshot), true)
    assert.equal(snapshot.round, 1)
    assert.equal(snapshot.kind, 'START')
    assert.equal(snapshot.gameOver, false)
    assert.equal(snapshot.winner, null)
    assert.equal(snapshot.turnSeq, 0)
    assert.equal(snapshot.turnLock, false)
    assert.equal(snapshot.lockOwner, null)
    assert.equal(snapshot.lastRollTurnKey, null)
    assert.equal(snapshot.lastRoll, null)
    assert.equal(snapshot.roundFlags.length, 3)
  })

  it('snapshot sem matchId da geração nova não é aplicado', () => {
    assert.equal(shouldApplyRoomStateForMatch(oldState, 'match-novo'), false)
    assert.equal(shouldApplyRoomStateForMatch({ matchId: 'match-novo', round: 1 }, 'match-novo'), true)
    assert.equal(shouldApplyRoomStateForMatch({ round: 2 }, 'match-novo'), false)
    assert.equal(shouldApplyRoomStateForMatch(oldState, null), true)
  })

  it('falha no commit START não é tratada como sucesso; offline segue sem netCommit', () => {
    assert.equal(isStartCommitSuccess({ ok: true }, { netEnabled: true }), true)
    assert.equal(isStartCommitSuccess({ ok: false }, { netEnabled: true }), false)
    assert.equal(isStartCommitSuccess(undefined, { netEnabled: true }), false)
    assert.equal(isStartCommitSuccess({ ok: false, skipped: true }, { netEnabled: true }), false)
    assert.equal(isStartCommitSuccess(undefined, { netEnabled: false }), true)
  })

  it('host só entra em phase game depois do commit START autoritativo', async () => {
    let phase = 'playersLobby'
    let release
    const startCommit = new Promise((resolve) => {
      release = resolve
    })
    const hostFlow = (async () => {
      const result = await startCommit
      if (!isStartCommitSuccess(result, { netEnabled: true })) {
        return { ok: false, phase }
      }
      phase = 'game'
      return { ok: true, phase }
    })()
    assert.equal(phase, 'playersLobby')
    release({ ok: true })
    const done = await hostFlow
    assert.equal(done.ok, true)
    assert.equal(done.phase, 'game')

    let failPhase = 'playersLobby'
    const failResult = { ok: false, reason: 'commit-failed' }
    if (isStartCommitSuccess(failResult, { netEnabled: true })) failPhase = 'game'
    assert.equal(failPhase, 'playersLobby')
  })

  it('retomada legítima de match-novo em round=2 preserva 1/5', () => {
    const mid = {
      matchId: 'match-novo',
      kind: 'TURN',
      round: 2,
      maxRounds: 5,
      gameOver: false,
      players: [{ id: 'a' }, { id: 'b' }],
    }
    const d = evaluateMatchEntryReadiness({
      latestMatchId: 'match-novo',
      roomState: mid,
      persistedPlayerId: 'a',
      mode: 'legacy-resume',
    })
    assert.equal(d.action, MATCH_ENTRY.ENTER_CURRENT_MATCH)
    assert.equal(formatRoundProgress(mid.round, mid.maxRounds).label, '1/5')
  })

  it('reentrada legado sem matchId no snapshot, com jogador no roster', () => {
    const legacy = {
      kind: 'TURN',
      round: 3,
      maxRounds: 5,
      players: [{ id: 'a' }, { id: 'b' }],
    }
    const d = evaluateMatchEntryReadiness({
      latestMatchId: null,
      roomState: legacy,
      persistedPlayerId: 'a',
      mode: 'legacy-resume',
    })
    assert.equal(d.action, MATCH_ENTRY.RESUME_LEGACY_MATCH)
    const blocked = evaluateMatchEntryReadiness({
      latestMatchId: 'match-novo',
      roomState: legacy,
      persistedPlayerId: 'a',
      mode: 'guest-wait',
    })
    assert.equal(blocked.action, MATCH_ENTRY.WAIT_NEW_START)
  })

  it('match novo mais recente que rooms.state sem matchId não autoriza retomada legado', () => {
    const d = evaluateMatchEntryReadiness({
      latestMatchId: 'match-novo',
      latestMatchCreatedAt: '2026-09-02T12:00:01.000Z',
      roomUpdatedAt: '2026-09-02T11:59:00.000Z',
      roomState: {
        kind: 'TURN',
        round: 2,
        maxRounds: 5,
        players: [{ id: 'a' }, { id: 'b' }],
      },
      persistedPlayerId: 'a',
      mode: 'legacy-resume',
    })
    assert.equal(d.action, MATCH_ENTRY.WAIT_NEW_START)
  })

  it('reentrada legado: rooms atualizado depois da linha matches da mesma geração', () => {
    const d = evaluateMatchEntryReadiness({
      latestMatchId: 'match-velho',
      latestMatchCreatedAt: '2026-09-02T10:00:00.000Z',
      roomUpdatedAt: '2026-09-02T12:00:00.000Z',
      roomState: {
        kind: 'TURN',
        round: 2,
        maxRounds: 5,
        players: [{ id: 'a' }, { id: 'b' }],
      },
      persistedPlayerId: 'a',
      mode: 'legacy-resume',
    })
    assert.equal(d.action, MATCH_ENTRY.RESUME_LEGACY_MATCH)
    assert.equal(formatRoundProgress(2, 5).label, '1/5')
  })

  it('mismatch em reentrada locked rejeita snapshot de outra geração', () => {
    const d = evaluateMatchEntryReadiness({
      latestMatchId: 'match-novo',
      roomState: oldState,
      persistedPlayerId: 'a',
      mode: 'legacy-resume',
    })
    assert.equal(d.action, MATCH_ENTRY.REJECT_MISMATCHED_MATCH)
  })
})
