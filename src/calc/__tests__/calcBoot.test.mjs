import test from 'node:test'
import assert from 'node:assert/strict'
import { markCalcBootReady } from '../calcBoot.js'

test('Calc clears the shared boot timer after its own mount', () => {
  let called = 0
  markCalcBootReady({ __SG_BOOT_READY__: () => { called += 1 } })
  assert.equal(called, 1)
})
