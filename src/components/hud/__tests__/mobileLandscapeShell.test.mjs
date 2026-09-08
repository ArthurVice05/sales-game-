/**
 * Shell mobile landscape — board contain uniforme + HUD compacto.
 * Não altera geometria interna do tabuleiro.
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { BOARD_ASPECT, boardFitsSlot, fitBoardInSlot } from '../fitBoardInSlot.js'
import { formatCompactCash, compactHostLabel } from '../mobileHudPresentation.js'
import { COMPACT_LANDSCAPE_MEDIA } from '../useCompactLandscapeHud.js'
import { DESKTOP_HUD_MEDIA } from '../useDesktopHudLayout.js'
import {
  estimateBoardSlot,
  hudLayerForViewport,
  stressLandscapeViewports,
} from '../mobileLandscapeViewports.js'

const root = join(dirname(fileURLToPath(import.meta.url)), '../../../..')
const styles = readFileSync(join(root, 'src/styles.css'), 'utf8')
const app = readFileSync(join(root, 'src/App.jsx'), 'utf8')
const controls = readFileSync(join(root, 'src/components/Controls.jsx'), 'utf8')
const boardCss = readFileSync(join(root, 'src/components/board/landscape-board.css'), 'utf8')
const desktopHud = readFileSync(join(root, 'src/components/hud/desktop-hud.css'), 'utf8')

function boardFirstBlock() {
  const marker = styles.lastIndexOf('/* ====== Mobile landscape (touch): tabuleiro em prioridade')
  const ios = styles.indexOf('/* ====== iOS / WebKit ONLY', marker)
  return styles.slice(marker, ios > marker ? ios : marker + 14000)
}

test('fitBoardInSlot usa escala uniforme 13/9', () => {
  assert.equal(BOARD_ASPECT, 13 / 9)
  const tall = fitBoardInSlot(1000, 900)
  assert.equal(tall.width, 1000)
  assert.ok(Math.abs(tall.height - 1000 * 9 / 13) < 0.01)
  const wide = fitBoardInSlot(2000, 390)
  assert.equal(wide.height, 390)
  assert.ok(Math.abs(wide.width - 390 * 13 / 9) < 0.01)
  assert.deepEqual(fitBoardInSlot(0, 400), { width: 0, height: 0 })
})

test('compactação de caixa/host é só visual', () => {
  assert.match(formatCompactCash(18000).replace(/\u00a0/g, ' '), /R\$ 18k/)
  assert.equal(formatCompactCash(null), '—')
  assert.equal(compactHostLabel(true).short, 'H')
  assert.equal(compactHostLabel(true).full, 'Você é o Host')
  assert.match(app, /formatCompactCash\(myCash\)/)
  assert.match(app, /hostLabelShort/)
  assert.match(app, /moneyCompact/)
})

test('shell landscape trava viewport em dvh + safe-area e preenche o board no wrapper', () => {
  const block = boardFirstBlock()
  assert.match(block, /height:\s*100dvh/)
  assert.match(block, /padding-left:\s*env\(safe-area-inset-left/)
  assert.match(block, /width:\s*100%\s*!important/)
  assert.match(block, /height:\s*100%\s*!important/)
  assert.match(block, /aspect-ratio:\s*auto/)
  assert.doesNotMatch(block, /min\(100cqw,\s*calc\(100cqh\s*\*\s*13\s*\/\s*9\)\)/)
  assert.doesNotMatch(block, /100vw/)
  assert.doesNotMatch(block, /transform:\s*scale\(/)
  assert.doesNotMatch(COMPACT_LANDSCAPE_MEDIA, /max-height/)
  assert.match(COMPACT_LANDSCAPE_MEDIA, /max-width:\s*1199px/)
  assert.equal(DESKTOP_HUD_MEDIA, '(min-width: 1200px)')
})

test('iOS landscape preenche o wrapper; não usa contain 13/9', () => {
  const ios = styles.slice(styles.indexOf('/* ====== iOS / WebKit ONLY'))
  assert.match(ios, /html\.sg-ios \.page/)
  assert.match(ios, /--sg-vv-height/)
  assert.match(ios, /width:\s*100%\s*!important/)
  assert.match(ios, /height:\s*100%\s*!important/)
  assert.match(ios, /aspect-ratio:\s*auto/)
  assert.doesNotMatch(ios, /min\(100cqw,\s*calc\(100cqh\s*\*\s*13\s*\/\s*9\)\)/)
  assert.doesNotMatch(ios, /100vw/)
})

test('Roll compacto e Mais/Resumo não duplicam callbacks', () => {
  assert.match(controls, /Rolar Dado/)
  assert.match(controls, /rollLabelShort/)
  assert.match(controls, /Rolar dado/)
  assert.match(controls, /onAction\?\.\(\{ type: 'ROLL'/)
  assert.match(app, /moreSheetOpen/)
  assert.match(app, /useCompactLandscapeHud\(/)
  assert.ok((app.match(/onAction=\{onControlsAction\}/g) || []).length >= 2)
  assert.match(app, /compactLandscapeHud \?/)
  assert.doesNotMatch(app, /desktopOnRoll|mobileOnRoll/)
  assert.match(app, /hudOpenLabel--short/)
})

test('HUD desktop não monta abaixo de 1200; board CSS interno intacto', () => {
  assert.match(app, /useDesktopHudLayout\(/)
  assert.match(desktopHud, /min-width: 1200px/)
  assert.match(boardCss, /--sg40-well-molding/)
  assert.doesNotMatch(app, /landscape-board\.css/)
})

test('matriz landscape preserva 13/9 uniforme e compacta HUD antes do board', () => {
  const matrix = stressLandscapeViewports()
  assert.ok(matrix.length > 40)
  for (const { width, height, layer } of matrix) {
    const slot = estimateBoardSlot(width, height)
    const board = fitBoardInSlot(slot.availableWidth, slot.availableHeight)
    assert.equal(slot.layer, layer)
    assert.ok(board.width <= slot.availableWidth + 0.01, `${width}x${height}`)
    assert.ok(board.height <= slot.availableHeight + 0.01, `${width}x${height}`)
    if (board.height > 0) {
      assert.ok(Math.abs(board.width / board.height - BOARD_ASPECT) < 0.001, `${width}x${height}`)
    }
    const slotRect = {
      left: 0,
      top: 0,
      right: slot.availableWidth,
      bottom: slot.availableHeight,
    }
    const boardRect = {
      left: 0,
      top: 0,
      right: board.width,
      bottom: board.height,
    }
    assert.equal(boardFitsSlot(boardRect, slotRect), true, `${width}x${height}`)
    if (width < 1200 && height <= 450) assert.equal(layer, 'landscape-low')
    if (width >= 1200) assert.equal(layer, 'desktop')
  }
  assert.equal(hudLayerForViewport(932, 430), 'landscape-low')
  assert.equal(hudLayerForViewport(1024, 480), 'landscape-mid')
  assert.equal(hudLayerForViewport(1024, 600), 'landscape-high')
  assert.equal(hudLayerForViewport(1366, 768), 'desktop')
})

test('tablet e landscape curto preenchem o board no wrapper', () => {
  const tablet = styles.slice(
    styles.indexOf('/* TABLET paisagem baixa'),
    styles.indexOf('/* DESKTOP >= 1200px'),
  )
  assert.match(tablet, /width:\s*100%\s*!important/)
  assert.match(tablet, /height:\s*100%\s*!important/)
  assert.match(tablet, /aspect-ratio:\s*auto/)
  assert.doesNotMatch(tablet, /min\(100cqw,\s*calc\(100cqh\s*\*\s*13\s*\/\s*9\)\)/)
  assert.match(tablet, /container-type:\s*size/)

  const short = styles.slice(styles.indexOf('/* Landscape abaixo do HUD desktop'))
  assert.match(
    short,
    /@media \(max-width:\s*1199px\) and \(orientation:\s*landscape\) \{/,
  )
  assert.match(short, /width:\s*100%\s*!important/)
  assert.match(short, /height:\s*100%\s*!important/)
  assert.match(short, /aspect-ratio:\s*auto/)
  assert.doesNotMatch(short, /min\(100cqw,\s*calc\(100cqh\s*\*\s*13\s*\/\s*9\)\)/)
  assert.match(short, /container-type:\s*size/)
  assert.match(short, /moreSheetBackdrop\.is-open/)
  assert.match(short, /position:\s*fixed/)
  assert.match(short, /min\(56vw,\s*360px\)/)
  assert.match(short, /data-hud-mode="mobile-landscape"/)
  assert.match(short, /hud--inline[\s\S]*?display:\s*none/)
})

test('shell não usa CSS por marca/modelo; Mais/Resumo são overlay', () => {
  assert.doesNotMatch(styles, /iPhone\s*1[4-6]|Galaxy S\d+|Pixel\s*\d+/)
  assert.match(app, /moreSheetOpen &&/)
  assert.match(app, /setHudSheetOpen\(true\)/)
  assert.match(app, /compactLandscapeHud \?/)
  assert.doesNotMatch(app, /iPhone 14|Galaxy S23|Pixel 8/)
})

test('Resumo compacto fica abaixo dos controles e usa o espaço da coluna', () => {
  const peekSrc = readFileSync(join(root, 'src/components/hud/HudCompactPeek.jsx'), 'utf8')
  assert.match(peekSrc, /formatHudCash/)
  assert.match(peekSrc, /buildHudGauges/)
  assert.match(peekSrc, /DiceResult/)
  assert.match(peekSrc, /HudMetricCard/)
  assert.match(app, /HudCompactPeek/)
  assert.match(app, /idPrefix=["']hud-sheet["']/)
  assert.match(app, /<HudCompactPeek/)
  const primary = app.slice(app.indexOf('section="primary"'))
  const peekAt = primary.indexOf('HudCompactPeek')
  assert.ok(peekAt > 0, 'peek compacto deve vir depois do botão de rolar')
  assert.match(desktopHud, /\.hudSheet[\s\S]{0,400}\.hudDesktop/)
  assert.doesNotMatch(desktopHud, /max-height:\s*360px[\s\S]{0,80}hudCompactPeek|hudCompactPeek[\s\S]{0,80}display:\s*none\s*!important/)
  assert.match(desktopHud, /:has\(\.compactActionRow\) \.hudCompactPeek/)
  assert.match(desktopHud, /:has\(\.compactActionRow\) \.side > \.hud\.hud--inline/)
  assert.match(desktopHud, /hudSheetBackdrop[\s\S]{0,220}position:\s*fixed/)
  const short = styles.slice(styles.indexOf('/* Landscape abaixo do HUD desktop'))
  assert.match(short, /hud--inline[\s\S]*?display:\s*none/)
  assert.doesNotMatch(COMPACT_LANDSCAPE_MEDIA, /max-height:\s*450px/)
})
