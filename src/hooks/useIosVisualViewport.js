import { useEffect } from 'react'

import { isIOSDevice } from '../utils/iosDetect.js'

const IOS_CLASS = 'sg-ios'

function readVisualViewportMetrics() {
  if (typeof window === 'undefined') {
    return { width: 0, height: 0, offsetTop: 0, offsetLeft: 0 }
  }
  const vv = window.visualViewport
  if (vv && Number.isFinite(vv.height) && vv.height > 0) {
    const width = Number.isFinite(vv.width) && vv.width > 0
      ? vv.width
      : (window.innerWidth || 0)
    return {
      width,
      height: vv.height,
      offsetTop: Number.isFinite(vv.offsetTop) ? vv.offsetTop : 0,
      offsetLeft: Number.isFinite(vv.offsetLeft) ? vv.offsetLeft : 0,
    }
  }
  return {
    width: window.innerWidth || 0,
    height: window.innerHeight || 0,
    offsetTop: 0,
    offsetLeft: 0,
  }
}

function applyViewportCssVars() {
  if (typeof document === 'undefined') return
  const root = document.documentElement
  const { width, height, offsetTop, offsetLeft } = readVisualViewportMetrics()
  if (width > 0) {
    root.style.setProperty('--sg-vv-width', `${Math.round(width)}px`)
  }
  if (height > 0) {
    root.style.setProperty('--sg-vv-height', `${Math.round(height)}px`)
  }
  root.style.setProperty('--sg-vv-offset-top', `${Math.round(offsetTop)}px`)
  root.style.setProperty('--sg-vv-offset-left', `${Math.round(offsetLeft)}px`)
}

/**
 * Só no iOS: marca html.sg-ios e sincroniza largura/altura/offsets do visualViewport.
 * No Android/desktop não faz nada (layout atual permanece).
 */
export function useIosVisualViewport() {
  useEffect(() => {
    if (typeof document === 'undefined' || typeof window === 'undefined') {
      return undefined
    }
    if (!isIOSDevice()) return undefined

    const root = document.documentElement
    root.classList.add(IOS_CLASS)
    applyViewportCssVars()

    const onChange = () => applyViewportCssVars()
    const vv = window.visualViewport

    window.addEventListener('resize', onChange)
    window.addEventListener('orientationchange', onChange)
    vv?.addEventListener?.('resize', onChange)
    vv?.addEventListener?.('scroll', onChange)

    // Safari às vezes atualiza a chrome com atraso após girar
    const t1 = window.setTimeout(onChange, 120)
    const t2 = window.setTimeout(onChange, 400)

    return () => {
      window.clearTimeout(t1)
      window.clearTimeout(t2)
      window.removeEventListener('resize', onChange)
      window.removeEventListener('orientationchange', onChange)
      vv?.removeEventListener?.('resize', onChange)
      vv?.removeEventListener?.('scroll', onChange)
      root.classList.remove(IOS_CLASS)
      root.style.removeProperty('--sg-vv-width')
      root.style.removeProperty('--sg-vv-height')
      root.style.removeProperty('--sg-vv-offset-top')
      root.style.removeProperty('--sg-vv-offset-left')
    }
  }, [])
}
