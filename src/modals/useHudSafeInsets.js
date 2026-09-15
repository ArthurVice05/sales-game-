import { useLayoutEffect, useState } from 'react'

/** Mesmo breakpoint do HUD desktop (`useDesktopHudLayout` / desktop-hud.css). */
export const HUD_SAFE_INSETS_MEDIA = '(min-width: 1200px)'
export const HUD_SAFE_GAP = 12

const HEADER_SELECTOR = '.page[data-game-shell] > .gameDesktopHeader'
const SIDE_SELECTOR = '.page[data-game-shell] .content > .side'

/**
 * Área livre para a decisão aberta, calculada a partir da geometria REAL do
 * cabeçalho (métricas) e da coluna lateral (HUD) — não de um clamp() que
 * precisa “adivinhar” a largura da sidebar. Função pura para testes.
 *
 * @returns {{ top: number, right: number } | null}
 */
export function computeHudSafeInsets({ viewportWidth, viewportHeight, headerRect, sideRect, gap = HUD_SAFE_GAP }) {
  const vw = Number(viewportWidth) || 0
  const vh = Number(viewportHeight) || 0
  if (vw <= 0 || vh <= 0) return null

  const hasHeader = !!headerRect && headerRect.height > 0 && headerRect.bottom > 0
  const hasSide = !!sideRect && sideRect.width > 0 && sideRect.left > 0 && sideRect.left < vw

  if (!hasHeader && !hasSide) return null

  // Nunca reserva mais que metade da tela (evita modal espremido por layout estranho).
  const top = hasHeader ? Math.min(Math.round(headerRect.bottom + gap), Math.round(vh * 0.5)) : 0
  const right = hasSide ? Math.min(Math.round(vw - sideRect.left + gap), Math.round(vw * 0.5)) : 0
  return { top, right }
}

function readRect(el) {
  if (!el || typeof el.getBoundingClientRect !== 'function') return null
  const r = el.getBoundingClientRect()
  return { left: r.left, top: r.top, bottom: r.bottom, width: r.width, height: r.height }
}

function sameInsets(a, b) {
  if (a === b) return true
  if (!a || !b) return false
  return a.top === b.top && a.right === b.right
}

/**
 * Enquanto houver modal aberto no desktop, devolve os recuos (px) para o
 * overlay não cobrir o HUD superior nem o HUD lateral. `null` no mobile.
 */
export function useHudSafeInsets(active) {
  const [insets, setInsets] = useState(null)

  useLayoutEffect(() => {
    if (!active || typeof window === 'undefined' || typeof document === 'undefined') {
      setInsets((prev) => (prev === null ? prev : null))
      return undefined
    }

    const mq = typeof window.matchMedia === 'function' ? window.matchMedia(HUD_SAFE_INSETS_MEDIA) : null
    let frame = 0
    let ro = null
    let observed = []

    const observe = (els) => {
      if (!ro) return
      const next = els.filter(Boolean)
      if (next.length === observed.length && next.every((el, i) => el === observed[i])) return
      ro.disconnect()
      next.forEach((el) => ro.observe(el))
      observed = next
    }

    const measure = () => {
      frame = 0
      if (mq && !mq.matches) {
        setInsets((prev) => (prev === null ? prev : null))
        return
      }
      const header = document.querySelector(HEADER_SELECTOR)
      const side = document.querySelector(SIDE_SELECTOR)
      observe([header, side])
      const next = computeHudSafeInsets({
        viewportWidth: document.documentElement.clientWidth || window.innerWidth,
        viewportHeight: document.documentElement.clientHeight || window.innerHeight,
        headerRect: readRect(header),
        sideRect: readRect(side),
      })
      setInsets((prev) => (sameInsets(prev, next) ? prev : next))
    }

    const schedule = () => {
      if (frame) return
      frame = typeof window.requestAnimationFrame === 'function'
        ? window.requestAnimationFrame(measure)
        : setTimeout(measure, 16)
    }

    if (typeof window.ResizeObserver === 'function') ro = new window.ResizeObserver(schedule)
    measure()
    window.addEventListener('resize', schedule)
    if (mq && typeof mq.addEventListener === 'function') mq.addEventListener('change', schedule)

    return () => {
      if (frame) {
        if (typeof window.cancelAnimationFrame === 'function') window.cancelAnimationFrame(frame)
        else clearTimeout(frame)
      }
      if (ro) ro.disconnect()
      window.removeEventListener('resize', schedule)
      if (mq && typeof mq.removeEventListener === 'function') mq.removeEventListener('change', schedule)
    }
  }, [active])

  return insets
}
