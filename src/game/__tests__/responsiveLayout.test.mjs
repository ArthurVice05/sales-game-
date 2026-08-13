import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import test from 'node:test'

import { parse } from '@babel/parser'
import postcss from 'postcss'

const here = dirname(fileURLToPath(import.meta.url))
const projectRoot = resolve(here, '../../..')

const VIEWPORTS = Object.freeze([
  [1920, 1080],
  [1440, 1080],
  [1366, 768],
  [1024, 768],
  [768, 1024],
  [600, 960],
  [932, 430],
  [844, 390],
  [800, 360],
  [430, 932],
  [394, 838],
  [394, 858],
  [390, 844],
  [360, 800],
  [2560, 1080],
  [2560, 1440],
])

const PORTRAIT_VIEWPORTS = VIEWPORTS.filter(([width, height]) => height > width)
const LANDSCAPE_VIEWPORTS = VIEWPORTS.filter(([width, height]) => width > height)

function jsxClassNames(source) {
  const ast = parse(source, { sourceType: 'module', plugins: ['jsx'] })
  const names = new Set()
  const visit = (node) => {
    if (!node || typeof node !== 'object') return
    if (node.type === 'JSXAttribute' && node.name?.name === 'className' && node.value?.type === 'StringLiteral') {
      node.value.value.split(/\s+/).filter(Boolean).forEach((name) => names.add(name))
    }
    for (const value of Object.values(node)) {
      if (Array.isArray(value)) value.forEach(visit)
      else if (value && typeof value === 'object') visit(value)
    }
  }
  visit(ast)
  return names
}

function importedNames(source, modulePath) {
  const ast = parse(source, { sourceType: 'module', plugins: ['jsx'] })
  const imported = new Set()
  for (const statement of ast.program.body) {
    if (statement.type !== 'ImportDeclaration' || statement.source.value !== modulePath) continue
    for (const specifier of statement.specifiers) {
      if (specifier.type === 'ImportSpecifier') imported.add(specifier.imported.name)
    }
  }
  return imported
}

function componentAttributeNames(source, componentName) {
  const ast = parse(source, { sourceType: 'module', plugins: ['jsx'] })
  const names = new Set()
  const visit = (node) => {
    if (!node || typeof node !== 'object') return
    if (node.type === 'JSXOpeningElement' && node.name?.type === 'JSXIdentifier' && node.name.name === componentName) {
      for (const attribute of node.attributes) {
        if (attribute.type === 'JSXAttribute') names.add(attribute.name.name)
      }
    }
    for (const value of Object.values(node)) {
      if (Array.isArray(value)) value.forEach(visit)
      else if (value && typeof value === 'object') visit(value)
    }
  }
  visit(ast)
  return names
}

function componentLocations(source, componentName) {
  const ast = parse(source, { sourceType: 'module', plugins: ['jsx'] })
  const locations = []
  const visit = (node) => {
    if (!node || typeof node !== 'object') return
    if (node.type === 'JSXOpeningElement' && node.name?.type === 'JSXIdentifier' && node.name.name === componentName) {
      locations.push(node.start)
    }
    for (const value of Object.values(node)) {
      if (Array.isArray(value)) value.forEach(visit)
      else if (value && typeof value === 'object') visit(value)
    }
  }
  visit(ast)
  return locations
}

function mediaMatches(params, viewport, coarsePointer = false) {
  const [width, height] = viewport
  const checks = String(params)
    .split(/\s+and\s+/i)
    .map((part) => part.trim().replace(/^\(|\)$/g, ''))

  return checks.every((check) => {
    let match = check.match(/^min-width:\s*(\d+)px$/i)
    if (match) return width >= Number(match[1])
    match = check.match(/^max-width:\s*(\d+)px$/i)
    if (match) return width <= Number(match[1])
    match = check.match(/^max-height:\s*(\d+)px$/i)
    if (match) return height <= Number(match[1])
    match = check.match(/^orientation:\s*(portrait|landscape)$/i)
    if (match) return match[1].toLowerCase() === (width > height ? 'landscape' : 'portrait')
    match = check.match(/^pointer:\s*coarse$/i)
    if (match) return coarsePointer
    return true
  })
}

