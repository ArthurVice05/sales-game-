/**
 * Conferência: desktop simultâneo + mobile HUD recolhível.
 * node scripts/verify-hud-lateral-decisao.mjs
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

const OUT = resolve('artifacts/hud-lateral-decisao')
const APP = process.env.SG_APP_URL || 'http://127.0.0.1:5174/'
const DESKTOP = [[1366, 768], [1366, 650], [1600, 900], [1920, 1080]]
const MOBILE = [[667, 375], [844, 320], [844, 390], [1024, 480]]

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
    if (/^Carteira de Clientes$/i.test(s.title)) return { ...s, rolls: i }
    if (/^Direito de Compra$/i.test(s.title)) {
      await session.evaluate(`(() => {
        const cards = [...document.querySelectorAll('.tileCertCard, article')]
        const card = cards.find((el) => /Carteira de Clientes/i.test((el.querySelector('h3')?.textContent || '')))
        ;[...(card?.querySelectorAll('button') || [])].find((b) => /Comprar/i.test(b.textContent || ''))?.click()
      })()`)
      await pause(900)
      const t = await session.evaluate(`(document.querySelector('[data-modal-top="true"] .tileModal h2')?.textContent||'').trim()`)
      if (/Carteira/i.test(t)) return { title: t, path: 'DIRECT', rolls: i }
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

function measureForm(session) {
  return session.evaluate(`(() => {
    const modal = document.querySelector('[data-modal-top="true"] .tileModal')
    const footer = modal?.querySelector('.tileModalFooter')
    const overlay = document.querySelector('.sgModalOverlay')
    const vv = window.visualViewport
    const mr = modal?.getBoundingClientRect()
    const fr = footer?.getBoundingClientRect()
    const or = overlay?.getBoundingClientRect()
    const padRight = overlay ? getComputedStyle(overlay).paddingRight : null
    return {
      inner: { w: window.innerWidth, h: window.innerHeight },
      vv: vv ? { w: vv.width, h: vv.height, offsetLeft: vv.offsetLeft, offsetTop: vv.offsetTop, scale: vv.scale } : null,
      modal: mr ? { left: mr.left, right: mr.right, width: mr.width, top: mr.top, bottom: mr.bottom } : null,
      footer: fr ? { left: fr.left, right: fr.right, bottom: fr.bottom, width: fr.width } : null,
      overlay: or ? { width: or.width, height: or.height } : null,
      padRight,
      clippedLeft: mr ? mr.left < -1 : true,
      clippedRight: mr ? mr.right > window.innerWidth + 1 : true,
      footerInView: fr ? fr.bottom <= window.innerHeight + 1 && fr.left >= -1 && fr.right <= window.innerWidth + 1 : false,
      qty: document.querySelector('[data-modal-top="true"] input[type="number"]')?.value || '',
      hasToggle: !!document.querySelector('[data-hud-consult-toggle="open"]'),
      hasPanel: !!document.querySelector('.hudConsultRegion--mobileDecision'),
      hasDesktop: !!document.querySelector('[data-hud-consult-region="desktop"]'),
      internal: !!document.querySelector('.decisionConsultPanel, .decisionConsultToggle'),
    }
  })()`)
}

async function main() {
  const report = { at: new Date().toISOString(), ok: false, desktop: {}, mobile: {}, captures: [] }
  await mkdir(OUT, { recursive: true })
  let chrome
  try {
    chrome = await launchChromeBrowser({
      cdpPort: Number(process.env.SG_VERIFY_CDP_PORT || 9540),
      headed: false,
      profileDir: resolve(OUT, 'chrome-profile'),
    })
    const ctx = await chrome.connection.createBrowserContext()
    const page = await chrome.connection.openPage('about:blank', ctx)
    await setViewport(page, 1366, 768)
    await startLocal(page)
    let open = await huntClients(page)
    if (!open) {
      await startLocal(page)
      open = await huntClients(page)
    }
    if (!open) throw new Error('Não abriu Carteira')
    report.open = open

    await page.evaluate(`(() => {
      const input = document.querySelector('[data-modal-top="true"] input[type="number"]')
      const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set
      setter?.call(input, '2')
      input?.dispatchEvent(new Event('input', { bubbles: true }))
      input?.dispatchEvent(new Event('change', { bubbles: true }))
    })()`)
    await pause(150)

    for (const [w, h] of DESKTOP) {
      await setViewport(page, w, h)
      await pause(600)
      const snap = await page.evaluate(`(() => {
        const region = document.querySelector('[data-hud-consult-region="desktop"]')
        const tabs = [...(region?.querySelectorAll('[role="tab"]') || [])].map((t) => t.textContent.trim())
        ;[...(region?.querySelectorAll('[role="tab"]') || [])].find((t) => /Comercial/i.test(t.textContent || ''))?.click()
        const roll = document.querySelector('.btn.go')
        const rollDisabled = !roll || roll.disabled || roll.getAttribute('aria-disabled') === 'true'
          || !!roll.closest('[inert]')
        return {
          hasRegion: !!region,
          tabs,
          rollDisabled,
          turnInert: !!document.querySelector('.turnPrimaryActions[inert]'),
          qty: document.querySelector('[data-modal-top="true"] input[type="number"]')?.value || '',
          internal: !!document.querySelector('.decisionConsultPanel, .decisionConsultToggle'),
          hasToggle: !!document.querySelector('[data-hud-consult-toggle="open"]'),
        }
      })()`)
      report.captures.push(await shot(page, `desktop-${w}x${h}`))
      report.desktop[`${w}x${h}`] = {
        ...snap,
        ok: snap.hasRegion && snap.tabs.length >= 4 && snap.qty === '2' && !snap.internal && !snap.hasToggle
          && (snap.rollDisabled || snap.turnInert),
      }
    }

    for (const [w, h] of MOBILE) {
      await setViewport(page, w, h)
      await pause(700)
      // Fecha consulta se ficou aberta de um ciclo anterior
      await page.evaluate(`document.querySelector('[data-hud-consult-toggle="close"]')?.click()`)
      await pause(200)

      const closed = await measureForm(page)
      report.captures.push(await shot(page, `mobile-closed-${w}x${h}`))

      await page.evaluate(`document.querySelector('[data-hud-consult-toggle="open"]')?.click()`)
      await pause(350)
      const opened = await page.evaluate(`(() => {
        const panel = document.querySelector('.hudConsultRegion--mobileDecision')
        const tabs = [...(panel?.querySelectorAll('[role="tab"]') || [])].map((t) => t.textContent.trim())
        for (const name of ['Comercial', 'Estrutura', 'Ranking', 'Empresa']) {
          ;[...(panel?.querySelectorAll('[role="tab"]') || [])].find((t) => new RegExp(name, 'i').test(t.textContent || ''))?.click()
        }
        const formInert = !!document.querySelector('[data-modal-top="true"][inert]')
        const closeBtn = !!document.querySelector('[data-hud-consult-toggle="close"]')
        const finance = !!(panel && /Caixa|Faturamento|Despesas/i.test(panel.innerText || ''))
        return {
          hasPanel: !!panel,
          tabs,
          formInert,
          closeBtn,
          finance,
          qty: document.querySelector('[data-modal-top="true"] input[type="number"]')?.value || '',
        }
      })()`)
      report.captures.push(await shot(page, `mobile-open-${w}x${h}`))

      await page.evaluate(`document.querySelector('[data-hud-consult-toggle="close"]')?.click()`)
      await pause(300)
      const after = await measureForm(page)

      const formOk = !closed.clippedLeft && !closed.clippedRight && closed.footerInView
        && Number.parseFloat(closed.padRight || '0') <= 48
      // Gutter do botão (~44px) é aceitável; reserva de painel (≥100px) não.
      report.mobile[`${w}x${h}`] = {
        closed,
        opened,
        after,
        formOk,
        qtyPreserved: closed.qty === '2' && opened.qty === '2' && after.qty === '2',
        ok: formOk
          && closed.hasToggle
          && !closed.hasPanel
          && !closed.internal
          && opened.hasPanel
          && opened.tabs.length >= 4
          && opened.closeBtn
          && opened.formInert
          && opened.finance
          && after.hasToggle
          && !after.hasPanel
          && after.qty === '2',
      }
    }

    report.ok = Object.values(report.desktop).every((v) => v.ok)
      && Object.values(report.mobile).every((v) => v.ok)
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
