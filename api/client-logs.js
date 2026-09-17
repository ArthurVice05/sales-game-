const MAX_EVENTS = 25
const MAX_MESSAGE_LENGTH = 2000
const ALLOWED_SEVERITIES = new Set(['error', 'warning', 'info'])

function text(value, maxLength) {
  return String(value || '')
    .replace(/Bearer\s+[A-Za-z0-9._~+/=-]+/gi, 'Bearer [REDACTED]')
    .replace(/eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/g, '[JWT_REDACTED]')
    .slice(0, maxLength)
}

function finiteNumber(value, fallback = 0) {
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : fallback
}

function normalizeDetails(details) {
  if (!details || typeof details !== 'object' || Array.isArray(details)) return undefined
  return Object.fromEntries(
    Object.entries(details)
      .slice(0, 20)
      .map(([key, value]) => [
        text(key, 60),
        typeof value === 'number'
          ? finiteNumber(value)
          : typeof value === 'boolean'
            ? value
            : text(value, 200),
      ])
  )
}

function normalizeEvent(entry, legacy = false) {
  const rawSeverity = legacy
    ? (entry?.level === 'error' ? 'error' : entry?.level === 'warn' ? 'warning' : 'info')
    : entry?.severity
  return {
    occurredAt: text(entry?.occurredAt || entry?.time, 40),
    lastOccurredAt: text(entry?.lastOccurredAt || entry?.time, 40),
    code: text(entry?.code || (legacy ? 'LEGACY_CLIENT_LOG' : 'CLIENT_EVENT'), 80)
      .toUpperCase()
      .replace(/[^A-Z0-9_]/g, '_'),
    severity: ALLOWED_SEVERITIES.has(rawSeverity) ? rawSeverity : 'info',
    category: text(entry?.category || (legacy ? 'legacy' : 'client'), 50),
    message: text(entry?.message, MAX_MESSAGE_LENGTH),
    occurrences: Math.max(1, Math.min(10000, Math.floor(finiteNumber(entry?.occurrences, 1)))),
    details: normalizeDetails(entry?.details),
  }
}

export function normalizeClientLogPayload(body) {
  const input = body && typeof body === 'object' ? body : {}
  const hasStructuredEvents = Array.isArray(input.events)
  const sourceEvents = hasStructuredEvents
    ? input.events.slice(0, MAX_EVENTS)
    : (Array.isArray(input.logs) ? input.logs.slice(0, MAX_EVENTS) : [])

  return {
    schemaVersion: Math.max(1, Math.floor(finiteNumber(input.schemaVersion, hasStructuredEvents ? 2 : 1))),
    source: 'sales-game-browser',
    sessionId: text(input.sessionId, 100),
    room: text(input.room, 100) || null,
    page: text(input.page, 500),
    userAgent: text(input.userAgent, 300),
    release: text(input.release, 100) || text(process.env.VERCEL_GIT_COMMIT_SHA, 100) || null,
    environment: text(input.environment, 30) || text(process.env.VERCEL_ENV, 30) || null,
    metrics: normalizeDetails(input.metrics),
    events: sourceEvents.map(entry => normalizeEvent(entry, !hasStructuredEvents)),
  }
}

function requestIsSameOrigin(req) {
  const origin = req.headers?.origin
  if (!origin) return true
  const forwardedHost = String(req.headers?.['x-forwarded-host'] || req.headers?.host || '')
    .split(',')[0]
    .trim()
  if (!forwardedHost) return false
  try {
    return new URL(origin).host === forwardedHost
  } catch {
    return false
  }
}

function writeMonitoringEvent(base, event) {
  const record = JSON.stringify({
    ...base,
    event,
  })
  const prefix = `[SG_MONITOR][${event.code}]`
  if (event.severity === 'error') console.error(prefix, record)
  else if (event.severity === 'warning') console.warn(prefix, record)
  else console.info(prefix, record)
}

export default function handler(req, res) {
  if (req.method !== 'POST') {
    res.setHeader('allow', 'POST')
    return res.status(405).json({ error: 'method_not_allowed' })
  }

  if (!requestIsSameOrigin(req)) {
    return res.status(403).json({ error: 'origin_not_allowed' })
  }

  const payload = normalizeClientLogPayload(req.body)
  if (payload.events.length === 0) {
    return res.status(400).json({ error: 'empty_events' })
  }

  const { events, ...basePayload } = payload
  const base = {
    ...basePayload,
    requestId: text(req.headers?.['x-vercel-id'], 100) || null,
    receivedAt: new Date().toISOString(),
  }
  events.forEach(event => writeMonitoringEvent(base, event))

  return res.status(204).end()
}
