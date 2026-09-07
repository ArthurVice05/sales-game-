/**
 * Pending same-bot (Arthur waitingAtRevenue): nextTurnIdx === turnIdx
 * com origem ainda viva NÃO é stale. Após NORMAL_HANDOFF (seq+1) passa a ser.
 */
import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import {
  isHandoffPendingObsolete,
  shouldDiscardSameSeatHandoffPending,
} from '../turnStateMonotonic.js'

const BOT_ID = 'bot:match-same-seat:0'
const BOT_IDX = 1

function alreadyRolled(lastRollTurnKey, turnSeq) {
  const turnKey = typeof turnSeq === 'number' ? String(turnSeq) : null
  return !!(turnKey && lastRollTurnKey != null && String(lastRollTurnKey) === turnKey)
}

describe('pending same-seat: não descartar origem viva', () => {
  it('Arthur waiting + Máquina turnSeq 47: pending same-idx NÃO é descartado', () => {
    const pending = {
      nextTurnIdx: BOT_IDX,
      nextTurnPlayerId: BOT_ID,
      originTurnSeq: 47,
      originTurnPlayerId: BOT_ID,
    }
    const current = {
      turnIdx: BOT_IDX,
      turnPlayerId: BOT_ID,
      turnSeq: 47,
    }
    assert.equal(pending.nextTurnIdx, current.turnIdx)
    assert.equal(
      isHandoffPendingObsolete(pending, {
        turnPlayerId: current.turnPlayerId,
        turnSeq: current.turnSeq,
      }),
      false,
    )
    assert.equal(shouldDiscardSameSeatHandoffPending(pending, current), false)
  })

  it('após NORMAL_HANDOFF 47→48, lastRollTurnKey não bloqueia e pending antigo é obsoleto', () => {
    const pending = {
      nextTurnIdx: BOT_IDX,
      nextTurnPlayerId: BOT_ID,
      originTurnSeq: 47,
      originTurnPlayerId: BOT_ID,
    }

    assert.equal(alreadyRolled('47', 47), true)

    const afterHandoff = {
      turnIdx: BOT_IDX,
      turnPlayerId: BOT_ID,
      turnSeq: 48,
      lastRollTurnKey: null,
    }

    assert.equal(afterHandoff.turnPlayerId, BOT_ID)
    assert.equal(afterHandoff.turnSeq, 48)
    assert.equal(alreadyRolled(afterHandoff.lastRollTurnKey, afterHandoff.turnSeq), false)
    assert.equal(
      isHandoffPendingObsolete(pending, {
        turnPlayerId: afterHandoff.turnPlayerId,
        turnSeq: afterHandoff.turnSeq,
      }),
      true,
    )
    assert.equal(shouldDiscardSameSeatHandoffPending(pending, afterHandoff), true)
  })

  it('legado sem originTurnSeq: nextTurnIdx === turnIdx continua descartável', () => {
    const pending = {
      nextTurnIdx: BOT_IDX,
      nextTurnPlayerId: BOT_ID,
    }
    const current = {
      turnIdx: BOT_IDX,
      turnPlayerId: BOT_ID,
      turnSeq: 47,
    }
    assert.equal(
      isHandoffPendingObsolete(pending, {
        turnPlayerId: current.turnPlayerId,
        turnSeq: current.turnSeq,
      }),
      true,
    )
    assert.equal(shouldDiscardSameSeatHandoffPending(pending, current), true)
  })
})
