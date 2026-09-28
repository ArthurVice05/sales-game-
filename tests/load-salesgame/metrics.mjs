import { mkdir, writeFile } from 'node:fs/promises'
import path from 'node:path'
import os from 'node:os'
import { monitorEventLoopDelay, performance } from 'node:perf_hooks'
import { sanitize } from './safety.mjs'

export function percentiles(values) {
  const sorted = values.filter(Number.isFinite).sort((a, b) => a - b)
  const percentile = p => sorted.length ? sorted[Math.max(0, Math.ceil(sorted.length * p) - 1)] : null
  return { n: sorted.length, p50: percentile(.5), p95: percentile(.95), p99: percentile(.99) }
}
export function assessConcurrency(samples, start, end, target, sampleMs) {
  const ordered = [...samples].sort((a, b) => a.at - b.at)
  const relevant = ordered.filter(s => s.at >= start - sampleMs && s.at <= end + sampleMs)
  let coveredMs = 0, gaps = 0, cursor = start, minimum = Infinity
  for (let i = 0; i < relevant.length - 1; i++) {
    const a = relevant[i], b = relevant[i + 1], left = Math.max(start, a.at), right = Math.min(end, b.at)
    if (right <= left) continue
    if (left > cursor || b.at - a.at > sampleMs * 1.75) gaps++
    minimum = Math.min(minimum, a.active, b.active)
    if (b.at - a.at <= sampleMs * 1.75 && a.active >= target && b.active >= target) coveredMs += right - left
    cursor = Math.max(cursor, right)
  }
  if (cursor < end || !relevant.length || relevant[0].at > start) gaps++
  return { target, minimum: minimum === Infinity ? 0 : minimum, peak: Math.max(0, ...relevant.map(s => s.active)), coveredMs, requiredMs: end - start, gaps, pass: gaps === 0 && coveredMs >= end - start && end > start }
}
const csv = (rows, fields) => [fields.join(','), ...rows.map(row => fields.map(key => JSON.stringify(row[key] ?? '')).join(','))].join('\n') + '\n'

export class Metrics {
  constructor(config, clock = () => Date.now()) {
    this.config = config; this.clock = clock; this.events = []; this.samples = []; this.latencies = []; this.failures = []; this.rooms = []; this.players = new Map(); this.actions = 0
    this.loop = monitorEventLoopDelay({ resolution: 20 }); this.loop.enable()
    this.previousCpu = process.cpuUsage(); this.previousTime = performance.now()
  }
  event(type, data = {}) { const event = sanitize({ at: this.clock(), type, ...data }); this.events.push(event); return event }
  fail(code, detail = {}) { const failure = this.event('failure', { code, ...detail }); this.failures.push(failure) }
  latency(kind, ms, detail = {}) { this.latencies.push({ at: this.clock(), kind, ms, ...detail }) }
  player(key, value) { this.players.set(key, { ...this.players.get(key), ...value }) }
  sample() {
    const now = performance.now(), usage = process.cpuUsage(), elapsed = now - this.previousTime
    const cpu = ((usage.user - this.previousCpu.user) + (usage.system - this.previousCpu.system)) / (elapsed * 1000) * 100
    this.previousCpu = usage; this.previousTime = now
    const players = [...this.players.values()], active = players.filter(p => p.inGame && p.connected && !p.ended && !p.failed && !p.spectator && this.clock() - p.lastObserved <= this.config.sampleMs * 2)
    const sample = {
      at: this.clock(), connected: players.filter(p => p.connected).length, active: active.length,
      rooms: new Set(active.map(p => p.room)).size, waiting: active.filter(p => p.state === 'waiting-turn').length,
      spectators: players.filter(p => p.spectator && p.connected).length,
      actions: this.actions, completed: this.rooms.filter(r => r.status === 'complete').length,
      failures: this.failures.length, disconnected: players.filter(p => !p.connected).length,
      cpuPercentOneCore: cpu, nodeRssBytes: process.memoryUsage().rss,
      hostUsedBytes: os.totalmem() - os.freemem(), hostTotalBytes: os.totalmem(), logicalCpus: os.cpus().length,
      eventLoopP99Ms: Number(this.loop.percentile(99)) / 1e6,
    }
    this.samples.push(sample); this.loop.reset(); return sample
  }
  async save(status, extra = {}) {
    this.loop.disable()
    const directory = path.join(this.config.output, this.config.runId, `shard-${this.config.shardIndex}`)
    await mkdir(directory, { recursive: true })
    const summaries = Object.fromEntries([...new Set(this.latencies.map(l => l.kind))].map(kind => [kind, percentiles(this.latencies.filter(l => l.kind === kind).map(l => l.ms))]))
    const result = sanitize({ schema: 1, status, config: this.config, summaries, samples: this.samples, latencies: this.latencies, failures: this.failures, rooms: this.rooms, events: this.events, ...extra })
    await writeFile(path.join(directory, 'results.json'), JSON.stringify(result, null, 2))
    await writeFile(path.join(directory, 'concurrency.csv'), csv(this.samples, ['at','connected','active','rooms','waiting','spectators','actions','completed','failures','disconnected','cpuPercentOneCore','nodeRssBytes','hostUsedBytes','eventLoopP99Ms']))
    await writeFile(path.join(directory, 'latency.csv'), csv(this.latencies, ['at','kind','ms','room','player','action']))
    await writeFile(path.join(directory, 'report.md'), `# Sales Game — ${this.config.runId}\n\nStatus: **${status}**. Perfil: ${this.config.profile}. Shard ${this.config.shardIndex + 1}/${this.config.shards}.\n\n${this.rooms.filter(r => r.status === 'complete').length} partidas concluídas. ${this.failures.length} falhas diagnosticadas. Pico local em jogo: ${Math.max(0, ...this.samples.map(s => s.active))}.\n\n${Object.entries(summaries).map(([kind, s]) => `- ${kind}: n=${s.n}, p50=${s.p50} ms, p95=${s.p95} ms, p99=${s.p99} ms`).join('\n')}\n\n## Critérios\n\n\`\`\`json\n${JSON.stringify(extra, null, 2)}\n\`\`\`\n\n## Falhas\n\n${this.failures.map(f => `- ${f.code}: ${f.detail || f.message || 'consulte JSON'}`).join('\n') || 'Nenhuma falha registrada; isso não substitui os critérios de aprovação.'}\n\nRecursos: CPU do processo Node (100% = um núcleo), RSS de Node, memória usada do host (inclui navegador e outros processos), atraso p99 do event loop. Não atribuir saturação do gerador ao jogo. Traces não contêm corpos de rede, credenciais ou storageState.\n`)
    return { directory, result }
  }
}
