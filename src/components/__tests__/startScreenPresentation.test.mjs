import test from 'node:test'
import assert from 'node:assert/strict'
import { existsSync, readFileSync, statSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '../../..')
const start = readFileSync(join(root, 'src/components/StartScreen.jsx'), 'utf8')
const startCssPath = join(root, 'src/components/start-screen.css')
const bgPath = join(root, 'public/images/start/salesgame-background.jpg')

test('StartScreen usa o novo fundo estável e o logo original', () => {
  assert.match(start, /images\/start\/salesgame-background\.(jpg|png|webp)/)
  assert.doesNotMatch(start, /dynamic-data-visualization-3d/)
  assert.match(start, /SalesGame_Logo-removebg-preview\.png/)
  assert.match(start, /alt=["']Sales GAME["']/)
  assert.ok(existsSync(bgPath), 'asset público do fundo deve existir')
  assert.ok(statSync(bgPath).size > 20_000, 'asset do fundo não deve estar vazio')
})

test('StartScreen agrupa logo e formulário sem remontar o input', () => {
  assert.match(start, /startStack/)
  assert.match(start, /start-screen\.css/)
  assert.match(start, /id=["']playerName["']/)
  assert.match(start, /Jogar online/)
  assert.match(start, /Jogar neste dispositivo/)
  assert.match(start, /Como jogar/)
  assert.match(start, /Duração:/)
  assert.match(start, /Objetivo:/)
  assert.match(start, /Vitória:/)
  assert.doesNotMatch(start, /TironiCredit|tironiCredit/)
  // Um único campo controlado — redimensionar não remonta outro input
  const inputs = start.match(/id=["']playerName["']/g) || []
  assert.equal(inputs.length, 1)
})

test('start-screen.css restringe apresentação ao .start', () => {
  assert.ok(existsSync(startCssPath), 'start-screen.css deve existir')
  const css = readFileSync(startCssPath, 'utf8')
  assert.match(css, /\.start\s*\{/)
  assert.match(css, /\.start\s+\.startBg|\.startBg/)
  assert.match(css, /object-fit:\s*cover/)
  assert.match(css, /object-position/)
  assert.match(css, /\.startStack/)
  assert.doesNotMatch(css, /^body\s*\{/m)
  assert.doesNotMatch(css, /^\.btn\s*\{/m)
})
