/**
 * Flags de debug para Vercel (VITE_SG_DEBUG_LOGS).
 * Executar: node --test src/game/__tests__/debugFlags.test.mjs
 */
import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { parseVercelDebugFlag } from '../debugFlags.js'

describe('parseVercelDebugFlag', () => {
  it('aceita "1"', () => {
    assert.equal(parseVercelDebugFlag('1'), true)
  })

  it('rejeita vazio, 0 e true', () => {
    assert.equal(parseVercelDebugFlag(''), false)
    assert.equal(parseVercelDebugFlag('0'), false)
    assert.equal(parseVercelDebugFlag(undefined), false)
    assert.equal(parseVercelDebugFlag(true), false)
  })
})
