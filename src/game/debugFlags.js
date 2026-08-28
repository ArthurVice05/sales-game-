/**
 * Flags de debug — Vercel: VITE_SG_DEBUG_LOGS=1 liga logs em produção.
 * Dev local: ainda exige localStorage SG_DEBUG_LOGS=1 (evita spam).
 */

export function parseVercelDebugFlag(raw) {
  return String(raw || '') === '1'
}

export function isVercelDebugEnabled() {
  return parseVercelDebugFlag(import.meta.env?.VITE_SG_DEBUG_LOGS)
}

export function isDebugLogsEnabled() {
  if (isVercelDebugEnabled()) return true
  if (!import.meta.env.DEV) return false
  try {
    return typeof localStorage !== 'undefined' && localStorage.getItem('SG_DEBUG_LOGS') === '1'
  } catch {
    return false
  }
}

export function isDevVerbose() {
  return !!import.meta.env.DEV || isVercelDebugEnabled()
}
