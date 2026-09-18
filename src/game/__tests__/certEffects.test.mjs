/**
 * P2-A2 — diferenciação econômica por cor/ID de certificado
 */
import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import {
  CERT_EFFECTS,
  VENDOR_RULES,
  sumCertMultipliers,
  certDeltaForVendor,
} from '../gameRules.js'
import {
  capacityAndAttendance,
  certCount,
  computeDespesasFor,
  computeFaturamentoFor,
  hasBlue,
  hasPurple,
  hasYellow,
  vendorRateForType,
  vendorUnitDespForType,
} from '../gameMath.js'

const IDS = {
  azul: 'personalizado',
  amarelo: 'fieldsales',
  roxo: 'imersaomultiplier',
}

const COMBOS = [
  ['nenhum', []],
  ['azul', [IDS.azul]],
  ['amarelo', [IDS.amarelo]],
  ['roxo', [IDS.roxo]],
  ['azul+amarelo', [IDS.azul, IDS.amarelo]],
  ['azul+roxo', [IDS.azul, IDS.roxo]],
  ['amarelo+roxo', [IDS.amarelo, IDS.roxo]],
  ['tres', [IDS.azul, IDS.amarelo, IDS.roxo]],
]

function playerFor(type, certIds, clients) {
  const trainingsByVendor = { comum: [], field: [], inside: [], gestor: [] }
  trainingsByVendor[type] = [...certIds]
  const p = {
    cash: 20000,
    clients,
    vendedoresComuns: type === 'comum' ? 1 : 0,
    fieldSales: type === 'field' ? 1 : 0,
    insideSales: type === 'inside' ? 1 : 0,
    gestores: 0,
    mixProdutos: 'D',
    erpLevel: 'D',
    trainingsByVendor,
    revenue: 0,
    az: certIds.includes(IDS.azul) ? 1 : 0,
    am: certIds.includes(IDS.amarelo) ? 1 : 0,
    rox: certIds.includes(IDS.roxo) ? 1 : 0,
  }
  return p
}

function expectedRate(type, certIds) {
  const r = VENDOR_RULES[type]
  const { multFatSum } = sumCertMultipliers(certIds)
  return r.baseFat + r.incFat * multFatSum
}

function expectedUnitDesp(type, certIds) {
  const r = VENDOR_RULES[type]
  const { multDespSum } = sumCertMultipliers(certIds)
  return r.baseDesp + r.incDesp * multDespSum
}

describe('CERT_EFFECTS P2-A2 — multiplicadores', () => {
  it('Azul 1.00/1.00, Amarelo 1.00/0, Roxo 1.20/1.50', () => {
    assert.deepEqual(
      { f: CERT_EFFECTS.personalizado.multFat, d: CERT_EFFECTS.personalizado.multDesp },
      { f: 1, d: 1 }
    )
    assert.deepEqual(
      { f: CERT_EFFECTS.fieldsales.multFat, d: CERT_EFFECTS.fieldsales.multDesp },
      { f: 1, d: 0 }
    )
    assert.deepEqual(
      { f: CERT_EFFECTS.imersaomultiplier.multFat, d: CERT_EFFECTS.imersaomultiplier.multDesp },
      { f: 1.2, d: 1.5 }
    )
  })

  it('IDs antigos continuam válidos no catálogo', () => {
    assert.ok(CERT_EFFECTS.personalizado)
    assert.ok(CERT_EFFECTS.fieldsales)
    assert.ok(CERT_EFFECTS.imersaomultiplier)
  })

  it('preço de treino permanece 500 (catálogo UI — constante de produto)', () => {
    // Preço vive no TrainingModal; aqui garantimos que a regra econômica não embute preço.
    assert.equal(certDeltaForVendor('field', IDS.azul).fat, 500)
    assert.equal(VENDOR_RULES.field.incFat * CERT_EFFECTS.personalizado.multFat, 500)
  })
})

describe('Field × Inside A2 preservado', () => {
  it('Canal Representantes cap 6 / baseFat 2000 / baseDesp 2500', () => {
    assert.equal(VENDOR_RULES.field.cap, 6)
    assert.equal(VENDOR_RULES.field.baseFat, 2000)
    assert.equal(VENDOR_RULES.field.baseDesp, 2500)
  })
  it('Inside cap 5 / baseFat 1200 / baseDesp 1500', () => {
    assert.equal(VENDOR_RULES.inside.cap, 5)
    assert.equal(VENDOR_RULES.inside.baseFat, 1200)
    assert.equal(VENDOR_RULES.inside.baseDesp, 1500)
  })
})

