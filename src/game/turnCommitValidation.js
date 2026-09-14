/**
 * Validação de commits de turno/lock no snapshot remoto (CAS updater).
 * Regras distintas para auto-pass, handoff normal e LOCK.
 */

import { isBotPlayer } from './bots/botTypes.js'
import { botLeaseExpired, evaluateBotClaimCas } from './bots/botTurnClaim.js'
import { validateHumanTransaction } from './humanTurnTransaction.js'
import { hasUnsettledHumanRevenue, isHumanRevenueDue } from './humanRevenueCredit.js'
import { shouldAllowRemoteAutoPassThroughLock } from './decisionTimeoutPolicy.js'
import { SORTE_REVES_CARDS } from '../modals/sorteRevesDeck.js'

export function inferCommitKind(statePatch = {}) {
  if (statePatch._commitKind) return statePatch._commitKind
  if (statePatch.kind === 'BOT_CLAIM') return 'BOT_CLAIM'
  if (statePatch.kind === 'LOCK') {
    return statePatch.turnLock ? 'LOCK_ACQUIRE' : 'LOCK_RELEASE'
  }
  // Movimento humano: kind PLAYER_DELTA sem _commitKind de bot.
  if (statePatch.kind === 'PLAYER_DELTA') return 'PLAYER_DELTA'
  if (statePatch.kind === 'TURN') {
    if (statePatch.lastAction === 'AUTO_PASS_TIMER') return 'AUTO_PASS'
    if (statePatch._expectTurnPlayerId != null || statePatch._expectTurnSeq != null) {
      return 'NORMAL_HANDOFF'
    }
  }
  if (statePatch.kind === 'ENDGAME') return 'ENDGAME'
  if (statePatch._expectTurnPlayerId != null || statePatch._expectTurnSeq != null) {
    return 'AUTO_PASS'
  }
  return null
}

/**
 * Garante meta CAS em PLAYER_DELTA humano.
 * Preferência: lastRoll (origem do ROLL) > refs atuais do turno.
 * Não sobrescreve BOT_MOVE / BOT_EFFECT.
 */
export function ensurePlayerDeltaCommitMeta(statePatch = {}, ctx = {}) {
  const next = statePatch && typeof statePatch === 'object' ? statePatch : {}
  const commitKind = next._commitKind
  if (commitKind === 'BOT_MOVE' || commitKind === 'BOT_EFFECT' || commitKind === 'BOT_CLAIM' || commitKind === 'HUMAN_REVENUE' || commitKind === 'HUMAN_LUCK') {
    return next
  }
  if (next.kind !== 'PLAYER_DELTA' && commitKind !== 'PLAYER_DELTA') {
    return next
  }

  next._commitKind = commitKind || 'PLAYER_DELTA'

  if (next._expectTurnPlayerId == null) {
    const fromRoll =
      next.lastRoll?.playerId != null
        ? next.lastRoll.playerId
        : ctx.lastRollPlayerId
    const id = fromRoll != null ? fromRoll : ctx.turnPlayerId
    if (id != null && id !== '') next._expectTurnPlayerId = String(id)
  }

  if (next._expectTurnSeq == null) {
    const key =
      next.lastRollTurnKey != null && next.lastRollTurnKey !== ''
        ? next.lastRollTurnKey
        : next.lastRoll?.turnKey != null
          ? next.lastRoll.turnKey
          : ctx.lastRollTurnKey
    const seqRaw = key != null && key !== '' ? Number(key) : Number(ctx.turnSeq)
    if (Number.isFinite(seqRaw)) next._expectTurnSeq = seqRaw
  }

  return next
}

export function isSkipAttemptCommitKind(kind) {
  return kind === 'AUTO_PASS' || kind === 'AUTO_SKIP_OFFLINE'
}