function declarationsAt(root, selector, viewport, coarsePointer = false) {
  const declarations = {}
  root.walkRules((rule) => {
    if (!rule.selectors?.includes(selector)) return
    let parent = rule.parent
    while (parent && parent.type !== 'root') {
      if (parent.type === 'atrule' && parent.name === 'media' && !mediaMatches(parent.params, viewport, coarsePointer)) return
      parent = parent.parent
    }
    rule.walkDecls((decl) => { declarations[decl.prop] = decl.value })
  })
  return declarations
}

test('final winners exposes responsive dialog, podium, and primary-action hooks', async () => {
  const source = await readFile(resolve(projectRoot, 'src/components/FinalWinners.jsx'), 'utf8')
  const classes = jsxClassNames(source)
  assert.equal(classes.has('finalWinners'), true)
  assert.equal(classes.has('finalWinners__podium'), true)
  assert.equal(classes.has('finalWinners__primaryAction'), true)
})

test('game DOM renders one persistent board before the roll status and has no exclusive board controls', async () => {
  const source = await readFile(resolve(projectRoot, 'src/App.jsx'), 'utf8')
  const classes = jsxClassNames(source)
  const boardLocations = componentLocations(source, 'Board')
  const diceLocations = componentLocations(source, 'DiceResult')
  const attributes = componentAttributeNames(source, 'Board')

  assert.equal(boardLocations.length, 1, 'orientation changes must reuse one Board instance')
  assert.equal(diceLocations.length, 1, 'last roll must remain in the single information panel')
  assert.ok(boardLocations[0] < diceLocations[0], 'board must precede last roll in document order')
  assert.equal(classes.has('boardModeBtn'), false, 'exclusive board toggle must not render')
  assert.equal(attributes.has('layoutMode'), false, 'orientation must not be a React board mode')
})

test('board tiles expose both visual coordinates without duplicating the canonical tile map', async () => {
  const tileSource = await readFile(resolve(projectRoot, 'src/components/board/BoardTile.jsx'), 'utf8')
  const adapterSource = await readFile(resolve(projectRoot, 'src/components/board/boardVisualCoordinates.js'), 'utf8')

  assert.match(tileSource, /--desktop-row/)
  assert.match(tileSource, /--desktop-column/)
  assert.match(tileSource, /--mobile-row/)
  assert.match(tileSource, /--mobile-column/)
  assert.equal(adapterSource.includes('BOARD_40_CONFIG'), false)
  assert.equal(adapterSource.includes('eventKind'), false)
  assert.equal(adapterSource.includes('type:'), false)
})

test('production board is CSS-sized and token coordinates switch without viewport state', async () => {
  const source = await readFile(resolve(projectRoot, 'src/components/board/LandscapeBoard.jsx'), 'utf8')
  const imports = importedNames(source, './stableBoardLayout.js')

  assert.equal(imports.size, 0)
  assert.equal(source.includes('useStableBoardSize'), false)
  assert.equal(source.includes('useLayoutEffect'), false)
  assert.equal(source.includes('ResizeObserver'), false)
  assert.equal(source.includes('orientationchange'), false)
  assert.match(source, /--token-landscape-x/)
  assert.match(source, /--token-landscape-y/)
  assert.match(source, /--token-portrait-x/)
  assert.match(source, /--token-portrait-y/)
})

