/**
 * Contratos estruturais: Sorte/Revés não pode ser ignorado pelo X.
 * Executar: node --test src/modals/__tests__/sorteRevesModal.test.mjs
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const here = dirname(fileURLToPath(import.meta.url))
const modalSrc = readFileSync(join(here, '..', 'SorteRevesModal.jsx'), 'utf8')
// O baralho e a resolução foram extraídos para um módulo puro (testável sem DOM);
// o modal importa de lá. O contrato APPLY_CARD passou a viver neste arquivo.
const deckSrc = readFileSync(join(here, '..', 'sorteRevesDeck.js'), 'utf8')
const engineSrc = readFileSync(join(here, '..', '..', 'game', 'useTurnEngine.jsx'), 'utf8')

test('SorteRevesModal não possui botão X / aria-label Fechar', () => {
  assert.doesNotMatch(modalSrc, /aria-label=["']Fechar["']/)
  assert.doesNotMatch(modalSrc, />\s*✕\s*</)
  assert.doesNotMatch(modalSrc, /\bS\.close\b/)
})

test('SorteRevesModal não possui SKIP voluntário para fechar', () => {
  assert.doesNotMatch(modalSrc, /onResolve\?\.\(\{\s*action:\s*['"]SKIP['"]\s*\}\)/)
  assert.doesNotMatch(modalSrc, /action:\s*['"]SKIP['"]/)
})

test('SorteRevesModal confirma com APPLY_CARD via resolved.payload', () => {
  // O payload APPLY_CARD é montado no baralho puro…
  assert.match(deckSrc, /action:\s*['"]APPLY_CARD['"]/)
  // …e o modal obrigatoriamente resolve por ele (sem baralho próprio).
  assert.match(modalSrc, /import \{ SORTE_REVES_CARDS, resolveCardEffect \} from '\.\/sorteRevesDeck\.js'/)
  assert.match(modalSrc, /resolveCardEffect\(card, player\)/)
  assert.doesNotMatch(modalSrc, /_compute:/, 'o modal nao pode voltar a ter baralho proprio')

  assert.match(modalSrc, /onResolve\?\.\(resolved\.payload\)/)
  assert.match(modalSrc, /onClick=\{resolve\}/)
})

test('useTurnEngine continua exigindo APPLY_CARD para LUCK', () => {
  const luckIdx = engineSrc.indexOf("if (ev.type === 'LUCK')")
  assert.ok(luckIdx >= 0, 'bloco LUCK deve existir')
  const slice = engineSrc.slice(luckIdx, luckIdx + 1200)
  assert.match(slice, /res\.action\s*!==\s*['"]APPLY_CARD['"]/)
  assert.match(slice, /<SorteRevesModal/)
})
