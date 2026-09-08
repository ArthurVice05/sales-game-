import test from 'node:test'
import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'
import { build } from 'esbuild'
import React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'

const bundle = await build({
  entryPoints: [fileURLToPath(new URL('../FinalWinners.jsx', import.meta.url))],
  bundle: true, write: false, format: 'cjs', platform: 'node',
  external: ['react', 'react-dom', 'three', 'three/*'], loader: { '.css': 'empty' },
})
const module = { exports: {} }
new Function('require', 'module', 'exports', bundle.outputFiles[0].text)(createRequire(import.meta.url), module, module.exports)
const FinalWinners = module.exports.default
const players = [
  { id: 'jp', name: 'JP', cash: 26570, bens: 15000 },
  { id: 'arthur', name: 'Arthur', cash: 20040, bens: 4000 },
  { id: 'long', name: 'Nome muito longo sem corte ou omissão', cash: -1000, bens: 0 },
  { id: 'bankrupt', name: 'Falido identificado', bankrupt: true, cash: 99999, bens: 1000 },
]

test('DOM inicial acessível mostra ranking completo, dinheiro final e saída habilitada para 1–4 jogadores', () => {
  for (let n = 1; n <= 4; n++) {
    const input = structuredClone(players.slice(0, n)), before = structuredClone(input)
    const html = renderToStaticMarkup(React.createElement(FinalWinners, { players: input, maxRounds: 10, endedRound: 8, exitLabel: 'Sair agora' }))
    assert.match(html, /role="dialog"/)
    assert.match(html, /Fim da partida/)
    assert.match(html, /Caixa \+ Bens/)
    assert.match(html, /fwr3d-srOnly">\$ 41\.570/)
    assert.match(html, /Caixa: <b>\$ 26\.570/)
    assert.match(html, /Bens: <b>\$ 15\.000/)
    assert.match(html, /<button[^>]*>Sair agora<\/button>/)
    assert.doesNotMatch(html, /disabled|finalMedal|aria-live/)
    for (const player of input) assert.ok(html.includes(player.name))
    assert.equal((html.match(/class="fwr3d-columnLabel /g) || []).length, Math.min(n, 3))
    if (n > 1) assert.ok(html.indexOf('fwr3d-columnLabel fwr3d-place-2') < html.indexOf('fwr3d-columnLabel fwr3d-place-1'))
    if (n === 4) assert.match(html, /Falido identificado \(falido\)/)
    assert.deepEqual(input, before)
  }
})

test('DOM não apresenta NaN/Infinity como patrimônio inventado', () => {
  const html = renderToStaticMarkup(React.createElement(FinalWinners, { players: [{ name: 'Inválido', cash: Infinity }] }))
  assert.match(html, /Indisponível/)
  assert.match(html, /coluna não representada/)
  assert.doesNotMatch(html, /NaN|Infinity/)
})
