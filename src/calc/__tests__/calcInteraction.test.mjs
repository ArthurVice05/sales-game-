import test from 'node:test'
import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'
import { readFileSync } from 'node:fs'
import { build } from 'esbuild'
import React from 'react'
import { installDomShim } from '../../game/__tests__/helpers/domShim.mjs'
import { getBoardDefinition, getNewGameBoardVersion } from '../../data/boardVersions.js'
import { createCalcGame, CALC_STORAGE_KEY, parseCalcSession } from '../calcModel.js'
import { MANUAL_CONSTANTS } from '../../game/manualConstants.js'

const require = createRequire(import.meta.url)
const bundle = await build({
  entryPoints: [fileURLToPath(new URL('../SalesGameCalc.jsx', import.meta.url))],
  bundle: true, write: false, format: 'cjs', platform: 'node',
  define: { 'import.meta.env.DEV': 'false' },
  external: ['react', 'react-dom'], loader: { '.css': 'empty', '.jpg': 'empty', '.png': 'empty' },
})
const mod = { exports: {} }
new Function('require', 'module', 'exports', bundle.outputFiles[0].text)(require, mod, mod.exports)
const SalesGameCalc = mod.exports.default

const BOARD = getBoardDefinition(getNewGameBoardVersion())
const TRAINING_INDEX = BOARD.tiles.findIndex((tile) => tile.arrivalEvent === 'TRAINING' && !tile.passageEvent)
const PRICE = MANUAL_CONSTANTS.trainingPrice
const nbsp = (text) => text.replace(/ /g, ' ')

function walk(fiber, visit) {
  for (let node = fiber; node; node = node.sibling) {
    visit(node)
    if (node.child) walk(node.child, visit)
  }
}
const labelOf = (props) => {
  const parts = []
  const visit = (child) => {
    if (child == null || child === false) return
    if (typeof child === 'string' || typeof child === 'number') parts.push(String(child))
    else if (Array.isArray(child)) child.forEach(visit)
    else if (child.props) visit(child.props.children)
  }
  visit(props.children)
  return nbsp(parts.join('')).replace(/\s+/g, ' ').trim()
}

async function mount(game) {
  const dom = installDomShim()
  globalThis.confirm = () => true
  // O shim de DOM do projeto não modela <select>; React só lê `options`.
  const createElement = dom.document.createElement
  dom.document.createElement = (tag) => {
    const el = createElement(tag)
    if (tag === 'select') el.options = []
    return el
  }
  const { createRoot } = require('react-dom/client')
  const root = createRoot(dom.createContainer())
  await React.act(async () => { root.render(React.createElement(SalesGameCalc, { initialGame: game })) })
  const fiber = () => root._internalRoot.current
  const h = {
    text() {
      let out = ''
      walk(fiber(), (node) => {
        if (node.tag === 6 && typeof node.memoizedProps === 'string') out += node.memoizedProps + '\n'
        const c = node.tag === 5 ? node.memoizedProps?.children : undefined
        if (typeof c === 'string' || typeof c === 'number') out += c + '\n'
      })
      return nbsp(out)
    },
    buttons() {
      const found = []
      walk(fiber(), (node) => {
        const props = node.memoizedProps
        if (node.tag === 5 && node.type === 'button' && props && typeof props.onClick === 'function') found.push({ label: labelOf(props), props })
      })
      return found
    },
    has: (label) => h.buttons().some((b) => b.label.includes(label)),
    async click(label, index = 0) {
      const hit = h.buttons().filter((b) => b.label.includes(label))[index]
      if (!hit) throw new Error(`sem botão "${label}": ${h.buttons().map((b) => b.label).join(' | ')}`)
      assert.notEqual(hit.props.disabled, true, `botão "${label}" está desabilitado`)
      await React.act(async () => { hit.props.onClick({ preventDefault() {}, stopPropagation() {} }) })
    },
    pressed(label) {
      return h.buttons().find((b) => b.label.replace(/^✓ /, '') === label)?.props['aria-pressed']
    },
    saved() { return parseCalcSession(dom.localStorage.getItem(CALC_STORAGE_KEY)) },
    async unmount() { await React.act(async () => { root.unmount() }) },
  }
  return h
}

