import { useEffect, useState } from 'react'

/**
 * Landscape abaixo do desktop HUD — chrome mobile (Resumo/Mais).
 * Sem max-height: altura só afeta densidade/rolagem, não o modo.
 */
export const COMPACT_LANDSCAPE_MEDIA =
  '(max-width: 1199px) and (orientation: landscape)'

export function getCompactLandscapeHudMatches(
  target = typeof window === 'undefined' ? undefined : window,
) {
  if (!target || typeof target.matchMedia !== 'function') return false
  return target.matchMedia(COMPACT_LANDSCAPE_MEDIA).matches === true
}

export function useCompactLandscapeHud() {
  const [compact, setCompact] = useState(() => getCompactLandscapeHudMatches())

  useEffect(() => {
    if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return undefined
    const mq = window.matchMedia(COMPACT_LANDSCAPE_MEDIA)
    const update = () => setCompact(mq.matches === true)
    update()
    if (typeof mq.addEventListener === 'function') {
      mq.addEventListener('change', update)
      return () => mq.removeEventListener('change', update)
    }
    if (typeof mq.addListener === 'function') {
      mq.addListener(update)
      return () => mq.removeListener(update)
    }
    return undefined
  }, [])

  return compact
}
