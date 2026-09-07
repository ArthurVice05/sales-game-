// Saída explícita no meio da partida = falência (eliminação), não desconexão.
// Funções puras — o motor só aplica o plano e faz broadcast.

import { countAlivePlayers, findNextAliveIdx } from './gameMath.js'

export function uniquePlayerCount(players = []) {
  const list = Array.isArray(players) ? players : []
  const ids = list
    .map((p) => p?.id)
    .filter((v) => v !== undefined && v !== null)
    .map((v) => String(v))
    .filter(Boolean)

  if (ids.length === 0) return list.length
  return new Set(ids).size
}

/** Mesmo efeito da falência declarada no motor. */
export function applyBankruptcyState(p = {}) {
  return {
    ...p,
    bankrupt: true,
    cash: 0,
    bens: 0,
    clients: 0,
    vendedoresComuns: 0,
    fieldSales: 0,
    insideSales: 0,
    gestores: 0,
    gestoresComerciais: 0,
    managers: 0,
    manutencao: 0,
    revenue: 0,
    loanPending: null,
    waitingAtRevenue: false,
    mixProdutos: 'D',
    erpLevel: 'D',
  }
}

export function pickAliveWinner(players = []) {
  const byId = new Map()
  for (const p of players || []) {
    const idRaw = p?.id
    const id = idRaw === undefined || idRaw === null ? '' : String(idRaw)
    if (!id) continue
    const entry = byId.get(id) || { bankrupt: false, player: null }
    if (p?.bankrupt) entry.bankrupt = true
    if (!p?.bankrupt && !entry.player) entry.player = p
    byId.set(id, entry)
  }
  for (const entry of byId.values()) {
    if (!entry.bankrupt && entry.player) return entry.player
  }
  return null
}

export function decideEndgameAfterBankruptcy(nextPlayers, initialPlayerCount = 0) {
  const initialN = Math.max(Number(initialPlayerCount) || 0, uniquePlayerCount(nextPlayers))
  const alive = countAlivePlayers(nextPlayers)

  const shouldEnd = initialN <= 1 ? alive === 0 : alive <= 1
  if (!shouldEnd) return { shouldEnd: false, alive, winner: null }

  return {
    shouldEnd: true,
    alive,
    winner: alive === 1 ? pickAliveWinner(nextPlayers) : null,
  }
}

/**
 * Planeja eliminar `playerId` como falido.
 * Funciona mesmo fora do turno desse jogador.
 */
export function planMatchForfeit({
  players,
  playerId,
  turnPlayerId,
  turnSeq,
  round,
  initialPlayerCount,
} = {}) {
  const list = Array.isArray(players) ? players : []
  const id = playerId != null ? String(playerId) : ''
  if (!id || list.length === 0) return null

  const playerIdx = list.findIndex((p) => String(p?.id) === id)
  if (playerIdx < 0) return null

  const target = list[playerIdx]
  if (target?.bankrupt) {
    return {
      ok: true,
      alreadyBankrupt: true,
      playerId: id,
      playerIdx,
      playerName: target?.name || 'Jogador',
      nextPlayers: list,
      shouldEnd: false,
      winner: null,
      wasTheirTurn: String(turnPlayerId ?? '') === id,
      turnChanged: false,
      nextTurnIdx: list.findIndex((p) => String(p?.id) === String(turnPlayerId ?? '')),
      nextTurnPlayerId: turnPlayerId != null ? String(turnPlayerId) : null,
      nextTurnSeq: Number(turnSeq) || 0,
      nextRound: Number(round) || 1,
    }
  }

  const nextPlayers = list.map((p) =>
    String(p?.id) === id ? applyBankruptcyState(p) : p
  )
  const decision = decideEndgameAfterBankruptcy(nextPlayers, initialPlayerCount)
  const wasTheirTurn = String(turnPlayerId ?? '') === id
  const baseSeq = Number(turnSeq) || 0
  const curTurnIdx = list.findIndex((p) => String(p?.id) === String(turnPlayerId ?? ''))

  if (decision.shouldEnd) {
    return {
      ok: true,
      alreadyBankrupt: false,
      playerId: id,
      playerIdx,
      playerName: target?.name || 'Jogador',
      nextPlayers,
      shouldEnd: true,
      winner: decision.winner,
      wasTheirTurn,
      turnChanged: false,
      nextTurnIdx: playerIdx,
      nextTurnPlayerId: turnPlayerId != null ? String(turnPlayerId) : id,
      nextTurnSeq: baseSeq,
      nextRound: Number(round) || 1,
    }
  }

  if (wasTheirTurn) {
    const nextTurnIdx = findNextAliveIdx(nextPlayers, playerIdx)
    const nextPlayer = nextPlayers[nextTurnIdx]
    const nextTurnPlayerId =
      nextPlayer?.id != null ? String(nextPlayer.id) : null
    return {
      ok: true,
      alreadyBankrupt: false,
      playerId: id,
      playerIdx,
      playerName: target?.name || 'Jogador',
      nextPlayers,
      shouldEnd: false,
      winner: null,
      wasTheirTurn: true,
      turnChanged: !!(nextTurnPlayerId && nextTurnPlayerId !== id),
      nextTurnIdx: nextTurnIdx >= 0 ? nextTurnIdx : 0,
      nextTurnPlayerId,
      nextTurnSeq: baseSeq + 1,
      nextRound: Number(round) || 1,
    }
  }

  return {
    ok: true,
    alreadyBankrupt: false,
    playerId: id,
    playerIdx,
    playerName: target?.name || 'Jogador',
    nextPlayers,
    shouldEnd: false,
    winner: null,
    wasTheirTurn: false,
    turnChanged: false,
    nextTurnIdx: curTurnIdx >= 0 ? curTurnIdx : 0,
    nextTurnPlayerId: turnPlayerId != null ? String(turnPlayerId) : null,
    nextTurnSeq: baseSeq,
    nextRound: Number(round) || 1,
  }
}

