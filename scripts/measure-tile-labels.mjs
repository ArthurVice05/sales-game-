/**
 * Mede tinta dos nomes das 40 casas vs a caixa da casa (Chrome CDP).
 * Uso: node scripts/measure-tile-labels.mjs
 */
import { spawn } from 'node:child_process'
import { existsSync } from 'node:fs'
import { mkdir, writeFile } from 'node:fs/promises'
import { createConnection } from 'node:net'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..')
const APP_URL = 'http://127.0.0.1:5173/'
const PORT = Number(process.env.SG_TILE_CDP_PORT || 9346)
const OUT = path.join(process.env.TEMP || ROOT, 'sg-board-visual', 'tile-labels')
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
    `--user-data-dir=${path.join(process.env.TEMP || OUT, 'sg-tile-label-chrome-repo')}`,
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
  const board = document.querySelector('.sg40GameBoard')
  const tiles = [...document.querySelectorAll('.sg40Preview__tile')]
  const wrap = document.querySelector('.boardWrap')
  const track = document.querySelector('.sg40Preview__track')
  const tokens = document.querySelector('.sg40GameBoard__tokens')
  const wr = wrap?.getBoundingClientRect()
  const trk = track?.getBoundingClientRect()
  const tk = tokens?.getBoundingClientRect()
  const br = board.getBoundingClientRect()
  const label0 = getComputedStyle(tiles[0].querySelector('.sg40Preview__tileLabel'))
  const rows = tiles.map((tile) => {
    const r = tile.getBoundingClientRect()
    const label = tile.querySelector('.sg40Preview__tileLabel')
    const icon = tile.querySelector('.sg40Preview__tileIconFrame')
    const lr = label.getBoundingClientRect()
    const lines = [...tile.querySelectorAll('.sg40Preview__tileLabelLine')].map((line) => {
      const range = document.createRange()
      range.selectNodeContents(line)
      const tr = range.getBoundingClientRect()
      const pad = 0.6
      return {
        text: line.textContent,
        font: +getComputedStyle(line).fontSize.replace('px', ''),
        whiteSpace: getComputedStyle(line).whiteSpace,
        textW: +tr.width.toFixed(2),
        textH: +tr.height.toFixed(2),
        cutX: tr.right > r.right - pad || tr.left < r.left + pad,
        cutY: tr.bottom > r.bottom - pad || tr.top < r.top + pad,
      }
    })
    return {
      n: tile.getAttribute('data-tile-number'),
      type: tile.getAttribute('data-tile-type'),
      tw: +r.width.toFixed(2),
      th: +r.height.toFixed(2),
      icon: +icon.getBoundingClientRect().height.toFixed(1),
      labelH: +lr.height.toFixed(2),
      tsa: label0.webkitTextSizeAdjust || label0.textSizeAdjust,
      fontFamily: label0.fontFamily.split(',')[0],
      cut: lines.some((line) => line.cutX || line.cutY),
      lines,
    }
  })
  const fonts = rows.flatMap((row) => row.lines.map((line) => line.font))
  return {
    vp: [innerWidth, innerHeight],
    board: { w: +br.width.toFixed(1), h: +br.height.toFixed(1) },
    wrap: wr ? { w: +wr.width.toFixed(1), h: +wr.height.toFixed(1) } : null,
    track: trk ? { w: +trk.width.toFixed(1), h: +trk.height.toFixed(1) } : null,
    tokens: tk ? { w: +tk.width.toFixed(1), h: +tk.height.toFixed(1) } : null,
    sideGap: wr ? +(wr.width - br.width).toFixed(1) : null,
    tsa: label0.webkitTextSizeAdjust || label0.textSizeAdjust,
    fontFamily: label0.fontFamily,
    cutCount: rows.filter((row) => row.cut).length,
    minFont: Math.min(...fonts),
    maxFont: Math.max(...fonts),
    cuts: rows.filter((row) => row.cut).map((row) => ({
      n: row.n, type: row.type, tw: row.tw, th: row.th,
      lines: row.lines.filter((line) => line.cutX || line.cutY),
    })),
    expenses: rows.find((row) => row.type === 'EXPENSES'),
    training: rows.find((row) => row.type === 'TRAINING'),
    inside: rows.find((row) => row.type === 'INSIDE'),
    start: rows.find((row) => row.type === 'START_REVENUE'),
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

await setVp(844, 390, true)
await sessionCall(ws, sessionId, 'Page.navigate', { url: APP_URL })
await wait(800)
await waitFor(ws, sessionId, `!!document.querySelector('.startBtn--local')`)
await evaluate(ws, sessionId, `document.querySelector('.startBtn--local').click(); true`)
await waitFor(ws, sessionId, `!!document.querySelector('#localPlayerName-0')`)
await evaluate(ws, sessionId, `
  const buttons = [...document.querySelectorAll('.localSetupOptions button')]
  buttons.find((btn) => btn.textContent.includes('4'))?.click()
  const nativeSet = (el, value) => {
    const desc = Object.getOwnPropertyDescriptor(Object.getPrototypeOf(el), 'value')
    desc.set.call(el, value)
    el.dispatchEvent(new Event('input', { bubbles: true }))
  }
  nativeSet(document.querySelector('#localPlayerName-0'), 'Ana')
  nativeSet(document.querySelector('#localPlayerName-1'), 'Beto')
  nativeSet(document.querySelector('#localPlayerName-2'), 'Cris')
  nativeSet(document.querySelector('#localPlayerName-3'), 'Dani')
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
]

for (const [width, height, mobile] of viewports) {
  await setVp(width, height, mobile)
  await wait(450)
  const measured = await evaluate(ws, sessionId, MEASURE)
  const shot = await sessionCall(ws, sessionId, 'Page.captureScreenshot', {
    format: 'png', fromSurface: true,
  })
  await writeFile(path.join(OUT, `${width}x${height}-after.png`), Buffer.from(shot.data, 'base64'))
  const compact = (row) => row?.lines?.map((line) => `${line.text}:${line.font.toFixed(2)} ${line.textW} x${line.cutX} y${line.cutY}`).join(' | ')
  console.log(`===${width}x${height} cuts=${measured.cutCount} fonts=${measured.minFont}-${measured.maxFont} wrap=${JSON.stringify(measured.wrap)} board=${JSON.stringify(measured.board)} sideGap=${measured.sideGap} track=${JSON.stringify(measured.track)} tokens=${JSON.stringify(measured.tokens)} tsa=${measured.tsa}`)
  if (measured.cuts.length) console.log('cuts', JSON.stringify(measured.cuts))
  console.log('start', measured.start?.tw, measured.start?.icon, compact(measured.start))
  console.log('expenses', measured.expenses?.tw, measured.expenses?.icon, measured.expenses?.labelH, compact(measured.expenses))
  console.log('training', measured.training?.tw, compact(measured.training))
  console.log('inside', measured.inside?.tw, compact(measured.inside))
}

await setVp(844, 390, true)
await wait(300)
const tile25 = await evaluate(ws, sessionId, `
  (() => {
    const tile = document.querySelector('.sg40Preview__tile[data-tile-number="25"]')
    tile.click()
    const hint = document.querySelector('.sg40GameBoard__hint')?.innerText || ''
    const rect = tile.getBoundingClientRect()
    return { hint, x: rect.x, y: rect.y, w: rect.width, h: rect.height }
  })()
`)
console.log('select25', tile25.hint.slice(0, 120))
const zoom = await sessionCall(ws, sessionId, 'Page.captureScreenshot', {
  format: 'png', fromSurface: true,
  clip: { x: tile25.x - 4, y: tile25.y - 4, width: tile25.w + 8, height: tile25.h + 8, scale: 4 },
})
await writeFile(path.join(OUT, 'tile-25-zoom.png'), Buffer.from(zoom.data, 'base64'))
await evaluate(ws, sessionId, `document.querySelector('.boardModeBtn')?.click(); true`)
await wait(400)
const expanded = await evaluate(ws, sessionId, `
  (() => {
    const tile = document.querySelector('.sg40Preview__tile[data-tile-number="25"]')
    const btn = document.querySelector('.boardModeBtn')?.textContent
    const range = document.createRange()
    const line = [...tile.querySelectorAll('.sg40Preview__tileLabelLine')].find((el) => el.textContent.includes('OPERACIONAIS'))
    range.selectNodeContents(line)
    const tr = range.getBoundingClientRect()
    const r = tile.getBoundingClientRect()
    return {
      btn,
      tw: +r.width.toFixed(1),
      th: +r.height.toFixed(1),
      font: getComputedStyle(line).fontSize,
      textW: +tr.width.toFixed(2),
      cutX: tr.right > r.right - 0.6,
      cutY: tr.bottom > r.bottom - 0.6,
    }
  })()
`)
console.log('expand25', JSON.stringify(expanded))
const expandShot = await sessionCall(ws, sessionId, 'Page.captureScreenshot', {
  format: 'png', fromSurface: true,
})
await writeFile(path.join(OUT, '844x390-expand.png'), Buffer.from(expandShot.data, 'base64'))
await evaluate(ws, sessionId, `document.querySelector('.boardModeBtn')?.click(); true`)
await wait(300)
const back = await evaluate(ws, sessionId, `document.querySelector('.boardModeBtn')?.textContent`)
console.log('back', back)

ws.close()
