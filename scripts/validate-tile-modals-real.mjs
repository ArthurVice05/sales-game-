/**
 * Validação real dos modais de casa na partida local.
 * Requer npm run dev. Uso: node scripts/validate-tile-modals-real.mjs
 *
 * - Recovery: botão real do HUD
 * - Field Sales / saldo insuficiente / DirectBuy / Training / Luck / Revenue / Expenses:
 *   montagem via tileModalPreviewMount sobre o shell da partida (mesmos componentes),
 *   medindo board antes/depois e contagem de resolve
 */
import { spawn } from 'node:child_process'
import { existsSync } from 'node:fs'
import { mkdir, writeFile } from 'node:fs/promises'
import { createConnection } from 'node:net'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..')
const APP_URL = 'http://127.0.0.1:5173/'
const PORT = Number(process.env.SG_TILE_REAL_CDP || 9355)
const OUT = path.join(process.env.TEMP || ROOT, 'sg-board-visual', 'tile-modals-real')
const CHROME = [
  process.env.CHROME_PATH,
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
].filter(Boolean).find((c) => existsSync(c))

const wait = (ms) => new Promise((r) => setTimeout(r, ms))
async function portOpen(port) {
  return new Promise((resolve) => {
    const s = createConnection({ host: '127.0.0.1', port }, () => { s.end(); resolve(true) })
    s.on('error', () => resolve(false))
  })
}

async function launchChrome() {
  if (!CHROME) throw new Error('Chrome não encontrado')
  if (await portOpen(PORT)) return
  const child = spawn(CHROME, [
    `--remote-debugging-port=${PORT}`,
    '--headless=new',
    '--disable-gpu',
    '--hide-scrollbars',
    `--user-data-dir=${path.join(process.env.TEMP || OUT, 'sg-tile-real-chrome')}`,
    'about:blank',
  ], { detached: true, stdio: 'ignore' })
  child.unref()
  for (let i = 0; i < 40; i += 1) {
    if (await portOpen(PORT)) return
    await wait(250)
  }
  throw new Error('CDP port')
}

async function cdp(ws, method, params = {}) {
  const id = cdp.nextId = (cdp.nextId || 0) + 1
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(method)), 25000)
    const on = (ev) => {
      const msg = JSON.parse(ev.data.toString())
      if (msg.id === id) {
        clearTimeout(timer)
        ws.removeEventListener('message', on)
        if (msg.error) reject(new Error(msg.error.message))
        else resolve(msg.result)
      }
    }
    ws.addEventListener('message', on)
    ws.send(JSON.stringify({ id, method, params }))
  })
}

async function sessionCall(ws, sessionId, method, params = {}) {
  const id = sessionCall.nextId = (sessionCall.nextId || 1000) + 1
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(method)), 25000)
    const on = (ev) => {
      const msg = JSON.parse(ev.data.toString())
      if (msg.method !== 'Target.receivedMessageFromTarget') return
      if (msg.params.sessionId !== sessionId) return
      const inner = JSON.parse(msg.params.message)
      if (inner.id !== id) return
      clearTimeout(timer)
      ws.removeEventListener('message', on)
      if (inner.error) reject(new Error(inner.error.message))
      else resolve(inner.result)
    }
    ws.addEventListener('message', on)
    ws.send(JSON.stringify({
      id: id + 50000,
      method: 'Target.sendMessageToTarget',
      params: { sessionId, message: JSON.stringify({ id, method, params }) },
    }))
  })
}

async function evaluate(ws, sessionId, expression) {
  const result = await sessionCall(ws, sessionId, 'Runtime.evaluate', {
    expression, awaitPromise: true, returnByValue: true,
  })
  if (result.exceptionDetails) {
    throw new Error(result.exceptionDetails.exception?.description || 'eval')
  }
  return result.result?.value
}

async function waitFor(ws, sessionId, expression, timeoutMs = 20000) {
  const started = Date.now()
  while (Date.now() - started < timeoutMs) {
    if (await evaluate(ws, sessionId, expression)) return
    await wait(250)
  }
  throw new Error('wait ' + expression)
}

