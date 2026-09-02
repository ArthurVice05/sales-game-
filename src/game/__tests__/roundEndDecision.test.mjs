/**
 * Encerramento por rodadas no tick (não confundir entrada na rodada final com conclusão).
 * Executar: node --test src/game/__tests__/roundEndDecision.test.mjs
 */
import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { formatRoundProgress } from '../roundDisplay.js'
import { shouldFinishAfterRoundTransition } from '../roundEndDecision.js'
import { pickWinnerByPatrimonio } from '../patrimonio.js'
import { decideEndgameAfterBankruptcy } from '../matchForfeit.js'
import { shouldAttemptTimerAutoPass } from '../turnTimerLogic.js'

/** Réplica da condição antiga do tick — só para documentar o bug. */
function legacyTickFinishedEarly({
  currentRoundRef,
  maxRounds,
  shouldIncrementRound,
  endGame,
  nextRound,
}) {
  const isEndgameCondition =
    currentRoundRef === maxRounds && shouldIncrementRound
  const isEndgameByFlag = endGame === true
  return (
    isEndgameCondition ||
    isEndgameByFlag ||
    (shouldIncrementRound && nextRound > maxRounds)
  )
}

function handoffAfterRoundTransition(input) {
  const finish = shouldFinishAfterRoundTransition(input)
  if (finish) {
    return {
      kind: 'ENDGAME',
      gameOver: true,
      winnerRequired: true,
      turnDeadlineAt: null,
    }
  }
  return {
    kind: 'TURN',
    gameOver: false,
    winner: null,
    skipNextTurn: false,
  }
}

describe('bug legado: currentRound === MAX && shouldIncrementRound', () => {
  it('transição 1→2 com maxRounds=2 era encerrada cedo pelo tick antigo', () => {
    const legacy = legacyTickFinishedEarly({
      currentRoundRef: 2,
      maxRounds: 2,
      shouldIncrementRound: true,
      endGame: false,
      nextRound: 2,
    })
    assert.equal(legacy, true)
    assert.equal(
      shouldFinishAfterRoundTransition({
        endGame: false,
        shouldIncrementRound: true,
        nextRound: 2,
        maxRounds: 2,
      }),
      false,
    )
  })
})

describe('progresso após primeira volta', () => {
  it('maxRounds=2: primeira volta → round=2, HUD 1/2, continua', () => {
    const input = {
      endGame: false,
      shouldIncrementRound: true,
      nextRound: 2,
      maxRounds: 2,
    }
    assert.equal(shouldFinishAfterRoundTransition(input), false)
    assert.equal(formatRoundProgress(2, 2).label, '1/2')
    const handoff = handoffAfterRoundTransition(input)
    assert.equal(handoff.kind, 'TURN')
    assert.equal(handoff.gameOver, false)
    assert.equal(handoff.winner, null)
    assert.equal(handoff.skipNextTurn, false)
  })
})

