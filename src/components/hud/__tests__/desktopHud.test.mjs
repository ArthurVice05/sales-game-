/**
 * HUD desktop — camada de apresentação.
 * Não altera motor, board, callbacks nem persistência.
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '../../../..')
const hudDir = join(root, 'src/components/hud')
const app = readFileSync(join(root, 'src/App.jsx'), 'utf8')
const header = readFileSync(join(hudDir, 'GameDesktopHeader.jsx'), 'utf8')
const sidebar = readFileSync(join(hudDir, 'HudDesktopSidebar.jsx'), 'utf8')
const card = readFileSync(join(hudDir, 'HudMetricCard.jsx'), 'utf8')
const css = readFileSync(join(hudDir, 'desktop-hud.css'), 'utf8')
const controls = readFileSync(join(root, 'src/components/Controls.jsx'), 'utf8')
const boardCss = readFileSync(join(root, 'src/components/board/landscape-board.css'), 'utf8')

const {
  deriveMonthlyResult,
  monthlyResultTone,
  gaugeRatio,
  formatHudCash,
  HUD_TABS,
  buildHudGauges,
  rosterPlayerStatus,
  hudTabDomId,
} = await import('../hudPresentation.js')
const { getDesktopHudLayoutMatches, DESKTOP_HUD_MEDIA } = await import('../useDesktopHudLayout.js')

test('Caixa, faturamento e OPEX vêm dos dados recebidos, sem hardcode da referência', () => {
  assert.match(header, /formatHudCash\(cash\)/)
  assert.match(header, /totals\.faturamento/)
  assert.match(header, /totals\.manutencao/)
  assert.doesNotMatch(header, /1\/15/)
  assert.doesNotMatch(header, /R\$ 42\.000/)
  assert.match(header, /formatRoundProgress\(/)
  assert.match(header, /<TurnTimer/)
  assert.match(card, /value/)
  assert.match(card, /label/)
})

test('resultado mensal é derivação de faturamento − manutenção', () => {
  assert.equal(deriveMonthlyResult(770, 1150), -380)
  assert.equal(deriveMonthlyResult(2000, 1150), 850)
  assert.equal(deriveMonthlyResult(undefined, 100), -100)
  assert.equal(monthlyResultTone(-380), 'negative')
  assert.equal(monthlyResultTone(850), 'positive')
  assert.equal(monthlyResultTone(0), 'neutral')
  assert.match(header, /deriveMonthlyResult\(/)
  assert.doesNotMatch(header, /resultado=\{-?380\}/)
})

test('round, timer e host usam contratos existentes', () => {
  assert.match(header, /formatRoundProgress\(round, maxRounds, gameOver\)/)
  assert.match(header, /turnDeadlineAt/)
  assert.match(header, /iAmHost/)
  assert.match(header, /Você é o Host/)
  assert.match(header, /SalesGame_Logo-removebg-preview\.png/)
})

test('callbacks de ação permanecem os originais; disabled usa a prop existente', () => {
  assert.match(app, /onAction=\{onControlsAction\}/)
  assert.match(app, /section="primary"/)
  assert.match(app, /section="secondary"/)
  assert.match(controls, /onClick=\{roll\}/)
  assert.match(controls, /disabled=\{!canRoll\}/)
  assert.match(controls, /type: 'RECOVERY_MODAL'/)
  assert.match(controls, /type: 'BANKRUPT_MODAL'/)
  assert.doesNotMatch(header, /onAction/)
  assert.doesNotMatch(sidebar, /RECOVERY_MODAL|BANKRUPT_MODAL|onAction/)
})

test('spectator não ganha controles; máquina aparece no roster', () => {
  assert.match(app, /isSpectator \? \(/)
  assert.match(app, /SpectatorPanel/)
  assert.match(app, /!isSpectator && \(/)
  assert.match(sidebar, /isBotPlayer/)
  assert.match(sidebar, /Máquina|isBot/)
})

test('tabs são estado local de UI e não escrevem gameplay', () => {
  assert.deepEqual(HUD_TABS, ['empresa', 'comercial', 'estrutura', 'ranking'])
  assert.match(sidebar, /useState\('empresa'\)/)
  assert.match(sidebar, /role="tablist"/)
  assert.match(sidebar, /role="tab"/)
  assert.match(sidebar, /aria-selected/)
  assert.doesNotMatch(sidebar, /setRound|setPlayers|netCommit|broadcastState|supabase/)
  assert.doesNotMatch(header, /setRound|setPlayers|netCommit/)
})

test('board permanece o wrapper atual; HUD não importa o CSS do tabuleiro', () => {
  assert.match(app, /className=\{`boardWrap\$\{boardView === 'follow' \? ' boardWrap--follow' : ''\}`\}/)
  assert.match(app, /<Board\s+players=\{players\}/)
  assert.doesNotMatch(header, /landscape-board|LandscapeBoard|sg40GameBoard/)
  assert.doesNotMatch(sidebar, /landscape-board|LandscapeBoard|sg40GameBoard/)
  assert.match(boardCss, /--sg40-well-molding/)
  assert.match(css, /@media \(min-width: 1200px\)/)
  assert.match(css, /minmax\(0,\s*1fr\)/)
  assert.match(css, /clamp\(320px,\s*22vw,\s*370px\)/)
  assert.doesNotMatch(css, /transform:\s*scale\(/)
})

test('uma instância ativa de TurnTimer/Controls por viewport; mesmo callback de roll', () => {
  assert.match(app, /useDesktopHudLayout\(/)
  assert.match(app, /desktopHud \?/)
  assert.match(app, /<GameDesktopHeader/)
  assert.match(app, /<header className="topbar">/)
  assert.equal((app.match(/<TurnTimer/g) || []).length, 1)
  assert.equal((header.match(/<TurnTimer/g) || []).length, 1)
  assert.ok(((app.match(/onAction=\{onControlsAction\}/g) || []).length === 2)
    || ((app.match(/onAction=\{onControlsAction\}/g) || []).length === 3))
  assert.doesNotMatch(app, /desktopOnRoll|mobileOnRoll|onRoll=\{/)
  assert.doesNotMatch(app, /const onControlsAction =[\s\S]*const onControlsAction =/)
  assert.match(css, /min-width: 1200px/)
  assert.equal(DESKTOP_HUD_MEDIA, '(min-width: 1200px)')
  assert.equal(getDesktopHudLayoutMatches({ matchMedia: (q) => ({ matches: q === '(min-width: 1200px)' }) }), true)
  assert.equal(getDesktopHudLayoutMatches({ matchMedia: () => ({ matches: false }) }), false)
  assert.doesNotMatch(css, /sg40|LandscapeBoard|preview__tile|board-center/)
})

test('gauge não divide por zero', () => {
  assert.equal(gaugeRatio(1, 2), 0.5)
  assert.equal(gaugeRatio(0, 0), 0)
  assert.equal(gaugeRatio(3, 0), 0)
  assert.equal(formatHudCash(null), '—')
  assert.match(formatHudCash(18000).replace(/\u00a0/g, ' '), /R\$ 18\.000/)
})

test('gauges usam denominadores reais: atendimento/capacidade e atendimento/clientes', () => {
  const gauges = buildHudGauges({ clientsAt: 1, possibAt: 2, clientes: 4 })
  assert.equal(gauges.length, 2)
  assert.deepEqual(
    gauges.map((g) => [g.key, g.used, g.total, g.hasRatio]),
    [
      ['capacity', 1, 2, true],
      ['clients', 1, 4, true],
    ],
  )
  const empty = buildHudGauges({ clientsAt: 1, possibAt: 0, clientes: 0 })
  assert.equal(empty[0].hasRatio, false)
  assert.equal(empty[1].hasRatio, false)
  assert.match(empty[0].value, /1\s*\/\s*0/)
  assert.match(sidebar, /buildHudGauges/)
  assert.doesNotMatch(sidebar, /Math\.max\(clients,\s*cap,\s*1\)/)
  assert.doesNotMatch(sidebar, /HudGauge[\s\S]{0,120}Em atendimento/)
})

test('roster diferencia falido, vez, desconectado e aguardando sem inventar presença', () => {
  assert.equal(rosterPlayerStatus({ bankrupt: true }, {}).label, 'Falido')
  assert.equal(
    rosterPlayerStatus({ id: 'a' }, { turnPlayerId: 'a' }).label,
    'Na vez',
  )
  assert.equal(
    rosterPlayerStatus({ id: 'a' }, { turnPlayerId: 'a', turnAbsenceStatus: 'waiting' }).label,
    'Desconectado',
  )
  assert.equal(rosterPlayerStatus({ id: 'b' }, { turnPlayerId: 'a' }).label, 'Aguardando')
  assert.match(sidebar, /turnAbsenceStatus/)
  assert.match(sidebar, /rosterPlayerStatus/)
  assert.doesNotMatch(sidebar, /Linha do tempo|Início da rodada/)
  assert.match(sidebar, /Ver ranking completo/)
})

test('abas e indicadores não partem palavras; IDs do sheet são prefixados', () => {
  assert.equal(hudTabDomId('hud-sheet', 'empresa'), 'hud-sheet-tab-empresa')
  assert.match(sidebar, /idPrefix/)
  assert.match(sidebar, /hudTabDomId/)
  assert.match(css, /word-break:\s*keep-all/)
  assert.match(css, /overflow-wrap:\s*normal/)
  assert.match(css, /hyphens:\s*none/)
  assert.match(css, /hudDesktopTabs[\s\S]{0,280}flex-wrap:\s*wrap/)
  assert.match(header, /Faturamento/)
  assert.match(header, /Despesas|Manutenção/)
})

test('tipografia do HUD desktop cabe no header de 80px sem mudar colunas', () => {
  assert.match(css, /--topbar-h:\s*80px/)
  assert.match(css, /clamp\(320px,\s*22vw,\s*370px\)/)
  assert.match(css, /\.hudMetricCardLabel[\s\S]{0,120}font-size:\s*12px/)
  assert.match(css, /\.hudMetricCardValue[\s\S]{0,160}font-size:\s*1[89]px/)
  assert.match(css, /\.hudCardTitle[\s\S]{0,80}font-size:\s*1[456]px/)
  assert.doesNotMatch(css, /transform:\s*scale\(/)
  assert.doesNotMatch(css, /100cqh\s*\*\s*13/)
})

test('HUD tem fallback sem serifa sem exigir Inter instalada nem CSS do tabuleiro', () => {
  const hudStack = css.slice(0, css.indexOf('.hudMetricCard {'))
  assert.match(hudStack, /font-family:[\s\S]{0,120}Segoe UI/)
  assert.match(hudStack, /font-family:[\s\S]{0,160}sans-serif/)
  assert.match(hudStack, /\.gameDesktopHeader/)
  assert.match(hudStack, /\.hudDesktop/)
  assert.match(hudStack, /\.hudSheet/)
  assert.doesNotMatch(css, /sg40Preview__tileLabel|sg40GameBoard\s*\{[^}]*font-family/)
  assert.doesNotMatch(css, /@font-face/)
})

test('aviso do turno e botão de rolar usam cores explícitas no HUD', () => {
  assert.match(css, /turnPrimaryActions \.nextStepHint[\s\S]{0,280}color:\s*#f/)
  assert.match(css, /turnPrimaryActions \.btn\.go[\s\S]{0,240}background(?:-color)?:\s*#5/)
  assert.match(css, /turnPrimaryActions \.btn\.go[\s\S]{0,320}color:\s*#f/)
  assert.match(css, /btn\.go\[disabled\][\s\S]{0,200}background(?:-color)?:/)
  assert.doesNotMatch(css, /sg40Preview__tileLabel/)
})

test('Resumo mobile reutiliza o painel do notebook; overlays devolvem o foco', () => {
  assert.match(app, /idPrefix=["']hud-sheet["']/)
  assert.match(app, /HudDesktopSidebar/)
  const sheet = app.slice(app.indexOf('{hudSheetOpen &&'))
  assert.match(sheet, /<HudDesktopSidebar/)
  assert.doesNotMatch(sheet.slice(0, 900), /<HUD\s+totals=\{totals\}/)
  assert.match(app, /HudCompactPeek/)
  assert.match(app, /useHudOverlayFocus/)
  assert.match(app, /turnAbsenceStatus=\{turnAbsenceStatus\}/)
})
