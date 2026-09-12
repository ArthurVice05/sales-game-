import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '../..')
const read = (rel) => readFileSync(join(root, rel), 'utf8')

function mediaBlock(css, query) {
  const idx = css.indexOf(query)
  if (idx < 0) return ''
  const next = css.indexOf('@media', idx + query.length)
  return css.slice(idx, next > idx ? next : css.length)
}

describe('centralização de modais na região útil', () => {
  it('desktop: overlay reserva HUD uma vez e cartão usa % da camada (não 100vw)', () => {
    const css = read('modals/decision-hud-bridge.css')
    const desktop = mediaBlock(css, '@media (min-width: 1200px)')
    assert.match(desktop, /padding-right:\s*clamp\(336px/)
    assert.match(desktop, /justify-content:\s*center/)
    assert.match(desktop, /align-items:\s*center/)
    // Largura do tileModal relativa à camada já reduzida — evita “subtrair HUD duas vezes”.
    assert.match(desktop, /\.tileModal[^{]*\{[^}]*width:\s*min\([^)]*100%/)
    assert.doesNotMatch(desktop, /\.tileModal[^{]*\{[^}]*100vw/)
    const recovery = desktop.match(/\.recovery-backdrop\s*\{[^}]+\}/)
    assert.ok(recovery)
    assert.doesNotMatch(recovery[0], /padding-right:\s*clamp/)
  })

  it('mobile: centraliza na área útil com safe-area e altura limitada', () => {
    const css = read('modals/decision-hud-bridge.css')
    const mobile = mediaBlock(css, '@media (max-width: 1199px)')
    assert.match(mobile, /justify-content:\s*center/)
    assert.match(mobile, /align-items:\s*center/)
    assert.match(mobile, /safe-area-inset/)
    assert.match(mobile, /max-height:\s*calc\(100dvh/)
    assert.match(mobile, /\.tileModal[^{]*\{[^}]*width:\s*100%/)
  })

  it('ModalBase tile não reabre fixed full-viewport sobre o overlay', () => {
    const base = read('modals/ModalBase.jsx')
    assert.match(base, /isTile/)
    assert.match(base, /position:\s*isTile\s*\?\s*['"]relative['"]/)
    assert.doesNotMatch(base, /isTile\s*\?\s*['"]fixed['"]/)
  })
})

describe('rótulos de custo Common / Inside', () => {
  it('Vendedor Comum: custo por vendedor; quantidade preservada', () => {
    const src = read('modals/BuyCommonSellersModal.jsx')
    assert.match(src, /Quantidade de vendedores/)
    assert.match(src, /Custo por vendedor/)
    assert.doesNotMatch(src, /Custo por representante/)
  })

  it('Inside Sales: custo por SDR/BDR/CLOSER; quantidade preservada', () => {
    const src = read('modals/InsideSalesModal.jsx')
    assert.match(src, /Quantidade de SDR/)
    assert.match(src, /Custo por SDR\/BDR\/CLOSER|Custo por SDR\/<wbr/)
    assert.doesNotMatch(src, /Custo por representante/)
  })

  it('Canal representantes não é alterado por substituição global', () => {
    const field = read('modals/BuyFieldSalesModal.jsx')
    assert.match(field, /Custo por representante/)
  })
})
