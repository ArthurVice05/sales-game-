import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '../../..')
const provider = readFileSync(join(root, 'src/net/GameNetProvider.jsx'), 'utf8')

test('estado da sala combina broadcast, Postgres Changes e polling', () => {
  assert.match(provider, /broadcast:\s*\{\s*ack:\s*true/)
  assert.match(provider, /\.on\(['"]broadcast['"],\s*\{\s*event:\s*['"]room_state['"]/)
  assert.match(provider, /type:\s*['"]broadcast['"][\s\S]*event:\s*['"]room_state['"]/)
  assert.match(provider, /postgres_changes/)
  assert.match(provider, /GAME_STATE_POLL_INTERVAL_MS/)
  assert.match(provider, /const lookup = await getLatestRoomByCode\(code\)/)
  assert.match(provider, /applyIncomingRow\(lookup\.row\)/)
  assert.match(provider, /applyIncomingRow\(payload\.new\s*\|\|\s*payload\.old/)
  assert.doesNotMatch(provider, /payload:\s*\{\s*row:\s*committedRow\s*\}/, 'broadcast não pode ser tratado como estado autoritativo')
})
