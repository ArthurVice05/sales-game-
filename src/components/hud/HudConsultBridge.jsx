import React, { useEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
// Sem .jsx: mesma instância de contexto que main/useTurnEngine (evita provider vazio duplicado).
import { useModal } from '../../modals/ModalContext'
import { useDecisionBuyer } from '../../modals/decisionBuyerContext.jsx'
import { buildPlayerHudTotals } from './hudPresentation.js'
import { hudChromeModeForViewport } from './mobileLandscapeViewports.js'
import HudDesktopSidebar from './HudDesktopSidebar.jsx'

function readHudModeFromWindow() {
  if (typeof window === 'undefined') return 'default'
  const width = window.innerWidth || document.documentElement?.clientWidth || 0
  const height = window.innerHeight || document.documentElement?.clientHeight || 0
  return hudChromeModeForViewport(width, height)
}

function readModalDepthFromDom() {
  if (typeof document === 'undefined') return 0
  const n = Number(document.documentElement.dataset.sgModalDepth || 0)
  return Number.isFinite(n) ? n : 0
}

/**
 * HUD lateral real durante decisão.
 * Desktop: simultâneo (aprovado).
 * Mobile: consulta recolhível externa — não reserva largura do formulário.
 */
export default function HudConsultBridge({
  desktopHud = false,
  compactLandscapeHud = false,
  fallbackPlayer = null,
  totals = {},
  players = [],
  lastRoll = null,
  isRolling = false,
  hostId = null,
  turnPlayerId = null,
  turnAbsenceStatus = null,
  meId = null,
  cash = null,
}) {
  const modalApi = useModal()
  const { buyer } = useDecisionBuyer()
  const stackDepth = Array.isArray(modalApi?.stack) ? modalApi.stack.length : 0
  const [domDepth, setDomDepth] = useState(() => readModalDepthFromDom())
  const depth = Math.max(stackDepth, domDepth)
  const [liveHudMode, setLiveHudMode] = useState(() => {
    const live = readHudModeFromWindow()
    if (live !== 'default') return live
    return desktopHud ? 'desktop' : compactLandscapeHud ? 'mobile-landscape' : 'default'
  })
  const [mobileConsultOpen, setMobileConsultOpen] = useState(false)
  const toggleRef = useRef(null)
  const closeConsultRef = useRef(null)
  const openToggleRef = useRef(null)

  const activeBuyer = buyer || (depth > 0 ? fallbackPlayer : null)
  const consultTotals = useMemo(
    () => (activeBuyer ? buildPlayerHudTotals(activeBuyer) : totals),
    [activeBuyer, totals],
  )
  const consultCash = activeBuyer?.cash != null && Number.isFinite(Number(activeBuyer.cash))
    ? Number(activeBuyer.cash)
    : cash
  const consultMeId = activeBuyer?.id ?? meId

  useEffect(() => {
    if (typeof document === 'undefined') return undefined
    const syncDepth = () => setDomDepth(readModalDepthFromDom())
    syncDepth()
    if (typeof MutationObserver !== 'function') {
      const timer = window.setInterval(syncDepth, 200)
      return () => window.clearInterval(timer)
    }
    const obs = new MutationObserver(syncDepth)
    obs.observe(document.documentElement, { attributes: true, attributeFilter: ['data-sg-modal-depth'] })
    return () => obs.disconnect()
  }, [])

  useEffect(() => {
    if (typeof window === 'undefined') return undefined
    const sync = () => {
      const nextMode = readHudModeFromWindow()
      setLiveHudMode((prev) => (prev === nextMode ? prev : nextMode))
    }
    sync()
    window.addEventListener('resize', sync)
    window.addEventListener('orientationchange', sync)
    const mqDesktop = window.matchMedia('(min-width: 1200px)')
    const mqLand = window.matchMedia('(max-width: 1199px) and (orientation: landscape)')
    const onMq = () => sync()
    if (typeof mqDesktop.addEventListener === 'function') {
      mqDesktop.addEventListener('change', onMq)
      mqLand.addEventListener('change', onMq)
    } else if (typeof mqDesktop.addListener === 'function') {
      mqDesktop.addListener(onMq)
      mqLand.addListener(onMq)
    }
    const timer = depth > 0 ? window.setInterval(sync, 200) : 0
    return () => {
      window.removeEventListener('resize', sync)
      window.removeEventListener('orientationchange', sync)
      if (typeof mqDesktop.removeEventListener === 'function') {
        mqDesktop.removeEventListener('change', onMq)
        mqLand.removeEventListener('change', onMq)
      } else if (typeof mqDesktop.removeListener === 'function') {
        mqDesktop.removeListener(onMq)
        mqLand.removeListener(onMq)
      }
      if (timer) window.clearInterval(timer)
    }
  }, [depth])

  const resolvedHudMode = (() => {
    const live = liveHudMode !== 'default' ? liveHudMode : readHudModeFromWindow()
    if (live === 'desktop' || live === 'mobile-landscape') return live
    if (desktopHud) return 'desktop'
    if (compactLandscapeHud) return 'mobile-landscape'
    return 'default'
  })()
  const showDesktopHud = resolvedHudMode === 'desktop'
  const isMobileDecision = resolvedHudMode === 'mobile-landscape' && depth >= 1
  // Filho obrigatório (saldo insuficiente): consulta fechada e sem toggle.
  const allowMobileConsult = isMobileDecision && depth === 1
  const mobilePanelOpen = allowMobileConsult && mobileConsultOpen

  // Fecha estado de apresentação ao sair da decisão ou subir filho.
  useEffect(() => {
    if (!allowMobileConsult && mobileConsultOpen) {
      setMobileConsultOpen(false)
    }
  }, [allowMobileConsult, mobileConsultOpen])

  useEffect(() => {
    if (depth === 0 && mobileConsultOpen) setMobileConsultOpen(false)
  }, [depth, mobileConsultOpen])

  // Bloqueia teclado/AT nas ações de gameplay enquanto a decisão (topo) está aberta.
  useEffect(() => {
    const nodes = document.querySelectorAll('.turnPrimaryActions, .sideQuickActions')
    if (depth === 1) {
      nodes.forEach((n) => {
        n.setAttribute('inert', '')
        n.setAttribute('aria-hidden', 'true')
      })
    } else {
      nodes.forEach((n) => {
        n.removeAttribute('inert')
        n.removeAttribute('aria-hidden')
      })
    }
    return () => {
      nodes.forEach((n) => {
        n.removeAttribute('inert')
        n.removeAttribute('aria-hidden')
      })
    }
  }, [depth])

  // Com consulta mobile aberta: formulário permanece montado, sem interação.
  useEffect(() => {
    if (typeof document === 'undefined') return undefined
    const layer = document.querySelector('[data-modal-top="true"]')
    if (mobilePanelOpen && layer) {
      layer.setAttribute('inert', '')
      layer.setAttribute('aria-hidden', 'true')
      layer.dataset.hudConsultCovered = '1'
    } else if (layer?.dataset.hudConsultCovered === '1') {
      layer.removeAttribute('inert')
      layer.removeAttribute('aria-hidden')
      delete layer.dataset.hudConsultCovered
    }
    return () => {
      const el = document.querySelector('[data-modal-top="true"]')
      if (el?.dataset.hudConsultCovered === '1') {
        el.removeAttribute('inert')
        el.removeAttribute('aria-hidden')
        delete el.dataset.hudConsultCovered
      }
    }
  }, [mobilePanelOpen])

  useEffect(() => {
    if (typeof document === 'undefined') return undefined
    const root = document.documentElement
    if (mobilePanelOpen) root.dataset.hudConsultOpen = '1'
    else delete root.dataset.hudConsultOpen
    return () => { delete root.dataset.hudConsultOpen }
  }, [mobilePanelOpen])

  // Escape fecha só a consulta — não cancela a compra.
  useEffect(() => {
    if (!mobilePanelOpen) return undefined
    const onKey = (event) => {
      if (event.key !== 'Escape') return
      event.preventDefault()
      event.stopPropagation()
      setMobileConsultOpen(false)
      queueMicrotask(() => openToggleRef.current?.focus?.())
    }
    document.addEventListener('keydown', onKey, true)
    return () => document.removeEventListener('keydown', onKey, true)
  }, [mobilePanelOpen])

  useEffect(() => {
    if (!mobilePanelOpen) return undefined
    const t = window.setTimeout(() => closeConsultRef.current?.focus?.(), 0)
    return () => window.clearTimeout(t)
  }, [mobilePanelOpen])

  const openMobileConsult = () => {
    openToggleRef.current = toggleRef.current
    setMobileConsultOpen(true)
  }

  const closeMobileConsult = () => {
    setMobileConsultOpen(false)
    queueMicrotask(() => openToggleRef.current?.focus?.())
  }

  const sidebarProps = {
    totals: consultTotals,
    players,
    lastRoll,
    isRolling,
    hostId,
    turnPlayerId,
    turnAbsenceStatus,
    meId: consultMeId,
    cash: consultCash,
  }

  const mobileToggle = allowMobileConsult && typeof document !== 'undefined' && !mobilePanelOpen
    ? createPortal(
      <button
        ref={toggleRef}
        type="button"
        className="hudConsultToggle"
        data-hud-consult-toggle="open"
        aria-expanded="false"
        aria-controls="hud-decision-mobile-panel"
        onClick={openMobileConsult}
      >
        Minha empresa
      </button>,
      document.body,
    )
    : null

  const mobilePanel = mobilePanelOpen && typeof document !== 'undefined'
    ? createPortal(
      <aside
        id="hud-decision-mobile-panel"
        className="hudConsultRegion hudConsultRegion--mobileDecision"
        data-hud-consult-region="mobile"
        role="dialog"
        aria-modal="true"
        aria-label="Consulta da empresa"
      >
        <div className="hudConsultMobileBar">
          <strong className="hudConsultMobileTitle">Minha empresa</strong>
          <button
            ref={closeConsultRef}
            type="button"
            className="hudConsultClose"
            data-hud-consult-toggle="close"
            onClick={closeMobileConsult}
          >
            Fechar consulta
          </button>
        </div>
        <HudDesktopSidebar
          {...sidebarProps}
          variant="sheet"
          idPrefix="hud-decision-mobile"
        />
      </aside>,
      document.body,
    )
    : null

  return (
    <>
      <span
        hidden
        data-hud-bridge-sentinel
        data-mode={resolvedHudMode}
        data-depth={String(depth)}
        data-stack={String(stackDepth)}
        data-mobile={isMobileDecision ? '1' : '0'}
        data-mobile-open={mobilePanelOpen ? '1' : '0'}
        data-desktop={showDesktopHud ? '1' : '0'}
      />
      {showDesktopHud ? (
        <div className="hudConsultRegion" data-hud-consult-region="desktop">
          <HudDesktopSidebar {...sidebarProps} variant="sidebar" />
        </div>
      ) : null}
      {mobileToggle}
      {mobilePanel}
    </>
  )
}
