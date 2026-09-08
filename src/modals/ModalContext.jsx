import React, { createContext, useContext, useEffect, useMemo, useRef, useState } from 'react'
import { createModalProtocol } from './modalProtocol.js'

const ModalCtx = createContext(null)

export function ModalProvider({ children }) {
  const [stack, setStack] = useState([]) // [{id, el}]

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

  // Desmontagem: encerra pendências com null (nunca converte em APPLY_CARD)
  // e passa a recusar callbacks tardios daquele ciclo.
  useEffect(() => {
    protocol()
    return () => { protocolRef.current?.dispose(null) }
  }, [protocol])

  const closeById = React.useCallback((id, payload) => {
    const key = String(id ?? '')
    if (!key) return
    // Efeito colateral FORA do updater: StrictMode pode reexecutar o updater.
    protocol().settle(key, payload)
    setStack((prev) => prev.filter((m) => String(m.id) !== key))
  }, [protocol])

  const closeAll = React.useCallback((payload = { action: 'CLOSE_ALL' }) => {
    protocol().settleAll(payload)
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
    const elWithResolve = React.cloneElement(element, {
      onResolve: (payload) => closeById(id, payload),
    })
    setStack((s) => [...s, { id, el: elWithResolve }])
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
          {/* backdrop */}
          <div
            aria-hidden="true"
            style={{
              position: 'absolute',
              inset: 0,
              background: 'rgba(0,0,0,0.55)',
            }}
          />

          {/* renderiza só o topo (comportamento esperado pelo engine/awaitTop) */}
          <div style={{ position: 'relative', zIndex: 1 }}>
            {stack[stack.length - 1]?.el}
          </div>
        </div>
      )}
    </ModalCtx.Provider>
  )
}

export const useModal = () => useContext(ModalCtx)
