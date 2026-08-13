import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'

import {
  BOARD_40_CONFIG,
  getDeterministicTokenSlots,
} from '../../data/board40Preview.js'
import {
  BOARD_VERSION_CURRENT,
  BOARD_VERSION_LEGACY,
  getBoardDefinition,
  getNewGameBoardVersion,
  haveCompatibleBoardVersions,
  resolveBoardVersion,
} from '../../data/boardVersions.js'
import { computeMove } from '../domain/movement.js'
import { getTileType } from '../domain/tiles.js'
import { reduceGame } from '../engine/gameReducer.js'

const numbers = (type) => BOARD_40_CONFIG
  .filter((tile) => tile.type === type)
  .map((tile) => tile.number)

test('v2-40 is one immutable 40-tile configuration with complete unique fields', () => {
  assert.equal(BOARD_40_CONFIG.length, 40)
  assert.deepEqual(BOARD_40_CONFIG.map((tile) => tile.index), [...Array(40).keys()])
  assert.deepEqual(BOARD_40_CONFIG.map((tile) => tile.number), Array.from({ length: 40 }, (_, i) => i + 1))
  assert.equal(new Set(BOARD_40_CONFIG.map((tile) => `${tile.gridRow}:${tile.gridColumn}`)).size, 40)

  for (const tile of BOARD_40_CONFIG) {
    assert.equal(tile.number, tile.index + 1)
    assert.equal(tile.row, tile.gridRow)
    assert.equal(tile.column, tile.gridColumn)
    assert.equal(typeof tile.label, 'string')
    assert.match(tile.icon, /^\/board-icons\/[a-z-]+\.png$/)
    assert.ok(Array.isArray(tile.labelLines) && tile.labelLines.length > 0)
    assert.ok(Object.isFrozen(tile.labelLines))
    assert.equal(typeof tile.eventKind, 'string')
    assert.ok(tile.tokenCenter.nx > 0 && tile.tokenCenter.nx < 1)
    assert.ok(tile.tokenCenter.ny > 0 && tile.tokenCenter.ny < 1)
    assert.ok(Object.isFrozen(tile.tokenCenter))
    assert.ok(Object.isFrozen(tile))
  }
})

test('v2-40 keeps the approved event map', () => {
  assert.equal(BOARD_40_CONFIG[0].type, 'START_REVENUE')
  assert.equal(BOARD_40_CONFIG[0].eventKind, 'REVENUE')
  assert.equal(BOARD_40_CONFIG[24].type, 'EXPENSES')
  assert.equal(BOARD_40_CONFIG[24].eventKind, 'EXPENSES')
  assert.deepEqual(numbers('LUCK'), [10, 20, 30, 40])
  assert.deepEqual(
    Object.fromEntries([...new Set(BOARD_40_CONFIG.map((tile) => tile.type))]
      .map((type) => [type, numbers(type).length])),
    {
      START_REVENUE: 1,
      CLIENTS: 9,
      ERP: 3,
      INSIDE: 4,
      MANAGER: 3,
      TRAINING: 3,
      FIELD: 4,
      DIRECT_BUY: 3,
      LUCK: 4,
      COMMON: 3,
      EXPENSES: 1,
      MIX: 2,
    },
  )
})

test('board versions default old snapshots to v1-55 and new matches to v2-40', () => {
  assert.equal(BOARD_VERSION_LEGACY, 'v1-55')
  assert.equal(BOARD_VERSION_CURRENT, 'v2-40')
  assert.equal(resolveBoardVersion(undefined), BOARD_VERSION_LEGACY)
  assert.equal(resolveBoardVersion(null), BOARD_VERSION_LEGACY)
  assert.equal(getNewGameBoardVersion(), BOARD_VERSION_CURRENT)
  assert.equal(getBoardDefinition(BOARD_VERSION_LEGACY).trackLen, 55)
  assert.equal(getBoardDefinition(BOARD_VERSION_LEGACY).expensesIndex, 22)
  assert.equal(getBoardDefinition(BOARD_VERSION_CURRENT).trackLen, 40)
  assert.equal(getBoardDefinition(BOARD_VERSION_CURRENT).expensesIndex, 24)
  assert.equal(haveCompatibleBoardVersions(BOARD_VERSION_CURRENT, BOARD_VERSION_CURRENT), true)
  assert.equal(haveCompatibleBoardVersions(BOARD_VERSION_CURRENT, undefined), false)
})

test('movement is circular at 40 -> 01 without changing the official position contract', () => {
  assert.deepEqual(
    computeMove({ pos: 39, steps: 1, trackLen: getBoardDefinition(BOARD_VERSION_CURRENT).trackLen }),
    { newPos: 0, crossedStart: true, lapCount: 1 },
  )
  assert.equal(computeMove({ pos: 38, steps: 6, trackLen: 40 }).newPos, 4)
})

