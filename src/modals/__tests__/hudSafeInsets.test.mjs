/**
 * Decisão aberta no desktop não cobre o HUD superior (métricas) nem o lateral.
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '../../..')
const read = (rel) => readFileSync(join(root, rel), 'utf8')
const { computeHudSafeInsets, HUD_SAFE_GAP } = await import('../useHudSafeInsets.js')

test('1366×625: recuo = base do cabeçalho e início real da sidebar', () => {
  const insets = computeHudSafeInsets({
    viewportWidth: 1366,
    viewportHeight: 625,
    headerRect: { left: 0, top: 0, bottom: 80, width: 1366, height: 80 },
    sideRect: { left: 1034, top: 92, bottom: 613, width: 320, height: 521 },
  })
  assert.deepEqual(insets, { top: 80 + HUD_SAFE_GAP, right: 1366 - 1034 + HUD_SAFE_GAP })
})

test('sem cabeçalho/sidebar (mobile) não reserva nada', () => {
  assert.equal(computeHudSafeInsets({ viewportWidth: 844, viewportHeight: 390 }), null)
  assert.equal(
    computeHudSafeInsets({
      viewportWidth: 844,
      viewportHeight: 390,
      headerRect: { left: 0, top: 0, bottom: 0, width: 0, height: 0 },
      sideRect: { left: 0, top: 0, bottom: 0, width: 0, height: 0 },
    }),
    null,
  )
})

test('recuo nunca passa de metade da tela', () => {
  const insets = computeHudSafeInsets({
    viewportWidth: 1200,
    viewportHeight: 300,
    headerRect: { left: 0, top: 0, bottom: 280, width: 1200, height: 280 },
    sideRect: { left: 100, top: 0, bottom: 300, width: 1100, height: 300 },
  })
  assert.deepEqual(insets, { top: 150, right: 600 })
})

test('ModalContext aplica o recuo medido no overlay e CSS eleva o cabeçalho', () => {
  const ctx = read('src/modals/ModalContext.jsx')
  assert.match(ctx, /useHudSafeInsets\(stack\.length > 0\)/)
  assert.match(ctx, /data-hud-safe=/)
  assert.match(ctx, /\.\.\.hudSafeStyle/)
  const css = read('src/modals/decision-hud-bridge.css')
  assert.match(css, /\[data-sg-modal-depth="1"\] \.page\[data-game-shell\] > \.gameDesktopHeader \{[\s\S]{0,120}z-index:\s*10050/)
})
