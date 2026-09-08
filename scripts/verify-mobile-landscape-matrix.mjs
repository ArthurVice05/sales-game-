/**
 * Matriz geométrica landscape — Chrome CDP, sem Playwright.
 * Requer `npm run dev` (ou sobe sozinho) e um Chromium local.
 *
 * Uso: node scripts/verify-mobile-landscape-matrix.mjs
 */
import { spawn } from 'node:child_process'
import { existsSync } from 'node:fs'
import { mkdir, writeFile } from 'node:fs/promises'
import { createConnection } from 'node:net'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { BOARD_ASPECT } from '../src/components/hud/fitBoardInSlot.js'
import { stressLandscapeViewports } from '../src/components/hud/mobileLandscapeViewports.js'

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..')
const APP_ORIGIN = 'http://127.0.0.1:5173'
const APP_URL = `${APP_ORIGIN}/`
const PORT = Number(process.env.SG_MATRIX_CDP_PORT || 9338)
const ARTIFACT_DIR = path.join(process.env.TEMP || ROOT, 'sg-board-visual', 'mobile-landscape-matrix')
const CHROME_CANDIDATES = [
  process.env.CHROME_PATH,
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
].filter(Boolean)

const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

function resolveBrowser() {
  const found = CHROME_CANDIDATES.find((candidate) => existsSync(candidate))
  if (!found) {
    throw new Error('Nenhum Chromium encontrado. Defina CHROME_PATH.')
  }
  return found
}

async function portOpen(port) {
  return new Promise((resolve) => {
    const socket = createConnection({ host: '127.0.0.1', port }, () => {
      socket.end()
      resolve(true)
    })
    socket.on('error', () => resolve(false))
  })
}

async function probeDevServer() {
  try {
    const response = await fetch(APP_URL, { signal: AbortSignal.timeout(1500) })
    return response.status === 200
  } catch {
    return false
  }
}

async function ensureDevServer() {
  if (await probeDevServer()) return null
  const child = spawn('npm', ['run', 'dev'], {
    cwd: ROOT,
    shell: true,
    stdio: 'ignore',
  })
  for (let i = 0; i < 80; i += 1) {
    if (await probeDevServer()) return child
    await wait(400)
  }
  throw new Error(`Servidor não respondeu em ${APP_URL}`)
}

async function launchChrome(browserPath) {
  if (await portOpen(PORT)) return null
  const child = spawn(browserPath, [
    `--remote-debugging-port=${PORT}`,
    '--remote-debugging-address=127.0.0.1',
    '--headless=new',
    '--disable-gpu',
    '--hide-scrollbars',
    '--no-first-run',
    '--no-default-browser-check',
    `--user-data-dir=${path.join(process.env.TEMP || ARTIFACT_DIR, 'sg-mobile-matrix-chrome')}`,
    'about:blank',
  ], { detached: true, stdio: 'ignore' })
  child.unref()
  for (let i = 0; i < 40; i += 1) {
    if (await portOpen(PORT)) return child
    await wait(250)
  }
  throw new Error('Chrome DevTools port did not open')
}

async function cdp(ws, method, params = {}) {
  const id = cdp.nextId = (cdp.nextId || 0) + 1
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`CDP timeout: ${method}`)), 20000)
    const onMessage = (event) => {
      const msg = JSON.parse(event.data.toString())
      if (msg.id === id) {
        clearTimeout(timer)
        ws.removeEventListener('message', onMessage)
        if (msg.error) reject(new Error(`${method}: ${msg.error.message}`))
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
    const timer = setTimeout(() => reject(new Error(`session timeout: ${method}`)), 20000)
    const onMessage = (event) => {
      const msg = JSON.parse(event.data.toString())
      if (msg.method !== 'Target.receivedMessageFromTarget') return
      if (msg.params.sessionId !== sessionId) return
      const inner = JSON.parse(msg.params.message)
      if (inner.id !== id) return
      clearTimeout(timer)
      ws.removeEventListener('message', onMessage)
      if (inner.error) reject(new Error(`${method}: ${inner.error.message}`))
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
    expression,
    awaitPromise: true,
    returnByValue: true,
  })
  if (result.exceptionDetails) {
    throw new Error(result.exceptionDetails.exception?.description || result.exceptionDetails.text)
  }
  return result.result?.value
}

