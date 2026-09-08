/**
 * Mede board + HUD após o refinamento. Requer npm run dev.
 * Uso: node scripts/verify-hud-refinement.mjs
 */
import { spawn } from 'node:child_process'
import { existsSync } from 'node:fs'
import { mkdir, writeFile } from 'node:fs/promises'
import { createConnection } from 'node:net'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..')
const APP_URL = 'http://127.0.0.1:5173/'
const PORT = Number(process.env.SG_HUD_CDP_PORT || 9347)
const OUT = path.join(process.env.TEMP || ROOT, 'sg-board-visual', 'hud-refine')
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
    `--user-data-dir=${path.join(process.env.TEMP || OUT, 'sg-hud-refine-chrome')}`,
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
  const usedFace = (el) => {
    if (!el) return null
    const style = getComputedStyle(el)
    const specified = style.fontFamily
    const size = style.fontSize
    const sample = 'Hamburgefonstiv 1234'
    const ctx = document.createElement('canvas').getContext('2d')
    ctx.font = size + ' ' + specified
    const actual = ctx.measureText(sample).width
    const candidates = ['Inter', 'Segoe UI', 'Arial', 'Helvetica', 'system-ui', 'Times New Roman', 'serif', 'sans-serif']
    let used = 'unknown'
    let best = Infinity
    for (const name of candidates) {
      ctx.font = size + ' "' + name + '"'
      const delta = Math.abs(actual - ctx.measureText(sample).width)
      if (delta < best) {
        best = delta
        used = name
      }
    }
    return {
      specified,
      used,
      delta: +best.toFixed(3),
      interCheck: document.fonts.check(size + ' Inter'),
    }
  }
  const board = document.querySelector('.sg40GameBoard')
  const wrap = document.querySelector('.boardWrap')
  const header = document.querySelector('.gameDesktopHeader, .topbar')
  const side = document.querySelector('.side')
  const tile = document.querySelector('.sg40Preview__tileLabel')
  const hint = document.querySelector('.sg40GameBoard__hint')
  const nextStep = document.querySelector('.nextStepHint')
  const roll = document.querySelector('.turnPrimaryActions .btn.go')
  const peekEl = document.querySelector('.hudCompactPeek')
  const rgbLum = (value) => {
    const m = String(value || '').match(/rgba?\\((\\d+),\\s*(\\d+),\\s*(\\d+)/)
    if (!m) return null
    return (0.2126 * m[1] + 0.7152 * m[2] + 0.0722 * m[3]) / 255
  }
  const targets = {
    body: document.body,
    page: document.querySelector('.page'),
    header,
    metricLabel: document.querySelector('.hudMetricCardLabel'),
    metricValue: document.querySelector('.hudMetricCardValue'),
    cardTitle: document.querySelector('.hudCardTitle'),
    tab: document.querySelector('.hudDesktopTab'),
    nextStep,
    roll,
    topbarName: document.querySelector('.topbarName, .gdhPlayerName'),
    tile,
    hint,
  }
  const br = board?.getBoundingClientRect()
  const wr = wrap?.getBoundingClientRect()
  const boardCss = board ? {
    width: cs(board, 'width'),
    height: cs(board, 'height'),
    maxHeight: cs(board, 'maxHeight'),
    aspectRatio: cs(board, 'aspectRatio'),
  } : null
  const ratio = br && br.height ? +(br.width / br.height).toFixed(4) : null
  return {
    vp: [innerWidth, innerHeight],
    zoom: document.body.style.zoom || cs(document.body, 'zoom'),
    wrap: box(wrap),
    board: box(board),
    header: box(header),
    side: box(side),
    sideGap: wr && br ? +(wr.width - br.width).toFixed(1) : null,
    ratio,
    contain13x9: br ? {
      fromHeight: { w: +(br.height * 13 / 9).toFixed(1), h: +br.height.toFixed(1) },
      fromWidth: { w: +br.width.toFixed(1), h: +(br.width * 9 / 13).toFixed(1) },
      official: 13 / 9,
    } : null,
    boardCss,
    fonts: Object.fromEntries(Object.entries(targets).map(([key, el]) => [key, usedFace(el)])),
    rollH: roll ? +roll.getBoundingClientRect().height.toFixed(1) : null,
    hintColors: nextStep ? {
      color: cs(nextStep, 'color'),
      background: cs(nextStep, 'backgroundColor'),
      colorLum: rgbLum(cs(nextStep, 'color')),
      bgLum: rgbLum(cs(nextStep, 'backgroundColor')),
    } : null,
    rollColors: roll ? {
      color: cs(roll, 'color'),
      background: cs(roll, 'backgroundColor'),
      border: cs(roll, 'borderTopColor'),
      opacity: cs(roll, 'opacity'),
      disabled: roll.disabled,
      colorLum: rgbLum(cs(roll, 'color')),
      bgLum: rgbLum(cs(roll, 'backgroundColor')),
    } : null,
    peek: !!peekEl && cs(peekEl, 'display') !== 'none',
    peekBox: box(peekEl),
    peekText: peekEl?.innerText?.slice(0, 180) || null,
    sheet: !!document.querySelector('.hudSheet'),
    more: !!document.querySelector('.moreSheet'),
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
  await wait(80)
  const png = await sessionCall(ws, sessionId, 'Page.captureScreenshot', {
    format: 'png', fromSurface: true,
  })
  await writeFile(path.join(OUT, `${name}.png`), Buffer.from(png.data, 'base64'))
}

await setVp(844, 390, true)
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

const viewports = [
  [667, 375, true],
  [740, 360, true],
  [844, 390, true],
  [844, 320, true],
  [932, 430, true],
  [1366, 768, false],
  [1600, 900, false],
  [1920, 1080, false],
]

const report = []
for (const [width, height, mobile] of viewports) {
  await setVp(width, height, mobile)
  await wait(450)
  const measured = await evaluate(ws, sessionId, MEASURE)
  await shot(`${width}x${height}`)
  report.push({ width, height, ...measured })
  console.log(JSON.stringify({
    width, height, wrap: measured.wrap, board: measured.board, sideGap: measured.sideGap,
    ratio: measured.ratio, peek: measured.peek, peekBox: measured.peekBox, rollH: measured.rollH,
    hintColors: measured.hintColors, rollColors: measured.rollColors,
  }))
}

await setVp(844, 390, true)
await wait(300)
await evaluate(ws, sessionId, `document.querySelector('.hudOpenBtn')?.click(); true`)
await wait(400)
console.log('resumo', JSON.stringify(await evaluate(ws, sessionId, MEASURE)))
await shot('844x390-resumo')
await evaluate(ws, sessionId, `document.querySelector('.hudSheetClose')?.click(); true`)
await wait(300)
await evaluate(ws, sessionId, `document.querySelector('.moreOpenBtn')?.click(); true`)
await wait(400)
console.log('mais', JSON.stringify(await evaluate(ws, sessionId, MEASURE)))
await shot('844x390-mais')
await evaluate(ws, sessionId, `document.querySelector('.moreSheet button:last-child')?.click(); true`)
await wait(200)

await evaluate(ws, sessionId, `document.querySelector('.turnPrimaryActions .btn.go:not([disabled])')?.click(); true`)
await wait(2800)
console.log('rolled-mobile', JSON.stringify(await evaluate(ws, sessionId, MEASURE)))
await shot('844x390-rolled')

await setVp(1366, 768, false)
await wait(400)
await evaluate(ws, sessionId, `
  document.querySelector('#hud-tab-comercial')?.click();
  true
`)
await wait(200)
await shot('1366x768-comercial')
await evaluate(ws, sessionId, `document.querySelector('#hud-tab-ranking')?.click(); true`)
await wait(200)
await shot('1366x768-ranking')

await writeFile(path.join(OUT, 'report.json'), JSON.stringify(report, null, 2))
console.log('OUT', OUT)
ws.close()
