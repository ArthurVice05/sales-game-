/**
 * Estratégia de investimento da Máquina — pura, sem rede/motor.
 * Executar: node --test src/game/__tests__/bots.strategy.test.mjs
 */
import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import {
  BOT_PHASE_END,
  BOT_PHASE_MID,
  BOT_PHASE_START,
  BOT_STRATEGY,
  chooseBotAction,
  competitiveGap,
  enumerateLegalBotActions,
  remainingRounds,
  resolveCashReserve,
  resolveMatchPhase,
  scoreBotAction,
} from '../bots/botPolicy.js'
import { ACTION_SKIP, buildErpBuyPayload } from '../bots/botModalContracts.js'
import { capacityAndAttendance } from '../gameMath.js'

function botPlayer(extra = {}) {
  return {
    id: 'bot:strategy:0',
    name: 'Máquina 1',
    isBot: true,
    controller: 'BOT',
    cash: 18000,
    bens: 4000,
    bankrupt: false,
    mixProdutos: 'D',
    erpLevel: 'D',
    clients: 1,
    vendedoresComuns: 1,
    fieldSales: 0,
    insideSales: 0,
    gestores: 0,
    ...extra,
  }
}

function rival(extra = {}) {
  return {
    id: 'human-1',
    name: 'Arthur',
    isBot: false,
    cash: 12000,
    bens: 4000,
    bankrupt: false,
    ...extra,
  }
}

function pick(ctx) {
  return chooseBotAction(ctx)
}

function scoreOf(kind, ctx) {
  const { actions } = enumerateLegalBotActions(ctx)
  const action = actions.find((a) => a.kind === kind)
  if (!action) return -Infinity
  return scoreBotAction(action, ctx)
}

describe('fase e horizonte', () => {
  it('1 rodada é FINAL; 5 rodadas começa em INÍCIO e termina em FINAL', () => {
    assert.equal(resolveMatchPhase(1, 1), BOT_PHASE_END)
    assert.equal(resolveMatchPhase(1, 5), BOT_PHASE_START)
    assert.equal(resolveMatchPhase(3, 5), BOT_PHASE_MID)
    assert.equal(resolveMatchPhase(5, 5), BOT_PHASE_END)
    assert.equal(remainingRounds(1, 5), 5)
    assert.equal(remainingRounds(5, 5), 1)
  })
})

describe('1 — pouco caixa + investimento caro → SKIP', () => {
  it('não compra MIX caro com caixa baixo', () => {
    const choice = pick({
      player: botPlayer({ cash: 2200, bens: 1000 }),
      opponents: [rival()],
      round: 1,
      maxRounds: 5,
      kind: 'MIX',
    })
    assert.equal(choice.kind, 'SKIP')
    assert.deepEqual(choice.payload, { ...ACTION_SKIP })
  })
})

describe('2 — caixa saudável + bom ROI + várias rodadas → BUY', () => {
  it('compra ERP com equipe e horizonte longos', () => {
    const choice = pick({
      player: botPlayer({
        cash: 22000,
        vendedoresComuns: 6,
        fieldSales: 2,
        insideSales: 2,
        clients: 20,
      }),
      opponents: [rival({ cash: 10000, bens: 2000 })],
      round: 1,
      maxRounds: 5,
      kind: 'ERP',
    })
    assert.equal(choice.payload.action, 'BUY')
    assert.equal(choice.kind, 'ERP')
    assert.ok(choice.payload.level)
  })
})

describe('3 — ERP + muitos colaboradores + horizonte → BUY', () => {
  it('tende a BUY no ERP quando o staff escala o retorno', () => {
    const choice = pick({
      player: botPlayer({
        cash: 20000,
        vendedoresComuns: 8,
        clients: 16,
      }),
      opponents: [rival()],
      round: 2,
      maxRounds: 5,
      kind: 'ERP',
    })
    assert.equal(choice.payload.action, 'BUY')
    assert.match(choice.id, /^ERP:/)
  })
})

describe('4 — ERP payback longo na última rodada → SKIP', () => {
  it('preserva caixa no FINAL quando o ERP não se paga', () => {
    const choice = pick({
      player: botPlayer({
        cash: 18000,
        vendedoresComuns: 1,
        clients: 1,
        erpLevel: 'D',
      }),
      opponents: [rival({ cash: 8000, bens: 2000 })],
      round: 5,
      maxRounds: 5,
      kind: 'ERP',
    })
    assert.equal(choice.kind, 'SKIP')
    assert.equal(choice.payload.action, 'SKIP')
  })
})

