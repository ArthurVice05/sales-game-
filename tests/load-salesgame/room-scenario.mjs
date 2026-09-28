import { performance } from 'node:perf_hooks'
import { PlayerDriver } from './player-driver.mjs'
import { playerName, roomName } from './config.mjs'
import { canonicalState, LabFailure, verifyRoster, verifyInitial, verifyDelta } from './assertions.mjs'
import { classifyModal, respondToModal } from './modal-policy.mjs'
import { rankPlayersByPatrimonio } from '../../src/game/patrimonio.js'
import { mkdir } from 'node:fs/promises'
import path from 'node:path'
import { saveSanitizedTrace } from './safety.mjs'

export class RoomScenario {
  constructor({ browser, config, index, metrics, registry, signal }) {
    Object.assign(this, { browser, config, index, metrics, registry, signal })
    this.drivers = []; this.spectators = []; this.generation = 0; this.expected = []; this.record = null
  }
  async setup() {
    for (let seat = 0; seat < 4; seat++) {
      const context = await this.browser.newContext({ viewport: { width: 1440, height: 1000 }, locale: 'pt-BR', reducedMotion: this.config.profile === 'reduced-motion' ? 'reduce' : 'no-preference', serviceWorkers: 'block' })
      const page = await context.newPage()
      const driver = new PlayerDriver({ config: this.config, context, page, name: playerName(this.config.runId, this.index, seat), roomIndex: this.index, seat, metrics: this.metrics, registry: this.registry, signal: this.signal })
      this.drivers.push(driver); await driver.setup()
      await driver.sleep(this.config.entryIntervalMs)
    }
  }
  async start() {
    const name = roomName(this.config.runId, this.index, this.generation++)
    this.record = { name, index: this.index, generation: this.generation - 1, status: 'starting', startedAt: null, endedAt: null, identities: [], actions: 0, economicChecks: 0, unproven: [], injected: [] }
    this.metrics.rooms.push(this.record)
    for (const driver of this.drivers) {
      driver.snapshot = null; driver.seenSnapshots = []
      driver.loanUnavailable = false
      // Reset trace per match. No videos; one rotating trace per context, discarded on success.
      const fullTrace = this.index < this.config.traceSampleRooms
      await driver.context.tracing.start({ screenshots: fullTrace, snapshots: fullTrace, sources: false })
      driver.tracing = true
    }
    const [host, ...guests] = this.drivers
    const started = performance.now()
    await host.createRoom(name)
    this.record.roomId = host.roomId
    // Sequential seat entry within one room; rooms themselves run concurrently.
    for (const guest of guests) { await guest.joinRoom(name, host.roomId); await guest.sleep(this.config.entryIntervalMs) }
    const ids = this.drivers.map(d => d.id)
    if (new Set(ids).size !== 4) throw new LabFailure('identity', 'contextos geraram IDs duplicados')
    this.expected = this.drivers.map(d => ({ id: d.id, name: d.name }))
    this.record.identities = this.expected
    await host.page.getByRole('group', { name: 'Número de rodadas', exact: true }).getByRole('button', { name: String(this.config.rounds), exact: true }).click()
    await host.page.getByRole('group', { name: 'Tempo por jogada', exact: true }).getByRole('button', { name: `${this.config.turnSeconds}s`, exact: true }).click()
    const zeroBots = host.page.getByRole('button', { name: '0 máquinas', exact: true })
    if (await zeroBots.isVisible().catch(() => false) && await zeroBots.getAttribute('aria-pressed') !== 'true') throw new LabFailure('ai', 'IA já ativa no lobby; laboratório não altera flags')
    await Promise.all(this.drivers.map(d => d.ready(this.drivers.map(p => p.name))))
    await host.waitUntil(async () => host.page.getByRole('button', { name: 'Iniciar partida', exact: true }).isEnabled(), 'host não pode iniciar')
    await host.page.getByRole('button', { name: 'Iniciar partida', exact: true }).click()
    await Promise.all(this.drivers.map(d => d.waitForGame()))
    await this.converge()
    verifyInitial(host.snapshot.players)
    this.record.startedAt = this.metrics.clock(); this.record.status = 'running'
    this.metrics.latency('match-start', performance.now() - started, { room: host.roomId })
    this.metrics.event('match-started', { room: host.roomId, players: ids, name })
    if (this.config.spectatorsPerRoom) await this.addSpectator(name)
  }
  async addSpectator(name) {
    const context = await this.browser.newContext({ viewport: { width: 1440, height: 1000 } }), page = await context.newPage()
    const driver = new PlayerDriver({ config: this.config, context, page, name: `${name}-viewer`, roomIndex: this.index, seat: 0, metrics: this.metrics, registry: this.registry, signal: this.signal, spectator: true })
    this.spectators.push(driver); await driver.setup(); await driver.enterHome()
    const card = page.locator('.lobbyCard').filter({ has: page.getByText(name, { exact: true }) })
    await card.getByRole('button', { name: /Assistir/ }).click()
    driver.roomId = this.record.roomId
    await driver.waitUntil(async () => (await driver.observe()).inGame, 'espectador não entrou')
    if ((await driver.observe()).rollEnabled) throw new LabFailure('spectator-authority', 'espectador com botão de rolar habilitado')
  }
  async observe() {
    return Promise.all([...this.drivers, ...this.spectators].map(async driver => {
      try { return await driver.observe() } catch (error) { this.metrics.player(driver.name, { connected: false }); return null }
    }))
  }
  async converge() {
    const host = this.drivers[0]
    await host.waitUntil(async () => {
      const views = await Promise.all(this.drivers.map(d => d.observe()))
      const states = this.drivers.map(d => d.snapshot)
      if (states.some(s => !s?.players?.length)) return false
      states.forEach(s => { verifyRoster(s.players, this.expected); if (s.botCount) throw new LabFailure('ai', 'botCount no snapshot') })
      // Transport equality alone is insufficient: positions, visible money/ranking and round must converge too.
      const domKey = ui => JSON.stringify({ tokens: ui.tokens, summary: ui.summary, round: ui.round, final: ui.final, finalRows: ui.finalRows })
      return states.every(s => canonicalState(s) === canonicalState(states[0])) && views.every(ui => domKey(ui) === domKey(views[0]))
    }, 'divergência de turno/saldo/posição/rodada entre participantes', this.config.maxSyncMs)
  }
  async play() {
    let lastProgress = performance.now(), lastKey = '', resilienceDone = false
    const host = this.drivers[0]
    while (true) {
      host.checkAbort()
      const views = await Promise.all(this.drivers.map(d => d.observe()))
      const key = JSON.stringify(views.map(ui => ({ tokens: ui.tokens, summary: ui.summary, modal: ui.modal?.title, final: ui.final })))
      if (key !== lastKey) { lastProgress = performance.now(); lastKey = key }
      if (performance.now() - lastProgress > this.config.idleMs) throw new LabFailure('room-stalled', `sala ${this.record.roomId} sem progresso`)
      for (let i = 0; i < views.length; i++) {
        if (views[i].rollEnabled && views[i].activeName !== this.drivers[i].name) throw new LabFailure('unauthorized-control', `${this.drivers[i].name} consegue rolar fora do turno`)
        if (views[i].tokens.some(t => !this.expected.some(p => t.label?.startsWith(`${p.name} está na casa `)))) throw new LabFailure('contamination', 'peão de outra sala no DOM')
      }
      if (views.every(ui => ui.final)) { await this.finish(); return }
      if (this.config.profile === 'resilience' && this.record.actions >= 4 && !resilienceDone) {
        resilienceDone = true; await this.resilience(); lastProgress = performance.now(); continue
      }
      let actorIndex = views.findIndex(ui => ui.modal && classifyModal(ui.modal) !== 'final')
      if (actorIndex < 0) actorIndex = views.findIndex(ui => ui.rollEnabled)
      if (actorIndex < 0) { this.drivers.forEach((d, i) => d.setState(views[i].final ? 'ended' : 'waiting-turn')); await host.sleep(this.config.pollMs); continue }
      const actor = this.drivers[actorIndex], modal = views[actorIndex].modal
      const before = structuredClone(actor.snapshot)
      if (!before) throw new LabFailure('missing-observation', 'snapshot de transporte não disponível antes da ação')
      const started = performance.now()
      let action
      if (modal) { actor.setState('responding-modal'); action = await respondToModal(actor, modal) }
      else { await actor.roll(); action = { kind: 'roll', economic: false } }
      this.record.actions++
      actor.setState('waiting-sync')
      // A menu opening another local modal has no economic effect to synchronize.
      if (action.economic || action.kind === 'roll' || !(await actor.observe()).modal) {
        await this.converge()
        this.metrics.latency('action-all-visible', performance.now() - (actor.lastActionAt ?? started), { room: this.record.roomId, player: actor.name, action: action.kind })
        this.metrics.latency('sync-after-local-visible', performance.now() - actor.lastVisibleAt, { room: this.record.roomId, player: actor.name, action: action.kind })
      }
      if (action.economic) {
        const nextModal = (await actor.observe()).modal
        if (nextModal && ['recovery','loan','insufficient','bankruptcy'].includes(classifyModal(nextModal))) {
          this.record.unproven.push({ kind: action.kind, reason: 'efeito encadeado com recuperação: não isolar delta antes de terminar a cadeia' })
        } else if (action.expectation) {
          verifyDelta(before.players, actor.snapshot.players, actor.id, action.expectation.delta)
          if (action.expectation.certificate && !actor.snapshot.players.find(p => p.id === actor.id)?.trainingsByVendor?.comum?.includes(action.expectation.certificate)) throw new LabFailure('certificate-effect', 'certificado não apareceu no jogador correto')
          this.record.economicChecks++
          const oldActions = before.players.find(p => p.id === actor.id)?.lastActions ?? {}
          const newActions = Object.keys(actor.snapshot.players.find(p => p.id === actor.id)?.lastActions ?? {}).filter(id => !(id in oldActions))
          this.metrics.event('effect-check', { room: this.record.roomId, actorId: actor.id, cardId: action.expectation.id, actionIds: newActions, expected: action.expectation.delta, oracle: action.expectation.oracle })
          if (newActions.length !== 1) this.record.unproven.push({ kind: action.kind, reason: 'aplicação única sem correlação inequívoca de lastActions', actionIds: newActions })
        } else if (action.kind === 'bankruptcy') {
          if (!actor.snapshot.players.find(p => p.id === actor.id)?.bankrupt) throw new LabFailure('bankruptcy', 'confirmação não marcou o jogador correto')
        } else this.record.unproven.push({ kind: action.kind, reason: 'sem valor esperado independente' })
      }
      lastProgress = performance.now()
    }
  }
  async resilience() {
    for (const [driver, action] of [[this.drivers[1], 'reload'], [this.drivers[2], 'offline'], [this.drivers[0], 'reload-host']]) {
      const started = performance.now(); driver.injected = true
      this.record.injected.push({ player: driver.name, action, at: this.metrics.clock() })
      try {
        if (action === 'offline') { await driver.context.setOffline(true); await driver.sleep(this.config.offlineMs); await driver.context.setOffline(false) }
        else await driver.page.reload({ waitUntil: 'domcontentloaded' })
        driver.injected = false
        await driver.captureIdentity(); await driver.waitForGame(); await this.converge()
        this.metrics.latency('reconnect', performance.now() - started - (action === 'offline' ? this.config.offlineMs : 0), { room: this.record.roomId, player: driver.name, action })
      } finally { driver.injected = false; await driver.context.setOffline(false) }
    }
  }
  async finish() {
    await this.converge()
    const expected = rankPlayersByPatrimonio(this.drivers[0].snapshot.players)
    for (const driver of this.drivers) {
      const ui = await driver.observe()
      if (ui.finalNames.length !== 4 || expected.some((p, i) => !ui.finalNames[i]?.includes(p.name))) throw new LabFailure('final-ranking', 'ordem/número dos jogadores diverge do ranking real')
      driver.setState('ended')
    }
    this.record.status = 'complete'; this.record.endedAt = this.metrics.clock()
    this.record.final = expected.map(p => ({ id: p.id, name: p.name, patrimonio: p.patrimonio, bankrupt: p.bankrupt }))
    await this.evidence(false)
    await Promise.all(this.drivers.map(driver => driver.page.getByRole('button', { name: 'Voltar aos Lobbies', exact: true }).click()))
    for (const spectator of this.spectators) { await spectator.context.close(); this.metrics.players.delete(spectator.name) }
    this.spectators = []
  }
  async evidence(failure) {
    const directory = path.join(this.config.output, this.config.runId, `shard-${this.config.shardIndex}`, 'evidence', this.record?.name || `room-${this.index}`)
    await mkdir(directory, { recursive: true })
    for (const driver of this.drivers) {
      if (failure) await driver.page.screenshot({ path: path.join(directory, `${driver.seat}.png`), fullPage: true }).catch(() => {})
      if (driver.tracing) {
        try {
          if (failure || this.index < this.config.traceSampleRooms) await saveSanitizedTrace(driver.context, path.join(directory, `${driver.seat}.zip`))
          else await driver.context.tracing.stop()
        } catch (error) { this.metrics.event('evidence-error', { message: error.message }) }
        driver.tracing = false
      }
    }
  }
  async fail(error) {
    if (this.record) { this.record.status = 'failed'; this.record.endedAt = this.metrics.clock() }
    this.metrics.fail(error.code || 'driver-error', { room: this.record?.roomId, detail: error.message })
    this.drivers.forEach(d => d.setState('failed'))
    await this.evidence(true)
  }
  async dispose() {
    await Promise.allSettled([...this.drivers, ...this.spectators].map(async d => { await d.context.close(); this.metrics.players.delete(d.name) }))
  }
}
