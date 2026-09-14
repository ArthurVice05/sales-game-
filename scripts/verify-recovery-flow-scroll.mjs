/**
 * Menu / Demitir / Empréstimo: um scroller (recovery-flow) no mobile baixo.
 * Chromium emulado — não substitui Safari/WebKit físico.
 * Uso: SG_APP_URL=http://localhost:5173/ node scripts/verify-recovery-flow-scroll.mjs
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

const OUT = resolve('artifacts/recovery-flow-scroll')
const APP = process.env.SG_APP_URL || 'http://localhost:5173/'
const MOBILE = [[667, 375], [844, 320], [844, 390], [1024, 480]]
const DESKTOP = [[1366, 650], [1600, 900]]

const LAYOUT = `(() => {
  const box = (el) => {
    if (!el) return null
    const r = el.getBoundingClientRect()
    return { h: +r.height.toFixed(1), top: +r.top.toFixed(1), bottom: +r.bottom.toFixed(1) }
  }
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
    return { inView: true, hitIsSelf: !!(topEl && (topEl === el || el.contains(topEl))) }
  }
  const cs = (el) => el ? getComputedStyle(el) : null
  const header = document.querySelector('.recovery-header')
  const flow = document.querySelector('.recovery-flow')
  const body = document.querySelector('.recovery-body')
  const footer = document.querySelector('.recovery-footer')
  const reduceRoot = document.querySelector('.rr-root')
  const scrollers = [...document.querySelectorAll('.recovery-card, .recovery-card *')].filter((el) => {
    const oy = getComputedStyle(el).overflowY
    return (oy === 'auto' || oy === 'scroll') && el.scrollHeight > el.clientHeight + 1
  }).map((el) => ((el.className || '').toString().split(/\\s+/)[0] || el.tagName))
  const cta = [...document.querySelectorAll('.recovery-footer button, .recovery-row-btns button')].at(-1)
  const input = document.querySelector('.recovery-card input[type="number"]')
  return {
    vp: [innerWidth, innerHeight],
    step: reduceRoot ? 'reduce' : (document.querySelector('.rr-btn-back, .recovery-footer') && document.body.innerText.includes('EMPRÉSTIMO') && input ? 'loan' : (document.body.innerText.includes('DEMITIR FUNCIONÁRIOS') ? 'fire' : 'menu')),
    header: box(header),
    flow: flow ? {
      box: box(flow),
      client: flow.clientHeight,
      scroll: flow.scrollHeight,
      overflowY: cs(flow).overflowY,
      canScroll: flow.scrollHeight > flow.clientHeight + 2,
      touch: cs(flow).touchAction,
    } : null,
    body: body ? {
      box: box(body),
      overflowY: cs(body).overflowY,
      canScroll: body.scrollHeight > body.clientHeight + 2,
    } : null,
    footer: footer ? { box: box(footer), inView: inView(footer) } : null,
    scrollers,
    singleFlow: scrollers.length <= 1 && (scrollers[0] === 'recovery-flow' || scrollers.length === 0),
    ctaHit: hit(cta),
    inputValue: input ? input.value : null,
    qtyText: (() => {
      const plus = [...document.querySelectorAll('.recovery-card button')].find((b) => (b.textContent || '').trim() === '+')
      return plus?.parentElement?.textContent?.replace(/\\s+/g, ' ').trim().slice(0, 40) || null
    })(),
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

async function openRecovery(page) {
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
}

async function clickRecovery(page, re) {
  return page.evaluate(`(() => {
    const re = ${re}
    const btn = [...document.querySelectorAll('.recovery-card button')].find((b) => re.test(b.textContent || ''))
    if (!btn) return false
    btn.click()
    return true
  })()`)
}

async function captureStep(page, prefix) {
  const start = await page.evaluate(LAYOUT)
  const captures = [await shot(page, `${prefix}-start`)]
  if (start.flow?.canScroll) {
    await page.evaluate(`document.querySelector('.recovery-flow').scrollTop = document.querySelector('.recovery-flow').scrollHeight`)
    await pause(120)
  }
  const end = await page.evaluate(LAYOUT)
  captures.push(await shot(page, `${prefix}-end`))
  return { start, end, captures }
}

async function main() {
  const report = { at: new Date().toISOString(), app: APP, ok: false, limitations: ['Chromium emulado; sem Safari/WebKit físico'], views: {} }
  await mkdir(OUT, { recursive: true })
  let chrome
  try {
    chrome = await launchChromeBrowser({
      cdpPort: Number(process.env.SG_VERIFY_CDP_PORT || 9564),
      headed: false,
      profileDir: resolve(OUT, 'chrome-profile'),
    })
    const ctx = await chrome.connection.createBrowserContext()
    const page = await chrome.connection.openPage('about:blank', ctx)
    await setViewport(page, 667, 375)
    await startLocal(page)
    await openRecovery(page)

    for (const [w, h] of MOBILE) {
      await setViewport(page, w, h)
      await pause(300)
      await page.evaluate(`document.querySelector('.recovery-flow') && (document.querySelector('.recovery-flow').scrollTop = 0)`)
      report.views[`menu-${w}x${h}`] = await captureStep(page, `menu-${w}x${h}`)
    }

    await setViewport(page, 667, 375)
    await pause(200)
    await clickRecovery(page, '/^DEMITIR$/i')
    await waitForSelector(page, '.recovery-flow', 8_000)
    await pause(200)
    await page.evaluate(`([...document.querySelectorAll('.recovery-card button')].find((b) => (b.textContent || '').trim() === '+' && !b.disabled)||{click(){}}).click()`)
    await pause(120)
    const fireBefore = await page.evaluate(LAYOUT)
    await page.evaluate(`document.querySelector('[data-hud-consult-toggle="open"]')?.click()`)
    await pause(300)
    const consultOpen = await page.evaluate(`({
      panel: !!document.querySelector('.hudConsultRegion--mobileDecision'),
      topInert: !!document.querySelector('[data-modal-top="true"][inert]'),
    })`)
    await page.evaluate(`document.querySelector('[data-hud-consult-toggle="close"]')?.click()`)
    await pause(300)
    report.fire = {
      ...await captureStep(page, 'fire-667x375'),
      consultOpen,
      qtyBefore: fireBefore.qtyText,
      qtyAfter: (await page.evaluate(LAYOUT)).qtyText,
      topInertAfter: await page.evaluate(`!!document.querySelector('[data-modal-top="true"][inert]')`),
    }

    await clickRecovery(page, '/voltar/i')
    await pause(200)
    await clickRecovery(page, '/EMPRÉSTIMO/i')
    await waitForSelector(page, '.recovery-card input[type="number"]', 8_000)
    await pause(150)
    await page.evaluate(`(() => {
      const input = document.querySelector('.recovery-card input[type="number"]')
      if (!input) return
      const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set
      setter?.call(input, '500')
      input.dispatchEvent(new Event('input', { bubbles: true }))
      input.dispatchEvent(new Event('change', { bubbles: true }))
    })()`)
    await pause(150)
    await page.evaluate(`document.querySelector('.recovery-card input[type="number"]')?.focus()`)
    await pause(150)
    const loanBefore = await page.evaluate(LAYOUT)
    await page.evaluate(`document.querySelector('[data-hud-consult-toggle="open"]')?.click()`)
    await pause(300)
    await page.evaluate(`document.querySelector('[data-hud-consult-toggle="close"]')?.click()`)
    await pause(300)
    report.loan = {
      ...await captureStep(page, 'loan-667x375'),
      valueBefore: loanBefore.inputValue,
      valueAfter: (await page.evaluate(LAYOUT)).inputValue,
      focused: await page.evaluate(`document.activeElement === document.querySelector('.recovery-card input[type="number"]') || document.querySelector('.recovery-flow')?.contains(document.activeElement)`),
    }

    await clickRecovery(page, '/voltar/i')
    await pause(200)
    for (const [w, h] of DESKTOP) {
      await setViewport(page, w, h)
      await pause(300)
      const snap = await page.evaluate(LAYOUT)
      report.views[`D-${w}x${h}`] = { start: snap, captures: [await shot(page, `D-menu-${w}x${h}`)] }
    }

    const mobiles = MOBILE.map(([w, h]) => report.views[`menu-${w}x${h}`])
    report.ok = mobiles.every((v) => v?.start?.flow?.overflowY === 'auto' && v?.start?.body?.overflowY === 'visible' && v?.end?.ctaHit?.hitIsSelf)
      && report.fire?.start?.flow?.overflowY === 'auto'
      && report.fire?.qtyBefore && report.fire.qtyBefore === report.fire.qtyAfter
      && report.fire?.topInertAfter === false
      && report.fire?.end?.ctaHit?.hitIsSelf
      && report.loan?.valueBefore === '500'
      && report.loan?.valueAfter === '500'
      && report.loan?.end?.ctaHit?.hitIsSelf
      && DESKTOP.every(([w, h]) => report.views[`D-${w}x${h}`]?.start?.body?.overflowY === 'auto')

    await writeFile(resolve(OUT, 'report.json'), JSON.stringify(report, null, 2))
    console.log(JSON.stringify({
      ok: report.ok,
      fire: { qty: report.fire?.qtyAfter, consult: report.fire?.consultOpen, inertAfter: report.fire?.topInertAfter, cta: report.fire?.end?.ctaHit },
      loan: { value: report.loan?.valueAfter, cta: report.loan?.end?.ctaHit },
      views: Object.fromEntries(Object.entries(report.views).map(([k, v]) => [k, {
        vp: v.start?.vp,
        flowOy: v.start?.flow?.overflowY,
        bodyOy: v.start?.body?.overflowY,
        flowCanScroll: v.start?.flow?.canScroll,
        bodyCanScroll: v.start?.body?.canScroll,
        scrollers: v.start?.scrollers,
        endCta: v.end?.ctaHit,
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
