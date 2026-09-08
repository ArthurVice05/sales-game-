/** Aspecto oficial do board v2-40 no landscape. Não altera geometria interna. */
export const BOARD_ASPECT = 13 / 9

/**
 * Maior retângulo 13:9 que cabe no slot. Escala uniforme (nunca eixos independentes).
 */
export function fitBoardInSlot(availableWidth, availableHeight, aspect = BOARD_ASPECT) {
  const aw = Number(availableWidth)
  const ah = Number(availableHeight)
  if (!(aw > 0) || !(ah > 0) || !(aspect > 0)) {
    return { width: 0, height: 0 }
  }
  const widthLimited = aw / aspect
  if (widthLimited <= ah) {
    return { width: aw, height: widthLimited }
  }
  return { width: ah * aspect, height: ah }
}

export function boardFitsSlot(board, slot, epsilon = 0.6) {
  if (!board || !slot) return false
  return (
    board.left >= slot.left - epsilon &&
    board.top >= slot.top - epsilon &&
    board.right <= slot.right + epsilon &&
    board.bottom <= slot.bottom + epsilon
  )
}