async function waitFor(ws, sessionId, expression, timeoutMs = 15000) {
  const started = Date.now()
  while (Date.now() - started < timeoutMs) {
    const value = await evaluate(ws, sessionId, expression)
    if (value) return value
    await wait(250)
  }
  throw new Error(`waitFor timeout: ${expression}`)
}

async function setViewport(ws, sessionId, width, height, mobile) {
  await sessionCall(ws, sessionId, 'Emulation.setDeviceMetricsOverride', {
    width,
    height,
    deviceScaleFactor: mobile ? 2 : 1,
    mobile,
    screenWidth: width,
    screenHeight: height,
  })
}

async function startLocalMatch(ws, sessionId) {
  await sessionCall(ws, sessionId, 'Page.navigate', { url: APP_URL })
  await wait(800)
  await waitFor(ws, sessionId, `!!document.querySelector('.startBtn--local')`)
  await evaluate(ws, sessionId, `document.querySelector('.startBtn--local').click(); true`)
  await waitFor(ws, sessionId, `!!document.querySelector('#localPlayerName-0')`)
  await evaluate(ws, sessionId, `
    const buttons = [...document.querySelectorAll('.localSetupOptions button')]
    const four = buttons.find((btn) => btn.textContent.includes('4'))
    four?.click()
    const nativeSet = (el, value) => {
      const proto = Object.getPrototypeOf(el)
      const desc = Object.getOwnPropertyDescriptor(proto, 'value')
      desc.set.call(el, value)
      el.dispatchEvent(new Event('input', { bubbles: true }))
    }
    nativeSet(document.querySelector('#localPlayerName-0'), 'Ana')
    nativeSet(document.querySelector('#localPlayerName-1'), 'Beto')
    nativeSet(document.querySelector('#localPlayerName-2'), 'Cris')
    nativeSet(document.querySelector('#localPlayerName-3'), 'Dani')
    document.querySelector('.localSetupStart').click()
    true
  `)
  await waitFor(ws, sessionId, `!!document.querySelector('.sg40GameBoard')`, 20000)
  await waitFor(ws, sessionId, `!!document.querySelector('.localHandoffButton:not(:disabled)')`, 20000)
  await evaluate(ws, sessionId, `document.querySelector('.localHandoffButton:not(:disabled)')?.click(); true`)
  await waitFor(ws, sessionId, `!document.querySelector('.localHandoff')`, 8000)
  await evaluate(ws, sessionId, `
    (() => {
      const tutorial = document.querySelector('.tutorialBtnGhost, .tutorialCloseX')
      if (tutorial) tutorial.click()
      return true
    })()
  `)
  await wait(400)
}

