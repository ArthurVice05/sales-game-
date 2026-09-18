import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import {
  REVES_CHANCE,
  SORTE_CHANCE,
  pickSorteRevesCard,
} from '../sorteRevesCards.js'

describe('Sorte & Revés — probabilidade por categoria', () => {
  it('configura 65% para Sorte e 35% para Revés', () => {
    assert.equal(SORTE_CHANCE, 0.65)
    assert.equal(REVES_CHANCE, 0.35)
    assert.equal(SORTE_CHANCE + REVES_CHANCE, 1)
  })

  it('respeita a fronteira exata entre as categorias', () => {
    assert.equal(pickSorteRevesCard(() => 0).kind, 'SORTE')
    assert.equal(pickSorteRevesCard(() => 0.649999).kind, 'SORTE')
    assert.equal(pickSorteRevesCard(() => 0.65).kind, 'REVES')
    assert.equal(pickSorteRevesCard(() => 0.999999).kind, 'REVES')
  })

  it('produz 65 Sorte e 35 Revés em 100 pontos uniformes', () => {
    const kinds = Array.from({ length: 100 }, (_, index) =>
      pickSorteRevesCard(() => (index + 0.5) / 100).kind,
    )
    assert.equal(kinds.filter((kind) => kind === 'SORTE').length, 65)
    assert.equal(kinds.filter((kind) => kind === 'REVES').length, 35)
  })
})
