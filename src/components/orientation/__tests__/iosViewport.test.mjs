import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { isIOSDevice } from '../../../utils/iosDetect.js'

const root = join(dirname(fileURLToPath(import.meta.url)), '../../../..')
const css = readFileSync(join(root, 'src/styles.css'), 'utf8')
const hook = readFileSync(join(root, 'src/hooks/useIosVisualViewport.js'), 'utf8')

test('isIOSDevice é false em ambiente Node (sem navigator iOS)', () => {
  assert.equal(isIOSDevice(), false)
})

test('hook sincroniza visualViewport em todos os navegadores e mantém classe iOS específica', () => {
  assert.match(hook, /vv\.width/)
  assert.match(hook, /--sg-vv-width/)
  assert.match(hook, /--sg-vv-height/)
  assert.match(hook, /--sg-vv-offset-top/)
  assert.match(hook, /--sg-vv-offset-left/)
  assert.match(hook, /addEventListener\('resize'/)
  assert.match(hook, /addEventListener\('orientationchange'/)
  assert.match(hook, /vv\?\.addEventListener\?\.\('resize'/)
  assert.match(hook, /vv\?\.addEventListener\?\.\('scroll'/)
  assert.match(hook, /removeProperty\('--sg-vv-width'\)/)
  assert.match(hook, /removeProperty\('--sg-vv-height'\)/)
  assert.match(hook, /classList\.remove\(IOS_CLASS\)/)
  assert.match(hook, /VISUAL_VIEWPORT_CLASS/)
  assert.match(hook, /classList\.add\(VISUAL_VIEWPORT_CLASS\)/)
  assert.match(hook, /classList\.remove\(VISUAL_VIEWPORT_CLASS\)/)
  assert.doesNotMatch(hook, /if \(!isIOSDevice\(\)\) return undefined/)
})

test('partida usa a altura do visualViewport também em tablet com layout desktop', () => {
  assert.match(
    css,
    /html\.sg-visual-viewport \.page\[data-game-shell\]\s*\{[^}]*height:\s*var\(--sg-vv-height,\s*100dvh\)/,
  )
  assert.match(
    css,
    /html\.sg-visual-viewport \.page\[data-game-shell\] > \.content\s*\{[^}]*flex:\s*1\s+1\s+0%[^}]*height:\s*auto/,
  )
})

test('Android landscape não depende de html.sg-ios para caber na viewport', () => {
  const marker = css.lastIndexOf('/* ====== Mobile landscape (touch): tabuleiro em prioridade')
  const iosMarker = css.indexOf('/* ====== iOS / WebKit ONLY', marker)
  const generic = css.slice(marker, iosMarker > marker ? iosMarker : marker + 14000)
  assert.doesNotMatch(generic, /html\.sg-ios/)
  assert.match(generic, /padding-right:\s*env\(safe-area-inset-right/)
  assert.match(css, /html\.sg-ios \.page\s*\{[^}]*--sg-vv-width/)
})
