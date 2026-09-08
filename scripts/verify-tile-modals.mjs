/**
 * Baseline do tabuleiro + capturas dos modais de casa.
 * Requer npm run dev. Uso: node scripts/verify-tile-modals.mjs
 */
import { spawn } from 'node:child_process'
import { existsSync } from 'node:fs'
import { mkdir, writeFile } from 'node:fs/promises'
import { createConnection } from 'node:net'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..')
const APP_URL = 'http://127.0.0.1:5173/'
const PORT = Number(process.env.SG_TILE_CDP_PORT || 9351)
const OUT = path.join(process.env.TEMP || ROOT, 'sg-board-visual', 'tile-modals')
const CHROME = [
  process.env.CHROME_PATH,
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
].filter(Boolean).find((candidate) => existsSync(candidate))

const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

async function portOpen(port) {
  return new Promise((resolve) => {
    const socket = createConnection({ host: '127.0.0.1', port }, () => {
      socket.end()
      resolve(true)
    })
    socket.on('error', () => resolve(false))
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
    `--user-data-dir=${path.join(process.env.TEMP || OUT, 'sg-tile-modal-chrome')}`,
    'about:blank',
  ], { detached: true, stdio: 'ignore' })
  child.unref()
  for (let i = 0; i < 40; i += 1) {
    if (await portOpen(PORT)) return
    await wait(250)
  }
  throw new Error('CDP port did not open')
}

