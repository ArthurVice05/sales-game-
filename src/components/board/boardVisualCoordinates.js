export const BOARD_VISUAL_LAYOUTS = Object.freeze({
  'landscape-13x9': Object.freeze({ columns: 13, rows: 9 }),
  'portrait-8x14': Object.freeze({ columns: 8, rows: 14 }),
})

const validate = (index, layout) => {
  if (!Number.isInteger(index) || index < 0 || index >= 40) {
    throw new RangeError('Board visual index must be an integer from 0 through 39')
  }
  if (!Object.hasOwn(BOARD_VISUAL_LAYOUTS, layout)) {
    throw new RangeError(`Unknown board visual layout: ${layout}`)
  }
}

export function getBoardVisualCoordinate(index, layout = 'landscape-13x9') {
  validate(index, layout)
  const number = index + 1

  if (layout === 'portrait-8x14') {
    if (number <= 8) return { row: 1, column: number }
    if (number <= 20) return { row: number - 7, column: 8 }
    if (number <= 28) return { row: 14, column: 29 - number }
    return { row: 42 - number, column: 1 }
  }

  if (number <= 13) return { row: 1, column: number }
  if (number <= 20) return { row: number - 12, column: 13 }
  if (number <= 33) return { row: 9, column: 34 - number }
  return { row: 42 - number, column: 1 }
}
