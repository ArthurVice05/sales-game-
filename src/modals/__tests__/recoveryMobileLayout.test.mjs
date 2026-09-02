/**
 * Contrato de layout mobile da Recuperação (Reduzir MIX/ERP).
 * Não reimplementa regras de crédito — só estrutura, CSS e bloqueios existentes.
 */
import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import S from '../recoveryStyles.js'

const here = dirname(fileURLToPath(import.meta.url))
const css = readFileSync(join(here, '..', 'recoveryReduce.css'), 'utf8')
const reduceSrc = readFileSync(join(here, '..', 'RecoveryReduce.jsx'), 'utf8')
const modalSrc = readFileSync(join(here, '..', 'RecoveryModal.jsx'), 'utf8')

function ruleBlock(source, selector) {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const match = source.match(new RegExp(`${escaped}\\s*\\{[^}]+\\}`))
  return match ? match[0] : ''
}

describe('Recuperação — um único scroller vertical', () => {
  it('card externo não é um segundo scroller vertical', () => {
    assert.equal(S.card.overflow, 'hidden')
    assert.equal(S.card.display, 'flex')
    assert.equal(S.card.flexDirection, 'column')
    assert.equal(S.card.minHeight, 0)
    assert.match(String(S.card.maxHeight), /dvh/)
    assert.doesNotMatch(String(S.card.maxHeight), /^90vh$/)
    assert.equal(S.header.flex, '0 0 auto')
    assert.match(String(S.backdrop.padding), /safe-area-inset-top/)
    assert.match(String(S.backdrop.padding), /safe-area-inset-right/)
    assert.match(String(S.backdrop.padding), /safe-area-inset-bottom/)
    assert.match(String(S.backdrop.padding), /safe-area-inset-left/)
    assert.match(modalSrc, /recovery-card--reduce/)
  })

  it('.rr-scroll é o único scroller e tem suporte a toque', () => {
    const scroll = ruleBlock(css, '.rr-scroll')
    assert.match(scroll, /overflow-y:\s*auto/)
    assert.match(scroll, /overflow-x:\s*hidden/)
    assert.match(scroll, /-webkit-overflow-scrolling:\s*touch/)
    assert.match(scroll, /touch-action:\s*pan-y/)
    assert.match(scroll, /overscroll-behavior-y:\s*contain/)
    assert.match(scroll, /flex:\s*1\s+1\s+auto/)
    assert.match(scroll, /min-height:\s*0/)

    const rootMatch = css.match(/(?:^|\n)\.rr-root\s*\{[^}]+\}/)
    assert.ok(rootMatch, '.rr-root deve existir')
    assert.match(rootMatch[0], /min-height:\s*0/)
    assert.doesNotMatch(rootMatch[0], /max-height:\s*calc\(90vh/)
    assert.doesNotMatch(css, /\.rr-root\s*\{[^}]*max-height:\s*calc\(90vh/)

    const cardOverflow = (css.match(/overflow-y:\s*auto/g) || []).length
    assert.ok(cardOverflow >= 1, '.rr-scroll deve ter overflow-y: auto')
    const nonScrollOverflow = css
      .replace(/\.rr-scroll\s*\{[^}]+\}/g, '')
      .match(/overflow-y:\s*auto/g)
    assert.equal(nonScrollOverflow, null, 'somente .rr-scroll deve ter overflow-y: auto neste CSS')
  })

  it('header e footer não encolhem; footer fica fora de .rr-scroll', () => {
    assert.equal(S.header.flex, '0 0 auto')
    const footer = ruleBlock(css, '.rr-footer')
    assert.match(footer, /flex:\s*0\s+0\s+auto/)

    const scrollIdx = reduceSrc.indexOf('className="rr-scroll"')
    const footerIdx = reduceSrc.indexOf('className="rr-footer"')
    assert.ok(scrollIdx >= 0 && footerIdx > scrollIdx)
    const between = reduceSrc.slice(scrollIdx, footerIdx)
    assert.doesNotMatch(between, /rr-footer/)
    assert.match(modalSrc, /className="recovery-header"/)
  })

  it('existe compactação landscape de baixa altura', () => {
    const query = '@media (orientation: landscape) and (max-height: 560px)'
    const idx = css.indexOf(query)
    assert.ok(idx >= 0, 'media query landscape baixo deve existir')
    const next = css.indexOf('@media', idx + query.length)
    const compact = css.slice(idx, next > idx ? next : css.length)

    const cardReduce = compact.match(/\.recovery-card--reduce\s*\{[^}]+\}/)
    assert.ok(cardReduce)
    assert.match(cardReduce[0], /height:\s*100%/)
    assert.match(cardReduce[0], /max-height:\s*100%\s*!important/)

    assert.match(compact, /\.recovery-card--reduce \.recovery-header\s*\{/)
    const headerTitle = compact.match(/\.recovery-card--reduce \.recovery-header > div:first-child\s*\{[^}]+\}/)
    assert.ok(headerTitle)
    assert.match(headerTitle[0], /font-size:\s*17px\s*!important/)

    const closeBtn = compact.match(/\.recovery-card--reduce \.recovery-header button\s*\{[^}]+\}/)
    assert.ok(closeBtn)
    assert.match(closeBtn[0], /width:\s*32px/)
    assert.match(closeBtn[0], /height:\s*32px/)

    const title = compact.match(/\.rr-title\s*\{[^}]+\}/)
    assert.ok(title)
    const titleSize = Number(/font-size:\s*(\d+)px/.exec(title[0])?.[1])
    assert.ok(titleSize >= 14 && titleSize <= 16)

    const lead = compact.match(/\.rr-lead\s*\{[^}]+\}/)
    assert.ok(lead)
    const leadSize = Number(/font-size:\s*(\d+)px/.exec(lead[0])?.[1])
    assert.ok(leadSize >= 11 && leadSize <= 12)
    assert.match(lead[0], /line-height:\s*1\.2[0-9]?/)

    const footer = compact.match(/\.rr-footer\s*\{[^}]+\}/)
    assert.ok(footer)
    assert.match(footer[0], /display:\s*grid/)
    assert.match(footer[0], /grid-template-columns:\s*minmax\(0,\s*1fr\)\s+auto/)
    assert.match(footer[0], /align-items:\s*center/)

    const actions = compact.match(/\.rr-actions\s*\{[^}]+\}/)
    assert.ok(actions)
    assert.match(actions[0], /flex-wrap:\s*nowrap/)

    const btns = compact.match(/\.rr-btn-back,\s*\n\s*\.rr-btn-reduce\s*\{[^}]+\}/)
    assert.ok(btns)
    assert.match(btns[0], /min-height:\s*40px/)
    const btnFont = Number(/font-size:\s*(\d+)px/.exec(btns[0])?.[1])
    assert.ok(btnFont >= 12)

    const cards = compact.match(/\.rr-card\s*\{[^}]+\}/)
    assert.ok(cards)
    const cardMin = Number(/min-height:\s*(\d+)px/.exec(cards[0])?.[1])
    assert.ok(cardMin >= 72 && cardMin <= 80)

    const groupTitle = compact.match(/\.rr-group-title\s*\{[^}]+\}/)
    assert.ok(groupTitle)
    const groupTitleSize = Number(/font-size:\s*(\d+)px/.exec(groupTitle[0])?.[1])
    assert.ok(groupTitleSize >= 12)

    const badge = compact.match(/\.rr-badge\s*\{[^}]+\}/)
    assert.ok(badge)
    const badgeSize = Number(/font-size:\s*(\d+)px/.exec(badge[0])?.[1])
    assert.ok(badgeSize >= 9)

    const cardTitle = compact.match(/\.rr-card-title\s*\{[^}]+\}/)
    assert.ok(cardTitle)
    const cardTitleSize = Number(/font-size:\s*(\d+)px/.exec(cardTitle[0])?.[1])
    assert.ok(cardTitleSize >= 12)

    const creditLabel = compact.match(/\.rr-card-credit-label\s*\{[^}]+\}/)
    assert.ok(creditLabel)
    const creditLabelSize = Number(/font-size:\s*(\d+)px/.exec(creditLabel[0])?.[1])
    assert.ok(creditLabelSize >= 10)

    const creditValue = compact.match(/\.rr-card-credit-value\s*\{[^}]+\}/)
    assert.ok(creditValue)
    const creditValueSize = Number(/font-size:\s*(\d+)px/.exec(creditValue[0])?.[1])
    assert.ok(creditValueSize >= 12)

    const scroll = compact.match(/\.rr-scroll\s*\{[^}]+\}/)
    assert.ok(scroll)
    assert.match(scroll[0], /overflow-y:\s*auto/)
    assert.match(scroll[0], /overflow-x:\s*hidden/)
    assert.match(scroll[0], /min-height:\s*0/)
    assert.match(scroll[0], /flex:\s*1\s+1\s+auto/)
    assert.match(scroll[0], /-webkit-overflow-scrolling:\s*touch/)
    assert.match(scroll[0], /touch-action:\s*pan-y/)

    assert.doesNotMatch(compact, /transform:\s*scale/)
    assert.doesNotMatch(compact, /(?:^|\n)\s*\.recovery-header\s*\{/)
  })
})

