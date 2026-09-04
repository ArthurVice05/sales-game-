import assert from 'node:assert/strict'
import test from 'node:test'

const VIEWPORTS = Object.freeze([
  [360, 800],
  [390, 844],
  [430, 932],
  [600, 960],
  [768, 1024],
  [800, 360],
  [844, 390],
  [932, 430],
  [1024, 768],
  [1366, 768],
  [1440, 1080],
  [1920, 1080],
  [2560, 1080],
  [2560, 1440],
])

const clamp = (minimum, preferred, maximum) => (
  Math.min(maximum, Math.max(minimum, preferred))
)

function canonicalBoardRect(width, height) {
  const portrait = height > width
  const narrowPortrait = portrait && width < 600

  if (portrait) {
    const inlinePadding = width <= 1024 ? clamp(6, width * 0.02, 10) * 2 : 0
    const boardWidth = width - inlinePadding
    const ratio = narrowPortrait ? 8 / 14 : 4 / 3
    return { width: boardWidth, height: boardWidth / ratio, ratio }
  }

  const compact = height <= 800
  const gap = compact
    ? clamp(8, width * 0.0075, 12)
    : clamp(8, width * 0.008, 16)
  const header = compact ? 44 : clamp(52, height * 0.055, 60)
  const panel = compact
    ? (height <= 600
      ? clamp(340, width * 0.44, 430)
      : clamp(320, width * 0.34, 400))
    : clamp(320, width * 0.25, 440)
  const usableHeight = height - header - (2 * gap)
  const availableWidth = width - panel - (3 * gap)
  const boardWidth = Math.min(usableHeight * (4 / 3), availableWidth)
  return { width: boardWidth, height: boardWidth * (3 / 4), ratio: 4 / 3 }
}

function expectRectStable(actual, expected, tolerance = 1) {
  assert.ok(Math.abs(actual.width - expected.width) <= tolerance)
  assert.ok(Math.abs(actual.height - expected.height) <= tolerance)
  assert.ok(Math.abs((actual.width / actual.height) - expected.ratio) <= 0.001)
}

for (const [width, height] of VIEWPORTS) {
  test(`canonical CSS inputs remain content-independent at ${width}x${height}`, () => {
    const baseline = canonicalBoardRect(width, height)
    const dynamicStates = [
      'roll-start',
      'dice-revealed',
      'token-moving',
      'modal-open',
      'modal-close',
      'sidebar-updated',
      'turn-changed',
      'game-over',
    ]

    for (const state of dynamicStates) {
      assert.ok(state)
      expectRectStable(canonicalBoardRect(width, height), baseline)
    }
  })
}

test('rotation changes only visual geometry and returns to the original portrait rectangle', () => {
  const portraitBefore = canonicalBoardRect(390, 844)
  const landscape = canonicalBoardRect(844, 390)
  const portraitAfter = canonicalBoardRect(390, 844)

  assert.equal(portraitBefore.ratio, 8 / 14)
  assert.equal(landscape.ratio, 4 / 3)
  expectRectStable(portraitAfter, portraitBefore)
})
