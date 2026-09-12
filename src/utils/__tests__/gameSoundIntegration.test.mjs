import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createRevealSound } from '../../modals/sorteRevesRevealSound.js'

const root = join(dirname(fileURLToPath(import.meta.url)), '../..')
const read = (rel) => readFileSync(join(root, rel), 'utf8')

test('reveal respeita isEnabled da carta (mute parcial)', () => {
  const sound = createRevealSound('sorte', {
    isEnabled: () => false,
    createAudio: () => {
      throw new Error('não deve criar áudio')
    },
  })
  assert.equal(sound.play(), 'off')
})

test('mute geral e emissores compartilham a preferência', () => {
  const reveal = read('modals/sorteRevesRevealSound.js')
  assert.match(reveal, /readGameSoundEnabled/)
  assert.match(reveal, /registerGameSoundStopper/)
  const dice = read('utils/diceRollSound.js')
  assert.match(dice, /readGameSoundEnabled/)
  assert.match(dice, /registerGameSoundStopper/)
  const hop = read('utils/tokenHopSound.js')
  assert.match(hop, /readGameSoundEnabled/)
  const app = read('App.jsx')
  assert.match(app, /GameSoundToggle/)
  assert.match(app, /gameSoundToggle--header/)
  assert.match(app, /gameSoundToggle--more/)
  const modal = read('modals/SorteRevesModal.jsx')
  assert.match(modal, /effectiveSoundOn/)
  assert.match(modal, /setGameSoundEnabled/)
})
