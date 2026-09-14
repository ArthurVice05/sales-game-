/**
 * Recuperação + HUD: backdrop interno não pode ignorar a reserva lateral do overlay.
 * Aba Empresa no notebook: densidade suficiente para caber sem depender de scroll.
 */
import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import S from '../recoveryStyles.js'

const root = join(dirname(fileURLToPath(import.meta.url)), '../..')
const read = (rel) => readFileSync(join(root, rel), 'utf8')

function mediaBlock(css, query) {
  const idx = css.indexOf(query)
  if (idx < 0) return ''
  const next = css.indexOf('@media', idx + query.length)
  return css.slice(idx, next > idx ? next : css.length)
}

describe('Recovery × HUD — regiões distintas', () => {
  it('backdrop da recuperação não é fixed full-viewport (respeita o overlay)', () => {
    assert.notEqual(S.backdrop.position, 'fixed')
    assert.ok(['relative', 'absolute'].includes(S.backdrop.position))
    assert.doesNotMatch(String(S.backdrop.width || ''), /100vw/)
    assert.match(String(S.card.width), /100%/)
    assert.doesNotMatch(String(S.card.width), /96vw/)
    assert.equal(S.card.minWidth, 0)
    assert.equal(S.card.maxWidth, '100%')
  })

  it('bridge desktop reserva HUD uma vez e limita o cartão ao espaço útil', () => {
    const css = read('modals/decision-hud-bridge.css')
    const desktop = mediaBlock(css, '@media (min-width: 1200px)')
    assert.ok(desktop.length > 80)
    assert.match(desktop, /padding-right:\s*clamp\(336px/)
    assert.match(desktop, /\[data-modal-top="true"\]/)
    assert.match(desktop, /min-width:\s*0/)
    assert.match(desktop, /\.recovery-backdrop/)
    assert.match(desktop, /\.recovery-card/)
    // Não empilhar segunda reserva no backdrop da recuperação
    const recoveryRule = desktop.match(/\.recovery-backdrop\s*\{[^}]+\}/)
    assert.ok(recoveryRule)
    assert.doesNotMatch(recoveryRule[0], /padding-right:\s*clamp/)
    assert.match(recoveryRule[0], /position:\s*relative|inset:\s*auto/)
  })

  it('ações de gameplay continuam bloqueadas; consulta informativa permanece', () => {
    const css = read('modals/decision-hud-bridge.css')
    assert.match(css, /\.hudConsultRegion/)
    assert.match(css, /turnPrimaryActions[\s\S]*pointer-events:\s*none/)
    assert.match(css, /sideQuickActions[\s\S]*pointer-events:\s*none/)
    assert.doesNotMatch(css, /transform:\s*scale\(/)
  })
})

describe('Recuperação — cadeia de altura mobile (scroll por toque)', () => {
  it('backdrop e card encolhem: flex + min-height 0, sem grid que impede o shrink', () => {
    assert.equal(S.backdrop.display, 'flex')
    assert.equal(S.backdrop.flexDirection, 'column')
    assert.equal(S.backdrop.minHeight, 0)
    assert.equal(S.card.minHeight, 0)
    assert.equal(S.body.minHeight, 0)
    assert.equal(S.body.overflowY, 'auto')
    assert.equal(S.body.touchAction, 'pan-y')
  })

  it('mobile limita a camada da recuperação à área útil e deixa um único scroller', () => {
    const css = read('modals/decision-hud-bridge.css')
    const mobile = mediaBlock(css, '@media (max-width: 1199px)')
    assert.ok(mobile.length > 80, 'bloco mobile da ponte deve existir')
    assert.match(mobile, /:has\(\.recovery-backdrop\)/)
    assert.match(mobile, /align-items:\s*stretch/)
    assert.match(mobile, /min-height:\s*0/)
    const recoveryBackdrop = mobile.match(/\.recovery-backdrop\s*\{[^}]+\}/)
    assert.ok(recoveryBackdrop, 'mobile deve limitar .recovery-backdrop')
    assert.match(recoveryBackdrop[0], /min-height:\s*0/)
    assert.match(recoveryBackdrop[0], /max-height:\s*100%/)
    const recoveryCard = mobile.match(/\.recovery-card\s*\{[^}]+\}/)
    assert.ok(recoveryCard, 'mobile deve limitar .recovery-card')
    assert.match(recoveryCard[0], /min-height:\s*0/)
    assert.match(recoveryCard[0], /max-height:\s*100%/)
    assert.doesNotMatch(mobile, /transform:\s*scale/)
  })
})

describe('Aba Empresa — notebook 1366×768', () => {
  it('existe compactação de densidade para viewport notebook sem scale', () => {
    const css = read('components/hud/desktop-hud.css')
    const query = '@media (min-width: 1200px) and (max-height: 900px)'
    const block = mediaBlock(css, query)
    assert.ok(block.length > 40, 'media query notebook Empresa deve existir')
    assert.match(block, /\.hudDesktop/)
    assert.match(block, /\.hudDesktopPanel/)
    assert.match(block, /\.hudCard/)
    assert.match(block, /gap:\s*[3-8]px/)
    assert.doesNotMatch(block, /transform:\s*scale\(/)
    assert.doesNotMatch(block, /display:\s*none/)
    assert.match(css, /\.hudRoster--grid\s*\{[^}]*grid-template-columns:\s*repeat\(2/)
  })

  it('painel Empresa permanece com os três cartões de conteúdo', () => {
    const sidebar = read('components/hud/HudDesktopSidebar.jsx')
    assert.match(sidebar, /Última ação/)
    assert.match(sidebar, /Capacidade/)
    assert.match(sidebar, /Jogadores/)
    assert.match(sidebar, /activeHudTab === 'empresa'/)
  })
})
