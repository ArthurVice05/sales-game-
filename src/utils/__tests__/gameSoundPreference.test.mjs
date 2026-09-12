import test from 'node:test'
import assert from 'node:assert/strict'
import {
  GAME_SOUND_PREFERENCE_KEY,
  readGameSoundEnabled,
  writeGameSoundEnabled,
  setGameSoundEnabled,
  toggleGameSoundEnabled,
  subscribeGameSound,
  registerGameSoundStopper,
} from '../gameSoundPreference.js'

function memoryStore(initial = {}) {
  const map = new Map(Object.entries(initial))
  return {
    getItem: (k) => (map.has(k) ? map.get(k) : null),
    setItem: (k, v) => { map.set(k, String(v)) },
  }
}

test('padrão permanece ligado quando a chave não existe', () => {
  assert.equal(readGameSoundEnabled(memoryStore()), true)
})

test('persiste e restaura preferência local', () => {
  const store = memoryStore()
  writeGameSoundEnabled(false, store)
  assert.equal(store.getItem(GAME_SOUND_PREFERENCE_KEY), '0')
  assert.equal(readGameSoundEnabled(store), false)
  writeGameSoundEnabled(true, store)
  assert.equal(readGameSoundEnabled(store), true)
})

test('desligar notifica e chama stoppers; religar não dispara stop', () => {
  const store = memoryStore()
  const heard = []
  let stops = 0
  const unsub = subscribeGameSound((on) => heard.push(on))
  const unreg = registerGameSoundStopper(() => { stops += 1 })

  setGameSoundEnabled(false, store)
  assert.deepEqual(heard, [false])
  assert.equal(stops, 1)

  setGameSoundEnabled(true, store)
  assert.deepEqual(heard, [false, true])
  assert.equal(stops, 1)

  unsub()
  unreg()
})

test('toggle inverte e storage quebrado não lança', () => {
  const store = memoryStore()
  assert.equal(toggleGameSoundEnabled(store), false)
  assert.equal(toggleGameSoundEnabled(store), true)
  const broken = {
    getItem() { throw new Error('blocked') },
    setItem() { throw new Error('blocked') },
  }
  assert.equal(readGameSoundEnabled(broken), true)
  assert.doesNotThrow(() => setGameSoundEnabled(false, broken))
})
