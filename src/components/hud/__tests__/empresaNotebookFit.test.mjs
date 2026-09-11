/**
 * Empresa notebook: 3–4 jogadores visíveis + dica curta sem scroll forçado.
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { consumeTileTip, getShortTileTip, TILE_TIP_SHORT } from '../../../game/progressiveTips.js'

const root = join(dirname(fileURLToPath(import.meta.url)), '../../../..')
const css = readFileSync(join(root, 'src/components/hud/desktop-hud.css'), 'utf8')
const sidebar = readFileSync(join(root, 'src/components/hud/HudDesktopSidebar.jsx'), 'utf8')

test('Empresa usa painel dedicado, dado compacto e roster em grade', () => {
  assert.match(sidebar, /hudDesktopPanel--empresa/)
  assert.match(sidebar, /hudCard--lastAction/)
  assert.match(sidebar, /DiceResult[\s\S]*compact/)
  assert.match(sidebar, /hudRoster--grid/)
  assert.match(sidebar, /hudGaugeRow--compact/)
  assert.doesNotMatch(sidebar, /players\.slice\(/)
})

test('CSS notebook define grade 2×2 e tip curta sem scale/hide', () => {
  assert.match(css, /@media \(min-width: 1024px\)/)
  assert.match(css, /\.hudRoster--grid\s*\{[^}]*grid-template-columns:\s*repeat\(2/)
  const blockIdx = css.indexOf('@media (min-width: 1200px) and (max-height: 900px)')
  assert.ok(blockIdx >= 0)
  const next = css.indexOf('@media', blockIdx + 40)
  const block = css.slice(blockIdx, next > blockIdx ? next : css.length)
  assert.match(block, /progressiveTip/)
  assert.match(block, /progressiveTipMore/)
  assert.doesNotMatch(block, /transform:\s*scale/)
  assert.doesNotMatch(block, /scrollbar-width:\s*none/)
  assert.doesNotMatch(block, /\.hudRosterRow\s*\{\s*display:\s*none/)
})

test('dicas curtas cobrem todos os kinds e LUCK é objetiva', () => {
  for (const kind of Object.keys(TILE_TIP_SHORT)) {
    const t = getShortTileTip(kind)
    assert.ok(t.length > 8, kind)
    assert.ok(t.length <= 110, `${kind} too long: ${t.length}`)
  }
  assert.match(TILE_TIP_SHORT.LUCK, /confirme a carta/i)

  const store = new Map()
  globalThis.sessionStorage = {
    getItem: (k) => (store.has(k) ? store.get(k) : null),
    setItem: (k, v) => { store.set(k, String(v)) },
    removeItem: (k) => { store.delete(k) },
  }
  const tip = consumeTileTip('LUCK')
  assert.equal(tip.text, TILE_TIP_SHORT.LUCK)
  assert.ok(tip.detail && tip.detail.length > tip.text.length)
})
