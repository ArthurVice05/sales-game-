/**
 * BOT_MOVE: waitingAtRevenue já calculado precisa ir no mesmo playerDelta
 * quando muda. Sem novo commit, sem novo dado, sem mudar lastRevenueRound.
 */
import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import {
  applyGamePatchToState,
  mergeRosterPreserveMissing,
} from '../playerStateSync.js'
import { resolveFinalRoundMove } from '../resolveFinalRoundMove.js'
import { persistBotMove } from '../bots/botMovePersist.js'
import { buildBotMoveActionId, createBotMoveBarrier } from '../bots/botMoveBarrier.js'
import { findNextAliveIdx } from '../gameMath.js'
import { pickWinnerByPatrimonio } from '../patrimonio.js'
import { shouldFinishAfterRoundTransition } from '../roundEndDecision.js'
import { shouldDiscardSameSeatHandoffPending } from '../turnStateMonotonic.js'
import { decideMatchTransientEndgameReset } from '../matchEntryReadiness.js'

const MATCH_ID = 'match-wait-1'
const HUMAN_ID = 'arthur'
const BOT1_ID = 'bot:match-wait-1:0'
const BOT2_ID = 'bot:match-wait-1:1'
const EXEC = 'tab-A'
const TRACK_LEN = 40

/** Mesma composição do ramo curIsBot em advanceAndMaybeLap. */
function composeBotMovePlayerDelta({ cur, nextMe, actionId }) {
  const playerDelta = { pos: Number(nextMe?.pos), _actionId: actionId }
  if (nextMe && Number(nextMe.cash) !== Number(cur?.cash)) {
    playerDelta.cash = nextMe.cash
  }
  if (
    nextMe &&
    Number(nextMe.lastRevenueRound) !== Number(cur?.lastRevenueRound)
  ) {
    playerDelta.lastRevenueRound = Number(nextMe.lastRevenueRound)
  }
  if (
    nextMe &&
    Boolean(nextMe.waitingAtRevenue) !== Boolean(cur?.waitingAtRevenue)
  ) {
    playerDelta.waitingAtRevenue = Boolean(nextMe.waitingAtRevenue)
  }
  return playerDelta
}

function skipWaiting(players, fromIdx, roundNow, maxRounds) {
  let nextTurnIdx = findNextAliveIdx(players, fromIdx)
  if (Number(roundNow) === Number(maxRounds)) {
    let guard = 0
    while (guard < players.length) {
      const p = players[nextTurnIdx]
      if (p && !p.bankrupt && !(p.waitingAtRevenue === true)) break
      nextTurnIdx = (nextTurnIdx + 1) % players.length
      guard++
    }
  }
  return nextTurnIdx
}

function player({ id, name, isBot = false, extra = {} }) {
  return {
    id,
    name,
    isBot,
    controller: isBot ? 'BOT' : undefined,
    pos: 36,
    cash: 20000,
    bens: 0,
    bankrupt: false,
    lastRevenueRound: 4,
    waitingAtRevenue: false,
    ...extra,
  }
}

function applyBotMove(prev, { botId, cur, nextMe, actionId, turnSeq }) {
  const playerDelta = composeBotMovePlayerDelta({ cur, nextMe, actionId })
  return {
    playerDelta,
    result: applyGamePatchToState(prev, {
      playersDeltaById: { [botId]: playerDelta },
      statePatch: {
        kind: 'PLAYER_DELTA',
        actionId,
        lastRollTurnKey: String(turnSeq),
        _commitKind: 'BOT_MOVE',
        _expectMatchId: MATCH_ID,
        _expectTurnPlayerId: botId,
        _expectTurnSeq: turnSeq,
        _expectLockOwner: HUMAN_ID,
      },
    }),
  }
}

function baseRemote({ turnSeq, turnPlayerId, players, round = 5, maxRounds = 5 }) {
  return {
    matchId: MATCH_ID,
    kind: 'LOCK',
    round,
    maxRounds,
    gameOver: false,
    winner: null,
    turnSeq,
    turnPlayerId,
    turnLock: true,
    lockOwner: HUMAN_ID,
    players,
  }
}

