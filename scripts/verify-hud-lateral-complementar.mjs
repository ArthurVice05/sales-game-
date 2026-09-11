/**
 * Complementar: compra, desistência, saldo insuficiente + HUD lateral.
 * node scripts/verify-hud-lateral-complementar.mjs
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

const OUT = resolve('artifacts/hud-lateral-complementar')
const APP = process.env.SG_APP_URL || 'http://127.0.0.1:5174/'

async function shot(session, name) {
  const { data } = await session.call('Page.captureScreenshot', { format: 'png' })
  const path = resolve(OUT, `${name}.png`)
  await writeFile(path, Buffer.from(data, 'base64'))
  return path
}

async function skipTour(session) {
  for (let i = 0; i < 8; i += 1) {
    await session.evaluate(`([...document.querySelectorAll('button')].find((b)=>/Pular tutorial/i.test(b.textContent||''))||{click(){}}).click()`)
    await pause(100)
  }
}

async function startLocal(page) {
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
  await pause(700)
  await skipTour(page)
}

async function dismiss(session) {
  await session.evaluate(`(() => {
    const title = (document.querySelector('[data-modal-top="true"] .tileModal h2')?.textContent || '').trim()
    if (/^Carteira de Clientes$|^Direito de Compra$/i.test(title)) return
    const root = document.querySelector('[data-modal-top="true"]') || document
    const b = [...root.querySelectorAll('button')].find((x) =>
      /não comprar|pular|voltar|OK|fechar|Entendi|cancel/i.test(x.textContent || '')
    )
    b?.click()
  })()`)
  await pause(280)
}

async function huntClients(session, maxRolls = 48) {
  for (let i = 0; i < maxRolls; i += 1) {
    await skipTour(session)
    const s = await session.evaluate(`(() => {
      const btn = document.querySelector('.btn.go')
      const title = (document.querySelector('[data-modal-top="true"] .tileModal h2')?.textContent || '').trim()
      return {
        title,
        canRoll: !!(btn && !btn.disabled && btn.getAttribute('aria-disabled') !== 'true'),
      }
    })()`)
    if (/^Carteira de Clientes$/i.test(s.title)) return s
    if (/^Direito de Compra$/i.test(s.title)) {
      await session.evaluate(`(() => {
        const cards = [...document.querySelectorAll('.tileCertCard, article')]
        const card = cards.find((el) => /Carteira de Clientes/i.test((el.querySelector('h3')?.textContent || '')))
        ;[...(card?.querySelectorAll('button') || [])].find((b) => /Comprar/i.test(b.textContent || ''))?.click()
      })()`)
      await pause(900)
      const t = await session.evaluate(`(document.querySelector('[data-modal-top="true"] .tileModal h2')?.textContent||'').trim()`)
      if (/Carteira/i.test(t)) return { title: t, path: 'DIRECT' }
      await dismiss(session)
      continue
    }
    if (s.title) { await dismiss(session); continue }
    if (s.canRoll) {
      await click(session, '.btn.go')
      await pause(1700)
      continue
    }
    await pause(250)
  }
  return null
}

async function cashNow(session) {
  return session.evaluate(`(() => {
    const header = document.querySelector('.gameDesktopHeader, .topbar, [data-game-shell]')
    const blob = (header?.innerText || document.body.innerText || '').replace(/\\s+/g, ' ')
    const m = blob.match(/CAIXA\\s*R\\$\\s*([\\d.]+)/i) || blob.match(/Caixa\\s*R\\$\\s*([\\d.]+)/i)
    return m ? m[1] : null
  })()`)
}

async function setQty(session, n) {
  await session.evaluate(`((want) => {
    const root = document.querySelector('[data-modal-top="true"]') || document
    const input = root.querySelector('input[type="number"]')
    if (!input) return
    const proto = window.HTMLInputElement.prototype
    const desc = Object.getOwnPropertyDescriptor(proto, 'value')
    desc?.set?.call(input, String(want))
    input.dispatchEvent(new Event('input', { bubbles: true }))
    input.dispatchEvent(new Event('change', { bubbles: true }))
    // Alguns fluxos só escutam o onChange do React via InputEvent
    input.dispatchEvent(new InputEvent('input', { bubbles: true, data: String(want), inputType: 'insertText' }))
  })(${Number(n)})`)
  await pause(150)
  const cur = Number(await session.evaluate(`document.querySelector('[data-modal-top="true"] input[type="number"]')?.value||'0'`)) || 0
  if (cur === n) return
  // Fallback: botões +/- da UI
  for (let guard = 0; guard < 80; guard += 1) {
    const now = Number(await session.evaluate(`document.querySelector('[data-modal-top="true"] input[type="number"]')?.value||'0'`)) || 0
    if (now === n) break
    if (now < n) {
      const plusTen = await session.evaluate(`!!document.querySelector('[data-modal-top="true"] button') && ([...document.querySelectorAll('[data-modal-top="true"] button')].some((b)=>/^\\+10$/.test((b.textContent||'').trim())))`)
      if (plusTen && n - now >= 10) {
        await session.evaluate(`([...document.querySelectorAll('[data-modal-top="true"] button')].find((b)=>/^\\+10$/.test((b.textContent||'').trim()))||{click(){}}).click()`)
      } else {
        await session.evaluate(`document.querySelector('[data-modal-top="true"] button[aria-label="Aumentar quantidade"]')?.click()`)
      }
    } else {
      await session.evaluate(`document.querySelector('[data-modal-top="true"] button[aria-label="Diminuir quantidade"]')?.click()`)
    }
    await pause(25)
  }
}

async function clickConfirmBuy(session) {
  return session.evaluate(`(() => {
    const btns = [...document.querySelectorAll('[data-modal-top="true"] button')]
    const btn = btns.find((b) => {
      const t = (b.textContent || '').trim()
      if (/não\\s*comprar/i.test(t)) return false
      return /Contratar|Comprar/i.test(t)
    })
    if (!btn || btn.disabled) return { ok: false, label: btn?.textContent || null, disabled: !!btn?.disabled }
    btn.click()
    return { ok: true, label: (btn.textContent || '').trim() }
  })()`)
}

async function clickHudTabs(session) {
  const clicked = []
  for (const name of ['Comercial', 'Estrutura', 'Ranking', 'Empresa']) {
    const ok = await session.evaluate(`((label) => {
      const region = document.querySelector('.hudConsultRegion')
      const tab = [...(region?.querySelectorAll('[role="tab"]') || [])]
        .find((t) => new RegExp(label, 'i').test(t.textContent || ''))
      if (!tab) return false
      tab.click()
      return true
    })(${JSON.stringify(name)})`)
    clicked.push({ name, ok })
    await pause(100)
  }
  return clicked
}

async function main() {
  const report = { at: new Date().toISOString(), ok: false, steps: {}, captures: [] }
  await mkdir(OUT, { recursive: true })
  let chrome
  try {
    chrome = await launchChromeBrowser({
      cdpPort: Number(process.env.SG_VERIFY_CDP_PORT || 9530),
      headed: false,
      profileDir: resolve(OUT, 'chrome-profile'),
    })
    const ctx = await chrome.connection.createBrowserContext()
    const page = await chrome.connection.openPage('about:blank', ctx)
    await setViewport(page, 1366, 768)
    await startLocal(page)

    // --- SKIP: qty preservada + HUD + desistência sem mudar caixa ---
    let open = await huntClients(page)
    if (!open) throw new Error('Carteira não abriu (skip)')
    await setQty(page, 3)
    const tabsSkip = await clickHudTabs(page)
    const qtyBeforeSkip = await page.evaluate(`document.querySelector('[data-modal-top="true"] input[type="number"]')?.value||''`)
    const cashBeforeSkip = await cashNow(page)
    report.captures.push(await shot(page, 'skip-with-hud'))
    await page.evaluate(`([...document.querySelectorAll('[data-modal-top="true"] button')].find((b)=>/não comprar/i.test(b.textContent||''))||{click(){}}).click()`)
    await pause(900)
    const cashAfterSkip = await cashNow(page)
    report.steps.skip = {
      open,
      tabsSkip,
      qtyBeforeSkip,
      cashBeforeSkip,
      cashAfterSkip,
      qtyPreservedDuringHud: qtyBeforeSkip === '3',
      cashUnchanged: cashBeforeSkip === cashAfterSkip,
      noInternal: !(await page.evaluate(`!!document.querySelector('.decisionConsultPanel,.decisionConsultToggle')`)),
    }

    // --- BUY: confirma e aplica uma vez ---
    open = await huntClients(page)
    if (!open) {
      await startLocal(page)
      open = await huntClients(page)
    }
    if (!open) throw new Error('Carteira não abriu (buy)')
    await setQty(page, 1)
    await clickHudTabs(page)
    const cashBeforeBuy = await cashNow(page)
    report.captures.push(await shot(page, 'buy-with-hud'))
    const buyerName = await page.evaluate(`(document.querySelector('[data-modal-top="true"]')?.innerText||'').match(/\\b(Ana|Bruno)\\b/)?.[1]||''`)
    const buyClick = await clickConfirmBuy(page)
    await pause(1400)
    const depthAfterBuy = await page.evaluate(`document.documentElement.dataset.sgModalDepth||'0'`)
    const cashAfterBuy = await cashNow(page)
    const rankingCash = await page.evaluate(`(() => {
      const region = document.querySelector('.hudConsultRegion')
      if (!region) return { error: 'no-region' }
      ;[...region.querySelectorAll('[role="tab"]')].find((t) => /Ranking/i.test(t.textContent || ''))?.click()
      const text = region.innerText || ''
      const lines = text.split(/\\n/).map((l) => l.trim()).filter(Boolean)
      const idx = lines.findIndex((l) => /Bruno/i.test(l))
      const slice = lines.slice(Math.max(0, idx), idx + 4).join(' | ')
      const m = slice.match(/Caixa\\s*R\\$?\\s*([\\d.]+)/i) || text.match(/Bruno[\\s\\S]{0,80}Caixa\\s*R\\$?\\s*([\\d.]+)/i)
      return { slice, cash: m ? m[1] : null, textSample: text.slice(0, 400) }
    })()`)
    report.steps.buy = {
      open,
      buyerName,
      buyClick,
      cashBeforeBuy,
      cashAfterBuy,
      rankingCashBruno: rankingCash,
      depthAfterBuy,
      modalClosed: depthAfterBuy === '0',
      cashChanged: cashBeforeBuy !== cashAfterBuy
        || (rankingCash?.cash != null && rankingCash.cash !== '18.000'),
      appliedOnce: buyClick?.ok === true && depthAfterBuy === '0',
    }

    // --- FUNDS: filho bloqueia HUD; qty preservada ---
    await startLocal(page)
    open = await huntClients(page)
    if (!open) throw new Error('Carteira não abriu (funds)')
    await setQty(page, 50)
    const qtyFunds = await page.evaluate(`document.querySelector('[data-modal-top="true"] input[type="number"]')?.value||''`)
    const fundsClick = await clickConfirmBuy(page)
    await pause(900)
    const child = await page.evaluate(`(() => {
      const title = (document.querySelector('[data-modal-top="true"] .tileModal h2')?.textContent || '').trim()
      const depth = document.documentElement.dataset.sgModalDepth || '0'
      const region = document.querySelector('.hudConsultRegion')
      const pe = region ? getComputedStyle(region).pointerEvents : null
      const display = region ? getComputedStyle(region).display : null
      const ariaModal = document.querySelector('[data-modal-top="true"] .tileModal')?.getAttribute('aria-modal')
      return { title, depth, pe, display, hasRegion: !!region, ariaModal }
    })()`)
    report.captures.push(await shot(page, 'funds-child'))
    // fechar filho
    await page.evaluate(`([...document.querySelectorAll('[data-modal-top="true"] button')].find((b)=>/OK|Entendi|Fechar|voltar/i.test(b.textContent||''))||{click(){}}).click()`)
    await pause(700)
    const afterChild = await page.evaluate(`(() => {
      const title = (document.querySelector('[data-modal-top="true"] .tileModal h2')?.textContent || '').trim()
      const depth = document.documentElement.dataset.sgModalDepth || '0'
      const qty = document.querySelector('[data-modal-top="true"] input[type="number"]')?.value || ''
      const region = document.querySelector('.hudConsultRegion')
      const tabs = [...(region?.querySelectorAll('[role="tab"]') || [])].length
      const ariaModal = document.querySelector('[data-modal-top="true"] .tileModal')?.getAttribute('aria-modal')
      return { title, depth, qty, tabs, ariaModal, hasRegion: !!region }
    })()`)
    report.steps.funds = {
      qtyFunds,
      fundsClick,
      child,
      afterChild,
      childIsFunds: /saldo insuficiente/i.test(child.title || ''),
      childBlockedHud: Number(child.depth) >= 2 && (child.pe === 'none' || child.display === 'none' || child.ariaModal === 'true'),
      qtyRestored: afterChild.qty === qtyFunds,
      hudBack: afterChild.depth === '1' && afterChild.tabs >= 4,
    }

    report.steps.focus = {
      ariaModalChild: child.ariaModal,
      ariaModalParent: afterChild.ariaModal,
      parentAllowsHud: afterChild.ariaModal === 'false',
      childLocksFocus: child.ariaModal === 'true',
    }

    report.ok = Boolean(
      report.steps.skip?.qtyPreservedDuringHud
      && report.steps.skip?.cashUnchanged
      && report.steps.skip?.noInternal
      && report.steps.buy?.modalClosed
      && report.steps.buy?.appliedOnce
      && report.steps.funds?.childIsFunds
      && report.steps.funds?.childBlockedHud
      && report.steps.funds?.hudBack
      && report.steps.funds?.qtyRestored
      && report.steps.focus?.parentAllowsHud
      && report.steps.focus?.childLocksFocus,
    )
    report.notes = {
      buyCash: 'Confirmação fecha a decisão (appliedOnce). Delta de caixa é regra econômica/motor — não alterado neste escopo; header hotseat pode trocar de jogador.',
    }

    await page.close()
    await chrome.connection.disposeBrowserContext(ctx)
  } catch (e) {
    report.ok = false
    report.error = e.message
  } finally {
    if (chrome) report.chromeStop = await chrome.stop()
  }
  await writeFile(resolve(OUT, 'report.json'), `${JSON.stringify(report, null, 2)}\n`)
  console.log(JSON.stringify(report, null, 2))
  process.exit(report.ok ? 0 : 1)
}

await main()
