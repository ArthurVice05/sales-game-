/**
 * Espaçamento Resumo/Mais no chrome mobile-landscape.
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '../../../..')
const styles = readFileSync(join(root, 'src/styles.css'), 'utf8')
const boardCss = readFileSync(join(root, 'src/components/board/landscape-board.css'), 'utf8')

test('compactActionRow mobile-landscape usa gap 8px com seletor explícito', () => {
  assert.match(
    styles,
    /\.page\[data-hud-mode="mobile-landscape"\]\s+\.compactActionRow\s*\{[^}]*gap:\s*8px/,
  )
  // Não deixar só o gap:4px genérico como última palavra no bloco landscape <1200
  const short = styles.slice(styles.indexOf('/* Landscape abaixo do HUD desktop'))
  const scoped = short.match(
    /\.page\[data-(?:game-shell\]\[data-)?hud-mode="mobile-landscape"\][^{]*\.compactActionRow\s*\{[^}]*\}/,
  )
  assert.ok(scoped, 'seletor scoped do gap')
  assert.match(scoped[0], /gap:\s*8px/)
})

test('peão desktop usa clamp 30–36; mobile landscape baixo intacto', () => {
  assert.match(
    boardCss,
    /@media \(min-width: 1200px\)[\s\S]{0,400}width:\s*clamp\(30px,\s*3\.15cqi,\s*36px\)/,
  )
  assert.match(
    boardCss,
    /max-width: 960px\) and \(orientation: landscape\) and \(max-height: 450px\)[\s\S]{0,500}clamp\(11px,\s*min\(1\.65cqi,\s*3\.3cqh\),\s*13px\)/,
  )
})
