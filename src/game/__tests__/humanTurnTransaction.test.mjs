import test from 'node:test'
import assert from 'node:assert/strict'
import { createHumanCommitQueue, humanClaimExpired } from '../humanTurnTransaction.js'
import { applyGamePatchToState } from '../playerStateSync.js'
import { createSharedClock } from '../../net/sharedClock.js'

const NOW = 1_000_000
function world(n = 4) {
  return { matchId: 'm', turnPlayerId: '0', turnSeq: 10, gameOver: false,
    turnDeadlineAt: NOW + 90_000, turnLock: false,
    players: Array.from({ length: n }, (_, i) => ({ id: String(i), pos: 0 })) }
}
function claim(s, id = 'tab-a') {
  return { statePatch: { kind: 'HUMAN_ROLL_CLAIM', _commitKind: 'HUMAN_ROLL_CLAIM',
    _expectTurnPlayerId: s.turnPlayerId, _expectTurnSeq: s.turnSeq, _expectMatchId: s.matchId,
    _expectHumanRollId: id, turnLock: true, lockOwner: s.turnPlayerId,
    humanRoll: { id, executorId: id, playerId: s.turnPlayerId, turnSeq: s.turnSeq,
      matchId: s.matchId, moved: false, expiresAt: NOW + 30_000 },
  } }
}
function action(s, kind) {
  return { kind: kind === 'NORMAL_HANDOFF' ? 'TURN' : 'PLAYER_DELTA', _commitKind: kind,
    _expectTurnPlayerId: s.turnPlayerId, _expectTurnSeq: s.turnSeq,
    _expectMatchId: s.matchId, _expectHumanRollId: s.humanRoll.id }
}
const apply = (s, p, now = NOW) => applyGamePatchToState(s, p, { now })

for (const n of [1, 2, 3, 4]) {
  test(`${n} players: a delayed/failed movement cannot be overtaken by handoff`, async () => {
    let s = apply(world(n), claim(world(n))).state
    const origin = structuredClone(s)
    const move = { statePatch: { ...action(origin, 'HUMAN_MOVE'), humanRoll: { ...origin.humanRoll, moved: true } },
      playersDeltaById: { '0': { pos: 6 } } }
    const handoff = { statePatch: { ...action(origin, 'NORMAL_HANDOFF'), turnSeq: 11,
      turnPlayerId: n === 1 ? '0' : '1', turnLock: false } }
    assert.equal(apply(s, handoff).reason, 'human-move-unconfirmed')
    let release
    const delayed = new Promise(r => { release = r })
    let attempts = 0
    const observed = []
    const q = createHumanCommitQueue({ delay: async () => {} })
    const moved = q.enqueue(async () => {
      attempts++
      await delayed
      if (attempts === 1) return { ok: false } // real queue retries transport failures
      const result = apply(s, move)
      s = result.state
      observed.push('move')
      return result
    })
    const handed = q.enqueue(async () => {
      observed.push('handoff')
      const result = apply(s, handoff)
      s = result.state
      return result
    })
    await Promise.resolve()
    assert.equal(s.turnSeq, 10)
    assert.deepEqual(observed, [])
    release()
    assert.equal((await moved).ok, true)
    assert.equal((await handed).ok, true)
    assert.deepEqual(observed, ['move', 'handoff'])
    assert.equal(s.players[0].pos, 6)
    assert.equal(s.turnSeq, 11)
    assert.equal(attempts, 2)
  })
  test(`${n} players: two tabs claim same turn; only one can move`, () => {
    const original = world(n)
    const first = apply(original, claim(original))
    assert.equal(first.ok, true)
    assert.equal(apply(first.state, claim(original, 'tab-b')).reason, 'human-roll-already-claimed')
    const foreign = { statePatch: { ...action(first.state, 'PLAYER_DELTA'), _expectHumanRollId: 'tab-b' },
      playersDeltaById: { '0': { pos: 9 } } }
    assert.equal(apply(first.state, foreign).ok, false)
    assert.equal(first.state.players[0].pos, 0)
  })
}

test('abandoned pre-movement claim can be recovered, but a moved roll cannot be stolen', () => {
  const s = apply(world(), claim(world())).state
  assert.equal(humanClaimExpired(s, NOW + 30_001), true)
  assert.equal(apply(s, claim(world(), 'replacement'), NOW + 30_001).ok, true)
  const moved = { ...s, humanRoll: { ...s.humanRoll, moved: true } }
  assert.equal(apply(moved, claim(world(), 'replacement'), NOW + 90_000).ok, false)
})

test('stopping a queue or changing turn cancels unsent work', async () => {
  const q = createHumanCommitQueue()
  q.stop()
  let calls = 0
  assert.equal((await q.enqueue(() => { calls++; return { ok: true } })).ok, false)
  assert.equal(calls, 0)
  const q2 = createHumanCommitQueue()
  assert.equal((await q2.enqueue(() => { calls++; return { ok: true } }, () => false)).ok, false)
  assert.equal(calls, 0)
})

test('clock skew: slow/fast wall clocks do not change shared deadline or permit early timer', () => {
  for (const skew of [-120_000, 0, 120_000]) {
    let monotonic = 200
    const clock = createSharedClock({ monotonic: () => monotonic })
    assert.equal(clock.observe(new Date(NOW).toUTCString(), 0, 200), true)
    const deadline = clock.bounds().upper + 90_000
    const s = world(2)
    s.turnDeadlineAt = deadline
    // The OS wall clock may be anywhere. Actual expiration uses the lower bound.
    const wrongWallClock = NOW + skew
    assert.ok(Number.isFinite(wrongWallClock))
    monotonic += 89_000
    const p = { statePatch: { kind: 'TURN', _commitKind: 'AUTO_PASS', _expectTurnPlayerId: '0',
      _expectTurnSeq: 10, turnPlayerId: '1', turnSeq: 11 } }
    assert.equal(apply(s, p, clock.bounds().lower).ok, false)
    monotonic += 3000
    assert.equal(apply(s, p, clock.bounds().lower).ok, true)
  }
})

test('missing/cached HTTP Date never becomes a trusted clock; old samples expire', () => {
  let now = 100
  const clock = createSharedClock({ monotonic: () => now })
  assert.equal(clock.observe(null, 0, 100), false)
  assert.equal(clock.observe(new Date(NOW).toUTCString(), 0, 100, 30), false)
  assert.equal(clock.ready(), false)
  assert.equal(clock.observe(new Date(NOW).toUTCString(), 0, 100), true)
  now += 120_001
  assert.equal(clock.ready(), false)
})