describe('5 — capacidade saturada → clientes perdem, vendedor ganha', () => {
  it('não enumera CLIENTS e prioriza capacidade', () => {
    const player = botPlayer({
      cash: 22000,
      vendedoresComuns: 1,
      clients: 6,
    })
    const { cap, inAtt } = capacityAndAttendance(player)
    assert.ok(inAtt >= cap)

    const ctx = { player, opponents: [rival()], round: 2, maxRounds: 5, kind: 'PURCHASE' }
    const { actions } = enumerateLegalBotActions(ctx)
    assert.equal(actions.some((a) => a.kind === 'CLIENTS'), false)

    const choice = pick(ctx)
    assert.ok(choice.kind === 'COMMON' || choice.kind === 'FIELD' || choice.kind === 'INSIDE')
    assert.equal(choice.payload.action, 'BUY')
    assert.ok(scoreOf('COMMON', ctx) > scoreOf('CLIENTS', ctx))
  })
})

describe('6 — capacidade ociosa → vendedor perde, CLIENTS ganha', () => {
  it('preenche carteira antes de contratar', () => {
    const player = botPlayer({
      cash: 22000,
      vendedoresComuns: 4,
      fieldSales: 0,
      insideSales: 0,
      clients: 1,
    })
    const { cap, inAtt } = capacityAndAttendance(player)
    assert.ok(cap > inAtt)

    const ctx = { player, opponents: [rival()], round: 2, maxRounds: 5, kind: 'PURCHASE' }
    const { actions } = enumerateLegalBotActions(ctx)
    const capacityChoices = actions.filter((a) =>
      a.kind === 'CLIENTS' || a.kind === 'COMMON' || a.kind === 'FIELD' || a.kind === 'INSIDE'
    )
    const bestCapacity = capacityChoices
      .map((a) => ({ kind: a.kind, score: scoreBotAction(a, ctx) }))
      .sort((a, b) => b.score - a.score)[0]
    assert.equal(bestCapacity.kind, 'CLIENTS')
    assert.ok(scoreOf('CLIENTS', ctx) > scoreOf('COMMON', ctx))
    assert.ok(scoreOf('CLIENTS', ctx) > scoreOf('FIELD', ctx))
    assert.ok(scoreOf('CLIENTS', ctx) > scoreOf('INSIDE', ctx))
  })
})

describe('7 — COMMON vs FIELD vs INSIDE pelo impacto, não pelo preço', () => {
  it('com overflow grande não escolhe só o hire mais barato', () => {
    const player = botPlayer({
      cash: 25000,
      vendedoresComuns: 1,
      fieldSales: 0,
      insideSales: 0,
      clients: 10,
    })
    const ctx = { player, opponents: [rival()], round: 2, maxRounds: 5, kind: 'PURCHASE' }
    const { actions } = enumerateLegalBotActions(ctx)
    const vendors = actions.filter((a) => a.kind === 'COMMON' || a.kind === 'FIELD' || a.kind === 'INSIDE')
    assert.ok(vendors.length >= 3)

    const scored = vendors
      .map((a) => ({ kind: a.kind, score: scoreBotAction(a, ctx), cost: a.impact.immediateCost }))
      .sort((a, b) => b.score - a.score)
    const cheapest = [...scored].sort((a, b) => a.cost - b.cost)[0]
    const choice = pick(ctx)
    assert.ok(choice.kind === 'COMMON' || choice.kind === 'FIELD' || choice.kind === 'INSIDE')
    assert.equal(choice.kind, scored[0].kind)
    assert.notEqual(choice.kind, cheapest.kind)
  })
})

describe('8 — atrás no patrimônio aumenta score de ação razoável', () => {
  it('o mesmo ERP vale mais contra um líder distante', () => {
    const player = botPlayer({
      cash: 20000,
      bens: 4000,
      vendedoresComuns: 6,
      clients: 12,
    })
    const actionCtx = { player, round: 4, maxRounds: 5, kind: 'ERP' }
    const { actions } = enumerateLegalBotActions(actionCtx)
    const erp = actions.find((a) => a.kind === 'ERP')
    assert.ok(erp)

    const even = scoreBotAction(erp, {
      ...actionCtx,
      opponents: [rival({ cash: 16000, bens: 4000 })],
    })
    const behind = scoreBotAction(erp, {
      ...actionCtx,
      opponents: [rival({ cash: 80000, bens: 40000 })],
    })
    assert.ok(competitiveGap(player, [rival({ cash: 80000, bens: 40000 })]) > 0.18)
    assert.ok(behind > even)
  })
})

