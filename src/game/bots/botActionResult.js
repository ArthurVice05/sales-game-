import { shouldRunBotPhase, isObsoleteBotRollReason } from './botTurnClaim.js'

/** undefined / valor sem ok:true nunca conta como sucesso. */
export function normalizeExplicitResult(value) {
  if (value && typeof value === 'object' && value.ok === true) {
    return { ok: true }
  }
  if (value && typeof value === 'object' && value.ok === false) {
    return {
      ok: false,
      reason: value.reason != null ? String(value.reason) : 'rejected',
      retry: value.retry,
    }
  }
  return { ok: false, reason: 'undefined-result' }
}

export async function awaitBotRollStart(onBotRoll, payload) {
  if (typeof onBotRoll !== 'function') {
    return { ok: false, reason: 'no-onBotRoll' }
  }
  try {
    const raw = await Promise.resolve(onBotRoll(payload))
    return normalizeExplicitResult(raw)
  } catch {
    return { ok: false, reason: 'onBotRoll-threw' }
  }
}

/**
 * Marca a fase só depois de ok === true.
 * Falha transitória: chave não entra; retry permitido.
 * Motivo obsoleto: chave não entra; caller encerra a geração.
 */
export async function runBotRollAttempt({
  executedKeys = [],
  turnKey,
  phase = 'ROLL',
  onBotRoll,
  payload,
} = {}) {
  const gate = shouldRunBotPhase({ executedKeys, turnKey, phase })
  if (!gate.run) {
    return {
      executedKeys: [...executedKeys],
      result: { ok: false, reason: gate.reason },
      marked: false,
      retry: false,
      obsolete: false,
    }
  }
  const result = await awaitBotRollStart(onBotRoll, payload)
  if (result.ok === true) {
    return {
      executedKeys: [...executedKeys, gate.key],
      result,
      marked: true,
      retry: false,
      obsolete: false,
      key: gate.key,
    }
  }
  const obsolete = isObsoleteBotRollReason(result.reason)
  const retry = obsolete ? false : result.retry !== false
  return {
    executedKeys: [...executedKeys],
    result,
    marked: false,
    retry,
    obsolete,
    key: gate.key,
  }
}

export function wrapOnActionRoll(raw) {
  return Promise.resolve(raw).then(normalizeExplicitResult)
}
