/**
 * Barreira autoritativa do movimento da máquina.
 * roll-accepted local ≠ posição persistida. Handoff só após CONFIRMED.
 */

export const BOT_MOVE_IDLE = 'idle'
export const BOT_MOVE_PENDING = 'pending'
export const BOT_MOVE_CONFIRMED = 'confirmed'
export const BOT_MOVE_FAILED = 'failed'

let liveBarrier = null

export function setLiveBotMoveBarrier(barrier) {
  liveBarrier = barrier || null
  return liveBarrier
}

export function getLiveBotMoveBarrier() {
  return liveBarrier
}

export function buildBotMoveActionId({
  matchId,
  turnPlayerId,
  turnSeq,
  executorId,
} = {}) {
  return `bot-move:${String(matchId ?? '')}:${String(turnPlayerId ?? '')}:${Number(turnSeq) || 0}:${String(executorId ?? '')}`
}

export function createBotMoveBarrier({
  actionId,
  steps,
  fromPos,
  toPos,
  playerId,
  turnSeq,
  matchId,
  executorId,
  delta = null,
  lastRollTurnKey = null,
} = {}) {
  return {
    status: BOT_MOVE_PENDING,
    actionId: String(actionId || ''),
    steps: Number(steps) || 0,
    fromPos: Number(fromPos),
    toPos: Number(toPos),
    playerId: playerId != null ? String(playerId) : '',
    turnSeq: Number(turnSeq) || 0,
    matchId: matchId != null ? String(matchId) : '',
    executorId: executorId != null ? String(executorId) : '',
    delta: delta && typeof delta === 'object' ? delta : null,
    lastRollTurnKey: lastRollTurnKey != null ? String(lastRollTurnKey) : null,
    localApplied: 1,
    persistAttempts: 0,
    reason: null,
  }
}

export function markBotMoveConfirmed(barrier) {
  if (!barrier) return barrier
  return { ...barrier, status: BOT_MOVE_CONFIRMED, reason: null }
}

export function markBotMoveFailed(barrier, reason) {
  if (!barrier) return barrier
  return { ...barrier, status: BOT_MOVE_FAILED, reason: reason || 'bot-move-rejected' }
}

export function bumpBotMovePersistAttempt(barrier) {
  if (!barrier) return barrier
  return { ...barrier, persistAttempts: Number(barrier.persistAttempts || 0) + 1 }
}

/** Humano (sem barreira): sempre pode. Máquina: só CONFIRMED. */
export function shouldAllowBotNormalHandoff(barrier) {
  if (!barrier) return true
  return barrier.status === BOT_MOVE_CONFIRMED
}

export function canTickReleaseBotHandoff({
  isBotTurn = false,
  barrier = null,
  inflightCommits = 0,
} = {}) {
  if (!isBotTurn) return true
  if (Number(inflightCommits) > 0) return false
  return shouldAllowBotNormalHandoff(barrier)
}

/**
 * tick: humano always allow; PENDING/inflight wait; FAILED abort (sem handoff);
 * CONFIRMED+idle allow.
 */
export function resolveBotTickHandoffGate({
  isBotTurn = false,
  barrier = null,
  inflightCommits = 0,
} = {}) {
  if (!isBotTurn) return { action: 'allow', reason: 'human-path' }
  if (!barrier) return { action: 'allow', reason: 'no-barrier' }
  if (barrier.status === BOT_MOVE_FAILED) {
    return { action: 'abort', reason: barrier.reason || 'bot-move-rejected' }
  }
  if (
    !canTickReleaseBotHandoff({
      isBotTurn: true,
      barrier,
      inflightCommits,
    })
  ) {
    return { action: 'wait', reason: barrier.status === BOT_MOVE_PENDING ? 'bot-move-pending' : 'bot-commit-inflight' }
  }
  return { action: 'allow', reason: 'bot-move-confirmed' }
}

export function shouldPauseBotHeartbeat({
  barrier = null,
  foregroundDepth = 0,
} = {}) {
  if (Number(foregroundDepth) > 0) return true
  // PENDING/CONFIRMED sem commit inflight: o intervalo pode renovar o lease
  // via serializer (nunca simultâneo ao BOT_MOVE).
  void barrier
  return false
}

export function shouldEmitLockAcquireAfterBotClaim({
  isBotTurn = false,
  claimHoldsLock = false,
} = {}) {
  if (isBotTurn && claimHoldsLock) return false
  return true
}

/**
 * Snapshot remoto antigo não pode reverter pos confirmada/pendente da máquina.
 * Sem barreira (humano): sempre aplica.
 */
export function shouldApplyRemotePlayersDuringBotMove({
  barrier = null,
  incomingPlayer = null,
  localPlayer = null,
} = {}) {
  if (!barrier) return true
  if (barrier.status !== BOT_MOVE_PENDING && barrier.status !== BOT_MOVE_CONFIRMED) {
    return true
  }
  const held = Number(barrier.toPos)
  const incomingPos = Number(incomingPlayer?.pos)
  const localPos = Number(localPlayer?.pos ?? held)
  if (!Number.isFinite(held)) return true
  if (Number.isFinite(incomingPos) && incomingPos !== held && localPos === held) {
    return false
  }
  return true
}

const TERMINAL_MOVE_REASONS = new Set([
  'game-over',
  'stale-turn-player',
  'stale-turn-seq',
  'stale-match-id',
  'not-bot-turn',
  'executor-mismatch',
  'lock-owner-mismatch',
  'bot-id-mismatch',
  'turn-player-changed',
  'turn-seq-changed',
])

export function classifyBotMoveCommitResult(result) {
  if (result && result.ok === true && result.casLost !== true) {
    return { ok: true, retry: false, terminal: false, reason: 'bot-move-ok' }
  }
  const reason = String(result?.reason || (result?.casLost ? 'cas-lost' : 'bot-move-unconfirmed'))
  if (TERMINAL_MOVE_REASONS.has(reason)) {
    return { ok: false, retry: false, terminal: true, reason }
  }
  return { ok: false, retry: true, terminal: false, reason }
}

export function abbreviateExecutorId(id) {
  if (id == null) return null
  const s = String(id)
  return s.length <= 8 ? s : `${s.slice(0, 4)}…${s.slice(-2)}`
}

export function logBotCommit(kind, fields = {}) {
  console.log('[BOT_COMMIT]', kind, {
    matchId: fields.matchId ?? null,
    turnPlayerId: fields.turnPlayerId ?? null,
    turnSeq: fields.turnSeq ?? null,
    actionId: fields.actionId ?? null,
    executor: abbreviateExecutorId(fields.executorId ?? fields.executor),
    attempt: fields.attempt ?? null,
    ok: fields.ok ?? null,
    casLost: fields.casLost ?? null,
    stateVersion: fields.stateVersion ?? null,
    fromPos: fields.fromPos ?? null,
    toPos: fields.toPos ?? null,
  })
}
