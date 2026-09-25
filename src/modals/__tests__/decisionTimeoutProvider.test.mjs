import test from 'node:test'
import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'
import { build } from 'esbuild'
import React from 'react'
import { buildBotModalTypeIndex } from '../../game/bots/botDecisionKind.js'
import { installDomShim } from '../../game/__tests__/helpers/domShim.mjs'

const require = createRequire(import.meta.url)

test('modal real de compra vence como SKIP e libera a pilha, mesmo com nome minificado', async () => {
  const dom = installDomShim()
  let root
  try {
    const result = await build({
      entryPoints: [fileURLToPath(new URL('../ModalContext.jsx', import.meta.url))],
      bundle: true,
      write: false,
      format: 'cjs',
      platform: 'node',
      jsx: 'automatic',
      external: ['react', 'react/jsx-runtime'],
      loader: { '.css': 'empty' },
      logLevel: 'silent',
    })
    const module = { exports: {} }
    new Function('require', 'module', 'exports', result.outputFiles[0].text)(require, module, module.exports)
    const { ModalProvider, useModal } = module.exports
    const { createRoot } = require('react-dom/client')
    const act = React.act
    let api
    function n() { return null }
    function Bridge() {
      api = useModal()
      return null
    }
    root = createRoot(dom.createContainer())
    await act(async () => { root.render(React.createElement(ModalProvider, null, React.createElement(Bridge))) })

    api.registerDecisionTypes(buildBotModalTypeIndex({ BuyFieldSalesModal: n }))
    let answer
    await act(async () => { answer = api.openAndWait(React.createElement(n)) })
    assert.deepEqual(api.peekOpenDecisionKinds(), ['FIELD'])
    let expired
    await act(async () => { expired = api.expireOpenDecisions() })
    assert.equal(expired.ok, true)
    assert.equal(expired.category, 'optional')
    assert.equal((await answer).action, 'SKIP')
    assert.deepEqual(api.peekOpenDecisionKinds(), [])

    api.registerDecisionTypes(buildBotModalTypeIndex({ BankruptcyModal: n }))
    await act(async () => { answer = api.openAndWait(React.createElement(n)) })
    await act(async () => { expired = api.expireOpenDecisions() })
    assert.equal(expired.ok, true)
    assert.equal(await answer, false)
    assert.deepEqual(api.peekOpenDecisionKinds(), [])
  } finally {
    if (root) await React.act(async () => { root.unmount() })
    dom.restore()
  }
})
