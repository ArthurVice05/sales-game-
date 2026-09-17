import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { evaluateMatchEntryReadiness, MATCH_ENTRY } from '../matchEntryReadiness.js'

test('resume returns the authoritative rooms generation when both stores agree', () => {
  const decision = evaluateMatchEntryReadiness({
    latestMatchId: 'match-live',
    roomState: {
      matchId: 'match-live',
      players: [{ id: 'player-1', name: 'Jogador' }],
    },
    persistedPlayerId: 'player-1',
    mode: 'legacy-resume',
  })

  assert.equal(decision.action, MATCH_ENTRY.ENTER_CURRENT_MATCH)
  assert.equal(decision.reason, 'match-id-match')
  assert.equal(decision.matchId, 'match-live')
})

test('resume rejects a snapshot from another match generation', () => {
  const decision = evaluateMatchEntryReadiness({
    latestMatchId: 'match-stale',
    roomState: {
      matchId: 'match-live',
      players: [{ id: 'player-1', name: 'Jogador' }],
    },
    persistedPlayerId: 'player-1',
    mode: 'legacy-resume',
  })

  assert.equal(decision.action, MATCH_ENTRY.REJECT_MISMATCHED_MATCH)
})

test('PlayersLobby passes the validated snapshot and App applies it on resume', () => {
  const playersLobby = readFileSync(new URL('../../pages/PlayersLobby.jsx', import.meta.url), 'utf8')
  const app = readFileSync(new URL('../../App.jsx', import.meta.url), 'utf8')
  assert.match(playersLobby, /roomState: roomMeta\.state/)
  assert.match(playersLobby, /matchId: decision\.matchId \|\| roomMeta\.state\?\.matchId/)
  assert.match(app, /resumeHasPlayer/)
  assert.match(app, /'validated_entry'/)
})
