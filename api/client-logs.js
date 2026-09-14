const MAX_LOGS = 25
const MAX_MESSAGE_LENGTH = 2000

function text(value, maxLength) {
  return String(value || '')
    .replace(/Bearer\s+[A-Za-z0-9._~+/=-]+/gi, 'Bearer [REDACTED]')
    .replace(/eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/g, '[JWT_REDACTED]')
    .slice(0, maxLength)
}

export function normalizeClientLogPayload(body) {
  const input = body && typeof body === 'object' ? body : {}
  const sourceLogs = Array.isArray(input.logs) ? input.logs.slice(0, MAX_LOGS) : []
  return {
    source: 'sales-game-browser',
    sessionId: text(input.sessionId, 100),
    room: text(input.room, 32) || null,
    page: text(input.page, 500),
    userAgent: text(input.userAgent, 300),
    logs: sourceLogs.map(entry => ({
      time: text(entry?.time, 40),
      level: ['error', 'warn', 'info', 'debug', 'log'].includes(entry?.level)
        ? entry.level
        : 'log',
      message: text(entry?.message, MAX_MESSAGE_LENGTH),
    })),
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

export default function handler(req, res) {
  if (req.method !== 'POST') {
    res.setHeader('allow', 'POST')
    return res.status(405).json({ error: 'method_not_allowed' })
  }

  if (!requestIsSameOrigin(req)) {
    return res.status(403).json({ error: 'origin_not_allowed' })
  }

  const payload = normalizeClientLogPayload(req.body)
  if (payload.logs.length === 0) {
    return res.status(400).json({ error: 'empty_logs' })
  }

  const hasError = payload.logs.some(entry => entry.level === 'error')
  const output = JSON.stringify(payload)
  if (hasError) console.error('[CLIENT_LOG_BATCH]', output)
  else console.log('[CLIENT_LOG_BATCH]', output)

  return res.status(204).end()
}
