import test from 'node:test'
import assert from 'node:assert/strict'
import { confirmRollClaim } from '../rollStartRecovery.js'

test('pending claim times out and retries with an aborted previous request', async () => {
  const signals = []
  const retries = []
  const result = await confirmRollClaim({
    timeoutMs: 10,
    isCurrent: () => true,
    commit: ({ signal }) => {
      signals.push(signal)
      return signals.length === 1 ? new Promise(() => {}) : Promise.resolve({ ok: true })
    },
    onRetry: reason => retries.push(reason),
  })
  assert.equal(result.ok, true)
  assert.equal(signals.length, 2)
  assert.equal(signals[0].aborted, true)
  assert.deepEqual(retries, ['confirmation-timeout'])
})

test('offline failure finishes with retryable status instead of holding the button forever', async () => {
  let calls = 0
  const result = await confirmRollClaim({
    timeoutMs: 10, isCurrent: () => true,
    commit: () => { calls++; return new Promise(() => {}) },
  })
  assert.equal(result.ok, false)
  assert.equal(result.retryable, true)
  assert.equal(calls, 2)
})

test('cancellation stops an in-flight claim and does not start another attempt', async () => {
  const controller = new AbortController()
  let calls = 0
  const waiting = confirmRollClaim({ signal: controller.signal, timeoutMs: 5000,
    isCurrent: () => true, commit: () => { calls++; return new Promise(() => {}) },
  })
  await Promise.resolve()
  controller.abort()
  assert.equal((await waiting).reason, 'roll-obsolete')
  assert.equal(calls, 1)
})

test('changed turn and a claim rejected by the server are never retried', async () => {
  let current = true
  let calls = 0
  const result = await confirmRollClaim({ isCurrent: () => current,
    commit: async () => { calls++; current = false; return { ok: true } },
  })
  assert.equal(result.ok, false)
  assert.equal(calls, 1)
  const rejected = await confirmRollClaim({ isCurrent: () => true,
    commit: async () => { calls++; return { ok: false, casLost: true, reason: 'already-rolled' } },
  })
  assert.equal(rejected.retryable, false)
  assert.equal(calls, 2)
})
