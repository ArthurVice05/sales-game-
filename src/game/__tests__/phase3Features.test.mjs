import test from 'node:test'
import assert from 'node:assert/strict'

import {
  isEngineV2Enabled,
  isEngineV2CutoverEnabled,
  shouldRunEngineV2Shadow,
} from '../engineFlag.js'
import {
  consumeTileTip,
  hasSeenTileTip,
  markTileTipSeen,
  listTipKinds,
  TIP_SESSION_PREFIX,
} from '../progressiveTips.js'
import { calculateErpReturn } from '../erpPurchase.js'

test('ENGINE_V2 flag default off (sem localStorage/env)', () => {
  // Em node sem localStorage: funções não devem lançar e retornam false
  assert.equal(isEngineV2Enabled(), false)
  assert.equal(isEngineV2CutoverEnabled(), false)
  assert.equal(shouldRunEngineV2Shadow(), false)
})

test('progressive tips: consome 1× por kind na sessão com texto curto', () => {
  const store = new Map()
  globalThis.sessionStorage = {
    getItem: (k) => (store.has(k) ? store.get(k) : null),
    setItem: (k, v) => { store.set(k, String(v)) },
    removeItem: (k) => { store.delete(k) },
  }

  assert.ok(listTipKinds().includes('ERP'))
  const first = consumeTileTip('ERP')
  assert.ok(first)
  assert.equal(first.kind, 'ERP')
  assert.ok(String(first.text).length > 10)
  assert.ok(String(first.text).length <= 110)
  assert.ok(String(first.detail).length >= String(first.text).length)
  assert.equal(hasSeenTileTip('ERP'), true)
  assert.equal(consumeTileTip('ERP'), null)
  assert.ok(sessionStorage.getItem(`${TIP_SESSION_PREFIX}ERP`) === '1')

  markTileTipSeen('CLIENTS')
  assert.equal(consumeTileTip('CLIENTS'), null)

  const luckStore = new Map()
  globalThis.sessionStorage = {
    getItem: (k) => (luckStore.has(k) ? luckStore.get(k) : null),
    setItem: (k, v) => { luckStore.set(k, String(v)) },
    removeItem: (k) => { luckStore.delete(k) },
  }
  const luck = consumeTileTip('LUCK')
  assert.equal(luck.text, 'Sorte & Revés: confirme a carta para aplicar o efeito.')
})

test('ERP return inclui guidance e horizonNet', () => {
  const impact = {
    immediateCost: 400,
    difference: { monthlyNet: 100, revenue: 200, expenses: 100 },
  }
  const r = calculateErpReturn({ impact, horizonRounds: 5, staffCount: 2 })
  assert.equal(r.status, 'pays_back_within_horizon')
  assert.equal(r.horizonNet, 500)
  assert.ok(r.guidance && r.guidance.includes('equipe'))

  const bad = calculateErpReturn({
    impact: { immediateCost: 1200, difference: { monthlyNet: 0, revenue: 0, expenses: 0 } },
    horizonRounds: 5,
    staffCount: 0,
  })
  assert.equal(bad.status, 'no_financial_return')
  assert.match(bad.guidance, /colaborador/i)
})