const MEASURE = `(() => {
  const box = (el) => {
    if (!el) return null
    const r = el.getBoundingClientRect()
    return { w: +r.width.toFixed(1), h: +r.height.toFixed(1) }
  }
  const board = document.querySelector('.sg40GameBoard')
  const modal = document.querySelector('.tileModal, .recovery-card')
  const body = document.querySelector('.tileModalBody') || document.querySelector('.recovery-card [style*="overflow"]')
  return {
    vp: [innerWidth, innerHeight],
    board: box(board),
    modal: box(modal),
    title: document.querySelector('.tileModalTitle, .recovery-header')?.textContent?.trim()?.slice(0, 80) || null,
    hasFunds: !!document.querySelector('.tileModalTitle')?.textContent?.includes('insuficiente')
      || !!Array.from(document.querySelectorAll('.tileModalTitle')).find((el) => /insuficiente/i.test(el.textContent || '')),
    confirm: document.querySelector('.tileModalBtn--confirm')?.textContent?.trim() || null,
    resolveCount: window.__sgResolveCount || 0,
    lastResolve: window.__sgLastResolve || null,
    bodyScroll: body ? { top: body.scrollTop, max: body.scrollHeight - body.clientHeight } : null,
  }
})()`

await mkdir(OUT, { recursive: true })
await launchChrome()
const version = await fetch(`http://127.0.0.1:${PORT}/json/version`).then((r) => r.json())
const ws = new WebSocket(version.webSocketDebuggerUrl)
await new Promise((res, rej) => { ws.addEventListener('open', res); ws.addEventListener('error', rej) })
const { targetId } = await cdp(ws, 'Target.createTarget', { url: 'about:blank' })
const { sessionId } = await cdp(ws, 'Target.attachToTarget', { targetId, flatten: false })
await sessionCall(ws, sessionId, 'Page.enable')
await sessionCall(ws, sessionId, 'Runtime.enable')

async function setVp(width, height, mobile) {
  await sessionCall(ws, sessionId, 'Emulation.setDeviceMetricsOverride', {
    width, height, deviceScaleFactor: mobile ? 2 : 1, mobile,
    screenWidth: width, screenHeight: height,
  })
}
async function shot(name) {
  await sessionCall(ws, sessionId, 'Input.dispatchMouseEvent', { type: 'mouseMoved', x: 2, y: 2 }).catch(() => {})
  await wait(80)
  const png = await sessionCall(ws, sessionId, 'Page.captureScreenshot', { format: 'png', fromSurface: true })
  await writeFile(path.join(OUT, `${name}.png`), Buffer.from(png.data, 'base64'))
}

await setVp(1366, 768, false)
await sessionCall(ws, sessionId, 'Page.navigate', { url: APP_URL })
await wait(900)
await waitFor(ws, sessionId, `!!document.querySelector('.startBtn--local')`)
await evaluate(ws, sessionId, `document.querySelector('.startBtn--local').click(); true`)
await waitFor(ws, sessionId, `!!document.querySelector('#localPlayerName-0')`)
await evaluate(ws, sessionId, `
  [...document.querySelectorAll('.localSetupOptions button')].find((b) => b.textContent.includes('2'))?.click()
  const nativeSet = (el, value) => {
    const d = Object.getOwnPropertyDescriptor(Object.getPrototypeOf(el), 'value')
    d.set.call(el, value)
    el.dispatchEvent(new Event('input', { bubbles: true }))
  }
  nativeSet(document.querySelector('#localPlayerName-0'), 'Arthur')
  nativeSet(document.querySelector('#localPlayerName-1'), 'Beto')
  document.querySelector('.localSetupStart').click(); true
`)
await waitFor(ws, sessionId, `!!document.querySelector('.sg40GameBoard')`, 20000)
await waitFor(ws, sessionId, `!!document.querySelector('.localHandoffButton:not(:disabled)')`, 20000)
await evaluate(ws, sessionId, `document.querySelector('.localHandoffButton:not(:disabled)')?.click(); true`)
await waitFor(ws, sessionId, `!document.querySelector('.localHandoff')`, 8000)
await evaluate(ws, sessionId, `document.querySelector('.tutorialBtnGhost, .tutorialCloseX')?.click(); true`)
await wait(500)

const report = { boardBefore: [], flows: [] }
const boardBefore = await evaluate(ws, sessionId, MEASURE)
report.boardBefore.push({ name: '1366x768', ...boardBefore })
console.log('board-before', JSON.stringify(boardBefore))

