import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import {
  assembleMatchRoster,
  effectiveBotCount,
  lobbyStartGate,
  maxBotCountForHumans,
  botsNeverTouchLobbyPlayers,
  normalizeBotConfig,
} from '../bots/botRoster.js'
import { isBotPlayer } from '../bots/botTypes.js'

function humans(n, ready = true) {
  return Array.from({ length: n }, (_, i) => ({
    id: `h${i}`,
    player_id: `h${i}`,
    name: `Humano ${i + 1}`,
    ready,
  }))
}

describe('roster e limites de máquinas', () => {
  it('flag off zera botCount efetivo', () => {
    assert.equal(effectiveBotCount({ humanCount: 1, requestedCount: 3, botsEnabled: false }), 0)
  })

  it('humanos têm prioridade: 4 humanos → 0 máquinas', () => {
    assert.equal(maxBotCountForHumans(4, 4), 0)
    assert.equal(effectiveBotCount({ humanCount: 4, requestedCount: 3 }), 0)
  })

  it('1 humano cabe 3 máquinas; 2 cabem 2; 3 cabe 1', () => {
    assert.equal(maxBotCountForHumans(1, 4), 3)
    assert.equal(maxBotCountForHumans(2, 4), 2)
    assert.equal(maxBotCountForHumans(3, 4), 1)
  })

  it('assemble anexa bots só no START, depois dos humanos', () => {
    const roster = assembleMatchRoster({
      humans: humans(1),
      matchId: 'abc',
      botCount: 2,
      botsEnabled: true,
    })
    assert.equal(roster.length, 3)
    assert.equal(isBotPlayer(roster[0]), false)
    assert.equal(isBotPlayer(roster[1]), true)
    assert.equal(isBotPlayer(roster[2]), true)
    assert.equal(roster[1].id.startsWith('bot:abc:'), true)
  })

  it('máquinas nunca entram em lobby_players', () => {
    const roster = assembleMatchRoster({
      humans: humans(1),
      matchId: 'm',
      botCount: 2,
      botsEnabled: true,
    })
    assert.equal(
      botsNeverTouchLobbyPlayers([{ player_id: 'h0' }], roster),
      true,
    )
  })

  it('lobbyStartGate: host + humanos prontos', () => {
    const notHost = lobbyStartGate({
      humans: humans(1),
      botCount: 1,
      amHost: false,
      lobbyOpen: true,
      botsEnabled: true,
    })
    assert.equal(notHost.canStart, false)
    const notReady = lobbyStartGate({
      humans: humans(1, false),
      botCount: 1,
      amHost: true,
      lobbyOpen: true,
      botsEnabled: true,
    })
    assert.equal(notReady.canStart, false)
  })

  it('normalizeBotConfig clampa 0–3', () => {
    assert.equal(normalizeBotConfig({ count: 9 }).count, 3)
    assert.equal(normalizeBotConfig({ count: -1 }).count, 0)
  })
})
