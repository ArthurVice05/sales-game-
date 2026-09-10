/**
 * Conferência visual do modal Carteira de Clientes (preview mount).
 * node scripts/verify-modal-clientes-resumo.mjs
 */
import { mkdir, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import {
  launchChromeBrowser,
  pause,
  waitForSelector,
  setViewport,
} from './multiplayer-load/cdp.mjs'

const OUT = resolve('artifacts/modal-clientes-resumo')
const APP = process.env.SG_APP_URL || 'http://127.0.0.1:5174/'
const VIEWS = [
  [1366, 768],
  [1366, 650],
  [1366, 600],
  [1600, 900],
  [1920, 1080],
  [667, 375],
  [844, 320],
  [844, 390],
  [1024, 480],
]

async function probe(url) {
  try {
    const r = await fetch(url, { signal: AbortSignal.timeout(2500) })
    return r.ok || (r.status >= 200 && r.status < 500)
  } catch { return false }
}

async function shot(session, name) {
  const { data } = await session.call('Page.captureScreenshot', { format: 'png' })
  const path = resolve(OUT, name)
  await writeFile(path, Buffer.from(data, 'base64'))
  return path
}

async function main() {
  const report = { at: new Date().toISOString(), ok: false, views: {}, captures: [], checks: {} }
  await mkdir(OUT, { recursive: true })
  let chrome
  try {
    let appUrl = null
    for (const u of [APP, 'http://127.0.0.1:5174/', 'http://localhost:5174/', 'http://localhost:5173/']) {
      if (await probe(u)) { appUrl = u; break }
    }
    if (!appUrl) throw new Error('dev server down')
    report.appUrl = appUrl

    chrome = await launchChromeBrowser({
      cdpPort: Number(process.env.SG_VERIFY_CDP_PORT || 9450),
      headed: false,
      profileDir: resolve(OUT, 'chrome-profile'),
    })
    const ctx = await chrome.connection.createBrowserContext()
    const page = await chrome.connection.openPage('about:blank', ctx)
    await setViewport(page, 1366, 768)
    await page.call('Page.navigate', { url: appUrl })
    await waitForSelector(page, '#root', 40_000)
    for (let i = 0; i < 6; i += 1) {
      await page.evaluate(`(() => {
        const skip = [...document.querySelectorAll('button')]
          .find((b) => /Pular tutorial|Agora não|Fechar/i.test((b.textContent || '').replace(/\\s+/g, ' ')))
        skip?.click()
      })()`)
      await pause(250)
    }
    await page.evaluate(`document.querySelectorAll('.sg-modal-backdrop').forEach((el)=>el.remove())`)
    await page.evaluate(`import('/src/modals/tileModalPreviewMount.js').then((m) => {
      window.__clientsResolves = []
      m.mountTileModalPreview('CLIENTS', {
        onResolve: (payload) => { window.__clientsResolves.push(payload) },
      })
    })`)
    await pause(800)
    await waitForSelector(page, '.tileModal--clients', 15_000)

    // qty preservada ao expandir (via stepper, estado React)
    for (let i = 0; i < 3; i += 1) {
      await page.evaluate(`(() => {
        const btn = document.querySelector('.tileModal--clients button[aria-label="Aumentar quantidade"]')
        btn?.click()
      })()`)
      await pause(80)
    }
    await pause(200)
    const qtyBefore = await page.evaluate(`document.querySelector('.tileModal--clients input[type="number"]')?.value || ''`)
    await page.evaluate(`(() => {
      const btn = [...document.querySelectorAll('.tileModal--clients button')]
        .find((b) => /O que já tenho/i.test(b.textContent || ''))
      btn?.click()
    })()`)
    await pause(200)
    await page.evaluate(`(() => {
      const btn = [...document.querySelectorAll('.tileModal--clients button')]
        .find((b) => /Entenda a capacidade/i.test(b.textContent || ''))
      btn?.click()
    })()`)
    await pause(200)
    const qtyAfter = await page.evaluate(`document.querySelector('.tileModal--clients input[type="number"]')?.value || ''`)
    report.checks.expandPreservesQty = qtyBefore === '3' && qtyAfter === '3'

    // captura com detalhes abertos (notebook)
    report.captures.push(await shot(page, 'clients-1366x768-expanded.png'))
    // fecha detalhes para capturas compactas padrão
    await page.evaluate(`(() => {
      const btns = [...document.querySelectorAll('.tileModal--clients button')]
      btns.find((b) => /Ocultar o que já tenho/i.test(b.textContent || ''))?.click()
      btns.find((b) => /Ocultar detalhes da capacidade/i.test(b.textContent || ''))?.click()
    })()`)
    await pause(200)

    // payloads SKIP / BUY preservados
    await page.evaluate(`(() => {
      const skip = [...document.querySelectorAll('.tileModal--clients button')]
        .find((b) => /Não comprar/i.test(b.textContent || ''))
      skip?.click()
    })()`)
    await pause(300)
    await page.evaluate(`import('/src/modals/tileModalPreviewMount.js').then((m) => {
      m.mountTileModalPreview('CLIENTS', {
        onResolve: (payload) => { window.__clientsResolves.push(payload) },
        allowBack: true,
      })
    })`)
    await pause(600)
    for (let i = 0; i < 2; i += 1) {
      await page.evaluate(`document.querySelector('.tileModal--clients button[aria-label="Aumentar quantidade"]')?.click()`)
      await pause(60)
    }
    await page.evaluate(`(() => {
      const buy = [...document.querySelectorAll('.tileModal--clients button')]
        .find((b) => /Contratar por/i.test(b.textContent || ''))
      buy?.click()
    })()`)
    await pause(300)
    report.checks.payloads = await page.evaluate(`(() => {
      const list = window.__clientsResolves || []
      const skip = list.find((p) => p?.action === 'SKIP')
      const buy = list.find((p) => p?.action === 'BUY')
      return {
        skip: !!skip,
        buy: !!buy,
        buyQty: buy?.qty ?? null,
        buyKeys: buy ? Object.keys(buy).sort() : [],
        hasClientsAdded: buy?.clientsAdded === buy?.qty,
      }
    })()`)

    // remonta limpo para capturas de viewport
    await page.evaluate(`import('/src/modals/tileModalPreviewMount.js').then((m) => m.mountTileModalPreview('CLIENTS'))`)
    await pause(500)

    report.checks.summary = await page.evaluate(`(() => {
      const root = document.querySelector('.tileModal--clients')
      const t = root?.innerText || ''
      return {
        hasMinhaEmpresa: /Minha empresa agora/i.test(t),
        hasExpand: [...root.querySelectorAll('button')].some((b) => /O que já tenho/i.test(b.textContent || '')),
        hasImpact: /Impacto da contratação/i.test(t),
        hasAgora: /\\bAgora\\b/.test(t) || !!root?.querySelector('[data-label="Agora"]'),
        hasOldField: /Field Sales/i.test(t),
        hasFooter: !!root?.querySelector('.tileModalFooter'),
        hasSpare: /Capacidade livre/i.test(t),
        width: Math.round(root?.getBoundingClientRect().width || 0),
        bodyScroll: (() => {
          const body = root?.querySelector('.tileModalBody')
          return body ? body.scrollHeight >= body.clientHeight : false
        })(),
      }
    })()`)
    await page.evaluate(`(() => {
      const btn = [...document.querySelectorAll('.tileModal--clients button')]
        .find((b) => /O que já tenho/i.test(b.textContent || ''))
      btn?.click()
    })()`)
    await pause(250)
    report.checks.summary.hasCanal = await page.evaluate(
      `(/Canal representantes/i.test(document.querySelector('.tileModal--clients')?.innerText || ''))`,
    )
    await page.evaluate(`(() => {
      const btn = [...document.querySelectorAll('.tileModal--clients button')]
        .find((b) => /Ocultar o que já tenho/i.test(b.textContent || ''))
      btn?.click()
    })()`)
    await pause(150)

    for (const [w, h] of VIEWS) {
      await setViewport(page, w, h)
      await pause(350)
      const measure = await page.evaluate(`(() => {
        const root = document.querySelector('.tileModal--clients')
        const body = root?.querySelector('.tileModalBody')
        const footer = root?.querySelector('.tileModalFooter')
        const input = root?.querySelector('input[type="number"]')
        const rr = root?.getBoundingClientRect()
        const fr = footer?.getBoundingClientRect()
        const ir = input?.getBoundingClientRect()
        return {
          modalVisible: !!(root && rr.width > 0),
          footerVisible: !!(footer && fr.height > 0 && fr.bottom <= window.innerHeight + 1),
          qtyVisible: !!(input && ir.height > 0),
          hScroll: document.documentElement.scrollWidth > document.documentElement.clientWidth + 2,
          modalHScroll: body ? body.scrollWidth > body.clientWidth + 2 : false,
          clippedText: [...(root?.querySelectorAll('h2, .companySnapshotTitle, .tileStatLabel') || [])]
            .some((el) => el.scrollWidth > el.clientWidth + 2),
        }
      })()`)
      report.views[`${w}x${h}`] = measure
      report.captures.push(await shot(page, `clients-${w}x${h}.png`))
    }

    // outro modal: FIELD não deve ter tileModal--clients
    await page.evaluate(`import('/src/modals/tileModalPreviewMount.js').then((m) => m.mountTileModalPreview('FIELD'))`)
    await pause(600)
    report.checks.otherModal = await page.evaluate(`(() => {
      const root = document.querySelector('.tileModal')
      return {
        hasClientsClass: !!document.querySelector('.tileModal--clients'),
        title: root?.querySelector('h2')?.textContent?.trim() || null,
        hasCompanySnapshot: !!document.querySelector('.companySnapshot'),
      }
    })()`)
    report.captures.push(await shot(page, 'other-field-modal.png'))

    const viewsOk = Object.values(report.views).every((v) => v.modalVisible && v.footerVisible && v.qtyVisible && !v.hScroll && !v.modalHScroll)
    report.ok = report.checks.expandPreservesQty
      && report.checks.summary?.hasMinhaEmpresa
      && report.checks.summary?.hasCanal
      && !report.checks.summary?.hasOldField
      && report.checks.payloads?.skip
      && report.checks.payloads?.buy
      && report.checks.payloads?.buyQty === 2
      && report.checks.otherModal?.hasClientsClass === false
      && report.checks.otherModal?.hasCompanySnapshot === false
      && viewsOk

    await page.close()
    await chrome.connection.disposeBrowserContext(ctx)
  } catch (e) {
    report.ok = false
    report.error = e.message
    report.stack = e.stack
  } finally {
    if (chrome) report.chromeStop = await chrome.stop()
  }
  await writeFile(resolve(OUT, 'report.json'), `${JSON.stringify(report, null, 2)}\n`)
  console.log(JSON.stringify(report, null, 2))
  process.exit(report.ok ? 0 : 1)
}

await main()