/** Decide confirmação/liberação do sharedTurnSkipGuard — só para tentativas de skip. */
export function resolveSkipGuardAction(statePatch = {}, { casLost = false, commitOk = false } = {}) {
  const kind = inferCommitKind(statePatch)
  if (!isSkipAttemptCommitKind(kind)) return { action: 'none', kind }
  if (casLost || !commitOk) return { action: 'release', kind }
  return { action: 'confirm', kind }
}

function originTurnMatches(prevState, expectTurnId, expectTurnSeq, expectMatchId) {
  if (expectMatchId != null && String(prevState.matchId ?? '') !== String(expectMatchId)) {
    return { ok: false, reason: 'stale-match-id' }
  }
  const remoteTurnId = prevState.turnPlayerId != null ? String(prevState.turnPlayerId) : ''
  const remoteTurnSeq = Number(prevState.turnSeq) || 0
  if (expectTurnId != null && remoteTurnId !== String(expectTurnId)) {
    return { ok: false, reason: 'stale-turn-player' }
  }
  if (expectTurnSeq != null && remoteTurnSeq !== Number(expectTurnSeq)) {
    return { ok: false, reason: 'stale-turn-seq' }
  }
  return { ok: true, reason: 'origin-ok' }
}

function remoteTurnPlayer(prevState) {
  const id = prevState?.turnPlayerId != null ? String(prevState.turnPlayerId) : ''
  return (prevState?.players || []).find((p) => String(p?.id) === id) || null
}

function remoteTurnHasPendingHumanRevenue(prevState) {
  const current = remoteTurnPlayer(prevState)
  if (!current) return false
  return isHumanRevenueDue({
    player: current,
    matchId: prevState?.matchId,
    turnPlayerId: prevState?.turnPlayerId,
    turnSeq: prevState?.turnSeq,
  })
}

function remoteTurnHasPendingHumanLuck(prevState) {
  const current = remoteTurnPlayer(prevState)
  const pending = current?.humanLuckPending
  if (pending) {
    if (pending.paid === true) return false
    if (String(pending.turnPlayerId ?? '') !== String(prevState?.turnPlayerId ?? '')) return false
    if (Number(pending.turnSeq) !== (Number(prevState?.turnSeq) || 0)) return false
    if (
      prevState?.matchId
      && pending.matchId
      && String(pending.matchId) !== String(prevState.matchId)
    ) {
      return false
    }
    return pending.payload?.action === 'APPLY_CARD'
  }

  const effects = current?.humanTurnEffects
  if (!effects || String(effects.landTile || '').toUpperCase() !== 'LUCK') return false
  if (effects.processLandTile === false || !effects.luckCardId) return false
  const fixedCard = SORTE_REVES_CARDS.find((item) => String(item.id) === String(effects.luckCardId))
  if (fixedCard?.kind !== 'SORTE') return false
  if (String(effects.turnPlayerId ?? '') !== String(prevState?.turnPlayerId ?? '')) return false
  if (Number(effects.turnSeq) !== (Number(prevState?.turnSeq) || 0)) return false
  if (prevState?.matchId && effects.matchId && String(effects.matchId) !== String(prevState.matchId)) return false
  const actionId = `hum-luck:${String(prevState?.matchId ?? '')}:${String(prevState?.turnPlayerId ?? '')}:${Number(prevState?.turnSeq) || 0}`
  return !current?.lastActions?.[actionId]
}

/** Defesa no motor: timer nunca avança turno de máquina. */
export function shouldRejectEngineBotTimerAutoPass(turnPlayer, reason) {
  if (reason !== 'AUTO_PASS_TIMER') return null
  if (isBotPlayer(turnPlayer)) {
    return { ok: false, reason: 'bot-turn-managed-by-controller' }
  }
  return null
}

/** Guarda pura: timer humano nunca deve auto-passar turno de máquina. */
export function shouldDisableTimerAutoPassForTurn(players, turnPlayerId) {
  const id = turnPlayerId != null ? String(turnPlayerId) : ''
  if (!id) return false
  const roster = Array.isArray(players) ? players : []
  const current = roster.find((p) => String(p?.id) === id)
  return isBotPlayer(current)
}

