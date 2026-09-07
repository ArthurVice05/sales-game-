export function bytesToUint32(bytes) {
  const b = bytes || []
  return (
    ((Number(b[0]) || 0) << 24) |
    ((Number(b[1]) || 0) << 16) |
    ((Number(b[2]) || 0) << 8) |
    (Number(b[3]) || 0)
  ) >>> 0
}

export function createBotSeed() {
  try {
    if (typeof crypto !== 'undefined' && typeof crypto.getRandomValues === 'function') {
      const buf = new Uint8Array(8)
      crypto.getRandomValues(buf)
      return Array.from(buf)
    }
  } catch {}
  const fallback = new Uint8Array(8)
  for (let i = 0; i < 8; i++) fallback[i] = Math.floor(Math.random() * 256)
  return Array.from(fallback)
}

/** Mulberry32 a partir da semente persistida (mesma semente → mesmo fluxo). */
export function createBotRng(seedBytes = []) {
  let t = bytesToUint32(seedBytes) || 0x9E3779B9
  return function next() {
    t += 0x6D2B79F5
    let x = t
    x = Math.imul(x ^ (x >>> 15), x | 1)
    x ^= x + Math.imul(x ^ (x >>> 7), x | 61)
    return ((x ^ (x >>> 14)) >>> 0) / 4294967296
  }
}

export function rollFairDie(rng) {
  const r = typeof rng === 'function' ? rng() : Math.random()
  return 1 + Math.floor(r * 6)
}

export function pickIndex(rng, length) {
  const n = Math.max(0, Math.floor(Number(length) || 0))
  if (n <= 0) return 0
  const r = typeof rng === 'function' ? rng() : Math.random()
  return Math.min(n - 1, Math.floor(r * n))
}
