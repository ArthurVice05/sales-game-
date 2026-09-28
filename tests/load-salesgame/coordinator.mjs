// Lab control plane only. Never connects to Supabase or changes the product.
import http from 'node:http'
const host = process.env.SG_LAB_COORDINATOR_HOST || '127.0.0.1'
const port = Number(process.env.SG_LAB_COORDINATOR_PORT || 9360)
const runs = new Map()
http.createServer(async (request, response) => {
  const send = (code, object) => { response.writeHead(code, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' }); response.end(JSON.stringify(object)) }
  const url = new URL(request.url, 'http://lab')
  if (url.pathname === '/time' && request.method === 'GET') return send(200, { now: Date.now() })
  if (url.pathname === '/ready' && request.method === 'POST') {
    try {
      let body = ''
      for await (const chunk of request) { body += chunk; if (body.length > 4096) return send(413, {}) }
      const value = JSON.parse(body)
      if (!/^[\w-]{3,40}$/.test(value.runId) || !Number.isInteger(value.shards) || value.shards < 1 || value.shards > 25 || !Number.isInteger(value.shardIndex) || value.shardIndex < 0 || value.shardIndex >= value.shards || !/^[a-f0-9]{64}$/.test(value.fingerprint)) return send(400, {})
      const run = runs.get(value.runId) || { fingerprint: value.fingerprint, shards: value.shards, ready: new Set() }
      if (run.fingerprint !== value.fingerprint || run.shards !== value.shards || run.ready.has(value.shardIndex)) return send(409, { error: 'duplicate shard or conflicting configuration' })
      run.ready.add(value.shardIndex); runs.set(value.runId, run)
      return send(200, { ready: run.ready.size })
    } catch { return send(400, {}) }
  }
  if (url.pathname === '/status' && request.method === 'GET') return send(200, { ready: runs.get(url.searchParams.get('runId'))?.ready.size ?? 0 })
  return send(404, {})
}).listen(port, host, () => console.log(`Coordenador do laboratório: http://${host}:${port}. Para máquinas distintas use uma rede privada protegida; não exponha à Internet.`))
