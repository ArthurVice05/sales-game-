/**
 * Foco do overlay Mais/Resumo — restauração sem roubar janela ativa.
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { shouldRestoreOverlayFocus } from '../useHudOverlayFocus.js'

const root = join(dirname(fileURLToPath(import.meta.url)), '../../../..')
const app = readFileSync(join(root, 'src/App.jsx'), 'utf8')
const focusSrc = readFileSync(join(root, 'src/components/hud/useHudOverlayFocus.js'), 'utf8')
const preview = readFileSync(join(root, 'src/modals/tileModalPreviewMount.js'), 'utf8')

test('Mais fecha ao abrir tutorial ou encaminhar ação do sheet', () => {
  assert.match(app, /openTutorialFromMore/)
  assert.match(app, /onMoreSheetAction/)
  assert.match(app, /setMoreSheetOpen\(false\)[\s\S]{0,80}setTutorialOpen\(true\)/)
  assert.match(app, /setMoreSheetOpen\(false\)[\s\S]{0,80}onControlsAction\(act\)/)
  const moreBlock = app.slice(app.indexOf('{moreSheetOpen &&'), app.indexOf('<TutorialModal'))
  assert.match(moreBlock, /onAction=\{onMoreSheetAction\}/)
  assert.match(moreBlock, /onClick=\{openTutorialFromMore\}/)
})


test('restauração de foco ignora nó removido e diálogo já ativo', () => {
  assert.match(focusSrc, /shouldRestoreOverlayFocus/)
  assert.match(focusSrc, /removeEventListener/)
  assert.match(focusSrc, /setTimeout|queueMicrotask|requestAnimationFrame/)

  const doc = {
    body: { id: 'body' },
    contains(node) { return !!node && node._inDoc !== false },
  }
  const maisBtn = { id: 'mais', focus() {}, _inDoc: true }
  const removed = { id: 'gone', focus() {}, _inDoc: false }
  const tutorialBtn = {
    id: 'tut',
    focus() {},
    _inDoc: true,
    closest(sel) { return String(sel).includes('dialog') || String(sel).includes('aria-modal') ? { id: 'tut-dialog' } : null },
  }

  assert.equal(shouldRestoreOverlayFocus(maisBtn, doc.body, doc), true)
  assert.equal(shouldRestoreOverlayFocus(removed, doc.body, doc), false)
  assert.equal(shouldRestoreOverlayFocus(maisBtn, tutorialBtn, doc), false)
  assert.equal(shouldRestoreOverlayFocus(null, doc.body, doc), false)
})

test('tileModalPreviewMount é só DEV, fora do App, e bloqueia DOM cedo', () => {
  assert.doesNotMatch(app, /tileModalPreviewMount|mountTileModalPreview/)
  assert.match(preview, /onResolve:\s*\(\)\s*=>\s*\{\s*\}/)
  for (const fn of ['mountTileModalPreview', 'unmountTileModalPreview']) {
    const start = preview.indexOf(`export function ${fn}`)
    assert.ok(start >= 0, fn)
    const body = preview.slice(start, start + 420)
    const guardAt = body.search(/if\s*\(\s*!isDevPreview\s*\)/)
    const domAt = body.search(/document\.|getElementById|createElement|createRoot/)
    assert.ok(guardAt >= 0, `${fn} precisa de guard DEV`)
    assert.ok(domAt < 0 || guardAt < domAt, `${fn} deve retornar antes do DOM`)
    assert.match(body, /return false/)
  }
})

