/**
 * Foco ao fechar camada superior (ex.: InsufficientFunds).
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  isElementFocusableVisible,
  pickDecisionFallbackFocus,
  resolveModalFocusRestore,
} from '../modalFocusRestore.js'

const root = join(dirname(fileURLToPath(import.meta.url)), '../../..')
const ctx = readFileSync(join(root, 'src/modals/ModalContext.jsx'), 'utf8')

function fakeEl(overrides = {}) {
  const el = {
    focus() { this.focused = true },
    focused: false,
    isConnected: true,
    disabled: false,
    offsetParent: {},
    closest() { return null },
    getAttribute() { return null },
    contains(other) { return other === this || this._kids?.includes(other) },
    querySelectorAll() { return [] },
    querySelector() { return null },
    ...overrides,
  }
  return el
}

test('isElementFocusableVisible rejeita inert, desconectado e disabled', () => {
  assert.equal(isElementFocusableVisible(null), false)
  assert.equal(isElementFocusableVisible(fakeEl({ isConnected: false })), false)
  assert.equal(isElementFocusableVisible(fakeEl({ disabled: true })), false)
  assert.equal(
    isElementFocusableVisible(fakeEl({ closest: (s) => (s === '[inert]' ? {} : null) })),
    false,
  )
  assert.equal(isElementFocusableVisible(fakeEl()), true)
})

test('resolveModalFocusRestore prefere o controle que abriu o aviso', () => {
  const opener = fakeEl()
  const layer = fakeEl({
    querySelectorAll: () => [],
  })
  const r = resolveModalFocusRestore({
    returnFocusTo: opener,
    revealedLayerRoot: layer,
    activeElement: fakeEl({ isConnected: true, offsetParent: null }),
  })
  assert.equal(r.action, 'opener')
  assert.equal(r.target, opener)
})

test('resolveModalFocusRestore não rouba foco se camada superior ainda existir', () => {
  const opener = fakeEl()
  const r = resolveModalFocusRestore({
    returnFocusTo: opener,
    revealedLayerRoot: fakeEl(),
    upperLayerStillOpen: true,
  })
  assert.equal(r.action, 'skip-upper')
  assert.equal(r.target, null)
})

test('resolveModalFocusRestore usa fallback da decisão se opener sumiu', () => {
  const confirm = fakeEl()
  const layer = fakeEl({
    querySelectorAll: (sel) => (sel.includes('confirm') ? [confirm] : []),
  })
  const r = resolveModalFocusRestore({
    returnFocusTo: fakeEl({ isConnected: false }),
    revealedLayerRoot: layer,
    activeElement: { isConnected: false },
  })
  assert.equal(r.action, 'fallback')
  assert.equal(r.target, confirm)
})

test('pickDecisionFallbackFocus prioriza botão de confirmar', () => {
  const confirm = fakeEl()
  const input = fakeEl()
  const layer = fakeEl({
    querySelectorAll: (sel) => {
      if (String(sel).includes('tileModalBtn--confirm')) return [confirm]
      if (String(sel).includes('type="number"')) return [input]
      return []
    },
  })
  assert.equal(pickDecisionFallbackFocus(layer), confirm)
})

test('ModalContext captura returnFocus e restaura ao fechar o topo', () => {
  assert.match(ctx, /returnFocusTo/)
  assert.match(ctx, /modalFocusRestore|applyModalFocusRestore|resolveModalFocusRestore/)
  assert.match(ctx, /data-modal-layer|revealedLayerRoot/)
})
