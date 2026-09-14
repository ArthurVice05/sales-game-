import test from 'node:test'
import assert from 'node:assert/strict'

import { BOARD_VERSION_CURRENT } from '../../data/boardVersions.js'
import { reduceGame } from '../engine/gameReducer.js'
import { applyMonthlyRevenueCredit } from '../revenueCredit.js'

test('duas passagens pelo início creditam dois faturamentos ao jogador correto', () => {
  let player = { id: 'empresa-a', pos: 38, cash: 390 }
  const monthlyRevenue = 14_495

  for (let passage = 0; passage < 2; passage += 1) {
    const result = reduceGame({
      players: [player],
      turnIdx: 0,
      turnPlayerId: player.id,
      turnLock: false,
      lockOwner: null,
    }, { type: 'ROLL', steps: 3 }, {
      myUid: player.id,
      boardVersion: BOARD_VERSION_CURRENT,
    })

    assert.equal(result.events.filter((event) => event.type === 'REVENUE').length, 1)
    player = applyMonthlyRevenueCredit(
      { ...player, pos: result.nextState.players[0].pos },
      monthlyRevenue,
    )
    // Reposiciona apenas para reproduzir uma segunda volta completa de forma determinística.
    player = { ...player, pos: 38 }
  }

  assert.equal(player.cash, 390 + (monthlyRevenue * 2))
})

test('crédito mensal nunca produz NaN nem débito acidental', () => {
  assert.equal(applyMonthlyRevenueCredit({ cash: 100 }, Number.NaN).cash, 100)
  assert.equal(applyMonthlyRevenueCredit({ cash: 100 }, -500).cash, 100)
  assert.equal(applyMonthlyRevenueCredit({ cash: Number.NaN }, 250).cash, 250)
})