const rich = (extra = {}) => {
  const game = createCalcGame(['Ana', 'Bruno'], 3)
  game.players[0] = { ...game.players[0], vendedoresComuns: 2, fieldSales: 1, cash: 4000, ...extra }
  return game
}
const onTraining = (extra) => {
  const game = rich(extra)
  game.players[0].pos = TRAINING_INDEX - 1
  return game
}

test('the Recuperação tab is always visible with a game in progress, even with positive cash', async () => {
  const h = await mount(rich({ cash: 50000 }))
  for (const tab of ['Jogar', 'Recuperação', 'Placar', 'Histórico']) assert.ok(h.has(tab), tab)
  await h.unmount()
})

test('Recuperação opens before the dice and shows the player, cash and every option', async () => {
  const h = await mount(rich({ cash: 50000 }))
  await h.click('Recuperação')
  const text = h.text()
  assert.match(text, /Recuperação financeira/)
  assert.match(text, /Ana/)
  assert.match(text, /Caixa atual/)
  assert.match(text, /R\$ 50\.000/)
  for (const label of ['Contratar empréstimo', 'Demitir e recuperar', 'Declarar falência', 'Voltar para Jogar']) assert.ok(h.has(label), label)
  await h.unmount()
})

test('recovery without a turn changes the current player but consumes nothing', async () => {
  const h = await mount(rich())
  const before = h.saved?.() // nothing saved yet is fine
  await h.click('Recuperação')
  await h.click('Demitir e recuperar')
  const { game, turn } = h.saved()
  assert.equal(turn, null)
  assert.ok(game.players[0].cash > 4000)
  assert.equal(game.players[0].vendedoresComuns, 1)
  assert.equal(game.players[0].pos, 0)
  assert.equal(game.currentPlayerIndex, 0)
  assert.equal(game.round, 1)
  assert.equal(game.history.at(-1).kind, 'RECOVERY')
  await h.click('Voltar para Jogar')
  assert.match(h.text(), /Quanto saiu no dado físico/)
  void before
  await h.unmount()
})

test('recovery during a turn changes turn.player, keeps the event and returns to it', async () => {
  const h = await mount(onTraining())
  await h.click('1')
  assert.match(h.text(), /Profissional/)
  await h.click('Recuperação')
  assert.ok(h.has('Voltar ao evento'))
  await h.click('Demitir e recuperar')
  const { game, turn } = h.saved()
  assert.ok(turn.player.cash > 4000)
  assert.equal(game.players[0].cash, 4000, 'game state untouched until the turn is confirmed')
  assert.equal(turn.eventIndex, 0)
  assert.equal(turn.dice, 1)
  assert.equal(game.currentPlayerIndex, 0)
  await h.click('Voltar ao evento')
  assert.match(h.text(), /Profissional/)
  assert.equal(h.has('Voltar ao evento'), false)
  await h.unmount()
})

test('unavailable options explain themselves and the tab stays', async () => {
  const h = await mount(rich({ vendedoresComuns: 0, fieldSales: 0, insideSales: 0, gestores: 0, loanTakenInMatch: true }))
  await h.click('Recuperação')
  const text = h.text()
  assert.match(text, /Empréstimo indisponível/)
  assert.match(text, /já foi utilizado/)
  assert.match(text, /Nenhum colaborador disponível para demissão\./)
  assert.match(text, /Nenhum investimento disponível para redução\./)
  assert.ok(h.has('Recuperação'))
  await h.unmount()
})

