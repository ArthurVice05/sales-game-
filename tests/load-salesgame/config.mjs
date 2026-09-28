import path from 'node:path'
import { createHash } from 'node:crypto'

export function parseConfig(args = process.argv.slice(2), env = process.env) {
  const cli = Object.fromEntries(args.map(arg => {
    const match = /^--([a-z][a-z-]*)=(.*)$/.exec(arg)
    if (!match) throw Error(`Use --opcao=valor: ${arg}`)
    return [match[1], match[2]]
  }))
  const get = (name, fallback = '') => cli[name] ?? env[`SG_LAB_${name.replaceAll('-', '_').toUpperCase()}`] ?? fallback
  const integer = (name, fallback, min, max) => {
    const value = Number(get(name, fallback))
    if (!Number.isInteger(value) || value < min || value > max) throw Error(`${name}: esperado inteiro ${min}–${max}`)
    return value
  }
  const flag = (name, fallback = false) => {
    const value = String(get(name, fallback))
    if (!['true', 'false'].includes(value)) throw Error(`${name}: use true ou false`)
    return value === 'true'
  }
  const url = get('url')
  if (!url) throw Error('SG_LAB_URL / --url obrigatório: nenhum destino padrão')
  const target = new URL(url), backend = get('supabase-origin')
  if (!['http:', 'https:'].includes(target.protocol) || target.username || target.password || target.search || target.hash) throw Error('URL sem credenciais, query ou fragmento; use a entrada do produto')
  if (get('test-backend') !== 'exclusive-test') throw Error('Confirme SG_LAB_TEST_BACKEND=exclusive-test (Supabase exclusivo de homologação)')
  if (!backend) throw Error('supabase-origin obrigatório para verificar o destino real das requisições')
  const db = new URL(backend)
  if (!['http:', 'https:'].includes(db.protocol) || db.username || db.password || db.search || db.hash || !['', '/'].includes(db.pathname)) throw Error('supabase-origin deve ser uma origem HTTP sem credenciais')
  const profile = get('profile', 'functional')
  if (!['smoke', 'functional', 'reduced-motion', 'resilience', 'rapid-confirm'].includes(profile)) throw Error('profile inválido')
  const runId = get('run-id', `run-${new Date().toISOString().replace(/[^0-9]/g, '')}`)
  if (!/^[a-zA-Z0-9][a-zA-Z0-9_-]{2,39}$/.test(runId)) throw Error('runId deve conter 3–40 letras/números/_/-')
  const rooms = integer('rooms', 1, 1, 25), shards = integer('shards', 1, 1, rooms), shardIndex = integer('shard-index', 0, 0, shards - 1)
  const playersPerRoom = integer('players-per-room', 4, 4, 4)
  const windowMs = integer('window-ms', profile === 'smoke' ? 0 : 900000, profile === 'smoke' ? 0 : 1000, 86400000)
  const rampMs = integer('ramp-ms', profile === 'smoke' ? 0 : 120000, 0, 3600000)
  const drainMs = integer('drain-ms', 300000, 1000, 3600000)
  const totalMs = integer('total-ms', rampMs + windowMs + drainMs + 180000, 1000, 172800000)
  if (totalMs < rampMs + windowMs + drainMs) throw Error('total-ms deve cobrir rampa, janela e drenagem')
  const startText = get('start-at'), startAt = startText ? Date.parse(startText) : Date.now() + 5000
  if (!Number.isFinite(startAt)) throw Error('start-at inválido; use ISO UTC')
  if (shards > 1 && (!startText || !get('run-id'))) throw Error('shards exigem run-id e start-at comuns e explícitos')
  const sampleMs = integer('sample-ms', 1000, 250, 10000)
  const known = ['url','supabase-origin','test-backend','profile','run-id','rooms','shards','shard-index','players-per-room','window-ms','ramp-ms','drain-ms','total-ms','start-at','sample-ms','entry-interval-ms','reaction-ms','poll-ms','idle-ms','action-timeout-ms','rounds','turn-seconds','output','seed','headless','channel','executable-path','smoke-proof','dry-run','max-sync-ms','max-action-ms','max-reconnect-ms','max-error-rate','max-clock-skew-ms','offline-ms','spectators-per-room','trace-sample-rooms']
  known.push('coordinator-url')
  for (const name of Object.keys(cli)) if (!known.includes(name)) throw Error(`Opção desconhecida: ${name}`)
  if (![60, 90, 120, 180].includes(Number(get('turn-seconds', 180)))) throw Error('turn-seconds deve corresponder a um controle real: 60/90/120/180')
  if (profile !== 'functional' && profile !== 'reduced-motion' && (rooms !== 1 || shards !== 1)) throw Error('smoke/resilience/rapid-confirm exigem 1 sala e 1 shard')
  return {
    url: target.href, supabaseOrigin: db.origin, profile, runId, rooms, shards, shardIndex, playersPerRoom, coordinatorUrl: get('coordinator-url'),
    windowMs, rampMs, drainMs, totalMs, startAt, sampleMs,
    entryIntervalMs: integer('entry-interval-ms', 500, 0, 60000), reactionMs: integer('reaction-ms', 600, 0, 30000),
    pollMs: integer('poll-ms', 250, 100, 5000), idleMs: integer('idle-ms', 120000, 1000, 3600000),
    actionTimeoutMs: integer('action-timeout-ms', 45000, 1000, 300000),
    rounds: integer('rounds', profile === 'smoke' ? 1 : 5, 1, 5),
    turnSeconds: integer('turn-seconds', 180, 60, 180),
    output: path.resolve(get('output', 'results')), seed: get('seed', 'salesgame-lab-1'),
    headless: flag('headless', true), channel: get('channel', 'chrome'), executablePath: get('executable-path'),
    smokeProof: get('smoke-proof'), dryRun: flag('dry-run'), maxSyncMs: integer('max-sync-ms', 10000, 100, 120000),
    maxActionMs: integer('max-action-ms', 45000, 100, 300000), maxReconnectMs: integer('max-reconnect-ms', 30000, 1000, 300000),
    maxErrorRate: integer('max-error-rate', 0, 0, 100) / 100,
    maxClockSkewMs: integer('max-clock-skew-ms', 250, 0, 1000), offlineMs: integer('offline-ms', 5000, 1000, 60000),
    spectatorsPerRoom: integer('spectators-per-room', 0, 0, 1), traceSampleRooms: integer('trace-sample-rooms', 1, 0, 25),
  }
}

export const roomIndexes = ({ rooms, shards, shardIndex }) => Array.from({ length: rooms }, (_, i) => i).filter(i => i % shards === shardIndex)
export const roomName = (runId, room, generation) => `SG-${runId}-r${String(room).padStart(2, '0')}-g${String(generation).padStart(3, '0')}`
export const playerName = (runId, room, seat) => `L-${runId}-r${room}-${'ABCD'[seat]}`
export function rampOffset(room, config) {
  const stages = [1, 5, 10, 15, 20, 25].filter(n => n <= config.rooms)
  if (stages.at(-1) !== config.rooms) stages.push(config.rooms)
  const stage = stages.findIndex(count => room < count)
  return stages.length <= 1 ? 0 : stage * config.rampMs / (stages.length - 1)
}
export function decisionRandom(seed, identity) {
  let state = createHash('sha256').update(`${seed}:${identity}`).digest().readUInt32LE(0)
  return () => { state = (Math.imul(state, 1664525) + 1013904223) >>> 0; return state / 4294967296 }
}
