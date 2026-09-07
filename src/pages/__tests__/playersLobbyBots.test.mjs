/**
 * Configuração de máquinas só no PlayersLobby, com flag, depois do nome/sala.
 */
import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { isBotsFeatureEnabled } from '../../game/bots/botFlags.js'
import { effectiveBotCount, maxBotCountForHumans } from '../../game/bots/botRoster.js'

const __dirname = dirname(fileURLToPath(import.meta.url))
const startSrc = readFileSync(join(__dirname, '../../components/StartScreen.jsx'), 'utf8')
const lobbySrc = readFileSync(join(__dirname, '../../pages/LobbyList.jsx'), 'utf8')
const playersLobbySrc = readFileSync(join(__dirname, '../../pages/PlayersLobby.jsx'), 'utf8')

describe('StartScreen — sem máquinas', () => {
  it('não contém configuração de máquinas', () => {
    assert.doesNotMatch(startSrc, /Máquinas/)
    assert.doesNotMatch(startSrc, /Jogar contra máquinas/)
    assert.doesNotMatch(startSrc, /botCount/)
  })
})

describe('modal Criar nova sala — sem máquinas', () => {
  it('não contém seletor de máquinas', () => {
    assert.doesNotMatch(lobbySrc, /createBotCount/)
    assert.doesNotMatch(lobbySrc, /isBotsFeatureEnabled/)
    assert.match(lobbySrc, /Criar nova sala/)
  })
})

describe('PlayersLobby — seletor de máquinas', () => {
  it('mostra seletor somente com flag ativa e sala open', () => {
    assert.match(playersLobbySrc, /botsEnabled && lobby\?\.status === 'open'/)
    assert.match(playersLobbySrc, /isBotsFeatureEnabled\(\)/)
  })

  it('flag desligada zera botCount efetivo', () => {
    assert.equal(isBotsFeatureEnabled({}), false)
    assert.equal(effectiveBotCount({ humanCount: 1, requestedCount: 3, botsEnabled: false }), 0)
  })

  it('somente host edita; convidado visualiza', () => {
    assert.match(playersLobbySrc, /Máquinas: <b>\{effectiveBots\}<\/b>/)
    assert.match(playersLobbySrc, /Somente o host pode alterar/)
  })

  it('botCount inicial zero no seed', () => {
    assert.match(playersLobbySrc, /normalizeBotConfig\(\{ count: 0 \}\)/)
    assert.match(playersLobbySrc, /useState\(0\)/)
  })

  it('limites 1+3 / 2+2 / 3+1 / 4+0', () => {
    assert.equal(maxBotCountForHumans(1, 4), 3)
    assert.equal(maxBotCountForHumans(2, 4), 2)
    assert.equal(maxBotCountForHumans(3, 4), 1)
    assert.equal(maxBotCountForHumans(4, 4), 0)
  })
})
