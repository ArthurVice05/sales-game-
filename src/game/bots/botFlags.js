/** Feature flag VITE_SG_BOTS=1. Mesmo contrato de parseVercelDebugFlag. */

export function parseViteSgBotsFlag(raw) {
  return String(raw ?? '') === '1'
}

export function isBotsFeatureEnabled(env = (typeof import.meta !== 'undefined' ? import.meta.env : undefined)) {
  return parseViteSgBotsFlag(env?.VITE_SG_BOTS)
}
