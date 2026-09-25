import test from 'node:test'
import assert from 'node:assert/strict'
import { mountRoot } from './helpers/mountApp.mjs'
import { createFakeSupabase } from './helpers/fakeSupabase.mjs'
import { worldFixture, ROOM_A, playMatchInRoomA } from './helpers/spectatorWorld.mjs'

test('compra aberta após o dado expira e passa a vez sem clique humano', async () => {
  const world = worldFixture()
  world.lobby_players = world.lobby_players.filter((p) => p.lobby_id !== ROOM_A)
  world.lobby_players.push({
    lobby_id: ROOM_A,
    player_id: 'p-segundo',
    player_name: 'Segundo',
    ready: true,
    joined_at: '2026-01-01T00:00:02Z',
    last_seen: new Date().toISOString(),
  })
  const fake = createFakeSupabase(world)
  const app = await mountRoot({ supabase: fake.client, search: `?room=${ROOM_A}` })
  const row = () => fake.tables.rooms.find((r) => r.code === ROOM_A)
  try {
    await playMatchInRoomA(app)
    const owner = row().state.turnPlayerId
    const seq = row().state.turnSeq
    const cashBefore = row().state.players.find((p) => String(p.id) === String(owner))?.cash
    await app.act(async () => {
      app.componentProps('Controls').onAction({ type: 'ROLL', steps: 4 })
    })
    await app.waitForText('Gestor Comercial', { rounds: 300 })
    assert.equal(row().state.turnPlayerId, owner)

    const state = { ...row().state, turnDeadlineAt: Date.now() - 3000 }
    await fake.client.from('rooms').update({
      state,
      version: row().version + 1,
      updated_at: new Date().toISOString(),
    }).eq('id', row().id).select('id, code, state, version, updated_at').maybeSingle()

    await app.waitFor(() => row().state.turnPlayerId !== owner, {
      rounds: 500,
      label: 'auto-pass com compra aberta',
    })
    assert.equal(row().state.turnSeq, seq + 1)
    assert.equal(row().state.players.find((p) => String(p.id) === String(owner))?.cash, cashBefore)
    assert.equal(app.componentProps('BuyManagerModal'), null)
    await app.settle(8)
    assert.equal(row().state.turnSeq, seq + 1, 'não pode passar duas vezes')
  } finally {
    await app.unmount()
  }
})