describe('9 — líder no FINAL penaliza retorno longo', () => {
  it('ERP que não se paga perde score quando o bot lidera no fim', () => {
    const player = botPlayer({
      cash: 20000,
      bens: 30000,
      vendedoresComuns: 1,
      clients: 1,
      erpLevel: 'D',
    })
    const weakOpp = [rival({ cash: 3000, bens: 1000 })]
    const endCtx = { player, opponents: weakOpp, round: 5, maxRounds: 5, kind: 'ERP' }
    const midCtx = { player, opponents: weakOpp, round: 2, maxRounds: 5, kind: 'ERP' }
    const { actions } = enumerateLegalBotActions(endCtx)
    const erp = actions.find((a) => a.kind === 'ERP')
    assert.ok(erp)
    assert.equal(erp.ret?.paysBackWithinHorizon, false)

    const endScore = scoreBotAction(erp, endCtx)
    const midScore = scoreBotAction(erp, midCtx)
    assert.ok(endScore < midScore)
    assert.equal(pick(endCtx).kind, 'SKIP')
  })
})

describe('10 — determinismo', () => {
  it('mesma entrada várias vezes → mesma decisão', () => {
    const ctx = {
      player: botPlayer({ cash: 20000, vendedoresComuns: 5, clients: 8 }),
      opponents: [rival()],
      round: 2,
      maxRounds: 5,
      kind: 'PURCHASE',
    }
    const a = pick(ctx)
    const b = pick(ctx)
    const c = pick(ctx)
    assert.deepEqual(a, b)
    assert.deepEqual(b, c)
  })
})

describe('11 — SKIP continua possível', () => {
  it('última rodada sem retorno útil devolve SKIP', () => {
    const choice = pick({
      player: botPlayer({ cash: 4000, vendedoresComuns: 1, clients: 1 }),
      opponents: [rival({ cash: 2000, bens: 1000 })],
      round: 1,
      maxRounds: 1,
      kind: 'PURCHASE',
    })
    assert.equal(choice.kind, 'SKIP')
    assert.deepEqual(choice.payload, { ...ACTION_SKIP })
  })
})

describe('12 — contratos de payload intactos', () => {
  it('BUY de ERP mantém o formato do builder existente', () => {
    const choice = pick({
      player: botPlayer({
        cash: 22000,
        vendedoresComuns: 8,
        clients: 16,
      }),
      opponents: [rival()],
      round: 1,
      maxRounds: 5,
      kind: 'ERP',
    })
    assert.equal(choice.payload.action, 'BUY')
    const expected = buildErpBuyPayload(choice.payload.level)
    assert.deepEqual(choice.payload, expected)
  })

  it('SKIP continua { action: SKIP }', () => {
    const choice = pick({
      player: botPlayer({ cash: 500 }),
      opponents: [rival()],
      round: 1,
      maxRounds: 1,
      kind: 'MIX',
    })
    assert.deepEqual(choice.payload, { action: 'SKIP' })
  })
})

describe('reserva de caixa', () => {
  it('FINAL atrás relaxa a reserva; líder no FINAL não gasta o piso à toa', () => {
    const poor = botPlayer({ cash: 9000, bens: 2000, vendedoresComuns: 2, clients: 3 })
    const richOpp = [rival({ cash: 50000, bens: 40000 })]
    const weakOpp = [rival({ cash: 1000, bens: 500 })]
    const behindEnd = resolveCashReserve({
      player: poor,
      opponents: richOpp,
      round: 5,
      maxRounds: 5,
    })
    const leadEnd = resolveCashReserve({
      player: { ...poor, cash: 40000, bens: 30000 },
      opponents: weakOpp,
      round: 5,
      maxRounds: 5,
    })
    assert.ok(behindEnd < leadEnd)
    assert.ok(behindEnd < BOT_STRATEGY.minimumCashReserve * BOT_STRATEGY.phaseReserve[BOT_PHASE_END])
  })
})
