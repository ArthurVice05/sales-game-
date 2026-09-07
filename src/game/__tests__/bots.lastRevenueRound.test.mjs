/**
 * BOT_MOVE: lastRevenueRound já calculado precisa ir no mesmo playerDelta
 * (pos / _actionId / cash se mudou). Sem novo commit, sem novo dado.
 */
import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { applyGamePatchToState, mergePlayersById } from '../playerStateSync.js'
import { validateTurnCommit } from '../turnCommitValidation.js'
import { resolveFinalRoundMove } from '../resolveFinalRoundMove.js'
import { persistBotMove } from '../bots/botMovePersist.js'
import { buildBotMoveActionId, createBotMoveBarrier } from '../bots/botMoveBarrier.js'
import { pickWinnerByPatrimonio } from '../patrimonio.js'
import { shouldFinishAfterRoundTransition } from '../roundEndDecision.js'

const MATCH_ID = 'match-lrr-1'
const HUMAN_ID = 'arthur'
const BOT_ID = 'bot:match-lrr-1:0'
const EXEC = 'tab-A'
const TRACK_LEN = 40
const MAX_ROUNDS = 1
const ROUND_NOW = 1

function human(extra = {}) {
  return {
    id: HUMAN_ID,
    name: 'Arthur',
    isBot: false,
    pos: 0,
    cash: 18000,
    bens: 0,
    bankrupt: false,
    lastRevenueRound: 0,
    waitingAtRevenue: false,
    ...extra,
  }
}

function bot(extra = {}) {
  return {
    id: BOT_ID,
    name: 'Máquina 1',
    isBot: true,
    controller: 'BOT',
    pos: 36,
    cash: 22000,
    bens: 0,
    bankrupt: false,
    lastRevenueRound: 0,
    waitingAtRevenue: false,
    ...extra,
  }
}

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
  return playerDelta
}

function allAliveDone(players, roundNow) {
  const alive = (players || []).filter((p) => !p?.bankrupt)
  return (
    alive.length > 0 &&
    alive.every((p) => (Number(p.lastRevenueRound) || 0) >= roundNow)
  )
}

function applyBotMove(prev, { cur, nextMe, actionId, turnSeq }) {
  const playerDelta = composeBotMovePlayerDelta({ cur, nextMe, actionId })
  return {
    playerDelta,
    result: applyGamePatchToState(prev, {
      playersDeltaById: { [BOT_ID]: playerDelta },
      statePatch: {
        kind: 'PLAYER_DELTA',
        actionId,
        lastRollTurnKey: String(turnSeq),
        _commitKind: 'BOT_MOVE',
        _expectMatchId: MATCH_ID,
        _expectTurnPlayerId: BOT_ID,
        _expectTurnSeq: turnSeq,
        _expectLockOwner: HUMAN_ID,
      },
    }),
  }
}

function baseRemote({ turnSeq = 8, players }) {
  return {
    matchId: MATCH_ID,
    kind: 'LOCK',
    round: ROUND_NOW,
    maxRounds: MAX_ROUNDS,
    gameOver: false,
    winner: null,
    turnSeq,
    turnPlayerId: BOT_ID,
    turnLock: true,
    lockOwner: HUMAN_ID,
    players,
  }
}

describe('1 — BOT_MOVE sem cruzar início', () => {
  it('pos e actionId iguais; lastRevenueRound não entra no delta nem muda no remoto', () => {
    const cur = bot({ pos: 10, lastRevenueRound: 0 })
    const moved = resolveFinalRoundMove({
      oldPos: 10,
      steps: 3,
      trackLen: TRACK_LEN,
      roundNow: ROUND_NOW,
      maxRounds: MAX_ROUNDS,
      aliveCount: 2,
      prevLastRevenueRound: 0,
    })
    assert.equal(moved.crossedStart, false)
    const nextMe = { ...cur, pos: moved.finalPos, lastRevenueRound: moved.lastRevenueRound }
    const actionId = buildBotMoveActionId({
      matchId: MATCH_ID,
      turnPlayerId: BOT_ID,
      turnSeq: 8,
      executorId: EXEC,
    })
    const { playerDelta, result } = applyBotMove(baseRemote({ players: [human(), cur] }), {
      cur,
      nextMe,
      actionId,
      turnSeq: 8,
    })
    assert.equal(result.ok, true)
    assert.equal(playerDelta.pos, 13)
    assert.equal(playerDelta._actionId, actionId)
    assert.equal(Object.prototype.hasOwnProperty.call(playerDelta, 'lastRevenueRound'), false)
    const remoteBot = result.state.players.find((p) => p.id === BOT_ID)
    assert.equal(remoteBot.pos, 13)
    assert.equal(remoteBot.lastRevenueRound, 0)
  })
})

