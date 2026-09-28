import { getBoardDefinition, getNewGameBoardVersion } from '../data/boardVersions.js'
import { BOARD_40_TYPES } from '../data/board40Preview.js'
import { createInitialPlayerState } from '../game/createInitialPlayer.js'
import { resolveFinalRoundMove } from '../game/resolveFinalRoundMove.js'
import {
  applyDeltas,
  applyTrainingPurchase,
  capacityAndAttendance,
  computeDespesasFor,
  computeFaturamentoFor,
} from '../game/gameMath.js'
import { previewPurchaseImpact } from '../game/purchasePreview.js'
import { computePatrimonio, rankPlayersByPatrimonio } from '../game/patrimonio.js'
import { VENDOR_RULES, ERP_RULES, MIX_RULES, CERT_EFFECTS } from '../game/gameRules.js'
import { MANUAL_CONSTANTS, MIX_PURCHASE_PRICES } from '../game/manualConstants.js'
import { buildClientsPurchaseDeltas } from '../game/clientsPurchase.js'
import { buildInsideSalesPurchaseDeltas } from '../game/insideSalesPurchase.js'
import { buildFieldSalesPurchaseDeltas } from '../game/fieldSalesPurchase.js'
import { buildCommonSellersPurchaseDeltas } from '../game/commonSellersPurchase.js'
import { buildManagerPurchaseDeltas } from '../game/managersPurchase.js'
import { buildErpPurchaseDeltas } from '../game/erpPurchase.js'
import { buildMixPurchaseDeltas } from '../game/productMixPurchase.js'
import { SORTE_REVES_CARDS, resolveSorteRevesCard } from '../game/sorteRevesCards.js'
import { applySorteRevesPayloadToPlayer } from '../game/sorteRevesApply.js'
import { applyMonthlyRevenueCredit } from '../game/revenueCredit.js'
import { applyRecoveryPayloadToPlayer, validateReduceSelection } from '../game/bots/botRecoveryApply.js'
import { applyBankruptcyState, decideEndgameAfterBankruptcy } from '../game/matchForfeit.js'
import {
  applyLoanTake,
  applyLoanCharge,
  armLoanAfterRevenue,
  buildRecoveryFireDeltas,
  canTakeLoan,
  clampLoanAmount,
  ensureLoanId,
  loanChargeAmount,
  shouldChargeLoan,
} from '../game/loanCycle.js'
import { DEFAULT_MAX_ROUNDS, normalizeMaxRounds } from '../game/roundConfig.js'

export const CALC_STORAGE_KEY = 'sg:physical-calc:v1'
const BOARD = getBoardDefinition(getNewGameBoardVersion())
const DIRECT_BUY_KINDS = BOARD_40_TYPES.filter((kind) => !['START_REVENUE', 'DIRECT_BUY', 'EXPENSES', 'LUCK'].includes(kind))

const snapshot = (game) => ({
  players: game.players.map((player) => structuredClone(player)),
  round: game.round,
  currentPlayerIndex: game.currentPlayerIndex,
  gameOver: game.gameOver,
})

export function createCalcGame(names, requestedRounds = DEFAULT_MAX_ROUNDS) {
  const clean = (names || []).map((name) => String(name || '').trim()).filter(Boolean)
  if (clean.length < 2 || clean.length > 4) throw new RangeError('Escolha de 2 a 4 jogadores.')
  if (new Set(clean.map((name) => name.toLocaleLowerCase('pt-BR'))).size !== clean.length) {
    throw new Error('Use nomes diferentes para os jogadores.')
  }
  return {
    boardVersion: getNewGameBoardVersion(),
    maxRounds: normalizeMaxRounds(requestedRounds),
    round: 1,
    currentPlayerIndex: 0,
    players: clean.map((name, seat) => createInitialPlayerState({ id: `calc-${seat + 1}`, name, seat })),
    gameOver: false,
    history: [],
  }
}