/** Interpreta retorno de skipAbsentTurn (boolean ou { ok }). */
export function parseSkipAttemptResult(result) {
  if (result && typeof result === 'object' && 'ok' in result) {
    return result.ok === true
  }
  return !!result
}

function validateNextSeq(statePatch, expectTurnSeq) {
  if (expectTurnSeq == null) return { ok: true, reason: 'no-seq-expect' }
  const proposedSeq = Number(statePatch.turnSeq)
  if (!Number.isFinite(proposedSeq)) return { ok: true, reason: 'no-proposed-seq' }
  if (proposedSeq !== Number(expectTurnSeq) + 1) {
    return { ok: false, reason: 'invalid-next-seq' }
  }
  return { ok: true, reason: 'next-seq-ok' }
}

/**
 * @returns {{ ok: boolean, reason: string }}
 */
export function validateTurnCommit(prevState = {}, statePatch = {}, { now = Date.now() } = {}) {
  const kind = inferCommitKind(statePatch)
  if (!kind) return { ok: true, reason: 'no-guard' }

  const prev = prevState && typeof prevState === 'object' ? prevState : {}
  const expectTurnId =
    statePatch._expectTurnPlayerId != null ? String(statePatch._expectTurnPlayerId) : null
  const expectTurnSeq =
    statePatch._expectTurnSeq != null ? Number(statePatch._expectTurnSeq) : null
  const expectMatchId =
    statePatch._expectMatchId != null ? String(statePatch._expectMatchId) : null

  const origin = originTurnMatches(prev, expectTurnId, expectTurnSeq, expectMatchId)
  if (!origin.ok) return origin
  const human = validateHumanTransaction(prev, statePatch, now)
  if (human && !human.ok) return human

  switch (kind) {
    case 'HUMAN_ROLL_CLAIM':
      return human || { ok: false, reason: 'invalid-human-claim' }
    case 'AUTO_PASS': {
      if (prev.gameOver) return { ok: false, reason: 'game-over' }
      if (remoteTurnHasPendingHumanRevenue(prev)) {
        return { ok: false, reason: 'human-revenue-pending' }
      }
      if (remoteTurnHasPendingHumanLuck(prev)) {
        return { ok: false, reason: 'human-luck-pending' }
      }
      if (isBotPlayer(remoteTurnPlayer(prev))) {
        return { ok: false, reason: 'bot-timer-auto-pass' }
      }

      const lrk = prev.lastRollTurnKey
      const alreadyRolled =
        lrk != null && expectTurnSeq != null && String(lrk) === String(expectTurnSeq)

      if (prev.turnLock) {
        // Animação/pré-roll: nunca atravessar.
        if (!alreadyRolled) return { ok: false, reason: 'turn-locked' }
        // Pós-roll com compra opcional aberta: coordinator pode forçar handoff.
        const through = shouldAllowRemoteAutoPassThroughLock({
          turnLock: true,
          decisionHold: prev.decisionHold || null,
          expectedTurnPlayerId: expectTurnId,
          expectedTurnSeq: expectTurnSeq,
        })
        if (!through.ok) return { ok: false, reason: through.reason || 'turn-locked' }
      } else if (alreadyRolled) {
        // Sem modal/lock: avanço pós-roll é pelo tick, não por AUTO_PASS.
        return { ok: false, reason: 'already-rolled' }
      }

      const deadlineRaw = prev.turnDeadlineAt
      if (deadlineRaw == null || !Number.isFinite(Number(deadlineRaw))) {
        return { ok: false, reason: 'no-deadline' }
      }
      const deadline = Number(deadlineRaw)
      const t = Number.isFinite(Number(now)) ? Number(now) : Date.now()
      if (t < deadline) return { ok: false, reason: 'not-expired' }
      const seqCheck = validateNextSeq(statePatch, expectTurnSeq)
      if (!seqCheck.ok) return seqCheck
      return {
        ok: true,
        reason: prev.turnLock ? 'auto-pass-optional-expire' : 'auto-pass-ok',
      }
    }

    case 'AUTO_SKIP_OFFLINE': {
      if (prev.gameOver) return { ok: false, reason: 'game-over' }
      if (remoteTurnHasPendingHumanRevenue(prev)) {
        return { ok: false, reason: 'human-revenue-pending' }
      }
      if (remoteTurnHasPendingHumanLuck(prev)) {
        return { ok: false, reason: 'human-luck-pending' }
      }
      if (isBotPlayer(remoteTurnPlayer(prev))) {
        return { ok: false, reason: 'bot-presence-skip' }
      }
      if (prev.turnLock) return { ok: false, reason: 'turn-locked' }
      const lrk = prev.lastRollTurnKey
      if (lrk != null && expectTurnSeq != null && String(lrk) === String(expectTurnSeq)) {
        return { ok: false, reason: 'already-rolled' }
      }
      const seqCheck = validateNextSeq(statePatch, expectTurnSeq)
      if (!seqCheck.ok) return seqCheck
      return { ok: true, reason: 'auto-skip-offline-ok' }
    }

    case 'NORMAL_HANDOFF': {
      if (prev.gameOver) return { ok: false, reason: 'game-over' }
      if (remoteTurnHasPendingHumanRevenue(prev)) {
        return { ok: false, reason: 'human-revenue-pending' }
      }
      if (remoteTurnHasPendingHumanLuck(prev)) {
        return { ok: false, reason: 'human-luck-pending' }
      }
      const seqCheck = validateNextSeq(statePatch, expectTurnSeq)
      if (!seqCheck.ok) return seqCheck
      return { ok: true, reason: 'normal-handoff-ok' }
    }

    case 'ENDGAME': {
      if (prev.gameOver) return { ok: false, reason: 'game-over' }
      if (hasUnsettledHumanRevenue(prev)) {
        return { ok: false, reason: 'human-revenue-pending' }
      }
      return { ok: true, reason: 'endgame-ok' }
    }

    case 'LOCK_RELEASE': {
      if (!prev.turnLock) return { ok: true, reason: 'already-unlocked' }
      const expectOwner =
        statePatch._expectLockOwner != null ? String(statePatch._expectLockOwner) : null
      const remoteOwner = prev.lockOwner != null ? String(prev.lockOwner) : ''
      // Sem dono esperado não pode apagar lock remoto ativo de outro contexto.
      if (!expectOwner && remoteOwner) {
        return { ok: false, reason: 'lock-owner-unknown' }
      }
      if (expectOwner && remoteOwner && remoteOwner !== expectOwner) {
        return { ok: false, reason: 'lock-owner-mismatch' }
      }
      return { ok: true, reason: 'lock-release-ok' }
    }

    case 'BOT_CLAIM': {
      if (prev.gameOver) return { ok: false, reason: 'game-over' }
      const current = remoteTurnPlayer(prev)
      const expectedKey = statePatch.botTurnKey
      const claim = {
        matchId: expectMatchId ?? statePatch.matchId,
        turnPlayerId: expectTurnId ?? statePatch.turnPlayerId,
        turnSeq: expectTurnSeq ?? statePatch.turnSeq,
        lockOwner: statePatch.lockOwner,
        executorId: statePatch.botClaimExecutor,
        currentPlayer: current,
        seed: statePatch.botTurnSeed,
        botTurnKey: expectedKey,
        releaseExpectedOwner: statePatch._expectLockOwner,
      }
      const cas = evaluateBotClaimCas({
        remote: { ...prev, currentPlayer: current },
        claim,
        now,
      })
      if (!cas.ok) return { ok: false, reason: cas.reason }
      return { ok: true, reason: 'bot-claim-ok' }
    }

    case 'BOT_MOVE':
    case 'BOT_EFFECT': {
      if (prev.gameOver) return { ok: false, reason: 'game-over' }
      const current = remoteTurnPlayer(prev)
      if (!isBotPlayer(current)) return { ok: false, reason: 'not-bot-turn' }
      const expectOwner =
        statePatch._expectLockOwner != null ? String(statePatch._expectLockOwner) : null
      const remoteOwner = prev.lockOwner != null ? String(prev.lockOwner) : ''
      if (expectOwner && remoteOwner && remoteOwner !== expectOwner) {
        return { ok: false, reason: 'lock-owner-mismatch' }
      }
      if (kind === 'BOT_EFFECT') {
        const expectExec =
          statePatch._expectBotExecutor != null ? String(statePatch._expectBotExecutor) : null
        const remoteExec =
          prev.botClaimExecutor != null ? String(prev.botClaimExecutor) : ''
        if (expectExec && remoteExec && remoteExec !== expectExec) {
          return { ok: false, reason: 'executor-mismatch' }
        }
      }
      return { ok: true, reason: kind === 'BOT_EFFECT' ? 'bot-effect-ok' : 'bot-move-ok' }
    }

    case 'LOCK_ACQUIRE': {
      if (prev.gameOver) return { ok: false, reason: 'game-over' }
      if (prev.turnLock) {
        const remoteOwner = prev.lockOwner != null ? String(prev.lockOwner) : ''
        const nextOwner =
          statePatch.lockOwner != null ? String(statePatch.lockOwner) : ''
        if (remoteOwner && nextOwner && remoteOwner !== nextOwner) {
          return { ok: false, reason: 'already-locked-by-other' }
        }
      }
      return { ok: true, reason: 'lock-acquire-ok' }
    }

    case 'HUMAN_MOVE':
    case 'HUMAN_REVENUE':
    case 'HUMAN_LUCK':
    case 'PLAYER_DELTA': {
      if (prev.gameOver) return { ok: false, reason: 'game-over' }
      if (expectTurnId == null || expectTurnSeq == null || !Number.isFinite(expectTurnSeq)) {
        return { ok: false, reason: 'player-delta-missing-expect' }
      }
      if (kind === 'HUMAN_LUCK') {
        const actor = remoteTurnPlayer(prev)
        if (!actor || String(actor.id) !== String(expectTurnId)) {
          return { ok: false, reason: 'human-luck-wrong-player' }
        }
        return { ok: true, reason: 'human-luck-ok' }
      }
      if (kind === 'HUMAN_REVENUE') {
        const actor = remoteTurnPlayer(prev)
        if (!actor || String(actor.id) !== String(expectTurnId)) {
          return { ok: false, reason: 'human-revenue-wrong-player' }
        }
        const effects = actor.humanTurnEffects
        if (
          effects &&
          typeof effects === 'object' &&
          Number(effects.turnSeq) !== Number(expectTurnSeq)
        ) {
          // Plano já substituído por jogada posterior — nunca recredita identidade antiga.
          return { ok: false, reason: 'human-revenue-stale-plan' }
        }
        const due = isHumanRevenueDue({
          player: actor,
          matchId: expectMatchId ?? prev.matchId,
          turnPlayerId: expectTurnId,
          turnSeq: expectTurnSeq,
        })
        if (!due) {
          // Já pago (lastActions ou done) → idempotente; sem crossedStart → não devido.
          if (effects?.crossedStart === true) {
            return { ok: true, reason: 'human-revenue-already-paid' }
          }
          return { ok: false, reason: 'human-revenue-not-due' }
        }
      }
      return { ok: true, reason: kind === 'HUMAN_REVENUE' ? 'human-revenue-ok' : kind === 'HUMAN_LUCK' ? 'human-luck-ok' : 'player-delta-ok' }
    }

    default:
      return { ok: true, reason: 'unknown-kind' }
  }
}

