import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '../..')
const lobby = readFileSync(join(root, 'pages/LobbyList.jsx'), 'utf8')
const app = readFileSync(join(root, 'App.jsx'), 'utf8')
const start = readFileSync(join(root, 'components/StartScreen.jsx'), 'utf8')

test('LobbyList expõe Voltar via onBack sem history.back/reload', () => {
  assert.match(lobby, /onBack/)
  assert.match(lobby, /Voltar/)
  assert.match(lobby, /lobbyBtn--ghost/)
  assert.match(lobby, /type=["']button["']/)
  assert.doesNotMatch(lobby, /history\.back\(|location\.reload\(/)
  // Botão no header de ações, antes de Atualizar
  const actions = lobby.match(/className=["']lobbyActions["'][\s\S]{0,500}?Atualizar/)
  assert.ok(actions, 'lobbyActions deve conter Voltar antes de Atualizar')
  assert.match(actions[0], /Voltar[\s\S]*Atualizar|onBack[\s\S]*Atualizar/)
})

test('App conecta onBack da lista à fase start sem limpar nome', () => {
  assert.match(app, /<LobbyList[\s\S]*?onBack=\{/)
  const block = app.match(/if \(phase === 'lobbies'\)[\s\S]*?<LobbyList[\s\S]*?\/>/)
  assert.ok(block, 'bloco lobbies com LobbyList')
  assert.match(block[0], /onBack=\{\(\)\s*=>\s*\{[\s\S]*?setPhase\(['"]start['"]\)/)
  assert.doesNotMatch(block[0], /setMyName\(['"]['"]\)|setTabPlayerName\(|localStorage\.clear|signOut|leaveLobby/)
})

test('StartScreen aceita currentName para preservar o nome ao voltar', () => {
  assert.match(start, /currentName/)
  assert.match(start, /useState\(\(\)\s*=>\s*String\(currentName/)
})

test('LobbyList ignora navegação de entrada após desmontar', () => {
  assert.match(lobby, /aliveRef|mountedRef/)
  assert.match(lobby, /aliveRef\.current|mountedRef\.current/)
  assert.match(lobby, /onEnterRoom\?\.\(/)
})