describe('1 — BOT_MOVE sem mudança de waitingAtRevenue', () => {
  it('waitingAtRevenue não entra no delta', () => {
    const cur = player({
      id: BOT1_ID,
      name: 'Máquina 1',
      isBot: true,
      extra: { pos: 10, lastRevenueRound: 4, waitingAtRevenue: false },
    })
    const moved = resolveFinalRoundMove({
      oldPos: 10,
      steps: 3,
      trackLen: TRACK_LEN,
      roundNow: 5,
      maxRounds: 5,
      aliveCount: 3,
      prevLastRevenueRound: 4,
      prevWaitingAtRevenue: false,
    })
    assert.equal(moved.crossedStart, false)
    const nextMe = {
      ...cur,
      pos: moved.finalPos,
      lastRevenueRound: moved.lastRevenueRound,
      waitingAtRevenue: moved.waitingAtRevenue,
    }
    const actionId = buildBotMoveActionId({
      matchId: MATCH_ID,
      turnPlayerId: BOT1_ID,
      turnSeq: 40,
      executorId: EXEC,
    })
    const delta = composeBotMovePlayerDelta({ cur, nextMe, actionId })
    assert.equal(delta.pos, 13)
    assert.equal(delta._actionId, actionId)
    assert.equal(Object.prototype.hasOwnProperty.call(delta, 'waitingAtRevenue'), false)
    assert.equal(Object.prototype.hasOwnProperty.call(delta, 'lastRevenueRound'), false)
  })
})

describe('2 — bot completa última volta: um BOT_MOVE, mesmo actionId', () => {
  it('pos=0, lastRevenueRound=maxRounds, waitingAtRevenue=true no remoto', async () => {
    const cur = player({
      id: BOT2_ID,
      name: 'Máquina 2',
      isBot: true,
      extra: { pos: 36, lastRevenueRound: 4, waitingAtRevenue: false, cash: 22000 },
    })
    const moved = resolveFinalRoundMove({
      oldPos: 36,
      steps: 5,
      trackLen: TRACK_LEN,
      roundNow: 5,
      maxRounds: 5,
      aliveCount: 3,
      prevLastRevenueRound: 4,
      prevWaitingAtRevenue: false,
    })
    assert.equal(moved.finalPos, 0)
    assert.equal(moved.lastRevenueRound, 5)
    assert.equal(moved.waitingAtRevenue, true)
    const nextMe = {
      ...cur,
      pos: moved.finalPos,
      lastRevenueRound: moved.lastRevenueRound,
      waitingAtRevenue: moved.waitingAtRevenue,
    }
    const actionId = buildBotMoveActionId({
      matchId: MATCH_ID,
      turnPlayerId: BOT2_ID,
      turnSeq: 47,
      executorId: EXEC,
    })
    const delta = composeBotMovePlayerDelta({ cur, nextMe, actionId })
    assert.equal(delta.pos, 0)
    assert.equal(delta.lastRevenueRound, 5)
    assert.equal(delta.waitingAtRevenue, true)
    assert.equal(delta._actionId, actionId)

    const barrier = createBotMoveBarrier({
      actionId,
      steps: 5,
      fromPos: 36,
      toPos: 0,
      playerId: BOT2_ID,
      turnSeq: 47,
      matchId: MATCH_ID,
      executorId: EXEC,
      delta: { [BOT2_ID]: delta },
    })
    let commits = 0
    const persisted = await persistBotMove({
      barrier,
      delayMs: 0,
      sleep: () => Promise.resolve(),
      commit: async ({ actionId: aid, delta: dlt }) => {
        commits += 1
        assert.equal(aid, actionId)
        assert.equal(dlt[BOT2_ID]._actionId, actionId)
        assert.equal(dlt[BOT2_ID].waitingAtRevenue, true)
        assert.equal(dlt[BOT2_ID].lastRevenueRound, 5)
        assert.equal(dlt[BOT2_ID].pos, 0)
        return { ok: true }
      },
    })
    assert.equal(persisted.ok, true)
    assert.equal(commits, 1)

    const { result } = applyBotMove(
      baseRemote({
        turnSeq: 47,
        turnPlayerId: BOT2_ID,
        players: [
          player({ id: HUMAN_ID, name: 'Arthur' }),
          player({ id: BOT1_ID, name: 'Máquina 1', isBot: true }),
          cur,
        ],
      }),
      { botId: BOT2_ID, cur, nextMe, actionId, turnSeq: 47 },
    )
    assert.equal(result.ok, true)
    const remoteBot = result.state.players.find((p) => p.id === BOT2_ID)
    assert.equal(remoteBot.pos, 0)
    assert.equal(remoteBot.lastRevenueRound, 5)
    assert.equal(remoteBot.waitingAtRevenue, true)
  })
})

