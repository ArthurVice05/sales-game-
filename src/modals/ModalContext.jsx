import React, { createContext, useContext, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { createModalProtocol } from './modalProtocol.js'
import { applyModalFocusRestore } from './modalFocusRestore.js'
import './decision-hud-bridge.css'

const ModalCtx = createContext(null)

function captureReturnFocusTarget() {
  if (typeof document === 'undefined') return null
  const active = document.activeElement
  if (!active || active === document.body || active === document.documentElement) return null
  if (typeof active.focus !== 'function') return null
  return active
}

function syncModalDepthAttr(depth) {
  if (typeof document === 'undefined') return
  const root = document.documentElement
  if (depth > 0) root.dataset.sgModalDepth = String(depth)
  else delete root.dataset.sgModalDepth
}

export function ModalProvider({ children }) {
  const [stack, setStack] = useState([]) // [{id, el, returnFocusTo}]
  const stackRef = useRef(stack)
  stackRef.current = stack

  /**
   * Transporte das respostas. A Promise de cada abertura nasce ANTES de o
   * elemento ser publicado, então uma confirmação precoce não se perde e a
   * ordem das aberturas é lida de forma síncrona — sem depender do commit
   * do React nem de um timeout de renderização.
   */
  const protocolRef = useRef(null)
  // StrictMode monta, limpa e remonta os efeitos sem renderizar de novo: por isso
  // o protocolo é obtido por função e renasce se tiver sido descartado.
  const protocol = React.useCallback(() => {
    if (!protocolRef.current || protocolRef.current.isDisposed()) {
      protocolRef.current = createModalProtocol()
    }
    return protocolRef.current
  }, [])

  /** Pedido de restauração de foco após fechar o topo (fora do updater). */
  const focusRestoreJobRef = useRef(null)

  // Desmontagem: encerra pendências com null (nunca converte em APPLY_CARD)
  // e passa a recusar callbacks tardios daquele ciclo.
  useEffect(() => {
    protocol()
    return () => {
      protocolRef.current?.dispose(null)
      syncModalDepthAttr(0)
    }
  }, [protocol])

  useEffect(() => {
    syncModalDepthAttr(stack.length)
  }, [stack.length])

  const closeById = React.useCallback((id, payload) => {
    const key = String(id ?? '')
    if (!key) return
    // Efeito colateral FORA do updater: StrictMode pode reexecutar o updater.
    protocol().settle(key, payload)

    const prev = stackRef.current
    const idx = prev.findIndex((m) => String(m.id) === key)
    if (idx < 0) return

    const wasTop = idx === prev.length - 1
    const closing = prev[idx]
    // Só restaura foco ao fechar a camada do topo.
    // Se ainda houver camada acima (fechamento de id inferior), não rouba o foco.
    if (wasTop) {
      focusRestoreJobRef.current = {
        returnFocusTo: closing?.returnFocusTo ?? null,
        upperLayerStillOpen: false,
      }
    } else if (prev.length > idx + 1) {
      focusRestoreJobRef.current = {
        returnFocusTo: null,
        upperLayerStillOpen: true,
      }
    } else {
      focusRestoreJobRef.current = null
    }

    setStack((s) => s.filter((m) => String(m.id) !== key))
  }, [protocol])

  const closeAll = React.useCallback((payload = { action: 'CLOSE_ALL' }) => {
    protocol().settleAll(payload)
    focusRestoreJobRef.current = null
    setStack([])
  }, [protocol])

  // ✅ API exigida pelo engine: fecha a modal do topo e resolve (se houver)
  const closeTop = React.useCallback((payload) => {
    const topId = protocol().topId()
    if (!topId) return
    closeById(topId, payload)
  }, [closeById, protocol])

  // Compatibilidade (código legado): resolveTop = closeTop
  const resolveTop = closeTop

  // utilitários para botões
  const closeModal = React.useCallback(() => closeTop({ action: 'SKIP' }), [closeTop])
  const popModal = React.useCallback(() => closeTop(false), [closeTop])

  /**
   * Abertura atômica: devolve o id e a Promise já ligada a ELE. O consumidor
   * pode aguardar quando quiser — inclusive depois de a modal ter sido
   * confirmada — que o payload continua íntegro e chega uma única vez.
   */
  const openModal = React.useCallback((element) => {
    const { id, result } = protocol().open()
    if (!id) return { id: '', result }
    const returnFocusTo = captureReturnFocusTarget()
    const elWithResolve = React.cloneElement(element, {
      onResolve: (payload) => closeById(id, payload),
    })
    setStack((s) => [...s, { id, el: elWithResolve, returnFocusTo }])
    return { id, result }
  }, [closeById, protocol])

  /** Açúcar do contrato acima, para quem só quer o payload. */
  const openAndWait = React.useCallback((element) => openModal(element).result, [openModal])

  // Compatibilidade: consumidores existentes esperam receber o ID.
  const pushModal = React.useCallback((element) => openModal(element).id, [openModal])

  // Legado (`pushModal` + `awaitTop`): agora lê o topo de forma síncrona, então
  // uma abertura aninhada aguarda a PRÓPRIA modal, e não a do chamador.
  const awaitTop = React.useCallback(() => protocol().awaitTop(), [protocol])

  // ⚠️ Sem listener de ESC: somente botões fecham a modal

  useLayoutEffect(() => {
    const job = focusRestoreJobRef.current
    if (!job) return
    focusRestoreJobRef.current = null

    if (job.upperLayerStillOpen) {
      applyModalFocusRestore({ upperLayerStillOpen: true })
      return
    }

    const revealedLayerRoot = typeof document !== 'undefined'
      ? document.querySelector('[data-modal-layer][data-modal-top="true"]')
      : null

    applyModalFocusRestore({
      returnFocusTo: job.returnFocusTo,
      revealedLayerRoot,
      activeElement: typeof document !== 'undefined' ? document.activeElement : null,
      upperLayerStillOpen: false,
    })
  }, [stack])

  const value = useMemo(
    () => ({ stack, openModal, openAndWait, pushModal, awaitTop, resolveTop, closeTop, closeModal, popModal, closeById, closeAll }),
    [stack, openModal, openAndWait, pushModal, awaitTop, resolveTop, closeTop, closeModal, popModal, closeById, closeAll]
  )

  return (
    <ModalCtx.Provider value={value}>
      {children}
      {/* renderiza modais empilhadas com overlay visível (z-index alto) */}
      {stack.length > 0 && (
        <div
          className="sgModalOverlay"
          style={{
            position: 'fixed',
            inset: 0,
            zIndex: 9999,
            pointerEvents: 'auto',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
          }}
        >
          {/* backdrop — cobre tabuleiro/ações; HUD informativo sobe via .hudConsultRegion */}
          <div
            aria-hidden="true"
            style={{
              position: 'absolute',
              inset: 0,
              background: 'rgba(0,0,0,0.55)',
            }}
          />

          {/* Mantém toda a pilha montada: só o topo é interativo (preserva qty/seleção). */}
          {stack.map((m, index) => {
            const isTop = index === stack.length - 1
            return (
              <div
                key={m.id}
                data-modal-layer={m.id}
                data-modal-top={isTop ? 'true' : 'false'}
                style={{
                  position: 'relative',
                  zIndex: 1,
                  display: isTop ? undefined : 'none',
                }}
                aria-hidden={isTop ? undefined : true}
                inert={!isTop ? true : undefined}
              >
                {m.el}
              </div>
            )
          })}
        </div>
      )}
    </ModalCtx.Provider>
  )
}

export const useModal = () => useContext(ModalCtx)