async function ensureMountHelpers() {
  await evaluate(ws, sessionId, `
    (async () => {
      if (!window.__sgMountTile) {
        const mod = await import('/src/modals/tileModalPreviewMount.js')
        window.__sgMountTile = mod.mountTileModalPreview
        window.__sgUnmountTile = mod.unmountTileModalPreview
      }
      window.__sgResolveCount = 0
      window.__sgLastResolve = null
      const orig = window.__sgMountTile
      window.__sgMountTracked = (kind, extra = {}) => {
        const tracked = {
          ...extra,
          onResolve: (payload) => {
            window.__sgResolveCount = (window.__sgResolveCount || 0) + 1
            window.__sgLastResolve = payload
            extra.onResolve?.(payload)
          },
        }
        return orig(kind, tracked)
      }
      return true
    })()
  `)
}

async function mount(kind, extra = {}) {
  await ensureMountHelpers()
  await evaluate(ws, sessionId, `
    window.__sgUnmountTile?.()
    window.__sgResolveCount = 0
    window.__sgLastResolve = null
    window.__sgMountTracked(${JSON.stringify(kind)}, ${JSON.stringify(extra)})
    true
  `)
  await waitFor(ws, sessionId, `!!document.querySelector('.tileModal, .recovery-card')`)
}

async function unmount() {
  await evaluate(ws, sessionId, `window.__sgUnmountTile?.(); true`)
  await wait(200)
}

// --- Recovery real via botão do HUD ---
await evaluate(ws, sessionId, `(() => {
  const btn = [...document.querySelectorAll('button')].find((b) => /RECUPERA/i.test(b.textContent || ''))
  btn?.click()
  return true
})()`)
await waitFor(ws, sessionId, `!!document.querySelector('.recovery-card, .recovery-backdrop')`)
await shot('recovery-menu-real-desktop')
report.flows.push({ name: 'recovery-menu-real', ...(await evaluate(ws, sessionId, MEASURE)) })

await evaluate(ws, sessionId, `(() => {
  const btn = [...document.querySelectorAll('.recovery-card button, .recovery-backdrop button')]
    .find((b) => /EMPRÉSTIMO|EMPRESTIMO/i.test(b.textContent || '') && !b.disabled)
  btn?.click()
  return true
})()`)
await wait(400)
await shot('recovery-loan-real-desktop')
report.flows.push({ name: 'recovery-loan-real', ...(await evaluate(ws, sessionId, MEASURE)) })

await evaluate(ws, sessionId, `(() => {
  const back = [...document.querySelectorAll('.recovery-card button, .recovery-backdrop button')]
    .find((b) => /voltar/i.test(b.textContent || ''))
  back?.click()
  return true
})()`)
await wait(300)
await evaluate(ws, sessionId, `(() => {
  const btn = [...document.querySelectorAll('.recovery-card button, .recovery-backdrop button')]
    .find((b) => /REDUZIR/i.test(b.textContent || ''))
  btn?.click()
  return true
})()`)
await wait(400)
await shot('recovery-reduce-real-desktop')
report.flows.push({ name: 'recovery-reduce-real', ...(await evaluate(ws, sessionId, MEASURE)) })

await evaluate(ws, sessionId, `(() => {
  const back = [...document.querySelectorAll('.recovery-card button, .recovery-backdrop button')]
    .find((b) => /voltar/i.test(b.textContent || ''))
  back?.click()
  return true
})()`)
await wait(300)
await evaluate(ws, sessionId, `(() => {
  const btn = [...document.querySelectorAll('.recovery-card button, .recovery-backdrop button')]
    .find((b) => /DEMITIR/i.test(b.textContent || ''))
  btn?.click()
  return true
})()`)
await wait(400)
await shot('recovery-fire-real-desktop')
report.flows.push({ name: 'recovery-fire-real', ...(await evaluate(ws, sessionId, MEASURE)) })

await evaluate(ws, sessionId, `(() => {
  const x = [...document.querySelectorAll('.recovery-header button')].find(Boolean)
  x?.click()
  return true
})()`)
await wait(400)
if (await evaluate(ws, sessionId, `!!document.querySelector('.recovery-backdrop, .recovery-card')`)) {
  await evaluate(ws, sessionId, `(() => {
    const back = [...document.querySelectorAll('button')].find((b) => /voltar/i.test(b.textContent || ''))
    back?.click()
    return true
  })()`)
  await wait(250)
  await evaluate(ws, sessionId, `(() => {
    const x = [...document.querySelectorAll('.recovery-header button')].find(Boolean)
    x?.click()
    return true
  })()`)
  await wait(300)
}

