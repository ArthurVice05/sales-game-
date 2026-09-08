/**
 * Capturas Treinamento/ERP + peões desktop.
 * Uso: node scripts/capture-training-erp-tokens.mjs
 */
import { spawn } from 'node:child_process'
import { existsSync } from 'node:fs'
import { mkdir, writeFile } from 'node:fs/promises'
import { createConnection } from 'node:net'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..')
const APP_URL = 'http://127.0.0.1:5173/'
const PORT = Number(process.env.SG_TRAIN_ERP_CDP || 9366)
const OUT = path.join(process.env.TEMP || ROOT, 'sg-board-visual', 'training-erp-tokens')
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
    `--user-data-dir=${path.join(process.env.TEMP || OUT, 'sg-train-erp-chrome')}`,
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
  await wait(140)
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
  await waitFor(ws, sessionId, `!!document.querySelector('.tileModal')`)
}

const MEASURE_TOKENS = `(() => {
  const tokens = [...document.querySelectorAll('.sg40GameBoard__token')]
  const faces = [...document.querySelectorAll('.sg40GameBoard__tokenFace')]
  const box = (el) => {
    const r = el.getBoundingClientRect()
    return { w: +r.width.toFixed(2), h: +r.height.toFixed(2) }
  }
  return {
    vp: [innerWidth, innerHeight],
    count: tokens.length,
    token: tokens[0] ? box(tokens[0]) : null,
    face: faces[0] ? box(faces[0]) : null,
    active: !!document.querySelector('.sg40GameBoard__token.token--active'),
  }
})()`

await setVp(1366, 768, false)
await sessionCall(ws, sessionId, 'Page.navigate', { url: APP_URL })
await wait(800)
await waitFor(ws, sessionId, `!!document.querySelector('.startBtn--local')`)
await evaluate(ws, sessionId, `document.querySelector('.startBtn--local').click(); true`)
await waitFor(ws, sessionId, `!!document.querySelector('#localPlayerName-0')`)
await evaluate(ws, sessionId, `(() => {
  [...document.querySelectorAll('.localSetupOptions button')].find((b) => b.textContent.includes('4'))?.click()
  const nativeSet = (el, value) => {
    const d = Object.getOwnPropertyDescriptor(Object.getPrototypeOf(el), 'value')
    d.set.call(el, value)
    el.dispatchEvent(new Event('input', { bubbles: true }))
  }
  ;['Arthur','Beto','Carla','Duda'].forEach((name, i) => {
    const el = document.querySelector('#localPlayerName-' + i)
    if (el) nativeSet(el, name)
  })
  document.querySelector('.localSetupStart').click()
  return true
})()`)
await waitFor(ws, sessionId, `!!document.querySelector('.sg40GameBoard')`, 25000)
await waitFor(ws, sessionId, `!!document.querySelector('.localHandoffButton:not(:disabled)')`, 25000)
await evaluate(ws, sessionId, `document.querySelector('.localHandoffButton:not(:disabled)')?.click(); true`)
await waitFor(ws, sessionId, `!document.querySelector('.localHandoff')`, 8000)
await evaluate(ws, sessionId, `document.querySelector('.tutorialBtnGhost, .tutorialCloseX')?.click(); true`)
await wait(500)

const report = { tokens: [], modals: [] }

for (const [w, h, mobile, label] of [
  [1366, 768, false, '1366x768'],
  [1600, 900, false, '1600x900'],
  [1920, 1080, false, '1920x1080'],
  [844, 390, true, '844x390'],
  [844, 320, true, '844x320'],
]) {
  await setVp(w, h, mobile)
  await wait(300)
  const metrics = await evaluate(ws, sessionId, MEASURE_TOKENS)
  report.tokens.push({ label, ...metrics })
  await shot(`tokens-${label}`)
}

await setVp(1366, 768, false)
await wait(250)
await mount('TRAINING', {
  allowBack: true,
  canTrain: { comum: 1, field: 1, inside: 1, gestor: 1 },
  ownedByType: { comum: ['personalizado'], field: [], inside: [], gestor: [] },
})
await shot('training-desktop')
report.modals.push({ kind: 'TRAINING', vp: '1366x768', title: await evaluate(ws, sessionId, `document.querySelector('.tileModalTitle')?.textContent`) })

await setVp(844, 390, true)
await wait(200)
await mount('TRAINING', {
  allowBack: true,
  canTrain: { comum: 1, field: 1 },
  ownedByType: { comum: [], field: [] },
})
await shot('training-mobile-844x390')

await setVp(1366, 768, false)
await wait(200)
await mount('ERP', { currentLevel: 'D', currentCash: 18000 })
await evaluate(ws, sessionId, `(() => {
  const btn = [...document.querySelectorAll('.erpLevelCard button')].find((b) => /Selecionar B/i.test(b.textContent || ''))
  btn?.click()
  return !!btn
})()`)
await wait(200)
await shot('erp-desktop-selected-B')

await setVp(844, 390, true)
await wait(200)
await mount('ERP', { currentLevel: 'D', currentCash: 18000 })
await shot('erp-mobile-844x390')

await setVp(844, 320, true)
await wait(200)
await mount('TRAINING', { canTrain: { comum: 1 }, ownedByType: { comum: [] } })
await shot('training-mobile-844x320')
await evaluate(ws, sessionId, `window.__sgUnmountTile?.(); true`)

await writeFile(path.join(OUT, 'report.json'), JSON.stringify(report, null, 2))
console.log(JSON.stringify(report.tokens, null, 2))
console.log('OUT', OUT)
ws.close()
