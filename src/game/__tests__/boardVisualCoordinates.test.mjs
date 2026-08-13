import assert from 'node:assert/strict'
import test from 'node:test'

const visualModule = await import('../../components/board/boardVisualCoordinates.js').catch(() => ({
  BOARD_VISUAL_LAYOUTS: {},
  getBoardVisualCoordinate() {
    throw new Error('board visual coordinate adapter is not implemented')
  },
}))

const {
  BOARD_VISUAL_LAYOUTS,
  getBoardVisualCoordinate,
} = visualModule

const distance = (left, right) => (
  Math.abs(left.row - right.row) + Math.abs(left.column - right.column)
)

test('portrait layout maps all 40 canonical indexes to one unique 8 by 14 perimeter', () => {
  const coordinates = Array.from({ length: 40 }, (_, index) => (
    getBoardVisualCoordinate(index, 'portrait-8x14')
  ))

  assert.deepEqual(BOARD_VISUAL_LAYOUTS['portrait-8x14'], { columns: 8, rows: 14 })
  assert.equal(new Set(coordinates.map(({ row, column }) => `${row}:${column}`)).size, 40)
  for (const coordinate of coordinates) {
    assert.ok(coordinate.row >= 1 && coordinate.row <= 14)
    assert.ok(coordinate.column >= 1 && coordinate.column <= 8)
    assert.ok(
      coordinate.row === 1
      || coordinate.row === 14
      || coordinate.column === 1
      || coordinate.column === 8,
    )
  }
})

test('portrait layout follows the approved top right bottom and left segments', () => {
  const expected = new Map([
    [0, { row: 1, column: 1 }],
    [7, { row: 1, column: 8 }],
    [8, { row: 2, column: 8 }],
    [19, { row: 13, column: 8 }],
    [20, { row: 14, column: 8 }],
    [27, { row: 14, column: 1 }],
    [28, { row: 13, column: 1 }],
    [39, { row: 2, column: 1 }],
  ])

  for (const [index, coordinate] of expected) {
    assert.deepEqual(getBoardVisualCoordinate(index, 'portrait-8x14'), coordinate)
  }
})

test('both visual layouts keep every consecutive tile adjacent and close 40 to 01', () => {
  for (const layout of ['landscape-13x9', 'portrait-8x14']) {
    const coordinates = Array.from({ length: 40 }, (_, index) => (
      getBoardVisualCoordinate(index, layout)
    ))
    for (let index = 0; index < 39; index += 1) {
      assert.equal(distance(coordinates[index], coordinates[index + 1]), 1, `${layout}: ${index + 1}->${index + 2}`)
    }
    assert.equal(distance(coordinates[39], coordinates[0]), 1, `${layout}: 40->01`)
  }
})

test('desktop layout preserves the approved 13 by 9 coordinates', () => {
  assert.deepEqual(BOARD_VISUAL_LAYOUTS['landscape-13x9'], { columns: 13, rows: 9 })
  assert.deepEqual(getBoardVisualCoordinate(0, 'landscape-13x9'), { row: 1, column: 1 })
  assert.deepEqual(getBoardVisualCoordinate(12, 'landscape-13x9'), { row: 1, column: 13 })
  assert.deepEqual(getBoardVisualCoordinate(20, 'landscape-13x9'), { row: 9, column: 13 })
  assert.deepEqual(getBoardVisualCoordinate(39, 'landscape-13x9'), { row: 2, column: 1 })
})

test('visual adapter rejects invalid indexes and layouts without coercing logical positions', () => {
  for (const invalidIndex of [-1, 40, 1.5, Number.NaN, '1']) {
    assert.throws(() => getBoardVisualCoordinate(invalidIndex, 'portrait-8x14'), RangeError)
  }
  assert.throws(() => getBoardVisualCoordinate(0, 'unknown'), RangeError)
})
