/**
 * Ponte: decisão aberta ↔ HUD lateral real (não cópia no modal).
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, existsSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '../../..')
const read = (rel) => readFileSync(join(root, rel), 'utf8')

test('não há mais painel de abas embutido na decisão', () => {
  assert.equal(existsSync(join(root, 'src/modals/DecisionConsultLayout.jsx')), false)
  assert.equal(existsSync(join(root, 'src/modals/decision-consult.css')), false)
  const shell = read('src/modals/TileModalShell.jsx')
  assert.doesNotMatch(shell, /DecisionConsultLayout|enableConsult|Consultar minha empresa/)
})

test('ModalContext expõe profundidade e overlay com classe de ponte', () => {
  const ctx = read('src/modals/ModalContext.jsx')
  assert.match(ctx, /data-sg-modal-depth|sgModalDepth/)
  assert.match(ctx, /sgModalOverlay/)
})

test('CSS eleva somente a região informativa do HUD, não o sidebar inteiro', () => {
  const css = read('src/modals/decision-hud-bridge.css')
  assert.match(css, /\.hudConsultRegion/)
  assert.match(css, /\[data-sg-modal-depth="1"\]/)
  assert.match(css, /z-index:\s*1005[0-9]/)
  assert.match(css, /turnPrimaryActions/)
  assert.match(css, /pointer-events:\s*none/)
  assert.match(css, /padding-right|sgModalOverlay/)
})

test('CSS da decisão mobile torna o hudDesktop visível fora do breakpoint desktop', () => {
  const css = read('src/modals/decision-hud-bridge.css')
  assert.match(
    css,
    /\.hudConsultRegion--mobileDecision[\s\S]{0,220}\.hudDesktop[\s\S]{0,80}display:\s*flex/,
  )
})

test('mobile usa HUD recolhível externo sem reservar largura do formulário', () => {
  const css = read('src/modals/decision-hud-bridge.css')
  const bridge = read('src/components/hud/HudConsultBridge.jsx')
  // Sem padding-right obrigatório por :has(painel) — causa do recorte no Safari.
  assert.doesNotMatch(
    css,
    /:has\(\.hudConsultRegion--mobileDecision\)\s+\.sgModalOverlay\s*\{[^}]*padding-right/,
  )
  assert.match(bridge, /Minha empresa/)
  assert.match(bridge, /Fechar consulta/)
  assert.match(bridge, /mobileConsultOpen|setMobileConsultOpen/)
  // Painel só monta aberto; botão existe com decisão.
  assert.match(bridge, /hudConsultToggle|data-hud-consult-toggle/)
  // Financeiro permanece no conteúdo rolável (não some só por altura).
  assert.doesNotMatch(css, /hudFinanceStrip\s*\{\s*display:\s*none/)
})

test('desktop permanece com decisão e HUD simultâneos', () => {
  const css = read('src/modals/decision-hud-bridge.css')
  assert.match(
    css,
    /@media \(min-width:\s*1200px\)[\s\S]*?padding-right:\s*clamp\(336px/,
  )
})

test('compra registra comprador para o HUD lateral', () => {
  const bridge = read('src/modals/decisionBuyerContext.jsx')
  assert.match(bridge, /useRegisterDecisionBuyer|registerBuyer/)
  const clients = read('src/modals/BuyClientsModal.jsx')
  assert.match(clients, /useRegisterDecisionBuyer/)
  assert.doesNotMatch(clients, /enableConsult/)
})

test('App usa HudConsultBridge com região hudConsultRegion', () => {
  const app = read('src/App.jsx')
  const bridge = read('src/components/hud/HudConsultBridge.jsx')
  assert.match(app, /HudConsultBridge/)
  assert.match(app, /DecisionBuyerProvider/)
  assert.doesNotMatch(app, /DecisionConsultProvider|DecisionConsultLayout/)
  assert.match(bridge, /hudConsultRegion/)
  assert.match(bridge, /buildPlayerHudTotals/)
})

test('bridge mobile reage ao viewport real e porta o HUD fora do modal', () => {
  const bridge = read('src/components/hud/HudConsultBridge.jsx')
  assert.match(bridge, /createPortal/)
  assert.match(bridge, /hudChromeModeForViewport/)
  assert.match(bridge, /window\.innerWidth|clientWidth/)
  assert.match(bridge, /window\.innerHeight|clientHeight/)
  // Mesma resolução de módulo que main/useTurnEngine (sem sufixo .jsx).
  assert.match(bridge, /from ['"]\.\.\/\.\.\/modals\/ModalContext['"]/)
  assert.doesNotMatch(bridge, /from ['"]\.\.\/\.\.\/modals\/ModalContext\.jsx['"]/)
  assert.match(bridge, /data-sg-modal-depth|readModalDepthFromDom|sgModalDepth/)
})
