import test from 'node:test'
import assert from 'node:assert/strict'
import { mountRoot } from './helpers/mountApp.mjs'
import { createFakeSupabase } from './helpers/fakeSupabase.mjs'
import { worldFixture, ROOM_A, playMatchInRoomA } from './helpers/spectatorWorld.mjs'
import { classifyMonitoringEvent } from '../vercelLogTransport.js'

function rollButton(app) {
  let found
  const walk = n => {
    if (!n) return
    if (n.tag === 5 && n.type === 'button' && n.memoizedProps?.className === 'btn go') found = n.memoizedProps
    walk(n.child); walk(n.sibling)
  }
  walk(app.root._internalRoot.current)
  assert.ok(found)
  return found
}
async function setup() {
  const world = worldFixture()
  world.lobby_players = world.lobby_players.filter(p => p.lobby_id !== ROOM_A)
  const fake = createFakeSupabase(world)
  const app = await mountRoot({ supabase: fake.client, search: `?room=${ROOM_A}` })
  await playMatchInRoomA(app)
  return { fake, app, row: () => fake.tables.rooms.find(r => r.code === ROOM_A) }
}
async function clickRoll(app) {
  assert.equal(rollButton(app).disabled, false)
  const original = Math.random
  try { Math.random = () => 0; await app.act(async () => rollButton(app).onClick()) }
  finally { Math.random = original }
}
const moves = fake => fake.calls.filter(c => c.table === 'rooms' && c.op === 'update' && c.payload?.state?.humanRoll?.moved)

test('real button disables and explains pending confirmation; repeated clicks move only once', async () => {
  const { fake, app, row } = await setup()
  let release
  let intercepted = 0
  const held = new Promise(r => { release = r })
  try {
    fake.beforeOp('rooms', 'update', async ({ payload }) => {
      if (payload.state?.kind === 'HUMAN_ROLL_CLAIM') { intercepted++; await held }
    })
    await clickRoll(app)
    await app.waitFor(() => intercepted === 1, { rounds: 200 })
    assert.equal(rollButton(app).disabled, true)
    assert.equal(rollButton(app)['aria-busy'], true)
    assert.ok(app.includes('Confirmando jogada'))
    // Also defend against an event queued before React painted the disabled state.
    for (let i = 0; i < 3; i++) await app.act(async () => app.componentProps('Controls').onAction({ type: 'ROLL', steps: 6 }))
    release()
    await app.waitFor(() => row().state.humanRoll?.moved, { rounds: 400 })
    assert.equal(row().state.players[0].pos, 1)
    assert.equal(new Set(fake.calls.filter(c => c.payload?.state?.humanRoll).map(c => c.payload.state.humanRoll.id)).size, 1)
    assert.ok(moves(fake).every(c => c.payload.state.players[0].pos === 1))
  } finally { release(); await app.unmount() }
})

test('lost claim response is recovered automatically from the receipt without a second roll', async () => {
  const { fake, app, row } = await setup()
  let release
  let held = false
  const response = new Promise(r => { release = r })
  try {
    fake.afterOp('rooms', 'update', async ({ payload, result }) => {
      if (!held && !result.error && payload.state?.kind === 'HUMAN_ROLL_CLAIM') {
        held = true
        await response
      }
    })
    await clickRoll(app)
    await app.waitFor(() => held, { rounds: 200 })
    const claimId = row().state.humanRoll.id
    assert.equal(row().state.humanRoll.moved, false)
    await app.waitFor(() => row().state.humanRoll?.moved, { rounds: 2200, label: 'automatic lost-response recovery' })
    assert.equal(row().state.humanRoll.id, claimId)
    assert.equal(row().state.players[0].pos, 1)
    assert.match(app.consoleText(), /ROLL_CONFIRMATION_RETRY/)
    release()
    await app.settle(10)
    assert.equal(row().state.players[0].pos, 1, 'late response cannot move again')
  } finally { release(); await app.unmount() }
})

test('offline confirmation offers retry; reconnect reuses the same dice and ignores late requests', async () => {
  const { fake, app, row } = await setup()
  let release
  let offline = true
  let firstClaim
  const held = new Promise(r => { release = r })
  try {
    fake.beforeOp('rooms', 'update', async ({ payload }) => {
      if (offline && payload.state?.kind === 'HUMAN_ROLL_CLAIM') {
        firstClaim ||= structuredClone(payload.state.humanRoll)
        await held
      }
    })
    await clickRoll(app)
    await app.waitFor(() => app.includes('Tentar novamente'), { rounds: 4200, label: 'bounded offline failure' })
    assert.equal(rollButton(app).disabled, false)
    assert.equal(row().state.players[0].pos, 0)
    offline = false
    // A retry event may carry another value; it must reuse the original roll.
    await app.act(async () => app.componentProps('Controls').onAction({ type: 'ROLL', steps: 6 }))
    await app.waitFor(() => row().state.humanRoll?.moved, { rounds: 400 })
    assert.equal(row().state.humanRoll.id, firstClaim.id)
    assert.equal(row().state.humanRoll.steps, 1)
    assert.equal(row().state.players[0].pos, 1)
    release()
    await app.settle(10)
    assert.equal(row().state.players[0].pos, 1)
  } finally { release(); await app.unmount() }
})

