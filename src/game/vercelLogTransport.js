const FLUSH_INTERVAL_MS = 15000
const MAX_BATCH_ENTRIES = 25
const MAX_QUEUED_ENTRIES = 100
const MAX_MESSAGE_LENGTH = 2000

function sessionId() {
  try {
    const key = 'SG_LOG_SESSION_ID'
    const stored = window.sessionStorage.getItem(key)
    if (stored) return stored
    const created = globalThis.crypto?.randomUUID?.()
      || `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`
    window.sessionStorage.setItem(key, created)
    return created
  } catch {
    return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`
  }
}

export function toRemoteLogEntry(entry) {
  return {
    time: String(entry?.time || new Date().toISOString()).slice(0, 40),
    level: ['error', 'warn', 'info', 'debug', 'log'].includes(entry?.level)
      ? entry.level
      : 'log',
    message: String(entry?.message || '').slice(0, MAX_MESSAGE_LENGTH),
  }
}

export function startVercelLogTransport(capture, options = {}) {
  if (typeof window === 'undefined' || typeof fetch !== 'function' || !capture?.subscribe) {
    return () => {}
  }

  const endpoint = options.endpoint || '/api/client-logs'
  const intervalMs = options.intervalMs || FLUSH_INTERVAL_MS
  const batchSize = options.batchSize || MAX_BATCH_ENTRIES
  const queue = []
  const logSessionId = sessionId()
  let sending = false

  const payloadFor = (logs) => ({
    sessionId: logSessionId,
    page: window.location.pathname.slice(0, 500),
    room: new URLSearchParams(window.location.search).get('room')?.slice(0, 32) || null,
    userAgent: String(window.navigator?.userAgent || '').slice(0, 300),
    logs,
  })

  const flush = async ({ beacon = false } = {}) => {
    if (sending || queue.length === 0) return
    const logs = queue.splice(0, batchSize)
    const body = JSON.stringify(payloadFor(logs))

    if (beacon && typeof window.navigator?.sendBeacon === 'function') {
      const sent = window.navigator.sendBeacon(endpoint, new Blob([body], { type: 'application/json' }))
      if (sent) return
    }

    sending = true
    try {
      await fetch(endpoint, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body,
        keepalive: true,
      })
    } catch {
      // Logging remoto é opcional e não deve afetar o jogo ou gerar recursão no console.
    } finally {
      sending = false
    }
  }

  const unsubscribe = capture.subscribe(entry => {
    if (queue.length >= MAX_QUEUED_ENTRIES) queue.shift()
    queue.push(toRemoteLogEntry(entry))
    if (entry?.level === 'error') queueMicrotask(() => flush())
  })

  const onWindowError = event => {
    if (!capture.enabled) return
    capture.addLog('error', [
      '[CLIENT_ERROR]',
      event?.message || 'Erro não tratado',
      event?.filename ? `${event.filename}:${event.lineno || 0}:${event.colno || 0}` : '',
    ])
  }
  const onUnhandledRejection = event => {
    if (!capture.enabled) return
    const reason = event?.reason
    capture.addLog('error', ['[UNHANDLED_REJECTION]', reason?.stack || reason?.message || String(reason)])
  }
  const onPageHide = () => flush({ beacon: true })

  window.addEventListener('error', onWindowError)
  window.addEventListener('unhandledrejection', onUnhandledRejection)
  window.addEventListener('pagehide', onPageHide)
  const timer = window.setInterval(() => flush(), intervalMs)

  return () => {
    unsubscribe()
    window.clearInterval(timer)
    window.removeEventListener('error', onWindowError)
    window.removeEventListener('unhandledrejection', onUnhandledRejection)
    window.removeEventListener('pagehide', onPageHide)
    flush({ beacon: true })
  }
}
