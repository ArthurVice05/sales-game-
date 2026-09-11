import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react'

const DecisionBuyerCtx = createContext({
  buyer: null,
  registerBuyer: () => {},
  clearBuyer: () => {},
})

/**
 * Comprador da decisão aberta — só apresentação do HUD lateral.
 * Não altera motor, sync nem payloads.
 */
export function DecisionBuyerProvider({ children }) {
  const [buyer, setBuyer] = useState(null)
  const tokenRef = useRef(0)

  const registerBuyer = useCallback((player) => {
    tokenRef.current += 1
    const token = tokenRef.current
    setBuyer(player && typeof player === 'object' ? player : null)
    return token
  }, [])

  const clearBuyer = useCallback((token) => {
    // Evita limpar se outro modal já registrou por cima (filho/irmão).
    if (token != null && token !== tokenRef.current) return
    setBuyer(null)
  }, [])

  const value = useMemo(
    () => ({ buyer, registerBuyer, clearBuyer }),
    [buyer, registerBuyer, clearBuyer],
  )

  return (
    <DecisionBuyerCtx.Provider value={value}>
      {children}
    </DecisionBuyerCtx.Provider>
  )
}

export function useDecisionBuyer() {
  return useContext(DecisionBuyerCtx)
}

/**
 * Registra o comprador enquanto o modal de decisão estiver montado.
 */
export function useRegisterDecisionBuyer(player) {
  const { registerBuyer, clearBuyer } = useDecisionBuyer()
  const playerId = player?.id != null ? String(player.id) : ''

  useEffect(() => {
    if (!player) return undefined
    const token = registerBuyer(player)
    return () => clearBuyer(token)
  }, [player, playerId, registerBuyer, clearBuyer])
}
