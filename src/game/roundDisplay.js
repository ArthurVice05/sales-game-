/**
 * Exibição de progresso de rodadas no HUD.
 *
 * O motor continua 1-based (`round = 1` no START). A UI mostra rodadas
 * concluídas: início 0/N, após fechar a 1ª rodada 1/N, fim de jogo N/N.
 */
import { normalizeMaxRounds } from './roundConfig.js'

export function clampEngineRound(round, maxRounds) {
  const max = normalizeMaxRounds(maxRounds)
  const n = Number(round)
  if (!Number.isFinite(n)) return 1
  return Math.min(max, Math.max(1, n))
}

/**
 * @returns {{ completed: number, total: number, label: string }}
 */
export function formatRoundProgress(round, maxRounds, gameOver = false) {
  const total = normalizeMaxRounds(maxRounds)
  if (gameOver) {
    return { completed: total, total, label: `${total}/${total}` }
  }
  const engineRound = clampEngineRound(round, total)
  const completed = Math.max(0, engineRound - 1)
  return { completed, total, label: `${completed}/${total}` }
}
