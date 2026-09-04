export const BOT_CONTROLLER = 'BOT'
export const BOT_DIFFICULTY_STRATEGIC = 'strategic'
export const BOT_POLICY_VERSION = 1
export const BOT_MAX_PLAYERS = 4
export const BOT_LEASE_MS = 12_000
export const BOT_LEASE_HEARTBEAT_MS = 3_000
export const BOT_THINK_MIN_MS = 600
export const BOT_THINK_MAX_MS = 1200

export const PRESENCE_LOAD_STATE = Object.freeze({
  LOADING: 'loading',
  READY: 'ready',
  ERROR: 'error',
})

export function isBotPlayer(player) {
  if (!player || typeof player !== 'object') return false
  if (player.isBot === true) return true
  if (String(player.controller || '') === BOT_CONTROLLER) return true
  return false
}

export function botPlayerId(matchId, slot) {
  return `bot:${String(matchId)}:${Number(slot)}`
}

export function botTurnKey(matchId, botId, turnSeq) {
  return `${String(matchId)}|${String(botId)}|${Number(turnSeq) || 0}`
}

export function botActionKey(turnKey, phase) {
  return `${String(turnKey)}:${String(phase || 'ACT')}`
}