/**
 * Depois de applyBankruptcyState já aplicado no roster.
 * Mesma regra de decideEndgameAfterBankruptcy (humano) — sem segundo winner.
 */
export function resolveAftermathAfterBankruptcy({
  players,
  initialPlayerCount = 0,
  bankruptPlayerId,
} = {}) {
  const list = Array.isArray(players) ? players : []
  const decision = decideEndgameAfterBankruptcy(list, initialPlayerCount)
  if (decision.shouldEnd) {
    return {
      action: 'ENDGAME',
      shouldEnd: true,
      winner: decision.winner,
      emitHandoff: false,
      nextPlayers: list,
      nextTurnIdx: list.findIndex((p) => String(p?.id) === String(bankruptPlayerId ?? '')),
      nextTurnPlayerId: decision.winner?.id != null
        ? String(decision.winner.id)
        : (bankruptPlayerId != null ? String(bankruptPlayerId) : null),
    }
  }

  const idx = list.findIndex((p) => String(p?.id) === String(bankruptPlayerId ?? ''))
  const fromIdx = idx >= 0 ? idx : 0
  const nextTurnIdx = findNextAliveIdx(list, fromIdx)
  const nextPlayer = list[nextTurnIdx]
  return {
    action: 'CONTINUE',
    shouldEnd: false,
    winner: null,
    emitHandoff: true,
    nextPlayers: list,
    nextTurnIdx: nextTurnIdx >= 0 ? nextTurnIdx : 0,
    nextTurnPlayerId: nextPlayer?.id != null ? String(nextPlayer.id) : null,
  }
}

/**
 * Consumo idempotente do aftermath. ENDGAME no máximo uma vez.
 */
export function commitBankruptcyAftermath({
  aftermath,
  endGameFinalized = false,
  gameOver = false,
} = {}) {
  if (!aftermath) {
    return {
      emitEndgame: false,
      emitHandoff: false,
      clearPending: false,
      endGameFinalized: !!endGameFinalized,
      gameOver: !!gameOver,
      winner: null,
      alreadyFinalized: false,
    }
  }

  if (aftermath.shouldEnd) {
    if (endGameFinalized || gameOver) {
      return {
        emitEndgame: false,
        emitHandoff: false,
        clearPending: true,
        endGameFinalized: true,
        gameOver: true,
        winner: aftermath.winner,
        alreadyFinalized: true,
        kind: 'ENDGAME',
        lastAction: 'BANKRUPT',
      }
    }
    return {
      emitEndgame: true,
      emitHandoff: false,
      clearPending: true,
      endGameFinalized: true,
      gameOver: true,
      winner: aftermath.winner,
      alreadyFinalized: false,
      kind: 'ENDGAME',
      lastAction: 'BANKRUPT',
    }
  }

  return {
    emitEndgame: false,
    emitHandoff: true,
    clearPending: false,
    endGameFinalized: !!endGameFinalized,
    gameOver: false,
    winner: null,
    alreadyFinalized: false,
    rewritePending: {
      nextPlayers: aftermath.nextPlayers,
      nextTurnIdx: aftermath.nextTurnIdx,
      nextTurnPlayerId: aftermath.nextTurnPlayerId,
      meta: { kind: 'BANKRUPT' },
    },
  }
}
