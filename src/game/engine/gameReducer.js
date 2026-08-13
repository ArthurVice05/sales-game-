// src/game/engine/gameReducer.js
// ETAPA 2 — ENGINE (puro)
//
// reduceGame(state, action, ctx) -> { nextState, events }
// - Sem side-effects
// - Sem chamadas a supabase/broadcast/modais
//
// Nota: Nesta etapa inicial, implementamos apenas action: { type:'ROLL', steps:number }.
// O objetivo é "copiar" o fluxo atual de alto nível (move -> tile -> eventos) de forma conservadora.

import { computeMove } from '../domain/movement.js'
import { getTileType, tileNeedsModal } from '../domain/tiles.js'
import { canAct } from '../domain/locks.js'
import { getBoardDefinition, resolveBoardVersion } from '../../data/boardVersions.js'

const forwardDist = (from, to, len) => {
  const d = (to - from + len) % len
  return d === 0 ? len : d
}

// Mesmo comportamento do crossedTile (tileIndex é zero-based)
const crossedTile = (oldPos, newPos, tileIndex) => {
  if (oldPos === newPos) return false
  if (oldPos < newPos) return tileIndex > oldPos && tileIndex <= newPos
  return tileIndex > oldPos || tileIndex <= newPos // deu a volta
}

export function reduceGame(state, action, ctx) {
  const s = state || {}
  const a = action || {}
  const boardVersion = resolveBoardVersion(ctx?.boardVersion ?? s?.boardVersion)
  const board = getBoardDefinition(boardVersion)
  const trackLen = Number(ctx?.trackLen || 0) || board.trackLen
  const myUid = ctx?.myUid

  if (a.type !== 'ROLL') {
    return { nextState: s, events: [{ type: 'LOG', msg: `[engine] ignored action ${String(a.type)}` }] }
  }

  if (!canAct(s, myUid)) {
    return { nextState: s, events: [{ type: 'LOG', msg: '[engine] cannotAct -> ignore ROLL' }] }
  }

  const steps = Number(a.steps || 0)
  const curIdx = Number(s.turnIdx || 0)
  const players = Array.isArray(s.players) ? s.players : []
  const cur = players[curIdx]

  if (!cur) {
    return { nextState: s, events: [{ type: 'LOG', msg: '[engine] no current player' }] }
  }

  const oldPos = Number(cur.pos || 0)
  const { newPos, crossedStart, lapCount } = computeMove({ pos: oldPos, steps, trackLen })

  const landedOneBased = newPos + 1
  const tileType = getTileType(landedOneBased, boardVersion)

  const crossedRevenue = crossedTile(oldPos, newPos, 0) || crossedStart
  const crossedExpenses = crossedTile(oldPos, newPos, board.expensesIndex)

  const nextPlayers = players.map((p, i) => (i === curIdx ? { ...p, pos: newPos } : p))
  const nextState = { ...s, players: nextPlayers }

  // Eventos: mantém a mesma ideia do useTurnEngine (sequenciar revenue/expenses/luck)
  const events = []
  if (crossedRevenue) events.push({ type: 'REVENUE', at: forwardDist(oldPos, 0, trackLen) })
  if (crossedExpenses) events.push({ type: 'EXPENSES', at: forwardDist(oldPos, board.expensesIndex, trackLen) })
  if (tileType === 'LUCK') events.push({ type: 'LUCK', at: steps })

  events.sort((a1, a2) => Number(a1.at || 0) - Number(a2.at || 0))

  if (tileNeedsModal(tileType)) {
    events.push({ type: 'OPEN_MODAL', modal: tileType, payload: { pos: landedOneBased } })
  }

  events.unshift({
    type: 'LOG',
    msg: `[engine] ROLL steps=${steps} pos ${oldPos} -> ${newPos} (tile=${tileType}) lapCount=${lapCount}`,
  })

  // Conservador: não emite COMMIT/BROADCAST nesta etapa (fica para effects quando ENGINE_V2 estiver completo).
  return { nextState, events }
}

