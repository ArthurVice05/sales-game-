/**
 * Sair da partida no meio do jogo = falência, não desconexão.
 * node --test src/game/__tests__/matchForfeit.test.mjs
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  applyBankruptcyState,
  planMatchForfeit,
  decideEndgameAfterBankruptcy,
} from '../matchForfeit.js'

const p = (id, over = {}) => ({
  id,
  name: id,
  cash: 12000,
  bens: 4000,
  clients: 2,
  vendedoresComuns: 1,
  bankrupt: false,
  pos: 3,
  ...over,
})

test('applyBankruptcyState zera recursos e marca falido', () => {
  const next = applyBankruptcyState(p('A', { loanPending: { loanId: 'x' } }))
  assert.equal(next.bankrupt, true)
  assert.equal(next.cash, 0)
  assert.equal(next.bens, 0)
  assert.equal(next.clients, 0)
  assert.equal(next.loanPending, null)
  assert.equal(next.mixProdutos, 'D')
  assert.equal(next.erpLevel, 'D')
  assert.equal(next.id, 'A')
})

test('sair fora do próprio turno: marca falido e não troca o turno', () => {
  const plan = planMatchForfeit({
    players: [p('A'), p('B'), p('C')],
    playerId: 'B',
    turnPlayerId: 'A',
    turnSeq: 4,
    round: 2,
    initialPlayerCount: 3,
  })
  assert.equal(plan.ok, true)
  assert.equal(plan.alreadyBankrupt, false)
  assert.equal(plan.shouldEnd, false)
  assert.equal(plan.wasTheirTurn, false)
  assert.equal(plan.turnChanged, false)
  assert.equal(plan.nextTurnPlayerId, 'A')
  assert.equal(plan.nextTurnSeq, 4)
  assert.equal(plan.nextPlayers.find((x) => x.id === 'B').bankrupt, true)
  assert.equal(plan.nextPlayers.find((x) => x.id === 'A').bankrupt, false)
})

test('sair no próprio turno: falido e passa para o próximo vivo', () => {
  const plan = planMatchForfeit({
    players: [p('A'), p('B'), p('C')],
    playerId: 'A',
    turnPlayerId: 'A',
    turnSeq: 2,
    round: 1,
    initialPlayerCount: 3,
  })
  assert.equal(plan.wasTheirTurn, true)
  assert.equal(plan.turnChanged, true)
  assert.equal(plan.shouldEnd, false)
  assert.equal(plan.nextTurnPlayerId, 'B')
  assert.equal(plan.nextTurnSeq, 3)
  assert.equal(plan.nextPlayers[0].bankrupt, true)
})

test('sair com 2 vivos encerra a partida com o outro como vencedor', () => {
  const plan = planMatchForfeit({
    players: [p('A'), p('B')],
    playerId: 'B',
    turnPlayerId: 'A',
    turnSeq: 7,
    round: 3,
    initialPlayerCount: 2,
  })
  assert.equal(plan.shouldEnd, true)
  assert.equal(plan.winner?.id, 'A')
  assert.equal(plan.nextPlayers.find((x) => x.id === 'B').bankrupt, true)
})

test('já falido: no-op, não troca turno', () => {
  const plan = planMatchForfeit({
    players: [p('A'), p('B', { bankrupt: true })],
    playerId: 'B',
    turnPlayerId: 'A',
    turnSeq: 1,
    round: 1,
    initialPlayerCount: 2,
  })
  assert.equal(plan.alreadyBankrupt, true)
  assert.equal(plan.turnChanged, false)
  assert.equal(plan.nextTurnPlayerId, 'A')
})

test('endgame: 3 jogadores, 1 vivo restante', () => {
  const decision = decideEndgameAfterBankruptcy(
    [p('A', { bankrupt: true }), p('B'), p('C', { bankrupt: true })],
    3
  )
  assert.equal(decision.shouldEnd, true)
  assert.equal(decision.winner?.id, 'B')
})

test('App aplica forfeitMatch antes de leaveRoom no Sair para Lobbies', () => {
  const root = join(dirname(fileURLToPath(import.meta.url)), '../../..')
  const app = readFileSync(join(root, 'src/App.jsx'), 'utf8')
  const start = app.indexOf('async function exitCurrentGame()')
  const end = app.indexOf('// Presença + auto-skip', start)
  assert.ok(start > 0 && end > start)
  const handler = app.slice(start, end)
  assert.match(handler, /gameMode === GAME_MODE\.LOCAL/)
  const forfeitPos = handler.lastIndexOf('forfeitMatch')
  const leavePos = handler.lastIndexOf('leaveRoom')
  assert.ok(forfeitPos >= 0, 'Sair deve chamar forfeitMatch')
  assert.ok(leavePos >= 0, 'Sair deve chamar leaveRoom')
  assert.ok(forfeitPos < leavePos, 'falência deve ser commitada antes de sair da sala')
})
