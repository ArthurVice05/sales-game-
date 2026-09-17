const FLUSH_INTERVAL_MS = 15000
const MAX_BATCH_EVENTS = 25
const MAX_QUEUED_EVENTS = 100
const MAX_MESSAGE_LENGTH = 2000

const MONITOR_RULES = [
  { pattern: /\[MONITOR\]\[ROLL_BLOCKED\]|\[ROLL_BLOCK\]|\[dice\].*ROLL ignorado/i, code: 'ROLL_BLOCKED', severity: 'warning', category: 'turn' },
  { pattern: /\[MONITOR\]\[ROLL_CONFIRMATION_RETRY\]/, code: 'ROLL_CONFIRMATION_RETRY', severity: 'warning', category: 'sync' },
  { pattern: /\[MONITOR\]\[ROLL_CONFIRMATION_FAILED\]/, code: 'ROLL_CONFIRMATION_FAILED', severity: 'error', category: 'sync' },
  { pattern: /\[MONITOR\]\[ROLL_CONFIRMED\]/, code: 'ROLL_CONFIRMED', severity: 'info', category: 'turn' },
  { pattern: /\[ENGINE_V2\].*shadow \(ignorado\)/i, ignore: true },
  { pattern: /\[MONITOR\]\[REVENUE_CREDIT_MISMATCH\]/i, code: 'REVENUE_CREDIT_MISMATCH', severity: 'error', category: 'economy' },
  { pattern: /\[MONITOR\]\[REVENUE_CREDIT_APPLIED\]/i, code: 'REVENUE_CREDIT_APPLIED', severity: 'info', category: 'economy' },
  { pattern: /\[CLIENT_ERROR\]/i, code: 'CLIENT_RUNTIME_ERROR', severity: 'error', category: 'runtime' },
  { pattern: /\[UNHANDLED_REJECTION\]/i, code: 'CLIENT_UNHANDLED_REJECTION', severity: 'error', category: 'runtime' },
  { pattern: /actionQueue error|Erro em advanceAndMaybeLap|openModalAndWait - erro/i, code: 'TURN_ENGINE_ERROR', severity: 'error', category: 'turn' },
  { pattern: /Estado do jogo inválido|Ação inválida|Mudança de recurso inválida|Cálculos inválidos|Erro ao validar cálculos/i, code: 'GAME_STATE_INVALID', severity: 'error', category: 'integrity' },
  { pattern: /commit failed after retries|commit fallback resync failed|commit - no target ID/i, code: 'NETWORK_COMMIT_FAILED', severity: 'error', category: 'sync' },
  { pattern: /rooms\/bootstrap failed|rooms\/bootstrap: nenhuma row/i, code: 'ROOM_BOOTSTRAP_FAILED', severity: 'error', category: 'room' },
  { pattern: /commit conflict/i, code: 'NETWORK_COMMIT_CONFLICT', severity: 'warning', category: 'sync' },
  { pattern: /TURN_LOCK_WATCHDOG|excedeu tentativas de retry, liberando turnLock/i, code: 'TURN_LOCK_STALLED', severity: 'warning', category: 'turn' },
  { pattern: /movimento descartado/i, code: 'TURN_MOVEMENT_DROPPED', severity: 'error', category: 'turn' },
  { pattern: /sem ownerId válido|Jogador não encontrado no array/i, code: 'TURN_ACTOR_INVALID', severity: 'error', category: 'turn' },
  { pattern: /modal não classificada por referência/i, code: 'BOT_MODAL_UNKNOWN', severity: 'error', category: 'bot' },
  { pattern: /RPC .* indisponível/i, code: 'DATABASE_RPC_FALLBACK', severity: 'warning', category: 'configuration' },
  { pattern: /Supabase não configurado/i, code: 'SUPABASE_CONFIGURATION_MISSING', severity: 'error', category: 'configuration' },
  { pattern: /\[(?:hb|presence)\].*falha/i, code: 'PRESENCE_UPDATE_FAILED', severity: 'warning', category: 'presence' },
  { pattern: /\[MONITOR\]\[CLOCK_SYNC_FAILED\]/i, code: 'CLOCK_SYNC_FAILED', severity: 'warning', category: 'turn' },
  { pattern: /\[MONITOR\]\[AUTO_PASS_ATTEMPT\]/i, code: 'AUTO_PASS_ATTEMPT', severity: 'warning', category: 'turn' },
  { pattern: /\[MONITOR\]\[AUTO_PASS_FAILED\]/i, code: 'AUTO_PASS_FAILED', severity: 'error', category: 'turn' },
  { pattern: /\[MONITOR\]\[AUTO_PASS_RECOVERED\]/i, code: 'AUTO_PASS_RECOVERED', severity: 'info', category: 'turn' },
  { pattern: /\[(?:leaveRoom|leaveRoomById)\].*(?:Erro|erro|falha)/i, code: 'PLAYER_LEAVE_FAILED', severity: 'warning', category: 'room' },
  { pattern: /\[rooms\].*falha/i, code: 'ROOM_DELETE_FAILED', severity: 'warning', category: 'room' },
  { pattern: /\[cleanup\].*hard cap/i, code: 'LOBBY_CAP_EXCEEDED', severity: 'warning', category: 'capacity' },
  { pattern: /\[cleanup\].*(?:Erro|erro|falha)/i, code: 'LOBBY_CLEANUP_FAILED', severity: 'warning', category: 'room' },
  { pattern: /\[host-transfer\].*falha/i, code: 'HOST_TRANSFER_FAILED', severity: 'warning', category: 'room' },
  { pattern: /\[ENDGAME\].*finalizando/i, code: 'MATCH_COMPLETED', severity: 'info', category: 'match' },
]

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

