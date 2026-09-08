// Presentation only: receives the ranking's patrimonio, never computes wealth.
export const RESULTS_GROWTH_MS = 2400
export const RESULTS_REACTION_MS = 1200
export const RESULTS_TOTAL_MS = RESULTS_GROWTH_MS + RESULTS_REACTION_MS
export const RESULTS_COUNTER_INTERVAL_MS = 50
export const RESULTS_USABLE_HEIGHT = 4

const clamp = value => Math.max(0, Math.min(1, Number(value) || 0))
export function resultsProgress(elapsed) {
  const t = clamp(elapsed / RESULTS_GROWTH_MS)
  return t * t * (3 - 2 * t)
}

export function countPatrimonio(value, progress) {
  if (!Number.isFinite(value)) return null
  const t = clamp(progress)
  return t === 1 ? value : Math.trunc(value * t)
}

export function formatResultsMoney(value) {
  return Number.isFinite(value) ? `$ ${value.toLocaleString('pt-BR')}` : 'Indisponível'
}

export function resultsEntries(ranked) {
  const entries = ranked.slice(0, 3).map((player, index) => ({ player, place: index + 1 }))
  return entries.length > 1 ? [entries[1], entries[0], ...entries.slice(2)] : entries
}

export function createResultsScale(values, usableHeight = RESULTS_USABLE_HEIGHT) {
  const finite = values.filter(Number.isFinite)
  const max = Math.max(0, ...finite), min = Math.min(0, ...finite)
  // Normalize BEFORE subtraction: even +1e308 and -1e308 must stay finite.
  const unit = Math.max(max, -min) || 1
  const extent = max / unit - min / unit || 1
  const height = value => Number.isFinite(value) ? (value / unit / extent) * usableHeight : 0
  return { height, min: height(min), max: height(max) }
}

/** Shared clock; React subscribes only in isolated counters. No per-frame ranking. */
export function createResultsTimeline(now = () => performance.now()) {
  let start = null, progress = 0, lastPublished = 0, finished = false
  const listeners = new Set()
  const publish = elapsed => {
    const next = finished ? 1 : resultsProgress(elapsed)
    if (next <= progress || (next < 1 && elapsed - lastPublished < RESULTS_COUNTER_INTERVAL_MS)) return
    progress = next
    lastPublished = elapsed
    listeners.forEach(listener => listener())
  }
  return {
    begin() { if (start === null) start = now() },
    elapsed: () => finished ? RESULTS_TOTAL_MS : start === null ? 0 : Math.max(0, now() - start),
    publish,
    finish() { finished = true; publish(RESULTS_TOTAL_MS) },
    getSnapshot: () => progress,
    getServerSnapshot: () => 1,
    subscribe(listener) { listeners.add(listener); return () => listeners.delete(listener) },
  }
}