export function planCalcTurn(game, dice) {
  if (game?.gameOver) throw new Error('A partida está encerrada.')
  if (!Number.isInteger(dice) || dice < 1 || dice > 6) throw new RangeError('O dado deve ser de 1 a 6.')
  const current = game.players[game.currentPlayerIndex]
  if (!current || current.bankrupt || current.waitingAtRevenue) throw new Error('Jogador indisponível.')
  const movement = resolveFinalRoundMove({
    oldPos: current.pos,
    steps: dice,
    trackLen: BOARD.trackLen,
    roundNow: game.round,
    maxRounds: game.maxRounds,
    aliveCount: game.players.filter((player) => !player.bankrupt).length,
    prevWaitingAtRevenue: current.waitingAtRevenue,
    prevLastRevenueRound: current.lastRevenueRound,
  })
  const path = []
  for (let step = 1; step <= dice; step += 1) {
    const house = ((current.pos + step) % BOARD.trackLen) + 1
    path.push(house)
    if (movement.stopAtRevenue && house === BOARD.revenueIndex + 1) break
  }
  const events = path.flatMap((house) => {
    const tile = BOARD.tiles[house - 1]
    return tile?.passageEvent ? [{ kind: tile.passageEvent, house, label: tile.label }] : []
  })
  const destination = movement.finalPos + 1
  const destinationTile = BOARD.tiles[movement.finalPos]
  if (movement.processLandTile && destinationTile?.arrivalEvent) {
    events.push({ kind: destinationTile.arrivalEvent, house: destination, label: destinationTile.label })
  }
  return {
    playerId: current.id,
    startPosition: current.pos + 1,
    dice,
    destination,
    path,
    events,
    eventIndex: 0,
    player: { ...current, pos: movement.finalPos, waitingAtRevenue: movement.waitingAtRevenue, lastRevenueRound: movement.lastRevenueRound },
    actions: [],
  }
}

export function previewCalcPurchase(player, kind, selection = {}) {
  const qty = Number(selection.qty ?? 1)
  const level = String(selection.level || '').toUpperCase()
  let cost = 0
  let deltas = null
  let afterPlayer = null
  let impact = null
  let label = ''
  if (['CLIENTS', 'FIELD', 'INSIDE', 'COMMON', 'MANAGER'].includes(kind)) {
    if (!Number.isInteger(qty) || qty < 1) throw new RangeError('Escolha uma quantidade válida.')
    const prices = {
      CLIENTS: MANUAL_CONSTANTS.clientPrice,
      FIELD: VENDOR_RULES.field.hire,
      INSIDE: VENDOR_RULES.inside.hire,
      COMMON: MANUAL_CONSTANTS.commonHire,
      MANAGER: MANUAL_CONSTANTS.managerHire,
    }
    cost = qty * prices[kind]
    const vendorRule = { FIELD: VENDOR_RULES.field, COMMON: VENDOR_RULES.comum, MANAGER: VENDOR_RULES.gestor }[kind]
    const payload = {
      qty, headcount: qty, totalCost: cost, totalHire: cost,
      totalExpense: qty * (vendorRule?.baseDesp || 0),
      expenseDelta: qty * (vendorRule?.baseDesp || 0),
      revenueDelta: qty * (vendorRule?.baseFat || 0),
      total: cost,
    }
    if (kind === 'CLIENTS') {
      payload.maintenanceDelta = qty * MANUAL_CONSTANTS.clientPortfolioDesp
      payload.bensDelta = cost
      deltas = buildClientsPurchaseDeltas(payload)
      label = `${qty} cliente(s)`
    } else if (kind === 'FIELD') {
      deltas = buildFieldSalesPurchaseDeltas(payload)
      label = `${qty} representante(s)`
    } else if (kind === 'INSIDE') {
      deltas = buildInsideSalesPurchaseDeltas(payload)
      label = `${qty} Inside Sales`
    } else if (kind === 'COMMON') {
      deltas = buildCommonSellersPurchaseDeltas(payload)
      label = `${qty} vendedor(es) comum(ns)`
    } else {
      deltas = buildManagerPurchaseDeltas(payload)
      label = `${qty} gestor(es)`
    }
  } else if (kind === 'ERP' || kind === 'MIX') {
    if (!['A', 'B', 'C', 'D'].includes(level)) throw new RangeError('Selecione um nível válido.')
    const current = String(kind === 'ERP' ? player.erpLevel : player.mixProdutos || 'D').toUpperCase()
    if (level === current) throw new Error('Esse nível já está em uso.')
    if (kind === 'ERP') {
      cost = ERP_RULES[level].price
      deltas = buildErpPurchaseDeltas({ level, values: { compra: cost } })
    } else {
      cost = MIX_PURCHASE_PRICES[level]
      deltas = buildMixPurchaseDeltas({ level, compra: cost, despesa: MIX_RULES[level].despPerClient, faturamento: MIX_RULES[level].fatPerClient })
    }
    label = `${kind === 'ERP' ? 'ERP' : 'Mix'} nível ${level}`
  } else if (kind === 'TRAINING') {
    const vendorType = String(selection.vendorType || '')
    const certId = String(selection.certId || '')
    const owned = player.trainingsByVendor?.[vendorType] || []
    const staff = { comum: player.vendedoresComuns, inside: player.insideSales, field: player.fieldSales, gestor: player.gestores }
    if (!CERT_EFFECTS[certId] || !Number(staff[vendorType]) || owned.includes(certId)) {
      throw new Error('Treinamento indisponível para esse colaborador.')
    }
    cost = MANUAL_CONSTANTS.trainingPrice
    const payload = { purchases: [{ vendorType, items: [{ id: certId, price: cost }] }], grandTotal: cost }
    afterPlayer = applyTrainingPurchase(player, payload)
    const metrics = (value) => ({
      cash: Number(value.cash || 0),
      revenue: computeFaturamentoFor(value),
      expenses: computeDespesasFor(value),
      capacity: capacityAndAttendance(value).cap,
      patrimonio: computePatrimonio(value),
    })
    impact = { current: metrics(player), after: metrics(afterPlayer), immediateCost: cost }
    label = `Treinamento ${CERT_EFFECTS[certId].label}`
  } else {
    throw new Error('Compra indisponível nesta casa.')
  }
  if (!afterPlayer) {
    impact = previewPurchaseImpact({ player, deltas, immediateCost: cost })
    afterPlayer = applyDeltas(player, deltas)
  }
  return { cost, deltas, impact, afterPlayer, label }
}