async function cdp(ws, method, params = {}) {
  const id = cdp.nextId = (cdp.nextId || 0) + 1
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(method)), 20000)
    const onMessage = (event) => {
      const msg = JSON.parse(event.data.toString())
      if (msg.id === id) {
        clearTimeout(timer)
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
    const timer = setTimeout(() => reject(new Error(method)), 20000)
    const onMessage = (event) => {
      const msg = JSON.parse(event.data.toString())
      if (msg.method !== 'Target.receivedMessageFromTarget') return
      if (msg.params.sessionId !== sessionId) return
      const inner = JSON.parse(msg.params.message)
      if (inner.id !== id) return
      clearTimeout(timer)
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
  if (result.exceptionDetails) {
    throw new Error(result.exceptionDetails.exception?.description || 'eval')
  }
  return result.result?.value
}

async function waitFor(ws, sessionId, expression, timeoutMs = 15000) {
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
    return { w: +r.width.toFixed(1), h: +r.height.toFixed(1), t: +r.top.toFixed(1), l: +r.left.toFixed(1) }
  }
  const cs = (el, prop) => el ? getComputedStyle(el)[prop] : null
  const board = document.querySelector('.sg40GameBoard')
  const wrap = document.querySelector('.boardWrap')
  const modal = document.querySelector('.tileModal')
  return {
    vp: [innerWidth, innerHeight],
    wrap: box(wrap),
    board: box(board),
    modal: box(modal),
    modalColor: modal ? cs(modal, 'color') : null,
    modalBg: modal ? cs(modal, 'backgroundColor') : null,
    modalTitle: document.querySelector('.tileModalTitle')?.textContent || null,
    confirmBtn: (() => {
      const btn = document.querySelector('.tileModalBtn--confirm')
      if (!btn) return null
      return {
        text: btn.textContent.trim(),
        bg: cs(btn, 'backgroundColor'),
        color: cs(btn, 'color'),
        disabled: btn.disabled,
      }
    })(),
  }
})()`

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
    width, height, deviceScaleFactor: mobile ? 2 : 1, mobile,
    screenWidth: width, screenHeight: height,
  })
}

async function shot(name) {
  await sessionCall(ws, sessionId, 'Input.dispatchMouseEvent', {
    type: 'mouseMoved', x: 2, y: 2,
  }).catch(() => {})
  await wait(60)
  const png = await sessionCall(ws, sessionId, 'Page.captureScreenshot', {
    format: 'png', fromSurface: true,
  })
  await writeFile(path.join(OUT, `${name}.png`), Buffer.from(png.data, 'base64'))
}

await setVp(1366, 768, false)
await sessionCall(ws, sessionId, 'Page.navigate', { url: APP_URL })
await wait(800)
await waitFor(ws, sessionId, `!!document.querySelector('.startBtn--local')`)
await evaluate(ws, sessionId, `document.querySelector('.startBtn--local').click(); true`)
await waitFor(ws, sessionId, `!!document.querySelector('#localPlayerName-0')`)
await evaluate(ws, sessionId, `
  const buttons = [...document.querySelectorAll('.localSetupOptions button')]
  buttons.find((btn) => btn.textContent.includes('2'))?.click()
  const nativeSet = (el, value) => {
    const desc = Object.getOwnPropertyDescriptor(Object.getPrototypeOf(el), 'value')
    desc.set.call(el, value)
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
await wait(400)

const boardReport = []
for (const [width, height, mobile] of [
  [1366, 768, false],
  [1600, 900, false],
  [844, 390, true],
  [667, 375, true],
  [740, 360, true],
  [844, 320, true],
  [932, 430, true],
]) {
  await setVp(width, height, mobile)
  await wait(350)
  const measured = await evaluate(ws, sessionId, MEASURE)
  await shot(`board-${width}x${height}`)
  boardReport.push({ width, height, ...measured })
  console.log('board', JSON.stringify({
    width, height, wrap: measured.wrap, board: measured.board,
  }))
}

await writeFile(path.join(OUT, 'board-baseline.json'), JSON.stringify(boardReport, null, 2))

const modalKinds = [
  ['FIELD', 'field-desktop', 1366, 768, false],
  ['FIELD', 'field-mobile', 844, 390, true],
  ['FIELD', 'field-short', 844, 320, true],
  ['INSIDE', 'inside-desktop', 1366, 768, false],
  ['COMMON', 'common-desktop', 1366, 768, false],
  ['MANAGER', 'manager-desktop', 1366, 768, false],
  ['CLIENTS', 'clients-desktop', 1366, 768, false],
  ['ERP', 'erp-desktop', 1366, 768, false],
  ['MIX', 'mix-desktop', 1366, 768, false],
  ['TRAINING', 'training-desktop', 1366, 768, false],
  ['DIRECT', 'direct-desktop', 1366, 768, false],
  ['LUCK', 'luck-desktop', 1366, 768, false],
  ['REVENUE', 'revenue-desktop', 1366, 768, false],
  ['EXPENSES', 'expenses-desktop', 1366, 768, false],
  ['FUNDS', 'funds-desktop', 1366, 768, false],
  ['RECOVERY', 'recovery-desktop', 1366, 768, false],
  ['BANKRUPT', 'bankrupt-desktop', 1366, 768, false],
  ['CONFIRM', 'confirm-desktop', 1366, 768, false],
  ['FIELD', 'field-mobile-667', 667, 375, true],
  ['LUCK', 'luck-mobile', 844, 390, true],
  ['REVENUE', 'revenue-mobile', 844, 390, true],
  ['TRAINING', 'training-mobile-short', 844, 320, true],
]

const modalReport = []
for (const [kind, name, width, height, mobile] of modalKinds) {
  await setVp(width, height, mobile)
  await wait(200)
  await evaluate(ws, sessionId, `
    import('/src/modals/tileModalPreviewMount.js').then((m) => {
      window.__sgMountTile = m.mountTileModalPreview
      window.__sgUnmountTile = m.unmountTileModalPreview
      return true
    })
  `).catch(() => null)
  // Vite dynamic import via script tag injection
  await evaluate(ws, sessionId, `
    (async () => {
      if (!window.__sgMountTile) {
        const mod = await import('/src/modals/tileModalPreviewMount.js')
        window.__sgMountTile = mod.mountTileModalPreview
        window.__sgUnmountTile = mod.unmountTileModalPreview
      }
      window.__sgUnmountTile?.()
      window.__sgMountTile(${JSON.stringify(kind)})
      return true
    })()
  `)
  await waitFor(ws, sessionId, `!!document.querySelector('.tileModal')`, 8000)
  if (kind === 'FIELD') {
    await evaluate(ws, sessionId, `
      (() => {
        const qtyInput = document.querySelector('.tileModal input[type="number"]')
        if (qtyInput) {
          const desc = Object.getOwnPropertyDescriptor(Object.getPrototypeOf(qtyInput), 'value')
          desc.set.call(qtyInput, '1')
          qtyInput.dispatchEvent(new Event('input', { bubbles: true }))
          qtyInput.dispatchEvent(new Event('change', { bubbles: true }))
        }
        return true
      })()
    `)
    await wait(200)
  }
  const measured = await evaluate(ws, sessionId, MEASURE)
  await shot(name)
  modalReport.push({ kind, name, width, height, ...measured })
  console.log('modal', JSON.stringify({
    kind, name, modal: measured.modal, modalColor: measured.modalColor,
    modalBg: measured.modalBg, title: measured.modalTitle, confirm: measured.confirmBtn,
    board: measured.board,
  }))
  await evaluate(ws, sessionId, `window.__sgUnmountTile?.(); true`)
  await wait(150)
}

// scroll longo: Field em altura baixa — capturar fim do conteúdo
await setVp(844, 320, true)
await evaluate(ws, sessionId, `
  (async () => {
    if (!window.__sgMountTile) {
      const mod = await import('/src/modals/tileModalPreviewMount.js')
      window.__sgMountTile = mod.mountTileModalPreview
      window.__sgUnmountTile = mod.unmountTileModalPreview
    }
    window.__sgUnmountTile?.()
    window.__sgMountTile('FIELD')
    return true
  })()
`)
await waitFor(ws, sessionId, `!!document.querySelector('.tileModal')`)
await evaluate(ws, sessionId, `
  (() => {
    const qtyInput = document.querySelector('.tileModal input[type="number"]')
    if (qtyInput) {
      const desc = Object.getOwnPropertyDescriptor(Object.getPrototypeOf(qtyInput), 'value')
      desc.set.call(qtyInput, '2')
      qtyInput.dispatchEvent(new Event('input', { bubbles: true }))
    }
    const body = document.querySelector('.tileModalBody')
    if (body) body.scrollTop = body.scrollHeight
    return true
  })()
`)
await wait(250)
await shot('field-short-scrolled-footer')
console.log('scrolled', JSON.stringify(await evaluate(ws, sessionId, MEASURE)))

await writeFile(path.join(OUT, 'modals-report.json'), JSON.stringify(modalReport, null, 2))
console.log('OUT', OUT)
ws.close()
