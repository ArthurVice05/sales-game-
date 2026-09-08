import test from 'node:test'
import assert from 'node:assert/strict'
import { resultsEntries } from '../final-winners/resultsPresentation.js'

const sceneModule = await import('../final-winners/createResultsScene.js').catch(() => ({}))
const entries = resultsEntries([{ patrimonio: 41570 }, { patrimonio: 24040 }, { patrimonio: -1000 }])

test('meshes reais crescem com base fixa e personagens ficam apoiados no topo', () => {
  assert.equal(typeof sceneModule.createResultsScene, 'function')
  const objects = sceneModule.createResultsScene(entries)
  for (const [time, progress] of [[0, 0], [1200, .5], [2400, 1]]) {
    objects.update(time)
    for (const item of objects.columns) {
      const height = objects.scale.height(item.entry.player.patrimonio) * progress
      assert.ok(Math.abs(item.column.scale.y - Math.abs(height)) < 1e-12)
      assert.equal(item.column.position.y, height / 2)
      assert.equal(item.person.group.position.y, Math.max(0, height))
      assert.ok(item.person.head.isGroup)
      assert.ok(item.column.geometry.isBufferGeometry)
    }
  }
  objects.dispose()
})

test('reações distintas terminam em poses estáticas, sem salto no segundo/terceiro', () => {
  assert.equal(typeof sceneModule.createResultsScene, 'function')
  const objects = sceneModule.createResultsScene(entries)
  objects.update(2700)
  const winner = objects.columns.find(c => c.entry.place === 1)
  assert.ok(winner.person.group.position.y > objects.scale.height(41570))
  for (const item of objects.columns.filter(c => c.entry.place !== 1)) {
    assert.equal(item.person.group.position.y, Math.max(0, objects.scale.height(item.entry.player.patrimonio)))
  }
  objects.update(3600)
  const positions = objects.columns.map(c => c.person.group.position.y)
  objects.update(10000)
  assert.deepEqual(objects.columns.map(c => c.person.group.position.y), positions)
  assert.ok(winner.person.leftArm.rotation.z < -2)
  assert.ok(objects.columns.find(c => c.entry.place === 3).person.head.rotation.x > 0)
  objects.dispose()
})

test('descarte idempotente libera geometrias e materiais compartilhados só uma vez', () => {
  assert.equal(typeof sceneModule.createResultsScene, 'function')
  const objects = sceneModule.createResultsScene(entries)
  const counts = new Map()
  objects.scene.traverse(object => {
    for (const resource of [object.geometry, object.material].filter(Boolean)) {
      if (counts.has(resource)) continue
      counts.set(resource, 0)
      resource.addEventListener('dispose', () => counts.set(resource, counts.get(resource) + 1))
    }
  })
  objects.dispose(); objects.dispose()
  assert.ok(counts.size > 5)
  assert.ok([...counts.values()].every(count => count === 1))
})
