/**
 * Regressão: Rolar não pode ser recortado quando dica + hint + quick actions
 * competem com a aba Empresa no sidebar desktop.
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '../../../..')
const css = readFileSync(join(root, 'src/components/hud/desktop-hud.css'), 'utf8')
const app = readFileSync(join(root, 'src/App.jsx'), 'utf8')

test('dica e hint ficam na stack; Rolar fica fora dela', () => {
  const stackOpen = app.indexOf('className="turnPrimaryActionsStack"')
  const tip = app.indexOf('className="progressiveTip"', stackOpen)
  const hint = app.indexOf('nextStepHint', stackOpen)
  const primary = app.indexOf('section="primary"', stackOpen)
  assert.ok(stackOpen > 0)
  assert.ok(tip > stackOpen)
  assert.ok(hint > stackOpen)
  assert.ok(primary > tip && primary > hint)
  const stackRegion = app.slice(stackOpen, primary)
  assert.match(stackRegion, /progressiveTip/)
  assert.match(stackRegion, /nextStepHint/)
  assert.match(stackRegion, /sideQuickActions/)
})

test('hudConsultRegion é o flex shrink do aside; turnPrimaryActions não clipa', () => {
  assert.match(
    css,
    /\.content\s*>\s*\.side\s*>\s*\.hudConsultRegion\s*\{[^}]*flex:\s*1\s+1\s+0%/,
  )
  assert.match(
    css,
    /\.content\s*>\s*\.side\s*>\s*\.hudConsultRegion\s*\{[^}]*min-height:\s*0/,
  )
  const lowIdx = css.indexOf('@media (min-width: 1024px) and (max-height: 820px)')
  assert.ok(lowIdx >= 0)
  const low = css.slice(lowIdx, lowIdx + 3200)
  assert.match(low, /hudConsultRegion/)
  assert.match(low, /\.turnPrimaryActions[\s\S]{0,220}overflow:\s*visible/)
  assert.match(low, /flex-grow:\s*0/)
  assert.match(low, /\.btn\.go[\s\S]{0,160}max-height:\s*none/)
  assert.match(low, /\.turnPrimaryActionsStack\s*\{/)
  assert.doesNotMatch(low, /\.turnPrimaryActions\s*\{[^}]*overflow:\s*hidden/)
})