// Recovery em altura baixa: no HUD compacto o botão fica atrás de "Mais".
await setVp(844, 320, true)
await wait(400)
await evaluate(ws, sessionId, `(() => {
  const more = document.querySelector('.moreOpenBtn')
    || [...document.querySelectorAll('button')].find((b) => /^Mais$/i.test((b.textContent || '').trim()))
  more?.click()
  return !!more
})()`)
await wait(350)
const openedShort = await evaluate(ws, sessionId, `(() => {
  const btn = [...document.querySelectorAll('button')].find((b) => /RECUPERA/i.test(b.textContent || ''))
  btn?.click()
  return !!btn
})()`)
if (!openedShort) {
  // Fallback: mesmo RecoveryModal via mount DEV (HUD compacto não expôs o botão)
  await mount('RECOVERY', { canClose: true })
}
await waitFor(ws, sessionId, `!!document.querySelector('.recovery-card')`)
await evaluate(ws, sessionId, `(() => {
  const scrollables = [...document.querySelectorAll('.recovery-card *')].filter((el) => el.scrollHeight > el.clientHeight + 8)
  if (scrollables[0]) scrollables[0].scrollTop = scrollables[0].scrollHeight
  return { scrollCount: scrollables.length, maxScroll: scrollables[0] ? scrollables[0].scrollHeight - scrollables[0].clientHeight : 0 }
})()`)
await wait(200)
await shot('recovery-menu-short-scrolled')
report.flows.push({ name: 'recovery-short', openedViaHud: !!openedShort, ...(await evaluate(ws, sessionId, MEASURE)) })

// Tela interna loan em altura baixa
await evaluate(ws, sessionId, `(() => {
  const btn = [...document.querySelectorAll('.recovery-card button, .recovery-backdrop button')]
    .find((b) => /EMPRÉSTIMO|EMPRESTIMO/i.test(b.textContent || '') && !b.disabled)
  btn?.click()
  return true
})()`)
await wait(400)
await shot('recovery-loan-short')
report.flows.push({ name: 'recovery-loan-short', ...(await evaluate(ws, sessionId, MEASURE)) })
await evaluate(ws, sessionId, `(() => {
  const x = [...document.querySelectorAll('.recovery-header button')].find(Boolean)
  if (x) { x.click(); return true }
  const back = [...document.querySelectorAll('.recovery-card button')].find((b) => /voltar/i.test(b.textContent || ''))
  back?.click()
  return true
})()`)
await wait(300)
await unmount()
await evaluate(ws, sessionId, `(() => {
  const x = [...document.querySelectorAll('.recovery-header button')].find(Boolean)
  x?.click()
  // fecha sheet "Mais" se ainda aberto
  const fechar = [...document.querySelectorAll('button')].find((b) => /^Fechar$/i.test((b.textContent || '').trim()))
  fechar?.click()
  const backdrop = document.querySelector('.moreSheetBackdrop, .hudMoreBackdrop, [aria-label="Mais ações"]')
  if (backdrop && typeof backdrop.click === 'function') backdrop.click()
  return true
})()`)
await wait(300)

// Field Sales notebook + mobile + stepper + insufficient funds
await setVp(1366, 768, false)
await wait(300)
await mount('FIELD', { currentCash: 18000, allowBack: true })
await evaluate(ws, sessionId, `(() => {
    const input = document.querySelector('.tileModal input[type="number"]')
    const plus = document.querySelector('.tileStepperBtn[aria-label="Aumentar quantidade"]')
    const minus = document.querySelector('.tileStepperBtn[aria-label="Diminuir quantidade"]')
    const setVal = (el, value) => {
      const d = Object.getOwnPropertyDescriptor(Object.getPrototypeOf(el), 'value')
      d.set.call(el, value)
      el.dispatchEvent(new Event('input', { bubbles: true }))
      el.dispatchEvent(new Event('change', { bubbles: true }))
    }
    window.__stepperTrace = []
    setVal(input, '')
    window.__stepperTrace.push({ step: 'empty', value: input.value, confirmDisabled: document.querySelector('.tileModalBtn--confirm')?.disabled })
    plus?.click()
    return true
  })()
`)
await wait(120)
await evaluate(ws, sessionId, `(() => {
  const input = document.querySelector('.tileModal input[type="number"]')
  window.__stepperTrace.push({ step: 'plus1', value: input.value, confirmDisabled: document.querySelector('.tileModalBtn--confirm')?.disabled, confirm: document.querySelector('.tileModalBtn--confirm')?.textContent?.trim() })
  document.querySelector('.tileStepperBtn[aria-label="Aumentar quantidade"]')?.click()
  return true
})()`)
await wait(120)
await evaluate(ws, sessionId, `(() => {
  const input = document.querySelector('.tileModal input[type="number"]')
  window.__stepperTrace.push({ step: 'plus2', value: input.value, confirm: document.querySelector('.tileModalBtn--confirm')?.textContent?.trim() })
  document.querySelector('.tileStepperBtn[aria-label="Diminuir quantidade"]')?.click()
  return true
})()`)
await wait(120)
await evaluate(ws, sessionId, `(() => {
  const input = document.querySelector('.tileModal input[type="number"]')
  window.__stepperTrace.push({ step: 'minus', value: input.value, confirm: document.querySelector('.tileModalBtn--confirm')?.textContent?.trim() })
  return true
})()`)
await wait(200)
await shot('field-sales-notebook')
const fieldDesk = await evaluate(ws, sessionId, MEASURE)
const stepper = await evaluate(ws, sessionId, `window.__stepperTrace`)
report.flows.push({ name: 'field-notebook', stepper, ...fieldDesk })
console.log('stepper', JSON.stringify(stepper))

