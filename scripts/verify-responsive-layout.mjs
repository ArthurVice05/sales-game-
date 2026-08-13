import { spawn } from 'node:child_process'
import { existsSync } from 'node:fs'
import { mkdir, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'

const APP_ORIGIN = 'http://127.0.0.1:5173'
const APP_URL = `${APP_ORIGIN}/`
const DEBUG_PORT = 9333
const ARTIFACT_DIR = resolve('artifacts/responsive-definitive')
const PROFILE_DIR = resolve('artifacts/chrome-responsive-profile')
const QA_PREFIX = `QA-LAYOUT-${Date.now().toString().slice(-8)}`

const BROWSER_CANDIDATES = [
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
  'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
]

function resolveBrowserPath() {
  if (process.env.CHROME_PATH) {
    if (!existsSync(process.env.CHROME_PATH)) {
      throw new Error(`CHROME_PATH aponta para um arquivo inexistente: ${process.env.CHROME_PATH}`)
    }
    return process.env.CHROME_PATH
  }
  const found = BROWSER_CANDIDATES.find((candidate) => existsSync(candidate))
  if (found) return found
  throw new Error(
    'Nenhum navegador baseado em Chromium encontrado.\nDefina CHROME_PATH ou instale um destes:\n'
    + BROWSER_CANDIDATES.map((candidate) => `  - ${candidate}`).join('\n'),
  )
}

const pause = (milliseconds) => new Promise((resolvePause) => {
  setTimeout(resolvePause, milliseconds)
})

async function retry(operation, timeout = 20_000, interval = 150) {
  const deadline = Date.now() + timeout
  let lastError
  while (Date.now() < deadline) {
    try {
      return await operation()
    } catch (error) {
      lastError = error
      await pause(interval)
    }
  }
  throw lastError || new Error('Operation timed out')
}

async function probeDevServer() {
  try {
    const response = await fetch(APP_URL, { signal: AbortSignal.timeout(1500) })
    return response.status === 200
  } catch {
    return false
  }
}

async function ensureDevServer() {
  if (await probeDevServer()) {
    console.log(`[qa] reaproveitando servidor ja ativo em ${APP_ORIGIN}`)
    return null
  }
  console.log('[qa] subindo "npm run dev"...')
  const child = spawn('npm', ['run', 'dev'], { shell: true, stdio: 'ignore', detached: false })
  await retry(async () => {
    if (!(await probeDevServer())) throw new Error(`Aguardando 200 em ${APP_URL}`)
    return true
  }, 60_000, 400)
  console.log(`[qa] servidor pronto em ${APP_ORIGIN}`)
  return child
}

function stopDevServer(child) {
  if (!child?.pid) return
  spawn('taskkill', ['/pid', String(child.pid), '/T', '/F'], { stdio: 'ignore' })
}

class CdpSession {
  constructor(webSocketUrl) {
    this.nextId = 1
    this.pending = new Map()
    this.events = []
    this.socket = new WebSocket(webSocketUrl)
  }

  async connect() {
    await new Promise((resolveOpen, rejectOpen) => {
      this.socket.addEventListener('open', resolveOpen, { once: true })
      this.socket.addEventListener('error', rejectOpen, { once: true })
      this.socket.addEventListener('message', (event) => {
        const message = JSON.parse(event.data)
        if (message.id) {
          const pending = this.pending.get(message.id)
          if (!pending) return
          this.pending.delete(message.id)
          if (message.error) pending.reject(new Error(message.error.message))
          else pending.resolve(message.result)
          return
        }
        this.events.push(message)
      })
    })
    await Promise.all([
      this.call('Page.enable'),
      this.call('Runtime.enable'),
      this.call('Log.enable'),
    ])
  }

  call(method, params = {}) {
    const id = this.nextId
    this.nextId += 1
    return new Promise((resolveCall, rejectCall) => {
      this.pending.set(id, { resolve: resolveCall, reject: rejectCall })
      this.socket.send(JSON.stringify({ id, method, params }))
    })
  }

  async evaluate(expression) {
    const result = await this.call('Runtime.evaluate', {
      expression,
      awaitPromise: true,
      returnByValue: true,
    })
    if (result.exceptionDetails) {
      throw new Error(result.exceptionDetails.exception?.description || 'Browser evaluation failed')
    }
    return result.result.value
  }

  close() {
    this.socket.close()
  }
}

const browserScript = (callback, ...args) => (
  `(${callback.toString()}).apply(null, ${JSON.stringify(args)})`
)

async function screenText(session) {
  return session.evaluate(`document.body?.innerText || '(sem body)'`).catch(() => '(inacessivel)')
}

// Cada passo do fluxo de entrada precisa dizer QUAL seletor faltou e o que estava na tela.
async function step(session, description, selector, action) {
  try {
    return await action()
  } catch (error) {
    const text = await screenText(session)
    throw new Error(
      `Fluxo de entrada falhou em: ${description}\n`
      + `  seletor esperado: ${selector}\n`
      + `  causa: ${error.message}\n`
      + `  innerText da tela:\n${String(text).slice(0, 1500)}`,
    )
  }
}

async function waitForSelector(session, selector, timeout = 20_000) {
  return retry(async () => {
    const found = await session.evaluate(browserScript((target) => !!document.querySelector(target), selector))
    if (!found) throw new Error(`Waiting for ${selector}`)
    return true
  }, timeout)
}

async function setInputValue(session, selector, value) {
  return session.evaluate(browserScript((target, nextValue) => {
    const input = document.querySelector(target)
    if (!input) throw new Error(`Input not found: ${target}`)
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set
    setter.call(input, nextValue)
    input.dispatchEvent(new Event('input', { bubbles: true }))
    input.dispatchEvent(new Event('change', { bubbles: true }))
    return input.value
  }, selector, value))
}

async function click(session, selector) {
  return session.evaluate(browserScript((target) => {
    const element = document.querySelector(target)
    if (!element) throw new Error(`Clickable element not found: ${target}`)
    element.click()
    return true
  }, selector))
}

async function clickButtonByText(session, text) {
  return session.evaluate(browserScript((label) => {
    const element = [...document.querySelectorAll('button')]
      .find((button) => button.textContent.replace(/\s+/g, ' ').trim().includes(label))
    if (!element) throw new Error(`Button not found: ${label}`)
    element.click()
    return true
  }, text))
}

async function setViewport(session, width, height) {
  await session.call('Emulation.setDeviceMetricsOverride', {
    width,
    height,
    deviceScaleFactor: 1,
    mobile: width < 768,
    screenWidth: width,
    screenHeight: height,
  })
  await pause(280)
}

async function measure(session, label) {
  return session.evaluate(browserScript((eventLabel) => {
    const board = document.querySelector('.sg40GameBoard')
    const stage = document.querySelector('.boardWrap')
    const sidebar = document.querySelector('.side')
    const sideContent = document.querySelector('.sideContent')
    if (!board || !stage || !sidebar || !sideContent) throw new Error('Game layout not mounted')
    const rect = (element) => {
      const bounds = element.getBoundingClientRect()
      return {
        left: bounds.left,
        top: bounds.top,
        right: bounds.right,
        bottom: bounds.bottom,
        width: bounds.width,
        height: bounds.height,
      }
    }
    const boardRect = rect(board)
    const sidebarRect = rect(sidebar)
    const cards = [...sideContent.querySelectorAll(
      '.controlsSticky, .hud, .game-stats-card, .score, .controls, .auxiliaryActions',
    )]
    const labels = [...board.querySelectorAll('.sg40Preview__tileLabel')]
    const html = document.documentElement
    const tokens = [...board.querySelectorAll('[data-player-position]')]
    const tokenRects = tokens.map((token) => rect(token))
    const secondary = document.querySelector('.topbarSecondary')
    return {
      label: eventLabel,
      viewport: [window.innerWidth, window.innerHeight],
      // scrollWidth - clientWidth fica negativo quando scrollbar-gutter reserva calha:
      // isso e ausencia de transbordo, nao transbordo. O delta cru fica registrado ao lado.
      documentOverflowX: Math.max(0, html.scrollWidth - html.clientWidth),
      documentScrollWidthDelta: html.scrollWidth - html.clientWidth,
      documentOverflowY: Math.max(0, html.scrollHeight - html.clientHeight),
      board: boardRect,
      boardRatio: boardRect.width / boardRect.height,
      stage: rect(stage),
      sidebar: {
        ...sidebarRect,
        clientWidth: sidebar.clientWidth,
        scrollWidth: sidebar.scrollWidth,
        clientHeight: sidebar.clientHeight,
        scrollHeight: sidebar.scrollHeight,
      },
      sideContent: {
        ...rect(sideContent),
        clientWidth: sideContent.clientWidth,
        scrollWidth: sideContent.scrollWidth,
        clientHeight: sideContent.clientHeight,
        scrollHeight: sideContent.scrollHeight,
      },
      gap: sidebarRect.left - boardRect.right,
      tileCount: board.querySelectorAll('[data-index]').length,
      labelCount: labels.length,
      tokenPositions: tokens.map((token) => token.getAttribute('data-player-position')),
      tokensInsideBoard: tokenRects.every((item) => (
        item.left >= boardRect.left - 1
        && item.right <= boardRect.right + 1
        && item.top >= boardRect.top - 1
        && item.bottom <= boardRect.bottom + 1
      )),
      visibleLabelCount: labels.filter((item) => getComputedStyle(item).display !== 'none').length,
      overflowingLabelCount: labels.filter((item) => (
        item.scrollWidth > item.clientWidth + 1 || item.scrollHeight > item.clientHeight + 1
      )).length,
      overflowingLabels: labels
        .filter((item) => item.scrollWidth > item.clientWidth + 1 || item.scrollHeight > item.clientHeight + 1)
        .map((item) => ({
          tile: item.closest('[data-index]')?.getAttribute('data-index') ?? null,
          text: item.textContent.trim(),
          axis: item.scrollWidth > item.clientWidth + 1 ? 'x' : 'y',
          scrollWidth: item.scrollWidth,
          clientWidth: item.clientWidth,
          scrollHeight: item.scrollHeight,
          clientHeight: item.clientHeight,
        })),
      cards: cards.map((card) => ({
        className: card.className,
        clientWidth: card.clientWidth,
        scrollWidth: card.scrollWidth,
        clientHeight: card.clientHeight,
        scrollHeight: card.scrollHeight,
      })),
      context: {
        playerName: document.querySelector('.topbarName')?.textContent.trim() || null,
        roundText: secondary?.textContent.match(/Rodada:\s*\d+\s*\/\s*\d+/)?.[0] || null,
        diceText: document.querySelector('.diceResult')?.textContent.replace(/\s+/g, ' ').trim() || null,
        boardNodeIsSame: window.__qaBoardNode ? window.__qaBoardNode === board : null,
        broadcastCount: window.__qaBroadcastCount ?? null,
      },
    }
  }, label))
}

async function capture(session, width, height) {
  await setViewport(session, width, height)
  const data = await session.call('Page.captureScreenshot', {
    format: 'png',
    captureBeyondViewport: false,
    fromSurface: true,
  })
  const filename = `${width}x${height}.png`
  await writeFile(resolve(ARTIFACT_DIR, filename), Buffer.from(data.data, 'base64'))
  return filename
}

async function enterGame(session) {
  await session.call('Page.navigate', { url: APP_URL })
  await waitForSelector(session, 'body')
  await session.evaluate(`localStorage.setItem('salesgame_tutorial_seen_v1', '1'); location.reload()`)

  await step(session, 'campo de nome do jogador', '#playerName', async () => {
    await waitForSelector(session, '#playerName')
    await setInputValue(session, '#playerName', `${QA_PREFIX}-P1`)
    await click(session, '.startBtn')
  })

  await step(session, 'abrir criacao de sala na lista de lobbies', '.lobbyActions .lobbyBtn--primary', async () => {
    await waitForSelector(session, '.lobbyPage', 25_000)
    await click(session, '.lobbyActions .lobbyBtn--primary')
  })

  await step(session, 'nomear e confirmar a sala de QA', '#lobby-name-input', async () => {
    await waitForSelector(session, '#lobby-name-input')
    await setInputValue(session, '#lobby-name-input', `${QA_PREFIX}-SALA`)
    await click(session, '.lobbyModalBody button[type="submit"]')
  })

  await step(session, 'marcar jogador como pronto', '.playerLobbyReadyBtn', async () => {
    await waitForSelector(session, '.playerLobbyReadyBtn', 25_000)
    await click(session, '.playerLobbyReadyBtn')
  })

  await step(session, 'iniciar a partida', '.playerLobbyStartBtn', async () => {
    await retry(async () => {
      const enabled = await session.evaluate(`!document.querySelector('.playerLobbyStartBtn')?.disabled`)
      if (!enabled) throw new Error('Botao iniciar continua desabilitado')
      return true
    }, 25_000)
    await click(session, '.playerLobbyStartBtn')
    await waitForSelector(session, '.sg40GameBoard', 30_000)
  })
}

async function leaveGame(session) {
  try {
    await clickButtonByText(session, 'Sair para Lobbies')
    await waitForSelector(session, '.lobbyPage', 15_000)
    console.log('[qa] saiu da sala de QA')
  } catch (error) {
    console.warn(`[qa] nao consegui sair da sala automaticamente: ${error.message}`)
  }
}

async function runStabilitySequence(session) {
  await setViewport(session, 1366, 768)
  const measurements = [await measure(session, 'idle')]
  for (const label of ['RECUPERAÇÃO FINANCEIRA', 'DECLARAR FALÊNCIA', 'Como jogar']) {
    try {
      await clickButtonByText(session, label)
      await waitForSelector(session, '.sg-modal-backdrop', 8_000)
    } catch (error) {
      measurements.push({ ...measurements[0], label: `${label}:indisponivel`, skipped: error.message })
      continue
    }
    measurements.push(await measure(session, `${label}:open`))
    await click(session, '.sg-modal-backdrop')
    await retry(async () => {
      const open = await session.evaluate(`!!document.querySelector('.sg-modal-backdrop')`)
      if (open) throw new Error('Waiting for modal close')
      return true
    })
    measurements.push(await measure(session, `${label}:closed`))
  }

  const canRoll = await session.evaluate(`!document.querySelector('.btn.go')?.disabled`)
  if (canRoll) {
    await click(session, '.btn.go')
    for (let step_ = 0; step_ < 12; step_ += 1) {
      await pause(220)
      measurements.push(await measure(session, `roll:${step_}`))
    }
  }
  return measurements
}

const inRange = (value, min, max) => Number.isFinite(value) && value >= min && value <= max

function evaluateCriteria(measurement) {
  const [width, height] = measurement.viewport
  const landscape = width > height
  const expectedRatio = !landscape && width < 600 ? 8 / 14 : 4 / 3
  const ratioDelta = Math.abs(measurement.boardRatio - expectedRatio)
  const checks = {}

  checks.boardRatio = {
    pass: ratioDelta <= 0.01,
    expected: `${expectedRatio.toFixed(4)} (+-0.01)`,
    measured: measurement.boardRatio.toFixed(4),
  }
  checks.documentOverflowX = {
    pass: measurement.documentOverflowX === 0,
    expected: '0',
    measured: String(measurement.documentOverflowX),
  }
  checks.tileCount = {
    pass: measurement.tileCount === 40,
    expected: '40',
    measured: String(measurement.tileCount),
  }
  checks.tokensInsideBoard = {
    pass: measurement.tokensInsideBoard === true,
    expected: 'true',
    measured: String(measurement.tokensInsideBoard),
  }

  if (landscape) {
    checks.viewportToBoard = {
      pass: inRange(measurement.board.left, 8, 16),
      expected: '8..16 px',
      measured: measurement.board.left.toFixed(2),
    }
    checks.boardToSidebar = {
      pass: inRange(measurement.gap, 8, 16),
      expected: '8..16 px',
      measured: measurement.gap.toFixed(2),
    }
    checks.sidebarNoScroll = {
      pass: measurement.sidebar.scrollHeight <= measurement.sidebar.clientHeight + 1,
      expected: `scrollHeight <= ${measurement.sidebar.clientHeight + 1}`,
      measured: String(measurement.sidebar.scrollHeight),
    }
    const overflowingCards = measurement.cards.filter((card) => card.scrollHeight > card.clientHeight + 1)
    checks.cardsNoScroll = {
      pass: overflowingCards.length === 0,
      expected: '0 cards com scroll',
      measured: overflowingCards.length
        ? overflowingCards.map((card) => `${card.className}(${card.scrollHeight}>${card.clientHeight})`).join(', ')
        : '0',
    }
  } else {
    checks.portraitLabelsVisible = {
      pass: measurement.visibleLabelCount === 40,
      expected: '40 rotulos visiveis',
      measured: String(measurement.visibleLabelCount),
    }
    checks.portraitLabelsNoOverflow = {
      pass: measurement.overflowingLabelCount === 0,
      expected: '0 rotulos transbordando',
      measured: String(measurement.overflowingLabelCount),
    }
  }

  const failures = Object.entries(checks)
    .filter(([, check]) => !check.pass)
    .map(([name, check]) => ({
      viewport: `${width}x${height}`,
      criterio: name,
      esperado: check.expected,
      medido: check.measured,
    }))

  return {
    viewport: `${width}x${height}`,
    orientation: landscape ? 'landscape' : 'portrait',
    board: `${measurement.board.width.toFixed(2)}x${measurement.board.height.toFixed(2)}`,
    pass: failures.length === 0,
    checks,
    failures,
  }
}

const browserPath = resolveBrowserPath()
console.log(`[qa] navegador: ${browserPath}`)

await mkdir(ARTIFACT_DIR, { recursive: true })
await mkdir(PROFILE_DIR, { recursive: true })

const devServer = await ensureDevServer()

const chrome = spawn(browserPath, [
  '--headless=new',
  `--remote-debugging-port=${DEBUG_PORT}`,
  `--user-data-dir=${PROFILE_DIR}`,
  '--disable-gpu',
  '--disable-extensions',
  '--no-first-run',
  '--no-default-browser-check',
  'about:blank',
], { stdio: 'ignore' })

let session
try {
  const browserInfo = await retry(async () => {
    const response = await fetch(`http://127.0.0.1:${DEBUG_PORT}/json/version`)
    if (!response.ok) throw new Error('Chrome debugging endpoint not ready')
    return response.json()
  })
  const targetResponse = await fetch(
    `http://127.0.0.1:${DEBUG_PORT}/json/new?${encodeURIComponent(APP_URL)}`,
    { method: 'PUT' },
  )
  const target = await targetResponse.json()
  session = new CdpSession(target.webSocketDebuggerUrl || browserInfo.webSocketDebuggerUrl)
  await session.connect()
  await setViewport(session, 1366, 768)
  await enterGame(session)

  // A varredura de viewports vem ANTES da sequencia dinamica: rolar o dado pode abrir um
  // modal de decisao obrigatoria, e as medidas/capturas devem retratar o tabuleiro em repouso.
  const viewports = [
    [360, 800], [390, 844], [394, 858], [430, 932], [600, 960], [768, 1024],
    [800, 360], [844, 390], [932, 430], [1024, 768], [1366, 768],
    [1440, 1080], [1920, 1080], [2560, 1080], [2560, 1440],
  ]
  const captures = new Set([
    '360x800', '394x858', '430x932', '844x390', '1024x768', '1366x768', '1440x1080', '1920x1080',
  ])
  const measurements = []
  const results = []
  for (const [width, height] of viewports) {
    await setViewport(session, width, height)
    const measurement = await measure(session, `${width}x${height}`)
    measurements.push(measurement)
    results.push(evaluateCriteria(measurement))
    if (captures.has(`${width}x${height}`)) await capture(session, width, height)
  }

  const stability = await runStabilitySequence(session)
  const baseline = stability[0].board
  const stabilityResult = stability.map((entry) => ({
    event: entry.label,
    widthDelta: Number((entry.board.width - baseline.width).toFixed(3)),
    heightDelta: Number((entry.board.height - baseline.height).toFixed(3)),
    ratio: entry.boardRatio,
    skipped: entry.skipped,
  }))
  const stabilityPass = stabilityResult.every((entry) => (
    Math.abs(entry.widthDelta) <= 1 && Math.abs(entry.heightDelta) <= 1
  ))

  // Rotacao: marca o no do tabuleiro e conta broadcasts para provar que girar nao remonta nem sincroniza.
  await setViewport(session, 390, 844)
  await session.evaluate(`
    window.__qaBoardNode = document.querySelector('.sg40GameBoard');
    window.__qaBroadcastCount = 0;
    if (!window.__qaBroadcastPatched) {
      window.__qaBroadcastPatched = true;
      const original = BroadcastChannel.prototype.postMessage;
      BroadcastChannel.prototype.postMessage = function (...args) {
        window.__qaBroadcastCount = (window.__qaBroadcastCount || 0) + 1;
        return original.apply(this, args);
      };
    }
    true
  `)
  const rotationBefore = await measure(session, 'rotation:portrait-before')
  await setViewport(session, 844, 390)
  const rotationLandscape = await measure(session, 'rotation:landscape')
  await setViewport(session, 390, 844)
  const rotationAfter = await measure(session, 'rotation:portrait-after')

  const rotationChecks = {
    samePlayer: {
      pass: rotationBefore.context.playerName === rotationAfter.context.playerName,
      expected: rotationBefore.context.playerName,
      measured: rotationAfter.context.playerName,
    },
    sameRound: {
      pass: rotationBefore.context.roundText === rotationAfter.context.roundText,
      expected: rotationBefore.context.roundText,
      measured: rotationAfter.context.roundText,
    },
    sameDice: {
      pass: rotationBefore.context.diceText === rotationAfter.context.diceText,
      expected: rotationBefore.context.diceText,
      measured: rotationAfter.context.diceText,
    },
    sameTokens: {
      pass: JSON.stringify(rotationBefore.tokenPositions) === JSON.stringify(rotationAfter.tokenPositions),
      expected: JSON.stringify(rotationBefore.tokenPositions),
      measured: JSON.stringify(rotationAfter.tokenPositions),
    },
    boardNotRemounted: {
      pass: rotationAfter.context.boardNodeIsSame === true,
      expected: 'true',
      measured: String(rotationAfter.context.boardNodeIsSame),
    },
    noBroadcastOnRotation: {
      pass: rotationAfter.context.broadcastCount === 0,
      expected: '0',
      measured: String(rotationAfter.context.broadcastCount),
    },
    portraitRectIdentical: {
      pass: Math.abs(rotationBefore.board.width - rotationAfter.board.width) <= 0.5
        && Math.abs(rotationBefore.board.height - rotationAfter.board.height) <= 0.5,
      expected: `${rotationBefore.board.width.toFixed(2)}x${rotationBefore.board.height.toFixed(2)}`,
      measured: `${rotationAfter.board.width.toFixed(2)}x${rotationAfter.board.height.toFixed(2)}`,
    },
  }

  await leaveGame(session)

  const allFailures = [
    ...results.flatMap((entry) => entry.failures),
    ...(stabilityPass ? [] : [{ viewport: '1366x768', criterio: 'sequenciaDinamica<=1px', esperado: '<=1px', medido: 'ver stability' }]),
    ...Object.entries(rotationChecks)
      .filter(([, check]) => !check.pass)
      .map(([name, check]) => ({ viewport: '390x844<->844x390', criterio: name, esperado: String(check.expected), medido: String(check.measured) })),
  ]

  const report = {
    generatedAt: new Date().toISOString(),
    qaPrefix: QA_PREFIX,
    browser: browserPath,
    overallPass: allFailures.length === 0,
    failures: allFailures,
    viewports: results,
    stability: { pass: stabilityPass, frames: stabilityResult },
    rotation: { pass: Object.values(rotationChecks).every((check) => check.pass), checks: rotationChecks },
    rawMeasurements: measurements,
    consoleErrors: session.events
      .filter((event) => event.method === 'Runtime.exceptionThrown')
      .map((event) => event.params),
  }
  await writeFile(resolve(ARTIFACT_DIR, 'report.json'), `${JSON.stringify(report, null, 2)}\n`)

  console.log('\n=== RESUMO POR VIEWPORT ===')
  for (const entry of results) {
    console.log(`${entry.pass ? 'OK  ' : 'FALHA'} ${entry.viewport.padEnd(10)} ${entry.orientation.padEnd(9)} board=${entry.board}`)
  }
  console.log(`\nsequencia dinamica (<=1px): ${stabilityPass ? 'OK' : 'FALHA'}`)
  console.log(`rotacao 390x844 -> 844x390 -> 390x844: ${report.rotation.pass ? 'OK' : 'FALHA'}`)
  if (allFailures.length) {
    console.log('\n=== CRITERIOS REPROVADOS ===')
    for (const failure of allFailures) {
      console.log(`  ${failure.viewport} | ${failure.criterio} | esperado ${failure.esperado} | medido ${failure.medido}`)
    }
    process.exitCode = 1
  } else {
    console.log('\nTodos os criterios passaram.')
  }
  console.log(`\nreport: ${resolve(ARTIFACT_DIR, 'report.json')}`)
} catch (error) {
  console.error(error.stack || error)
  if (session) console.error(await screenText(session))
  process.exitCode = 1
} finally {
  session?.close()
  chrome.kill()
  stopDevServer(devServer)
}
