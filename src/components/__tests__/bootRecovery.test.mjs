import assert from 'node:assert/strict'
import test from 'node:test'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '../../..')
const index = readFileSync(join(root, 'index.html'), 'utf8')
const main = readFileSync(join(root, 'src/main.jsx'), 'utf8')
const boundary = readFileSync(join(root, 'src/components/AppErrorBoundary.jsx'), 'utf8')
const vite = readFileSync(join(root, 'vite.config.js'), 'utf8')

test('build mantém compatibilidade com o último Chrome/Edge do Windows 7', () => {
  assert.match(vite, /target:\s*\[[^\]]*['"]chrome109['"][^\]]*['"]edge109['"]/)
})

test('falha anterior ao React registra diagnóstico e nunca permanece em tela vazia', () => {
  assert.match(index, /CLIENT_BOOT_ERROR/)
  assert.match(index, /CLIENT_BOOT_TIMEOUT/)
  assert.match(index, /\/api\/client-logs/)
  assert.match(index, /Não foi possível iniciar o jogo/)
  assert.match(index, /__SG_LEAVE_STUCK_ROOM__/)
  assert.match(index, /searchParams\.delete\('room'\)/)
})

test('falha de renderização mostra recuperação e preserva a sala no servidor', () => {
  assert.match(main, /<AppErrorBoundary>[\s\S]*<Root \/>[\s\S]*<\/AppErrorBoundary>/)
  assert.match(main, /__SG_BOOT_READY__/)
  assert.match(boundary, /CLIENT_RENDER_CRASH/)
  assert.match(boundary, /Sua sala continua salva/)
  assert.match(boundary, /Tentar novamente/)
  assert.match(boundary, /Voltar à entrada/)
})
