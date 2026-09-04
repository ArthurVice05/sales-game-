/**
 * Aplica payloads de recuperação financeira — única implementação usada
 * por handleInsufficientFunds (produção) e testes stateful.
 */
import { applyDeltas } from '../gameMath.js'
import {
  applyLoanTake,
  buildRecoveryFireDeltas,
  canTakeLoan,
  computeRecoveryFireCredit,
} from '../loanCycle.js'

export function resolveBotActorFromRoster(players, actorId) {
  const id = actorId != null ? String(actorId) : ''
  if (!id || !Array.isArray(players)) return null
  return players.find((p) => p && String(p.id) === id) || null
}

function letterFromOwned(owned) {
  if (owned?.A === true) return 'A'
  if (owned?.B === true) return 'B'
  if (owned?.C === true) return 'C'
  return 'D'
}

function inferMixOwned(player) {
  let mixOwned = { A: false, B: false, C: false, D: false, ...(player.mixOwned || player.mix || {}) }
  const currentMixLevel = String(player.mixProdutos || 'D').toUpperCase()
  if (!mixOwned.A && !mixOwned.B && !mixOwned.C && !mixOwned.D && currentMixLevel) {
    if (currentMixLevel === 'A') mixOwned = { A: true, B: true, C: true, D: true }
    else if (currentMixLevel === 'B') mixOwned = { A: false, B: true, C: true, D: true }
    else if (currentMixLevel === 'C') mixOwned = { A: false, B: false, C: true, D: true }
    else mixOwned = { A: false, B: false, C: false, D: true }
  }
  return mixOwned
}

function inferErpOwned(player) {
  let erpOwned = { A: false, B: false, C: false, D: false, ...(player.erpOwned || player.erp || {}) }
  const currentErpLevel = String(player.erpLevel || player.erpSistemas || 'D').toUpperCase()
  if (!erpOwned.A && !erpOwned.B && !erpOwned.C && !erpOwned.D && currentErpLevel) {
    if (currentErpLevel === 'A') erpOwned = { A: true, B: true, C: true, D: true }
    else if (currentErpLevel === 'B') erpOwned = { A: false, B: true, C: true, D: true }
    else if (currentErpLevel === 'C') erpOwned = { A: false, B: false, C: true, D: true }
    else erpOwned = { A: false, B: false, C: false, D: true }
  }
  return erpOwned
}

function validateReduceSelection(player, sel) {
  if (!sel) return { ok: false, reason: 'no-selection' }
  const level = String(sel.level || '').toUpperCase()
  const group = String(sel.group || '').toUpperCase()
  if (group !== 'MIX' && group !== 'ERP') return { ok: false, reason: 'bad-group' }
  if (!['A', 'B', 'C'].includes(level)) return { ok: false, reason: 'bad-level' }

  const reducedMix = Array.isArray(player.reducedLevels?.MIX) ? player.reducedLevels.MIX : []
  const reducedErp = Array.isArray(player.reducedLevels?.ERP) ? player.reducedLevels.ERP : []
  if (group === 'MIX' && reducedMix.includes(level)) return { ok: false, reason: 'already-reduced' }
  if (group === 'ERP' && reducedErp.includes(level)) return { ok: false, reason: 'already-reduced' }

  const mixLevel = String(player.mixProdutos || 'D').toUpperCase()
  const erpLevel = String(player.erpLevel || player.erpSistemas || 'D').toUpperCase()
  const mixOwned = inferMixOwned(player)
  const erpOwned = inferErpOwned(player)

  if (group === 'MIX') {
    if (mixLevel !== level || level === 'D') return { ok: false, reason: 'not-reducible' }
    if (!mixOwned[level]) return { ok: false, reason: 'not-owned' }
  }
  if (group === 'ERP') {
    if (erpLevel !== level || level === 'D') return { ok: false, reason: 'not-reducible' }
    if (!erpOwned[level]) return { ok: false, reason: 'not-owned' }
  }

  const credit = Number(sel.credit || 0)
  if (!(credit > 0)) return { ok: false, reason: 'no-credit' }
  return { ok: true, level, group, credit }
}

