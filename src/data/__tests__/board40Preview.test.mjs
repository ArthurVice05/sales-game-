import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'

import {
  BOARD_40_PREVIEW,
  BOARD_40_TYPES,
  getBoard40GridPosition,
} from '../board40Preview.js'
import {
  BOARD_PREVIEW_ART_SOURCE,
  BOARD_PREVIEW_CENTER_SOURCE,
  BOARD_40_VISUALS,
  isBoardPreviewPresentation,
} from '../../components/board/previewPresentation.js'

const EXPECTED_NUMBERS = Array.from({ length: 40 }, (_, index) => index + 1)
const ALLOWED_TYPES = new Set([
  'START_REVENUE',
  'CLIENTS',
  'ERP',
  'INSIDE',
  'MANAGER',
  'TRAINING',
  'FIELD',
  'DIRECT_BUY',
  'COMMON',
  'EXPENSES',
  'MIX',
  'LUCK',
])

const manhattanDistance = (a, b) => (
  Math.abs(a.row - b.row) + Math.abs(a.column - b.column)
)

test('contains exactly the numbered sequence from 1 through 40', () => {
  assert.equal(BOARD_40_PREVIEW.length, 40)
  assert.deepEqual(
    BOARD_40_PREVIEW.map(({ number }) => number),
    EXPECTED_NUMBERS,
  )
  assert.equal(new Set(BOARD_40_PREVIEW.map(({ number }) => number)).size, 40)
})

test('assigns one unique grid coordinate to every tile', () => {
  const coordinates = BOARD_40_PREVIEW.map(({ row, column }) => `${row}:${column}`)
  assert.equal(new Set(coordinates).size, 40)
})

test('keeps every coordinate inside the 13 by 9 grid perimeter', () => {
  for (const { number, row, column } of BOARD_40_PREVIEW) {
    assert.ok(row >= 1 && row <= 9, `tile ${number} row ${row} is outside 1..9`)
    assert.ok(column >= 1 && column <= 13, `tile ${number} column ${column} is outside 1..13`)
    assert.ok(
      row === 1 || row === 9 || column === 1 || column === 13,
      `tile ${number} is not on the perimeter`,
    )
  }
})

test('maps corners and side transitions to the approved coordinates', () => {
  const expected = new Map([
    [1, { row: 1, column: 1 }],
    [13, { row: 1, column: 13 }],
    [14, { row: 2, column: 13 }],
    [20, { row: 8, column: 13 }],
    [21, { row: 9, column: 13 }],
    [33, { row: 9, column: 1 }],
    [34, { row: 8, column: 1 }],
    [40, { row: 2, column: 1 }],
  ])

  for (const [number, coordinate] of expected) {
    assert.deepEqual(getBoard40GridPosition(number), coordinate)
    const tile = BOARD_40_PREVIEW[number - 1]
    assert.deepEqual({ row: tile.row, column: tile.column }, coordinate)
  }
})

test('rejects tile numbers outside the 1 through 40 preview', () => {
  for (const invalid of [0, 41, -1, 1.5, Number.NaN, '1']) {
    assert.throws(
      () => getBoard40GridPosition(invalid),
      { name: 'RangeError' },
    )
  }
})

test('keeps each consecutive pair adjacent and closes tile 40 back to tile 1', () => {
  for (let index = 0; index < BOARD_40_PREVIEW.length - 1; index += 1) {
    assert.equal(
      manhattanDistance(BOARD_40_PREVIEW[index], BOARD_40_PREVIEW[index + 1]),
      1,
      `tiles ${index + 1} and ${index + 2} are not adjacent`,
    )
  }

  assert.equal(manhattanDistance(BOARD_40_PREVIEW[39], BOARD_40_PREVIEW[0]), 1)
})

test('uses LUCK only on tiles 10, 20, 30, and 40', () => {
  assert.deepEqual(
    BOARD_40_PREVIEW
      .filter(({ type }) => type === 'LUCK')
      .map(({ number }) => number),
    [10, 20, 30, 40],
  )
})

test('uses only the approved canonical visual types', () => {
  assert.deepEqual(new Set(BOARD_40_TYPES), ALLOWED_TYPES)
  for (const { number, type } of BOARD_40_PREVIEW) {
    assert.ok(ALLOWED_TYPES.has(type), `tile ${number} has unsupported type ${type}`)
  }
})

