import assert from 'node:assert/strict'
import test from 'node:test'

import handler, { normalizeClientLogPayload } from '../../../api/client-logs.js'
import {
  classifyMonitoringEvent,
  startVercelLogTransport,
  toRemoteLogEntry,
} from '../vercelLogTransport.js'

test('transporte remoto limita o tamanho e normaliza o nível', () => {
  const entry = toRemoteLogEntry({ level: 'invalid', message: 'x'.repeat(3000), time: '2026-09-13T00:00:00.000Z' })
  assert.equal(entry.level, 'log')
  assert.equal(entry.message.length, 2000)
})

test('monitoramento ignora debug normal e classifica falhas operacionais', () => {
  assert.equal(classifyMonitoringEvent({
    level: 'log',
    message: '[DEBUG] movimento concluído normalmente',
  }), null)

  const conflict = classifyMonitoringEvent({
    level: 'warn',
    message: '[NET] commit conflict (attempt 2/4)',
    time: '2026-09-14T10:00:00.000Z',
  })
  assert.equal(conflict.code, 'NETWORK_COMMIT_CONFLICT')
  assert.equal(conflict.severity, 'warning')

  const clock = classifyMonitoringEvent({
    level: 'warn',
    message: '[MONITOR][CLOCK_SYNC_FAILED]',
  })
  assert.equal(clock.code, 'CLOCK_SYNC_FAILED')
  assert.equal(clock.category, 'turn')

  const revenue = classifyMonitoringEvent({
    level: 'info',
    message: '[MONITOR][REVENUE_CREDIT_APPLIED] {"revenue":14495}',
  })
  assert.equal(revenue.code, 'REVENUE_CREDIT_APPLIED')
  assert.equal(revenue.category, 'economy')

  assert.equal(classifyMonitoringEvent({
    level: 'error',
    message: '[ENGINE_V2] erro no shadow (ignorado): teste',
  }), null)
})

test('transporte envia saúde e erro, mas não envia debug normal', async () => {
  const originalWindow = globalThis.window
  const originalFetch = globalThis.fetch
  let listener
  let sentBody
  const handlers = new Map()
  globalThis.window = {
    sessionStorage: { getItem: () => null, setItem: () => {} },
    location: { pathname: '/jogo', search: '?room=ABCD' },
    navigator: { userAgent: 'Test Browser' },
    addEventListener: (name, fn) => handlers.set(name, fn),
    removeEventListener: name => handlers.delete(name),
    setInterval: () => 1,
    clearInterval: () => {},
  }
  globalThis.fetch = async (_url, options) => {
    sentBody = JSON.parse(options.body)
    return { ok: true }
  }
  const capture = {
    enabled: true,
    subscribe(fn) { listener = fn; return () => { listener = null } },
    addLog() {},
  }

  try {
    const stop = startVercelLogTransport(capture)
    listener({ level: 'log', message: '[DEBUG] fluxo normal' })
    listener({ level: 'error', message: '[NET] commit failed after retries' })
    await new Promise(resolve => setTimeout(resolve, 0))
    stop()
  } finally {
    globalThis.window = originalWindow
    globalThis.fetch = originalFetch
  }

  assert.deepEqual(sentBody.events.map(event => event.code), [
    'CLIENT_MONITORING_STARTED',
    'NETWORK_COMMIT_FAILED',
  ])
  assert.equal(sentBody.metrics.captured, 2)
  assert.equal(sentBody.metrics.ignored, 1)
})

test('endpoint estrutura eventos, limita lotes e remove credenciais', () => {
  const payload = normalizeClientLogPayload({
    schemaVersion: 2,
    sessionId: 'session-1',
    room: 'ABCD',
    release: 'commit-123',
    events: Array.from({ length: 30 }, (_, index) => ({
      severity: index === 0 ? 'error' : 'info',
      code: index === 0 ? 'runtime.failure' : `EVENT_${index}`,
      message: index === 0
        ? 'Authorization: Bearer secret-token eyJabc.def.ghi'
        : `evento-${index}`,
    })),
  })

  assert.equal(payload.events.length, 25)
  assert.equal(payload.events[0].severity, 'error')
  assert.equal(payload.events[0].code, 'RUNTIME_FAILURE')
  assert.equal(payload.release, 'commit-123')
  assert.match(payload.events[0].message, /\[REDACTED\]/)
  assert.doesNotMatch(payload.events[0].message, /secret-token|eyJabc/)
})

test('roll context reaches the endpoint and keeps the complete room UUID', () => {
  const room = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
  const details = { room, matchId: 'm1', playerId: 'p1', turnSeq: 5, reason: 'confirmation-timeout' }
  const event = classifyMonitoringEvent({ level: 'warn',
    message: '[MONITOR][ROLL_CONFIRMATION_RETRY]', args: ['[MONITOR][ROLL_CONFIRMATION_RETRY]', details] })
  const payload = normalizeClientLogPayload({ room, events: [event] })
  assert.equal(payload.room, room)
  assert.deepEqual(payload.events[0].details, details)
})

test('temporary log delivery failure retains events for the next flush', async () => {
  const originalWindow = globalThis.window
  const originalFetch = globalThis.fetch
  let listener
  let tick
  const sent = []
  globalThis.window = {
    sessionStorage: { getItem: () => null, setItem: () => {} },
    location: { pathname: '/', search: '' }, navigator: {},
    addEventListener() {}, removeEventListener() {},
    setInterval(fn) { tick = fn; return 1 }, clearInterval() {},
  }
  globalThis.fetch = async (_url, options) => {
    sent.push(JSON.parse(options.body))
    return { ok: sent.length > 1, status: sent.length === 1 ? 503 : 204 }
  }
  let stop
  try {
    stop = startVercelLogTransport({ enabled: true, subscribe(fn) { listener = fn; return () => {} } })
    listener({ level: 'error', message: '[MONITOR][ROLL_CONFIRMATION_FAILED] offline' })
    await new Promise(resolve => setTimeout(resolve, 0))
    tick()
    await new Promise(resolve => setTimeout(resolve, 0))
    assert.equal(sent.length, 2)
    assert.ok(sent[1].events.some(e => e.code === 'ROLL_CONFIRMATION_FAILED'))
    assert.equal(sent[1].metrics.sendFailures, 1)
  } finally { stop?.(); globalThis.window = originalWindow; globalThis.fetch = originalFetch }
})

test('endpoint aceita o próprio domínio e rejeita origem externa', () => {
  const response = () => ({
    code: null,
    body: null,
    status(code) { this.code = code; return this },
    json(body) { this.body = body; return this },
    end() { return this },
    setHeader() {},
  })

  const blocked = response()
  handler({
    method: 'POST',
    headers: { origin: 'https://example.com', host: 'sales-game.vercel.app' },
    body: { logs: [{ message: 'teste' }] },
  }, blocked)
  assert.equal(blocked.code, 403)

  const accepted = response()
  const originalConsole = { info: console.info, warn: console.warn, error: console.error }
  console.info = () => {}
  console.warn = () => {}
  console.error = () => {}
  try {
    handler({
      method: 'POST',
      headers: { origin: 'https://sales-game.vercel.app', host: 'sales-game.vercel.app' },
      body: { logs: [{ message: 'teste' }] },
    }, accepted)
  } finally {
    Object.assign(console, originalConsole)
  }
  assert.equal(accepted.code, 204)
})