describe('3 — snapshot não devolve waitingAtRevenue=false', () => {
  it('após commit autoritativo, snapshot do room state mantém true', () => {
    const cur = player({
      id: BOT2_ID,
      name: 'Máquina 2',
      isBot: true,
      extra: { pos: 36, lastRevenueRound: 4, waitingAtRevenue: false },
    })
    const nextMe = { ...cur, pos: 0, lastRevenueRound: 5, waitingAtRevenue: true }
    const actionId = 'bot-move:wait:bot2:47:tab'
    const { result } = applyBotMove(
      baseRemote({
        turnSeq: 47,
        turnPlayerId: BOT2_ID,
        players: [player({ id: HUMAN_ID, name: 'Arthur' }), cur],
      }),
      { botId: BOT2_ID, cur, nextMe, actionId, turnSeq: 47 },
    )
    assert.equal(result.ok, true)
    const committed = result.state.players.find((p) => p.id === BOT2_ID)
    assert.equal(committed.waitingAtRevenue, true)

    const fromRoom = mergeRosterPreserveMissing(result.state.players, result.state.players)
    assert.equal(fromRoom.find((p) => p.id === BOT2_ID).waitingAtRevenue, true)

    const snapOmittingField = result.state.players.map((p) => {
      if (p.id !== BOT2_ID) return p
      const { waitingAtRevenue: _drop, ...rest } = p
      return { ...rest, pos: 0, lastRevenueRound: 5 }
    })
    const kept = mergeRosterPreserveMissing(result.state.players, snapOmittingField)
    assert.equal(kept.find((p) => p.id === BOT2_ID).waitingAtRevenue, true)
  })
})

describe('4 — rotação: waiting=true sai; os outros continuam', () => {
  it('Máquina 2 parked não recebe o próximo turno', () => {
    const roster = [
      player({ id: HUMAN_ID, name: 'Arthur', extra: { lastRevenueRound: 4, waitingAtRevenue: false } }),
      player({ id: BOT1_ID, name: 'Máquina 1', isBot: true, extra: { lastRevenueRound: 4, waitingAtRevenue: false } }),
      player({
        id: BOT2_ID,
        name: 'Máquina 2',
        isBot: true,
        extra: { pos: 0, lastRevenueRound: 5, waitingAtRevenue: true },
      }),
    ]
    const bot2Idx = 2
    const next = skipWaiting(roster, bot2Idx, 5, 5)
    assert.notEqual(roster[next].id, BOT2_ID)
    assert.equal(roster[next].waitingAtRevenue === true, false)
  })
})