test('already-rolled snapshot disables the real button and explains the wait', async () => {
  const { fake, app, row } = await setup()
  try {
    const current = row()
    await app.act(async () => {
      await fake.client.from('rooms').update({ state: { ...current.state, kind: 'PATCH', stateId: 'rolled',
        lastRollTurnKey: String(current.state.turnSeq), turnLock: false, lockOwner: null },
        version: current.version + 1, updated_at: new Date().toISOString(),
      }).eq('id', current.id).select().maybeSingle()
    })
    await app.settle(10)
    assert.equal(rollButton(app).disabled, true)
    assert.ok(app.includes('Jogada já realizada'))
  } finally { await app.unmount() }
})

test('Vercel classifies roll failures and recovery without dropping the cause', () => {
  for (const [code, severity] of [
    ['ROLL_BLOCKED', 'warning'], ['ROLL_CONFIRMATION_RETRY', 'warning'],
    ['ROLL_CONFIRMATION_FAILED', 'error'], ['ROLL_CONFIRMED', 'info'],
  ]) {
    const event = classifyMonitoringEvent({ level: 'warn', message: `[MONITOR][${code}] {"room":"room-1","turnSeq":3}` })
    assert.equal(event?.code, code)
    assert.equal(event?.severity, severity)
  }
})

test('a newer server turn cancels pending roll; late request cannot change either turn', async () => {
  const { fake, app, row } = await setup()
  let release
  let held = false
  const delayed = new Promise(r => { release = r })
  try {
    fake.beforeOp('rooms', 'update', async ({ payload }) => {
      if (payload.state?.kind === 'HUMAN_ROLL_CLAIM') { held = true; await delayed }
    })
    await clickRoll(app)
    await app.waitFor(() => held, { rounds: 200 })
    const nextSeq = row().state.turnSeq + 1
    await app.act(async () => {
      await fake.client.from('rooms').update({ state: { ...row().state, kind: 'TURN', stateId: 'next-turn',
        turnSeq: nextSeq, turnLock: false, lockOwner: null, lastRollTurnKey: null },
        version: row().version + 1, updated_at: new Date().toISOString(),
      }).eq('id', row().id).select().maybeSingle()
    })
    await app.settle(10)
    release()
    await app.settle(10)
    assert.equal(row().state.turnSeq, nextSeq)
    assert.equal(row().state.players[0].pos, 0)
    assert.equal(rollButton(app).disabled, false)
    assert.equal(app.componentProps('DiceRollOverlay').open, false)
  } finally { release(); await app.unmount() }
})

test('claim rejection hydrates a missed server snapshot and disables the stale button', async () => {
  const { fake, app, row } = await setup()
  try {
    // Server write whose realtime notification was lost.
    row().state = { ...row().state, kind: 'PATCH', stateId: 'missed', lastRollTurnKey: String(row().state.turnSeq) }
    row().version++
    await clickRoll(app)
    await app.waitFor(() => app.includes('Jogada já realizada'), { rounds: 400 })
    assert.equal(rollButton(app).disabled, true)
    assert.equal(moves(fake).length, 0)
    assert.match(app.consoleText(), /already-rolled/)
  } finally { await app.unmount() }
})

test('a decision opened during confirmation cannot silently consume the roll', async t => {
  const { fake, app, row } = await setup()
  let release
  let held = false
  const delayed = new Promise(r => { release = r })
  try {
    fake.beforeOp('rooms', 'update', async ({ payload }) => {
      if (!held && payload.state?.kind === 'HUMAN_ROLL_CLAIM') { held = true; await delayed }
    })
    await clickRoll(app)
    await app.waitFor(() => held, { rounds: 200 })
    await app.act(async () => app.componentProps('Controls').onAction({ type: 'RECOVERY_MODAL' }))
    await app.waitFor(() => app.componentProps('Controls').modalLocks > 0, { rounds: 200 })
    release()
    await app.waitFor(() => app.consoleText().includes('decision-open'), { rounds: 400 })
    assert.equal(row().state.players[0].pos, 0)
    assert.equal(app.componentProps('DiceRollOverlay').open, false)
    const closeMatches = app.clickables().filter(label => label.includes('×'))
    await app.click('×', { index: closeMatches.lastIndexOf('×') })
    await app.waitFor(() => !rollButton(app).disabled, { rounds: 400 })
    await app.act(async () => app.componentProps('Controls').onAction({ type: 'ROLL', steps: 6 }))
    await app.waitFor(() => row().state.humanRoll?.moved, { rounds: 400 })
    assert.equal(row().state.players[0].pos, 1, 'same original die after closing the decision')
  } catch (error) {
    t.diagnostic(app.clickables().slice(-12).join(' | '))
    t.diagnostic(JSON.stringify({ permission: app.componentProps('Controls')?.rollPermission, modalLocks: app.componentProps('Controls')?.modalLocks }))
    t.diagnostic(app.consoleText().slice(-3000))
    throw error
  } finally { release(); await app.unmount() }
})
