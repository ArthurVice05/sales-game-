import test from 'node:test'
import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'
import { build } from 'esbuild'
import React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { createCalcGame, previewCalcPurchase } from '../calcModel.js'

const bundle = await build({
  entryPoints: [fileURLToPath(new URL('../SalesGameCalc.jsx', import.meta.url))],
  bundle: true, write: false, format: 'cjs', platform: 'node',
  define: { 'import.meta.env.DEV': 'false' },
  external: ['react', 'react-dom'], loader: { '.css': 'empty', '.jpg': 'empty', '.png': 'empty' },
})
const module = { exports: {} }
new Function('require', 'module', 'exports', bundle.outputFiles[0].text)(createRequire(import.meta.url), module, module.exports)
const SalesGameCalc = module.exports.default
const PurchaseChoice = module.exports.PurchaseChoice
const Recovery = module.exports.Recovery

test('new physical game screen asks for players and links back to start', () => {
  const html = renderToStaticMarkup(React.createElement(SalesGameCalc))
  assert.match(html, /Sales Game Calc/)
  assert.match(html, /Quantos jogadores/)
  assert.match(html, /Iniciar partida/)
  assert.match(html, /href="\/"[^>]*>.*Voltar ao início/)
})

test('active game screen shows current player and six physical die choices', () => {
  const html = renderToStaticMarkup(React.createElement(SalesGameCalc, { initialGame: createCalcGame(['Ana', 'Bruno'], 2) }))
  assert.match(html, /Ana/)
  assert.match(html, /Rodada 1 de 2/)
  assert.match(html, /Quanto saiu no dado físico/)
  for (let face = 1; face <= 6; face += 1) assert.match(html, new RegExp(`>${face}<\\/button>`))
  assert.match(html, /Placar/)
  assert.match(html, /Histórico/)
})

test('an unaffordable purchase exposes recovery instead of forcing a skip', () => {
  const player = { ...createCalcGame(['Ana', 'Bruno']).players[0], cash: 100 }
  const html = renderToStaticMarkup(React.createElement(PurchaseChoice, {
    player, event: { kind: 'CLIENTS' }, onResolve: () => {}, onOpenRecovery: () => {}, error: '', setError: () => {},
  }))
  assert.match(html, /Caixa insuficiente para esta compra/)
  assert.match(html, /Abrir recuperação financeira/)
})

test('recovery screen offers official level reduction when owned', () => {
  const player = previewCalcPurchase(createCalcGame(['Ana', 'Bruno']).players[0], 'MIX', { level: 'A' }).afterPlayer
  const html = renderToStaticMarkup(React.createElement(Recovery, {
    turn: { player }, round: 1, onRecover: () => {}, onCancel: () => {},
  }))
  assert.match(html, /Reduzir Mix nível A/)
  assert.match(html, /R\$\s*6\.000/)
})

test('training can target the only owned employee type', () => {
  const player = { ...createCalcGame(['Ana', 'Bruno']).players[0], vendedoresComuns: 0, fieldSales: 1 }
  const html = renderToStaticMarkup(React.createElement(PurchaseChoice, {
    player, event: { kind: 'TRAINING' }, onResolve: () => {}, onOpenRecovery: () => {}, error: '', setError: () => {},
  }))
  assert.match(html, /Confirmar compra de Treinamento/)
  assert.doesNotMatch(html, /disabled=""[^>]*>Confirmar compra de Treinamento/)
})
