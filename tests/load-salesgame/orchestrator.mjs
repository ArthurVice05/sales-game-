import { pathToFileURL } from 'node:url'
import { readFile, mkdir, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { setTimeout as pause } from 'node:timers/promises'
import { parseConfig, roomIndexes, rampOffset } from './config.mjs'
import { Metrics } from './metrics.mjs'
import { evaluateCriteria } from './criteria.mjs'
import { RoomScenario } from './room-scenario.mjs'
import { syncClock, registerShard, configFingerprint } from './coordination.mjs'

export async function run(config) {
  if (config.dryRun) { console.log(JSON.stringify({ config, roomsOnShard: roomIndexes(config), browsersOpened: 0 }, null, 2)); return 0 }
  if (config.profile !== 'smoke') {
    if (!config.smokeProof) throw Error('Execute primeiro smoke; --smoke-proof=.../results.json é obrigatório para ampliar ou injetar falhas')
    const smoke = JSON.parse(await readFile(config.smokeProof, 'utf8'))
    if (smoke.status !== 'PASS' || smoke.config.profile !== 'smoke' || smoke.config.url !== config.url || smoke.config.supabaseOrigin !== config.supabaseOrigin || !smoke.criteria?.pass) throw Error('Smoke não aprovado ou destino diferente; carga bloqueada')
  }
  const clockInfo = await syncClock(config), clock = () => Date.now() + clockInfo.offsetMs
  const metrics = new Metrics(config, clock), controller = new AbortController(), { signal } = controller
  const onSignal = () => controller.abort()
  process.once('SIGINT', onSignal); process.once('SIGTERM', onSignal)
  const timeout = setTimeout(() => controller.abort(), config.totalMs)
  const registry = { roomIds: new Set(), roomRowIds: new Set(), roomNames: new Set(), pending: new Set() }
  let browser, sampling = false, sampleTimer, criteria, status = 'FAIL'
  const scenarios = []
  const windowEnd = config.startAt + config.rampMs + config.windowMs
  const drainDeadline = windowEnd + config.drainMs
  try {
    const { chromium } = await import('playwright')
    browser = await chromium.launch({ headless: config.headless, ...(config.executablePath ? { executablePath: config.executablePath } : { channel: config.channel }), args: [] })
    await registerShard(config, clockInfo, signal)
    const sample = async () => {
      if (sampling) return
      sampling = true
      try { await Promise.allSettled(scenarios.map(s => s.observe())); metrics.sample() } finally { sampling = false }
    }
    sampleTimer = setInterval(() => { sample().catch(e => metrics.fail('sampler', { detail: e.message })) }, config.sampleMs)
    const drainTimer = setTimeout(() => controller.abort(), Math.max(0, drainDeadline - clock()))
    try {
      await Promise.all(roomIndexes(config).map(async index => {
        const scenario = new RoomScenario({ browser, config, index, metrics, registry, signal }); scenarios.push(scenario)
        try {
          await pause(Math.max(0, config.startAt + rampOffset(index, config) - clock()), undefined, { signal })
          await scenario.setup()
          do {
            if (signal.aborted) break
            if (config.profile !== 'smoke' && clock() >= windowEnd) break
            await scenario.start(); await scenario.play()
          } while (config.profile !== 'smoke' && clock() < windowEnd)
        } catch (error) { await scenario.fail(error) }
        finally { await scenario.dispose() }
      }))
      await sample()
    } finally { clearTimeout(drainTimer) }
    const endingClock = await syncClock(config)
    if (Math.abs(endingClock.offsetMs - clockInfo.offsetMs) > config.maxClockSkewMs) metrics.fail('clock-drift', { detail: 'relógio mudou além da tolerância' })
    criteria = evaluateCriteria(config, metrics)
    status = criteria.pass && !signal.aborted ? 'PASS' : 'FAIL'
    return status === 'PASS' ? 0 : 1
  } catch (error) {
    metrics.fail('environment-or-run', { detail: error.message })
    return 1
  } finally {
    clearInterval(sampleTimer); clearTimeout(timeout)
    controller.abort()
    await Promise.allSettled(scenarios.map(s => s.dispose()))
    await browser?.close().catch(() => {})
    const { directory } = await metrics.save(status, { criteria, clock: clockInfo, fingerprint: configFingerprint(config),
      resources: { lobbies: [...registry.roomIds], rooms: [...registry.roomRowIds], names: [...registry.roomNames] },
      limitations: ['O oráculo das cartas reutiliza o contrato puro; fixtures independentes cobrem casos fixos.', 'WebGL funcional preservado; resultados não equivalem a Safari/iOS ou dispositivos móveis.', 'Memória do navegador está incluída no uso global do host, não no RSS de Node.', 'Aplicação única sem IDs correlacionáveis reprova o critério; não é inferida só pelo saldo.'] })
    console.log(`${status}: ${directory}`)
    process.removeListener('SIGINT', onSignal); process.removeListener('SIGTERM', onSignal)
  }
}

export async function main(args = process.argv.slice(2), env = process.env) {
  try { return await run(parseConfig(args, env)) }
  catch (error) {
    const directory = path.resolve(env.SG_LAB_OUTPUT || 'results', 'blocked')
    await mkdir(directory, { recursive: true })
    const evidence = { status: 'BLOCKED', at: new Date().toISOString(), reason: error.message, browsersOpened: 0, roomsCreated: 0, capacityApproved: false }
    await writeFile(path.join(directory, 'preflight.json'), JSON.stringify(evidence, null, 2))
    console.error(`BLOCKED: ${error.message}`)
    return 2
  }
}
if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) process.exitCode = await main()