export function getCalcEventPreview(turn, round) {
  const event = turn.events[turn.eventIndex]
  if (!event) return null
  const player = turn.player
  if (event.kind === 'REVENUE') {
    const amount = Math.max(0, Math.floor(computeFaturamentoFor(player)))
    return { amount, cashAfter: Number(player.cash) + amount }
  }
  if (event.kind === 'EXPENSES') {
    const expense = Math.max(0, Math.floor(computeDespesasFor(player)))
    const loanCharge = shouldChargeLoan({ loanPending: player.loanPending, lastChargedLoanId: player.lastChargedLoanId, currentRound: round })
      ? loanChargeAmount(player.loanPending) : 0
    return { amount: expense + loanCharge, expense, loanCharge, cashAfter: Number(player.cash) - expense - loanCharge }
  }
  return null
}

export function getCalcTurnProgress(turn) {
  return turn.eventIndex >= turn.events.length
    ? 'Resumo do turno'
    : `${turn.eventIndex + 1} de ${turn.events.length} eventos`
}

export function resolveCalcEvent(turn, decision = {}, round = 1) {
  const event = turn?.events?.[turn.eventIndex]
  if (!event) throw new Error('Não há evento pendente.')
  let player = turn.player
  let label = ''
  let amount = 0
  if (event.kind === 'REVENUE') {
    const preview = getCalcEventPreview(turn, round)
    amount = preview.amount
    player = applyMonthlyRevenueCredit(player, amount)
    if (player.loanPending && !player.loanPending.eligibleOnExpenses) {
      player = { ...player, loanPending: armLoanAfterRevenue(player.loanPending) }
    }
    label = 'Faturamento aplicado'
  } else if (event.kind === 'EXPENSES') {
    const preview = getCalcEventPreview(turn, round)
    if (Number(player.cash) < preview.amount) throw new Error('Caixa insuficiente. Use Recuperação ou declare falência.')
    amount = -preview.amount
    if (preview.loanCharge) {
      player = applyLoanCharge(player, { currentRound: round }).player
      player = applyDeltas(player, { cashDelta: -preview.expense })
    } else {
      player = applyDeltas(player, { cashDelta: amount })
    }
    label = 'Despesas operacionais pagas'
  } else if (event.kind === 'LUCK') {
    const card = SORTE_REVES_CARDS.find((item) => item.id === decision.cardId)
    if (!card) throw new Error('Selecione a carta física correspondente.')
    const resolved = resolveSorteRevesCard(card, player)
    if (Number(resolved.payload.cashDelta || 0) < -Number(player.cash)) {
      throw new Error('Caixa insuficiente. Use Recuperação ou declare falência.')
    }
    const applied = applySorteRevesPayloadToPlayer(player, resolved.payload)
    player = applied.player
    amount = Number(player.cash) - Number(turn.player.cash)
    label = `${card.title}: ${resolved.text}`
  } else if (decision.action === 'SKIP') {
    label = 'Sem compra'
  } else {
    const target = event.kind === 'DIRECT_BUY' ? String(decision.target || '') : event.kind
    if (event.kind === 'DIRECT_BUY' && !DIRECT_BUY_KINDS.includes(target)) throw new Error('Escolha uma compra desta casa.')
    const purchase = previewCalcPurchase(player, target, decision)
    if (Number(player.cash) < purchase.cost) throw new Error('Caixa insuficiente para esta compra.')
    player = purchase.afterPlayer
    amount = -purchase.cost
    label = `Comprou ${purchase.label}`
  }
  return {
    ...turn,
    player,
    eventIndex: turn.eventIndex + 1,
    actions: [...turn.actions, { kind: event.kind, house: event.house, label, cashDelta: amount }],
  }
}

