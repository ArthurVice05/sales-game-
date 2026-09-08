/** Matriz de capacidade landscape — largura/altura, não marca de aparelho. */

export const LANDSCAPE_STRESS_WIDTHS = [
  760, 800, 844, 852, 873, 896, 915, 932, 960, 1024, 1080, 1199,
]

export const LANDSCAPE_STRESS_HEIGHTS = [
  360, 375, 390, 393, 400, 412, 414, 430, 440, 480, 540, 600,
]

export const NAMED_LANDSCAPE_VIEWPORTS = [
  [844, 390],
  [852, 393],
  [873, 393],
  [896, 414],
  [915, 412],
  [932, 430],
  [956, 440],
  [960, 432],
  [960, 430],
  [1024, 480],
  [1024, 600],
  [1080, 540],
  [1199, 600],
  [1366, 768],
  [1600, 900],
]

export function hudLayerForViewport(width, height) {
  if (width >= 1200) return 'desktop'
  if (height <= 450) return 'landscape-low'
  if (height <= 550) return 'landscape-mid'
  return 'landscape-high'
}

/**
 * Chrome montado (Resumo/Mais vs painel antigo vs desktop).
 * Independente da faixa de densidade (hudLayerForViewport): altura >450
 * não pode reativar o HUD financeiro expandido abaixo de 1200px.
 */
export function hudChromeModeForViewport(width, height) {
  const w = Number(width)
  const h = Number(height)
  if (!Number.isFinite(w) || !Number.isFinite(h)) return 'default'
  if (w >= 1200) return 'desktop'
  if (w > h) return 'mobile-landscape'
  return 'default'
}

export function isPlausibleLandscape(width, height) {
  return Number(width) > Number(height)
}

export function stressLandscapeViewports() {
  const seen = new Set()
  const out = []
  const add = (width, height) => {
    if (!isPlausibleLandscape(width, height)) return
    const key = `${width}x${height}`
    if (seen.has(key)) return
    seen.add(key)
    out.push({
      width,
      height,
      layer: hudLayerForViewport(width, height),
    })
  }
  for (const [width, height] of NAMED_LANDSCAPE_VIEWPORTS) add(width, height)
  for (const width of LANDSCAPE_STRESS_WIDTHS) {
    for (const height of LANDSCAPE_STRESS_HEIGHTS) add(width, height)
  }
  return out
}

/** Slot aproximado após chrome; a escala real continua no CSS contain 13/9. */
export function estimateBoardSlot(width, height) {
  const layer = hudLayerForViewport(width, height)
  const header = layer === 'desktop' ? 80 : layer === 'landscape-low' ? 36 : 44
  const gap = 8
  const side = layer === 'desktop'
    ? Math.min(352, Math.max(320, width * 0.22))
    : Math.max(120, Math.min(width * 0.22, 320))
  return {
    layer,
    availableWidth: Math.max(0, width - side - gap),
    availableHeight: Math.max(0, height - header - gap),
  }
}
