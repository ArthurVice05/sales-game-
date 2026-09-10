/**
 * Monta a árvore REAL do app (main.jsx Root → GameNetProvider → App) dentro do
 * node:test, com Supabase falso e um DOM mínimo.
 *
 * Por que assim: ordem de effects, troca de sala no Provider e conclusão de
 * promessa não aparecem em teste de regex nem em helper isolado. Aqui o React é
 * o React de verdade — só o transporte (Supabase) e o DOM são dublês.
 */
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'
import { build } from 'esbuild'
import React from 'react'

import { installDomShim } from './domShim.mjs'

const require = createRequire(import.meta.url)

const EMPTY_NS = 'sg-empty'
const SUPABASE_NS = 'sg-supabase'

let bundlePromise = null

function stubPlugin () {
  return {
    name: 'sg-test-stubs',
    setup (b) {
      // Estilos e mídia não existem no node.
      b.onResolve({ filter: /\.(css|png|jpe?g|svg|gif|mp3|mp4|webm|woff2?)$/ }, () => ({
        path: 'asset', namespace: EMPTY_NS,
      }))
      // three.js é o renderer do tabuleiro; nada aqui depende dele.
      b.onResolve({ filter: /^three(\/.*)?$/ }, () => ({ path: 'three', namespace: EMPTY_NS }))
      // O client real leria .env; o teste injeta o seu.
      b.onResolve({ filter: /supabaseClient\.js$/ }, () => ({ path: 'supabase', namespace: SUPABASE_NS }))
      b.onLoad({ filter: /.*/, namespace: EMPTY_NS }, () => ({
        contents: 'module.exports = new Proxy(function () {}, { get: () => function () {} })',
        loader: 'js',
      }))
      b.onLoad({ filter: /.*/, namespace: SUPABASE_NS }, () => ({
        contents: 'export const supabase = globalThis.__SG_TEST_SUPABASE__ || null\nexport default supabase\n',
        loader: 'js',
      }))
    },
  }
}

async function getBundle () {
  if (!bundlePromise) {
    bundlePromise = build({
      entryPoints: [fileURLToPath(new URL('../../../main.jsx', import.meta.url))],
      bundle: true,
      write: false,
      format: 'cjs',
      platform: 'node',
      jsx: 'automatic',
      external: ['react', 'react/jsx-runtime', 'react-dom', 'react-dom/client'],
      define: {
        'import.meta.env': JSON.stringify({
          DEV: false,
          MODE: 'test',
          VITE_SUPABASE_URL: 'http://test.local',
          VITE_SUPABASE_ANON_KEY: 'test-anon-key',
        }),
      },
      plugins: [stubPlugin()],
      logLevel: 'silent',
    }).then((result) => result.outputFiles[0].text)
  }
  return bundlePromise
}

/* ------------------------------------------------------------ fibras/DOM */

function walkFibers (fiber, visit) {
  let node = fiber
  while (node) {
    visit(node)
    if (node.child) walkFibers(node.child, visit)
    node = node.sibling
  }
}

function fiberText (fiber) {
  let out = ''
  walkFibers(fiber, (node) => {
    if (node.tag === 6 && typeof node.memoizedProps === 'string') {
      out += node.memoizedProps + '\n'
      return
    }
    // Filho de texto único não vira fiber: o React grava direto no host.
    const children = node.tag === 5 ? node.memoizedProps?.children : undefined
    if (typeof children === 'string' || typeof children === 'number') {
      out += String(children) + '\n'
    }
  })
  return out
}

function collectClickables (fiber) {
  const found = []
  walkFibers(fiber, (node) => {
    const props = node.memoizedProps
    if (node.tag === 5 && props && typeof props.onClick === 'function') {
      found.push({ label: labelOf(props), onClick: props.onClick, props })
    }
  })
  return found
}

function labelOf (props) {
  const parts = []
  const visit = (child) => {
    if (child == null || child === false) return
    if (typeof child === 'string' || typeof child === 'number') { parts.push(String(child)); return }
    if (Array.isArray(child)) { child.forEach(visit); return }
    if (child.props) visit(child.props.children)
  }
  visit(props.children)
  if (props.title) parts.push(String(props.title))
  if (props['aria-label']) parts.push(String(props['aria-label']))
  return parts.join(' ').replace(/\s+/g, ' ').trim()
}