describe('uma a cinco rodadas', () => {
  it('1. uma rodada termina após uma volta completa', () => {
    assert.equal(
      shouldFinishAfterRoundTransition({
        endGame: true,
        shouldIncrementRound: false,
        nextRound: 1,
        maxRounds: 1,
      }),
      true,
    )
  })

  it('2. duas rodadas não terminam na transição 1 → 2', () => {
    assert.equal(
      shouldFinishAfterRoundTransition({
        endGame: false,
        shouldIncrementRound: true,
        nextRound: 2,
        maxRounds: 2,
      }),
      false,
    )
  })

  it('3. duas rodadas terminam somente após concluir a segunda volta', () => {
    assert.equal(
      shouldFinishAfterRoundTransition({
        endGame: true,
        shouldIncrementRound: false,
        nextRound: 2,
        maxRounds: 2,
      }),
      true,
    )
    const end = handoffAfterRoundTransition({
      endGame: true,
      shouldIncrementRound: false,
      nextRound: 2,
      maxRounds: 2,
    })
    assert.equal(end.kind, 'ENDGAME')
    assert.equal(end.gameOver, true)
    assert.equal(end.turnDeadlineAt, null)
  })

  it('4. três rodadas não terminam na transição 2 → 3', () => {
    assert.equal(
      shouldFinishAfterRoundTransition({
        endGame: false,
        shouldIncrementRound: true,
        nextRound: 3,
        maxRounds: 3,
      }),
      false,
    )
  })

  it('5. três rodadas terminam somente após a terceira volta', () => {
    assert.equal(
      shouldFinishAfterRoundTransition({
        endGame: true,
        shouldIncrementRound: false,
        nextRound: 3,
        maxRounds: 3,
      }),
      true,
    )
  })

  it('6. quatro rodadas terminam somente após a quarta volta', () => {
    assert.equal(
      shouldFinishAfterRoundTransition({
        endGame: false,
        shouldIncrementRound: true,
        nextRound: 4,
        maxRounds: 4,
      }),
      false,
    )
    assert.equal(
      shouldFinishAfterRoundTransition({
        endGame: true,
        shouldIncrementRound: false,
        nextRound: 4,
        maxRounds: 4,
      }),
      true,
    )
  })

  it('7. cinco rodadas terminam somente após a quinta volta', () => {
    assert.equal(
      shouldFinishAfterRoundTransition({
        endGame: false,
        shouldIncrementRound: true,
        nextRound: 5,
        maxRounds: 5,
      }),
      false,
    )
    assert.equal(
      shouldFinishAfterRoundTransition({
        endGame: true,
        shouldIncrementRound: false,
        nextRound: 5,
        maxRounds: 5,
      }),
      true,
    )
  })

  it('8. shouldIncrementRound=true significa entrada na próxima rodada', () => {
    assert.equal(
      shouldFinishAfterRoundTransition({
        endGame: false,
        shouldIncrementRound: true,
        nextRound: 2,
        maxRounds: 5,
      }),
      false,
    )
  })

  it('9. endGame=true significa conclusão da rodada final', () => {
    assert.equal(
      shouldFinishAfterRoundTransition({
        endGame: true,
        shouldIncrementRound: false,
        nextRound: 2,
        maxRounds: 2,
      }),
      true,
    )
  })

  it('proteção nextRound > maxRounds ainda encerra', () => {
    assert.equal(
      shouldFinishAfterRoundTransition({
        endGame: false,
        shouldIncrementRound: true,
        nextRound: 3,
        maxRounds: 2,
      }),
      true,
    )
  })
})

describe('vencedor, falência, kind e timer', () => {
  it('10. vencedor pelo patrimônio mais recente', () => {
    const winner = pickWinnerByPatrimonio([
      { id: 'a', name: 'Ana', cash: 1000, bens: 1000, bankrupt: false },
      { id: 'b', name: 'Bia', cash: 5000, bens: 8000, bankrupt: false },
    ])
    assert.equal(winner.name, 'Bia')
  })

  it('11. falência continua encerrando corretamente', () => {
    const decision = decideEndgameAfterBankruptcy(
      [
        { id: 'a', name: 'Ana', bankrupt: true, cash: 0, bens: 0 },
        { id: 'b', name: 'Bia', bankrupt: false, cash: 2000, bens: 1000 },
      ],
      2,
    )
    assert.equal(decision.shouldEnd, true)
    assert.equal(decision.winner?.id, 'b')
  })

  it('12. patch final continua com kind ENDGAME', () => {
    const end = handoffAfterRoundTransition({
      endGame: true,
      shouldIncrementRound: false,
      nextRound: 2,
      maxRounds: 2,
    })
    assert.equal(end.kind, 'ENDGAME')
  })

  it('13. handoff após primeira volta de 2 rodadas continua kind TURN', () => {
    const mid = handoffAfterRoundTransition({
      endGame: false,
      shouldIncrementRound: true,
      nextRound: 2,
      maxRounds: 2,
    })
    assert.equal(mid.kind, 'TURN')
  })

  it('14. o próximo turno não é pulado nesse handoff', () => {
    const mid = handoffAfterRoundTransition({
      endGame: false,
      shouldIncrementRound: true,
      nextRound: 2,
      maxRounds: 2,
    })
    assert.equal(mid.skipNextTurn, false)
    assert.equal(mid.gameOver, false)
  })

  it('15. timer e auto-pass continuam com a mesma regra de prazo', () => {
    const now = 1_000_000
    const future = {
      now,
      turnDeadlineAt: now + 45_000,
      turnLock: false,
      gameOver: false,
      amCoordinator: true,
      turnPlayerId: 'a',
      turnSeq: 1,
    }
    assert.equal(shouldAttemptTimerAutoPass(future).ok, false)
    assert.equal(shouldAttemptTimerAutoPass(future).reason, 'not-expired')
    assert.equal(
      shouldAttemptTimerAutoPass({
        ...future,
        turnDeadlineAt: now,
      }).ok,
      true,
    )
  })
})
