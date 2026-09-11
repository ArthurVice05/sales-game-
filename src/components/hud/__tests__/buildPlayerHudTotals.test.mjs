/**
 * Totais de apresentação do HUD a partir de um jogador (somente leitura).
 * Espelha a derivação usada no App para o painel — sem motor/sync.
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import { buildPlayerHudTotals } from '../hudPresentation.js'

test('buildPlayerHudTotals deriva comerciais e capacidade do comprador', () => {
  const totals = buildPlayerHudTotals({
    name: 'Ana',
    cash: 18000,
    clients: 1,
    vendedoresComuns: 1,
    fieldSales: 0,
    insideSales: 0,
    gestores: 0,
    erpLevel: 'D',
    mixProdutos: 'D',
    bens: 4000,
    az: 0,
    am: 0,
    rox: 0,
  })
  assert.equal(totals.clientes, 1)
  assert.equal(totals.vendedoresComuns, 1)
  assert.equal(totals.fieldSales, 0)
  assert.equal(totals.erpSistemas, 'D')
  assert.equal(totals.mixProdutos, 'D')
  assert.equal(totals.possibAt, 2)
  assert.equal(totals.clientsAt, 1)
  assert.ok(Number.isFinite(totals.faturamento))
  assert.ok(Number.isFinite(totals.manutencao))
})

test('buildPlayerHudTotals sem jogador devolve zeros seguros', () => {
  const totals = buildPlayerHudTotals(null)
  assert.equal(totals.clientes, 0)
  assert.equal(totals.erpSistemas, 'D')
  assert.equal(totals.possibAt, 0)
})
