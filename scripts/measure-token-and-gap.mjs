/**
 * Mede peão desktop + gap Resumo/Mais. Requer npm run dev :5173.
 * Uso: node scripts/measure-token-and-gap.mjs [before|after]
 */
import { spawn } from 'node:child_process'
import { existsSync } from 'node:fs'
import { mkdir, writeFile } from 'node:fs/promises'
import { createConnection } from 'node:net'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..')
const LABEL = process.argv[2] === 'before' ? 'before' : 'after'
const APP_URL = 'http://127.0.0.1:5173/'
const PORT = Number(process.env.SG_TOKEN_GAP_CDP || 9355)
const OUT = path.join(process.env.TEMP || ROOT, 'sg-board-visual', 'token-gap')
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
    `--remote-debugging-port=${PORT}`, '--headless=new', '--disable-gpu', '--hide-scrollbars',
    `--user-data-dir=${path.join(process.env.TEMP || OUT, 'sg-token-gap-chrome')}`,
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
    const t = setTimeout(() => reject(new Error(method)), 20000)
    const onMessage = (event) => {
      const msg = JSON.parse(event.data.toString())
      if (msg.id === id) {
        clearTimeout(t)
        ws.removeEventListener('message', onMessage)
        if (msg.error) reject(new Error(msg.error.message))
        else resolve(msg.result)
      }
    }
    ws.addEventListener('message', onMessage)
    ws.send(JSON.stringify({ id, method, params }))
  })
}

async function sessionCall(ws, sessionId, method, params = {}) {
  const id = sessionCall.nextId = (sessionCall.nextId || 1000) + 1
  return new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error(method)), 20000)
    const onMessage = (event) => {
      const msg = JSON.parse(event.data.toString())
      if (msg.method !== 'Target.receivedMessageFromTarget') return
      if (msg.params.sessionId !== sessionId) return
      const inner = JSON.parse(msg.params.message)
      if (inner.id !== id) return
      clearTimeout(t)
      ws.removeEventListener('message', onMessage)
      if (inner.error) reject(new Error(inner.error.message))
      else resolve(inner.result)
    }
    ws.addEventListener('message', onMessage)
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
  if (result.exceptionDetails) throw new Error(result.exceptionDetails.exception?.description || 'eval')
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

await mkdir(OUT, { recursive: true })
await launchChrome()
const version = await fetch(`http://127.0.0.1:${PORT}/json/version`).then((r) => r.json())
const ws = new WebSocket(version.webSocketDebuggerUrl)
await new Promise((resolve, reject) => {
  ws.addEventListener('open', resolve)
  ws.addEventListener('error', reject)
})
const { targetId } = await cdp(ws, 'Target.createTarget', { url: 'about:blank' })
const { sessionId } = await cdp(ws, 'Target.attachToTarget', { targetId, flatten: false })
await sessionCall(ws, sessionId, 'Page.enable')
await sessionCall(ws, sessionId, 'Runtime.enable')

async function setVp(width, height, mobile) {
  await sessionCall(ws, sessionId, 'Emulation.setDeviceMetricsOverride', {
    width, height, deviceScaleFactor: 1, mobile,
    screenWidth: width, screenHeight: height,
  })
}

async function shot(name) {
  const png = await sessionCall(ws, sessionId, 'Page.captureScreenshot', { format: 'png', fromSurface: true })
  await writeFile(path.join(OUT, `${LABEL}-${name}.png`), Buffer.from(png.data, 'base64'))
}

const PROBE_TOKENS = `(() => {
  const tokens = [...document.querySelectorAll('.sg40GameBoard__token')]
  const board = document.querySelector('.sg40GameBoard')
  const cqi = board ? board.getBoundingClientRect().width / 100 : null
  return {
    vp: [innerWidth, innerHeight],
    boardW: board ? +board.getBoundingClientRect().width.toFixed(2) : null,
    cqi: cqi != null ? +cqi.toFixed(3) : null,
    tokens: tokens.map((el) => {
      const r = el.getBoundingClientRect()
      const cs = getComputedStyle(el)
      return {
        w: +r.width.toFixed(2),
        h: +r.height.toFixed(2),
        cssW: cs.width,
        scale: cs.scale,
        transform: cs.transform,
        active: el.classList.contains('token--active'),
        initial: el.querySelector('.tokenInitial')?.textContent || '',
      }
    }),
  }
})()`

