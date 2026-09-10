import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '../../..')
const credit = readFileSync(join(root, 'src/components/TironiCredit.jsx'), 'utf8')
const start = readFileSync(join(root, 'src/components/StartScreen.jsx'), 'utf8')
const app = readFileSync(join(root, 'src/App.jsx'), 'utf8')
const lobby = readFileSync(join(root, 'src/pages/LobbyList.jsx'), 'utf8')

test('crédito Tironi Tech não aparece na tela de entrada', () => {
  // Componente pode existir no projeto, mas não deve ser montado na StartScreen
  assert.match(credit, /Tironi Tech/)
  assert.doesNotMatch(start, /TironiCredit/)
  assert.doesNotMatch(start, /tironiCredit|tironitech\.com|Desenvolvido por/i)
  assert.doesNotMatch(start, /startFooter|startBrand/)
  assert.doesNotMatch(app, /TironiCredit/)
  assert.doesNotMatch(lobby, /TironiCredit/)
  assert.match(app, /shouldAutoOpenTutorial/)
  const modal = readFileSync(join(root, 'src/components/TutorialModal.jsx'), 'utf8')
  assert.match(modal, /markTutorialSessionShown|markTutorialSeen/)
})
