// A timeout means the outcome is unknown, not that the server rejected the roll.
// The caller must reuse the same claim ID and dice value on every retry.
export async function confirmRollClaim({ commit, isCurrent, signal, onRetry,
  timeoutMs = 8000, maxAttempts = 2 }) {
  const obsolete = () => signal?.aborted || !isCurrent()
  const cancelled = () => ({ ok: false, retryable: false, reason: 'roll-obsolete' })
  let result
  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    if (obsolete()) return cancelled()
    const controller = new AbortController()
    let timer
    let cancel
    const interrupted = new Promise(resolve => {
      cancel = () => { controller.abort(); resolve(cancelled()) }
      signal?.addEventListener('abort', cancel, { once: true })
      timer = setTimeout(() => {
        controller.abort()
        resolve({ ok: false, reason: 'confirmation-timeout' })
      }, timeoutMs)
    })
    try {
      result = await Promise.race([
        Promise.resolve().then(() => obsolete() ? cancelled() : commit({ signal: controller.signal }))
          .catch(() => ({ ok: false, reason: 'confirmation-network-error' })),
        interrupted,
      ])
    } finally {
      clearTimeout(timer)
      signal?.removeEventListener('abort', cancel)
    }
    if (obsolete()) return cancelled()
    if (result?.ok) return result
    if (result?.casLost || result?.terminal) return { ...result, retryable: false }
    if (attempt + 1 < maxAttempts) onRetry?.(result?.reason || 'confirmation-network-error')
  }
  return { ...result, ok: false, retryable: true }
}