export function classifyMonitoringEvent(entry) {
  const normalized = toRemoteLogEntry(entry)
  const rule = MONITOR_RULES.find(candidate => candidate.pattern.test(normalized.message))
  if (rule?.ignore) return null
  if (!rule && normalized.level !== 'error') return null
  const context = rule?.code?.startsWith('ROLL_') || rule?.code?.startsWith('AUTO_PASS_')
    ? entry?.args?.find(arg => arg && typeof arg === 'object' && !Array.isArray(arg)) : null
  const details = context ? Object.fromEntries(
    ['room', 'matchId', 'playerId', 'turnPlayerId', 'turnSeq', 'reason', 'turnLock', 'modalLocks', 'claimId', 'steps']
      .filter(key => context[key] != null)
      .map(key => [key, context[key]])
  ) : undefined

  return {
    occurredAt: normalized.time,
    lastOccurredAt: normalized.time,
    code: rule?.code || 'CLIENT_CONSOLE_ERROR',
    severity: rule?.severity || 'error',
    category: rule?.category || 'runtime',
    message: normalized.message,
    occurrences: 1,
    ...(details ? { details } : {}),
  }
}

export function startVercelLogTransport(capture, options = {}) {
  if (typeof window === 'undefined' || typeof fetch !== 'function' || !capture?.subscribe) {
    return () => {}
  }

  const endpoint = options.endpoint || '/api/client-logs'
  const intervalMs = options.intervalMs || FLUSH_INTERVAL_MS
  const batchSize = options.batchSize || MAX_BATCH_EVENTS
  const queue = []
  const logSessionId = sessionId()
  const startedAt = Date.now()
  const metrics = { captured: 0, ignored: 0, dropped: 0, sent: 0, sendFailures: 0 }
  let sending = false

  const enqueue = event => {
    if (!event) return
    const duplicate = queue.find(candidate =>
      candidate.code === event.code && candidate.message === event.message
    )
    if (duplicate) {
      duplicate.occurrences += 1
      duplicate.lastOccurredAt = event.lastOccurredAt
      return
    }
    if (queue.length >= MAX_QUEUED_EVENTS) {
      queue.shift()
      metrics.dropped += 1
    }
    queue.push(event)
  }

  const monitoringStartedAt = new Date().toISOString()
  enqueue({
    occurredAt: monitoringStartedAt,
    lastOccurredAt: monitoringStartedAt,
    code: 'CLIENT_MONITORING_STARTED',
    severity: 'info',
    category: 'health',
    message: 'Monitoramento do navegador iniciado',
    occurrences: 1,
  })

  const payloadFor = events => ({
    schemaVersion: 2,
    sessionId: logSessionId,
    page: window.location.pathname.slice(0, 500),
    room: new URLSearchParams(window.location.search).get('room')?.slice(0, 100) || null,
    userAgent: String(window.navigator?.userAgent || '').slice(0, 300),
    release: String(import.meta.env?.VITE_VERCEL_GIT_COMMIT_SHA || '').slice(0, 100),
    environment: String(import.meta.env?.VITE_VERCEL_ENV || 'production').slice(0, 30),
    metrics: { ...metrics },
    events,
  })

  const flush = async ({ beacon = false } = {}) => {
    if (sending || queue.length === 0) return
    const events = queue.splice(0, batchSize)
    const eventCount = events.reduce((total, event) => total + Number(event.occurrences || 1), 0)
    const body = JSON.stringify(payloadFor(events))

    if (beacon && typeof window.navigator?.sendBeacon === 'function') {
      const sent = window.navigator.sendBeacon(endpoint, new Blob([body], { type: 'application/json' }))
      if (sent) {
        metrics.sent += eventCount
        return
      }
    }

    sending = true
    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), 8000)
    try {
      const response = await fetch(endpoint, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body,
        keepalive: true,
        signal: controller.signal,
      })
      if (response.ok) metrics.sent += eventCount
      else {
        metrics.sendFailures += 1
        if (response.status >= 500 || response.status === 429) events.forEach(enqueue)
      }
    } catch {
      metrics.sendFailures += 1
      events.forEach(enqueue)
    } finally {
      clearTimeout(timeout)
      sending = false
    }
  }

  const unsubscribe = capture.subscribe(entry => {
    metrics.captured += 1
    const event = classifyMonitoringEvent(entry)
    if (!event) {
      metrics.ignored += 1
      return
    }
    enqueue(event)
    if (event.severity === 'error') queueMicrotask(() => flush())
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
  const onPageHide = () => {
    const endedAt = new Date().toISOString()
    enqueue({
      occurredAt: endedAt,
      lastOccurredAt: endedAt,
      code: 'CLIENT_SESSION_SUMMARY',
      severity: 'info',
      category: 'health',
      message: 'Sessão do monitoramento encerrada',
      occurrences: 1,
      details: { durationMs: Date.now() - startedAt, ...metrics },
    })
    flush({ beacon: true })
  }

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
