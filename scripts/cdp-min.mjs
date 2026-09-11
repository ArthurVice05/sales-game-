/**
 * CDP mínimo (Chrome/Edge) — sem dependências npm e sem multiplayer-load.
 * Uso: scripts de verificação locais.
 */
import { spawn } from 'node:child_process'
import { existsSync } from 'node:fs'
import { mkdir } from 'node:fs/promises'
import { resolve } from 'node:path'
import { createConnection } from 'node:net'

const BROWSER_CANDIDATES = [
  process.env.CHROME_PATH,
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
  'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
].filter(Boolean)

export const pause = (ms) => new Promise((r) => setTimeout(r, ms))

async function retry(operation, timeout = 20_000, interval = 150) {
  const deadline = Date.now() + timeout
  let lastError
  while (Date.now() < deadline) {
    try {
      return await operation()
    } catch (error) {
      lastError = error
      await pause(interval)
    }
  }
  throw lastError || new Error('Operation timed out')
}

function portOpen(port) {
  return new Promise((resolvePort) => {
    const socket = createConnection({ host: '127.0.0.1', port }, () => {
      socket.end()
      resolvePort(true)
    })
    socket.on('error', () => resolvePort(false))
  })
}

function resolveBrowserPath() {
  const found = BROWSER_CANDIDATES.find((c) => existsSync(c))
  if (!found) {
    throw new Error('Nenhum Chrome/Edge encontrado. Defina CHROME_PATH.')
  }
  return found
}

class CdpConnection {
  constructor(webSocketUrl) {
    this.nextId = 1
    this.pending = new Map()
    this._sessionHandlers = new Map()
    this.closed = false
    this.socket = new WebSocket(webSocketUrl)
  }

  async connect() {
    await new Promise((resolveOpen, rejectOpen) => {
      this.socket.addEventListener('open', resolveOpen, { once: true })
      this.socket.addEventListener('error', rejectOpen, { once: true })
      this.socket.addEventListener('message', (event) => this._onMessage(event))
      this.socket.addEventListener('close', () => {
        this.closed = true
        for (const [, pending] of this.pending) pending.reject(new Error('CDP closed'))
        this.pending.clear()
      })
    })
  }

  _onMessage(event) {
    const message = JSON.parse(typeof event.data === 'string' ? event.data : event.data.toString())
    if (message.id) {
      const pending = this.pending.get(message.id)
      if (!pending) return
      this.pending.delete(message.id)
      if (message.error) pending.reject(new Error(message.error.message || JSON.stringify(message.error)))
      else pending.resolve(message.result)
      return
    }
    if (message.method === 'Target.receivedMessageFromTarget') {
      const { sessionId, message: raw } = message.params || {}
      let inner
      try { inner = JSON.parse(raw) } catch { return }
      const handlers = this._sessionHandlers.get(sessionId)
      if (!handlers) return
      if (inner.id && handlers.pending.has(inner.id)) {
        const p = handlers.pending.get(inner.id)
        handlers.pending.delete(inner.id)
        if (inner.error) p.reject(new Error(inner.error.message || JSON.stringify(inner.error)))
        else p.resolve(inner.result)
      }
    }
  }

  call(method, params = {}, { timeoutMs = 30_000 } = {}) {
    if (this.closed) return Promise.reject(new Error(`CDP closed: ${method}`))
    const id = this.nextId
    this.nextId += 1
    return new Promise((resolveCall, rejectCall) => {
      const timer = setTimeout(() => {
        this.pending.delete(id)
        rejectCall(new Error(`CDP timeout ${timeoutMs}ms: ${method}`))
      }, timeoutMs)
      this.pending.set(id, {
        resolve: (v) => { clearTimeout(timer); resolveCall(v) },
        reject: (e) => { clearTimeout(timer); rejectCall(e) },
      })
      try {
        this.socket.send(JSON.stringify({ id, method, params }))
      } catch (error) {
        clearTimeout(timer)
        this.pending.delete(id)
        rejectCall(error)
      }
    })
  }

  async createBrowserContext() {
    const result = await this.call('Target.createBrowserContext')
    return result.browserContextId
  }

  async disposeBrowserContext(browserContextId) {
    try {
      await this.call('Target.disposeBrowserContext', { browserContextId })
      return { ok: true }
    } catch (error) {
      return { ok: false, error: error.message }
    }
  }

  async openPage(url, browserContextId) {
    const { targetId } = await this.call('Target.createTarget', {
      url: url || 'about:blank',
      browserContextId,
    })
    const { sessionId } = await this.call('Target.attachToTarget', {
      targetId,
      flatten: false,
    })
    const session = new CdpSession(this, sessionId, targetId)
    this._sessionHandlers.set(sessionId, session._handler)
    await session.call('Page.enable')
    await session.call('Runtime.enable')
    return session
  }

  close() {
    this.closed = true
    try {
      if (this.socket.readyState === WebSocket.OPEN || this.socket.readyState === WebSocket.CONNECTING) {
        this.socket.close()
      }
    } catch { /* ignore */ }
    this.pending.clear()
    this._sessionHandlers.clear()
  }
}

class CdpSession {
  constructor(connection, sessionId, targetId) {
    this.connection = connection
    this.sessionId = sessionId
    this.targetId = targetId
    this.nextId = 1
    this._handler = { pending: new Map(), dead: false }
  }