test('players sharing one tile receive stable non-overlapping token slots', () => {
  const forward = [
    { player: { id: 'c' }, position: 9 },
    { player: { id: 'a' }, position: 9 },
    { player: { id: 'b' }, position: 9 },
  ]
  const reversed = [...forward].reverse()
  const slotsA = getDeterministicTokenSlots(forward)
  const slotsB = getDeterministicTokenSlots(reversed)

  assert.deepEqual([...slotsA.entries()].sort(), [...slotsB.entries()].sort())
  assert.deepEqual([...slotsA.values()].sort(), [0, 1, 2])
})

test('tile modal mapping is version-aware and keeps the legacy map intact', () => {
  assert.equal(getTileType(10, BOARD_VERSION_CURRENT), 'LUCK')
  assert.equal(getTileType(25, BOARD_VERSION_CURRENT), 'NONE')
  assert.equal(getTileType(22, BOARD_VERSION_CURRENT), 'DIRECT_BUY')
  assert.equal(getTileType(3, BOARD_VERSION_LEGACY), 'LUCK')
  assert.equal(getTileType(23, BOARD_VERSION_LEGACY), 'NONE')

  for (const tile of BOARD_40_CONFIG) {
    const expectedModal = tile.arrivalEvent || 'NONE'
    assert.equal(
      getTileType(tile.number, BOARD_VERSION_CURRENT),
      expectedModal,
      `tile ${tile.number} must route to ${expectedModal}`,
    )
  }
})

test('reducer emits passage before arrival for v2-40 and uses index 24 for expenses', () => {
  const base = {
    players: [{ id: 'p1', pos: 23 }],
    turnIdx: 0,
    turnPlayerId: 'p1',
    turnLock: false,
    lockOwner: null,
  }

  const expenses = reduceGame(base, { type: 'ROLL', steps: 2 }, {
    myUid: 'p1',
    boardVersion: BOARD_VERSION_CURRENT,
  })
  assert.equal(expenses.nextState.players[0].pos, 25)
  assert.deepEqual(expenses.events.filter((event) => event.type !== 'LOG'), [
    { type: 'EXPENSES', at: 1 },
    { type: 'OPEN_MODAL', modal: 'CLIENTS', payload: { pos: 26 } },
  ])

  const startThenArrival = reduceGame(
    { ...base, players: [{ id: 'p1', pos: 38 }] },
    { type: 'ROLL', steps: 3 },
    { myUid: 'p1', boardVersion: BOARD_VERSION_CURRENT },
  )
  assert.deepEqual(startThenArrival.events.filter((event) => event.type !== 'LOG'), [
    { type: 'REVENUE', at: 2 },
    { type: 'OPEN_MODAL', modal: 'CLIENTS', payload: { pos: 2 } },
  ])
})

test('legacy reducer never coerces a saved position through the 40-tile map', () => {
  const result = reduceGame({
    players: [{ id: 'old', pos: 54 }],
    turnIdx: 0,
    turnPlayerId: 'old',
    turnLock: false,
  }, { type: 'ROLL', steps: 1 }, {
    myUid: 'old',
    boardVersion: resolveBoardVersion(undefined),
  })

  assert.equal(result.nextState.players[0].pos, 0)
  assert.ok(result.events.some((event) => event.type === 'REVENUE'))
})

test('production wiring preserves boardVersion and visual clicks have no game callback', async () => {
  const appSource = await readFile(new URL('../../App.jsx', import.meta.url), 'utf8')
  const engineSource = await readFile(new URL('../useTurnEngine.jsx', import.meta.url), 'utf8')
  const tileSource = await readFile(new URL('../../components/board/BoardTile.jsx', import.meta.url), 'utf8')
  const boardSource = await readFile(new URL('../../components/board/LandscapeBoard.jsx', import.meta.url), 'utf8')

  assert.match(appSource, /boardVersion=\{boardVersion\}/)
  assert.match(appSource, /boardVersion:\s*safeBoardVersion/)
  assert.match(appSource, /boardVersion:\s*startBoardVersion/)
  assert.match(
    appSource,
    /function broadcastState[\s\S]*?const safeBoardVersion = resolveBoardVersion\([\s\S]*?patch\.boardVersion/,
  )
  const commitPatchSource = appSource.slice(
    appSource.indexOf('const commitGamePatch'),
    appSource.indexOf('function broadcastState'),
  )
  assert.doesNotMatch(commitPatchSource, /patch\.boardVersion/)
  assert.match(engineSource, /getTileType\(landedOneBased, resolvedBoardVersion\)/)
  assert.doesNotMatch(engineSource, /import\s*\{\s*TRACK_LEN\s*\}/)
  assert.match(tileSource, /onClick=\{\(\) => onSelect\?\.\(tile\)\}/)
  assert.doesNotMatch(tileSource, /setPlayers|broadcastState|cashDelta|onAction/)
  assert.doesNotMatch(boardSource, /Pr[eé]via do tabuleiro|TIPO CAN[ÔO]NICO|COORDENADA|FASE 1/i)
  assert.match(boardSource, /getDeterministicTokenSlots/)
})
