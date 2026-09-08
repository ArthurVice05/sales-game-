/**
 * Apresentação mobile do tabuleiro v2-40 — etapa 4.
 * Fonte CSS/JSX apenas; não altera motor, dados nem HUD.
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '../../../..')
const boardCss = readFileSync(join(root, 'src/components/board/landscape-board.css'), 'utf8')
const styles = readFileSync(join(root, 'src/styles.css'), 'utf8')
const app = readFileSync(join(root, 'src/App.jsx'), 'utf8')
const pinch = readFileSync(join(root, 'src/hooks/useBoardPinchZoom.js'), 'utf8')

function extractBalanced(source, startToken) {
  const start = source.indexOf(startToken)
  if (start < 0) return ''
  const brace = source.indexOf('{', start)
  let depth = 0
  for (let i = brace; i < source.length; i += 1) {
    if (source[i] === '{') depth += 1
    else if (source[i] === '}') {
      depth -= 1
      if (depth === 0) return source.slice(start, i + 1)
    }
  }
  return ''
}

function firstRule(source, selector) {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const match = source.match(new RegExp(`${escaped}\\s*\\{[^}]+\\}`))
  return match ? match[0] : ''
}

test('consulta game-board aplica variáveis nos descendentes, não no próprio container', () => {
  const block = extractBalanced(boardCss, '@container game-board (max-width: 700px)')
  assert.ok(block.includes('@container game-board'))
  assert.doesNotMatch(block, /\.sg40GameBoard\s*\{\s*--sg40-icon-slot/)
  assert.doesNotMatch(block, /\.sg40GameBoard\s*\{\s*--sg40-well-molding/)
  assert.match(block, /\.sg40Preview__tile[\s\S]*--sg40-icon-slot/)
  assert.match(block, /::before[\s\S]*--sg40-well-molding/)
  assert.doesNotMatch(boardCss, /\.sg40GameBoard\s*\{[^}]*container-type:\s*size/)
})

test('logo mobile landscape reduz presença sem trocar o asset', () => {
  const landscape = extractBalanced(boardCss, '@media (max-width: 960px) and (orientation: landscape)')
  const logo = firstRule(landscape, '.sg40GameBoard .sg40Preview__boardImage')
  assert.match(logo, /max-width:\s*min\([^)]*?(1(?:1[0-9]|2[0-9]|3[0-9]|40))px/)
  assert.doesNotMatch(logo, /max-width:\s*min\([^)]*200px/)
  assert.doesNotMatch(logo, /filter:/)
})

test('explicação da casa no landscape usa 11–13px e cabe no miolo', () => {
  const landscape = extractBalanced(boardCss, '@media (max-width: 960px) and (orientation: landscape)')
  assert.match(landscape, /sg40GameBoard__hint[\s\S]{0,220}clamp\(11px,\s*[^,]+,\s*13px\)/)
  assert.match(landscape, /sg40GameBoard__hint[\s\S]{0,280}max-height/)
})

test('botão de expansão permanece fora do pinch e fora do percurso no landscape', () => {
  assert.match(app, /className="boardModeBtn"/)
  assert.match(app, /aria-label="Modo ampliado do tabuleiro"/)
  assert.match(app, /aria-pressed=\{boardView === 'follow'\}/)
  assert.match(app, /enterGamePresentation\(\)/)
  assert.match(app, /setBoardView\(v => \(v === 'follow' \? 'fit' : 'follow'\)\)/)
  assert.match(app, /Voltar ao modo normal/)
  assert.match(app, /Expandir tabuleiro/)

  const btnIdx = app.indexOf('className="boardModeBtn"')
  const boardIdx = app.indexOf('<Board')
  assert.ok(btnIdx > 0 && boardIdx > btnIdx)

  assert.match(pinch, /querySelector\('\.sg40GameBoard, \.board'\)/)

  const chip = extractBalanced(styles, '/* Chip sobre o board')
  assert.match(chip, /top:\s*calc\(\s*100%\s*\/\s*9/)
  assert.doesNotMatch(chip, /top:\s*6px/)
  assert.doesNotMatch(chip, /left:\s*8px/)
  assert.match(chip, /#0b1626|#071426|#050d1b/)
  assert.match(chip, /min-height:\s*(3[2-9]|[4-9]\d)px/)
})

test('peões em landscape baixo limitam face e halo pela altura da célula', () => {
  const short = extractBalanced(
    boardCss,
    '@media (max-width: 960px) and (orientation: landscape) and (max-height: 450px)',
  )
  assert.match(short, /sg40GameBoard__token[\s\S]{0,180}min\(/)
  assert.match(short, /sg40GameBoard__tokenFace[\s\S]{0,80}border-width:\s*1px/)
  assert.match(short, /token--active[\s\S]{0,80}scale:\s*1\.03/)
})

test('desktop alto prende Rolar Dado no fluxo; o HUD é que rola', () => {
  const tall = extractBalanced(styles, '@media (min-width: 1200px) and (min-height: 820px)')
  assert.ok(tall.includes('min-height: 820px'))
  const primary = extractBalanced(tall, '.page .content .side .turnPrimaryActions')
  assert.match(primary, /flex:\s*0 0 auto/)
  assert.doesNotMatch(primary, /flex:\s*1 1 135px/)
  assert.match(tall, /\.side > \.hud[\s\S]{0,180}overflow-y:\s*auto/)
})

test('mobile landscape organiza número/ícone no topo e mostra o nome completo', () => {
  const board = readFileSync(join(root, 'src/components/board/BoardTile.jsx'), 'utf8')
  assert.match(board, /--sg40-longest/)
  assert.match(board, /--sg40-chars/)
  assert.match(board, /labelLines\.map/)
  assert.doesNotMatch(boardCss, /line-clamp|text-overflow:\s*ellipsis/)

  const mobile = extractBalanced(
    boardCss,
    '/* Mobile landscape: nomes completos nas casas',
  )
  assert.ok(mobile.includes('nomes completos nas casas'), 'bloco de nomes mobile deve existir')
  assert.match(mobile, /max-width:\s*1199px/)
  assert.match(mobile, /orientation:\s*landscape/)
  assert.match(mobile, /container-type:\s*size/)
  assert.match(mobile, /display:\s*grid/)
  assert.match(mobile, /grid-template-rows/)
  assert.match(mobile, /sg40Preview__tileLabelLine/)
  assert.match(mobile, /white-space:\s*normal/)
  assert.match(mobile, /:has\(\.sg40Preview__tileLabelLine:nth-child\(2\)\)/)
  assert.match(mobile, /--sg40-longest/)
  assert.match(mobile, /100cqh/)
  assert.match(mobile, /word-break:\s*keep-all/)
  assert.match(mobile, /hyphens:\s*none/)
  assert.doesNotMatch(mobile, /line-clamp/)
  assert.match(mobile, /TRAINING/)
  assert.match(mobile, /EXPENSES/)
  assert.match(mobile, /padding-top:\s*1px/)
  assert.match(mobile, /clamp\(\s*5\.5px/)
  assert.match(mobile, /overflow:\s*visible/)
  assert.doesNotMatch(mobile, /tileLabel[\s\S]{0,280}overflow:\s*hidden/)
  assert.doesNotMatch(mobile, /font-size:\s*5px/)
})

test('mobile landscape preenche a largura do wrapper sem contain 13/9', () => {
  const shell = styles.slice(styles.indexOf('/* Landscape abaixo do HUD desktop'))
  assert.ok(shell.includes('Landscape abaixo do HUD desktop'), 'bloco data-game-shell deve existir')
  assert.match(shell, /max-width:\s*1199px/)
  assert.match(shell, /orientation:\s*landscape/)
  const board = extractBalanced(shell, '.page[data-game-shell] .content .boardWrap > .sg40GameBoard')
  assert.match(board, /width:\s*100%\s*!important/)
  assert.match(board, /height:\s*100%\s*!important/)
  assert.match(board, /aspect-ratio:\s*auto/)
  assert.doesNotMatch(board, /100cqh\s*\*\s*13\s*\/\s*9/)
  assert.doesNotMatch(board, /100vw/)
  assert.doesNotMatch(board, /transform:\s*scale/)

  const ios = extractBalanced(
    styles.slice(styles.indexOf('/* ====== iOS / WebKit ONLY')),
    '@supports (height: 1cqh)',
  )
  assert.match(ios, /html\.sg-ios/)
  assert.match(ios, /width:\s*100%\s*!important/)
  assert.match(ios, /height:\s*100%\s*!important/)
  assert.match(ios, /aspect-ratio:\s*auto/)
  assert.doesNotMatch(ios, /100cqh\s*\*\s*13\s*\/\s*9/)

  const landscape = extractBalanced(
    boardCss,
    '/* Mobile landscape: sempre layout 13×9',
  )
  assert.match(landscape, /sg40GameBoard__sizer/)
  assert.match(landscape, /aspect-ratio:\s*auto/)
  assert.match(landscape, /grid-template-columns:\s*repeat\(13/)
  assert.match(landscape, /grid-template-rows:\s*repeat\(9/)
})

test('moldura do miolo usa relevo direcional, não faixa cinza chapada', () => {
  const before = firstRule(boardCss, '.sg40GameBoard::before')
  assert.match(before, /145deg|135deg|160deg/)
  assert.doesNotMatch(before, /linear-gradient\(\s*180deg/)
  assert.doesNotMatch(before, /#121d2e/)
  assert.match(before, /#050d1b|#071426|#04080f|#050b14/)
  assert.match(before, /inset\s+-?\d+px\s+-?\d+px/)
})
