import test from 'node:test'
import assert from 'node:assert/strict'
import {
  createCalcGame,
  planCalcTurn,
  previewCalcPurchase,
  resolveCalcEvent,
  finishCalcTurn,
  undoCalcTurn,
  correctCalcPosition,
  serializeCalcGame,
  parseCalcGame,
  recoverCalcTurn,
  getCalcEventPreview,
  SORTE_REVES_CARDS,
  getCalcTurnProgress,
  getCalcReduceOptions,
  serializeCalcSession,
  parseCalcSession,
} from '../calcModel.js'

const fresh = () => createCalcGame(['Ana', 'Bruno'], 2)

test('new physical game uses the current board and official starting state', () => {
  const game = fresh()
  assert.equal(game.boardVersion, 'v2-40')
  assert.equal(game.players[0].cash, 18000)
  assert.equal(game.players[0].bens, 4000)
  assert.equal(game.players[0].clients, 1)
  assert.equal(game.players[0].pos, 0)
  assert.equal(game.maxRounds, 2)
})

test('crossing house 1 resolves revenue before the destination', () => {
  const game = { ...fresh(), players: fresh().players.map((p, i) => i ? p : { ...p, pos: 38 }) }
  const turn = planCalcTurn(game, 4)
  assert.deepEqual(turn.path, [40, 1, 2, 3])
  assert.equal(turn.destination, 3)
  assert.deepEqual(turn.events.map(({ kind, house }) => [kind, house]), [['REVENUE', 1], ['ERP', 3]])
  assert.equal(game.players[0].pos, 38)
})

test('crossing house 25 queues expenses ahead of a purchase tile', () => {
  const game = { ...fresh(), players: fresh().players.map((p, i) => i ? p : { ...p, pos: 21 }) }
  const turn = planCalcTurn(game, 5)
  assert.deepEqual(turn.path, [23, 24, 25, 26, 27])
  assert.deepEqual(turn.events.map(({ kind, house }) => [kind, house]), [['EXPENSES', 25], ['ERP', 27]])
})

test('preview does not mutate cash and confirmed representative purchase does', () => {
  const game = { ...fresh(), players: fresh().players.map((p, i) => i ? p : { ...p, pos: 6 }) }
  const turn = planCalcTurn(game, 1)
  const preview = previewCalcPurchase(turn.player, 'FIELD', { qty: 1 })
  assert.equal(preview.impact.current.cash, 18000)
  assert.equal(preview.impact.after.cash, 14000)
  assert.equal(preview.impact.current.capacity, 2)
  assert.equal(preview.impact.after.capacity, 8)
  assert.equal(game.players[0].cash, 18000)
  const resolved = resolveCalcEvent(turn, { action: 'BUY', qty: 1 })
  assert.equal(resolved.player.cash, 14000)
  assert.equal(resolved.player.fieldSales, 1)
  assert.equal(game.players[0].cash, 18000)
})

test('skipping a purchase changes position only after finishing and undo restores the turn', () => {
  const game = fresh()
  const turn = resolveCalcEvent(planCalcTurn(game, 1), { action: 'SKIP' })
  const committed = finishCalcTurn(game, turn)
  assert.equal(committed.players[0].pos, 1)
  assert.equal(committed.currentPlayerIndex, 1)
  assert.equal(committed.history.length, 1)
  const undone = undoCalcTurn(committed)
  assert.equal(undone.players[0].pos, 0)
  assert.equal(undone.currentPlayerIndex, 0)
  assert.equal(undone.history.length, 0)
})

test('final round stops at revenue and ends once every player crosses it', () => {
  const base = fresh()
  const game = {
    ...base,
    round: 2,
    players: base.players.map(p => ({ ...p, pos: 38, lastRevenueRound: 1 })),
  }
  const first = planCalcTurn(game, 4)
  assert.equal(first.destination, 1)
  assert.deepEqual(first.events.map(e => e.kind), ['REVENUE'])
  const afterAna = finishCalcTurn(game, resolveCalcEvent(first, { action: 'APPLY' }))
  assert.equal(afterAna.gameOver, false)
  assert.equal(afterAna.currentPlayerIndex, 1)
  const afterBruno = finishCalcTurn(afterAna, resolveCalcEvent(planCalcTurn(afterAna, 4), { action: 'APPLY' }))
  assert.equal(afterBruno.gameOver, true)
})