test('training lets the player pick 2 and 3 certificates and totals every selection', async () => {
  const h = await mount(onTraining({ cash: 20000 }))
  await h.click('1')
  assert.match(h.text(), /0 treinamentos selecionados/)
  await h.click('Azul')
  await h.click('Amarelo')
  assert.match(h.text(), new RegExp(`2 treinamentos selecionados`))
  assert.match(h.text(), new RegExp(`Total: R\\$ ${(2 * PRICE).toLocaleString('pt-BR')}`))
  await h.click('Roxo')
  assert.match(h.text(), /3 treinamentos selecionados/)
  assert.match(h.text(), new RegExp(`Total: R\\$ ${(3 * PRICE).toLocaleString('pt-BR')}`))
  assert.equal(h.pressed('Azul'), true)
  assert.equal(h.pressed('Roxo'), true)
  await h.unmount()
})

test('training supports several professionals at once and the preview covers everything', async () => {
  const h = await mount(onTraining({ cash: 20000 }))
  await h.click('1')
  await h.click('Canal Representantes')
  await h.click('Azul')
  await h.click('Amarelo')
  assert.match(h.text(), /4 treinamentos selecionados/)
  const text = h.text()
  for (const row of ['Caixa', 'Capacidade', 'Faturamento', 'Despesas', 'Patrimônio']) assert.match(text, new RegExp(row))
  assert.match(text, new RegExp(`R\\$ 20\\.000`))
  assert.match(text, new RegExp(`R\\$ ${(20000 - 4 * PRICE).toLocaleString('pt-BR')}`))
  await h.unmount()
})

test('confirming applies every selected certificate', async () => {
  const h = await mount(onTraining({ cash: 20000 }))
  await h.click('1')
  await h.click('Canal Representantes')
  await h.click('Azul')
  await h.click('Roxo')
  await h.click('Confirmar compra de Treinamento')
  const { turn } = h.saved()
  assert.equal(turn.player.cash, 20000 - 4 * PRICE)
  assert.deepEqual(turn.player.trainingsByVendor.comum.sort(), ['imersaomultiplier', 'personalizado'])
  assert.deepEqual(turn.player.trainingsByVendor.field.sort(), ['imersaomultiplier', 'personalizado'])
  await h.unmount()
})

test('insufficient cash offers recovery, keeps the selection and recalculates after recovering', async () => {
  const h = await mount(onTraining({ cash: 600 }))
  await h.click('1')
  await h.click('Azul')
  await h.click('Amarelo')
  await h.click('Roxo')
  assert.match(h.text(), /Caixa insuficiente para esta compra\./)
  assert.ok(h.has('Abrir recuperação financeira'))
  assert.equal(h.buttons().find((b) => b.label.startsWith('Confirmar compra')).props.disabled, true)
  await h.click('Abrir recuperação financeira')
  assert.ok(h.has('Voltar ao evento'))
  assert.equal(h.has('Roxo'), true, 'event stays mounted, selection is not discarded')
  await h.click('Demitir e recuperar')
  await h.click('Voltar ao evento')
  assert.equal(h.pressed('Azul'), true)
  assert.equal(h.pressed('Amarelo'), true)
  assert.equal(h.pressed('Roxo'), true)
  assert.match(h.text(), /3 treinamentos selecionados/)
  assert.equal(h.text().includes('Caixa insuficiente para esta compra.'), false)
  assert.equal(h.buttons().find((b) => b.label.startsWith('Confirmar compra')).props.disabled, false)
  await h.unmount()
})

test('mobile: toggles are touch-sized, controls wrap and the tabs fit', () => {
  const css = readFileSync(fileURLToPath(new URL('../calc.css', import.meta.url)), 'utf8')
  assert.match(css, /\.calcToggleGroup\{[^}]*flex-wrap:wrap/)
  assert.match(css, /\.calcToggleGroup button\{[^}]*min-height:44px/)
  assert.match(css, /@media \(max-width: 600px\)/)
})
