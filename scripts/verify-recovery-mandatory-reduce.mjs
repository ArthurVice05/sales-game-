/**
 * Cenário controlado: saldo insuficiente → Recuperação obrigatória → redução MIX.
 * Sem rolagem aleatória (posiciona na casa anterior a Despesas e força steps=1).
 * Uso: node scripts/verify-recovery-mandatory-reduce.mjs
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

const OUT = resolve('artifacts/recovery-mandatory-reduce')
const APP = process.env.SG_APP_URL || 'http://localhost:5174/'
const MIX_B_CREDIT = Math.floor(6000 * 0.5)

const PATCH_AND_ROLL = `(() => {
  const rootEl = document.getElementById('root')
  const fiberKey = Object.keys(rootEl || {}).find((k) => k.startsWith('__reactFiber') || k.startsWith('__reactContainer'))
  const start = rootEl?.[fiberKey]?.stateNode?.current || rootEl?.[fiberKey]?.current || rootEl?.[fiberKey]
  if (!start) throw new Error('fiber root ausente')

  const walk = (fiber, visit) => {
    if (!fiber) return
    visit(fiber)
    walk(fiber.child, visit)
    walk(fiber.sibling, visit)
  }

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

  const expensesIndex = 24
  dispatch((ps) => (ps || snapshot).map((p, i) => {
    if (i !== 0) return p
    return {
      ...p,
      cash: 0,
      mixProdutos: 'B',
      mixOwned: { A: false, B: true, C: true, D: true },
      mix: { A: false, B: true, C: true, D: true },
      pos: expensesIndex - 1,
      reducedLevels: { MIX: [], ERP: [] },
    }
  }))

  Math.random = () => 0
  return { ok: true, expensesIndex, beforeCash: 0, mix: 'B' }
})()`

const READ_PLAYER = `(() => {
  const rootEl = document.getElementById('root')
  const fiberKey = Object.keys(rootEl || {}).find((k) => k.startsWith('__reactFiber') || k.startsWith('__reactContainer'))
  const start = rootEl?.[fiberKey]?.stateNode?.current || rootEl?.[fiberKey]?.current || rootEl?.[fiberKey]
  let players = null
  const walk = (fiber, visit) => { if (!fiber) return; visit(fiber); walk(fiber.child, visit); walk(fiber.sibling, visit) }
  walk(start, (fiber) => {
    if (players) return
    let hook = fiber.memoizedState
    while (hook) {
      const val = hook.memoizedState
      if (Array.isArray(val) && val[0] && typeof val[0] === 'object' && 'mixProdutos' in val[0] && Number.isFinite(Number(val[0].cash))) {
        players = val
        return
      }
      hook = hook.next
    }
  })
  const p = players?.[0]
  return p ? {
    cash: Number(p.cash),
    mixProdutos: p.mixProdutos,
    mixOwned: p.mixOwned || p.mix || null,
    reducedLevels: p.reducedLevels || null,
    pos: p.pos,
  } : null
})()`

const OPEN_CHILD = `(() => {
  const rootEl = document.getElementById('root')
  const fiberKey = Object.keys(rootEl || {}).find((k) => k.startsWith('__reactFiber') || k.startsWith('__reactContainer'))
  const start = rootEl?.[fiberKey]?.stateNode?.current || rootEl?.[fiberKey]?.current || rootEl?.[fiberKey]
  let api = null
  const walk = (fiber, visit) => { if (!fiber) return; visit(fiber); walk(fiber.child, visit); walk(fiber.sibling, visit) }
  walk(start, (fiber) => {
    if (api) return
    let c = fiber.dependencies?.firstContext
    while (c) {
      const v = c.memoizedValue
      if (v && typeof v.openModal === 'function' && Array.isArray(v.stack)) { api = v; return }
      c = c.next
    }
  })
  if (!api) throw new Error('ModalContext ausente')
  window.__sgModalApi = api
  return { depth: api.stack.length }
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

async function waitTitle(page, re, timeoutMs = 20000) {
  const started = Date.now()
  while (Date.now() - started < timeoutMs) {
    const title = await page.evaluate(`(document.querySelector('[data-modal-top="true"] h2, [data-modal-top="true"] .tileModalTitle, .recovery-header')?.textContent || '').trim()`)
    if (re.test(title)) return title
    await pause(250)
  }
  throw new Error('timeout title ' + re)
}

async function main() {
  const report = { at: new Date().toISOString(), ok: false }
  await mkdir(OUT, { recursive: true })
  let chrome
  try {
    chrome = await launchChromeBrowser({
      cdpPort: Number(process.env.SG_VERIFY_CDP_PORT || 9562),
      headed: false,
      profileDir: resolve(OUT, 'chrome-profile'),
    })
    const ctx = await chrome.connection.createBrowserContext()
    const page = await chrome.connection.openPage('about:blank', ctx)
    await setViewport(page, 667, 375)
    await startLocal(page)

    report.patch = await page.evaluate(PATCH_AND_ROLL)
    await pause(300)
    report.playerBeforeRoll = await page.evaluate(READ_PLAYER)

    await page.evaluate(`document.querySelector('.btn.go')?.click()`)
    const expensesTitle = await waitTitle(page, /Despesas/i, 25000)
    report.expensesTitle = expensesTitle
    report.expenseCharge = await page.evaluate(`(() => {
      const huge = document.querySelector('[data-modal-top="true"] .tileValueHuge')?.textContent || ''
      const digits = huge.replace(/[^0-9]/g, '')
      return digits ? Number(digits) : null
    })()`)
    report.captures = [await shot(page, 'expenses')]
    await page.evaluate(`([...document.querySelectorAll('[data-modal-top="true"] button')].find((b) => /^OK$/i.test((b.textContent||'').trim()))||{click(){}}).click()`)

    const fundsTitle = await waitTitle(page, /insuficiente/i, 15000)
    report.funds = await page.evaluate(`(() => {
      const top = document.querySelector('[data-modal-top="true"]')
      const close = top?.querySelector('.tileModalClose, [aria-label="Fechar"]')
      return {
        title: (top?.querySelector('h2, .tileModalTitle')?.textContent || '').trim(),
        depth: document.documentElement.dataset.sgModalDepth || '0',
        hasClose: !!close,
        canCloseAttr: close ? true : false,
      }
    })()`)
    report.captures.push(await shot(page, 'insufficient-funds'))
    await page.evaluate(`([...document.querySelectorAll('[data-modal-top="true"] button')].find((b) => /Recuperação/i.test(b.textContent || ''))||{click(){}}).click()`)

    await waitTitle(page, /RECUPERAÇÃO FINANCEIRA/i, 15000)
    report.recovery = await page.evaluate(`(() => {
      const header = document.querySelector('.recovery-header')
      const close = header?.querySelector('button')
      const body = document.querySelector('.recovery-body')
      const demitir = [...document.querySelectorAll('.recovery-card button')].find((b) => /^DEMITIR$/i.test((b.textContent||'').trim()))
      const reduzir = [...document.querySelectorAll('.recovery-card button')].find((b) => /REDUZIR/i.test(b.textContent || ''))
      const r = reduzir?.getBoundingClientRect()
      const hit = r ? document.elementFromPoint(r.left + 12, r.top + 12) : null
      if (body) body.scrollTop = body.scrollHeight
      return {
        depth: document.documentElement.dataset.sgModalDepth || '0',
        hasClose: !!close,
        closeText: (close?.textContent || '').trim(),
        bodyCanScroll: body ? body.scrollHeight > body.clientHeight + 2 : false,
        reduzirHit: !!(hit && reduzir && (hit === reduzir || reduzir.contains(hit))),
        topInert: !!document.querySelector('[data-modal-top="true"][inert]'),
      }
    })()`)
    report.captures.push(await shot(page, 'recovery-mandatory'))

    await page.evaluate(`document.querySelector('[data-hud-consult-toggle="open"]')?.click()`)
    await pause(350)
    report.consultOpen = await page.evaluate(`({
      panel: !!document.querySelector('.hudConsultRegion--mobileDecision'),
      topInert: !!document.querySelector('[data-modal-top="true"][inert]'),
      covered: document.querySelector('[data-modal-top="true"]')?.dataset.hudConsultCovered || null,
      depth: document.documentElement.dataset.sgModalDepth || '0',
    })`)
    await page.evaluate(`document.querySelector('[data-hud-consult-toggle="close"]')?.click()`)
    await pause(300)
    report.consultClosed = await page.evaluate(`({
      panel: !!document.querySelector('.hudConsultRegion--mobileDecision'),
      topInert: !!document.querySelector('[data-modal-top="true"][inert]'),
      covered: document.querySelector('[data-modal-top="true"]')?.dataset.hudConsultCovered || null,
    })`)

    report.childOpen = await page.evaluate(OPEN_CHILD)
    const childMounted = await page.evaluate(`(async () => {
      const urls = [
        '/node_modules/.vite/deps/react.js',
        '/@fs/C:/Users/vicel/SalesGame/node_modules/react/index.js',
        '/node_modules/react/index.js',
      ]
      let last = ''
      for (const url of urls) {
        try {
          const React = await import(url)
          const mod = await import('/src/modals/ConfirmModal.jsx')
          const create = React.createElement || React.default?.createElement
          window.__sgModalApi.openModal(create(mod.default, { title: 'Diálogo filho', message: 'teste de pilha' }))
          return { ok: true, url }
        } catch (e) {
          last = url + ': ' + String(e && e.message || e)
        }
      }
      return { ok: false, error: last }
    })()`)
    report.childMounted = childMounted
    await pause(400)
    report.childWhileOpen = await page.evaluate(`({
      depth: document.documentElement.dataset.sgModalDepth || '0',
      title: (document.querySelector('[data-modal-top="true"] h2, [data-modal-top="true"] .tileModalTitle')?.textContent || '').trim(),
      recoveryCovered: document.querySelector('[data-modal-layer][data-modal-top="false"]')?.hasAttribute('inert') || null,
      layers: [...document.querySelectorAll('[data-modal-layer]')].map((el) => ({
        top: el.getAttribute('data-modal-top'),
        inert: el.hasAttribute('inert'),
        covered: el.dataset.hudConsultCovered || null,
      })),
    })`)
    report.captures.push(await shot(page, 'child-dialog'))
    await page.evaluate(`([...document.querySelectorAll('[data-modal-top="true"] button')].find((b) => /Cancelar/i.test(b.textContent || ''))||{click(){}}).click()`)
    await pause(400)
    report.afterChild = await page.evaluate(`({
      depth: document.documentElement.dataset.sgModalDepth || '0',
      title: (document.querySelector('.recovery-header')?.textContent || '').trim().slice(0, 40),
      topInert: !!document.querySelector('[data-modal-top="true"][inert]'),
      covered: document.querySelector('[data-modal-top="true"]')?.dataset.hudConsultCovered || null,
      reduzirEnabled: !![...document.querySelectorAll('.recovery-card button')].find((b) => /REDUZIR/i.test(b.textContent || '') && !b.disabled),
    })`)

    await page.evaluate(`([...document.querySelectorAll('.recovery-card button')].find((b) => /REDUZIR/i.test(b.textContent || ''))||{click(){}}).click()`)
    await pause(300)
    await page.evaluate(`document.querySelector('.rr-group[aria-label="MIX PRODUTOS"] .rr-card:not([disabled])')?.click()`)
    await pause(250)
    report.reduceForm = await page.evaluate(`(() => {
      const mixB = document.querySelector('.rr-group[aria-label="MIX PRODUTOS"] .rr-card:not([disabled])')
      const total = document.querySelector('.rr-summary')?.innerText || ''
      return {
        mixBText: (mixB?.textContent || '').slice(0, 80),
        mixBDisabled: !!mixB?.disabled,
        totalText: total,
        canScroll: (() => {
          const s = document.querySelector('.rr-scroll')
          return s ? s.scrollHeight > s.clientHeight + 2 : false
        })(),
      }
    })()`)
    await pause(200)
    report.confirmReduce = await page.evaluate(`(() => {
      const btn = document.querySelector('.rr-btn-reduce')
      const disabled = !!btn?.disabled
      if (btn && !disabled) btn.click()
      return { clicked: !!(btn && !disabled), disabled }
    })()`)
    await pause(800)

    report.playerAfter = await page.evaluate(READ_PLAYER)
    report.recoveryGone = await page.evaluate(`!document.querySelector('.recovery-card')`)
    report.expectedCredit = MIX_B_CREDIT
    const expense = Number(report.expenseCharge || 0)
    const after = report.playerAfter
    report.economy = after ? {
      cashDelta: after.cash - 0,
      expectedNet: MIX_B_CREDIT - expense,
      mix: after.mixProdutos,
      mixOwnedB: after.mixOwned?.B,
      reducedMix: after.reducedLevels?.MIX || [],
      appliedOnce: after.cash === MIX_B_CREDIT - expense && after.mixProdutos === 'C' && after.mixOwned?.B === false,
    } : null
    report.captures.push(await shot(page, 'after-reduce'))

    report.ok = report.funds?.hasClose === false
      && report.recovery?.hasClose === false
      && report.recovery?.reduzirHit === true
      && report.consultOpen?.topInert === true
      && report.consultClosed?.topInert === false
      && report.afterChild?.topInert === false
      && report.economy?.appliedOnce === true
      && report.recoveryGone === true

    await writeFile(resolve(OUT, 'report.json'), JSON.stringify(report, null, 2))
    console.log(JSON.stringify({
      ok: report.ok,
      funds: report.funds,
      recovery: report.recovery,
      consultOpen: report.consultOpen,
      consultClosed: report.consultClosed,
      childMounted: report.childMounted,
      childWhileOpen: report.childWhileOpen,
      afterChild: report.afterChild,
      reduceForm: report.reduceForm,
      expenseCharge: report.expenseCharge,
      playerAfter: report.playerAfter,
      economy: report.economy,
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
