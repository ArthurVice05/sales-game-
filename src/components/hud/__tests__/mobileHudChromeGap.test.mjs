/**
 * Chrome HUD: mobile landscape abaixo de 1200px — sem lacuna por altura.
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { COMPACT_LANDSCAPE_MEDIA, getCompactLandscapeHudMatches } from '../useCompactLandscapeHud.js'
import { DESKTOP_HUD_MEDIA, getDesktopHudLayoutMatches } from '../useDesktopHudLayout.js'
import {
  hudChromeModeForViewport,
  hudLayerForViewport,
} from '../mobileLandscapeViewports.js'

const root = join(dirname(fileURLToPath(import.meta.url)), '../../../..')
const app = readFileSync(join(root, 'src/App.jsx'), 'utf8')
const styles = readFileSync(join(root, 'src/styles.css'), 'utf8')
const desktopHudCss = readFileSync(join(root, 'src/components/hud/desktop-hud.css'), 'utf8')

function matchMediaStub(width, height) {
  const landscape = width > height
  return {
    matchMedia(query) {
      const q = String(query)
      const maxW = /max-width:\s*(\d+)px/.exec(q)
      const minW = /min-width:\s*(\d+)px/.exec(q)
      const maxH = /max-height:\s*(\d+)px/.exec(q)
      const wantsLandscape = /orientation:\s*landscape/.test(q)
      let matches = true
      if (maxW && !(width <= Number(maxW[1]))) matches = false
      if (minW && !(width >= Number(minW[1]))) matches = false
      if (maxH && !(height <= Number(maxH[1]))) matches = false
      if (wantsLandscape && !landscape) matches = false
      return { matches }
    },
  }
}

const AFFECTED = [
  [844, 320],
  [844, 390],
  [932, 430],
  [980, 480],
  [1024, 480],
  [1080, 540],
  [1199, 600],
]

const NOTEBOOK = [
  [1366, 768],
  [1600, 900],
]

test('lacuna 450px: landscape <1200 usa chrome mobile mesmo com altura >450', () => {
  assert.doesNotMatch(COMPACT_LANDSCAPE_MEDIA, /max-height/)
  assert.match(COMPACT_LANDSCAPE_MEDIA, /max-width:\s*1199px/)
  assert.match(COMPACT_LANDSCAPE_MEDIA, /orientation:\s*landscape/)
  assert.equal(DESKTOP_HUD_MEDIA, '(min-width: 1200px)')

  for (const [width, height] of AFFECTED) {
    const win = matchMediaStub(width, height)
    assert.equal(getDesktopHudLayoutMatches(win), false, `${width}x${height} desktop`)
    assert.equal(getCompactLandscapeHudMatches(win), true, `${width}x${height} compact`)
    assert.equal(hudChromeModeForViewport(width, height), 'mobile-landscape', `${width}x${height} mode`)
  }

  // Casos da lacuna publicada: mid/high height não podem cair no HUD antigo
  assert.equal(hudChromeModeForViewport(1024, 480), 'mobile-landscape')
  assert.equal(hudChromeModeForViewport(1080, 540), 'mobile-landscape')
  assert.equal(hudLayerForViewport(1024, 480), 'landscape-mid')
  assert.equal(hudLayerForViewport(1080, 540), 'landscape-mid')
})

test('notebook >=1200 permanece desktop', () => {
  for (const [width, height] of NOTEBOOK) {
    const win = matchMediaStub(width, height)
    assert.equal(getDesktopHudLayoutMatches(win), true, `${width}x${height}`)
    assert.equal(getCompactLandscapeHudMatches(win), false, `${width}x${height}`)
    assert.equal(hudChromeModeForViewport(width, height), 'desktop', `${width}x${height}`)
  }
})

test('App marca data-hud-mode e não monta painel antigo no mobile landscape', () => {
  assert.match(app, /data-hud-mode=\{hudChromeMode\}/)
  assert.match(app, /hudChromeMode/)
  assert.match(app, /compactLandscapeHud \? null :/)
  const side = app.slice(app.indexOf('<aside className="side">'), app.indexOf('{moreSheetOpen &&'))
  assert.match(side, /compactActionRow/)
  assert.match(side, /HudCompactPeek/)
  assert.match(side, /!compactLandscapeHud/)
  assert.match(side, /sideQuickActions/)
  assert.match(side, /\{!compactLandscapeHud && \(/)
})


test('CSS do chrome mobile landscape não exige max-height 450', () => {
  const short = styles.slice(styles.indexOf('/* Landscape abaixo do HUD desktop'))
  // Regra de ocultar HUD antigo deve viver no bloco landscape geral (sem AND max-height:450)
  assert.match(
    short,
    /@media \(max-width:\s*1199px\) and \(orientation:\s*landscape\) \{[\s\S]*?hud--inline[\s\S]*?display:\s*none/,
  )
  assert.match(short, /compactActionRow/)
  assert.match(desktopHudCss, /:has\(\.compactActionRow\)[\s\S]*?hud--inline/)
  // Altura 450 continua podendo apertar tipografia, mas não é a porta do chrome
  assert.doesNotMatch(
    COMPACT_LANDSCAPE_MEDIA,
    /max-height:\s*450px/,
  )
})
