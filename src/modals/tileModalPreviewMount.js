/**
 * Montagem DEV para capturas dos modais de casa.
 * Não é importado pelo App; usado só pelo script de verificação via Vite.
 */
import React from 'react'
import { createRoot } from 'react-dom/client'
import { ModalProvider } from './ModalContext.jsx'
import BuyFieldSalesModal from './BuyFieldSalesModal.jsx'
import InsideSalesModal from './InsideSalesModal.jsx'
import BuyCommonSellersModal from './BuyCommonSellersModal.jsx'
import BuyManagerModal from './BuyManagerModal.jsx'
import BuyClientsModal from './BuyClientsModal.jsx'
import ERPSystemsModal from './ERPSystemsModal.jsx'
import MixProductsModal from './MixProductsModal.jsx'
import TrainingModal from './TrainingModal.jsx'
import DirectBuyModal from './DirectBuyModal.jsx'
import SorteRevesModal from './SorteRevesModal.jsx'
import FaturamentoMesModal from './FaturamentoMesModal.jsx'
import DespesasOperacionaisModal from './DespesasOperacionaisModal.jsx'
import InsufficientFundsModal from './InsufficientFundsModal.jsx'
import RecoveryModal from './RecoveryModal.jsx'
import BankruptcyModal from './BankruptcyModal.jsx'
import ConfirmModal from './ConfirmModal.jsx'

const MAP = {
  FIELD: BuyFieldSalesModal,
  INSIDE: InsideSalesModal,
  COMMON: BuyCommonSellersModal,
  MANAGER: BuyManagerModal,
  CLIENTS: BuyClientsModal,
  ERP: ERPSystemsModal,
  MIX: MixProductsModal,
  TRAINING: TrainingModal,
  DIRECT: DirectBuyModal,
  LUCK: SorteRevesModal,
  REVENUE: FaturamentoMesModal,
  EXPENSES: DespesasOperacionaisModal,
  FUNDS: InsufficientFundsModal,
  RECOVERY: RecoveryModal,
  BANKRUPT: BankruptcyModal,
  CONFIRM: ConfirmModal,
}

const samplePlayer = {
  cash: 18000,
  name: 'Arthur',
  fat: 2000,
  desp: 800,
  clients: 4,
  capacidade: 8,
  bens: 6000,
  patrimonio: 24000,
  fieldSales: 1,
  insideSales: 0,
  vendedoresComuns: 1,
  gestores: 0,
  mix: 'D',
  erp: 'D',
}

function defaultProps(kind) {
  const cash = 18000
  const shared = {
    onResolve: () => {},
    currentCash: cash,
    currentPlayer: samplePlayer,
    player: samplePlayer,
    allowBack: kind !== 'DIRECT',
  }
  if (kind === 'REVENUE') return { ...shared, value: 2400 }
  if (kind === 'EXPENSES') return { ...shared, expense: 800, loanCharge: 0 }
  if (kind === 'FUNDS') {
    return {
      ...shared,
      requiredAmount: 12000,
      currentCash: 1500,
      showRecoveryOptions: false,
    }
  }
  if (kind === 'FUNDS_RECOVERY') {
    return {
      ...shared,
      requiredAmount: 12000,
      currentCash: 0,
      showRecoveryOptions: true,
      canClose: false,
    }
  }
  if (kind === 'RECOVERY') return { playerName: 'Arthur', bens: 6000, currentPlayer: samplePlayer, canClose: true }
  if (kind === 'BANKRUPT') return { playerName: 'Arthur', balanceText: '$ 0' }
  if (kind === 'CONFIRM') return { title: 'Confirmar', message: 'Tem certeza?' }
  if (kind === 'TRAINING') {
    return {
      ...shared,
      ownedByType: { comum: [], field: [], inside: [], gestor: [] },
      canTrain: { comum: 1, field: 1, inside: 1, gestor: 1 },
    }
  }
  if (kind === 'MIX' || kind === 'ERP') return { ...shared, currentLevel: 'D' }
  return shared
}

const isDevPreview = import.meta.env?.DEV === true

/**
 * Overlay de captura (DEV only). onResolve vazio — não é compra, recuperação
 * nem continuidade de turno; não altera o motor nem o estado da partida.
 */
export function mountTileModalPreview(kind, extraProps = {}) {
  // Fora de DEV: sair antes de qualquer consulta/modificação do DOM.
  if (!isDevPreview) {
    console.warn('[tileModalPreview] blocked outside DEV')
    return false
  }
  const Comp = MAP[kind] || MAP.FUNDS
  let host = document.getElementById('sg-tile-preview')
  if (host?._root) {
    try { host._root.unmount() } catch {}
  }
  host?.remove()
  host = document.createElement('div')
  host.id = 'sg-tile-preview'
  host.setAttribute('data-preview-kind', kind)
  host.style.cssText = 'position:fixed;inset:0;z-index:50000;pointer-events:auto;'
  document.body.appendChild(host)
  const root = createRoot(host)
  host._root = root
  const props = { ...defaultProps(kind), ...extraProps }
  root.render(
    React.createElement(
      ModalProvider,
      null,
      React.createElement(Comp, props),
    ),
  )
  return true
}

export function unmountTileModalPreview() {
  // Fora de DEV: sair antes de qualquer consulta/modificação do DOM.
  if (!isDevPreview) {
    return false
  }
  const host = document.getElementById('sg-tile-preview')
  if (host?._root) {
    try { host._root.unmount() } catch {}
  }
  host?.remove()
  return true
}
