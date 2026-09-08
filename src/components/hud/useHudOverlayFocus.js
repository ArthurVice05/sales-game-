import { useEffect } from 'react'

function focusableNodes(root) {
  if (!root || typeof root.querySelectorAll !== 'function') return []
  return [...root.querySelectorAll(
    'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])',
  )].filter((node) => node.offsetParent !== null || node.getClientRects().length > 0)
}

/**
 * Restaura foco ao acionador só se ele ainda existir e nenhuma outra janela modal
 * já tiver o foco. Não adiciona Escape a modais de casa.
 */
export function shouldRestoreOverlayFocus(previous, activeElement, doc = typeof document !== 'undefined' ? document : null) {
  if (!doc || !previous || typeof previous.focus !== 'function') return false
  if (typeof doc.contains === 'function' && !doc.contains(previous)) return false
  const active = activeElement ?? doc.activeElement
  if (!active || active === doc.body || active === previous) return true
  if (typeof active.closest === 'function') {
    const otherDialog = active.closest('[aria-modal="true"], [role="dialog"]')
    if (otherDialog) return false
  }
  return true
}

/** Foco inicial, trap de Tab, Escape e retorno ao acionador. Sem efeito no estado da partida. */
export function useHudOverlayFocus(open, panelRef, onClose) {
  useEffect(() => {
    if (!open || !panelRef?.current) return undefined
    const panel = panelRef.current
    const previous = typeof document !== 'undefined' ? document.activeElement : null
    const nodes = focusableNodes(panel)
    const initial = nodes[0]
    if (initial && typeof initial.focus === 'function') initial.focus()

    const onKeyDown = (event) => {
      if (event.key === 'Escape') {
        event.preventDefault()
        onClose?.()
        return
      }
      if (event.key !== 'Tab') return
      const list = focusableNodes(panel)
      if (list.length === 0) return
      const first = list[0]
      const last = list[list.length - 1]
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault()
        last.focus()
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault()
        first.focus()
      }
    }

    document.addEventListener('keydown', onKeyDown)
    let restoreTimer = 0
    return () => {
      document.removeEventListener('keydown', onKeyDown)
      if (restoreTimer) window.clearTimeout(restoreTimer)
      restoreTimer = window.setTimeout(() => {
        if (!shouldRestoreOverlayFocus(previous, document.activeElement, document)) return
        previous.focus()
      }, 0)
    }
  }, [open, panelRef, onClose])
}
