import test from 'node:test'
import assert from 'node:assert/strict'
import { rankPlayersByPatrimonio } from '../../game/patrimonio.js'

const moduleUrl = new URL('../final-winners/resultsPresentation.js', import.meta.url)
const presentation = await import(moduleUrl).catch(() => ({}))

test('escala compartilhada mantém 24.040 / 41.570 sem mínimo artificial', () => {
  assert.equal(typeof presentation.createResultsScale, 'function')
  const scale = presentation.createResultsScale([41570, 24040], 4)
  assert.equal(scale.height(41570), 4)
  assert.ok(Math.abs(scale.height(24040) - 2.3132066394034158) < 1e-12)
  assert.equal(scale.height(0), 0)
})

test('empates, sinais, extremos e inválidos têm escala finita e linear', () => {
  const { createResultsScale } = presentation
  assert.equal(typeof createResultsScale, 'function')
  for (const values of [[0, 0], [10, 10], [-10, 20], [-20, -10], [1e308, -1e308], [1e-10, 1e10], [NaN, Infinity]]) {
    const scale = createResultsScale(values, 4)
    for (const value of values) assert.ok(Number.isFinite(scale.height(value)))
    assert.equal(scale.height(0), 0)
  }
  const signed = createResultsScale([-10, 20], 3)
  assert.equal(signed.height(-10), -1)
  assert.equal(signed.height(20), 2)
  assert.equal(createResultsScale([10, 10], 4).height(10), 4)
  assert.equal(createResultsScale([1, 1000000], 4).height(1), .000004)
})

test('progresso e contagem partem de zero, são monotônicos e terminam exatamente', () => {
  assert.equal(typeof presentation.resultsProgress, 'function')
  const { resultsProgress, countPatrimonio, RESULTS_GROWTH_MS } = presentation
  assert.equal(resultsProgress(0), 0)
  assert.equal(resultsProgress(RESULTS_GROWTH_MS), 1)
  let previous = 0
  for (let time = 0; time <= RESULTS_GROWTH_MS; time += 10) {
    const progress = resultsProgress(time)
    assert.ok(progress >= previous && progress <= 1)
    assert.ok(countPatrimonio(41570, progress) <= 41570)
    assert.ok(countPatrimonio(-100, progress) >= -100)
    previous = progress
  }
  assert.equal(countPatrimonio(41570.25, 1), 41570.25)
  assert.equal(countPatrimonio(-123.45, 1), -123.45)
  assert.equal(countPatrimonio(NaN, .5), null)
})

test('1, 2, 3 e 4 jogadores: posições e falidos preservados, sem mutação', () => {
  assert.equal(typeof presentation.resultsEntries, 'function')
  const players = Object.freeze([
    Object.freeze({ id: 'a', name: 'JP', cash: 26570, bens: 15000 }),
    Object.freeze({ id: 'b', name: 'Arthur', cash: 20040, bens: 4000 }),
    Object.freeze({ id: 'c', name: 'C', cash: 500, bens: 0 }),
    Object.freeze({ id: 'd', name: 'D', cash: 999999, bens: 0, bankrupt: true }),
  ])
  const expected = [[1], [2, 1], [2, 1, 3], [2, 1, 3]]
  for (let n = 1; n <= 4; n++) {
    const ranked = rankPlayersByPatrimonio(players.slice(0, n))
    const before = JSON.stringify(ranked)
    ranked.forEach(Object.freeze); Object.freeze(ranked)
    assert.deepEqual(presentation.resultsEntries(ranked).map(e => e.place), expected[n - 1])
    assert.equal(JSON.stringify(ranked), before)
    if (n === 4) assert.equal(ranked[3].isBankrupt, true)
  }
  const exceptional = [{ id: 'a', patrimonio: 10 }, { id: 'b', patrimonio: 100, isBankrupt: true }]
  assert.deepEqual(presentation.resultsEntries(exceptional).map(e => [e.place, e.player.patrimonio]), [[2, 100], [1, 10]])
})

test('relógio mantém início, limita contadores e termina com valor final', () => {
  assert.equal(typeof presentation.createResultsTimeline, 'function')
  let now = 100, updates = 0
  const timeline = presentation.createResultsTimeline(() => now)
  timeline.subscribe(() => updates++)
  timeline.begin(); now = 1300; timeline.begin()
  assert.equal(timeline.elapsed(), 1200)
  for (let t = 0; t < 2400; t++) timeline.publish(t)
  assert.ok(updates <= 48)
  timeline.finish()
  assert.equal(timeline.getSnapshot(), 1)
  assert.equal(timeline.elapsed(), 3600)
})
