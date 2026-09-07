/**
 * Resume F5: fila setTurnPlayerId(null) + apply incoming via updater funcional.
 * Não cria scheduler/retry. Só caracteriza a identidade do turno.
 */
import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const appSrc = readFileSync(join(here, '..', '..', 'App.jsx'), 'utf8')

const ARTHUR = 'Arthur'
const BRUNO = 'Bruno'

function parseIncomingTurnPlayerId(raw) {
  if (raw === undefined || raw === null || String(raw) === '') return null
  return String(raw)
}

/** Semântica nova: decisão no updater, sempre enfileirado se incoming é válido. */
function applyIncomingTurnPlayerId(prev, incomingTurnId) {
  const incoming = parseIncomingTurnPlayerId(incomingTurnId)
  if (!incoming) return prev
  return String(prev || '') === incoming ? prev : incoming
}

/** Semântica antiga (closure): compara o valor capturado, não o prev da fila. */
function applyIncomingTurnPlayerIdStaleClosure(closureTurnPlayerId, incomingTurnId) {
  const incoming = parseIncomingTurnPlayerId(incomingTurnId)
  if (incoming && String(closureTurnPlayerId || '') !== incoming) return incoming
  return undefined
}

function applyQueuedTurnPlayerUpdates(initial, updates) {
  let value = initial
  for (const step of updates) {
    if (step.kind === 'reset') {
      value = null
      continue
    }
    if (step.kind === 'apply') {
      value = applyIncomingTurnPlayerId(value, step.incomingTurnId)
    }
  }
  return value
}

describe('wiring applyRemoteNetState', () => {
  it('não compara turnPlayerId da closure; enfileira updater funcional', () => {
    assert.doesNotMatch(
      appSrc,
      /if \(incomingTurnId && String\(turnPlayerId \|\| ''\) !== incomingTurnId\)/,
    )
    assert.match(
      appSrc,
      /if \(incomingTurnId\) \{\s*setTurnPlayerId\(\(prev\) =>/,
    )
  })
})

describe('fila reset + apply incoming', () => {
  it('Arthur → reset null → incoming Arthur → Arthur', () => {
    const finalId = applyQueuedTurnPlayerUpdates(ARTHUR, [
      { kind: 'reset' },
      { kind: 'apply', incomingTurnId: ARTHUR },
    ])
    assert.equal(finalId, ARTHUR)
  })

  it('A — local Bruno, incoming Arthur → Arthur', () => {
    assert.equal(applyIncomingTurnPlayerId(BRUNO, ARTHUR), ARTHUR)
  })

  it('B — local Arthur, incoming Arthur, sem reset → Arthur', () => {
    const same = applyIncomingTurnPlayerId(ARTHUR, ARTHUR)
    assert.equal(same, ARTHUR)
  })

  it('C — closure ainda Arthur, fila já tem reset null, incoming Arthur → Arthur', () => {
    const closure = ARTHUR
    const stale = applyIncomingTurnPlayerIdStaleClosure(closure, ARTHUR)
    assert.equal(stale, undefined, 'closure antiga pula o setter')

    const finalId = applyQueuedTurnPlayerUpdates(closure, [
      { kind: 'reset' },
      { kind: 'apply', incomingTurnId: ARTHUR },
    ])
    assert.equal(finalId, ARTHUR)
  })

  it('D — incoming ausente/null não inventa jogador', () => {
    assert.equal(applyIncomingTurnPlayerId(ARTHUR, null), ARTHUR)
    assert.equal(applyIncomingTurnPlayerId(ARTHUR, ''), ARTHUR)
    assert.equal(applyIncomingTurnPlayerId(ARTHUR, undefined), ARTHUR)
    assert.equal(
      applyQueuedTurnPlayerUpdates(ARTHUR, [
        { kind: 'reset' },
        { kind: 'apply', incomingTurnId: null },
      ]),
      null,
    )
  })
})
