/**
 * Conferência pontual: foco volta ao Contratar após InsufficientFunds.
 * node scripts/verify-modal-focus-restore.mjs
 */
import { resolve } from 'node:path'
import {
  launchChromeBrowser,
  pause,
  waitForSelector,
  setViewport,
  click,
  setInputValue,
} from './cdp-min.mjs'

const APP = process.env.SG_APP_URL || 'http://127.0.0.1:5174/'

async function skipTour(session) {
  for (let i = 0; i < 8; i += 1) {
    await session.evaluate(`([...document.querySelectorAll('button')].find((b)=>/Pular tutorial/i.test(b.textContent||''))||{click(){}}).click()`)
    await pause(120)
  }
}

async function dismiss(session) {
  await session.evaluate(`(() => {
    const title = document.querySelector('.tileModal h2')?.textContent?.trim() || ''
    if (/^Carteira de Clientes$|^Direito de Compra$/i.test(title)) return
    const b = [...document.querySelectorAll('.tileModal button')].find((x) =>
      /não comprar|pular|voltar|OK|fechar|Entendi|cancel/i.test(x.textContent || '')
    )
    b?.click()
  })()`)
  await pause(300)
}

async function huntClients(session, maxRolls = 40) {
  let rolls = 0
  for (let i = 0; i < maxRolls; i += 1) {
    await skipTour(session)
    const s = await session.evaluate(`(() => {
      const btn = document.querySelector('.btn.go')
      const title = document.querySelector('.tileModal h2')?.textContent?.trim() || ''
      return {
        title,
        canRoll: !!(btn && !btn.disabled && btn.getAttribute('aria-disabled') !== 'true'),
      }
    })()`)
    if (/^Carteira de Clientes$/i.test(s.title)) return { rolls }
    if (/^Direito de Compra$/i.test(s.title)) {
      await session.evaluate(`(() => {
        const cards = [...document.querySelectorAll('.tileCertCard, article')]
        const card = cards.find((el) => /Carteira de Clientes/i.test((el.querySelector('h3')?.textContent || '')))
        ;[...(card?.querySelectorAll('button') || [])].find((b) => /Comprar/i.test(b.textContent || ''))?.click()
      })()`)
      await pause(900)
      const t = await session.evaluate(`(document.querySelector('.tileModal h2')?.textContent||'').trim()`)
      if (/Carteira de Clientes/i.test(t)) return { rolls, path: 'DIRECT' }
      await session.evaluate(`([...document.querySelectorAll('.tileModal button')].find((b)=>/Não comprar|Pular|Voltar/i.test(b.textContent||''))||{click(){}}).click()`)
      await pause(350)
      continue
    }
    if (s.title) { await dismiss(session); continue }
    if (s.canRoll) {
      await click(session, '.btn.go')
      rolls += 1
      await pause(1800)
      continue
    }
    await pause(300)
  }
  return null
}

