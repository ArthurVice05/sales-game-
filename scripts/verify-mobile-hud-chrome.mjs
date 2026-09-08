/**
 * Verifica chrome HUD mobile (Resumo/Mais/Rolar) vs painel antigo.
 * Emulado via CDP — não substitui medição em aparelho físico.
 * Requer npm run dev em :5173.
 *
 * Uso: node scripts/verify-mobile-hud-chrome.mjs
 */
import { spawn } from 'node:child_process'
import { existsSync } from 'node:fs'
import { mkdir, writeFile } from 'node:fs/promises'
import { createConnection } from 'node:net'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..')
const APP_URL = 'http://127.0.0.1:5173/'
const PORT = Number(process.env.SG_HUD_CHROME_CDP_PORT || 9351)
const OUT = path.join(process.env.TEMP || ROOT, 'sg-board-visual', 'hud-chrome-gap')
const CHROME = [
  process.env.CHROME_PATH,
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
].filter(Boolean).find((candidate) => existsSync(candidate))

const VIEWPORTS = [
  [844, 320, true],
  [844, 390, true],
  [932, 430, true],
  [980, 480, true],
  [1024, 480, true],
  [1080, 540, true],
  [1199, 600, true],
  [1366, 768, false],
  [1600, 900, false],
]

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
    `--user-data-dir=${path.join(process.env.TEMP || OUT, 'sg-hud-chrome-cdp')}`,
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

async function waitFor(ws, sessionId, expression, timeoutMs = 20000) {
  const started = Date.now()
  while (Date.now() - started < timeoutMs) {
    if (await evaluate(ws, sessionId, expression)) return
    await wait(250)
  }
  throw new Error('wait ' + expression)
}

const PROBE = `(() => {
  const vis = (el) => {
    if (!el) return false
    const r = el.getBoundingClientRect()
    const s = getComputedStyle(el)
    return s.display !== 'none' && s.visibility !== 'hidden' && r.width > 2 && r.height > 2
  }
  const page = document.querySelector('.page[data-game-shell]')
  const inlineHud = document.querySelector('.side > .hud.hud--inline, .hud.hud--inline')
  const quick = document.querySelector('.sideQuickActions')
  const resumo = document.querySelector('.compactActionRow .hudOpenBtn')
  const mais = document.querySelector('.compactActionRow .moreOpenBtn')
  const roll = document.querySelector('.turnPrimaryActions .btn.go')
  const peek = document.querySelector('.hudCompactPeek')
  const desktopSide = document.querySelector('.hudDesktopSidebar, .hudDesktop')
  const mqCompact = window.matchMedia('(max-width: 1199px) and (orientation: landscape)').matches
  const mqDesktop = window.matchMedia('(min-width: 1200px)').matches
  const mqOldGap = window.matchMedia('(max-width: 1199px) and (orientation: landscape) and (max-height: 450px)').matches
  return {
    source: 'emulated',
    innerWidth,
    innerHeight,
    devicePixelRatio,
    visualViewport: visualViewport ? {
      width: visualViewport.width,
      height: visualViewport.height,
      scale: visualViewport.scale,
      offsetLeft: visualViewport.offsetLeft,
      offsetTop: visualViewport.offsetTop,
    } : null,
    hudMode: page?.getAttribute('data-hud-mode') || null,
    mqCompact,
    mqDesktop,
    mqOldGap,
    visible: {
      inlineHud: vis(inlineHud),
      sideQuickActions: vis(quick),
      resumo: vis(resumo),
      mais: vis(mais),
      roll: vis(roll),
      peek: vis(peek),
      desktopSide: vis(desktopSide),
    },
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

const rows = []
const failures = []
for (const [width, height, mobile] of VIEWPORTS) {
  await setVp(width, height, mobile)
  await wait(350)
  const probe = await evaluate(ws, sessionId, PROBE)
  const name = `${width}x${height}`
  await shot(`after-${name}`)
  const expectMobile = width < 1200 && width > height
  const expectDesktop = width >= 1200
  let ok = true
  const reasons = []
  if (expectMobile) {
    if (probe.hudMode !== 'mobile-landscape') { ok = false; reasons.push(`mode=${probe.hudMode}`) }
    if (!probe.visible.resumo) { ok = false; reasons.push('resumo missing') }
    if (!probe.visible.mais) { ok = false; reasons.push('mais missing') }
    if (!probe.visible.roll) { ok = false; reasons.push('roll missing') }
    if (probe.visible.inlineHud) { ok = false; reasons.push('old inline HUD visible') }
    if (probe.visible.sideQuickActions) { ok = false; reasons.push('expanded quick actions') }
  }
  if (expectDesktop) {
    if (probe.hudMode !== 'desktop') { ok = false; reasons.push(`mode=${probe.hudMode}`) }
    if (probe.visible.resumo || probe.visible.mais) { ok = false; reasons.push('mobile chrome on desktop') }
  }
  rows.push({ name, ok, reasons, probe })
  if (!ok) failures.push({ name, reasons, probe })
  console.log(`${ok ? 'OK' : 'FAIL'} ${name}`, JSON.stringify({
    mode: probe.hudMode,
    visible: probe.visible,
    mq: { compact: probe.mqCompact, desktop: probe.mqDesktop, oldGap: probe.mqOldGap },
  }))
}

await writeFile(path.join(OUT, 'report.json'), JSON.stringify({ source: 'emulated', rows }, null, 2))
ws.close()
if (failures.length) {
  console.error('FAILURES', failures.length)
  process.exit(1)
}
console.log('ARTIFACTS', OUT)
console.log('ALL_OK', rows.length)
