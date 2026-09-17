/**
 * Prova de rolagem/toque da Recuperação financeira no overlay real (partida local).
 * Chromium emulado — não substitui Safari/WebKit físico.
 * Uso: node scripts/verify-recovery-mobile-interact.mjs
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

const OUT = resolve('artifacts/recovery-mobile-interact')
const APP = process.env.SG_APP_URL || 'http://localhost:5174/'
const MOBILE = [[667, 375], [844, 320], [844, 390], [1024, 480]]
const DESKTOP = [[1366, 650], [1600, 900]]

const PROBE = `(() => {
  const cs = (el) => el ? getComputedStyle(el) : null
  const box = (el) => {
    if (!el) return null
    const r = el.getBoundingClientRect()
    return { x: +r.x.toFixed(1), y: +r.y.toFixed(1), w: +r.width.toFixed(1), h: +r.height.toFixed(1), top: +r.top.toFixed(1), bottom: +r.bottom.toFixed(1) }
  }
  const chain = (el) => {
    const out = []
    let n = el
    while (n && n !== document.documentElement) {
      const s = getComputedStyle(n)
      out.push({
        tag: n.tagName,
        cls: (n.className || '').toString().slice(0, 80),
        pe: s.pointerEvents,
        overflow: s.overflow + '/' + s.overflowY,
        height: s.height,
        maxHeight: s.maxHeight,
        minHeight: s.minHeight,
        inert: n.hasAttribute('inert'),
      })
      n = n.parentElement
    }
    return out
  }
  const overlay = document.querySelector('.sgModalOverlay')
  const layer = document.querySelector('[data-modal-top="true"]')
  const backdrop = document.querySelector('.recovery-backdrop')
  const card = document.querySelector('.recovery-card')
  const header = document.querySelector('.recovery-header')
  const body = document.querySelector('.recovery-body')
  const rr = document.querySelector('.rr-scroll')
  const footer = document.querySelector('.rr-footer, .recovery-row-btns')
  const flow = document.querySelector('.recovery-flow')
  const scroller = rr || flow || body
  const btns = [...(card?.querySelectorAll('button') || [])]
  const demitir = btns.find((b) => /^DEMITIR$/i.test((b.textContent || '').trim()))
  const reduzir = btns.find((b) => /REDUZIR/i.test(b.textContent || ''))
  const plus = btns.find((b) => (b.textContent || '').trim() === '+')
  const minus = btns.find((b) => (b.textContent || '').trim() === '-')
  const hit = (el) => {
    if (!el) return null
    const r = el.getBoundingClientRect()
    const x = r.left + Math.min(12, r.width / 2)
    const y = r.top + Math.min(12, r.height / 2)
    const topEl = document.elementFromPoint(x, y)
    return {
      x: +x.toFixed(1),
      y: +y.toFixed(1),
      disabled: !!el.disabled,
      inertSelf: el.hasAttribute('inert'),
      inertAncestor: !!el.closest('[inert]'),
      pe: getComputedStyle(el).pointerEvents,
      hit: topEl ? (topEl.tagName + '.' + (topEl.className || '').toString().slice(0, 60)) : null,
      hitIsSelf: topEl === el || el.contains(topEl),
      inView: r.bottom > 0 && r.top < innerHeight && r.right > 0 && r.left < innerWidth,
    }
  }
  const sCs = cs(scroller)
  return {
    vp: [innerWidth, innerHeight],
    depth: document.documentElement.dataset.sgModalDepth || '0',
    stackLayers: document.querySelectorAll('[data-modal-layer]').length,
    topInert: layer ? layer.hasAttribute('inert') : null,
    consultCovered: layer?.dataset.hudConsultCovered || null,
    consultOpen: document.documentElement.dataset.hudConsultOpen || null,
    overlay: overlay ? { box: box(overlay), overflow: cs(overlay).overflow, pe: cs(overlay).pointerEvents, pad: cs(overlay).padding } : null,
    layer: layer ? { box: box(layer), overflow: cs(layer).overflow, display: cs(layer).display, height: cs(layer).height, maxHeight: cs(layer).maxHeight, minHeight: cs(layer).minHeight } : null,
    backdrop: backdrop ? { box: box(backdrop), overflow: cs(backdrop).overflow, display: cs(backdrop).display, height: cs(backdrop).height, maxHeight: cs(backdrop).maxHeight, minHeight: cs(backdrop).minHeight } : null,
    card: card ? { box: box(card), overflow: cs(card).overflow, height: cs(card).height, maxHeight: cs(card).maxHeight, minHeight: cs(card).minHeight, client: card.clientHeight, scroll: card.scrollHeight } : null,
    header: box(header),
    body: body ? { box: box(body), client: body.clientHeight, scroll: body.scrollHeight, overflowY: cs(body).overflowY, minHeight: cs(body).minHeight, touch: cs(body).touchAction, canScroll: body.scrollHeight > body.clientHeight + 2 } : null,
    rr: rr ? { box: box(rr), client: rr.clientHeight, scroll: rr.scrollHeight, overflowY: cs(rr).overflowY, canScroll: rr.scrollHeight > rr.clientHeight + 2 } : null,
    footer: footer ? { box: box(footer), inView: footer.getBoundingClientRect().bottom <= innerHeight + 2 } : null,
    scrollerCanScroll: scroller ? scroller.scrollHeight > scroller.clientHeight + 2 : null,
    scrollerOverflow: sCs?.overflowY || null,
    hits: { demitir: hit(demitir), reduzir: hit(reduzir), plus: hit(plus), minus: hit(minus) },
    chain: scroller ? chain(scroller).slice(0, 8) : null,
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
  const href = await page.evaluate(`location.href + ' | ' + document.body?.innerText?.slice(0, 120)`).catch((e) => String(e))
  console.log('[startLocal]', href)
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
  const handoff = await page.evaluate(`!!document.querySelector('.localHandoffButton:not(:disabled)')`)
  if (handoff) {
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
  await pause(200)
}

async function closeRecovery(page) {
  await page.evaluate(`(() => {
    const x = document.querySelector('.recovery-header button')
    if (x) { x.click(); return }
    const back = [...document.querySelectorAll('.recovery-card button')].find((b) => /voltar/i.test(b.textContent || ''))
    back?.click()
  })()`)
  await pause(250)
  await page.evaluate(`(() => {
    const x = document.querySelector('.recovery-header button')
    x?.click()
  })()`)
  await pause(250)
}

async function clickLabel(page, re) {
  return page.evaluate(`(() => {
    const re = ${re}
    const btn = [...document.querySelectorAll('.recovery-card button')].find((b) => re.test(b.textContent || ''))
    if (!btn) return false
    btn.click()
    return true
  })()`)
}

async function main() {
  const report = { at: new Date().toISOString(), ok: false, limitations: ['Chromium emulado; sem Safari/WebKit físico'], views: {}, flowA: {}, flowB: {}, fire: null }
  await mkdir(OUT, { recursive: true })
  let chrome
  try {
    chrome = await launchChromeBrowser({
      cdpPort: Number(process.env.SG_VERIFY_CDP_PORT || 9561),
      headed: false,
      profileDir: resolve(OUT, 'chrome-profile'),
    })
    const ctx = await chrome.connection.createBrowserContext()
    const page = await chrome.connection.openPage('about:blank', ctx)

    await setViewport(page, 1366, 768)
    await startLocal(page)
    await openRecovery(page)

    for (const [w, h] of MOBILE) {
      await setViewport(page, w, h)
      await pause(400)
      const beforeScroll = await page.evaluate(PROBE)
      await page.evaluate(`(() => {
        const el = document.querySelector('.rr-scroll, .recovery-flow, .recovery-body')
        if (!el) return
        el.scrollTop = el.scrollHeight
      })()`)
      await pause(120)
      const afterScroll = await page.evaluate(`(() => {
        const el = document.querySelector('.rr-scroll, .recovery-flow, .recovery-body')
        return el ? { top: el.scrollTop, max: el.scrollHeight - el.clientHeight } : null
      })()`)
      report.views[`A-${w}x${h}`] = {
        probe: beforeScroll,
        afterScroll,
        ctaInView: beforeScroll.hits?.demitir?.inView || beforeScroll.hits?.reduzir?.inView || afterScroll?.top > 0,
        ctaHit: !!(beforeScroll.hits?.demitir?.hitIsSelf || beforeScroll.hits?.reduzir?.hitIsSelf),
        scrollWorked: !!(afterScroll && (afterScroll.max <= 2 || afterScroll.top > 0)),
        hitOk: !beforeScroll.hits?.demitir || beforeScroll.hits.demitir.hitIsSelf || afterScroll?.top > 0,
      }
      report.captures = report.captures || []
      report.captures.push(await shot(page, `A-menu-${w}x${h}`))
    }

    const enteredFire = await clickLabel(page, '/^DEMITIR$/i')
    await pause(250)
    report.flowA.enteredFire = enteredFire
    await setViewport(page, 667, 375)
    await pause(300)
    const fireProbe = await page.evaluate(PROBE)
    await page.evaluate(`(() => {
      const plus = [...document.querySelectorAll('.recovery-card button')].find((b) => (b.textContent || '').trim() === '+' && !b.disabled)
      plus?.click()
    })()`)
    await pause(150)
    const qtyAfterPlus = await page.evaluate(`(() => {
      const plus = [...document.querySelectorAll('.recovery-card button')].find((b) => (b.textContent || '').trim() === '+')
      const row = plus?.parentElement
      return row?.textContent || null
    })()`)
    report.flowA.fireProbe = fireProbe
    report.flowA.qtyAfterPlus = qtyAfterPlus
    report.captures.push(await shot(page, 'A-fire-667x375'))

    await page.evaluate(`document.querySelector('[data-hud-consult-toggle="open"]')?.click()`)
    await pause(300)
    const consultOpen = await page.evaluate(`({
      panel: !!document.querySelector('.hudConsultRegion--mobileDecision'),
      topInert: !!document.querySelector('[data-modal-top="true"][inert]'),
      covered: document.querySelector('[data-modal-top="true"]')?.dataset.hudConsultCovered || null,
    })`)
    await page.evaluate(`document.querySelector('[data-hud-consult-toggle="close"]')?.click()`)
    await pause(300)
    const consultClosed = await page.evaluate(`({
      panel: !!document.querySelector('.hudConsultRegion--mobileDecision'),
      topInert: !!document.querySelector('[data-modal-top="true"][inert]'),
      covered: document.querySelector('[data-modal-top="true"]')?.dataset.hudConsultCovered || null,
      qty: (() => {
        const plus = [...document.querySelectorAll('.recovery-card button')].find((b) => (b.textContent || '').trim() === '+')
        return plus?.parentElement?.textContent || null
      })(),
    })`)
    report.flowA.consult = { consultOpen, consultClosed }

    await clickLabel(page, '/voltar/i')
    await pause(200)
    const enteredReduce = await clickLabel(page, '/REDUZIR/i')
    await pause(250)
    const reduceProbe = await page.evaluate(PROBE)
    report.flowA.enteredReduce = enteredReduce
    report.flowA.reduceProbe = reduceProbe
    report.captures.push(await shot(page, 'A-reduce-667x375'))
    await clickLabel(page, '/voltar/i')
    await pause(200)

    const cashBefore = await page.evaluate(`(() => {
      const t = document.body.innerText
      return t
    })()`)
    await clickLabel(page, '/^DEMITIR$/i')
    await pause(200)
    await page.evaluate(`(() => {
      const plus = [...document.querySelectorAll('.recovery-card button')].find((b) => (b.textContent || '').trim() === '+' && !b.disabled)
      plus?.click()
    })()`)
    await pause(100)
    const confirmed = await clickLabel(page, '/^DEMITIR$/i')
    await pause(500)
    report.fire = {
      confirmed,
      recoveryGone: await page.evaluate(`!document.querySelector('.recovery-card')`),
      cashSnippet: typeof cashBefore === 'string' ? cashBefore.slice(0, 80) : null,
    }
    report.captures.push(await shot(page, 'A-after-fire'))

    await openRecovery(page)
    for (const [w, h] of DESKTOP) {
      await setViewport(page, w, h)
      await pause(400)
      const snap = await page.evaluate(`(() => {
        const roll = document.querySelector('.btn.go')
        const modal = document.querySelector('.recovery-card')
        const hud = document.querySelector('[data-hud-consult-region="desktop"]')
        const mr = modal?.getBoundingClientRect()
        const hr = hud?.getBoundingClientRect()
        return {
          rollExists: !!roll,
          rollDisabled: !roll || roll.disabled || roll.getAttribute('aria-disabled') === 'true' || !!roll.closest('[inert]'),
          modal: mr ? { left: mr.left, right: mr.right, bottom: mr.bottom } : null,
          hud: hr ? { left: hr.left, width: hr.width } : null,
          overlapHud: !!(mr && hr && mr.right > hr.left + 8),
          depth: document.documentElement.dataset.sgModalDepth || '0',
        }
      })()`)
      report.views[`D-${w}x${h}`] = snap
      report.captures.push(await shot(page, `D-${w}x${h}`))
    }
    await closeRecovery(page)

    // Fluxo B: saldo insuficiente empilha Recuperação sobre o diálogo existente.
    await setViewport(page, 667, 375)
    await pause(300)
    let funds = null
    for (let i = 0; i < 36; i += 1) {
      await skipTour(page)
      const s = await page.evaluate(`(() => {
        const btn = document.querySelector('.btn.go')
        const title = (document.querySelector('[data-modal-top="true"] .tileModal h2, [data-modal-top="true"] .tileModalTitle')?.textContent || '').trim()
        return { title, canRoll: !!(btn && !btn.disabled && btn.getAttribute('aria-disabled') !== 'true') }
      })()`)
      if (/Carteira de Clientes|MIX|ERP|Vendedor Comum|Gestor|Inside|representantes|Treinamento|Direito de Compra/i.test(s.title)) {
        await page.evaluate(`(() => {
          const input = document.querySelector('[data-modal-top="true"] input[type="number"]')
          if (input) {
            const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set
            setter?.call(input, '40')
            input.dispatchEvent(new Event('input', { bubbles: true }))
            input.dispatchEvent(new Event('change', { bubbles: true }))
          }
          const buy = [...document.querySelectorAll('[data-modal-top="true"] button')].find((b) => /comprar|confirmar|ok/i.test(b.textContent || ''))
          buy?.click()
        })()`)
        await pause(600)
        const top = await page.evaluate(`(document.querySelector('[data-modal-top="true"] h2, [data-modal-top="true"] .tileModalTitle')?.textContent || '').trim()`)
        if (/insuficiente/i.test(top)) {
          await page.evaluate(`([...document.querySelectorAll('[data-modal-top="true"] button')].find((b) => /Recuperação/i.test(b.textContent || ''))||{click(){}}).click()`)
          await pause(400)
          funds = await page.evaluate(PROBE)
          break
        }
      }
      if (s.title) {
        await page.evaluate(`(() => {
          const b = [...document.querySelectorAll('[data-modal-top="true"] button')].find((x) => /não comprar|pular|voltar|OK|fechar|Entendi|cancel/i.test(x.textContent || ''))
          b?.click()
        })()`)
        await pause(200)
        continue
      }
      if (s.canRoll) {
        await click(page, '.btn.go')
        await pause(1400)
        continue
      }
      await pause(200)
    }
    report.flowB = funds
    if (funds) {
      report.captures.push(await shot(page, 'B-recovery-stack-667x375'))
      const stackedFire = await clickLabel(page, '/^DEMITIR$/i')
      report.flowB.enteredFire = stackedFire
    }

    const mobiles = MOBILE.map(([w, h]) => report.views[`A-${w}x${h}`])
    report.ok = mobiles.every((v) => v && v.scrollWorked !== false && v.ctaHit)
      && report.flowA.enteredFire
      && report.flowA.consult?.consultClosed?.topInert === false
      && report.fire?.recoveryGone === true

    await writeFile(resolve(OUT, 'report.json'), JSON.stringify(report, null, 2))
    console.log(JSON.stringify({
      ok: report.ok,
      fire: report.fire,
      consult: report.flowA.consult,
      qtyAfterPlus: report.flowA.qtyAfterPlus,
      reduceCanScroll: report.flowA.reduceProbe?.scrollerCanScroll,
      flowBdepth: funds?.depth,
      flowBcanScroll: funds?.scrollerCanScroll,
      views: Object.fromEntries(Object.entries(report.views).map(([k, v]) => [k, {
        scrollWorked: v.scrollWorked,
        ctaInView: v.ctaInView,
        ctaHit: v.ctaHit,
        depth: v.probe?.depth || v.depth,
        overlapHud: v.overlapHud,
        rollExists: v.rollExists,
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
