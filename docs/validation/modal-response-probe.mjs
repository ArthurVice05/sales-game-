// Diagnostic only: executes the actual ModalContext callbacks with controlled refs.
// This does not mount React, render the game or reproduce browser scheduling.
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import vm from 'node:vm'

const source = readFileSync(new URL('../../src/modals/ModalContext.jsx', import.meta.url), 'utf8')
const callbacks = source.slice(source.indexOf('  const resolveAllForId ='), source.indexOf('  // utilitários para botões'))
const awaitCallback = source.slice(source.indexOf('  const awaitTop ='), source.indexOf('  // ⚠️ Sem listener'))
assert.ok(callbacks.includes('const closeById ='))
assert.ok(awaitCallback.includes('waiters.add(resolve)'))

function harness() {
  let stack = [{ id: 'card-1' }]
  const stackRef = { current: stack }
  const ctx = vm.createContext({
    React: { useCallback: fn => fn },
    stackRef,
    resolversByIdRef: { current: new Map() },
    setStack: next => { stack = typeof next === 'function' ? next(stack) : next },
    console,
  })
  const api = vm.runInContext(`${callbacks}\n${awaitCallback}\n;({ closeById, awaitTop })`, ctx)
  return { ...api, flush: () => { stackRef.current = stack } }
}

const payload = { action: 'APPLY_CARD', cashDelta: 800 }
const normal = harness()
const response = normal.awaitTop()
normal.closeById('card-1', payload)
assert.equal((await response).cashDelta, 800)
console.log('CONTROL: listener before confirmation preserves cashDelta=800')

const early = harness()
early.closeById('card-1', payload)
early.flush()
const lost = await early.awaitTop()
assert.equal(lost, null)
console.log('REPRODUCED: confirmation before listener, after ref update => null (payload lost)')

const stale = harness()
stale.closeById('card-1', payload)
const pending = stale.awaitTop()
stale.flush()
let settled = false
pending.then(() => { settled = true })
await Promise.resolve()
await Promise.resolve()
assert.equal(settled, false)
console.log('REPRODUCED: confirmation before listener, stale stack ref => unresolved response')
console.log('LIMIT: isolated production callbacks; real browser timing not tested')
