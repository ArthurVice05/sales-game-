/**
 * A2 — Canal Representantes ≠ Inside Sales
 * Prova que os tipos deixaram de ser equivalentes.
 */
import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import {
  VENDOR_RULES,
} from '../gameRules.js'
import {
  capacityAndAttendance,
  computeDespesasFor,
  computeFaturamentoFor,
} from '../gameMath.js'
import { buildFieldSalesPurchaseDeltas } from '../fieldSalesPurchase.js'
import { buildInsideSalesPurchaseDeltas } from '../insideSalesPurchase.js'
import { previewPurchaseImpact } from '../purchasePreview.js'

const basePlayer = (overrides = {}) => ({
  cash: 20000,
  clients: 1,
  vendedoresComuns: 0,
  fieldSales: 0,
  insideSales: 0,
  gestores: 0,
  mixProdutos: 'D',
  erpLevel: 'D',
  trainingsByVendor: {},
  revenue: 0,
  ...overrides,
})

/** Faturamento só de vendedores (remove Mix D + ERP D) para comparar tipos. */
function vendorOnlyFat(player) {
  const { inAtt } = capacityAndAttendance(player)
  const qColabs =
    Number(player.vendedoresComuns || 0) +
    Number(player.fieldSales || 0) +
    Number(player.insideSales || 0) +
    Number(player.gestores || 0)
  const mixFat = 100 * inAtt
  const erpFat = 70 * qColabs
  return computeFaturamentoFor(player) - mixFat - erpFat
}

function vendorOnlyDesp(player) {
  const clients = Number(player.clients || 0)
  const qColabs =
    Number(player.vendedoresComuns || 0) +
    Number(player.fieldSales || 0) +
    Number(player.insideSales || 0) +
    Number(player.gestores || 0)
  const mixDesp = 50 * clients
  const erpDesp = 50 * qColabs
  const cart = 50 * clients
  return computeDespesasFor(player) - mixDesp - erpDesp - cart
}

describe('VENDOR_RULES A2 — Canal Representantes ≠ Inside', () => {
  it('1) Canal Representantes cap = 6', () => {
    assert.equal(VENDOR_RULES.field.cap, 6)
  })

  it('2) Inside cap = 5', () => {
    assert.equal(VENDOR_RULES.inside.cap, 5)
  })

  it('3) Field baseFat = 2000', () => {
    assert.equal(VENDOR_RULES.field.baseFat, 2000)
  })

  it('4) Inside baseFat = 1200', () => {
    assert.equal(VENDOR_RULES.inside.baseFat, 1200)
  })

  it('5) Field baseDesp = 2500', () => {
    assert.equal(VENDOR_RULES.field.baseDesp, 2500)
  })

  it('6) Inside baseDesp = 1500', () => {
    assert.equal(VENDOR_RULES.inside.baseDesp, 1500)
  })

  it('7) hire Field = 4000', () => {
    assert.equal(VENDOR_RULES.field.hire, 4000)
  })

  it('8) hire Inside = 2500', () => {
    assert.equal(VENDOR_RULES.inside.hire, 2500)
  })

  it('capacidades no motor: 1 Canal Representantes = 6, 1 Inside = 5', () => {
    assert.equal(capacityAndAttendance(basePlayer({ fieldSales: 1 })).cap, 6)
    assert.equal(capacityAndAttendance(basePlayer({ insideSales: 1 })).cap, 5)
  })

  it('11) certificados: +500 fat / +100 desp (ambos)', () => {
    assert.equal(VENDOR_RULES.field.incFat, 500)
    assert.equal(VENDOR_RULES.inside.incFat, 500)
    assert.equal(VENDOR_RULES.field.incDesp, 100)
    assert.equal(VENDOR_RULES.inside.incDesp, 100)

    const field0 = basePlayer({
      fieldSales: 1,
      clients: 6,
      trainingsByVendor: { field: [] },
    })
    const field1 = basePlayer({
      fieldSales: 1,
      clients: 6,
      trainingsByVendor: { field: ['personalizado'] },
    })
    assert.equal(vendorOnlyFat(field1) - vendorOnlyFat(field0), 500 * 6)
    assert.equal(vendorOnlyDesp(field1) - vendorOnlyDesp(field0), 100)

    const inside0 = basePlayer({
      insideSales: 1,
      clients: 5,
      trainingsByVendor: { inside: [] },
    })
    const inside1 = basePlayer({
      insideSales: 1,
      clients: 5,
      trainingsByVendor: { inside: ['personalizado'] },
    })
    assert.equal(vendorOnlyFat(inside1) - vendorOnlyFat(inside0), 500 * 5)
    assert.equal(vendorOnlyDesp(inside1) - vendorOnlyDesp(inside0), 100)
  })

  it('9) 3 clientes: Field tem melhor resultado operacional que Inside', () => {
    const field = basePlayer({ fieldSales: 1, clients: 3 })
    const inside = basePlayer({ insideSales: 1, clients: 3 })
    const fieldOp = vendorOnlyFat(field) - vendorOnlyDesp(field)
    const insideOp = vendorOnlyFat(inside) - vendorOnlyDesp(inside)
    // Field: 2000*3 - 2500 = 3500; Inside: 1200*3 - 1500 = 2100
    assert.equal(fieldOp, 3500)
    assert.equal(insideOp, 2100)
    assert.ok(fieldOp > insideOp)
  })

  it('10) 7 clientes: cada canal respeita sua nova capacidade', () => {
    const field = basePlayer({ fieldSales: 1, clients: 7 })
    const inside = basePlayer({ insideSales: 1, clients: 7 })
    const fieldOp = vendorOnlyFat(field) - vendorOnlyDesp(field)
    const insideOp = vendorOnlyFat(inside) - vendorOnlyDesp(inside)
    // Canal Representantes: 2000*6 - 2500 = 9500; Inside: 1200*5 - 1500 = 4500
    assert.equal(fieldOp, 9500)
    assert.equal(insideOp, 4500)
    assert.ok(fieldOp > insideOp)
  })

  it('Field e Inside não são mais numericamente equivalentes', () => {
    assert.notEqual(VENDOR_RULES.field.cap, VENDOR_RULES.inside.cap)
    assert.notEqual(VENDOR_RULES.field.baseFat, VENDOR_RULES.inside.baseFat)
    assert.notEqual(VENDOR_RULES.field.baseDesp, VENDOR_RULES.inside.baseDesp)
    assert.notEqual(VENDOR_RULES.field.hire, VENDOR_RULES.inside.hire)
  })
})

