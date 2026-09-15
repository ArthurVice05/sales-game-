import { useLayoutEffect, useRef, useState } from 'react'

/**
 * Escala mínima (fração do font-size base do card) antes de trocar para o
 * formato compacto. 18px × 0.75 = 13.5px — ainda legível em 1366×768.
 */
export const METRIC_MIN_SCALE = 0.75

/**
 * Decide como um valor cabe na largura disponível (função pura, testável).
 *
 * @param {{ available: number, fullWidth: number, compactWidth?: number, minScale?: number }} m
 * @returns {{ compact: boolean, scale: number }}
 */
export function resolveMetricFit({ available, fullWidth, compactWidth = 0, minScale = METRIC_MIN_SCALE }) {
  const avail = Number(available)
  const full = Number(fullWidth)
  if (!(avail > 0) || !(full > 0) || full <= avail) return { compact: false, scale: 1 }

  const fullScale = avail / full
  if (fullScale >= minScale || !(compactWidth > 0)) {
    return { compact: false, scale: Math.max(minScale, round3(fullScale)) }
  }

  if (compactWidth <= avail) return { compact: true, scale: 1 }
  return { compact: true, scale: Math.max(minScale, round3(avail / compactWidth)) }
}

function round3(n) {
  return Math.floor(n * 1000) / 1000
}

/**
 * Mede o valor completo e o compacto (em nós ocultos, no font-size base) e
 * devolve a escala/formato que cabem no card — sem vazar do quadrado em
 * nenhuma largura (1366×768, notebooks, 4K, zoom do navegador).
 */
export function useFitMetricValue(deps = []) {
  const boxRef = useRef(null)
  const fullRef = useRef(null)
  const compactRef = useRef(null)
  const [fit, setFit] = useState({ compact: false, scale: 1 })

  useLayoutEffect(() => {
    const box = boxRef.current
    if (!box || typeof window === 'undefined') return undefined

    let frame = 0
    const measure = () => {
      frame = 0
      const full = fullRef.current
      if (!full) return
      const next = resolveMetricFit({
        available: box.clientWidth,
        fullWidth: full.scrollWidth,
        compactWidth: compactRef.current ? compactRef.current.scrollWidth : 0,
      })
      setFit((prev) => (prev.compact === next.compact && prev.scale === next.scale ? prev : next))
    }
    const schedule = () => {
      if (frame) return
      frame = typeof window.requestAnimationFrame === 'function'
        ? window.requestAnimationFrame(measure)
        : setTimeout(measure, 16)
    }

    measure()

    let ro = null
    if (typeof window.ResizeObserver === 'function') {
      ro = new window.ResizeObserver(schedule)
      ro.observe(box)
    } else {
      window.addEventListener('resize', schedule)
    }
    // Fonte web pode carregar depois e mudar a largura do texto.
    document?.fonts?.ready?.then?.(schedule).catch?.(() => {})

    return () => {
      if (frame) {
        if (typeof window.cancelAnimationFrame === 'function') window.cancelAnimationFrame(frame)
        else clearTimeout(frame)
      }
      if (ro) ro.disconnect()
      else window.removeEventListener('resize', schedule)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps)

  return { boxRef, fullRef, compactRef, fit }
}