test('portrait keeps board and action panel in normal flow without artificial space', async () => {
  const css = await readFile(resolve(projectRoot, 'src/styles.css'), 'utf8')
  const root = postcss.parse(css)

  for (const viewport of PORTRAIT_VIEWPORTS) {
    const [width, height] = viewport
    const page = declarationsAt(root, '.page', viewport, true)
    const content = declarationsAt(root, '.content', viewport, true)
    const stage = declarationsAt(root, '.boardWrap', viewport, true)
    const board = declarationsAt(root, '.boardWrap .sg40GameBoard', viewport, true)
    const side = declarationsAt(root, '.side', viewport, true)

    assert.equal(page.height, 'auto', `${width}x${height}: portrait page must grow with content`)
    assert.equal(page.overflow, 'visible', `${width}x${height}: document owns vertical scrolling`)
    assert.equal(content.display, 'flex', `${width}x${height}: portrait uses normal flex flow`)
    assert.equal(content['flex-direction'], 'column', `${width}x${height}: board must stay above data`)
    assert.equal(content.overflow, 'visible', `${width}x${height}: content must not clip lower actions`)
    assert.equal(stage.display, 'block', `${width}x${height}: board stage must not vertically center its child`)
    assert.equal(stage.width, '100%', `${width}x${height}: board must use available portrait width`)
    assert.equal(stage.height, 'auto', `${width}x${height}: stage height must follow 4:3 board`)
    assert.equal(stage.flex, '0 0 auto', `${width}x${height}: data below must not resize the board`)
    assert.equal(stage.margin, '0', `${width}x${height}: no artificial space above board`)
    assert.equal(
      board['aspect-ratio'],
      width < 600 ? '8 / 14' : '4 / 3',
      `${width}x${height}: board must use the orientation-appropriate ratio`,
    )
    assert.equal(side.display, 'block', `${width}x${height}: actions and board must be simultaneous`)
    assert.equal(side.overflow, 'visible', `${width}x${height}: portrait must not create nested panel scroll`)
  }
})

test('narrow portrait uses the 8 by 14 track and keeps number icon label and tokens visible', async () => {
  const css = await readFile(resolve(projectRoot, 'src/components/board/landscape-board.css'), 'utf8')
  const root = postcss.parse(css)

  for (const viewport of [[360, 800], [390, 844], [394, 858], [430, 932]]) {
    const [width, height] = viewport
    const board = declarationsAt(root, '.sg40GameBoard', viewport, true)
    const track = declarationsAt(root, '.sg40GameBoard .sg40Preview__track', viewport, true)
    const tile = declarationsAt(root, '.sg40GameBoard .sg40Preview__tile', viewport, true)
    const label = declarationsAt(root, '.sg40GameBoard .sg40Preview__tileLabel', viewport, true)
    const number = declarationsAt(root, '.sg40GameBoard .sg40Preview__tileNumber', viewport, true)
    const icon = declarationsAt(root, '.sg40GameBoard .sg40Preview__tileIcon', viewport, true)
    const token = declarationsAt(root, '.sg40GameBoard__token', viewport, true)

    assert.equal(board['aspect-ratio'], '8 / 14', `${width}x${height}`)
    assert.equal(track['grid-template-columns'], 'repeat(8, minmax(0, 1fr))', `${width}x${height}`)
    assert.equal(track['grid-template-rows'], 'repeat(14, minmax(0, 1fr))', `${width}x${height}`)
    assert.equal(tile['grid-row'], 'var(--mobile-row)', `${width}x${height}`)
    assert.equal(tile['grid-column'], 'var(--mobile-column)', `${width}x${height}`)
    assert.notEqual(label.display, 'none', `${width}x${height}: canonical label must remain visible`)
    assert.notEqual(number.display, 'none', `${width}x${height}: tile number must remain visible`)
    assert.notEqual(icon.display, 'none', `${width}x${height}: category icon must remain visible`)
    assert.equal(token.left, 'var(--token-portrait-x)', `${width}x${height}`)
    assert.equal(token.top, 'var(--token-portrait-y)', `${width}x${height}`)
  }
})

test('legacy exclusive-mode selectors cannot hide the persistent mobile board or split its sidebar', async () => {
  const css = await readFile(resolve(projectRoot, 'src/styles.css'), 'utf8')
  const root = postcss.parse(css)

  for (const viewport of VIEWPORTS.filter(([width]) => width <= 960)) {
    const [width, height] = viewport
    const stage = declarationsAt(root, '.content:not(.content--boardFocus) .boardWrap', viewport, true)
    const side = declarationsAt(root, '.content:not(.content--boardFocus) .side', viewport, true)

    assert.notEqual(stage.display, 'none', `${width}x${height}: legacy selector must not hide Board`)
    assert.equal(side.display, 'block', `${width}x${height}: legacy selector must not create an empty sidebar column`)
  }
})