  call(method, params = {}, { timeoutMs = 30_000 } = {}) {
    if (this._handler.dead) return Promise.reject(new Error(`session dead: ${method}`))
    const id = this.nextId
    this.nextId += 1
    return new Promise((resolveCall, rejectCall) => {
      const timer = setTimeout(() => {
        this._handler.pending.delete(id)
        rejectCall(new Error(`CDP session timeout ${timeoutMs}ms: ${method}`))
      }, timeoutMs)
      this._handler.pending.set(id, {
        resolve: (v) => { clearTimeout(timer); resolveCall(v) },
        reject: (e) => { clearTimeout(timer); rejectCall(e) },
      })
      this.connection.call('Target.sendMessageToTarget', {
        sessionId: this.sessionId,
        message: JSON.stringify({ id, method, params }),
      }, { timeoutMs }).catch((error) => {
        clearTimeout(timer)
        this._handler.pending.delete(id)
        rejectCall(error)
      })
    })
  }

  async evaluate(expression) {
    const result = await this.call('Runtime.evaluate', {
      expression,
      awaitPromise: true,
      returnByValue: true,
    })
    if (result.exceptionDetails) {
      throw new Error(result.exceptionDetails.exception?.description || 'evaluate failed')
    }
    return result.result?.value
  }

  async close() {
    this._handler.dead = true
    for (const [, p] of this._handler.pending) p.reject(new Error('session closed'))
    this._handler.pending.clear()
    try {
      await this.connection.call('Target.closeTarget', { targetId: this.targetId })
      return { ok: true }
    } catch (error) {
      this.connection._sessionHandlers.delete(this.sessionId)
      return { ok: false, error: error.message }
    }
  }
}

export async function waitForSelector(session, selector, timeout = 20_000) {
  return retry(async () => {
    const found = await session.evaluate(`!!document.querySelector(${JSON.stringify(selector)})`)
    if (!found) throw new Error(`Waiting for ${selector}`)
    return true
  }, timeout)
}

export async function setInputValue(session, selector, value) {
  return session.evaluate(`(() => {
    const input = document.querySelector(${JSON.stringify(selector)})
    if (!input) throw new Error('Input not found')
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set
    setter.call(input, ${JSON.stringify(String(value))})
    input.dispatchEvent(new Event('input', { bubbles: true }))
    input.dispatchEvent(new Event('change', { bubbles: true }))
    return input.value
  })()`)
}

export async function click(session, selector) {
  return session.evaluate(`(() => {
    const el = document.querySelector(${JSON.stringify(selector)})
    if (!el) throw new Error('Clickable not found')
    if (el.disabled) throw new Error('Element disabled')
    el.click()
    return true
  })()`)
}

export async function setViewport(session, width = 1280, height = 800) {
  const landscape = width >= height
  await session.call('Emulation.setDeviceMetricsOverride', {
    width,
    height,
    deviceScaleFactor: 1,
    mobile: width < 1200,
    screenWidth: width,
    screenHeight: height,
    screenOrientation: {
      type: landscape ? 'landscapePrimary' : 'portraitPrimary',
      angle: landscape ? 90 : 0,
    },
  })
  // Emulation pode atrasar innerWidth; só dispara resize quando bater.
  for (let i = 0; i < 20; i += 1) {
    const dims = await session.evaluate(`({ w: window.innerWidth, h: window.innerHeight })`).catch(() => null)
    if (dims && Number(dims.w) === width && Number(dims.h) === height) break
    await pause(50)
  }
  await session.evaluate(`(() => {
    window.dispatchEvent(new Event('resize'))
    window.dispatchEvent(new Event('orientationchange'))
  })()`).catch(() => {})
  await pause(80)
  await session.evaluate(`window.dispatchEvent(new Event('resize'))`).catch(() => {})
}

export async function launchChromeBrowser({
  cdpPort,
  headed = false,
  profileDir,
} = {}) {
  const browserPath = resolveBrowserPath()
  const profile = resolve(profileDir || `artifacts/cdp-min/chrome-profile-${cdpPort}`)
  await mkdir(profile, { recursive: true })

  if (await portOpen(cdpPort)) {
    throw new Error(`Porta CDP ${cdpPort} já em uso`)
  }

  const args = [
    headed ? null : '--headless=new',
    `--remote-debugging-port=${cdpPort}`,
    `--user-data-dir=${profile}`,
    '--disable-gpu',
    '--disable-extensions',
    '--no-first-run',
    '--no-default-browser-check',
    '--mute-audio',
    'about:blank',
  ].filter(Boolean)

  const child = spawn(browserPath, args, { stdio: 'ignore' })
  console.log(`[cdp-min] Chrome pid=${child.pid} port=${cdpPort}`)
  let browserInfo
  try {
    browserInfo = await retry(async () => {
      const response = await fetch(`http://127.0.0.1:${cdpPort}/json/version`)
      if (!response.ok) throw new Error('endpoint not ready')
      return response.json()
    }, 40_000, 250)
  } catch (error) {
    try { child.kill() } catch { /* ignore */ }
    spawn('taskkill', ['/pid', String(child.pid), '/T', '/F'], { stdio: 'ignore' })
    throw new Error(`Chrome CDP :${cdpPort} — ${error.message}`)
  }
  console.log('[cdp-min] endpoint pronto')

  const connection = new CdpConnection(browserInfo.webSocketDebuggerUrl)
  await connection.connect()
  await connection.call('Target.setDiscoverTargets', { discover: true }).catch(() => {})

  return {
    child,
    connection,
    cdpPort,
    async stop() {
      const errors = []
      try { connection.close() } catch (error) { errors.push(error.message) }
      if (child?.pid) {
        try { child.kill() } catch (error) { errors.push(error.message) }
        spawn('taskkill', ['/pid', String(child.pid), '/T', '/F'], { stdio: 'ignore' })
      }
      await pause(400)
      return { ok: errors.length === 0, errors }
    },
  }
}
