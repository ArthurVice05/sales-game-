/**
 * Encerramento por rodadas após o tick de volta completa.
 * shouldIncrementRound = entrada na próxima rodada, não conclusão da rodada de destino.
 * endGame = todos os vivos completaram a volta já na rodada final.
 */

export function shouldFinishAfterRoundTransition({
  endGame,
  shouldIncrementRound,
  nextRound,
  maxRounds,
} = {}) {
  const completedFinalRound = endGame === true
  const advancedBeyondLimit =
    shouldIncrementRound === true &&
    Number(nextRound) > Number(maxRounds)
  return completedFinalRound || advancedBeyondLimit
}