test('landscape and desktop keep a left-aligned board beside a non-scrolling expanding panel', async () => {
  const css = await readFile(resolve(projectRoot, 'src/styles.css'), 'utf8')
  const root = postcss.parse(css)

  for (const viewport of LANDSCAPE_VIEWPORTS) {
    const [width, height] = viewport
    const page = declarationsAt(root, '.page', viewport, true)
    const content = declarationsAt(root, '.content', viewport, true)
    const stage = declarationsAt(root, '.boardWrap', viewport, true)
    const side = declarationsAt(root, '.side', viewport, true)
    const sideContent = declarationsAt(root, '.sideContent', viewport, true)
    const hud = declarationsAt(root, '.side .hud', viewport, true)
    const controls = declarationsAt(root, '.side .controlsSticky', viewport, true)

    assert.equal(content.display, 'grid', `${width}x${height}: landscape shell must use two structural columns`)
    assert.match(content['grid-template-columns'] || '', /board-width[\s\S]*sidebar-min/, `${width}x${height}: board and panel must stay side by side`)
    assert.equal(content['align-items'], 'start', `${width}x${height}: board must align to the upper left`)
    assert.equal(content.padding, 'var(--layout-gap)', `${width}x${height}: left margin must use the canonical gap`)
    assert.equal(content.gap, 'var(--layout-gap)', `${width}x${height}: panel gap must use the canonical gap`)
    assert.match(page['--layout-gap'] || '', /clamp\(8px,.*(?:12|16)px\)/, `${width}x${height}: canonical gap must stay between 8px and 16px`)
    assert.match(page['--board-width'] || '', /usable-height[\s\S]*100vw[\s\S]*sidebar-min/, `${width}x${height}: board must be capped by height and remaining width`)
    assert.notEqual(stage['justify-content'], 'center', `${width}x${height}: no ancestor may recenter the board`)
    assert.equal(stage.margin, '0', `${width}x${height}: stage must start at the content edge`)
    assert.equal(stage.width, '100%', `${width}x${height}: stage must fill its real grid column`)
    assert.equal(stage.height, 'auto', `${width}x${height}: real width and ratio must define height`)
    assert.equal(stage['aspect-ratio'], 'var(--board-ratio)', `${width}x${height}: board stage must preserve the canonical ratio`)
    assert.equal(side.width, '100%', `${width}x${height}: panel must fill all remaining width`)
    assert.equal(side['max-width'], 'none', `${width}x${height}: panel must not be capped at 320px`)
    assert.equal(side.overflow, 'visible', `${width}x${height}: panel must not own a scrollbar`)
    assert.equal(sideContent.overflow, 'visible', `${width}x${height}: panel content must not own a scrollbar`)
    assert.equal(hud.overflow, 'visible', `${width}x${height}: HUD must be compact rather than scrollable`)
    assert.equal(controls.overflow, 'visible', `${width}x${height}: actions must be fully visible`)
  }
})

test('all financial, team, score and auxiliary information remains rendered', async () => {
  const app = await readFile(resolve(projectRoot, 'src/App.jsx'), 'utf8')
  const hud = await readFile(resolve(projectRoot, 'src/components/HUD.jsx'), 'utf8')
  const appClasses = jsxClassNames(app)
  const hudClasses = jsxClassNames(hud)

  assert.equal(appClasses.has('sideContent'), true)
  assert.equal(appClasses.has('auxiliaryActions'), true)
  assert.equal(hudClasses.has('hudDetailsToggle'), false, 'financial details must not depend on an accordion')
  assert.equal(hudClasses.has('game-stats-list'), true)
  assert.equal(hudClasses.has('game-stat-row'), true)
  assert.equal(hudClasses.has('game-stats-card'), true)
  assert.equal(hudClasses.has('score'), true)
})

