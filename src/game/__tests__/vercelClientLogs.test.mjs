import assert from 'node:assert/strict'
import test from 'node:test'

import handler, { normalizeClientLogPayload } from '../../../api/client-logs.js'
import { toRemoteLogEntry } from '../vercelLogTransport.js'

test('transporte remoto limita o tamanho e normaliza o nível', () => {
  const entry = toRemoteLogEntry({ level: 'invalid', message: 'x'.repeat(3000), time: '2026-09-13T00:00:00.000Z' })
  assert.equal(entry.level, 'log')
  assert.equal(entry.message.length, 2000)
})

test('endpoint limita lotes e remove credenciais dos logs', () => {
  const payload = normalizeClientLogPayload({
    sessionId: 'session-1',
    room: 'ABCD',
    logs: Array.from({ length: 30 }, (_, index) => ({
      level: index === 0 ? 'error' : 'debug',
      message: index === 0
        ? 'Authorization: Bearer secret-token eyJabc.def.ghi'
        : `evento-${index}`,
    })),
  })

  assert.equal(payload.logs.length, 25)
  assert.equal(payload.logs[0].level, 'error')
  assert.match(payload.logs[0].message, /\[REDACTED\]/)
  assert.doesNotMatch(payload.logs[0].message, /secret-token|eyJabc/)
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
  const originalLog = console.log
  console.log = () => {}
  try {
    handler({
      method: 'POST',
      headers: { origin: 'https://sales-game.vercel.app', host: 'sales-game.vercel.app' },
      body: { logs: [{ message: 'teste' }] },
    }, accepted)
  } finally {
    console.log = originalLog
  }
  assert.equal(accepted.code, 204)
})
