import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '../../..')
const migration = readFileSync(
  join(root, 'supabase/migrations/20260917154500_enable_rooms_realtime.sql'),
  'utf8',
)

test('rooms faz parte da publicação usada pelo canal Realtime do jogo', () => {
  assert.match(
    migration,
    /alter\s+publication\s+supabase_realtime\s+add\s+table\s+public\.rooms/i,
  )
  assert.match(migration, /when\s+duplicate_object/i, 'a migração deve ser segura ao reaplicar')
})
