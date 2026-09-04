/**
 * Reset transitório A→B: endGameFinalizedRef só cai quando matchId muda de verdade.
 * gameOver=false sozinho NÃO reseta. Mesmo matchId NÃO reseta.
 */
import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import {
  decideMatchTransientEndgameReset,
  applyMatchTransientEndgameReset,
} from '../matchEntryReadiness.js'

function engineRollBlocked({ gameOver, endGamePending, endGameFinalized }) {
  return !!(gameOver || endGamePending || endGameFinalized)
}

function canNormalHandoff({ gameOver, endGameFinalized, pending }) {
  if (gameOver === true || endGameFinalized === true) return false
  return pending != null && pending.nextTurnIdx != null
}

function runBoundary(seen, nextMatchId, refs) {
  const decision = decideMatchTransientEndgameReset({
    previousMatchId: seen,
    nextMatchId,
  })
  if (decision.reset) applyMatchTransientEndgameReset(refs)
  return { decision, seen: decision.rememberMatchId, refs }
}

describe('reset transitório entre matches', () => {
  it('MATCH A ENDGAME → lobby → MATCH B: reset uma vez e ROLL/handoff liberam', () => {
    const refs = {
      endGameFinalized: true,
      endGamePending: true,
      pendingTurnData: { nextTurnIdx: 1, originTurnSeq: 47, fromMatch: 'A' },
      turnChangeInProgress: true,
    }
    let seen = 'match-A'
    const roomB = { gameOver: false, winner: null }

    const lobby = runBoundary(seen, null, refs)
    assert.equal(lobby.decision.reset, false)
    assert.equal(lobby.seen, 'match-A')
    assert.equal(refs.endGameFinalized, true)

    const b = runBoundary(lobby.seen, 'match-B', refs)
    assert.equal(b.decision.reset, true)
    assert.equal(b.seen, 'match-B')
    assert.equal(refs.endGameFinalized, false)
    assert.equal(refs.endGamePending, false)
    assert.equal(refs.pendingTurnData, null)
    assert.equal(refs.turnChangeInProgress, false)
    assert.equal(roomB.gameOver, false)
    assert.equal(roomB.winner, null)
    assert.equal(
      engineRollBlocked({
        gameOver: roomB.gameOver,
        endGamePending: refs.endGamePending,
        endGameFinalized: refs.endGameFinalized,
      }),
      false,
    )

    const again = runBoundary(b.seen, 'match-B', refs)
    assert.equal(again.decision.reset, false)
    assert.equal(refs.endGameFinalized, false)

    const pendingB = { nextTurnIdx: 1, originTurnSeq: 0, fromMatch: 'B' }
    assert.equal(
      canNormalHandoff({
        gameOver: roomB.gameOver,
        endGameFinalized: refs.endGameFinalized,
        pending: pendingB,
      }),
      true,
    )
  })

  it('MATCH A 1 rodada → MATCH B 2 rodadas: só o matchId dispara reset', () => {
    const refs = {
      endGameFinalized: true,
      endGamePending: true,
      pendingTurnData: { from: 'A-max1' },
      turnChangeInProgress: true,
    }
    const d = decideMatchTransientEndgameReset({
      previousMatchId: 'match-A-max1',
      nextMatchId: 'match-B-max2',
    })
    assert.equal(d.reset, true)
    applyMatchTransientEndgameReset(refs)
    assert.equal(refs.endGameFinalized, false)
    assert.equal(
      engineRollBlocked({
        gameOver: false,
        endGamePending: refs.endGamePending,
        endGameFinalized: refs.endGameFinalized,
      }),
      false,
    )
  })

  it('MATCH A 2 rodadas → MATCH B 1 rodada: só o matchId dispara reset', () => {
    const refs = {
      endGameFinalized: true,
      endGamePending: false,
      pendingTurnData: { from: 'A-max2' },
      turnChangeInProgress: false,
    }
    const d = decideMatchTransientEndgameReset({
      previousMatchId: 'match-A-max2',
      nextMatchId: 'match-B-max1',
    })
    assert.equal(d.reset, true)
    applyMatchTransientEndgameReset(refs)
    assert.equal(refs.endGameFinalized, false)
    assert.equal(refs.endGamePending, false)
  })

  it('mesmo matchId no meio da partida NÃO reseta', () => {
    const refs = {
      endGameFinalized: true,
      endGamePending: true,
      pendingTurnData: { nextTurnIdx: 0 },
      turnChangeInProgress: true,
    }
    const d = decideMatchTransientEndgameReset({
      previousMatchId: 'match-A',
      nextMatchId: 'match-A',
    })
    assert.equal(d.reset, false)
    assert.equal(d.rememberMatchId, 'match-A')
    assert.equal(refs.endGameFinalized, true)
    assert.equal(refs.pendingTurnData.nextTurnIdx, 0)
  })

  it('gameOver false sozinho NÃO é boundary de match', () => {
    const d = decideMatchTransientEndgameReset({
      previousMatchId: 'match-A',
      nextMatchId: 'match-A',
    })
    assert.equal(d.reset, false)
    assert.equal(
      engineRollBlocked({
        gameOver: false,
        endGamePending: false,
        endGameFinalized: true,
      }),
      true,
    )
  })

  it('primeiro matchId identificado não reseta (refs já começam false)', () => {
    const d = decideMatchTransientEndgameReset({
      previousMatchId: '',
      nextMatchId: 'match-A',
    })
    assert.equal(d.reset, false)
    assert.equal(d.rememberMatchId, 'match-A')
  })
})
