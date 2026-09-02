/**
 * Decisão de entrada/retomada de partida por geração (matchId).
 * Não altera regras de rodada, faturamento ou encerramento.
 */

export const MATCH_ENTRY = Object.freeze({
  WAIT_NEW_START: 'wait-new-start',
  ENTER_CURRENT_MATCH: 'enter-current-match',
  RESUME_LEGACY_MATCH: 'resume-legacy-match',
  REJECT_MISMATCHED_MATCH: 'reject-mismatched-match',
})

function idStr(value) {
  return value != null && String(value).trim() !== '' ? String(value) : ''
}

function rosterHasPlayer(roomState, playerId) {
  const pid = idStr(playerId)
  if (!pid) return false
  const roster = Array.isArray(roomState?.players) ? roomState.players : []
  return roster.some((p) => String(p?.id) === pid)
}

/**
 * Classifica se o cliente pode entrar na partida identificada por latestMatchId.
 *
 * @param {object} opts
 * @param {string|null} opts.latestMatchId — id retornado por startMatch / getLatestMatch
 * @param {object|null} opts.roomState — rooms.state autoritativo
 * @param {string|null} [opts.persistedPlayerId]
 * @param {string|null} [opts.latestMatchCreatedAt]
 * @param {string|null} [opts.roomUpdatedAt]
 * @param {'guest-wait'|'legacy-resume'} [opts.mode]
 */
export function evaluateMatchEntryReadiness({
  latestMatchId,
  roomState,
  persistedPlayerId = null,
  latestMatchCreatedAt = null,
  roomUpdatedAt = null,
  mode = 'guest-wait',
} = {}) {
  const wanted = idStr(latestMatchId)
  const remoteId = idStr(roomState?.matchId)
  const matchCreatedMs = Date.parse(latestMatchCreatedAt)
  const roomUpdatedMs = Date.parse(roomUpdatedAt)
  const newMatchNewerThanRoom =
    Number.isFinite(matchCreatedMs) &&
    Number.isFinite(roomUpdatedMs) &&
    matchCreatedMs > roomUpdatedMs

  if (!wanted) {
    if (mode === 'legacy-resume' && rosterHasPlayer(roomState, persistedPlayerId)) {
      return { action: MATCH_ENTRY.RESUME_LEGACY_MATCH, reason: 'legacy-no-match-row' }
    }
    return { action: MATCH_ENTRY.WAIT_NEW_START, reason: 'no-latest-match' }
  }

  if (remoteId && remoteId === wanted) {
    return { action: MATCH_ENTRY.ENTER_CURRENT_MATCH, reason: 'match-id-match' }
  }

  if (remoteId && remoteId !== wanted) {
    if (mode === 'legacy-resume') {
      return { action: MATCH_ENTRY.REJECT_MISMATCHED_MATCH, reason: 'stale-match-id' }
    }
    return { action: MATCH_ENTRY.WAIT_NEW_START, reason: 'stale-match-id' }
  }

  // rooms.state sem matchId: START da geração nova ainda não persistiu, ou partida legado.
  if (newMatchNewerThanRoom) {
    return { action: MATCH_ENTRY.WAIT_NEW_START, reason: 'start-pending' }
  }
  if (mode === 'legacy-resume' && rosterHasPlayer(roomState, persistedPlayerId)) {
    return { action: MATCH_ENTRY.RESUME_LEGACY_MATCH, reason: 'legacy-roster' }
  }

  return { action: MATCH_ENTRY.WAIT_NEW_START, reason: 'start-pending' }
}

export function shouldApplyRoomStateForMatch(incomingState, expectedMatchId) {
  const expected = idStr(expectedMatchId)
  if (!expected) return true
  const incoming = idStr(incomingState?.matchId)
  return incoming === expected
}

export function isStartCommitSuccess(result, { netEnabled = false } = {}) {
  if (!netEnabled) return true
  return result?.ok === true
}

export function hasStartResetFields(state = {}) {
  return (
    idStr(state.matchId) !== '' &&
    state.kind === 'START' &&
    Number(state.round) === 1 &&
    state.gameOver === false &&
    (state.winner == null) &&
    (Number(state.turnSeq) || 0) === 0 &&
    state.turnLock === false &&
    (state.lockOwner == null) &&
    (state.lastRollTurnKey == null) &&
    (state.lastRoll == null) &&
    Array.isArray(state.roundFlags) &&
    Array.isArray(state.players)
  )
}

export function buildStartMatchPatch({
  matchId,
  maxRounds,
  turnTimeSec,
  turnDeadlineAt,
  turnPlayerId,
  boardVersion,
  playersCount = 0,
} = {}) {
  const n = Math.max(0, Number(playersCount) || 0)
  return {
    matchId: matchId != null ? String(matchId) : undefined,
    kind: 'START',
    isStartGame: true,
    round: 1,
    maxRounds,
    turnTimeSec,
    turnDeadlineAt,
    gameOver: false,
    winner: null,
    turnSeq: 0,
    lastRollTurnKey: null,
    lastRoll: null,
    turnLock: false,
    lockOwner: null,
    roundFlags: Array.from({ length: n }, () => false),
    turnPlayerId,
    boardVersion,
  }
}
