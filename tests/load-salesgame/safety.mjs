import { readFile, writeFile, rm, rmdir, mkdtemp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { unzipSync, zipSync, strFromU8, strToU8 } from 'fflate'

const secretKey = /authorization|api[-_]?key|cookie|token|password|storageState|secret/i
export function sanitize(value) {
  if (Array.isArray(value)) return value.map(sanitize)
  if (value && typeof value === 'object') {
    if (typeof value.name === 'string' && secretKey.test(value.name) && 'value' in value) return { ...value, value: '[REDACTED]' }
    return Object.fromEntries(Object.entries(value).map(([key, val]) => [key, secretKey.test(key) ? '[REDACTED]' : sanitize(val)]))
  }
  if (typeof value !== 'string') return value
  return value.replace(/Bearer\s+[^\s"'<>]+/gi, 'Bearer [REDACTED]')
    .replace(/eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/g, '[JWT REDACTED]')
    .replace(/sb_(?:secret|publishable)_[A-Za-z0-9_-]+/g, '[KEY REDACTED]')
    .replace(/([?&](?:apikey|access_token|refresh_token|token|key|password)=)[^&#\s"']*/gi, '$1[REDACTED]')
}

export async function saveSanitizedTrace(context, destination) {
  const dir = await mkdtemp(path.join(tmpdir(), 'sg-lab-trace-')), raw = path.join(dir, 'trace.raw.zip')
  try {
    await context.tracing.stop({ path: raw })
    const entries = unzipSync(await readFile(raw)), safe = {}
    for (const [name, bytes] of Object.entries(entries)) {
      if (/\.(trace|network|stacks)$/.test(name)) {
        const lines = strFromU8(bytes).split('\n').filter(Boolean).map(line => {
          const object = JSON.parse(line)
          // Request/response bodies may contain credentials or unrelated data. Never retain them.
          if (object.snapshot?.request) delete object.snapshot.request.postData
          if (object.snapshot?.response?.content) delete object.snapshot.response.content._sha1
          return JSON.stringify(sanitize(object))
        })
        safe[name] = strToU8(lines.join('\n') + '\n')
      } else if (/resources\/.+\.(jpeg|jpg|png)$/.test(name)) safe[name] = bytes
    }
    await writeFile(destination, zipSync(safe))
  } finally { await rm(raw, { force: true }); await rmdir(dir).catch(() => {}) }
}

/** No direct gameplay requests. This guard only limits requests emitted by the real UI. */
export async function installRequestGuard(context, config, registry, reportViolation) {
  await context.route('**/*', async route => {
    const request = route.request(), url = new URL(request.url())
    if (!url.pathname.startsWith('/rest/v1/') && !url.pathname.startsWith('/auth/v1/')) return route.continue()
    if (url.origin !== config.supabaseOrigin) { reportViolation('backend-mismatch'); return route.abort('blockedbyclient') }
    const token = request.headers().authorization?.replace(/^Bearer\s+/i, '')
    if (token?.split('.').length === 3) {
      try { if (JSON.parse(Buffer.from(token.split('.')[1], 'base64url')).role === 'service_role') { reportViolation('service-role'); return route.abort() } } catch { /* opaque publishable key */ }
    }
    if (['GET', 'HEAD', 'OPTIONS'].includes(request.method())) return route.continue()
    await Promise.allSettled([...registry.pending])
    let body = null
    try { body = request.postDataJSON() } catch { /* no payload */ }
    const table = url.pathname.split('/').at(-1)
    const rows = Array.isArray(body) ? body : [body]
    const scoped = field => registry.roomIds.has(url.searchParams.get(field)?.replace(/^eq\./, ''))
    const payloadScoped = rows.length && rows.every(row => registry.roomIds.has(String(row?.lobby_id ?? row?.code ?? '')))
    // A criação da sala é a única escrita cujo alvo ainda não existe no registro.
    // Resolvemos aqui e só liberamos as escritas seguintes depois de conhecer o
    // id — sem essa espera havia corrida e o próprio assento do host era barrado.
    if (table === 'lobbies' && request.method() === 'POST') {
      if (!rows.length || !rows.every(row => registry.roomNames.has(row?.name))) {
        reportViolation('unscoped-write:lobbies:POST'); return route.abort('blockedbyclient')
      }
      const response = await route.fetch()
      let created = []
      try { created = await response.json() } catch { /* corpo vazio: sem id para registrar */ }
      for (const row of Array.isArray(created) ? created : [created]) {
        if (row?.id) registry.roomIds.add(String(row.id))
      }
      return route.fulfill({ response })
    }

    const allowed = table === 'lobbies' ? scoped('id')
      : table === 'lobby_players' || table === 'matches' ? scoped('lobby_id') || payloadScoped
      : table === 'rooms' ? scoped('code') || registry.roomRowIds.has(url.searchParams.get('id')?.replace(/^eq\./, '')) || payloadScoped
      : false
    if (!allowed) { reportViolation(`unscoped-write:${table}:${request.method()}`); return route.abort('blockedbyclient') }
    return route.continue()
  })
}
