import { createInitialPlayerState } from '../createInitialPlayer.js'
import {
  BOT_CONTROLLER,
  BOT_DIFFICULTY_STRATEGIC,
  BOT_MAX_PLAYERS,
  BOT_POLICY_VERSION,
  botPlayerId,
  isBotPlayer,
} from './botTypes.js'
import { isBotsFeatureEnabled } from './botFlags.js'

export function normalizeBotConfig(raw = {}, { botsEnabled = true } = {}) {
  if (!botsEnabled) {
    return {
      count: 0,
      difficulty: BOT_DIFFICULTY_STRATEGIC,
      policyVersion: BOT_POLICY_VERSION,
    }
  }
  const count = Math.max(0, Math.min(3, Math.floor(Number(raw?.count) || 0)))
  const difficulty = raw?.difficulty === BOT_DIFFICULTY_STRATEGIC
    ? BOT_DIFFICULTY_STRATEGIC
    : BOT_DIFFICULTY_STRATEGIC
  const policyVersion = Number.isFinite(Number(raw?.policyVersion))
    ? Math.max(1, Math.floor(Number(raw.policyVersion)))
    : BOT_POLICY_VERSION
  return { count, difficulty, policyVersion }
}

export function effectiveBotCount({
  humanCount,
  requestedCount,
  maxPlayers = BOT_MAX_PLAYERS,
  botsEnabled = true,
} = {}) {
  if (!botsEnabled) return 0
  const humans = Math.max(0, Math.floor(Number(humanCount) || 0))
  const max = Math.max(1, Math.floor(Number(maxPlayers) || BOT_MAX_PLAYERS))
  const requested = Math.max(0, Math.floor(Number(requestedCount) || 0))
  if (humans <= 0) return 0
  const slots = Math.max(0, max - humans)
  return Math.min(requested, slots, 3)
}

/** Máximo de máquinas selecionáveis com N humanos presentes (prioridade humana). */
export function maxBotCountForHumans(humanCount, maxPlayers = BOT_MAX_PLAYERS) {
  const humans = Math.max(0, Math.floor(Number(humanCount) || 0))
  const max = Math.max(1, Math.floor(Number(maxPlayers) || BOT_MAX_PLAYERS))
  return Math.max(0, Math.min(3, max - humans))
}

export function lobbyStartGate({
  humans = [],
  botCount = 0,
  botsEnabled = true,
  amHost = false,
  lobbyOpen = true,
} = {}) {
  const list = Array.isArray(humans) ? humans : []
  const humanCount = list.length
  const effective = effectiveBotCount({
    humanCount,
    requestedCount: botCount,
    botsEnabled,
  })
  if (!amHost || !lobbyOpen) {
    return { canStart: false, effectiveBotCount: effective, reason: 'not-host-or-closed' }
  }
  if (humanCount < 1) {
    return { canStart: false, effectiveBotCount: 0, reason: 'no-humans' }
  }
  const allHumansReady = list.every((p) => !!p.ready)
  if (!allHumansReady) {
    return { canStart: false, effectiveBotCount: effective, reason: 'humans-not-ready' }
  }
  if (effective === 0) {
    return { canStart: true, effectiveBotCount: 0, reason: 'human-only' }
  }
  const totalParticipants = humanCount + effective
  if (totalParticipants < 2) {
    return { canStart: false, effectiveBotCount: effective, reason: 'min-participants' }
  }
  return { canStart: true, effectiveBotCount: effective, reason: 'ok' }
}

export function buildBotPlayers({
  matchId,
  count,
  startSeat,
  difficulty = BOT_DIFFICULTY_STRATEGIC,
  policyVersion = BOT_POLICY_VERSION,
} = {}) {
  const n = Math.max(0, Math.floor(Number(count) || 0))
  const seat0 = Math.max(0, Math.floor(Number(startSeat) || 0))
  const bots = []
  for (let slot = 0; slot < n; slot++) {
    const seat = seat0 + slot
    bots.push(
      createInitialPlayerState({
        id: botPlayerId(matchId, slot),
        name: `Máquina ${slot + 1}`,
        seat,
        joinOrder: seat,
        extras: {
          isBot: true,
          controller: BOT_CONTROLLER,
          botDifficulty: difficulty,
          botPolicyVersion: policyVersion,
          botSlot: slot,
        },
      })
    )
  }
  return bots
}

/**
 * Humanos na ordem já usada pelo projeto; máquinas nos assentos restantes.
 */
export function assembleMatchRoster({
  humans = [],
  matchId,
  botCount = 0,
  maxPlayers = BOT_MAX_PLAYERS,
  botsEnabled = true,
  difficulty = BOT_DIFFICULTY_STRATEGIC,
  policyVersion = BOT_POLICY_VERSION,
} = {}) {
  const nBots = effectiveBotCount({
    humanCount: Array.isArray(humans) ? humans.length : 0,
    requestedCount: botCount,
    maxPlayers,
    botsEnabled,
  })
  const humanPlayers = Array.isArray(humans) ? [...humans] : []
  if (nBots === 0) return humanPlayers
  const bots = buildBotPlayers({
    matchId,
    count: nBots,
    startSeat: humanPlayers.length,
    difficulty,
    policyVersion,
  })
  return [...humanPlayers, ...bots]
}

export function mergeBotConfigIntoRoomState(prevState = {}, nextBotConfig, { botsEnabled } = {}) {
  const enabled = botsEnabled != null ? botsEnabled : isBotsFeatureEnabled()
  const prev = prevState && typeof prevState === 'object' ? prevState : {}
  const merged = normalizeBotConfig(
    { ...(prev.botConfig || {}), ...(nextBotConfig || {}) },
    { botsEnabled: enabled }
  )
  return {
    ...prev,
    botConfig: merged,
  }
}

export function botsNeverTouchLobbyPlayers(lobbyPlayers, roster) {
  const lobbyIds = new Set((lobbyPlayers || []).map((p) => String(p.player_id ?? p.id)))
  const bots = (roster || []).filter(isBotPlayer)
  return bots.every((b) => !lobbyIds.has(String(b.id)))
}
