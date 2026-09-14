// Real Root -> App -> turn engine -> provider. Only DOM and transport are doubles.
import test from 'node:test'
import assert from 'node:assert/strict'
import { mountRoot } from './helpers/mountApp.mjs'
import { createFakeSupabase } from './helpers/fakeSupabase.mjs'
import { worldFixture, ROOM_A, playMatchInRoomA } from './helpers/spectatorWorld.mjs'

for (const count of [1, 2, 3, 4]) {
  test(`real App / ${count} players: delayed human movement stays ahead of handoff`, async (t) => {
    const world = worldFixture()
    world.lobby_players = world.lobby_players.filter(p => p.lobby_id !== ROOM_A)
    for (let i = 1; i < count; i++) world.lobby_players.push({
      lobby_id: ROOM_A, player_id: `00000000-0000-4000-8000-00000000000${i}`,
      player_name: `Mobile ${i}`, ready: true,
      joined_at: new Date(Date.now() - i * 1000).toISOString(), last_seen: new Date().toISOString(),
    })
    const fake = createFakeSupabase(world)
    const app = await mountRoot({ supabase: fake.client, search: `?room=${ROOM_A}` })
    let release = () => {}
    let held = false
    try {
      await playMatchInRoomA(app)
      const row = () => fake.tables.rooms.find(r => r.code === ROOM_A)
      assert.equal(row().state.players.length, count)
      const originSeq = row().state.turnSeq
      const originId = row().state.turnPlayerId
      const delayed = new Promise(r => { release = r })
      fake.beforeOp('rooms', 'update', async ({ payload }) => {
        if (payload.state?.humanRoll?.moved && payload.state?.turnSeq === originSeq && !held) {
          held = true
          await delayed
        }
      })
      const controls = app.componentProps('Controls')
      assert.ok(controls?.onAction)
      await app.act(async () => { controls.onAction({ type: 'ROLL', steps: 1 }) })
      await app.waitFor(() => held, { rounds: 200, label: 'movement submitted to provider' })
      // Close the real purchase decision while its preceding movement is delayed.
      await app.waitFor(() => app.clickables().some(label => /não comprar/i.test(label)), { rounds: 200, label: 'purchase decision' })
      const cancel = app.clickables().find(label => /cancelar|agora não|não comprar|pular compra/i.test(label))
      assert.ok(cancel, `purchase decision missing: ${app.clickables().join(' | ')}`)
      await app.click(cancel)
      await app.act(async () => { await new Promise(r => setTimeout(r, 600)) })
      assert.equal(row().state.turnSeq, originSeq, 'handoff overtook unconfirmed movement')
      assert.equal(row().state.players.find(p => p.id === originId).pos, 0)
      release()
      await app.waitFor(() => row().state.turnSeq === originSeq + 1, { rounds: 500, label: 'confirmed handoff' })
      assert.equal(row().state.players.find(p => p.id === originId).pos, 1)
      const commits = fake.calls.filter(c => c.table === 'rooms' && c.op === 'update' && c.payload?.state)
      const movement = commits.findIndex(c => c.payload.state.humanRoll?.moved)
      const handoff = commits.findIndex(c => c.payload.state.turnSeq === originSeq + 1)
      assert.ok(movement >= 0 && handoff > movement)
    } catch (error) {
      t.diagnostic(error.stack)
      t.diagnostic(app.consoleText().slice(-2500))
      throw error
    } finally { release(); await app.unmount() }
  })
}
