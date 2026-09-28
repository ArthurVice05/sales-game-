import { performance } from 'node:perf_hooks'
import { createHash } from 'node:crypto'

export function configFingerprint(config) {
  return createHash('sha256').update(JSON.stringify({ url: config.url, backend: config.supabaseOrigin, runId: config.runId,
    rooms: config.rooms, shards: config.shards, startAt: config.startAt, rampMs: config.rampMs, windowMs: config.windowMs,
    drainMs: config.drainMs, seed: config.seed, profile: config.profile, sampleMs: config.sampleMs })).digest('hex')
}
export async function syncClock(config) {
  if (!config.coordinatorUrl) {
    if (config.shards > 1) throw Error('Execução distribuída exige --coordinator-url para medir o erro de relógio')
    return { offsetMs: 0, uncertaintyMs: 0, measuredAt: Date.now(), source: 'single-process' }
  }
  const estimates = []
  for (let i = 0; i < 5; i++) {
    const wall = Date.now(), mono = performance.now()
    const response = await fetch(new URL('/time', config.coordinatorUrl), { signal: AbortSignal.timeout(5000) })
    if (!response.ok) throw Error('Coordenador de teste indisponível')
    const result = await response.json(), rtt = performance.now() - mono
    estimates.push({ offsetMs: result.now - (wall + rtt / 2), uncertaintyMs: rtt / 2, measuredAt: Date.now(), source: 'lab-coordinator' })
  }
  const estimate = estimates.sort((a, b) => a.uncertaintyMs - b.uncertaintyMs)[0]
  if (estimate.uncertaintyMs > config.maxClockSkewMs) throw Error('Incerteza do relógio excede --max-clock-skew-ms')
  return estimate
}
export async function registerShard(config, clock, signal) {
  if (!config.coordinatorUrl) return
  const response = await fetch(new URL('/ready', config.coordinatorUrl), { method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ runId: config.runId, shardIndex: config.shardIndex, shards: config.shards, fingerprint: configFingerprint(config) }), signal })
  if (!response.ok) throw Error(`Coordenador recusou shard: ${response.status}`)
  while (Date.now() + clock.offsetMs < config.startAt) {
    const status = await (await fetch(new URL(`/status?runId=${encodeURIComponent(config.runId)}`, config.coordinatorUrl), { signal })).json()
    if (status.ready === config.shards) return
    await new Promise(resolve => setTimeout(resolve, 250))
  }
  throw Error('Nem todos os shards ficaram prontos antes de start-at')
}