test('correction is explicit and saved state can be restored', () => {
  const corrected = correctCalcPosition(fresh(), 12)
  assert.equal(corrected.players[0].pos, 11)
  const loaded = parseCalcGame(serializeCalcGame(corrected))
  assert.equal(loaded.players[0].pos, 11)
  assert.equal(loaded.history[0].kind, 'CORRECTION')
  assert.equal(parseCalcGame('{"boardVersion":"v1-55"}'), null)
})

test('revenue and expenses use current financial functions and preserve event order', () => {
  const base = fresh()
  const game = { ...base, players: base.players.map((p, i) => i ? p : { ...p, pos: 38 }) }
  const turn = planCalcTurn(game, 4)
  const preview = getCalcEventPreview(turn, game.round)
  assert.equal(preview.cashAfter, turn.player.cash + preview.amount)
  const applied = resolveCalcEvent(turn, { action: 'APPLY' }, game.round)
  assert.equal(applied.eventIndex, 1)
  assert.equal(applied.player.cash, preview.cashAfter)
  assert.equal(game.players[0].cash, 18000)
})

test('round advances only after all players cross revenue', () => {
  const base = fresh()
  const game = { ...base, players: base.players.map(p => ({ ...p, pos: 38 })) }
  const first = finishCalcTurn(game, resolveCalcEvent(planCalcTurn(game, 2), { action: 'APPLY' }))
  assert.equal(first.round, 1)
  assert.equal(first.currentPlayerIndex, 1)
  const second = finishCalcTurn(first, resolveCalcEvent(planCalcTurn(first, 2), { action: 'APPLY' }))
  assert.equal(second.round, 2)
  assert.equal(second.gameOver, false)
})

test('physical card is selected by existing card id and its effect is applied', () => {
  const base = fresh()
  const game = { ...base, players: base.players.map((p, i) => i ? p : { ...p, pos: 8 }) }
  const turn = planCalcTurn(game, 1)
  assert.equal(turn.events[0].kind, 'LUCK')
  const card = SORTE_REVES_CARDS.find((item) => item.id === 'referral_bonus')
  const resolved = resolveCalcEvent(turn, { cardId: card.id })
  assert.equal(resolved.player.cash, 18800)
  assert.equal(game.players[0].cash, 18000)
})

test('insufficient expenses can be recovered with official loan before applying', () => {
  const base = fresh()
  const game = { ...base, players: base.players.map((p, i) => i ? p : { ...p, pos: 23, cash: 1000 }) }
  const turn = planCalcTurn(game, 1)
  assert.equal(turn.events[0].kind, 'EXPENSES')
  assert.throws(() => resolveCalcEvent(turn, { action: 'APPLY' }), /Caixa insuficiente/)
  const recovered = recoverCalcTurn(turn, { action: 'LOAN', amount: 2000 }, game.round)
  assert.equal(recovered.player.cash, 3000)
  assert.equal(recovered.player.loanTakenInMatch, true)
  const applied = resolveCalcEvent(recovered, { action: 'APPLY' }, game.round)
  assert.ok(applied.player.cash >= 0)
})

test('training previews do not mutate certificates and purchase applies them', () => {
  const player = fresh().players[0]
  const preview = previewCalcPurchase(player, 'TRAINING', { vendorType: 'comum', certId: 'personalizado' })
  assert.equal(preview.cost, 500)
  assert.equal(player.trainingsByVendor, undefined)
  assert.deepEqual(preview.afterPlayer.trainingsByVendor.comum, ['personalizado'])
  assert.throws(() => previewCalcPurchase(preview.afterPlayer, 'TRAINING', { vendorType: 'comum', certId: 'personalizado' }), /indisponível/)
})

