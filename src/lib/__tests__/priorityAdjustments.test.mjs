import test from 'node:test'
import assert from 'node:assert/strict'
import { existsSync, readFileSync, readdirSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = resolve(fileURLToPath(new URL('../../..', import.meta.url)))
const read = (path) => readFileSync(join(root, path), 'utf8')

test('faturamento identifica o beneficiário e mostra caixa antes/depois', () => {
  const modal = read('src/modals/FaturamentoMesModal.jsx')
  const engine = read('src/game/useTurnEngine.jsx')

  assert.match(modal, /playerName/)
  assert.match(modal, /cashBefore/)
  assert.match(modal, /cashAfter/)
  assert.match(modal, /Recebedor|Empresa/)
  assert.match(engine, /<FaturamentoDoMesModal[\s\S]{0,240}playerName=/)
})

test('entrada e início de sala usam RPCs transacionais', () => {
  const lobbies = read('src/lib/lobbies.js')
  const lobbyPage = read('src/pages/PlayersLobby.jsx')

  assert.match(lobbies, /\.rpc\(['"]join_lobby_atomic['"]/)
  assert.match(lobbies, /\.rpc\(['"]start_match_atomic['"]/)
  assert.match(lobbyPage, /startMatch\(\{\s*lobbyId,\s*hostPlayerId:\s*meId/s)
  assert.doesNotMatch(lobbyPage, /setLobbyStatus\(lobbyId,\s*['"]locked['"]\)\s*\/\/ trava a sala/)
})

test('lista de salas não reage aos UPDATEs de heartbeat', () => {
  const lobbies = read('src/lib/lobbies.js')
  const block = lobbies.slice(lobbies.indexOf('export function onLobbiesRealtime'), lobbies.indexOf('/* ==============================', lobbies.indexOf('export function onLobbiesRealtime')))

  assert.doesNotMatch(block, /table:\s*['"]lobby_players['"][^\n]*event:\s*['"]\*['"]/)
  assert.match(block, /event:\s*['"]INSERT['"][^\n]*table:\s*['"]lobby_players['"]|table:\s*['"]lobby_players['"][^\n]*event:\s*['"]INSERT['"]/)
  assert.match(block, /event:\s*['"]DELETE['"][^\n]*table:\s*['"]lobby_players['"]|table:\s*['"]lobby_players['"][^\n]*event:\s*['"]DELETE['"]/)
})

test('polling de segurança é lento e só entra após silêncio do realtime', () => {
  const provider = read('src/net/GameNetProvider.jsx')
  assert.match(provider, /GAME_STATE_POLL_INTERVAL_MS\s*=\s*10_000/)
  assert.match(provider, /REALTIME_SILENCE_BEFORE_POLL_MS\s*=\s*5_000/)
  assert.doesNotMatch(provider, /\},\s*700\)/)
})

test('migração cobre RPCs, índices e limpeza de rooms órfãs', () => {
  const dir = join(root, 'supabase', 'migrations')
  assert.equal(existsSync(dir), true)
  const sql = readdirSync(dir).filter((name) => name.endsWith('.sql')).map((name) => read(`supabase/migrations/${name}`)).join('\n')

  assert.match(sql, /function\s+public\.join_lobby_atomic/i)
  assert.match(sql, /function\s+public\.start_match_atomic/i)
  assert.match(sql, /for\s+update/i)
  assert.match(sql, /rooms[\s\S]+not\s+exists[\s\S]+lobbies/i)
  assert.match(sql, /create\s+index[\s\S]+rooms[\s\S]+code/i)
})

test('build separa bibliotecas grandes e existe teste de carga', () => {
  const vite = read('vite.config.js')
  assert.match(vite, /manualChunks/)
  assert.match(vite, /three/)
  assert.equal(existsSync(join(root, 'scripts', 'load-test-rooms.mjs')), true)
})

test('roteiros visuais atuais usam modo local e não esperam handoff removido', () => {
  const responsive = read('scripts/verify-responsive-layout.mjs')
  const matrix = read('scripts/verify-mobile-landscape-matrix.mjs')

  assert.match(responsive, /startBtn--local/)
  assert.doesNotMatch(responsive, /\.lobbyPage/)
  assert.doesNotMatch(matrix, /localHandoffButton/)
})