// Contratação válida (qty=1) resolve BUY uma única vez
await evaluate(ws, sessionId, `(() => {
  const input = document.querySelector('.tileModal input[type="number"]')
  const d = Object.getOwnPropertyDescriptor(Object.getPrototypeOf(input), 'value')
  d.set.call(input, '1')
  input.dispatchEvent(new Event('input', { bubbles: true }))
  return true
})()`)
await wait(150)
await evaluate(ws, sessionId, `document.querySelector('.tileModalBtn--confirm')?.click(); true`)
await wait(300)
const afterBuy = await evaluate(ws, sessionId, MEASURE)
report.flows.push({ name: 'field-buy-once', resolveCount: afterBuy.resolveCount, lastResolve: afterBuy.lastResolve, board: afterBuy.board })
await unmount()

// Cancelamento permitido
await mount('FIELD', { currentCash: 18000, allowBack: true })
await evaluate(ws, sessionId, `(() => {
  const skip = [...document.querySelectorAll('.tileModalBtn')].find((b) => /Não comprar|Nao comprar/i.test(b.textContent || ''))
  skip?.click()
  return true
})()`)
await wait(300)
const afterSkip = await evaluate(ws, sessionId, MEASURE)
report.flows.push({ name: 'field-skip-resolve', resolveCount: afterSkip.resolveCount, lastResolve: afterSkip.lastResolve, board: afterSkip.board })
await unmount()
await setVp(844, 390, true)
await wait(250)
await mount('FIELD', { currentCash: 18000 })
await evaluate(ws, sessionId, `(() => {
  const input = document.querySelector('.tileModal input[type="number"]')
  const d = Object.getOwnPropertyDescriptor(Object.getPrototypeOf(input), 'value')
  d.set.call(input, '1')
  input.dispatchEvent(new Event('input', { bubbles: true }))
  return true
})()`)
await wait(200)
await shot('field-sales-mobile')
report.flows.push({ name: 'field-mobile', ...(await evaluate(ws, sessionId, MEASURE)) })

// Long modal + scroll footer + virtual keyboard simulation (focus input)
await setVp(844, 320, true)
await wait(200)
await mount('FIELD', { currentCash: 18000 })
await evaluate(ws, sessionId, `(() => {
  const input = document.querySelector('.tileModal input[type="number"]')
  input?.focus()
  const d = Object.getOwnPropertyDescriptor(Object.getPrototypeOf(input), 'value')
  d.set.call(input, '2')
  input.dispatchEvent(new Event('input', { bubbles: true }))
  const body = document.querySelector('.tileModalBody')
  if (body) body.scrollTop = body.scrollHeight
  return true
})()`)
await wait(250)
await shot('field-short-keyboard-scrolled')
report.flows.push({ name: 'field-short-keyboard', ...(await evaluate(ws, sessionId, MEASURE)) })
await unmount()

