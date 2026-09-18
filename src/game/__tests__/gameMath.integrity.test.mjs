/**
 * Asserts críticos do motor (portados de gameMath.test.js Jest → node:test).
 * Garante kit inicial, boost do gestor e capacidade no `npm test`.
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import {
  computeFaturamentoFor,
  computeDespesasFor,
  capacityAndAttendance,
  applyDeltas,
  countAlivePlayers,
  findNextAliveIdx,
} from '../gameMath.js'
import { MANUAL_CONSTANTS } from '../manualConstants.js'
import { managerBoostPct, MANAGER_BOOST_MAX_CERTS } from '../gameRules.js'

const createTestPlayer = (overrides = {}) => ({
  id: 'test-player',
  name: 'Test Player',
  cash: MANUAL_CONSTANTS.startCash,
  pos: 0,
  clients: 1,
  vendedoresComuns: 1,
  fieldSales: 0,
  insideSales: 0,
  gestores: 0,
  mixProdutos: 'D',
  erpLevel: 'D',
  az: 0,
  am: 0,
  rox: 0,
  ...overrides,
})

test('kit inicial: despesas = 1150 e faturamento = 770', () => {
  const player = createTestPlayer()
  assert.equal(computeDespesasFor(player), 1150)
  assert.equal(computeFaturamentoFor(player), 770)
})

test('capacidade: comum×2 + Canal Representantes×6 + Inside×5', () => {
  const player = createTestPlayer({
    vendedoresComuns: 2,
    fieldSales: 1,
    insideSales: 1,
  })
  const { cap, inAtt } = capacityAndAttendance(player)
  assert.equal(cap, 15)
  assert.equal(inAtt, 1)
})

test('gestor boost: 0 cert = 0%; 1 cert = 20%; máx = 3 certs (40%)', () => {
  assert.equal(managerBoostPct(0), 0)
  assert.equal(managerBoostPct(1), 0.2)
  assert.equal(managerBoostPct(3), 0.4)
  assert.equal(managerBoostPct(4), 0.4)
  assert.equal(MANAGER_BOOST_MAX_CERTS, 3)

  // clients>=1: sem atendimento efetivo o motor retorna 0 (regra atual)
  const base = createTestPlayer({
    clients: 1,
    vendedoresComuns: 1,
    gestores: 1,
    trainingsByVendor: { gestor: [] },
  })
  // vendorsFat=600, mix=100, ERP staff=2×70 → 840 (sem boost)
  assert.equal(computeFaturamentoFor(base), 840)

  const boosted = createTestPlayer({
    clients: 1,
    vendedoresComuns: 1,
    gestores: 1,
    trainingsByVendor: { gestor: ['personalizado'] },
  })
  // boost 20% → floor(600×1.2)=720 + mix 100 + ERP 140 → 960
  assert.equal(computeFaturamentoFor(boosted), 960)
})

test('applyDeltas e vivos: cash/clients e nextAlive', () => {
  const p = createTestPlayer({ clients: 5, cash: 10000, vendedoresComuns: 3 })
  assert.equal(applyDeltas(p, { clientsDelta: -2 }).clients, 3)
  assert.equal(applyDeltas(p, { cashDelta: -2000 }).cash, 8000)
  assert.equal(applyDeltas(p, { vendedoresComunsDelta: -1 }).vendedoresComuns, 2)

  const players = [
    createTestPlayer({ id: 'p1', bankrupt: false }),
    createTestPlayer({ id: 'p2', bankrupt: true }),
    createTestPlayer({ id: 'p3', bankrupt: false }),
    createTestPlayer({ id: 'p4', bankrupt: true }),
  ]
  assert.equal(countAlivePlayers(players), 2)
  assert.equal(findNextAliveIdx(players, 0), 2)
  assert.equal(findNextAliveIdx(players, 2), 0)
})

test('recuperação: demissão Comum usa commonHire × recoveryCreditRatio (= 1000)', () => {
  const unit = MANUAL_CONSTANTS.commonHire
  const credit = Math.floor(unit * MANUAL_CONSTANTS.recoveryCreditRatio)
  assert.equal(unit, 2000)
  assert.equal(credit, 1000)
})

test('carteira de clientes usa MANUAL_CONSTANTS.clientPortfolioDesp', () => {
  const player = createTestPlayer({ clients: 4, vendedoresComuns: 0, fieldSales: 0, insideSales: 0, gestores: 0 })
  // Sem equipe: só Mix D (4×50) + carteira (4×50) = 400 (ERP staff=0)
  assert.equal(computeDespesasFor(player), 400)
  assert.equal(MANUAL_CONSTANTS.clientPortfolioDesp, 50)
})