const MEASURE = `
(() => {
  const board = document.querySelector('.sg40GameBoard')
  const wrap = document.querySelector('.boardWrap')
  const go = document.querySelector('.turnPrimaryActions .btn.go') || document.querySelector('.btn.go')
  const timer = document.querySelector('.turnTimer, .gdhMetrics')
  const cash = document.querySelector('.money, .gdhCash, .hudMetricCard')
  const status = document.querySelector('.nextStepHint')
  const header = document.querySelector('.gameDesktopHeader, .topbar')
  const tiles = [...document.querySelectorAll('.sg40Preview__tile')]
  const wr = wrap ? wrap.getBoundingClientRect() : null
  const br = board ? board.getBoundingClientRect() : null
  const host = (br && br.width > 32 && br.height > 32) ? br : wr
  const clipped = tiles.filter((tile) => {
    const r = tile.getBoundingClientRect()
    const box = host || { left: 0, top: 0, right: innerWidth, bottom: innerHeight }
    const pad = 6
    return r.width > 1 && (
      r.left < -1 || r.right > innerWidth + 1 || r.top < -1 || r.bottom > innerHeight + 1
      || r.left < box.left - pad || r.right > box.right + pad
      || r.top < box.top - pad || r.bottom > box.bottom + pad
    )
  }).length
  const gr = go ? go.getBoundingClientRect() : null
  const ratio = br && br.height ? br.width / br.height : 0
  const headerBottom = header ? header.getBoundingClientRect().bottom : 0
  const boardCollapsed = !!(wr && br && (br.width < wr.width * 0.4 || br.height < wr.height * 0.4))
  return {
    tiles: tiles.length,
    clipped,
    boardCollapsed,
    pageOverflow: document.documentElement.scrollHeight > innerHeight + 2
      || document.documentElement.scrollWidth > innerWidth + 2,
    desktopHeader: !!document.querySelector('.gameDesktopHeader'),
    topbar: !!document.querySelector('.topbar'),
    rollInView: !!(gr && gr.bottom <= innerHeight + 1 && gr.top >= -1 && gr.width > 0 && gr.height > 0),
    rollClickable: !!(gr && gr.width >= 24 && gr.height >= 24 && gr.left >= -1 && gr.right <= innerWidth + 1),
    boardInView: !!(br && br.top >= -1 && br.left >= -1 && br.bottom <= innerHeight + 1 && br.right <= innerWidth + 1),
    boardBelowHeader: !!(br && br.top >= headerBottom - 2),
    aspect: +ratio.toFixed(3),
    timer: !!timer,
    round: document.body.innerText.includes('0/5') || document.body.innerText.includes('Rodada'),
    cash: !!cash,
    status: !!status,
  }
})()
`

function rowOk(row) {
  const aspectOk = row.width >= 1200
    ? true
    : Math.abs(row.aspect - BOARD_ASPECT) < 0.08
  const chromeOk = row.width >= 1200
    ? row.desktopHeader === true && row.topbar === false
    : row.desktopHeader === false && row.topbar === true
  return row.tiles === 40
    && row.clipped === 0
    && !row.boardCollapsed
    && row.boardInView
    && row.boardBelowHeader
    && row.rollInView
    && row.rollClickable
    && !row.pageOverflow
    && row.timer
    && row.round
    && row.cash
    && row.status
    && aspectOk
    && chromeOk
}

async function main() {
  await mkdir(ARTIFACT_DIR, { recursive: true })
  const viewports = stressLandscapeViewports()
  const browserPath = resolveBrowser()
  const server = await ensureDevServer()
  await launchChrome(browserPath)
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
  await setViewport(ws, sessionId, 932, 430, true)
  await startLocalMatch(ws, sessionId)

  const rows = []
  for (const { width, height, layer } of viewports) {
    await setViewport(ws, sessionId, width, height, width < 1200)
    await wait(350)
    const m = await evaluate(ws, sessionId, MEASURE)
    const row = { width, height, layer, ok: false, ...m }
    row.ok = rowOk(row)
    rows.push(row)
    if (!row.ok) console.log(JSON.stringify(row))
  }
  await writeFile(path.join(ARTIFACT_DIR, 'matrix.json'), `${JSON.stringify(rows, null, 2)}\n`)
  const failed = rows.filter((row) => !row.ok)
  const passed = rows.length - failed.length
  console.log(`MATRIX ${passed}/${rows.length} ok`)
  if (failed.length) {
    console.log('FAILS', failed.map((row) => `${row.width}x${row.height}`).join(', '))
  }
  ws.close()
  if (server?.pid) spawn('taskkill', ['/pid', String(server.pid), '/T', '/F'], { stdio: 'ignore' })
  if (failed.length) process.exit(1)
}

main().catch((error) => {
  console.error(error)
  process.exit(1)
})
