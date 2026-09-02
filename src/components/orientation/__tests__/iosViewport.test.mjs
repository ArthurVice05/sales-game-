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

test('hook iOS sincroniza largura, altura, offsets, listeners e cleanup', () => {
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
  assert.match(hook, /if \(!isIOSDevice\(\)\) return undefined/)
})

test('Android landscape não depende de html.sg-ios para caber na viewport', () => {
  const marker = css.lastIndexOf('/* ====== Mobile landscape (touch): tabuleiro em prioridade')
  const iosMarker = css.indexOf('/* ====== iOS / WebKit ONLY', marker)
  const generic = css.slice(marker, iosMarker > marker ? iosMarker : marker + 14000)
  assert.doesNotMatch(generic, /html\.sg-ios/)
  assert.match(generic, /padding-right:\s*env\(safe-area-inset-right/)
  assert.match(css, /html\.sg-ios \.page\s*\{[^}]*--sg-vv-width/)
})
