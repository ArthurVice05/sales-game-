import assert from 'node:assert/strict'
import test from 'node:test'

import { collectClientEnvironment } from '../clientEnvironment.js'

function windowFor(overrides = {}) {
  const values = new Map()
  return {
    innerWidth: 1280,
    innerHeight: 720,
    devicePixelRatio: 1,
    screen: { width: 1920, height: 1080 },
    sessionStorage: {
      getItem: (key) => values.get(key) || null,
      setItem: (key, value) => values.set(key, value),
    },
    matchMedia: () => ({ matches: false }),
    ...overrides,
  }
}

const ENV = { VITE_APP_VERSION: '2.4.0', VITE_VERCEL_GIT_COMMIT_SHA: 'abc123' }

test('distingue navegador mobile de app Android WebView', () => {
  const mobile = collectClientEnvironment({
    windowLike: windowFor(),
    navigatorLike: { userAgent: 'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 Chrome/126.0 Mobile Safari/537.36' },
    env: ENV,
  })
  assert.equal(mobile.clientType, 'web_mobile')
  assert.equal(mobile.runtime, 'browser')
  assert.equal(mobile.clientVersion, '2.4.0')

  const app = collectClientEnvironment({
    windowLike: windowFor(),
    navigatorLike: { userAgent: 'Mozilla/5.0 (Linux; Android 14; Pixel 8 Build/UQ1A; wv) AppleWebKit/537.36 Version/4.0 Chrome/126.0 Mobile Safari/537.36 SalesGameApp/3.7.1' },
    env: ENV,
  })
  assert.equal(app.clientType, 'app')
  assert.equal(app.runtime, 'android_webview')
  assert.equal(app.clientVersion, '3.7.1')
})

test('reconhece bridge nativa e versão injetada pelo app', () => {
  const win = windowFor({
    Capacitor: { isNativePlatform: () => true },
    __SALES_GAME_APP_VERSION__: '4.0.2+91',
  })
  const info = collectClientEnvironment({
    windowLike: win,
    navigatorLike: { userAgent: 'Mozilla/5.0 (Linux; Android 15)' },
    env: ENV,
  })
  assert.equal(info.clientType, 'app')
  assert.equal(info.runtime, 'capacitor')
  assert.equal(info.appVersion, '4.0.2+91')
})

test('PWA instalada é app, enquanto Chrome no Windows é web desktop', () => {
  const pwa = collectClientEnvironment({
    windowLike: windowFor({ matchMedia: () => ({ matches: true }) }),
    navigatorLike: { userAgent: 'Mozilla/5.0 (iPhone) AppleWebKit/605.1.15 Mobile/15E148 Safari/604.1' },
    env: ENV,
  })
  assert.equal(pwa.clientType, 'app')
  assert.equal(pwa.runtime, 'pwa_standalone')
  assert.equal(pwa.clientVersion, 'unknown')

  const desktop = collectClientEnvironment({
    windowLike: windowFor(),
    navigatorLike: { userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/126.0 Safari/537.36' },
    env: ENV,
  })
  assert.equal(desktop.clientType, 'web_desktop')
  assert.equal(desktop.platform, 'windows')
  assert.equal(desktop.browser, 'chrome')
})

test('Chrome no iOS continua web mobile e TWA Android é app', () => {
  const iosChrome = collectClientEnvironment({
    windowLike: windowFor(),
    navigatorLike: { userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 CriOS/126.0.0.0 Mobile/15E148' },
    env: ENV,
  })
  assert.equal(iosChrome.clientType, 'web_mobile')
  assert.equal(iosChrome.runtime, 'browser')

  const twa = collectClientEnvironment({
    windowLike: windowFor({ document: { referrer: 'android-app://com.salesgame.app/' } }),
    navigatorLike: { userAgent: 'Mozilla/5.0 (Linux; Android 14) Chrome/126.0 Mobile Safari/537.36' },
    env: ENV,
  })
  assert.equal(twa.clientType, 'app')
  assert.equal(twa.runtime, 'trusted_web_activity')
})

test('mantém um identificador estável durante a mesma sessão da aba', () => {
  const win = windowFor()
  const first = collectClientEnvironment({ windowLike: win, navigatorLike: {}, env: ENV })
  const second = collectClientEnvironment({ windowLike: win, navigatorLike: {}, env: ENV })
  assert.equal(first.sessionId, second.sessionId)
})