// Saldo insuficiente real (componente + fluxo do modal de contratação)
await setVp(1366, 768, false)
await wait(250)
await mount('FIELD', { currentCash: 1000, allowBack: false })
await evaluate(ws, sessionId, `(() => {
  const input = document.querySelector('.tileModal input[type="number"]')
  const d = Object.getOwnPropertyDescriptor(Object.getPrototypeOf(input), 'value')
  d.set.call(input, '1')
  input.dispatchEvent(new Event('input', { bubbles: true }))
  return true
})()`)
await wait(200)
await evaluate(ws, sessionId, `document.querySelector('.tileModalBtn--confirm')?.click(); true`)
await waitFor(ws, sessionId, `
  !!Array.from(document.querySelectorAll('.tileModalTitle')).some((el) => /insuficiente/i.test(el.textContent || ''))
`)
await shot('insufficient-funds-from-field')
report.flows.push({ name: 'insufficient-funds', ...(await evaluate(ws, sessionId, MEASURE)) })
await evaluate(ws, sessionId, `(() => {
  const ok = [...document.querySelectorAll('.tileModalBtn')].find((b) => /Entendi|OK/i.test(b.textContent || ''))
  ok?.click()
  return true
})()`)
await wait(300)
const afterFunds = await evaluate(ws, sessionId, `(() => {
  const base = ${MEASURE}
  const title = document.querySelector('.tileModalTitle')?.textContent || ''
  return {
    ...base,
    fieldStillOpen: /Field Sales|Vendedor de Campo/i.test(title) || !!document.querySelector('[data-preview-kind="FIELD"]'),
  }
})()`)
report.flows.push({
  name: 'insufficient-funds-ack',
  hasFunds: afterFunds.hasFunds,
  fieldStillOpen: afterFunds.fieldStillOpen,
  board: afterFunds.board,
  resolveCount: afterFunds.resolveCount,
  lastResolve: afterFunds.lastResolve,
})
// Field still open after ACK (by design) — cancel
await evaluate(ws, sessionId, `(() => {
  const skip = [...document.querySelectorAll('.tileModalBtn')].find((b) => /Não comprar|Nao comprar/i.test(b.textContent || ''))
  skip?.click()
  return true
})()`)
await wait(250)

// Direito de Compra: OPEN TRAINING + Training BACK (mesmos payloads do App)
await mount('DIRECT')
await shot('direct-buy-desktop')
await evaluate(ws, sessionId, `(() => {
  const card = [...document.querySelectorAll('.tileCertCard')].find((el) => /Treinamento/i.test(el.textContent || ''))
  const buy = card?.querySelector('button')
  buy?.click()
  return !!buy
})()`)
await wait(300)
const directOpen = await evaluate(ws, sessionId, MEASURE)
report.flows.push({ name: 'direct-open-training', resolveCount: directOpen.resolveCount, lastResolve: directOpen.lastResolve })
await unmount()

await mount('TRAINING', { allowBack: true })
await shot('training-desktop')
await evaluate(ws, sessionId, `(() => {
  const back = [...document.querySelectorAll('.tileModalBtn')].find((b) => /Voltar/i.test(b.textContent || ''))
  back?.click()
  return true
})()`)
await wait(250)
report.flows.push({ name: 'training-back', ...(await evaluate(ws, sessionId, MEASURE)) })
await unmount()

await mount('LUCK')
await shot('luck-confirm-desktop')
await evaluate(ws, sessionId, `document.querySelector('.tileModalBtn--confirm')?.click(); true`)
await wait(200)
await evaluate(ws, sessionId, `document.querySelector('.tileModalBtn--confirm')?.click(); true`)
await wait(250)
report.flows.push({ name: 'luck-once', ...(await evaluate(ws, sessionId, MEASURE)) })
await unmount()

await mount('REVENUE')
await shot('revenue-desktop')
await evaluate(ws, sessionId, `document.querySelector('.tileModalBtn--confirm')?.click(); true`)
await wait(250)
report.flows.push({ name: 'revenue-once', ...(await evaluate(ws, sessionId, MEASURE)) })
await unmount()

await mount('EXPENSES')
await shot('expenses-desktop')
await evaluate(ws, sessionId, `document.querySelector('.tileModalBtn--confirm')?.click(); true`)
await wait(250)
report.flows.push({ name: 'expenses-once', ...(await evaluate(ws, sessionId, MEASURE)) })
await unmount()

const boardAfter = await evaluate(ws, sessionId, MEASURE)
report.boardAfter = boardAfter
await shot('board-after-flows-desktop')
console.log('board-after', JSON.stringify(boardAfter))

await writeFile(path.join(OUT, 'report.json'), JSON.stringify(report, null, 2))
console.log('OUT', OUT)
ws.close()