export function recoverCalcTurn(turn, recovery, round) {
  let player = turn.player
  let label = ''
  if (recovery.action === 'LOAN') {
    if (!canTakeLoan(player)) throw new Error('Empréstimo indisponível nesta partida.')
    const amount = clampLoanAmount(recovery.amount, player.bens)
    const result = applyLoanTake(player, amount, round)
    if (!result.ok) throw new Error('Valor de empréstimo inválido.')
    player = { ...result.player, loanPending: ensureLoanId(result.player.loanPending, player.id) }
    label = `Empréstimo de R$ ${amount.toLocaleString('pt-BR')}`
  } else if (recovery.action === 'FIRE') {
    const result = buildRecoveryFireDeltas(player, { [recovery.vendorType]: recovery.qty })
    if (!result.credit) throw new Error('Selecione colaboradores para demitir.')
    player = applyDeltas(player, result.deltas)
    label = `Recuperação por demissão: R$ ${result.credit.toLocaleString('pt-BR')}`
  } else if (recovery.action === 'REDUCE') {
    const option = getCalcReduceOptions(player).find((item) => item.group === recovery.group && item.level === recovery.level)
    if (!option) throw new Error('Este nível não pode ser reduzido.')
    const result = applyRecoveryPayloadToPlayer(player, { type: 'REDUCE', items: [{ ...option, selected: true }] }, { round })
    if (!result.applied) throw new Error('Não foi possível reduzir este nível.')
    player = result.player
    label = `Reduziu ${option.group} nível ${option.level}: R$ ${option.credit.toLocaleString('pt-BR')}`
  } else if (recovery.action === 'BANKRUPT') {
    player = applyBankruptcyState(player)
    label = 'Falência declarada'
    return { ...turn, player, eventIndex: turn.events.length, actions: [...turn.actions, { kind: 'BANKRUPT', label, cashDelta: 0 }] }
  } else {
    throw new Error('Recuperação inválida.')
  }
  return { ...turn, player, actions: [...turn.actions, { kind: 'RECOVERY', label, cashDelta: Number(player.cash) - Number(turn.player.cash) }] }
}

export function getCalcReduceOptions(player) {
  return ['MIX', 'ERP'].flatMap((group) => {
    const level = String(group === 'MIX' ? player.mixProdutos || 'D' : player.erpLevel || 'D').toUpperCase()
    const price = group === 'MIX' ? MIX_PURCHASE_PRICES[level] : ERP_RULES[level]?.price
    const option = { group, level, credit: Math.floor(Number(price || 0) * MANUAL_CONSTANTS.recoveryCreditRatio) }
    return validateReduceSelection(player, option).ok ? [option] : []
  })
}

export function finishCalcTurn(game, turn) {
  if (!turn || turn.eventIndex !== turn.events.length) throw new Error('Resolva todos os eventos antes de encerrar o turno.')
  const index = game.currentPlayerIndex
  if (game.players[index]?.id !== turn.playerId) throw new Error('Turno pertence a outro jogador.')
  const before = snapshot(game)
  const players = game.players.map((player, i) => i === index ? turn.player : player)
  const bankruptcy = decideEndgameAfterBankruptcy(players, game.players.length)
  const allAliveDone = players.filter((player) => !player.bankrupt).every((player) => Number(player.lastRevenueRound || 0) >= game.round)
  const gameOver = bankruptcy.shouldEnd || (allAliveDone && game.round >= game.maxRounds)
  const round = allAliveDone && !gameOver ? game.round + 1 : game.round
  let currentPlayerIndex = index
  if (!gameOver) {
    for (let i = 1; i <= players.length; i += 1) {
      const candidate = (index + i) % players.length
      if (!players[candidate].bankrupt && !players[candidate].waitingAtRevenue) {
        currentPlayerIndex = candidate
        break
      }
    }
  }
  const historyEntry = {
    kind: 'TURN',
    at: new Date().toISOString(),
    playerId: turn.playerId,
    playerName: game.players[index].name,
    dice: turn.dice,
    from: turn.startPosition,
    to: turn.destination,
    path: turn.path,
    actions: turn.actions,
    cashBefore: game.players[index].cash,
    cashAfter: turn.player.cash,
    before,
  }
  return { ...game, players, round, gameOver, currentPlayerIndex, history: [...game.history, historyEntry] }
}