test('loan is charged with interest at expenses after a revenue crossing', () => {
  const base = fresh()
  const game = { ...base, players: base.players.map((p, i) => i ? p : { ...p, pos: 38 }) }
  const borrowed = recoverCalcTurn({ player: game.players[0], actions: [], eventIndex: 0, events: [] }, { action: 'LOAN', amount: 2000 }, 1).player
  const withLoan = { ...game, players: [borrowed, game.players[1]] }
  const revenueTurn = resolveCalcEvent(planCalcTurn(withLoan, 2), { action: 'APPLY' }, 1)
  const afterRevenue = finishCalcTurn(withLoan, revenueTurn).players[0]
  const expensesGame = { ...game, players: [{ ...afterRevenue, pos: 23 }, game.players[1]], currentPlayerIndex: 0 }
  const expenseTurn = planCalcTurn(expensesGame, 1)
  const expense = getCalcEventPreview(expenseTurn, expensesGame.round)
  assert.equal(expense.loanCharge, 3000)
})

test('turn progress switches to summary after its final event', () => {
  const game = fresh()
  const turn = planCalcTurn(game, 1)
  assert.equal(getCalcTurnProgress(turn), '1 de 1 eventos')
  assert.equal(getCalcTurnProgress(resolveCalcEvent(turn, { action: 'SKIP' })), 'Resumo do turno')
})

test('recovery can reduce an owned Mix level using the official credit and downgrade', () => {
  const base = fresh()
  const bought = previewCalcPurchase(base.players[0], 'MIX', { level: 'A' }).afterPlayer
  const player = { ...bought, cash: 100, loanTakenInMatch: true, vendedoresComuns: 0 }
  const option = getCalcReduceOptions(player).find((item) => item.group === 'MIX' && item.level === 'A')
  assert.equal(option.credit, 6000)
  const turn = { player, actions: [], eventIndex: 0, events: [{ kind: 'EXPENSES', house: 25 }] }
  const recovered = recoverCalcTurn(turn, { action: 'REDUCE', group: 'MIX', level: 'A' }, 1)
  assert.equal(recovered.player.cash, 6100)
  assert.equal(recovered.player.mixProdutos, 'D')
  assert.deepEqual(recovered.player.reducedLevels.MIX, ['A'])
  assert.equal(player.mixProdutos, 'A')
})

test('recovery can sell an earlier owned Mix level while keeping the active level', () => {
  const base = fresh().players[0]
  const withB = previewCalcPurchase(base, 'MIX', { level: 'B' }).afterPlayer
  const withA = previewCalcPurchase(withB, 'MIX', { level: 'A' }).afterPlayer
  const player = { ...withA, cash: 100 }
  const options = getCalcReduceOptions(player)
  assert.deepEqual(options.filter((item) => item.group === 'MIX').map((item) => item.level), ['A', 'B'])
  const turn = { player, actions: [], eventIndex: 0, events: [{ kind: 'EXPENSES', house: 25 }] }
  const recovered = recoverCalcTurn(turn, { action: 'REDUCE', group: 'MIX', level: 'B' }, 1)
  assert.equal(recovered.player.cash, 3100)
  assert.equal(recovered.player.mixProdutos, 'A')
  assert.equal(recovered.player.mixOwned.B, false)
  assert.deepEqual(recovered.player.reducedLevels.MIX, ['B'])
})

test('a pending turn survives reload without committing its financial changes', () => {
  const base = fresh()
  const game = { ...base, players: base.players.map((player, index) => index ? player : { ...player, pos: 38 }) }
  const turn = resolveCalcEvent(planCalcTurn(game, 4), { action: 'APPLY' }, game.round)
  const restored = parseCalcSession(serializeCalcSession({ game, turn }))
  assert.equal(restored.game.players[0].cash, 18000)
  assert.equal(restored.game.players[0].pos, 38)
  assert.equal(restored.turn.eventIndex, 1)
  assert.equal(restored.turn.events[1].kind, 'ERP')
  assert.ok(restored.turn.player.cash > restored.game.players[0].cash)
})

test('saved sessions accept old committed games and discard drafts from another turn', () => {
  const game = fresh()
  assert.equal(parseCalcSession(serializeCalcGame(game)).turn, null)
  const invalid = { ...planCalcTurn(game, 1), playerId: 'other-player' }
  const restored = parseCalcSession(serializeCalcSession({ game, turn: invalid }))
  assert.equal(restored.turn, null)
  assert.equal(restored.game.players[0].id, game.players[0].id)
})