describe('2 — BOT_MOVE cruzando a casa 0', () => {
  it('mesmo pos/actionId; lastRevenueRound no mesmo delta; remoto = roundNow', () => {
    const cur = bot({ pos: 36, lastRevenueRound: 0, cash: 22000 })
    const moved = resolveFinalRoundMove({
      oldPos: 36,
      steps: 5,
      trackLen: TRACK_LEN,
      roundNow: ROUND_NOW,
      maxRounds: MAX_ROUNDS,
      aliveCount: 2,
      prevLastRevenueRound: 0,
    })
    assert.equal(moved.crossedStart, true)
    assert.equal(moved.lastRevenueRound, ROUND_NOW)
    const nextMe = {
      ...cur,
      pos: moved.finalPos,
      lastRevenueRound: moved.lastRevenueRound,
      cash: cur.cash,
    }
    const actionId = buildBotMoveActionId({
      matchId: MATCH_ID,
      turnPlayerId: BOT_ID,
      turnSeq: 8,
      executorId: EXEC,
    })
    const { playerDelta, result } = applyBotMove(baseRemote({ players: [human(), cur] }), {
      cur,
      nextMe,
      actionId,
      turnSeq: 8,
    })
    assert.equal(result.ok, true)
    assert.equal(playerDelta.pos, moved.finalPos)
    assert.equal(playerDelta._actionId, actionId)
    assert.equal(playerDelta.lastRevenueRound, ROUND_NOW)
    assert.equal(Object.prototype.hasOwnProperty.call(playerDelta, 'cash'), false)
    const remoteBot = result.state.players.find((p) => p.id === BOT_ID)
    assert.equal(remoteBot.pos, moved.finalPos)
    assert.equal(remoteBot.lastRevenueRound, ROUND_NOW)
  })
})

describe('3 — idempotência do mesmo actionId', () => {
  it('persist reenvia o mesmo delta; um commit lógico; lastRevenueRound não gera PATCH extra', async () => {
    const cur = bot({ pos: 36, lastRevenueRound: 0, cash: 22000 })
    const moved = resolveFinalRoundMove({
      oldPos: 36,
      steps: 4,
      trackLen: TRACK_LEN,
      roundNow: ROUND_NOW,
      maxRounds: MAX_ROUNDS,
      aliveCount: 2,
    })
    const nextMe = { ...cur, pos: moved.finalPos, lastRevenueRound: moved.lastRevenueRound }
    const actionId = buildBotMoveActionId({
      matchId: MATCH_ID,
      turnPlayerId: BOT_ID,
      turnSeq: 8,
      executorId: EXEC,
    })
    const playerDelta = composeBotMovePlayerDelta({ cur, nextMe, actionId })
    const barrier = createBotMoveBarrier({
      actionId,
      steps: 4,
      fromPos: 36,
      toPos: moved.finalPos,
      playerId: BOT_ID,
      turnSeq: 8,
      matchId: MATCH_ID,
      executorId: EXEC,
      delta: { [BOT_ID]: playerDelta },
    })
    let commits = 0
    const persisted = await persistBotMove({
      barrier,
      delayMs: 0,
      sleep: () => Promise.resolve(),
      commit: async ({ actionId: aid, delta }) => {
        commits += 1
        assert.equal(aid, actionId)
        assert.equal(delta[BOT_ID]._actionId, actionId)
        assert.equal(delta[BOT_ID].lastRevenueRound, ROUND_NOW)
        assert.equal(delta[BOT_ID].pos, moved.finalPos)
        return { ok: true }
      },
    })
    assert.equal(persisted.ok, true)
    assert.equal(commits, 1)
    assert.equal(persisted.localApplied, 1)
    assert.equal(new Set([playerDelta._actionId]).size, 1)

    const first = applyGamePatchToState(baseRemote({ players: [human(), cur] }), {
      playersDeltaById: { [BOT_ID]: playerDelta },
      statePatch: {
        _commitKind: 'BOT_MOVE',
        _expectTurnPlayerId: BOT_ID,
        _expectTurnSeq: 8,
        _expectMatchId: MATCH_ID,
        _expectLockOwner: HUMAN_ID,
      },
    })
    const replayed = mergePlayersById(first.state.players, { [BOT_ID]: playerDelta })
    const after = replayed.find((p) => p.id === BOT_ID)
    assert.equal(after.pos, moved.finalPos)
    assert.equal(after.lastRevenueRound, ROUND_NOW)
    assert.equal(after.cash, 22000)
  })
})

