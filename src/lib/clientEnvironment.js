const SESSION_KEY = 'SG_CLIENT_SESSION_ID'

function safeText(value, max = 300) {
  return value == null ? '' : String(value).trim().slice(0, max)
}

function newSessionId(cryptoLike) {
  return cryptoLike?.randomUUID?.()
    || `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`
}

export function getClientSessionId(windowLike = globalThis.window) {
  try {
    const stored = windowLike?.sessionStorage?.getItem(SESSION_KEY)
    if (stored) return safeText(stored, 100)
    const created = newSessionId(globalThis.crypto)
    windowLike?.sessionStorage?.setItem(SESSION_KEY, created)
    return created
  } catch {
    return newSessionId(globalThis.crypto)
  }
}

function detectPlatform(userAgent, navigatorLike) {
  const ua = userAgent.toLowerCase()
  const platform = safeText(navigatorLike?.userAgentData?.platform || navigatorLike?.platform, 80).toLowerCase()
  if (/android/.test(ua) || /android/.test(platform)) return 'android'
  if (/iphone|ipad|ipod/.test(ua) || /iphone|ipad|ipod/.test(platform)) return 'ios'
  if (platform === 'macintel' && Number(navigatorLike?.maxTouchPoints) > 1) return 'ios'
  if (/windows/.test(ua) || /win/.test(platform)) return 'windows'
  if (/mac os|macintosh/.test(ua) || /mac/.test(platform)) return 'macos'
  if (/linux/.test(ua) || /linux/.test(platform)) return 'linux'
  return 'other'
}

function detectBrowser(userAgent, runtime) {
  if (runtime !== 'browser') return 'webview'
  if (/edg\//i.test(userAgent)) return 'edge'
  if (/firefox\//i.test(userAgent)) return 'firefox'
  if (/crios\//i.test(userAgent)) return 'chrome'
  if (/chrome\//i.test(userAgent)) return 'chrome'
  if (/safari\//i.test(userAgent)) return 'safari'
  return 'other'
}

function injectedAppVersion(windowLike, userAgent) {
  const explicit = safeText(
    windowLike?.__SALES_GAME_APP_VERSION__
      || windowLike?.__APP_VERSION__
      || windowLike?.SalesGameApp?.version,
    100,
  )
  if (explicit) return explicit
  const match = userAgent.match(/(?:SalesGameApp|SalesGame)[\s/]([0-9][0-9A-Za-z._+-]*)/i)
  return safeText(match?.[1], 100)
}

/**
 * Identifica o canal real do cliente. "mobile" aqui significa navegador web
 * móvel; WebView/bridge/PWA instalada são classificados separadamente como app.
 */
export function collectClientEnvironment(options = {}) {
  const windowLike = options.windowLike ?? globalThis.window
  const navigatorLike = options.navigatorLike ?? windowLike?.navigator ?? globalThis.navigator
  const env = options.env ?? import.meta.env ?? {}
  const userAgent = safeText(options.userAgent ?? navigatorLike?.userAgent, 500)
  const explicitType = safeText(windowLike?.__SALES_GAME_CLIENT_TYPE__, 30).toLowerCase()
  const capacitorNative = !!windowLike?.Capacitor?.isNativePlatform?.()
  const hasNativeBridge = capacitorNative || !!windowLike?.cordova || !!windowLike?.ReactNativeWebView
  const androidWebView = /;\s*wv\)/i.test(userAgent)
    || (/Android/i.test(userAgent) && /Version\/\d/i.test(userAgent) && /Chrome\//i.test(userAgent))
  const iosWebView = /iPhone|iPad|iPod/i.test(userAgent)
    && !/Safari\/|CriOS\/|FxiOS\/|EdgiOS\/|OPiOS\/|DuckDuckGo\//i.test(userAgent)
  const trustedWebActivity = /^android-app:\/\//i.test(safeText(windowLike?.document?.referrer, 500))
  const standalone = !!windowLike?.matchMedia?.('(display-mode: standalone)')?.matches
    || navigatorLike?.standalone === true

  let runtime = 'browser'
  if (capacitorNative) runtime = 'capacitor'
  else if (windowLike?.cordova) runtime = 'cordova'
  else if (windowLike?.ReactNativeWebView) runtime = 'react_native_webview'
  else if (androidWebView) runtime = 'android_webview'
  else if (iosWebView) runtime = 'ios_webview'
  else if (trustedWebActivity) runtime = 'trusted_web_activity'
  else if (standalone) runtime = 'pwa_standalone'

  const isApp = explicitType === 'app' || hasNativeBridge || androidWebView || iosWebView || trustedWebActivity || standalone
  const isMobileWeb = !isApp && (
    explicitType === 'web_mobile'
    || navigatorLike?.userAgentData?.mobile === true
    || /Android|iPhone|iPad|iPod|Mobile/i.test(userAgent)
  )
  const clientType = isApp ? 'app' : isMobileWeb ? 'web_mobile' : 'web_desktop'
  const compiledBuildVersion = typeof __SALES_GAME_BUILD_VERSION__ !== 'undefined'
    ? safeText(__SALES_GAME_BUILD_VERSION__, 100)
    : ''
  const releaseSha = safeText(env.VITE_VERCEL_GIT_COMMIT_SHA, 100)
    || (/^[0-9a-f]{7,40}$/i.test(compiledBuildVersion) ? compiledBuildVersion : '')
    || null
  const webVersion = safeText(env.VITE_APP_VERSION, 100) || compiledBuildVersion || releaseSha
  const appVersion = injectedAppVersion(windowLike, userAgent)
  const clientVersion = clientType === 'app' ? (appVersion || 'unknown') : (webVersion || 'unknown')

  return {
    schemaVersion: 1,
    clientType,
    runtime,
    platform: detectPlatform(userAgent, navigatorLike),
    browser: detectBrowser(userAgent, runtime),
    clientVersion,
    appVersion: appVersion || null,
    webVersion: webVersion || null,
    releaseSha,
    sessionId: getClientSessionId(windowLike),
    userAgent,
    viewport: {
      width: Number(windowLike?.innerWidth) || null,
      height: Number(windowLike?.innerHeight) || null,
    },
    screen: {
      width: Number(windowLike?.screen?.width) || null,
      height: Number(windowLike?.screen?.height) || null,
      pixelRatio: Number(windowLike?.devicePixelRatio) || null,
    },
  }
}

export function clientEnvironmentColumns(clientInfo = collectClientEnvironment()) {
  return {
    client_type: clientInfo.clientType,
    client_version: clientInfo.clientVersion,
    client_session_id: clientInfo.sessionId,
    client_info: clientInfo,
    client_updated_at: new Date().toISOString(),
  }
}
