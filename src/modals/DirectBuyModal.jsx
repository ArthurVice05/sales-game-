// src/modals/DirectBuyModal.jsx
import React, { useEffect, useRef } from 'react'
import { ERP_RULES, VENDOR_RULES } from '../game/gameRules.js'
import { MIX_PURCHASE_PRICES, MANUAL_CONSTANTS } from '../game/manualConstants.js'
import TileContextHint from './TileContextHint.jsx'
import TileModalShell from './TileModalShell.jsx'
import { useRegisterDecisionBuyer } from './decisionBuyerContext.jsx'

/**
 * Modal “roteador de compras”.
 *
 * IMPORTANTE: Esta modal NÃO abre as modais filhas por conta própria.
 * Ela apenas resolve com { action:'OPEN', open:'<ALVO>' } para que
 * o App.jsx decida qual modal abrir (contrato atual do app).
 *
 * onResolve(payload)
 *   - { action: 'OPEN', open: 'MIX' | 'MANAGER' | 'INSIDE' | 'FIELD' | 'COMMON' | 'ERP' | 'CLIENTS' | 'TRAINING' }
 *   - { action: 'SKIP' } quando o usuário cancela
 *
 * currentCash
 *   - saldo atual do jogador (somente para exibição/validações se quiser,
 *     o App.jsx é quem repassa para as modais apropriadas)
 * currentPlayer
 *   - opcional; registra o comprador no HUD lateral. Sem ele, o App usa o jogador da vez.
 */
export default function DirectBuyModal({ onResolve, currentCash = 0, currentPlayer = null }) {
  const closeRef = useRef(null)
  useRegisterDecisionBuyer(currentPlayer)

  const handleClose = (e) => {
    e?.preventDefault?.()
    e?.stopPropagation?.()
    onResolve?.({ action: 'SKIP' })
  }

  // Bloqueia scroll do body e foca no botão de fechar (sem ESC/backdrop)
  useEffect(() => {
    const prev = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    setTimeout(() => closeRef.current?.focus?.(), 0)
    return () => { document.body.style.overflow = prev }
  }, [])

  // Dispara a intenção de abertura para o App.jsx
  const open = (target) => () => {
    // Mantemos o formato exato que o App.jsx espera:
    // if (res.action === 'OPEN') { const open = res.open ... }
    onResolve?.({ action: 'OPEN', open: String(target).toUpperCase() })
  }

  const CARDS = [
    {
      key: 'mix',
      title: 'Mix Produtos',
      lines: [
        `Nível A: $${MIX_PURCHASE_PRICES.A}`,
        `Nível B: $${MIX_PURCHASE_PRICES.B}`,
        `Nível C: $${MIX_PURCHASE_PRICES.C}`,
        `Nível D: $${MIX_PURCHASE_PRICES.D}`,
      ],
      onBuy: open('MIX'),
    },
    {
      key: 'gestor',
      title: 'Gestor Comercial',
      lines: [
        `Contratação: $${MANUAL_CONSTANTS.managerHire}`,
        `Manutenção: $${VENDOR_RULES.gestor.baseDesp}`,
      ],
      onBuy: open('MANAGER'),
    },
    {
      key: 'inside',
      title: 'Inside Sales',
      lines: [
        `Contratação: $${VENDOR_RULES.inside.hire}`,
        `Manutenção: $${VENDOR_RULES.inside.baseDesp}`,
      ],
      onBuy: open('INSIDE'),
    },
    {
      key: 'field',
      title: 'Canal representantes',
      lines: [
        `Contratação: $${VENDOR_RULES.field.hire}`,
        `Manutenção: $${VENDOR_RULES.field.baseDesp}`,
      ],
      onBuy: open('FIELD'),
    },
    {
      key: 'vendedor',
      title: 'Vendedor Comum',
      lines: [
        `Contratação: $${MANUAL_CONSTANTS.commonHire}`,
        `Despesas: $${VENDOR_RULES.comum.baseDesp}`,
      ],
      onBuy: open('COMMON'),
    },
    {
      key: 'erp',
      title: 'ERP/Sistemas',
      lines: [
        `Nível A: $${ERP_RULES.A.price}`,
        `Nível B: $${ERP_RULES.B.price}`,
        `Nível C: $${ERP_RULES.C.price}`,
        `Nível D: $${ERP_RULES.D.price}`,
      ],
      onBuy: open('ERP'),
    },
    {
      key: 'carteira',
      title: 'Carteira de Clientes',
      lines: [`Aquisição: $${MANUAL_CONSTANTS.clientPrice}`],
      onBuy: open('CLIENTS'),
    },
    {
      key: 'training',
      title: 'Treinamento',
      lines: [
        `Azul: $${MANUAL_CONSTANTS.trainingPrice}`,
        `Amarelo: $${MANUAL_CONSTANTS.trainingPrice}`,
        `Roxo: $${MANUAL_CONSTANTS.trainingPrice}`,
      ],
      onBuy: open('TRAINING'),
    },
  ]

  return (
    <TileModalShell
      title="Direito de Compra"
      onClose={handleClose}
      closeRef={closeRef}
      size="xl"
      footer={(
        <button type="button" className="tileModalBtn tileModalBtn--ghost" onClick={handleClose}>
          Não comprar
        </button>
      )}
    >
      <TileContextHint kind="DIRECT_BUY" />

      <p className="purchasePreviewHint">
        Cada decisão pode alterar caixa, despesa, faturamento ou capacidade — o impacto
        aparece na tela seguinte antes de confirmar.
      </p>

      <div className="tileStatHint tileStatHint--saldo">
        Saldo atual: <b>${Number(currentCash).toLocaleString()}</b>
      </div>

      <div className="tileCertGrid tileCertGrid--4">
        {CARDS.map((c) => (
          <article key={c.key} className="tileCertCard">
            <h3 className="tileCertName">{c.title}</h3>
            {c.lines.map((ln, i) => <p key={i}>{ln}</p>)}
            <button type="button" className="tileModalBtn tileModalBtn--confirm" onClick={c.onBuy}>
              Comprar
            </button>
          </article>
        ))}
      </div>
    </TileModalShell>
  )
}