/** Barreira final do hook após awaits assíncronos. */
export function shouldProceedTimerAutoPassAfterAwait({
  now,
  turnDeadlineAt,
  turnLock,
  gameOver,
  capturedTurnPlayerId,
  capturedTurnSeq,
  currentTurnPlayerId,
  currentTurnSeq,
  lastAttemptKey,
  inFlight = false,
  amCoordinator = true,
  decisionHold = null,
} = {}) {
  const curId = currentTurnPlayerId != null ? String(currentTurnPlayerId) : ''
  const capId = capturedTurnPlayerId != null ? String(capturedTurnPlayerId) : ''
  if (curId !== capId) return { ok: false, reason: 'turn-changed' }
  if ((Number(currentTurnSeq) || 0) !== (Number(capturedTurnSeq) || 0)) {
    return { ok: false, reason: 'seq-changed' }
  }
  if (gameOver) return { ok: false, reason: 'game-over' }
  if (turnLock) {
    const through = shouldAllowRemoteAutoPassThroughLock({
      turnLock: true,
      decisionHold,
      expectedTurnPlayerId: capturedTurnPlayerId,
      expectedTurnSeq: capturedTurnSeq,
    })
    if (!through.ok) return { ok: false, reason: through.reason || 'turn-locked' }
  }

  const deadlineRaw = turnDeadlineAt
  if (deadlineRaw == null || !Number.isFinite(Number(deadlineRaw))) {
    return { ok: false, reason: 'no-deadline' }
  }
  const deadline = Number(deadlineRaw)
  const t = Number.isFinite(Number(now)) ? Number(now) : Date.now()
  if (t < deadline) return { ok: false, reason: 'not-expired' }

  if (!amCoordinator) return { ok: false, reason: 'not-coordinator' }
  if (inFlight) return { ok: false, reason: 'in-flight' }

  const key = `${capId}|${Number(capturedTurnSeq) || 0}`
  if (lastAttemptKey != null && String(lastAttemptKey) === key) {
    return { ok: false, reason: 'already-attempted' }
  }

  return { ok: true, reason: 'proceed', attemptKey: key }
}

