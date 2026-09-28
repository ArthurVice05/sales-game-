import test from 'node:test'
import assert from 'node:assert/strict'
import { classifyModal, expectedCard } from '../modal-policy.mjs'
import { parseMoney } from '../assertions.mjs'
import { consolidate } from '../consolidate.mjs'
import { parseConfig } from '../config.mjs'
import { evaluateCriteria } from '../criteria.mjs'

test('OK desconhecido não autoriza clique; modais conhecidos têm classificação explícita', () => {
  assert.throws(() => classifyModal({ title: 'Surpresa', text: 'OK', buttons: [{ text: 'OK' }] }), /unknown-modal/)
  for (const [title, want] of [['Sorte e Revés','fortune'], ['Faturamento do mês','revenue'], ['Despesas do mês','expenses'], ['Carteira de Clientes','purchase'], ['Declarar Falência','bankruptcy'], ['Fim da partida','final']]) {
    assert.equal(classifyModal({ title, text: '', buttons: [] }), want)
  }
})
test('oráculo das cartas é comparado com valores independentes para casos conhecidos', () => {
  assert.deepEqual(expectedCard({ text: 'Indicação Lucrativa' }, { clients: 1 }).delta, { cash: 800, clients: 0 })
  assert.deepEqual(expectedCard({ text: 'Crise nas Redes' }, { clients: 1 }).delta, { cash: -400, clients: -1 })
  assert.deepEqual(expectedCard({ text: 'Mix A Ausente' }, { mixProdutos: 'A', clients: 1 }).delta, { cash: 0, clients: 0 })
})
test('valores visíveis preservam sinal e separadores dos dois locales usados no produto', () => {
  assert.equal(parseMoney('Contratar por $ 1.000'), 1000)
  assert.equal(parseMoney('-$ 1,000'), -1000)
  assert.equal(parseMoney('$ 1.234,56'), 1234.56)
  assert.equal(parseMoney('$ 1,234.56'), 1234.56)
  assert.equal(parseMoney('$ 1,5'), 1.5)
  assert.equal(parseMoney('R$ 0'), 0)
  assert.equal(parseMoney('Comprar'), null)
})

test('um erro monetário em jogador não dono é identificado mesmo que o dono tenha delta correto', async () => {
  const { verifyDelta } = await import('../assertions.mjs')
  const before = [{ id: 'a', cash: 1000 }, { id: 'b', cash: 1000 }]
  assert.throws(() => verifyDelta(before, [{ id: 'a', cash: 800 }, { id: 'b', cash: 800 }], 'a', { cash: -200 }), /delta/)
})
test('consolidação rejeita shards ausentes e nunca soma picos não simultâneos', () => {
  const config = { shards: 2, rooms: 2, startAt: 0, rampMs: 0, windowMs: 2000, sampleMs: 1000, maxClockSkewMs: 250, runId: 'test', profile: 'functional' }
  const make = (index, active) => ({ config: { ...config, shardIndex: index }, fingerprint: 'same', status: 'PASS', criteria: { pass: true }, clock: { uncertaintyMs: 1 }, rooms: [], latencies: [], samples: [0,1000,2000].map((at, i) => ({ at, active: active[i] })) })
  assert.throws(() => consolidate([make(0, [4,4,4])]), /Shards/)
  assert.equal(consolidate([make(0, [4,4,0]), make(1, [0,4,4])]).status, 'FAIL')
})
test('smoke sem partida concluída ou efeito não comprovado não libera ampliação', () => {
  const config = parseConfig(['--profile=smoke'], { SG_LAB_URL: 'https://stage.test', SG_LAB_SUPABASE_ORIGIN: 'https://db.test', SG_LAB_TEST_BACKEND: 'exclusive-test' })
  const data = { samples: [{ at: 0, active: 4 }], events: [], failures: [], rooms: [], latencies: [] }
  assert.equal(evaluateCriteria(config, data).pass, false)
  data.rooms.push({ index: 0, status: 'complete', actions: 4, unproven: ['sem actionId'] })
  assert.equal(evaluateCriteria(config, data).pass, false)
})