describe('12) previews e deltas usam os novos números', () => {
  it('Field deltas: hire 4000, manutencao 2500, revenue base 2000', () => {
    const qty = 1
    const totalHire = VENDOR_RULES.field.hire * qty
    const totalExpense = VENDOR_RULES.field.baseDesp * qty
    const revenueDelta = VENDOR_RULES.field.baseFat * qty
    const deltas = buildFieldSalesPurchaseDeltas({
      qty,
      totalHire,
      expenseDelta: totalExpense,
      revenueDelta,
      cashDelta: -totalHire,
    })
    assert.equal(deltas.cashDelta, -4000)
    assert.equal(deltas.fieldSalesDelta, 1)
    assert.equal(deltas.manutencaoDelta, 2500)
    assert.equal(deltas.revenueDelta, 2000)

    const impact = previewPurchaseImpact({
      player: basePlayer({ cash: 20000 }),
      deltas,
      immediateCost: totalHire,
    })
    assert.equal(impact.after.cash, 16000)
  })

  it('Inside deltas: hire 2500 (payload assimétrico preservado — sem manutencaoDelta)', () => {
    const qty = 1
    const totalCost = VENDOR_RULES.inside.hire * qty
    const deltas = buildInsideSalesPurchaseDeltas({
      qty,
      headcount: qty,
      totalCost,
      cashDelta: -totalCost,
    })
    assert.equal(deltas.cashDelta, -2500)
    assert.equal(deltas.insideSalesDelta, 1)
    assert.equal(deltas.manutencaoDelta, undefined)

    const impact = previewPurchaseImpact({
      player: basePlayer({ cash: 20000 }),
      deltas: {
        ...deltas,
        // preview de manutenção/capacidade usa o motor após headcount
        insideSalesDelta: 1,
      },
      immediateCost: totalCost,
    })
    assert.equal(impact.after.cash, 17500)

    const afterHire = basePlayer({ cash: 17500, insideSales: 1, clients: 1 })
    assert.equal(capacityAndAttendance(afterHire).cap, 5)
    assert.equal(vendorOnlyDesp(afterHire), 1500)
  })
})
