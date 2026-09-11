/**
 * Restauração de foco ao fechar a camada do topo da pilha de modais.
 * Sem dependências de React — testável em isolado.
 */

export function isElementFocusableVisible(el) {
  if (!el || typeof el.focus !== 'function') return false
  if (typeof Element !== 'undefined' && !(el instanceof Element) && el.nodeType !== 1) {
    // Em testes Node usamos stubs plain; no browser exigimos Element.
    if (el.isConnected == null && el.offsetParent === undefined) return false
  }
  if (el.isConnected === false) return false
  if (typeof el.closest === 'function') {
    if (el.closest('[inert]')) return false
    if (el.closest('[aria-hidden="true"]')) return false
  }
  if (el.disabled) return false
  const ariaDisabled = typeof el.getAttribute === 'function' ? el.getAttribute('aria-disabled') : null
  if (ariaDisabled === 'true') return false
  const style = typeof getComputedStyle === 'function' && el.nodeType === 1
    ? getComputedStyle(el)
    : null
  if (style) {
    if (style.display === 'none' || style.visibility === 'hidden') return false
  }
  if (el.offsetParent === null) {
    const position = style?.position
    if (position !== 'fixed' && position !== 'sticky') return false
  }
  return true
}

export function pickDecisionFallbackFocus(layerRoot) {
  if (!layerRoot || typeof layerRoot.querySelector !== 'function') return null
  const selectors = [
    '.tileModalBtn--confirm:not([disabled])',
    'input[type="number"]:not([disabled])',
    '.tileModalClose',
    '.tileModalBtn--ghost',
    '.tileModal button:not([disabled])',
    '[href]',
    '[tabindex]:not([tabindex="-1"])',
  ]
  for (const sel of selectors) {
    const candidates = layerRoot.querySelectorAll(sel)
    for (const el of candidates) {
      if (isElementFocusableVisible(el)) return el
    }
  }
  return null
}

/**
 * @param {{
 *   returnFocusTo: Element | null,
 *   revealedLayerRoot: Element | null,
 *   activeElement?: Element | null,
 *   upperLayerStillOpen?: boolean,
 * }} opts
 * @returns {'skip-upper' | 'skip-already' | 'opener' | 'fallback' | 'none'}
 */
export function resolveModalFocusRestore({
  returnFocusTo = null,
  revealedLayerRoot = null,
  activeElement = null,
  upperLayerStillOpen = false,
} = {}) {
  if (upperLayerStillOpen) return { action: 'skip-upper', target: null }

  const active = activeElement ?? (typeof document !== 'undefined' ? document.activeElement : null)
  if (
    revealedLayerRoot
    && active
    && revealedLayerRoot.contains(active)
    && isElementFocusableVisible(active)
  ) {
    return { action: 'skip-already', target: active }
  }

  if (isElementFocusableVisible(returnFocusTo)) {
    return { action: 'opener', target: returnFocusTo }
  }

  const fallback = pickDecisionFallbackFocus(revealedLayerRoot)
  if (fallback) return { action: 'fallback', target: fallback }

  return { action: 'none', target: null }
}

export function applyModalFocusRestore(opts) {
  const resolved = resolveModalFocusRestore(opts)
  if (resolved.target && typeof resolved.target.focus === 'function') {
    try {
      resolved.target.focus({ preventScroll: true })
    } catch {
      resolved.target.focus()
    }
  }
  return resolved
}
