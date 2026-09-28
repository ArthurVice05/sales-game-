import { readFile, writeFile, mkdir } from 'node:fs/promises'
import { pathToFileURL } from 'node:url'
import path from 'node:path'
import { assessConcurrency, percentiles } from './metrics.mjs'

export function consolidate(reports) {
  if (!reports.length) throw Error('Nenhum relatório')
  const first = reports[0], c = first.config
  if (reports.length !== c.shards || new Set(reports.map(r => r.config.shardIndex)).size !== c.shards) throw Error('Shards ausentes ou duplicados')
  if (reports.some(r => r.fingerprint !== first.fingerprint || r.config.runId !== c.runId)) throw Error('Configurações/runs incompatíveis')
  const identityOwners = new Map(), lobbyIds = new Set()
  for (const report of reports) {
    if (!report.clock || report.clock.uncertaintyMs > c.maxClockSkewMs) throw Error('Erro de relógio desconhecido/excessivo')
    for (const room of report.rooms) {
      if (lobbyIds.has(room.roomId)) throw Error('Sala duplicada entre relatórios')
      if (room.roomId) lobbyIds.add(room.roomId)
      for (const player of room.identities) {
        if (identityOwners.has(player.id) && identityOwners.get(player.id) !== room.index) throw Error('Identidade pertence a salas concorrentes diferentes')
        identityOwners.set(player.id, room.index)
      }
    }
  }
  const start = c.startAt + c.rampMs, end = start + c.windowMs, samples = []
  const sorted = reports.map(r => [...r.samples].sort((a, b) => a.at - b.at))
  for (let at = start; at <= end; at = Math.min(end, at + c.sampleMs)) {
    const row = { at, active: 0, connected: 0, rooms: 0, waiting: 0, spectators: 0 }
    for (let index = 0; index < sorted.length; index++) {
      const list = sorted[index], before = list.findLast(s => s.at <= at), after = list.find(s => s.at >= at)
      if (!before || !after || after.at - before.at > c.sampleMs * 1.75) continue
      for (const field of ['active','connected','rooms','waiting','spectators']) row[field] += Math.min(before[field] || 0, after[field] || 0)
    }
    samples.push(row)
    if (at === end) break
  }
  const concurrency = assessConcurrency(samples, start, end, c.rooms * 4, c.sampleMs)
  const latencies = reports.flatMap(r => r.latencies)
  const summaries = Object.fromEntries([...new Set(latencies.map(l => l.kind))].map(kind => [kind, percentiles(latencies.filter(l => l.kind === kind).map(l => l.ms))]))
  const pass = reports.every(r => r.status === 'PASS' && r.criteria?.pass) && concurrency.pass
  return { status: pass ? 'PASS' : 'FAIL', runId: c.runId, profile: c.profile, targetPlayers: c.rooms * 4,
    capacity100Approved: pass && c.rooms === 25 && c.profile === 'functional', measuredWindowMs: c.windowMs,
    concurrency, summaries, samples, completed: reports.flatMap(r => r.rooms).filter(r => r.status === 'complete').length,
    clockUncertaintyMs: Math.max(...reports.map(r => r.clock.uncertaintyMs)),
    notes: ['Latências calculadas dentro de cada executor com relógio monotônico; nunca subtraídas entre máquinas.', 'Sobreposição usa relógios corrigidos pelo coordenador e amostragem conservadora por intervalo.', 'PASS vale apenas para o perfil, ambiente, janela e metas registrados; não é uma garantia de produção.'] }
}

async function main() {
  const args = process.argv.slice(2), outputArg = args.find(a => a.startsWith('--output='))
  const files = args.filter(a => !a.startsWith('--'))
  const output = path.resolve(outputArg?.slice(9) || 'results/consolidated')
  await mkdir(output, { recursive: true })
  try {
    const result = consolidate(await Promise.all(files.map(async file => JSON.parse(await readFile(file, 'utf8')))))
    await writeFile(path.join(output, 'results.json'), JSON.stringify(result, null, 2))
    await writeFile(path.join(output, 'concurrency.csv'), ['at,active,connected,rooms,waiting,spectators', ...result.samples.map(s => [s.at,s.active,s.connected,s.rooms,s.waiting,s.spectators].join(','))].join('\n'))
    await writeFile(path.join(output, 'report.md'), `# ${result.runId}\n\n${result.status}. Perfil ${result.profile}. Meta ${result.targetPlayers} jogadores. Janela ${result.measuredWindowMs} ms.\n\n100 jogadores comprovados: ${result.capacity100Approved ? 'sim, nesta execução' : 'não'}.\n\n\`\`\`json\n${JSON.stringify({ concurrency: result.concurrency, summaries: result.summaries, notes: result.notes }, null, 2)}\n\`\`\`\n`)
    console.log(`${result.status}: ${output}`); return result.status === 'PASS' ? 0 : 1
  } catch (error) {
    await writeFile(path.join(output, 'results.json'), JSON.stringify({ status: 'FAIL', capacity100Approved: false, reason: error.message }, null, 2))
    console.error(error.message); return 1
  }
}
if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) process.exitCode = await main()
