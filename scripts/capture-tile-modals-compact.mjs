/**
 * Capturas before/after da compactação mobile dos modais de casa.
 * Uso: node scripts/capture-tile-modals-compact.mjs
 */
import { spawn } from 'node:child_process'
import { existsSync } from 'node:fs'
import { mkdir, writeFile } from 'node:fs/promises'
import { createConnection } from 'node:net'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..')
const APP_URL = 'http://127.0.0.1:5173/'
const PORT = Number(process.env.SG_TILE_COMPACT_CDP || 9361)
const OUT = path.join(process.env.TEMP || ROOT, 'sg-board-visual', 'tile-modals-compact')
const CHROME = [
  process.env.CHROME_PATH,
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
].filter(Boolean).find((c) => existsSync(c))

const VPS = [
  [667, 375, true, '667x375'],
  [740, 360, true, '740x360'],
  [844, 390, true, '844x390'],
  [844, 320, true, '844x320'],
  [932, 430, true, '932x430'],
  [1366, 768, false, '1366x768'],
  [1600, 900, false, '1600x900'],
]

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
    `--user-data-dir=${path.join(process.env.TEMP || OUT, 'sg-tile-compact-chrome')}`,
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
    await wait(200)
  }
  throw new Error('wait ' + expression)
}

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
  await wait(120)
  const png = await sessionCall(ws, sessionId, 'Page.captureScreenshot', { format: 'png', fromSurface: true })
  await writeFile(path.join(OUT, `${name}.png`), Buffer.from(png.data, 'base64'))
}

async function mount(kind, extra = {}) {
  await evaluate(ws, sessionId, `(async () => {
    if (!window.__sgMountTile) {
      const mod = await import('/src/modals/tileModalPreviewMount.js')
      window.__sgMountTile = mod.mountTileModalPreview
      window.__sgUnmountTile = mod.unmountTileModalPreview
    }
    window.__sgUnmountTile?.()
    window.__sgMountTile(${JSON.stringify(kind)}, ${JSON.stringify(extra)})
    return true
  })()`)
  await waitFor(ws, sessionId, `!!document.querySelector('.tileModal, .recovery-card')`)
}

const MEASURE = `(() => {
  const modal = document.querySelector('.tileModal, .recovery-card')
  const body = document.querySelector('.tileModalBody, .recovery-body, .rr-scroll')
  const header = document.querySelector('.tileModalHeader, .recovery-header')
  const footer = document.querySelector('.tileModalFooter, .rr-footer, .recovery-row-btns')
  const cs = (el) => el ? getComputedStyle(el) : null
  const box = (el) => {
    if (!el) return null
    const r = el.getBoundingClientRect()
    return { w: +r.width.toFixed(1), h: +r.height.toFixed(1) }
  }
  const h = cs(header)
  const b = cs(body)
  const f = cs(footer)
  return {
    vp: [innerWidth, innerHeight],
    modal: box(modal),
    title: document.querySelector('.tileModalTitle, .recovery-header, .rr-title')?.textContent?.trim()?.slice(0, 60) || null,
    pad: {
      header: h ? [h.paddingTop, h.paddingBottom].join('/') : null,
      body: b ? [b.paddingTop, b.paddingBottom].join('/') : null,
      footer: f ? [f.paddingTop, f.paddingBottom].join('/') : null,
    },
    bodyScroll: body ? { top: body.scrollTop, max: Math.max(0, body.scrollHeight - body.clientHeight) } : null,
    touchMin: Math.min(
      ...[...document.querySelectorAll('.tileModalBtn, .tileStepperBtn, .tileModalClose, .recovery-card button')]
        .slice(0, 8)
        .map((el) => el.getBoundingClientRect().height),
      99,
    ),
  }
})()`

await setVp(1366, 768, false)
await sessionCall(ws, sessionId, 'Page.navigate', { url: APP_URL })
await wait(800)
await waitFor(ws, sessionId, `!!document.querySelector('.startBtn--local')`)
await evaluate(ws, sessionId, `document.querySelector('.startBtn--local').click(); true`)
await waitFor(ws, sessionId, `!!document.querySelector('#localPlayerName-0')`)
await evaluate(ws, sessionId, `(() => {
  [...document.querySelectorAll('.localSetupOptions button')].find((b) => b.textContent.includes('2'))?.click()
  const nativeSet = (el, value) => {
    const d = Object.getOwnPropertyDescriptor(Object.getPrototypeOf(el), 'value')
    d.set.call(el, value)
    el.dispatchEvent(new Event('input', { bubbles: true }))
  }
  nativeSet(document.querySelector('#localPlayerName-0'), 'Arthur')
  nativeSet(document.querySelector('#localPlayerName-1'), 'Beto')
  document.querySelector('.localSetupStart').click()
  return true
})()`)
await waitFor(ws, sessionId, `!!document.querySelector('.sg40GameBoard')`, 20000)
await waitFor(ws, sessionId, `!!document.querySelector('.localHandoffButton:not(:disabled)')`, 20000)
await evaluate(ws, sessionId, `document.querySelector('.localHandoffButton:not(:disabled)')?.click(); true`)
await waitFor(ws, sessionId, `!document.querySelector('.localHandoff')`, 8000)
await evaluate(ws, sessionId, `document.querySelector('.tutorialBtnGhost, .tutorialCloseX')?.click(); true`)
await wait(400)

const report = { after: [] }

for (const [w, h, mobile, label] of VPS) {
  await setVp(w, h, mobile)
  await wait(250)

  await mount('REVENUE')
  await shot(`after-revenue-${label}`)
  report.after.push({ kind: 'REVENUE', label, ...(await evaluate(ws, sessionId, MEASURE)) })

  await mount('FIELD', { currentCash: 18000 })
  await evaluate(ws, sessionId, `(() => {
    const input = document.querySelector('.tileModal input[type="number"]')
    if (!input) return false
    const d = Object.getOwnPropertyDescriptor(Object.getPrototypeOf(input), 'value')
    d.set.call(input, '1')
    input.dispatchEvent(new Event('input', { bubbles: true }))
    input.focus()
    const body = document.querySelector('.tileModalBody')
    if (body) body.scrollTop = body.scrollHeight
    return true
  })()`)
  await wait(150)
  await shot(`after-field-${label}`)
  report.after.push({ kind: 'FIELD', label, ...(await evaluate(ws, sessionId, MEASURE)) })

  await mount('RECOVERY', { canClose: true })
  await evaluate(ws, sessionId, `(() => {
    const btn = [...document.querySelectorAll('.recovery-card button')].find((b) => /REDUZIR/i.test(b.textContent || ''))
    btn?.click()
    return true
  })()`)
  await wait(350)
  await evaluate(ws, sessionId, `(() => {
    const scroll = document.querySelector('.rr-scroll, .recovery-body')
    if (scroll) scroll.scrollTop = scroll.scrollHeight
    return true
  })()`)
  await wait(120)
  await shot(`after-recovery-reduce-${label}`)
  report.after.push({ kind: 'RECOVERY_REDUCE', label, ...(await evaluate(ws, sessionId, MEASURE)) })

  await evaluate(ws, sessionId, `window.__sgUnmountTile?.(); true`)
  await wait(150)
}

await writeFile(path.join(OUT, 'report-after.json'), JSON.stringify(report, null, 2))
console.log(JSON.stringify(report.after.filter((r) => r.kind === 'FIELD'), null, 2))
console.log('OUT', OUT)
ws.close()