function safeInspect (value) {
  try { return JSON.stringify(value) } catch { return String(value) }
}

/* --------------------------------------------------------------- montagem */

export async function mountRoot ({ supabase, search = '', tabPlayerId, quiet = true } = {}) {
  const dom = installDomShim({ search })
  // O app é falante; o teste guarda os logs em vez de despejá-los no relatório.
  const consoleLog = []
  const originalConsole = {}
  if (quiet) {
    for (const level of ['log', 'debug', 'info', 'warn', 'error']) {
      originalConsole[level] = console[level]
      console[level] = (...args) => {
        consoleLog.push({ level, text: args.map((a) => (typeof a === 'string' ? a : safeInspect(a))).join(' ') })
      }
    }
  }
  globalThis.__SG_TEST_SUPABASE__ = supabase
  if (tabPlayerId) {
    dom.localStorage.setItem('sg:tabPlayerId', String(tabPlayerId))
    dom.localStorage.setItem('sg:playerId', String(tabPlayerId))
  }

  const code = await getBundle()
  const module = { exports: {} }
  const requireShim = (specifier) => require(specifier)
  new Function('require', 'module', 'exports', code)(requireShim, module, module.exports)
  const Root = module.exports.Root
  if (typeof Root !== 'function') throw new Error('main.jsx precisa exportar Root para o teste montar a árvore real')

  const { createRoot } = require('react-dom/client')
  const container = dom.createContainer()
  const root = createRoot(container)
  const act = React.act

  await act(async () => { root.render(React.createElement(Root)) })
  await act(async () => {})

  const currentFiber = () => root._internalRoot.current

  const harness = {
    dom,
    container,
    root,
    act,
    text: () => fiberText(currentFiber()),
    includes: (needle) => fiberText(currentFiber()).includes(needle),
    clickables: () => collectClickables(currentFiber()).map((c) => c.label),
    async click (label, { index = 0 } = {}) {
      const matches = collectClickables(currentFiber()).filter((c) => c.label.includes(label))
      const hit = matches[index]
      if (!hit) throw new Error(`nenhum clicável com "${label}" no índice ${index}. Disponíveis: ${collectClickables(currentFiber()).map((c) => c.label).join(' | ')}`)
      await act(async () => { hit.onClick({ preventDefault () {}, stopPropagation () {}, target: {} }) })
      await act(async () => {})
      return true
    },
    async type (value, { index = 0 } = {}) {
      const inputs = []
      walkFibers(currentFiber(), (node) => {
        const props = node.memoizedProps
        if (node.tag === 5 && node.type === 'input' && props && typeof props.onChange === 'function') {
          inputs.push(props)
        }
      })
      const target = inputs[index]
      if (!target) throw new Error(`nenhum <input> com onChange no índice ${index}`)
      await act(async () => {
        target.onChange({ target: { value }, currentTarget: { value }, preventDefault () {} })
      })
      await act(async () => {})
    },
    /** Deixa o React drenar promessas/timers já resolvidos. */
    async settle (rounds = 6) {
      for (let i = 0; i < rounds; i += 1) {
        await act(async () => { await new Promise((resolve) => setTimeout(resolve, 0)) })
      }
    },
    async waitFor (predicate, { rounds = 60, label = 'condição' } = {}) {
      for (let i = 0; i < rounds; i += 1) {
        if (predicate(harness)) return true
        await act(async () => { await new Promise((resolve) => setTimeout(resolve, 5)) })
      }
      throw new Error(`timeout esperando ${label}. Texto atual:\n${fiberText(currentFiber()).slice(0, 1200)}`)
    },
    async waitForText (needle, options = {}) {
      return harness.waitFor((h) => h.includes(needle), { label: `texto "${needle}"`, ...options })
    },
    setRoomCode (codeValue, options) {
      return act(async () => { globalThis.window.__setRoomCode?.(codeValue, options) })
    },
    /** Console capturado do app — evidência sem poluir o relatório do teste. */
    consoleLog,
    consoleText: () => consoleLog.map((e) => `[${e.level}] ${e.text}`).join('\n'),
    async unmount () {
      await act(async () => { root.unmount() })
      delete globalThis.__SG_TEST_SUPABASE__
      for (const [level, fn] of Object.entries(originalConsole)) console[level] = fn
    },
  }

  return harness
}