export function undoCalcTurn(game) {
  const last = game?.history?.at(-1)
  if (!last?.before) return game
  return { ...game, ...last.before, history: game.history.slice(0, -1) }
}

export function correctCalcPosition(game, house) {
  if (!Number.isInteger(house) || house < 1 || house > BOARD.trackLen) throw new RangeError('Casa inválida.')
  const index = game.currentPlayerIndex
  const player = game.players[index]
  const before = snapshot(game)
  const players = game.players.map((item, i) => i === index ? { ...item, pos: house - 1 } : item)
  return {
    ...game,
    players,
    history: [...game.history, { kind: 'CORRECTION', at: new Date().toISOString(), playerId: player.id, playerName: player.name, from: player.pos + 1, to: house, before }],
  }
}

export function getCalcRanking(game) {
  return rankPlayersByPatrimonio(game.players)
}

export function getCalcPlayerMetrics(player) {
  const { cap, inAtt } = capacityAndAttendance(player)
  return { cash: player.cash, bens: player.bens, patrimonio: computePatrimonio(player), clients: player.clients, capacity: cap, attended: inAtt, revenue: computeFaturamentoFor(player), expenses: computeDespesasFor(player) }
}

export function serializeCalcGame(game) {
  return JSON.stringify(game)
}

export function serializeCalcSession({ game, turn = null }) {
  return JSON.stringify({ schema: 1, game, turn })
}

export function parseCalcGame(raw) {
  try {
    const game = JSON.parse(raw)
    if (game?.boardVersion !== getNewGameBoardVersion()) return null
    if (!Array.isArray(game.players) || game.players.length < 2 || game.players.length > 4) return null
    if (!game.players.every((player) => player && typeof player.id === 'string' && Number.isInteger(player.pos) && player.pos >= 0 && player.pos < BOARD.trackLen)) return null
    if (!Number.isInteger(game.currentPlayerIndex) || game.currentPlayerIndex < 0 || game.currentPlayerIndex >= game.players.length) return null
    if (!Number.isInteger(game.round) || game.round < 1 || game.round > normalizeMaxRounds(game.maxRounds)) return null
    return { ...game, history: Array.isArray(game.history) ? game.history : [] }
  } catch {
    return null
  }
}

export function parseCalcSession(raw) {
  const legacyGame = parseCalcGame(raw)
  if (legacyGame) return { game: legacyGame, turn: null }
  try {
    const saved = JSON.parse(raw)
    if (saved?.schema !== 1) return null
    const game = parseCalcGame(JSON.stringify(saved.game))
    if (!game) return null
    const turn = saved.turn
    if (!turn || game.gameOver) return { game, turn: null }
    const current = game.players[game.currentPlayerIndex]
    if (turn.playerId !== current.id || turn.player?.id !== current.id ||
      !Number.isInteger(turn.dice) || turn.dice < 1 || turn.dice > 6 ||
      !Number.isInteger(turn.eventIndex) || !Array.isArray(turn.events) ||
      turn.eventIndex < 0 || turn.eventIndex > turn.events.length ||
      !Array.isArray(turn.path) || !Array.isArray(turn.actions)) return { game, turn: null }
    const planned = planCalcTurn(game, turn.dice)
    const sameEvents = JSON.stringify(turn.events.map((event) => [event.kind, event.house])) ===
      JSON.stringify(planned.events.map((event) => [event.kind, event.house]))
    if (turn.startPosition !== planned.startPosition || turn.destination !== planned.destination ||
      turn.player.pos !== planned.player.pos ||
      JSON.stringify(turn.path) !== JSON.stringify(planned.path) || !sameEvents ||
      !Number.isFinite(Number(turn.player.cash)) || !Number.isFinite(Number(turn.player.bens))) {
      return { game, turn: null }
    }
    return { game, turn }
  } catch {
    return null
  }
}

export { DIRECT_BUY_KINDS, SORTE_REVES_CARDS }