for (const type of ['comum', 'field', 'inside']) {
  describe(`Vendor ${type} — combinações de cor`, () => {
    const clients = VENDOR_RULES[type].cap // full util

    for (const [name, ids] of COMBOS) {
      it(`${name}: rate/desp por ID + capacidade inalterada`, () => {
        const p = playerFor(type, ids, clients)
        assert.equal(vendorRateForType(p, type), expectedRate(type, ids))
        assert.equal(vendorUnitDespForType(p, type), expectedUnitDesp(type, ids))
        assert.equal(capacityAndAttendance(p).cap, VENDOR_RULES[type].cap)
        assert.equal(certCount(p, type), new Set(ids).size)

        // Motor: fat vendedor isolado ≈ rate * inAtt (sem mix/erp)
        const { inAtt } = capacityAndAttendance(p)
        const fatTotal = computeFaturamentoFor(p)
        const mixFat = 100 * inAtt
        const erpFat = 70 * 1
        assert.equal(fatTotal - mixFat - erpFat, expectedRate(type, ids) * inAtt)

        const despTotal = computeDespesasFor(p)
        const mixDesp = 50 * clients
        const erpDesp = 50 * 1
        const cart = 50 * clients
        assert.equal(despTotal - mixDesp - erpDesp - cart, expectedUnitDesp(type, ids))
      })
    }

    it('só Amarelo: +100% fat e +0 desp vs base', () => {
      const base = playerFor(type, [], clients)
      const am = playerFor(type, [IDS.amarelo], clients)
      assert.equal(
        vendorRateForType(am, type) - vendorRateForType(base, type),
        VENDOR_RULES[type].incFat
      )
      assert.equal(
        vendorUnitDespForType(am, type) - vendorUnitDespForType(base, type),
        0
      )
    })

    it('só Roxo: +120% fat e +150% desp vs base', () => {
      const base = playerFor(type, [], clients)
      const rx = playerFor(type, [IDS.roxo], clients)
      assert.equal(
        vendorRateForType(rx, type) - vendorRateForType(base, type),
        VENDOR_RULES[type].incFat * 1.2
      )
      assert.equal(
        vendorUnitDespForType(rx, type) - vendorUnitDespForType(base, type),
        VENDOR_RULES[type].incDesp * 1.5
      )
    })
  })
}

describe('Gestor — boost por quantidade; desp por count (sem CERT_EFFECTS)', () => {
  it('1 cert gestor (qualquer ID) → mesmo boost 20% e mesma desp (sem CERT_EFFECTS)', () => {
    const base = {
      clients: 2, // capacidade comum=2 → util 100%
      vendedoresComuns: 1,
      fieldSales: 0,
      insideSales: 0,
      gestores: 1,
      mixProdutos: 'D',
      erpLevel: 'D',
      revenue: 0,
    }
    const withYellow = {
      ...base,
      trainingsByVendor: { comum: [], gestor: [IDS.amarelo] },
    }
    const withBlue = {
      ...base,
      trainingsByVendor: { comum: [], gestor: [IDS.azul] },
    }
    const noCert = {
      ...base,
      trainingsByVendor: { comum: [], gestor: [] },
    }
    // Cor do cert do gestor NÃO muda fat/desp (boost + desp por quantidade)
    assert.equal(computeFaturamentoFor(withYellow), computeFaturamentoFor(withBlue))
    assert.equal(computeDespesasFor(withYellow), computeDespesasFor(withBlue))
    assert.ok(computeFaturamentoFor(withYellow) > computeFaturamentoFor(noCert))
    // desp gestor: 3000 + 500*1 iguais para azul/amarelo
    assert.equal(certCount(withYellow, 'gestor'), 1)
    assert.equal(certCount(withBlue, 'gestor'), 1)
  })
})

describe('Sorte/Revés flags az/am/rox', () => {
  it('hasBlue/Yellow/Purple leem contadores globais', () => {
    assert.equal(hasBlue({ az: 1 }), true)
    assert.equal(hasYellow({ am: 1 }), true)
    assert.equal(hasPurple({ rox: 1 }), true)
    assert.equal(hasBlue({ az: 0 }), false)
  })
})
