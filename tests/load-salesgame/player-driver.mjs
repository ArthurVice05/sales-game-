import { performance } from 'node:perf_hooks'
import { setTimeout as pause } from 'node:timers/promises'
import { readUI, observeTransport } from './observation.mjs'
import { installRequestGuard } from './safety.mjs'
import { decisionRandom } from './config.mjs'
import { LabFailure } from './assertions.mjs'

export const PLAYER_STATES = Object.freeze(['waiting-lobby','waiting-start','waiting-turn','ready-roll','waiting-move','responding-modal','waiting-sync','ended','failed'])
const visibleChange = ui => JSON.stringify({ tokens: ui.tokens, summary: ui.summary, modal: ui.modal?.title, final: ui.final })

export class PlayerDriver {
  constructor({ config, context, page, name, roomIndex, seat, metrics, registry, signal, spectator = false }) {
    Object.assign(this, { config, context, page, name, roomIndex, seat, metrics, registry, signal, spectator })
    this.strategy = seat % 2 ? 'save' : 'buy'; this.random = decisionRandom(config.seed, name)
    this.state = 'waiting-lobby'; this.roomId = null; this.id = null; this.snapshot = null; this.snapshotAt = 0; this.seenSnapshots = []; this.realtimeSockets = 0; this.injected = false
  }
  setState(state) {
    if (!PLAYER_STATES.includes(state)) throw Error(`estado inválido: ${state}`)
    this.state = state; this.metrics.player(this.name, { state })
  }
  async setup() {
    this.page.setDefaultTimeout(this.config.actionTimeoutMs)
    observeTransport(this, this.registry)
    await installRequestGuard(this.context, this.config, this.registry, detail => {
      this.guardViolation = detail; this.metrics.fail('request-guard', { player: this.name, detail })
    })
  }
  checkAbort() {
    if (this.signal.aborted) throw new LabFailure('run-deadline', 'prazo/cancelamento do laboratório')
    if (this.guardViolation) throw new LabFailure('request-guard', this.guardViolation)
  }
  async sleep(ms) { this.checkAbort(); await pause(ms, undefined, { signal: this.signal }); this.checkAbort() }
  async waitUntil(predicate, reason, timeout = this.config.actionTimeoutMs) {
    const start = performance.now()
    while (performance.now() - start < timeout) {
      this.checkAbort()
      if (await predicate()) return
      await this.sleep(this.config.pollMs)
    }
    throw new LabFailure('inactivity', `${this.name}: ${reason}`)
  }
  async observe() {
    const ui = await readUI(this.page)
    this.ui = ui
    const transportAlive = this.realtimeSockets > 0 || performance.now() - this.snapshotAt < 5000
    this.metrics.player(this.name, { room: this.roomId, connected: ui.online && transportAlive && !this.injected,
      inGame: ui.inGame, ended: ui.final, failed: this.state === 'failed', state: this.state,
      spectator: this.spectator, lastObserved: this.metrics.clock() })
    return ui
  }
  async dismissTutorial() {
    const skip = this.page.getByRole('button', { name: 'Pular tutorial', exact: true })
    if (await skip.isVisible().catch(() => false)) await skip.click()
  }
  async enterHome() {
    await this.page.goto(this.config.url, { waitUntil: 'domcontentloaded' })
    await this.dismissTutorial()
    await this.page.getByRole('textbox', { name: 'Seu nome para jogar online', exact: true }).fill(this.name)
    await this.page.getByRole('button', { name: 'Jogar online', exact: true }).click()
    await this.page.getByRole('heading', { name: 'Salas de jogo', exact: true }).waitFor()
    this.checkAbort()
  }
  async captureIdentity() {
    const roomId = new URL(this.page.url()).searchParams.get('room')
    if (!roomId || !this.registry.roomIds.has(roomId)) throw new LabFailure('room-scope', 'URL não aponta para a sala criada por esta execução')
    this.roomId = roomId
    const identity = await this.page.evaluate(code => {
      const raw = localStorage.getItem(`sg:matchIdentity:${code.toLowerCase()}`)
      const parsed = raw ? JSON.parse(raw) : null
      return parsed ? { playerId: parsed.playerId, playerName: parsed.playerName } : null
    }, roomId)
    if (!identity?.playerId || identity.playerName !== this.name) throw new LabFailure('identity', 'identidade gerada pela interface ausente/incorreta')
    if (this.id && this.id !== identity.playerId) throw new LabFailure('identity-changed', 'reconexão assumiu outro assento')
    this.id = identity.playerId
    this.metrics.event('identity', { room: roomId, player: this.name, id: this.id, seatExpected: this.seat })
  }
  async createRoom(name) {
    this.registry.roomNames.add(name)
    const start = performance.now()
    await this.enterHome()
    await this.page.getByRole('button', { name: 'Criar sala', exact: true }).click()
    const dialog = this.page.getByRole('dialog', { name: 'Criar nova sala' })
    await dialog.getByRole('textbox', { name: 'Nome da sala' }).fill(name)
    await dialog.getByRole('button', { name: 'Criar sala', exact: true }).click()
    await this.page.getByRole('heading', { name, exact: true }).waitFor()
    await this.captureIdentity()
    this.metrics.latency('room-create', performance.now() - start, { room: this.roomId, player: this.name })
    this.setState('waiting-start')
  }
  async joinRoom(name, expectedId) {
    const start = performance.now()
    await this.enterHome()
    // O card da lista mostra o nome em <div class="lobbyCardName">, não em heading.
    // O heading com o nome só existe depois, já na sala de espera.
    const card = this.page.locator('.lobbyCard').filter({ has: this.page.getByText(name, { exact: true }) })
    await card.getByRole('button', { name: /^Entrar/ }).click()
    await this.page.getByRole('heading', { name, exact: true }).waitFor()
    await this.captureIdentity()
    if (this.roomId !== expectedId) throw new LabFailure('wrong-room', 'entrada caiu em outra sala')
    this.metrics.latency('room-join', performance.now() - start, { room: this.roomId, player: this.name })
    this.setState('waiting-start')
  }
  async ready(names) {
    await this.waitUntil(async () => {
      const roster = await this.page.locator('.playerLobbyPlayerName').allTextContents()
      return roster.length === 4 && [...roster].sort().join('|') === [...names].sort().join('|')
    }, 'composição da sala não converge')
    await this.page.getByRole('button', { name: 'Ficar pronto', exact: true }).click()
    await this.page.getByRole('button', { name: 'Marcar como não pronto', exact: true }).waitFor()
  }
  async waitForGame() {
    await this.waitUntil(async () => { await this.dismissTutorial(); return (await this.observe()).inGame && this.snapshot?.players.length === 4 }, 'partida não iniciou')
    // A aba Ranking é conveniência de leitura, não um controle de jogo: em alguns
    // layouts ela fica visível mas não clicável (tabindex -1 / fora do painel
    // ativo). Falhar aqui esconderia o resultado real da partida.
    const ranking = this.page.getByRole('tab', { name: 'Ranking', exact: true })
    try { await ranking.click({ timeout: 5000 }) } catch { this.metrics.event('ranking-tab-unavailable', { player: this.name }) }
    this.setState('waiting-turn')
  }
  async clickObserved(locator, action) {
    const before = await this.observe(), beforeKey = visibleChange(before)
    const reactionStarted = performance.now()
    await this.sleep(this.config.profile === 'rapid-confirm' ? 0 : this.config.reactionMs)
    this.metrics.latency('script-reaction', performance.now() - reactionStarted, { room: this.roomId, player: this.name, action })
    if (!await locator.isEnabled()) throw new LabFailure('action-disabled', action)
    const started = performance.now()
    this.lastActionAt = started
    this.metrics.actions++
    this.metrics.event('action', { room: this.roomId, player: this.name, actorId: this.id, action,
      turnSeq: this.snapshot?.turnSeq, stateId: this.snapshot?.stateId, version: this.snapshot?.version, injected: this.injected })
    if (this.config.profile === 'rapid-confirm' && !action.startsWith('roll')) await locator.dblclick({ delay: 25 })
    else await locator.click()
    let animationStart = null, animationEnd = null
    await this.waitUntil(async () => {
      const current = await this.observe()
      if (current.rolling && animationStart === null) animationStart = performance.now()
      if (animationStart !== null && !current.rolling && animationEnd === null) animationEnd = performance.now()
      return visibleChange(current) !== beforeKey && !current.rolling
    }, `ação sem efeito visível: ${action}`)
    this.metrics.latency('action-visible', performance.now() - started, { room: this.roomId, player: this.name, action })
    this.lastVisibleAt = performance.now()
    if (animationStart !== null && animationEnd !== null) this.metrics.latency('observed-animation', animationEnd - animationStart, { room: this.roomId, player: this.name, action })
  }
  async roll() {
    const ui = await this.observe()
    if (!ui.rollEnabled || ui.activeName !== this.name || this.snapshot?.turnPlayerId !== this.id) throw new LabFailure('unauthorized-roll', this.name)
    this.setState('ready-roll')
    await this.clickObserved(this.page.getByRole('button', { name: /Rolar (Dado|dado)/ }).filter({ visible: true }), 'roll')
    this.setState('waiting-move')
  }
}
