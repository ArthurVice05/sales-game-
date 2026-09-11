/**
 * Empilhamento de modais: camadas inferiores permanecem montadas (estado preservado).
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '../../..')
const ctx = readFileSync(join(root, 'src/modals/ModalContext.jsx'), 'utf8')

test('ModalContext mantém camadas inferiores montadas sob o topo', () => {
  // Não pode renderizar apenas stack[length-1] — isso desmonta a decisão e perde qty/seleção.
  assert.doesNotMatch(
    ctx,
    /stack\[stack\.length\s*-\s*1\]\?\.el/,
    'renderizar só o topo desmonta a decisão sob InsufficientFunds',
  )
  assert.match(ctx, /stack\.map/, 'deve mapear toda a pilha')
  assert.match(ctx, /\binert\b|aria-hidden/, 'camadas inferiores ficam inertes/ocultas')
})
