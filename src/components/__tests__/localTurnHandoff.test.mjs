import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'

const setupPath = new URL('../LocalGameSetup.jsx', import.meta.url)
const handoffPath = new URL('../LocalTurnHandoff.jsx', import.meta.url)

test('LocalGameSetup uses official limits, presets, and local name validation', async () => {
  const source = await readFile(setupPath, 'utf8')
  assert.match(source, /MIN_ROUNDS/)
  assert.match(source, /MAX_ROUNDS_LIMIT/)
  assert.match(source, /DEFAULT_MAX_ROUNDS/)
  assert.match(source, /TURN_TIME_PRESETS/)
  assert.match(source, /DEFAULT_TURN_TIME_SEC/)
  assert.match(source, /validateLocalPlayerNames/)
  assert.match(source, /onStart\?\./)
  assert.doesNotMatch(source, /Supabase|createLobby|joinLobby|startMatch/)
})

test('LocalTurnHandoff is an opaque accessible portal that blocks the game below', async () => {
  const source = await readFile(handoffPath, 'utf8')
  assert.match(source, /createPortal/)
  assert.match(source, /role="dialog"/)
  assert.match(source, /aria-modal="true"/)
  assert.match(source, /localHandoffButton/)
  assert.match(source, /\.focus\(\)/)
  assert.match(source, /setAttribute\('inert'/)
  assert.match(source, /removeAttribute\('inert'/)
  assert.match(source, /document\.body/)
  assert.doesNotMatch(source, /cash|bens|patrim[oô]nio|clientes|faturamento/i)
})
