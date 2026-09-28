import test from 'node:test'
import assert from 'node:assert/strict'
const config = await import('../config.mjs').catch(() => ({}))
const assertions = await import('../assertions.mjs').catch(() => ({}))
const metrics = await import('../metrics.mjs').catch(() => ({}))
const safety = await import('../safety.mjs').catch(() => ({}))
const base = { SG_LAB_URL: 'https://stage.example.test', SG_LAB_SUPABASE_ORIGIN: 'https://db.example.test', SG_LAB_TEST_BACKEND: 'exclusive-test', SG_LAB_RUN_ID: 'unit-run' }

test('destino deve ser explícito e exclusivo de teste antes de abrir navegador', () => {
  assert.equal(typeof config.parseConfig, 'function')
  assert.throws(() => config.parseConfig([], {}), /URL/)
  assert.throws(() => config.parseConfig([], { ...base, SG_LAB_TEST_BACKEND: '' }), /exclusive-test/)
  assert.throws(() => config.parseConfig(['--players-per-room=100'], base), /4/)
  assert.throws(() => config.parseConfig(['--rooms=25', '--shards=5', '--shard-index=5'], base), /shard/)
  assert.throws(() => config.parseConfig(['--url=https://u:p@stage.test'], base), /credenciais/)
  assert.throws(() => config.parseConfig(['--run-id=../../bad'], base), /runId/)
})

test('shards particionam salas inteiras sem colisões e seed só determina escolhas do script', () => {
  assert.equal(typeof config.roomIndexes, 'function')
  const all = []
  for (let shardIndex = 0; shardIndex < 5; shardIndex++) {
    const rooms = config.roomIndexes({ rooms: 25, shards: 5, shardIndex })
    assert.equal(rooms.length, 5); all.push(...rooms)
  }
  assert.equal(new Set(all).size, 25)
  assert.equal(config.roomName('run', 3, 2), 'SG-run-r03-g002')
  const a = config.decisionRandom('seed', 'person'), b = config.decisionRandom('seed', 'person')
  assert.deepEqual(Array.from({ length: 20 }, a), Array.from({ length: 20 }, b))
})

test('concorrência exige janela inteira, não pico ou páginas em lobby', () => {
  assert.equal(typeof metrics.assessConcurrency, 'function')
  const samples = [0, 1000, 2000, 3000].map(at => ({ at, active: 100 }))
  assert.equal(metrics.assessConcurrency(samples, 0, 3000, 100, 1000).pass, true)
  assert.equal(metrics.assessConcurrency(samples.map(s => ({ ...s, active: s.at === 1000 ? 40 : 100 })), 0, 3000, 100, 1000).pass, false)
  assert.equal(metrics.assessConcurrency([{ at: 0, active: 100 }, { at: 3000, active: 100 }], 0, 3000, 100, 1000).pass, false)
  assert.equal(metrics.assessConcurrency([], 0, 3000, 100, 1000).pass, false)
})

test('identidade, contaminação e efeitos indevidos geram falha, não sucesso por HTTP', () => {
  assert.equal(typeof assertions.verifyRoster, 'function')
  const roster = [0, 1, 2, 3].map(i => ({ id: `p${i}`, name: `run-${i}`, seat: i }))
  assertions.verifyRoster(roster, roster)
  assert.throws(() => assertions.verifyRoster([{ ...roster[0], seat: 1 }, ...roster.slice(1)], roster), /assento/)
  assert.throws(() => assertions.verifyRoster([...roster.slice(0, 3), { id: 'other', name: 'stranger', seat: 3 }], roster), /identidade/)
  const before = roster.map(p => ({ ...p, cash: 18000, bens: 4000 }))
  const after = before.map(p => ({ ...p, cash: p.id === 'p0' ? 17000 : p.cash, bens: p.id === 'p0' ? 5000 : p.bens }))
  assertions.verifyDelta(before, after, 'p0', { cash: -1000, bens: 1000 })
  assert.throws(() => assertions.verifyDelta(before, after.map(p => ({ ...p, cash: p.id === 'p0' ? 16000 : p.cash })), 'p0', { cash: -1000, bens: 1000 }), /delta/)
})

test('sanitização remove tokens, cookies e query secreta das evidências', () => {
  assert.equal(typeof safety.sanitize, 'function')
  const result = JSON.stringify(safety.sanitize({ Authorization: 'Bearer abc', apikey: 'secret', url: 'https://db.test/x?apikey=secret&code=room', message: 'Bearer eyJhbGciOiJIUzI1NiJ9.abc.xyz', headers: [{ name: 'Cookie', value: 'session=secret' }] }))
  assert.doesNotMatch(result, /secret|eyJhbGciOiJIUzI1NiJ9|session=/)
  assert.match(result, /room/)
})