describe('Recuperação — regras de redução intactas', () => {
  it('botão permanece desabilitado sem seleção', () => {
    assert.match(reduceSrc, /disabled=\{\!selected\.length \|\| confirming\}/)
    assert.match(reduceSrc, /if \(!selected\.length \|\| confirming\) return/)
  })

  it('nível D, zerado e já reduzido continuam bloqueados no toggle e no card', () => {
    assert.match(reduceSrc, /if \(card\.level === 'D'\) return/)
    assert.match(reduceSrc, /if \(!card\.owned \|\| card\.owned === false\) return/)
    assert.match(reduceSrc, /if \(card\.alreadyReduced\) return/)
    assert.match(reduceSrc, /const isLevelD = card\.level === 'D'/)
    assert.match(
      reduceSrc,
      /const disabled = isLevelD \|\| \!isOwned \|\| soldKeys\.has\(card\.key\) \|\| card\.alreadyReduced \|\| confirming/,
    )
  })

  it('seleção válida continua gerando total e payload a partir dos créditos recebidos', () => {
    assert.match(reduceSrc, /selected\.reduce\(\(acc, c\) => acc \+ Number\(c\.credit \|\| 0\), 0\)/)
    assert.match(
      reduceSrc,
      /const payload = \{ items: selected\.map\(c => \(\{ \.\.\.c, selected: true \}\)\), total \}/,
    )
    assert.match(reduceSrc, /onConfirm\?\.\(payload\)/)
    assert.doesNotMatch(reduceSrc, /recoveryCreditRatio/)
    assert.doesNotMatch(reduceSrc, /MIX_PURCHASE_PRICES/)
  })
})
