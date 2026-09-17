// Same-origin HTTP Date is readable without CORS. Anchor to a monotonic clock,
// never to the device's wall clock. Bounds include Date's one-second precision
// and the entire request duration, so expiration cannot win on a fast device.
export function createSharedClock({ monotonic = () => performance.now() } = {}) {
  let sample = null
  return {
    observe(date, started, received, age = 0) {
      const epoch = Date.parse(date)
      const rtt = received - started
      if (!Number.isFinite(epoch) || rtt < 0 || rtt > 10_000 || Number(age) > 0) return false
      sample = { epoch, received, uncertainty: 1000 + rtt }
      return true
    },
    observeEpoch(epochValue, started, received, age = 0) {
      const epoch = Number(epochValue)
      const rtt = received - started
      if (!Number.isFinite(epoch) || rtt < 0 || rtt > 10_000 || Number(age) > 0) return false
      sample = { epoch, received, uncertainty: Math.max(1, rtt) }
      return true
    },
    ready() { return !!sample && monotonic() - sample.received < 120_000 },
    bounds() {
      if (!sample) return null
      const elapsed = Math.max(0, monotonic() - sample.received)
      return { lower: sample.epoch + elapsed, upper: sample.epoch + elapsed + sample.uncertainty }
    },
  }
}

export const sharedClock = createSharedClock()
let pending = null
let lastSyncWarningAt = 0

function warnClockSync(reason) {
  const now = Date.now()
  if (now - lastSyncWarningAt < 30_000) return
  lastSyncWarningAt = now
  console.warn('[MONITOR][CLOCK_SYNC_FAILED]', { reason })
}
export function gameNow() {
  const b = sharedClock.bounds()
  return b ? (b.lower + b.upper) / 2 : Date.now()
}
export function deadlineNow() { return sharedClock.bounds()?.upper ?? Date.now() }
export function expirationNow() { return sharedClock.ready() ? sharedClock.bounds().lower : null }

export async function syncSharedClock({ force = false } = {}) {
  if (!force && sharedClock.ready()) return true
  if (pending) return pending
  pending = (async () => {
    if (typeof window === 'undefined') return false
    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), 8000)
    try {
      const url = new URL('/api/clock', window.location.origin)
      url.searchParams.set('nonce', `${performance.now()}-${Math.random()}`)
      const started = performance.now()
      const response = await fetch(url, { method: 'GET', cache: 'no-store', signal: controller.signal })
      if (!response.ok) {
        warnClockSync(`http-${response.status}`)
        return false
      }
      const payload = await response.json()
      const observed = sharedClock.observeEpoch(
        payload?.now,
        started,
        performance.now(),
        response.headers.get('age') || 0,
      )
      if (!observed) warnClockSync('invalid-or-cached-response')
      return observed
    } catch (error) {
      warnClockSync(error?.name === 'AbortError' ? 'timeout' : 'network-error')
      return false
    }
    finally { clearTimeout(timeout) }
  })()
  try { return await pending } finally { pending = null }
}
