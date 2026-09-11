/**
 * Regressão: handoff prematuro em ~00:30 / watchdog 30s.
 * Executar: node --test src/game/__tests__/turnEarlyHandoff.test.mjs
 */
import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import {
  computeTurnDeadlineAt,
  remainingTurnMs,
  shouldAttemptTimerAutoPass,
  sanitizeTurnDeadlineOnHandoff,
} from '../turnTimerLogic.js'
import { TURN_TIME_PRESETS } from '../turnTimeConfig.js'
import {
  decideTurnLockWatchdog,
  decideTickForceUnlock,
  canSafelyHandoffTurn,
} from '../turnLockSafety.js'

const here = dirname(fileURLToPath(import.meta.url))
const engineSrc = readFileSync(join(here, '..', 'useTurnEngine.jsx'), 'utf8')

function baseAutoPass(overrides = {}) {
  return {
    now: 1_000_000,
    turnDeadlineAt: 1_000_000,
    turnLock: false,
    gameOver: false,
    amCoordinator: true,
    turnPlayerId: 'a',
    turnSeq: 1,
    lastAttemptKey: null,
    inFlight: false,
    ...overrides,
  }
}

describe('A/B — remaining > 0 nunca AUTO_PASS_TIMER', () => {
  const cases = [
    ['30s', 30_000],
    ['1ms', 1],
    ['10s', 10_000],
    ['20s', 20_000],
    ['59s', 59_000],
  ]
  for (const [label, rem] of cases) {
    it(`turnTimeSec=60 remaining=${label} → not-expired`, () => {
      const now = 2_000_000
      const deadline = now + rem
      const d = shouldAttemptTimerAutoPass(
        baseAutoPass({ now, turnDeadlineAt: deadline }),
      )
      assert.equal(d.ok, false)
      assert.equal(d.reason, 'not-expired')
      assert.equal(remainingTurnMs(deadline, now), rem)
    })
  }
})

describe('C — zero real permite uma tentativa', () => {
  it('remaining=0 turnLock=false → ok', () => {
    const now = 2_000_000
    const d = shouldAttemptTimerAutoPass(
      baseAutoPass({ now, turnDeadlineAt: now }),
    )
    assert.equal(d.ok, true)
    assert.equal(d.reason, 'expired')
  })
})

describe('D — zero durante ação ativa', () => {
  it('remaining=0 turnLock=true → não passa', () => {
    const now = 2_000_000
    const d = shouldAttemptTimerAutoPass(
      baseAutoPass({ now, turnDeadlineAt: now, turnLock: true }),
    )
    assert.equal(d.ok, false)
    assert.match(String(d.reason), /turn-locked/)
  })
})

describe('E — watchdog 30s durante jogada ativa', () => {
  it('events/pending ativos → NÃO forceUnlock', () => {
    const d = decideTurnLockWatchdog({
      turnLock: true,
      isLockOwner: true,
      modalLocks: 0,
      opening: false,
      eventsInProgress: true,
      turnChangeInProgress: true,
      hasPendingTurnData: true,
    })
    assert.equal(d.forceUnlock, false)
    assert.equal(d.reason, 'pipeline-active')
  })

  it('elapsed simbólico 30s com remaining 30s não autoriza AUTO_PASS', () => {
    const turnTimeSec = 60
    const now = 1_000_000
    const started = now - 30_000
    const deadline = computeTurnDeadlineAt(started, turnTimeSec)
    assert.equal(remainingTurnMs(deadline, now), 30_000)
    const d = shouldAttemptTimerAutoPass(
      baseAutoPass({ now, turnDeadlineAt: deadline }),
    )
    assert.equal(d.ok, false)
    assert.equal(d.reason, 'not-expired')
  })
})

describe('F — conclusão normal antes do zero (deadline autoritativo via TURN)', () => {
  it('App.jsx gera deadline novo no TURN; sanitize não é a autoridade do handoff', () => {
    const app = readFileSync(join(here, '..', '..', 'App.jsx'), 'utf8')
    const fnStart = app.indexOf('function broadcastState')
    assert.ok(fnStart >= 0)
    const body = app.slice(fnStart, fnStart + 12000)
    assert.match(body, /turnIdentityChanged/)
    assert.match(body, /computeTurnDeadlineAt/)
    assert.match(body, /patchKind === 'TURN'|kind === 'TURN'|TURN/)

    // sanitize: handoff com remaining saudável (>=20s) preserva deadline atual (semântica anterior)
    const now = 900_000
    const prevDeadline = now + 40_000
    const sanitized = sanitizeTurnDeadlineOnHandoff({
      prevTurnPlayerId: 'a',
      nextTurnPlayerId: 'b',
      prevTurnSeq: 1,
      nextTurnSeq: 2,
      currentDeadlineAt: prevDeadline,
      now,
      turnTimeSec: 60,
    })
    assert.equal(sanitized, prevDeadline)

    // Autoridade do novo turno: App recalcula no emissor TURN
    const authoritative = computeTurnDeadlineAt(now, 60)
    assert.equal(authoritative, now + 60_000)
  })
})

describe('G — presets sem significado especial em 30s', () => {
  for (const sec of TURN_TIME_PRESETS) {
    it(`${sec}s: remaining=30s não auto-passa`, () => {
      const now = 3_000_000
      const deadline = now + 30_000
      const d = shouldAttemptTimerAutoPass(
        baseAutoPass({ now, turnDeadlineAt: deadline }),
      )
      assert.equal(d.ok, false)
      assert.equal(d.reason, 'not-expired')
    })
  }
})

describe('H — canRoll / handoff seguro', () => {
  it('B só após pipeline idle', () => {
    assert.equal(
      canSafelyHandoffTurn({
        modalLocks: 0,
        opening: false,
        eventsInProgress: true,
      }),
      false,
    )
    assert.equal(
      canSafelyHandoffTurn({
        modalLocks: 0,
        opening: false,
        eventsInProgress: false,
      }),
      true,
    )
  })
})

describe('tick force unlock', () => {
  it('não apaga locks com pipeline ativa', () => {
    const d = decideTickForceUnlock({
      tickAttempts: 999,
      maxTickAttempts: 200,
      modalLocks: 1,
      opening: false,
      eventsInProgress: true,
      hasPendingTurnData: true,
    })
    assert.equal(d.forceUnlock, false)
    assert.equal(d.clearLocks, false)
    assert.equal(d.continueWaiting, true)
  })
})

describe('wiring useTurnEngine', () => {
  it('não possui watchdog fixo de 30000ms', () => {
    assert.doesNotMatch(engineSrc, /\}, 30000\)\s*\/\/ 30 segundos/)
    assert.doesNotMatch(engineSrc, /TIMEOUT DE SEGURANÇA - turnLock ativo há mais de 30s/)
    assert.match(engineSrc, /decideTurnLockWatchdog/)
    assert.match(engineSrc, /canSafelyHandoffTurn/)
    assert.match(engineSrc, /120000/)
  })
})
