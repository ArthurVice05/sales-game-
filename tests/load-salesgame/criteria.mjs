import { assessConcurrency, percentiles } from './metrics.mjs'
import { roomIndexes } from './config.mjs'

export function evaluateCriteria(config, data) {
  const expected = roomIndexes(config).length * 4
  const start = config.startAt + config.rampMs, end = start + config.windowMs
  const concurrency = config.profile === 'smoke'
    ? { target: 4, peak: Math.max(0, ...data.samples.map(s => s.active)), pass: data.samples.some(s => s.active === 4), requiredMs: 0 }
    : assessConcurrency(data.samples, start, end, expected, config.sampleMs)
  const spontaneous = data.events.filter(e => ['http-error','page-error','console-error','network-error'].includes(e.type) && !e.injected)
  const limits = {
    action: percentiles(data.latencies.filter(l => l.kind === 'action-visible').map(l => l.ms)),
    sync: percentiles(data.latencies.filter(l => l.kind === 'sync-after-local-visible').map(l => l.ms)),
    reconnect: percentiles(data.latencies.filter(l => l.kind === 'reconnect').map(l => l.ms)),
  }
  const incomplete = data.rooms.filter(r => r.status !== 'complete')
  const unproven = data.rooms.flatMap(r => r.unproven || [])
  const allRoomsPlayed = roomIndexes(config).every(index => data.rooms.some(r => r.index === index && r.status === 'complete' && r.actions >= 4))
  const errorRatio = spontaneous.length / Math.max(1, data.events.filter(e => e.type === 'action').length)
  const pass = concurrency.pass && data.failures.length === 0 && incomplete.length === 0 && unproven.length === 0 && allRoomsPlayed
    && limits.action.n > 0 && limits.action.p95 <= config.maxActionMs && limits.sync.p95 <= config.maxSyncMs
    && (!limits.reconnect.n || limits.reconnect.p95 <= config.maxReconnectMs) && errorRatio <= config.maxErrorRate
    && (config.profile !== 'resilience' || limits.reconnect.n === 3)
  return { pass, concurrency, allRoomsPlayed, incomplete: incomplete.length, unprovenEffects: unproven.length,
    diagnosedFailures: data.failures.length, errorRatio, limits, proposedTargets: { actionP95Ms: config.maxActionMs, syncP95Ms: config.maxSyncMs, reconnectP95Ms: config.maxReconnectMs, maxErrorRatio: config.maxErrorRate },
    scope: 'Sessões locais deste shard; aprovação de 100 exige consolidação de todos os shards quando distribuído.' }
}
