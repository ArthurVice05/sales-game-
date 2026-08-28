/**
 * HUD de rodadas: 0/N no início, N/N no fim.
 * Executar: node --test src/game/__tests__/roundDisplay.test.mjs
 */
import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import {
  formatRoundProgress,
  clampEngineRound,
} from '../roundDisplay.js'

describe('formatRoundProgress — HUD 0-based', () => {
  it('2 rodadas configuradas → início 0/2', () => {
    const p = formatRoundProgress(1, 2, false)
    assert.equal(p.label, '0/2')
    assert.equal(p.completed, 0)
    assert.equal(p.total, 2)
  })

  it('2 rodadas → meio 1/2 (motor round=2)', () => {
    const p = formatRoundProgress(2, 2, false)
    assert.equal(p.label, '1/2')
    assert.equal(p.completed, 1)
  })

  it('2 rodadas → fim de jogo 2/2', () => {
    const p = formatRoundProgress(2, 2, true)
    assert.equal(p.label, '2/2')
    assert.equal(p.completed, 2)
  })

  it('5 rodadas padrão → início 0/5', () => {
    assert.equal(formatRoundProgress(1, 5).label, '0/5')
  })

  it('1 rodada → início 0/1 e fim 1/1', () => {
    assert.equal(formatRoundProgress(1, 1).label, '0/1')
    assert.equal(formatRoundProgress(1, 1, true).label, '1/1')
  })

  it('clampEngineRound nunca exibe motor abaixo de 1', () => {
    assert.equal(clampEngineRound(0, 5), 1)
    assert.equal(clampEngineRound(-3, 5), 1)
    assert.equal(clampEngineRound(99, 5), 5)
  })
})