test('HUD renders semantic term and value rows from the visual stats adapter', async () => {
  const source = await readFile(resolve(projectRoot, 'src/components/HUD.jsx'), 'utf8')
  const ast = parse(source, { sourceType: 'module', plugins: ['jsx'] })
  const elements = []
  const visit = (node) => {
    if (!node || typeof node !== 'object') return
    if (node.type === 'JSXOpeningElement' && node.name?.type === 'JSXIdentifier') {
      elements.push(node.name.name)
    }
    for (const value of Object.values(node)) {
      if (Array.isArray(value)) value.forEach(visit)
      else if (value && typeof value === 'object') visit(value)
    }
  }
  visit(ast)

  assert.ok(elements.includes('dl'))
  assert.ok(elements.includes('dt'))
  assert.ok(elements.includes('dd'))
  assert.match(source, /buildGameStatSections\(totals\)/)
})

test('final modal CSS bounds both axes and lets every podium column shrink', async () => {
  const css = await readFile(resolve(projectRoot, 'src/components/final-winners.css'), 'utf8').catch(() => '')
  const root = postcss.parse(css)
  const viewport = [390, 844]
  const modal = declarationsAt(root, '.finalWinners', viewport, true)
  const podium = declarationsAt(root, '.finalWinners__podium', viewport, true)
  const card = declarationsAt(root, '.finalWinners__playerCard', viewport, true)

  assert.equal(modal['box-sizing'], 'border-box')
  assert.equal(modal['min-width'], '0')
  assert.equal(modal['max-width'], '100%')
  assert.equal(modal['overflow-x'], 'clip')
  assert.match(modal['max-height'] || '', /100dvh/)
  assert.equal(podium['grid-template-columns'], 'repeat(3, minmax(0, 1fr))')
  assert.equal(card['min-width'], '0')
  assert.match(card['overflow-wrap'] || '', /break-word|anywhere/)
})

test('production board relies on the native CSS sizing contract without an inline pixel policy', async () => {
  const source = await readFile(resolve(projectRoot, 'src/components/board/LandscapeBoard.jsx'), 'utf8')
  const imports = importedNames(source, './stableBoardLayout.js')
  assert.equal(imports.size, 0)
  assert.equal(source.includes('stableSize'), false)
  assert.equal(source.includes('maxWidth:'), false)
})

test('game shell keeps a stable header while portrait content follows it immediately', async () => {
  const css = await readFile(resolve(projectRoot, 'src/styles.css'), 'utf8')
  const root = postcss.parse(css)

  for (const viewport of VIEWPORTS) {
    const [width, height] = viewport
    const page = declarationsAt(root, '.page', viewport, width <= 960)
    const topbar = declarationsAt(root, '.page > .topbar', viewport, width <= 960)
    assert.equal(topbar.height, 'var(--game-header-height)', `${width}x${height}`)
    assert.equal(topbar['min-height'], 'var(--game-header-height)', `${width}x${height}`)
    assert.equal(topbar['max-height'], 'var(--game-header-height)', `${width}x${height}`)
    if (height > width) {
      assert.equal(page.display, 'flex', `${width}x${height}: portrait shell must use document flow`)
      assert.equal(page['flex-direction'], 'column', `${width}x${height}: header must be immediately followed by board content`)
    } else {
      assert.match(page['grid-template-rows'] || '', /var\(--game-header-height\) minmax\(0, 1fr\)/, `${width}x${height}`)
    }
  }
})

test('orientation is CSS-only and does not pass a mode signal that can remount or mutate the board', async () => {
  const source = await readFile(resolve(projectRoot, 'src/App.jsx'), 'utf8')
  const attributes = componentAttributeNames(source, 'Board')
  const boardLocations = componentLocations(source, 'Board')
  assert.equal(attributes.has('layoutMode'), false)
  assert.equal(boardLocations.length, 1)
  assert.equal(source.includes('orientationchange'), false)
})
