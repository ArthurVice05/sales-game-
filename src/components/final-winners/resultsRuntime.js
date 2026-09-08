import * as THREE from 'three'
import { createResultsScene } from './createResultsScene.js'
import { RESULTS_TOTAL_MS } from './resultsPresentation.js'

/** Owns this mount only. Disposing never resolves/exits the game. */
export function mountResultsScene({ host, entries, timeline, onReady = () => {}, onFallback = () => {}, env = window, makeRenderer = options => new THREE.WebGLRenderer(options) }) {
  const runtime = { renderer: null, objects: null, frame: 0, dispose }
  let stopped = false, observer = null, watchdog = 0, motion = null
  const lost = event => { event.preventDefault(); fallback() }
  const motionChanged = event => { if (event.matches) fallback() }

  function dispose() {
    if (stopped) return
    stopped = true
    env.cancelAnimationFrame(runtime.frame)
    env.clearTimeout(watchdog)
    observer?.disconnect()
    env.removeEventListener('resize', resize)
    motion?.removeEventListener?.('change', motionChanged)
    runtime.renderer?.domElement.removeEventListener('webglcontextlost', lost)
    runtime.objects?.dispose()
    runtime.renderer?.dispose()
    runtime.renderer?.forceContextLoss()
    runtime.renderer?.domElement.remove()
    runtime.objects = null; runtime.renderer = null
  }
  function fallback() {
    if (stopped) return
    dispose()
    timeline.finish()
    onFallback()
  }
  function render() {
    if (stopped) return
    runtime.objects.update(timeline.elapsed())
    runtime.renderer.render(runtime.objects.scene, runtime.objects.camera)
  }
  function resize() {
    if (stopped) return
    try {
      const width = Math.max(1, host.clientWidth), height = Math.max(1, host.clientHeight)
      runtime.renderer.setSize(width, height, false)
      runtime.objects.resize(width, height)
      render()
    } catch { fallback() }
  }
  function tick() {
    if (stopped) return
    try {
      const elapsed = timeline.elapsed()
      render()
      // A synchronous context-loss event can dispose during render.
      if (stopped) return
      timeline.publish(elapsed)
      if (elapsed < RESULTS_TOTAL_MS) runtime.frame = env.requestAnimationFrame(tick)
      else env.clearTimeout(watchdog)
    } catch { fallback() }
  }
  try {
    motion = env.matchMedia?.('(prefers-reduced-motion: reduce)')
    if (!host || motion?.matches) { fallback(); return runtime }
    runtime.renderer = makeRenderer({ alpha: true, antialias: true, powerPreference: 'low-power' })
    const renderer = runtime.renderer
    renderer.setPixelRatio(Math.min(env.devicePixelRatio || 1, 2))
    renderer.setClearColor(0x000000, 0)
    renderer.outputColorSpace = THREE.SRGBColorSpace
    renderer.toneMapping = THREE.ACESFilmicToneMapping
    renderer.toneMappingExposure = 1.15
    renderer.domElement.setAttribute('aria-hidden', 'true')
    renderer.domElement.addEventListener('webglcontextlost', lost)
    host.appendChild(renderer.domElement)
    runtime.objects = createResultsScene(entries)
    timeline.begin()
    resize()
    if (stopped) return runtime
    onReady()
    motion?.addEventListener?.('change', motionChanged)
    env.addEventListener('resize', resize)
    if (env.ResizeObserver) { observer = new env.ResizeObserver(resize); observer.observe(host) }
    if (timeline.elapsed() < RESULTS_TOTAL_MS) {
      watchdog = env.setTimeout(fallback, RESULTS_TOTAL_MS + 2000)
      runtime.frame = env.requestAnimationFrame(tick)
    } else timeline.finish()
  } catch { fallback() }
  return runtime
}
