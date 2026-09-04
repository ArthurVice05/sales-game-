const DEFAULT_SELECTORS = Object.freeze({
  board: '.sg40GameBoard',
  stage: '.boardWrap',
  sidebar: '.side',
  header: '.topbar',
  sidebarCards: '.sideContent, .controlsSticky, .hud, .hud .panel, .hud .score, .controls, .auxiliaryActions',
})

const rectOf = (element) => element?.getBoundingClientRect() || null
const expectedBoardRatio = () => (
  window.matchMedia('(orientation: portrait) and (max-width: 599px)').matches
    ? 8 / 14
    : 4 / 3
)

export function startBoardStabilityProbe(selectors = DEFAULT_SELECTORS) {
  const board = document.querySelector(selectors.board)
  if (!board) throw new Error(`Board not found: ${selectors.board}`)

  const measurements = []
  const sample = (event) => {
    const stage = document.querySelector(selectors.stage)
    const sidebar = document.querySelector(selectors.sidebar)
    const header = document.querySelector(selectors.header)
    const boardRect = rectOf(board)
    const stageRect = rectOf(stage)
    const sidebarRect = rectOf(sidebar)
    const headerRect = rectOf(header)
    const sidebarCards = [...document.querySelectorAll(selectors.sidebarCards)]
    const bodyStyle = getComputedStyle(document.body)
    const documentStyle = getComputedStyle(document.documentElement)

    const measurement = {
      event,
      timestamp: performance.now(),
      viewport: {
        innerWidth: window.innerWidth,
        innerHeight: window.innerHeight,
        clientWidth: document.documentElement.clientWidth,
        clientHeight: document.documentElement.clientHeight,
      },
      board: {
        width: boardRect.width,
        height: boardRect.height,
        top: boardRect.top,
        left: boardRect.left,
      },
      stage: {
        width: stageRect?.width ?? 0,
        height: stageRect?.height ?? 0,
      },
      sidebar: sidebarRect ? {
        width: sidebarRect.width,
        height: sidebarRect.height,
        scrollHeight: sidebar.scrollHeight,
        scrollWidth: sidebar.scrollWidth,
      } : null,
      sidebarCards: sidebarCards.map((card) => ({
        className: card.className,
        clientWidth: card.clientWidth,
        scrollWidth: card.scrollWidth,
        clientHeight: card.clientHeight,
        scrollHeight: card.scrollHeight,
      })),
      headerHeight: headerRect?.height ?? 0,
      bodyOverflow: bodyStyle.overflow,
      bodyOverflowY: bodyStyle.overflowY,
      documentOverflowY: documentStyle.overflowY,
      scrollbarWidth: window.innerWidth - document.documentElement.clientWidth,
      documentOverflowX:
        document.documentElement.scrollWidth - document.documentElement.clientWidth,
      tileCount: board.querySelectorAll('[data-index]').length,
      tokenCount: board.querySelectorAll('[data-player-position]').length,
    }
    measurements.push(measurement)
    console.log('[BOARD_STABILITY_PROBE]', measurement)
    return measurement
  }

  const observer = new ResizeObserver(() => sample('resize-observer'))
  observer.observe(board)
  const baseline = sample('idle')

  return Object.freeze({
    baseline,
    measurements,
    mark: sample,
    report(tolerance = 1) {
      return measurements.map((measurement) => ({
        event: measurement.event,
        width: measurement.board.width,
        height: measurement.board.height,
        widthDelta: measurement.board.width - baseline.board.width,
        heightDelta: measurement.board.height - baseline.board.height,
        stable:
          Math.abs(measurement.board.width - baseline.board.width) <= tolerance
          && Math.abs(measurement.board.height - baseline.board.height) <= tolerance,
        boardRatio: measurement.board.width / measurement.board.height,
        expectedBoardRatio: expectedBoardRatio(),
        ratioValid:
          Math.abs(
            (measurement.board.width / measurement.board.height) - expectedBoardRatio()
          ) <= 0.001,
        tileCount: measurement.tileCount,
        tokenCount: measurement.tokenCount,
        documentOverflowX: measurement.documentOverflowX,
        sidebarFits: !measurement.sidebar || (
          measurement.sidebar.scrollHeight <= measurement.sidebar.height + tolerance
          && measurement.sidebar.scrollWidth <= measurement.sidebar.width + tolerance
        ),
        cardsFit: measurement.sidebarCards.every((card) => (
          card.scrollHeight <= card.clientHeight + tolerance
          && card.scrollWidth <= card.clientWidth + tolerance
        )),
      }))
    },
    stop() {
      observer.disconnect()
    },
  })
}