export function stripCommitMeta(statePatch = {}) {
  const {
    _expectTurnPlayerId: _e1,
    _expectTurnSeq: _e2,
    _expectLockOwner: _e3,
    _commitKind: _e4,
    _expectMatchId: _e5,
    _expectBotExecutor: _e6,
    _expectHumanRollId: _e7,
    _luckPayload: _e8,
    _luckSkipNegativeCash: _e9,
    _luckFrozenCashDelta: _e10,
    _luckPendingOnly: _e11,
    ...publicPatch
  } = statePatch || {}
  return publicPatch
}

/** Caminho real de broadcastState: encaminha expectativas de CAS sem inventar valores. */
export function applyBroadcastCommitExpect(statePatch = {}, patch = {}) {
  const next = statePatch && typeof statePatch === 'object' ? statePatch : {}
  const src = patch && typeof patch === 'object' ? patch : {}
  if (src._expectTurnPlayerId !== undefined) next._expectTurnPlayerId = src._expectTurnPlayerId
  if (src._expectTurnSeq !== undefined) next._expectTurnSeq = src._expectTurnSeq
  if (src._expectLockOwner !== undefined) next._expectLockOwner = src._expectLockOwner
  if (src._expectMatchId !== undefined) next._expectMatchId = src._expectMatchId
  if (src._expectBotExecutor !== undefined) next._expectBotExecutor = src._expectBotExecutor
  if (src._commitKind !== undefined) next._commitKind = src._commitKind
  if (src._expectHumanRollId !== undefined) next._expectHumanRollId = src._expectHumanRollId
  if (src._luckPayload !== undefined) next._luckPayload = src._luckPayload
  if (src._luckSkipNegativeCash !== undefined) next._luckSkipNegativeCash = src._luckSkipNegativeCash
  if (src._luckFrozenCashDelta !== undefined) next._luckFrozenCashDelta = src._luckFrozenCashDelta
  if (src._luckPendingOnly !== undefined) next._luckPendingOnly = src._luckPendingOnly
  return next
}
