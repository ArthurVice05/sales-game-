/**
 * Cards numéricos do HUD: valores altos não podem vazar do quadrado
 * (ex.: notebook 1366×768). Reduz fonte → formato compacto → title completo.
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '../../../..')
const hudDir = join(root, 'src/components/hud')
const read = (f) => readFileSync(join(hudDir, f), 'utf8')

const { resolveMetricFit, METRIC_MIN_SCALE } = await import('../useFitMetricValue.js')
const { formatGameMoneyCompact, formatGameMoney } = await import('../../gameStats.js')

const clean = (s) => s.replace(/\s/g, ' ')

test('valor que cabe mantém fonte e formato completos', () => {
  assert.deepEqual(resolveMetricFit({ available: 120, fullWidth: 80, compactWidth: 60 }), { compact: false, scale: 1 })
})

test('valor um pouco maior só reduz a fonte', () => {
  const fit = resolveMetricFit({ available: 90, fullWidth: 100, compactWidth: 60 })
  assert.equal(fit.compact, false)
  assert.ok(fit.scale < 1 && fit.scale >= METRIC_MIN_SCALE)
  assert.ok(100 * fit.scale <= 90)
})

test('valor muito maior troca para o formato compacto', () => {
  const fit = resolveMetricFit({ available: 90, fullWidth: 200, compactWidth: 70 })
  assert.deepEqual(fit, { compact: true, scale: 1 })
  const tight = resolveMetricFit({ available: 90, fullWidth: 200, compactWidth: 110 })
  assert.equal(tight.compact, true)
  assert.ok(tight.scale < 1)
})

test('sem medida (SSR/teste) não altera nada', () => {
  assert.deepEqual(resolveMetricFit({ available: 0, fullWidth: 0 }), { compact: false, scale: 1 })
})

test('formato compacto em pt-BR', () => {
  assert.equal(clean(formatGameMoneyCompact(1234567)), 'R$ 1,2 mi')
  assert.equal(clean(formatGameMoneyCompact(16850)), 'R$ 16,9 mil')
  assert.equal(clean(formatGameMoneyCompact(-123456789)), '-R$ 123,5 mi')
  assert.equal(formatGameMoneyCompact(770), formatGameMoney(770))
})

test('cabeçalho e sidebar passam valor compacto; card limita o valor', () => {
  const header = read('GameDesktopHeader.jsx')
  const sidebar = read('HudDesktopSidebar.jsx')
  const card = read('HudMetricCard.jsx')
  const css = read('desktop-hud.css')
  assert.equal((header.match(/compactValue=/g) || []).length, 4)
  assert.equal((sidebar.match(/compactValue=/g) || []).length, 4)
  assert.match(card, /useFitMetricValue/)
  assert.match(card, /title=/)
  assert.match(css, /\.hudMetricCardValue \{[\s\S]{0,400}overflow:\s*hidden/)
  assert.match(css, /\.hudMetricCardMeasure \{[\s\S]{0,200}visibility:\s*hidden/)
})