describe('4 — Máquina termina primeiro; humano por último; ENDGAME', () => {
  it('lastRevenueRound da Máquina permanece 1; após faturamento humano, ENDGAME e zero handoff', () => {
    const arthur0 = human({ pos: 36, lastRevenueRound: 0, cash: 18000, bens: 2000 })
    const bot0 = bot({ pos: 36, lastRevenueRound: 0, cash: 22000, bens: 1000 })
    const botMoved = resolveFinalRoundMove({
      oldPos: 36,
      steps: 5,
      trackLen: TRACK_LEN,
      roundNow: ROUND_NOW,
      maxRounds: MAX_ROUNDS,
      aliveCount: 2,
    })
    const nextBot = {
      ...bot0,
      pos: botMoved.finalPos,
      lastRevenueRound: botMoved.lastRevenueRound,
    }
    const actionId = buildBotMoveActionId({
      matchId: MATCH_ID,
      turnPlayerId: BOT_ID,
      turnSeq: 8,
      executorId: EXEC,
    })
    const afterBot = applyBotMove(baseRemote({ players: [arthur0, bot0] }), {
      cur: bot0,
      nextMe: nextBot,
      actionId,
      turnSeq: 8,
    }).result
    assert.equal(afterBot.ok, true)
    let remote = afterBot.state
    const staleIncoming = {
      ...bot0,
      pos: botMoved.finalPos,
      lastRevenueRound: 0,
    }
    const preserved = mergePlayersById(remote.players, {
      [BOT_ID]: { pos: staleIncoming.pos },
    })
    assert.equal(preserved.find((p) => p.id === BOT_ID).lastRevenueRound, ROUND_NOW)
    remote = { ...remote, players: preserved }

    const arthurMoved = resolveFinalRoundMove({
      oldPos: 36,
      steps: 5,
      trackLen: TRACK_LEN,
      roundNow: ROUND_NOW,
      maxRounds: MAX_ROUNDS,
      aliveCount: 2,
    })
    const arthurAfterMove = {
      ...arthur0,
      pos: arthurMoved.finalPos,
      lastRevenueRound: arthurMoved.lastRevenueRound,
    }
    const afterHumanMove = applyGamePatchToState(
      { ...remote, turnPlayerId: HUMAN_ID, turnSeq: 9, turnLock: true, lockOwner: HUMAN_ID },
      {
        playersDeltaById: {
          [HUMAN_ID]: {
            pos: arthurAfterMove.pos,
            lastRevenueRound: arthurAfterMove.lastRevenueRound,
          },
        },
        statePatch: { kind: 'PLAYER_DELTA' },
      },
    )
    assert.equal(afterHumanMove.ok, true)

    const fat = 770
    const pipelineIdlePlayers = afterHumanMove.state.players.map((p) =>
      p.id === HUMAN_ID ? { ...p, cash: Number(p.cash) + fat } : p,
    )
    const arthur = pipelineIdlePlayers.find((p) => p.id === HUMAN_ID)
    const machine = pipelineIdlePlayers.find((p) => p.id === BOT_ID)
    assert.ok(arthur.lastRevenueRound >= 1)
    assert.ok(machine.lastRevenueRound >= 1)
    assert.equal(allAliveDone(pipelineIdlePlayers, ROUND_NOW), true)

    const endGame = true
    assert.equal(
      shouldFinishAfterRoundTransition({
        endGame,
        shouldIncrementRound: false,
        nextRound: ROUND_NOW,
        maxRounds: MAX_ROUNDS,
      }),
      true,
    )
    const winner = pickWinnerByPatrimonio(pipelineIdlePlayers)
    assert.ok(winner)
    assert.equal(winner.id, BOT_ID)
    assert.equal(winner.patrimonio, 23000)
    const endState = {
      ...afterHumanMove.state,
      players: pipelineIdlePlayers,
      gameOver: true,
      winner,
    }
    const extraHandoff = validateTurnCommit(endState, {
      kind: 'TURN',
      turnSeq: 10,
      turnPlayerId: BOT_ID,
      _commitKind: 'NORMAL_HANDOFF',
      _expectTurnPlayerId: HUMAN_ID,
      _expectTurnSeq: 9,
    })
    assert.equal(extraHandoff.ok, false)
    assert.equal(extraHandoff.reason, 'game-over')
  })
})