test('provides every required field with a non-empty label', () => {
  for (const tile of BOARD_40_PREVIEW) {
    assert.equal(typeof tile.number, 'number')
    assert.equal(typeof tile.type, 'string')
    assert.equal(typeof tile.label, 'string')
    assert.ok(tile.label.trim().length > 0, `tile ${tile.number} has no label`)
    assert.equal(typeof tile.row, 'number')
    assert.equal(typeof tile.column, 'number')
  }
})

test('is deeply frozen against accidental runtime mutation', () => {
  assert.ok(Object.isFrozen(BOARD_40_TYPES))
  assert.ok(Object.isFrozen(BOARD_40_PREVIEW))
  assert.ok(BOARD_40_PREVIEW.every((tile) => Object.isFrozen(tile)))

  assert.throws(() => BOARD_40_PREVIEW.push({}), TypeError)
  assert.throws(() => { BOARD_40_PREVIEW[0].label = 'Changed' }, TypeError)
})

test('maps every category to one original icon asset and approved unbroken label lines', () => {
  const expectedVisuals = {
    START_REVENUE: ['/board-icons/start-revenue.png', ['INÍCIO', 'FATURAMENTO']],
    CLIENTS: ['/board-icons/clients.png', ['CARTEIRA', 'DE CLIENTES']],
    ERP: ['/board-icons/erp.png', ['ERP']],
    INSIDE: ['/board-icons/inside-sales.png', ['INSIDE SALES']],
    MANAGER: ['/board-icons/manager.png', ['GESTOR', 'COMERCIAL']],
    TRAINING: ['/board-icons/training.png', ['TREINAMENTO']],
    FIELD: ['/board-icons/field-sales.png', ['FIELD SALES']],
    DIRECT_BUY: ['/board-icons/direct-buy.png', ['DIREITO', 'DE COMPRA']],
    COMMON: ['/board-icons/common-seller.png', ['VENDEDOR', 'COMUM']],
    EXPENSES: ['/board-icons/expenses.png', ['DESPESAS', 'OPERACIONAIS']],
    MIX: ['/board-icons/product-mix.png', ['MIX DE', 'PRODUTOS']],
    LUCK: ['/board-icons/luck.png', ['SORTE &', 'REVÉS']],
  }

  assert.deepEqual(Object.keys(BOARD_40_VISUALS).sort(), [...BOARD_40_TYPES].sort())

  for (const [type, [icon, labelLines]] of Object.entries(expectedVisuals)) {
    assert.equal(BOARD_40_VISUALS[type].icon, icon)
    assert.deepEqual(BOARD_40_VISUALS[type].labelLines, labelLines)
    assert.ok(labelLines.every((line) => !line.includes('\n')))
  }
})

test('enables the clean presentation only for presentation=1', () => {
  assert.equal(isBoardPreviewPresentation('?presentation=1'), true)
  assert.equal(isBoardPreviewPresentation('presentation=1'), true)
  assert.equal(isBoardPreviewPresentation('?presentation=0'), false)
  assert.equal(isBoardPreviewPresentation(''), false)
})

test('uses the user-provided approved board art as the preview source', () => {
  assert.equal(
    BOARD_PREVIEW_ART_SOURCE,
    '/76419375-9805-4f12-b48d-cf19f1cb4ac2.png',
  )
  assert.equal(BOARD_PREVIEW_CENTER_SOURCE, '/board-center.png')
})

test('provides one transparent 96px PNG asset for every visual category', async () => {
  for (const [type, { icon }] of Object.entries(BOARD_40_VISUALS)) {
    const assetUrl = new URL(`../../../public${icon}`, import.meta.url)
    const bytes = await readFile(fileURLToPath(assetUrl))

    assert.deepEqual(
      [...bytes.subarray(0, 8)],
      [137, 80, 78, 71, 13, 10, 26, 10],
      `${type} icon is not a PNG`,
    )
    assert.equal(bytes.readUInt32BE(16), 96, `${type} icon width differs from 96px`)
    assert.equal(bytes.readUInt32BE(20), 96, `${type} icon height differs from 96px`)
    assert.equal(bytes[25], 6, `${type} icon must use RGBA transparency`)
  }
})
