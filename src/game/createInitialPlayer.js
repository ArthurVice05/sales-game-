import { MANUAL_CONSTANTS } from './manualConstants.js'

export const PLAYER_SEAT_COLORS = Object.freeze([
  '#FFD600',
  '#2196F3',
  '#00C853',
  '#FF6D00',
])

export const DEFAULT_STARTER_FIELDS = Object.freeze({
  mixProdutos: 'D',
  erpLevel: 'D',
  clients: 1,
  vendedoresComuns: 1,
  loanTakenInMatch: false,
  lastChargedLoanId: null,
})

/** Kit inicial compartilhado por humanos e máquinas. Não duplicar estes defaults. */
export function applyStarterKit(obj = {}) {
  return {
    ...obj,
    mixProdutos: obj.mixProdutos ?? DEFAULT_STARTER_FIELDS.mixProdutos,
    erpLevel: obj.erpLevel ?? DEFAULT_STARTER_FIELDS.erpLevel,
    clients: obj.clients ?? DEFAULT_STARTER_FIELDS.clients,
    vendedoresComuns: obj.vendedoresComuns ?? DEFAULT_STARTER_FIELDS.vendedoresComuns,
    loanTakenInMatch: obj.loanTakenInMatch ?? DEFAULT_STARTER_FIELDS.loanTakenInMatch,
    lastChargedLoanId: obj.lastChargedLoanId ?? DEFAULT_STARTER_FIELDS.lastChargedLoanId,
  }
}

export function createInitialPlayerState({
  id,
  name,
  seat = 0,
  joinOrder,
  color,
  extras = {},
} = {}) {
  const seatN = Number.isInteger(seat) ? seat : 0
  return applyStarterKit({
    id: id != null ? String(id) : '',
    name: name != null ? String(name) : '',
    cash: MANUAL_CONSTANTS.startCash,
    bens: MANUAL_CONSTANTS.startBens,
    pos: 0,
    color: color || PLAYER_SEAT_COLORS[seatN % PLAYER_SEAT_COLORS.length],
    seat: seatN,
    joinOrder: Number.isInteger(joinOrder) ? joinOrder : seatN,
    bankrupt: false,
    waitingAtRevenue: false,
    lastRevenueRound: 0,
    ...extras,
  })
}