function applyReduceRecoveryToPlayer(player, payload) {
  const selections = (Array.isArray(payload.items) ? payload.items : []).filter(
    (i) => i && i.selected !== false,
  )
  if (!selections.length) return { player, applied: false, type: 'REDUCE', reason: 'no-selection' }

  for (const sel of selections) {
    const v = validateReduceSelection(player, sel)
    if (!v.ok) return { player, applied: false, type: 'REDUCE', reason: v.reason }
  }

  let next = { ...player }
  let mixOwned = inferMixOwned(next)
  let erpOwned = inferErpOwned(next)
  const currentMixLevel = String(next.mixProdutos || 'D').toUpperCase()
  const currentErpLevel = String(next.erpLevel || next.erpSistemas || 'D').toUpperCase()
  let currentMixLevelAfter = currentMixLevel
  let currentErpLevelAfter = currentErpLevel
  let totalCredit = 0
  const reducedMix = [...(Array.isArray(next.reducedLevels?.MIX) ? next.reducedLevels.MIX : [])]
  const reducedErp = [...(Array.isArray(next.reducedLevels?.ERP) ? next.reducedLevels.ERP : [])]

  for (const sel of selections) {
    const level = String(sel.level || '').toUpperCase()
    const group = String(sel.group || '').toUpperCase()
    totalCredit += Number(sel.credit || 0)
    if (group === 'MIX') {
      mixOwned[level] = false
      if (!reducedMix.includes(level)) reducedMix.push(level)
      if (level === currentMixLevelAfter) {
        const levels = ['A', 'B', 'C', 'D']
        const currentIdx = levels.indexOf(currentMixLevelAfter)
        for (let idx = currentIdx + 1; idx < levels.length; idx++) {
          const nextLevel = levels[idx]
          if (mixOwned[nextLevel] || nextLevel === 'D') {
            currentMixLevelAfter = nextLevel
            break
          }
        }
      }
    } else if (group === 'ERP') {
      erpOwned[level] = false
      if (!reducedErp.includes(level)) reducedErp.push(level)
      if (level === currentErpLevelAfter) {
        const levels = ['A', 'B', 'C', 'D']
        const currentIdx = levels.indexOf(currentErpLevelAfter)
        for (let idx = currentIdx + 1; idx < levels.length; idx++) {
          const nextLevel = levels[idx]
          if (erpOwned[nextLevel] || nextLevel === 'D') {
            currentErpLevelAfter = nextLevel
            break
          }
        }
      }
    }
  }

  const finalMixLevel = letterFromOwned(mixOwned) || currentMixLevelAfter || 'D'
  const finalErpLevel = letterFromOwned(erpOwned) || currentErpLevelAfter || 'D'

  next = {
    ...next,
    mixOwned,
    mix: mixOwned,
    erpOwned,
    erp: erpOwned,
    mixProdutos: finalMixLevel,
    erpLevel: finalErpLevel,
    erpSistemas: finalErpLevel,
    mixLevel: finalMixLevel,
    mixProducts: finalMixLevel,
    mixLevelLetter: finalMixLevel,
    erpLevelLetter: finalErpLevel,
    reducedLevels: { MIX: reducedMix, ERP: reducedErp },
    cash: (Number(next.cash) || 0) + totalCredit,
    pos: player.pos,
  }
  return { player: next, applied: true, type: 'REDUCE' }
}

export function applyRecoveryPayloadToPlayer(player, payload, { round = 1 } = {}) {
  if (!player || !payload?.type) return { player, applied: false }
  if (payload.type === 'LOAN') {
    if (!canTakeLoan(player)) {
      return { player, applied: false, reason: 'loan-unavailable', type: 'LOAN' }
    }
    const taken = applyLoanTake(player, payload.amount, round)
    if (!taken.ok) return { player, applied: false, reason: taken.reason, type: 'LOAN' }
    return { player: { ...taken.player, pos: player.pos }, applied: true, type: 'LOAN' }
  }
  if (payload.type === 'FIRE') {
    const { deltas, credit, items } = buildRecoveryFireDeltas(player, payload.items || {})
    const fired = Object.values(items || {}).some((q) => Number(q) > 0)
    if (!fired || !(Number(credit) > 0)) {
      return { player, applied: false, type: 'FIRE', reason: 'no-fire-progress' }
    }
    const hasDelta = Object.entries(deltas || {}).some(([, v]) => Number(v) !== 0)
    if (!hasDelta) {
      return { player, applied: false, type: 'FIRE', reason: 'zero-deltas' }
    }
    const updated = applyDeltas(player, deltas)
    return { player: { ...updated, pos: player.pos }, applied: true, type: 'FIRE' }
  }
  if (payload.type === 'REDUCE') {
    return applyReduceRecoveryToPlayer(player, payload)
  }
  if (payload.type === 'TRIGGER_BANKRUPTCY') {
    return { player, applied: false, type: 'TRIGGER_BANKRUPTCY' }
  }
  return { player, applied: false, type: payload.type }
}

/** Preserva posição ao aplicar sobre roster (produção). */
export function applyRecoveryPayloadToRoster(players, ownerId, payload, opts = {}) {
  const id = String(ownerId)
  const current = (players || []).find((p) => p && String(p.id) === id)
  if (!current) return { players, applied: false }
  const applied = applyRecoveryPayloadToPlayer(current, payload, opts)
  if (!applied.applied) return { players, applied: false, reason: applied.reason }
  const nextPlayers = (players || []).map((p) =>
    String(p?.id) === id ? applied.player : p,
  )
  return { players: nextPlayers, applied: true, player: applied.player }
}

export { validateReduceSelection, computeRecoveryFireCredit }
