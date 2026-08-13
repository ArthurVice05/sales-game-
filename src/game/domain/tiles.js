// src/game/domain/tiles.js
// ETAPA 1 — DOMAIN (puro)
// Mapeamento de casas do tabuleiro -> tipos de evento/modal.
//
// IMPORTANTE: este mapping deve ser idêntico ao atual em `useTurnEngine.jsx`.

import { BOARD_40_CONFIG } from '../../data/board40Preview.js'
import {
  BOARD_VERSION_CURRENT,
  resolveBoardVersion,
} from '../../data/boardVersions.js'

const LEGACY_SETS = {
  ERP: new Set([6, 16, 32, 49]),
  TRAINING: new Set([2, 11, 19, 47]),
  DIRECT_BUY: new Set([5, 10, 43]),
  INSIDE: new Set([12, 21, 30, 42, 53]),
  CLIENTS: new Set([4, 8, 15, 17, 20, 27, 34, 36, 39, 46, 52, 55]),
  MANAGER: new Set([18, 24, 29, 51]),
  FIELD: new Set([13, 25, 33, 38, 50]),
  COMMON: new Set([9, 28, 40, 45]),
  MIX: new Set([7, 31, 44]),
  LUCK: new Set([3, 14, 22, 26, 35, 41, 48, 54]),
}

const BOARD_40_BY_NUMBER = new Map(BOARD_40_CONFIG.map((tile) => [tile.number, tile]))

export function getTileType(pos1Based, boardVersion) {
  const p = Number(pos1Based)
  if (!Number.isFinite(p) || p < 1) return 'UNKNOWN'

  if (resolveBoardVersion(boardVersion) === BOARD_VERSION_CURRENT) {
    const eventKind = BOARD_40_BY_NUMBER.get(p)?.eventKind
    // Faturamento e despesas são eventos de passagem, não modais de chegada.
    if (eventKind === 'REVENUE' || eventKind === 'EXPENSES') return 'NONE'
    return eventKind || 'UNKNOWN'
  }

  if (LEGACY_SETS.ERP.has(p)) return 'ERP'
  if (LEGACY_SETS.TRAINING.has(p)) return 'TRAINING'
  if (LEGACY_SETS.DIRECT_BUY.has(p)) return 'DIRECT_BUY'
  if (LEGACY_SETS.INSIDE.has(p)) return 'INSIDE'
  if (LEGACY_SETS.CLIENTS.has(p)) return 'CLIENTS'
  if (LEGACY_SETS.MANAGER.has(p)) return 'MANAGER'
  if (LEGACY_SETS.FIELD.has(p)) return 'FIELD'
  if (LEGACY_SETS.COMMON.has(p)) return 'COMMON'
  if (LEGACY_SETS.MIX.has(p)) return 'MIX'
  if (LEGACY_SETS.LUCK.has(p)) return 'LUCK'
  return 'NONE'
}

export function tileNeedsModal(tileType) {
  // No comportamento atual: qualquer tile especial dispara um modal (ou menu/modal).
  return tileType !== 'NONE' && tileType !== 'UNKNOWN'
}

export function getTileSetsForDebug() {
  // Útil para comparadores/baseline sem expor Sets mutáveis diretamente.
  return Object.fromEntries(Object.entries(LEGACY_SETS).map(([k, v]) => [k, Array.from(v.values())]))
}

