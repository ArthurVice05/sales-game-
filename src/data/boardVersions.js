import { BOARD_40_CONFIG } from './board40Preview.js'

export const BOARD_VERSION_LEGACY = 'v1-55'
export const BOARD_VERSION_CURRENT = 'v2-40'

const DEFINITIONS = Object.freeze({
  [BOARD_VERSION_LEGACY]: Object.freeze({
    version: BOARD_VERSION_LEGACY,
    trackLen: 55,
    revenueIndex: 0,
    expensesIndex: 22,
    tiles: null,
  }),
  [BOARD_VERSION_CURRENT]: Object.freeze({
    version: BOARD_VERSION_CURRENT,
    trackLen: BOARD_40_CONFIG.length,
    revenueIndex: BOARD_40_CONFIG.find((tile) => tile.eventKind === 'REVENUE').index,
    expensesIndex: BOARD_40_CONFIG.find((tile) => tile.eventKind === 'EXPENSES').index,
    tiles: BOARD_40_CONFIG,
  }),
})

export function isSupportedBoardVersion(value) {
  return value === BOARD_VERSION_LEGACY || value === BOARD_VERSION_CURRENT
}

/** Snapshots sem versão são partidas legadas e jamais são convertidos. */
export function resolveBoardVersion(value) {
  if (value === undefined || value === null || value === '') {
    return BOARD_VERSION_LEGACY
  }
  if (!isSupportedBoardVersion(value)) {
    throw new RangeError(`Unsupported board version: ${String(value)}`)
  }
  return value
}

/** Único caminho autorizado para a criação explícita de partidas novas. */
export function getNewGameBoardVersion() {
  return BOARD_VERSION_CURRENT
}

export function getBoardDefinition(value) {
  return DEFINITIONS[resolveBoardVersion(value)]
}

export function haveCompatibleBoardVersions(left, right) {
  try {
    return resolveBoardVersion(left) === resolveBoardVersion(right)
  } catch {
    return false
  }
}