const chrome = await launchChromeBrowser({
  cdpPort: Number(process.env.SG_VERIFY_CDP_PORT || 9491),
  headed: false,
  profileDir: resolve('artifacts/modal-focus-restore/chrome-profile'),
})
const report = { ok: false }
try {
  const ctx = await chrome.connection.createBrowserContext()
  const page = await chrome.connection.openPage('about:blank', ctx)
  await setViewport(page, 1366, 768)
  await page.call('Page.navigate', { url: APP })
  await waitForSelector(page, '#playerName', 40_000)
  await skipTour(page)
  await click(page, '.startBtn--local')
  await waitForSelector(page, '#localPlayerName-0', 20_000)
  await setInputValue(page, '#localPlayerName-0', 'Ana')
  await setInputValue(page, '#localPlayerName-1', 'Bruno')
  await page.evaluate(`(() => {
    const sel = document.querySelector('#localTurnTime')
    if (!sel) return
    const opts = [...sel.options].map((o) => Number(o.value)).filter(Number.isFinite)
    sel.value = String(Math.max(...opts))
    sel.dispatchEvent(new Event('change', { bubbles: true }))
  })()`)
  await click(page, '.localSetupStart')
  await waitForSelector(page, '.sg40GameBoard', 60_000)
  await pause(800)
  await skipTour(page)

  let open = await huntClients(page, 48)
  if (!open) {
    await page.call('Page.navigate', { url: APP })
    await waitForSelector(page, '#playerName', 40_000)
    await skipTour(page)
    await click(page, '.startBtn--local')
    await waitForSelector(page, '#localPlayerName-0', 20_000)
    await setInputValue(page, '#localPlayerName-0', 'Ana')
    await setInputValue(page, '#localPlayerName-1', 'Bruno')
    await click(page, '.localSetupStart')
    await waitForSelector(page, '.sg40GameBoard', 60_000)
    await pause(800)
    await skipTour(page)
    open = await huntClients(page, 48)
  }
  if (!open) throw new Error('Não abriu Carteira')

  await page.evaluate(`(() => {
    const input = document.querySelector('[data-modal-top="true"] input[type="number"]')
      || document.querySelector('.tileModal input[type="number"]')
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set
    setter?.call(input, '999999')
    input?.dispatchEvent(new Event('input', { bubbles: true }))
    input?.dispatchEvent(new Event('change', { bubbles: true }))
  })()`)
  await pause(200)
  const qtyReady = await page.evaluate(`document.querySelector('[data-modal-top="true"] input[type="number"]')?.value||''`)
  if (qtyReady !== '999999') {
    // fallback stepper
    for (let i = 0; i < 5; i += 1) {
      await page.evaluate(`document.querySelector('[data-modal-top="true"] button[aria-label="Aumentar quantidade"]')?.click()`)
      await pause(40)
    }
    await page.evaluate(`(() => {
      const input = document.querySelector('[data-modal-top="true"] input[type="number"]')
      const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set
      setter?.call(input, '999999')
      input?.dispatchEvent(new Event('input', { bubbles: true }))
      input?.dispatchEvent(new Event('change', { bubbles: true }))
    })()`)
    await pause(150)
  }

  await page.evaluate(`(() => {
    const root = document.querySelector('[data-modal-top="true"]') || document
    const btn = [...root.querySelectorAll('button')].find((b) =>
      /Contratar por|Contratar|Comprar por/i.test(b.textContent || '')
    )
    btn?.focus()
    btn?.click()
  })()`)
  await pause(900)

  const child = await page.evaluate(`(
    document.querySelector('[data-modal-top="true"] .tileModal h2')?.textContent
    || document.querySelector('.tileModal h2')?.textContent
    || ''
  ).trim()`)
  if (!/Saldo insuficiente/i.test(child)) throw new Error(`Esperava saldo insuficiente, got: ${child}`)

  await page.evaluate(`(() => {
    const root = document.querySelector('[data-modal-top="true"]') || document
    ;[...root.querySelectorAll('button')].find((b)=>/Entendi|OK/i.test(b.textContent||''))?.click()
  })()`)
  await pause(450)

  report.focus = await page.evaluate(`(() => {
    const active = document.activeElement
    const title = (document.querySelector('[data-modal-top="true"] .tileModal h2')?.textContent || '').trim()
    const inTop = !!active?.closest?.('[data-modal-top="true"]')
    const text = (active?.textContent || '').replace(/\\s+/g, ' ').trim().slice(0, 80)
    const aria = active?.getAttribute?.('aria-label') || null
    const isConfirm = /Contratar|Comprar/i.test(text)
    const isQty = active?.matches?.('input[type="number"]')
    const isClose = /Fechar/i.test(aria || '')
    return {
      title,
      inTop,
      tag: active?.tagName || null,
      text,
      aria,
      ok: inTop && (isConfirm || isQty || isClose || active?.matches?.('button')),
      isConfirm,
    }
  })()`)
  report.ok = !!report.focus?.ok && /Carteira de Clientes/i.test(report.focus?.title || '')
  await page.close()
  await chrome.connection.disposeBrowserContext(ctx)
} catch (e) {
  report.error = e.message
  report.ok = false
} finally {
  report.chromeStop = await chrome.stop()
}
console.log(JSON.stringify(report, null, 2))
process.exit(report.ok ? 0 : 1)