const PROBE_GAP = `(() => {
  const row = document.querySelector('.compactActionRow')
  const resumo = document.querySelector('.compactActionRow .hudOpenBtn')
  const mais = document.querySelector('.compactActionRow .moreOpenBtn')
  const page = document.querySelector('.page[data-game-shell]')
  if (!row) return { gap: null, hudMode: page?.getAttribute('data-hud-mode') }
  const cs = getComputedStyle(row)
  const rr = resumo?.getBoundingClientRect()
  const mr = mais?.getBoundingClientRect()
  const measured = rr && mr ? +(Math.min(mr.left, rr.left) === rr.left
    ? (mr.left - rr.right)
    : (rr.left - mr.right)).toFixed(2) : null
  return {
    hudMode: page?.getAttribute('data-hud-mode'),
    gapCss: cs.gap || cs.columnGap,
    measuredGap: measured,
    resumo: !!resumo && getComputedStyle(resumo).display !== 'none',
    mais: !!mais && getComputedStyle(mais).display !== 'none',
  }
})()`

await setVp(1366, 768, false)
await sessionCall(ws, sessionId, 'Page.navigate', { url: APP_URL })
await wait(800)
await waitFor(ws, sessionId, `!!document.querySelector('.startBtn--local')`)
await evaluate(ws, sessionId, `document.querySelector('.startBtn--local').click(); true`)
await waitFor(ws, sessionId, `!!document.querySelector('#localPlayerName-0')`)
await evaluate(ws, sessionId, `
  ;[...document.querySelectorAll('.localSetupOptions button')].find((b) => b.textContent.includes('4'))?.click()
  const nativeSet = (el, value) => {
    const desc = Object.getOwnPropertyDescriptor(Object.getPrototypeOf(el), 'value')
    desc.set.call(el, value)
    el.dispatchEvent(new Event('input', { bubbles: true }))
  }
  ;['Arthur','Beto','Carla','Duda'].forEach((n, i) => {
    const el = document.querySelector('#localPlayerName-' + i)
    if (el) nativeSet(el, n)
  })
  document.querySelector('.localSetupStart').click(); true
`)
await waitFor(ws, sessionId, `!!document.querySelector('.sg40GameBoard')`, 20000)
await waitFor(ws, sessionId, `!!document.querySelector('.localHandoffButton:not(:disabled)')`, 20000)
await evaluate(ws, sessionId, `document.querySelector('.localHandoffButton:not(:disabled)')?.click(); true`)
await waitFor(ws, sessionId, `!document.querySelector('.localHandoff')`, 8000)
await evaluate(ws, sessionId, `document.querySelector('.tutorialBtnGhost, .tutorialCloseX')?.click(); true`)
await wait(500)

const report = { label: LABEL, desktop: {}, mobile: {} }

for (const [w, h] of [[1366, 768], [1600, 900]]) {
  await setVp(w, h, false)
  await wait(400)
  const probe = await evaluate(ws, sessionId, PROBE_TOKENS)
  report.desktop[`${w}x${h}`] = probe
  await shot(`tokens-${w}x${h}`)
  console.log(LABEL, `${w}x${h}`, JSON.stringify(probe.tokens.map((t) => ({ w: t.w, active: t.active, initial: t.initial }))))
}

for (const [w, h] of [[844, 390], [1024, 480]]) {
  await setVp(w, h, true)
  await wait(400)
  const gap = await evaluate(ws, sessionId, PROBE_GAP)
  const tokens = await evaluate(ws, sessionId, PROBE_TOKENS)
  report.mobile[`${w}x${h}`] = { gap, tokenWs: tokens.tokens.map((t) => t.w) }
  await shot(`hud-${w}x${h}`)
  console.log(LABEL, `gap ${w}x${h}`, JSON.stringify(gap), 'tokenW', tokens.tokens[0]?.w)
}

await writeFile(path.join(OUT, `${LABEL}-report.json`), JSON.stringify(report, null, 2))
ws.close()
console.log('OUT', OUT)
