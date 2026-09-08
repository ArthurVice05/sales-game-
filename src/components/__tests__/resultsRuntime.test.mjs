import test from 'node:test'
import assert from 'node:assert/strict'
import { createResultsTimeline, resultsEntries } from '../final-winners/resultsPresentation.js'
const runtimeModule = await import('../final-winners/resultsRuntime.js').catch(() => ({}))

function harness({ reduced = false, failure = false } = {}) {
  let now = 0, nextId = 0, renders = 0, releases = 0, observers = 0, constructed = 0
  const frames = new Map(), timers = new Map(), listeners = new Map(), motionListeners = new Set()
  const canvasListeners = new Map()
  const host = { clientWidth: 720, clientHeight: 280, children: [], appendChild(canvas) { this.children.push(canvas) } }
  const canvas = {
    setAttribute() {},
    addEventListener: (type, listener) => canvasListeners.set(type, listener),
    removeEventListener: type => canvasListeners.delete(type),
    remove() { host.children = host.children.filter(child => child !== canvas) },
  }
  const renderer = {
    domElement: canvas, setPixelRatio() {}, setClearColor() {}, setSize() {},
    render() { renders++ }, dispose() { releases++ }, forceContextLoss() {},
  }
  const env = {
    devicePixelRatio: 3,
    matchMedia: () => ({ matches: reduced, addEventListener: (_, cb) => motionListeners.add(cb), removeEventListener: (_, cb) => motionListeners.delete(cb) }),
    requestAnimationFrame: cb => { const id = ++nextId; frames.set(id, cb); return id },
    cancelAnimationFrame: id => frames.delete(id),
    setTimeout: cb => { const id = ++nextId; timers.set(id, cb); return id },
    clearTimeout: id => timers.delete(id),
    addEventListener: (type, cb) => listeners.set(type, cb),
    removeEventListener: type => listeners.delete(type),
    ResizeObserver: class { observe() { observers++ } disconnect() { observers-- } },
  }
  const timeline = createResultsTimeline(() => now)
  const entries = resultsEntries([{ patrimonio: 41570 }, { patrimonio: 24040 }])
  return {
    host, frames, timers, listeners, canvasListeners, motionListeners, timeline,
    start: () => runtimeModule.mountResultsScene({ host, entries, timeline, env, makeRenderer: () => { constructed++; if (failure) throw Error('WebGL unavailable'); return renderer } }),
    advance(time) { now = time; const pending = [...frames.values()]; frames.clear(); pending.forEach(cb => cb(time)) },
    stats: () => ({ renders, releases, observers, constructed }),
    renderer,
  }
}

test('runtime encerra RAF após reação; resize não reproduz a contagem', () => {
  assert.equal(typeof runtimeModule.mountResultsScene, 'function')
  const h = harness(), runtime = h.start()
  h.advance(1200); assert.equal(h.timeline.getSnapshot(), .5)
  h.listeners.get('resize')(); assert.equal(h.timeline.getSnapshot(), .5)
  h.advance(3600)
  assert.equal(h.frames.size, 0); assert.equal(h.timers.size, 0)
  assert.equal(h.timeline.getSnapshot(), 1)
  runtime.dispose()
  assert.deepEqual(h.stats(), { renders: 4, releases: 1, observers: 0, constructed: 1 })
  assert.equal(h.host.children.length, 0)
})

test('cleanup/unmount e ciclo StrictMode ignoram callbacks tardios sem reiniciar relógio', () => {
  assert.equal(typeof runtimeModule.mountResultsScene, 'function')
  const h = harness(), first = h.start()
  h.advance(1200)
  const late = [...h.frames.values()][0], lateTimer = [...h.timers.values()][0]
  first.dispose(); first.dispose()
  const renders = h.stats().renders
  late(2400); lateTimer()
  assert.equal(h.stats().renders, renders)
  assert.equal(h.timeline.getSnapshot(), .5)
  assert.equal(h.listeners.size, 0); assert.equal(h.canvasListeners.size, 0)
  assert.equal(h.motionListeners.size, 0); assert.equal(h.timers.size, 0)
  const second = h.start()
  assert.equal(h.host.children.length, 1)
  assert.equal(h.timeline.elapsed(), 1200)
  second.dispose()
})

test('movimento reduzido não cria renderer; erro WebGL entrega resultado final', () => {
  assert.equal(typeof runtimeModule.mountResultsScene, 'function')
  for (const options of [{ reduced: true }, { failure: true }]) {
    const h = harness(options), runtime = h.start()
    assert.equal(h.timeline.getSnapshot(), 1)
    assert.equal(h.host.children.length, 0); assert.equal(h.frames.size, 0)
    assert.equal(h.stats().constructed, options.reduced ? 0 : 1)
    runtime.dispose()
  }
})

test('perda de contexto, erro durante desenho e preferência alterada liberam recursos imediatamente', () => {
  assert.equal(typeof runtimeModule.mountResultsScene, 'function')
  for (const cause of ['context', 'draw', 'motion', 'watchdog']) {
    const h = harness(), runtime = h.start()
    if (cause === 'context') h.canvasListeners.get('webglcontextlost')({ preventDefault() {} })
    if (cause === 'draw') { h.renderer.render = () => { throw Error('draw failed') }; h.advance(100) }
    if (cause === 'motion') [...h.motionListeners][0]({ matches: true })
    if (cause === 'watchdog') [...h.timers.values()][0]()
    assert.equal(h.timeline.getSnapshot(), 1)
    assert.equal(h.host.children.length, 0); assert.equal(h.frames.size, 0)
    assert.equal(h.stats().releases, 1)
    assert.equal(h.listeners.size, 0)
    runtime.dispose()
  }
})
