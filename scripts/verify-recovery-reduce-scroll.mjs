/**
 * Layout da tela Reduzir MIX/ERP: um scroller em viewport baixa, rodapé no fluxo.
 * Chromium emulado — não substitui Safari/WebKit físico.
 * Uso: SG_APP_URL=http://localhost:5173/ node scripts/verify-recovery-reduce-scroll.mjs
 */
import { mkdir, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import {
  launchChromeBrowser,
  pause,
  waitForSelector,
  setViewport,
  click,
  setInputValue,
} from './cdp-min.mjs'

const OUT = resolve('artifacts/recovery-reduce-scroll')
const APP = process.env.SG_APP_URL || 'http://localhost:5173/'
const MOBILE = [[667, 375], [844, 320], [844, 390], [1024, 480]]
const DESKTOP = [[1366, 650], [1600, 900]]

const PATCH_REDUCIBLE = `(() => {
  const rootEl = document.getElementById('root')
  const fiberKey = Object.keys(rootEl || {}).find((k) => k.startsWith('__reactFiber') || k.startsWith('__reactContainer'))
  const start = rootEl?.[fiberKey]?.stateNode?.current || rootEl?.[fiberKey]?.current || rootEl?.[fiberKey]
  if (!start) throw new Error('fiber root ausente')
  const walk = (fiber, visit) => { if (!fiber) return; visit(fiber); walk(fiber.child, visit); walk(fiber.sibling, visit) }
  let dispatch = null
  let snapshot = null
  walk(start, (fiber) => {
    if (dispatch) return
    let hook = fiber.memoizedState
    while (hook) {
      const val = hook.memoizedState
      const q = hook.queue
      if (Array.isArray(val) && val[0] && typeof val[0] === 'object' && Number.isFinite(Number(val[0].cash)) && 'mixProdutos' in val[0] && typeof q?.dispatch === 'function') {
        dispatch = q.dispatch
        snapshot = val
        return
      }
      hook = hook.next
    }
  })
  if (!dispatch) throw new Error('setPlayers não encontrado')
  dispatch((ps) => (ps || snapshot).map((p, i) => i !== 0 ? p : ({
    ...p,
    mixProdutos: 'B',
    mixOwned: { A: false, B: true, C: true, D: true },
    mix: { A: false, B: true, C: true, D: true },
    erp: 'C',
    erpOwned: { A: false, B: false, C: true, D: true },
  })))
  return { ok: true, mix: 'B', erp: 'C' }
})()`

const LAYOUT = `(() => {
  const box = (el) => {
    if (!el) return null
    const r = el.getBoundingClientRect()
    return { h: +r.height.toFixed(1), w: +r.width.toFixed(1), top: +r.top.toFixed(1), bottom: +r.bottom.toFixed(1) }
  }
  const header = document.querySelector('.recovery-header')
  const title = document.querySelector('.rr-title')
  const lead = document.querySelector('.rr-lead')
  const root = document.querySelector('.rr-root')
  const inner = document.querySelector('.rr-scroll')
  const footer = document.querySelector('.rr-footer')
  const reduceBtn = document.querySelector('.rr-btn-reduce')
  const cards = [...document.querySelectorAll('.rr-card')]
  const scrollers = [...document.querySelectorAll('.recovery-card, .recovery-card *')].filter((el) => {
    const oy = getComputedStyle(el).overflowY
    return (oy === 'auto' || oy === 'scroll') && el.scrollHeight > el.clientHeight + 1
  }).map((el) => ((el.className || '').toString().split(/\\s+/)[0] || el.tagName))
  const inView = (el) => {
    if (!el) return false
    const r = el.getBoundingClientRect()
    return r.bottom > 0 && r.top < innerHeight && r.right > 0 && r.left < innerWidth
  }
  const hit = (el) => {
    if (!el || !inView(el)) return { inView: false, hitIsSelf: false }
    const r = el.getBoundingClientRect()
    const x = r.left + Math.min(16, r.width / 2)
    const y = r.top + Math.min(16, r.height / 2)
    const topEl = document.elementFromPoint(x, y)
    return { inView: true, hitIsSelf: !!(topEl && (topEl === el || el.contains(topEl))), hit: topEl ? topEl.className.toString().slice(0, 40) : null }
  }
  const cs = (el) => el ? getComputedStyle(el) : null
  return {
    vp: [innerWidth, innerHeight],
    vv: window.visualViewport ? [+visualViewport.width.toFixed(1), +visualViewport.height.toFixed(1)] : null,
    header: box(header),
    title: box(title),
    lead: box(lead),
    root: root ? {
      box: box(root),
      client: root.clientHeight,
      scroll: root.scrollHeight,
      overflowY: cs(root).overflowY,
      canScroll: root.scrollHeight > root.clientHeight + 2,
      touch: cs(root).touchAction,
    } : null,
    inner: inner ? {
      box: box(inner),
      client: inner.clientHeight,
      scroll: inner.scrollHeight,
      overflowY: cs(inner).overflowY,
      canScroll: inner.scrollHeight > inner.clientHeight + 2,
    } : null,
    footer: footer ? { box: box(footer), inView: inView(footer), overflowY: cs(footer).overflowY } : null,
    optionStrip: inner ? inner.clientHeight : null,
    cards: cards.length,
    cardsInView: cards.filter(inView).length,
    firstCard: box(cards[0]),
    lastCard: box(cards[cards.length - 1]),
    lastCardInView: inView(cards[cards.length - 1]),
    reduceHit: hit(reduceBtn),
    scrollers,
    singleScroller: scrollers.length <= 1,
    selected: [...document.querySelectorAll('.rr-card.is-selected')].map((c) => (c.textContent || '').slice(0, 24)),
    total: (document.querySelector('.rr-summary')?.innerText || '').slice(0, 80),
  }
})()`

async function shot(session, name) {
  const { data } = await session.call('Page.captureScreenshot', { format: 'png' })
  const path = resolve(OUT, `${name}.png`)
  await writeFile(path, Buffer.from(data, 'base64'))
  return path
}

async function skipTour(session) {
  for (let i = 0; i < 10; i += 1) {
    await session.evaluate(`([...document.querySelectorAll('button')].find((b)=>/Pular tutorial|Fechar|Entendi/i.test(b.textContent||''))||document.querySelector('.tutorialBtnGhost, .tutorialCloseX')||{click(){}}).click()`)
    await pause(80)
  }
}

async function startLocal(page) {
  await page.call('Page.navigate', { url: APP })
  await pause(1500)
  await waitForSelector(page, '.startBtn--local, #playerName', 40_000)
  await skipTour(page)
  await page.evaluate(`document.querySelector('.startBtn--local')?.click()`)
  await waitForSelector(page, '#localPlayerName-0', 20_000)
  await setInputValue(page, '#localPlayerName-0', 'Ana')
  await setInputValue(page, '#localPlayerName-1', 'Bruno')
  await page.evaluate(`(() => {
    const sel = document.querySelector('#localTurnTime')
    if (!sel) return
    const opts = [...sel.options].map((o) => Number(o.value)).filter(Number.isFinite)
    if (opts.length) {
      sel.value = String(Math.max(...opts))
      sel.dispatchEvent(new Event('change', { bubbles: true }))
    }
  })()`)
  await click(page, '.localSetupStart')
  await waitForSelector(page, '.sg40GameBoard', 60_000)
  await pause(500)
  if (await page.evaluate(`!!document.querySelector('.localHandoffButton:not(:disabled)')`)) {
    await page.evaluate(`document.querySelector('.localHandoffButton:not(:disabled)')?.click()`)
    await pause(400)
  }
  await skipTour(page)
}

async function openReduce(page) {
  await page.evaluate(`document.querySelector('.moreOpenBtn')?.click()`)
  await pause(200)
  const opened = await page.evaluate(`(() => {
    const btn = [...document.querySelectorAll('button')].find((b) => /RECUPERA/i.test(b.textContent || ''))
    btn?.click()
    return !!btn
  })()`)
  if (!opened) throw new Error('Botão Recuperação não encontrado')
  await waitForSelector(page, '.recovery-card', 10_000)
  await pause(150)
  await page.evaluate(`([...document.querySelectorAll('.recovery-card button')].find((b) => /REDUZIR/i.test(b.textContent || ''))||{click(){}}).click()`)
  await waitForSelector(page, '.rr-root', 10_000)
  await pause(200)
}

async function captureScroll(page, prefix) {
  const start = await page.evaluate(LAYOUT)
  const captures = [await shot(page, `${prefix}-start`)]
  const scrollerSel = start.root?.canScroll ? '.rr-root' : (start.inner?.canScroll ? '.rr-scroll' : null)
  if (scrollerSel) {
    await page.evaluate(`(() => {
      const el = document.querySelector(${JSON.stringify(scrollerSel)})
      if (!el) return
      el.scrollTop = Math.min(el.scrollHeight * 0.45, 220)
    })()`)
    await pause(120)
    captures.push(await shot(page, `${prefix}-options`))
    await page.evaluate(`(() => {
      const el = document.querySelector(${JSON.stringify(scrollerSel)})
      if (el) el.scrollTop = el.scrollHeight
    })()`)
    await pause(120)
  }
  const end = await page.evaluate(LAYOUT)
  captures.push(await shot(page, `${prefix}-end`))
  return { start, end, captures, scrollerSel }
}

async function main() {
  const report = {
    at: new Date().toISOString(),
    app: APP,
    ok: false,
    limitations: ['Chromium emulado; sem Safari/WebKit físico'],
    views: {},
  }
  await mkdir(OUT, { recursive: true })
  let chrome
  try {
    chrome = await launchChromeBrowser({
      cdpPort: Number(process.env.SG_VERIFY_CDP_PORT || 9563),
      headed: false,
      profileDir: resolve(OUT, 'chrome-profile'),
    })
    const ctx = await chrome.connection.createBrowserContext()
    const page = await chrome.connection.openPage('about:blank', ctx)

    await setViewport(page, 667, 375)
    await startLocal(page)

    await openReduce(page)
    report.empty = await captureScroll(page, 'empty-667x375')
    await page.evaluate(`([...document.querySelectorAll('.rr-btn-back')].find(Boolean)||{click(){}}).click()`)
    await pause(200)
    await page.evaluate(`document.querySelector('.recovery-header button')?.click()`)
    await pause(250)

    report.patch = await page.evaluate(PATCH_REDUCIBLE)
    await openReduce(page)

    for (const [w, h] of MOBILE) {
      await setViewport(page, w, h)
      await pause(350)
      await page.evaluate(`document.querySelector('.rr-root') && (document.querySelector('.rr-root').scrollTop = 0)`)
      const snap = await captureScroll(page, `${w}x${h}`)
      report.views[`${w}x${h}`] = {
        start: snap.start,
        end: snap.end,
        scrollerSel: snap.scrollerSel,
        captures: snap.captures,
      }
    }

    await setViewport(page, 667, 375)
    await pause(250)
    await page.evaluate(`document.querySelector('.rr-group[aria-label="MIX PRODUTOS"] .rr-card:not([disabled])')?.click()`)
    await pause(150)
    const selectedBeforeConsult = await page.evaluate(LAYOUT)
    await page.evaluate(`document.querySelector('[data-hud-consult-toggle="open"]')?.click()`)
    await pause(300)
    const consultOpen = await page.evaluate(`({
      panel: !!document.querySelector('.hudConsultRegion--mobileDecision'),
      topInert: !!document.querySelector('[data-modal-top="true"][inert]'),
    })`)
    await page.evaluate(`document.querySelector('[data-hud-consult-toggle="close"]')?.click()`)
    await pause(300)
    const afterConsult = await page.evaluate(LAYOUT)
    report.consult = {
      consultOpen,
      selectedBefore: selectedBeforeConsult.selected,
      totalBefore: selectedBeforeConsult.total,
      selectedAfter: afterConsult.selected,
      totalAfter: afterConsult.total,
      topInertAfter: await page.evaluate(`!!document.querySelector('[data-modal-top="true"][inert]')`),
    }

    await page.evaluate(`document.querySelector('.rr-root') && (document.querySelector('.rr-root').scrollTop = document.querySelector('.rr-root').scrollHeight)`)
    await pause(120)
    report.reduceHitAfterScroll = await page.evaluate(LAYOUT)
    const confirmed = await page.evaluate(`(() => {
      const btn = document.querySelector('.rr-btn-reduce')
      if (!btn || btn.disabled) return { clicked: false, disabled: !!btn?.disabled }
      btn.click()
      return { clicked: true }
    })()`)
    await pause(600)
    report.confirm = {
      confirmed,
      recoveryGone: await page.evaluate(`!document.querySelector('.recovery-card')`),
    }

    await openReduce(page)
    for (const [w, h] of DESKTOP) {
      await setViewport(page, w, h)
      await pause(350)
      const snap = await page.evaluate(LAYOUT)
      report.views[`${w}x${h}`] = { start: snap, captures: [await shot(page, `D-${w}x${h}`)] }
    }

    const mobiles = MOBILE.map(([w, h]) => report.views[`${w}x${h}`])
    report.ok = mobiles.every((v) => {
      const s = v?.start
      const e = v?.end
      if (!s) return false
      const innerNotConfined = !s.inner?.canScroll
      const rootScrolls = s.root?.canScroll === true && s.root?.overflowY === 'auto'
      const endActions = e.reduceHit?.inView && e.reduceHit?.hitIsSelf
      return s.singleScroller && innerNotConfined && rootScrolls && endActions && s.cards >= 8
    })
      && report.consult?.consultOpen?.topInert === true
      && report.consult?.topInertAfter === false
      && (report.consult?.selectedBefore || []).length > 0
      && JSON.stringify(report.consult?.selectedBefore) === JSON.stringify(report.consult?.selectedAfter)
      && report.confirm?.recoveryGone === true
      && DESKTOP.every(([w, h]) => report.views[`${w}x${h}`]?.start?.inner?.overflowY === 'auto')

    await writeFile(resolve(OUT, 'report.json'), JSON.stringify(report, null, 2))
    console.log(JSON.stringify({
      ok: report.ok,
      app: APP,
      emptyStrip: report.empty?.start?.optionStrip,
      emptyRoot: report.empty?.start?.root,
      emptyInner: report.empty?.start?.inner,
      consult: report.consult,
      confirm: report.confirm,
      views: Object.fromEntries(Object.entries(report.views).map(([k, v]) => [k, {
        vp: v.start?.vp,
        header: v.start?.header?.h,
        title: v.start?.title?.h,
        lead: v.start?.lead?.h,
        optionStrip: v.start?.optionStrip,
        innerOverflow: v.start?.inner?.overflowY,
        innerCanScroll: v.start?.inner?.canScroll,
        rootClient: v.start?.root?.client,
        rootScroll: v.start?.root?.scroll,
        rootOverflow: v.start?.root?.overflowY,
        footerH: v.start?.footer?.box?.h,
        scrollers: v.start?.scrollers,
        endReduceHit: v.end?.reduceHit,
        cardsInViewStart: v.start?.cardsInView,
        lastCardInViewEnd: v.end?.lastCardInView,
      }])),
    }, null, 2))
    if (!report.ok) process.exitCode = 1
  } finally {
    if (chrome) await chrome.stop()
  }
}

main().catch((error) => {
  console.error(error)
  process.exit(1)
})
