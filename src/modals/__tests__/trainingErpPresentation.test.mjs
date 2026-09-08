/**
 * Apresentação local de Treinamento e ERP + peões desktop.
 * Não altera motor, payloads, HUD nem tamanho mobile dos peões.
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, existsSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '../../..')
const training = readFileSync(join(root, 'src/modals/TrainingModal.jsx'), 'utf8')
const erp = readFileSync(join(root, 'src/modals/ERPSystemsModal.jsx'), 'utf8')
const boardCss = readFileSync(join(root, 'src/components/board/landscape-board.css'), 'utf8')
const cssPath = join(root, 'src/modals/training-erp-modals.css')

test('Treinamento e ERP usam CSS local sem !important genérico em massa', () => {
  assert.equal(existsSync(cssPath), true)
  const css = readFileSync(cssPath, 'utf8')
  assert.match(training, /training-erp-modals\.css/)
  assert.match(erp, /training-erp-modals\.css/)
  assert.match(css, /\.trainingVendorChip|\.trainingCertCard|\.erpLevelCard|\.erpCompare/)
  const importantCount = (css.match(/!important/g) || []).length
  assert.ok(importantCount <= 4, `!important excessivo: ${importantCount}`)
})

test('Treinamento organiza seções e mantém seleção real de certificações', () => {
  assert.match(training, /Profissionais|profissional/)
  assert.match(training, /Certificações disponíveis|trainingCert/)
  assert.match(training, /toggleTraining|selectedTrainings/)
  assert.match(training, /não contratam|nao contratam|não aumentam a capacidade/i)
  assert.match(training, /trainingVendorChip|label\}/)
  assert.doesNotMatch(training, /style=\{\{[\s\S]{0,40}\.\.\.S\.productCard/)
  assert.match(training, /Limpar Tudo/)
  assert.match(training, /Comprar \(/)
})

test('ERP remove título duplicado e diferencia níveis com classes', () => {
  assert.doesNotMatch(erp, /ERP \/ SISTEMAS/)
  assert.match(erp, /erpLevelCard|erpCompare/)
  assert.match(erp, /is-selected|is-owned|is-current/)
  assert.match(erp, /Upgrade cobra o preço cheio|preço cheio/)
  assert.match(erp, /disabled=\{!draftPayload\}/)
  assert.match(erp, /Confirmar compra/)
})

test('peões maiores só no breakpoint desktop min-width 1200px', () => {
  assert.match(boardCss, /@media \(min-width: 1200px\)[\s\S]{0,220}\.sg40GameBoard__token/)
  assert.match(boardCss, /@media \(min-width: 1200px\)[\s\S]{0,400}clamp\(26px,\s*2\.85cqi,\s*30px\)/)
  assert.match(boardCss, /max-width: 960px\) and \(orientation: landscape\) and \(max-height: 450px\)/)
  assert.match(boardCss, /width:\s*clamp\(11px,\s*min\(1\.65cqi,\s*3\.3cqh\),\s*13px\)/)
})
