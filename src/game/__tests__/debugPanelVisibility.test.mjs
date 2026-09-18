import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

test('o jogo não exibe o botão ou painel de Debug', () => {
  const root = join(dirname(fileURLToPath(import.meta.url)), '../../..')
  const app = readFileSync(join(root, 'src/App.jsx'), 'utf8')

  assert.doesNotMatch(app, /import DebugPanel/)
  assert.doesNotMatch(app, /<DebugPanel\b/)
})
