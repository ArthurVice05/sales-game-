/**
 * Regressão dos três pedidos: Canal representantes, StartScreen sem Tironi,
 * e reserva do botão Rolar no sidebar desktop sob altura de notebook.
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { BOARD_40_TYPE_VISUALS, BOARD_40_CONFIG, BOARD_40_TYPES } from '../../data/board40Preview.js'

const root = join(dirname(fileURLToPath(import.meta.url)), '../../..')
const read = (rel) => readFileSync(join(root, rel), 'utf8')

test('apresentação FIELD usa Canal representantes; ids internos preservados', () => {
  assert.ok(BOARD_40_TYPES.includes('FIELD'))
  const fieldTile = BOARD_40_CONFIG.find((t) => t.type === 'FIELD')
  assert.equal(fieldTile.label, 'Canal representantes')
  assert.deepEqual([...BOARD_40_TYPE_VISUALS.FIELD.labelLines], ['CANAL', 'REPRESENTANTES'])
  assert.match(BOARD_40_TYPE_VISUALS.FIELD.icon, /field-sales\.png/)

  const preview = read('src/data/board40Preview.js')
  assert.doesNotMatch(preview, /FIELD SALES|Field Sales/)

  const modal = read('src/modals/BuyFieldSalesModal.jsx')
  assert.match(modal, /title="Canal representantes"/)
  assert.match(modal, /id: 'fieldsales'/)
  assert.match(modal, /Canal representantes Collab/)
  assert.doesNotMatch(modal, /title="Field Sales"|contratar Field Sales/)

  const engine = read('src/game/useTurnEngine.jsx')
  assert.match(engine, /contratar Canal representantes/)
  assert.match(engine, /BuyFieldSalesModal|FieldSalesModal|buildFieldSalesPurchaseDeltas/)
  assert.doesNotMatch(engine, /contratar Field Sales|Saldo insuficiente para contratar Field Sales/)
})

test('StartScreen não monta crédito Tironi', () => {
  const start = read('src/components/StartScreen.jsx')
  assert.doesNotMatch(start, /TironiCredit|tironitech|Desenvolvido por/i)
  assert.doesNotMatch(start, /startFooter/)
})

test('sidebar notebook: stack rolável + btn.go reservado', () => {
  const css = read('src/components/hud/desktop-hud.css')
  assert.match(css, /turnPrimaryActionsStack/)
  assert.match(css, /max-height:\s*820px/)
  assert.match(
    css,
    /\.content\s*>\s*\.side\s*>\s*\.hudConsultRegion[\s\S]{0,120}flex:\s*1\s+1\s+0%/,
  )
  assert.match(css, /\.turnPrimaryActions\s*>\s*\.controls[\s\S]*flex:\s*0\s+0\s+auto/)
  assert.match(css, /hudRoster--grid/)
  assert.match(css, /progressiveTipMore/)
  const lowIdx = css.indexOf('@media (min-width: 1024px) and (max-height: 820px)')
  assert.ok(lowIdx >= 0)
  const low = css.slice(lowIdx, lowIdx + 3200)
  assert.match(low, /\.turnPrimaryActions[\s\S]{0,220}overflow:\s*visible/)
  assert.match(low, /flex-grow:\s*0/)
  assert.match(low, /\.btn\.go[\s\S]{0,160}max-height:\s*none/)
  assert.doesNotMatch(low, /\.turnPrimaryActions\s*\{[^}]*overflow:\s*hidden/)

  const app = read('src/App.jsx')
  assert.match(app, /turnPrimaryActionsStack/)
  assert.match(app, /section="primary"/)
  assert.match(app, /Saiba mais/)
  assert.match(app, /progressiveTipMore/)

  const tips = read('src/game/progressiveTips.js')
  assert.match(tips, /TILE_TIP_SHORT/)
  assert.match(tips, /Sorte & Revés: confirme a carta/)
  assert.match(tips, /detail/)
})
