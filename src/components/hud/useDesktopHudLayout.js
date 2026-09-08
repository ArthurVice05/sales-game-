import { useEffect, useState } from 'react'

/** Mesmo breakpoint do `desktop-hud.css` — não é um segundo sistema global. */
export const DESKTOP_HUD_MEDIA = '(min-width: 1200px)'

export function getDesktopHudLayoutMatches(target = typeof window === 'undefined' ? undefined : window) {
  if (!target || typeof target.matchMedia !== 'function') return false
  return target.matchMedia(DESKTOP_HUD_MEDIA).matches === true
}

/** Monta o chrome desktop só quando o CSS do HUD desktop também aplica. */
export function useDesktopHudLayout() {
  const [desktopHud, setDesktopHud] = useState(() => getDesktopHudLayoutMatches())

  useEffect(() => {
    if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return undefined
    const mq = window.matchMedia(DESKTOP_HUD_MEDIA)
    const update = () => setDesktopHud(mq.matches === true)
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

  return desktopHud
}