describe('5 — 1 humano + 2 máquinas, maxRounds=5', () => {
  it('Máquina 2 termina primeiro, para; Arthur e Máquina 1 fecham ENDGAME', () => {
    const arthur = player({ id: HUMAN_ID, name: 'Arthur', extra: { lastRevenueRound: 4 } })
    const bot1 = player({ id: BOT1_ID, name: 'Máquina 1', isBot: true, extra: { lastRevenueRound: 4 } })
    const bot2 = player({
      id: BOT2_ID,
      name: 'Máquina 2',
      isBot: true,
      extra: { pos: 36, lastRevenueRound: 4, cash: 25000, bens: 1000 },
    })
    const moved2 = resolveFinalRoundMove({
      oldPos: 36,
      steps: 5,
      trackLen: TRACK_LEN,
      roundNow: 5,
      maxRounds: 5,
      aliveCount: 3,
      prevLastRevenueRound: 4,
    })
    const nextBot2 = {
      ...bot2,
      pos: moved2.finalPos,
      lastRevenueRound: moved2.lastRevenueRound,
      waitingAtRevenue: moved2.waitingAtRevenue,
    }
    const actionId = buildBotMoveActionId({
      matchId: MATCH_ID,
      turnPlayerId: BOT2_ID,
      turnSeq: 47,
      executorId: EXEC,
    })
    const after2 = applyBotMove(
      baseRemote({
        turnSeq: 47,
        turnPlayerId: BOT2_ID,
        players: [arthur, bot1, bot2],
      }),
      { botId: BOT2_ID, cur: bot2, nextMe: nextBot2, actionId, turnSeq: 47 },
    )
    assert.equal(after2.result.ok, true)
    const remoteAfter2 = after2.result.state.players
    const m2 = remoteAfter2.find((p) => p.id === BOT2_ID)
    assert.equal(m2.lastRevenueRound, 5)
    assert.equal(m2.waitingAtRevenue, true)
    const nextAfterM2 = skipWaiting(remoteAfter2, 2, 5, 5)
    assert.notEqual(remoteAfter2[nextAfterM2].id, BOT2_ID)

    const arthurMoved = resolveFinalRoundMove({
      oldPos: 36,
      steps: 5,
      trackLen: TRACK_LEN,
      roundNow: 5,
      maxRounds: 5,
      aliveCount: 3,
      prevLastRevenueRound: 4,
    })
    const afterArthur = applyGamePatchToState(
      { ...after2.result.state, turnPlayerId: HUMAN_ID, turnSeq: 48 },
      {
        playersDeltaById: {
          [HUMAN_ID]: {
            pos: arthurMoved.finalPos,
            lastRevenueRound: arthurMoved.lastRevenueRound,
            waitingAtRevenue: arthurMoved.waitingAtRevenue,
          },
        },
        statePatch: { kind: 'PLAYER_DELTA' },
      },
    )
    assert.equal(afterArthur.ok, true)
    const nextAfterArthur = skipWaiting(afterArthur.state.players, 0, 5, 5)
    assert.equal(afterArthur.state.players[nextAfterArthur].id, BOT1_ID)

    const bot1Moved = resolveFinalRoundMove({
      oldPos: 36,
      steps: 5,
      trackLen: TRACK_LEN,
      roundNow: 5,
      maxRounds: 5,
      aliveCount: 3,
      prevLastRevenueRound: 4,
    })
    const afterBot1 = applyGamePatchToState(
      { ...afterArthur.state, turnPlayerId: BOT1_ID, turnSeq: 49 },
      {
        playersDeltaById: {
          [BOT1_ID]: {
            pos: bot1Moved.finalPos,
            lastRevenueRound: bot1Moved.lastRevenueRound,
            waitingAtRevenue: bot1Moved.waitingAtRevenue,
            _actionId: 'bot-move:wait:bot1:49:tab',
          },
        },
        statePatch: { kind: 'PLAYER_DELTA' },
      },
    )
    assert.equal(afterBot1.ok, true)
    const alive = afterBot1.state.players.filter((p) => !p.bankrupt)
    assert.ok(alive.every((p) => Number(p.lastRevenueRound) >= 5))
    assert.equal(
      shouldFinishAfterRoundTransition({
        endGame: true,
        shouldIncrementRound: false,
        nextRound: 5,
        maxRounds: 5,
      }),
      true,
    )
    const winner = pickWinnerByPatrimonio(afterBot1.state.players)
    assert.ok(winner)
    assert.equal(winner.id, BOT2_ID)
  })
})

describe('6 — lastRevenueRound, same-seat e MATCH A→B intactos', () => {
  it('lastRevenueRound ainda entra no delta quando muda', () => {
    const cur = player({
      id: BOT1_ID,
      name: 'Máquina 1',
      isBot: true,
      extra: { lastRevenueRound: 4, waitingAtRevenue: false },
    })
    const nextMe = { ...cur, pos: 0, lastRevenueRound: 5, waitingAtRevenue: true }
    const delta = composeBotMovePlayerDelta({ cur, nextMe, actionId: 'a1' })
    assert.equal(delta.lastRevenueRound, 5)
    assert.equal(delta.waitingAtRevenue, true)
  })

  it('same-seat: origem viva não é descartada', () => {
    assert.equal(
      shouldDiscardSameSeatHandoffPending(
        {
          nextTurnIdx: 1,
          originTurnSeq: 47,
          originTurnPlayerId: BOT1_ID,
        },
        { turnIdx: 1, turnPlayerId: BOT1_ID, turnSeq: 47 },
      ),
      false,
    )
  })

  it('MATCH A → MATCH B ainda reseta só na troca de matchId', () => {
    assert.equal(
      decideMatchTransientEndgameReset({
        previousMatchId: 'match-A',
        nextMatchId: 'match-B',
      }).reset,
      true,
    )
    assert.equal(
      decideMatchTransientEndgameReset({
        previousMatchId: 'match-B',
        nextMatchId: 'match-B',
      }).reset,
      false,
    )
  })
})
