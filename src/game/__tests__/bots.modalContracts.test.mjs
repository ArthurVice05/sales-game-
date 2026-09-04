/**
 * Paridade de payloads: builders da máquina vs contratos reais das modais humanas.
 */
import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  ACTION_SKIP,
  buildMixBuyPayload,
  buildErpBuyPayload,
  buildClientsBuyPayload,
  buildCommonSellersBuyPayload,
  buildFieldSalesBuyPayload,
  buildInsideSalesBuyPayload,
  buildManagerBuyPayload,
  buildDirectOpenPayload,
  buildTrainingBuyPayload,
  buildRevenueConfirmPayload,
  buildExpensesConfirmPayload,
  buildLoanPayload,
  buildFirePayload,
  buildReducePayload,
  buildTriggerBankruptcyPayload,
  chooseInsufficientFundsAction,
} from '../bots/botModalContracts.js'
import { inferBotDecisionKindByTypeName } from '../bots/botDecisionKind.js'
import { requestTurnDecision } from '../bots/botDecisionProvider.js'

const __dirname = dirname(fileURLToPath(import.meta.url))
const modalsDir = join(__dirname, '../../modals')

function modalSrc(name) {
  return readFileSync(join(modalsDir, name), 'utf8')
}

const starter = {
  id: 'bot:m:0',
  name: 'Máquina 1',
  isBot: true,
  controller: 'BOT',
  cash: 25000,
  bens: 10000,
  mixProdutos: 'D',
  erpLevel: 'D',
  clients: 1,
  vendedoresComuns: 1,
}

describe('contratos de modal — paridade com componentes reais', () => {
  it('MIX: BUY ou SKIP', () => {
    const src = modalSrc('MixProductsModal.jsx')
    assert.match(src, /action:'BUY'/)
    assert.match(src, /action:'SKIP'/)
    const buy = buildMixBuyPayload('C')
    assert.equal(buy.action, 'BUY')
    assert.equal(buy.level, 'C')
    assert.ok('compra' in buy)
    assert.deepEqual(ACTION_SKIP, { action: 'SKIP' })
  })

  it('ERP: BUY ou SKIP', () => {
    const src = modalSrc('ERPSystemsModal.jsx')
    assert.match(src, /action: 'BUY'/)
    assert.match(src, /action: 'SKIP'/)
    const buy = buildErpBuyPayload('B')
    assert.equal(buy.action, 'BUY')
    assert.equal(buy.level, 'B')
    assert.ok(buy.values)
  })

  it('clientes: BUY com qty/totalCost', () => {
    const src = modalSrc('BuyClientsModal.jsx')
    assert.match(src, /action: 'BUY'/)
    assert.match(src, /action: 'SKIP'/)
    const buy = buildClientsBuyPayload(2)
    assert.equal(buy.action, 'BUY')
    assert.equal(buy.qty, 2)
    assert.equal(buy.clientsAdded, 2)
    assert.equal(buy.source.modal, 'BuyClientsModal')
  })

  it('vendedores comuns / field / inside / gestores: BUY ou SKIP', () => {
    assert.match(modalSrc('BuyCommonSellersModal.jsx'), /action:'BUY'|action: 'BUY'/)
    assert.match(modalSrc('BuyFieldSalesModal.jsx'), /action:'BUY'|action: 'BUY'/)
    assert.match(modalSrc('InsideSalesModal.jsx'), /action:'BUY'|action: 'BUY'/)
    assert.match(modalSrc('BuyManagerModal.jsx'), /action:'BUY'|action: 'BUY'/)
    assert.equal(buildCommonSellersBuyPayload(1).action, 'BUY')
    assert.equal(buildFieldSalesBuyPayload(1).action, 'BUY')
    assert.equal(buildInsideSalesBuyPayload(1).action, 'BUY')
    assert.equal(buildManagerBuyPayload(1).action, 'BUY')
  })

  it('treinamento: BUY', () => {
    assert.match(modalSrc('TrainingModal.jsx'), /action:'BUY'|action: 'BUY'/)
    const buy = buildTrainingBuyPayload({ vendorType: 'comum', productId: 'personalizado' })
    assert.equal(buy.action, 'BUY')
    assert.ok(Array.isArray(buy.purchases))
  })

  it('compra direta: OPEN ou SKIP', () => {
    const src = modalSrc('DirectBuyModal.jsx')
    assert.match(src, /action: 'OPEN'/)
    assert.match(src, /action: 'SKIP'/)
    assert.deepEqual(buildDirectOpenPayload('MIX'), { action: 'OPEN', open: 'MIX' })
  })

  it('faturamento: OK', () => {
    const src = modalSrc('FaturamentoMesModal.jsx')
    assert.match(src, /action: "OK"/)
    const p = buildRevenueConfirmPayload(1200)
    assert.equal(p.action, 'OK')
    assert.equal(p.value, 1200)
    assert.equal(p.source.modal, 'FaturamentoMesModal')
  })

  it('despesas: OK', () => {
    const src = modalSrc('DespesasOperacionaisModal.jsx')
    assert.match(src, /action: "OK"/)
    const p = buildExpensesConfirmPayload({ expense: 100, loanCharge: 50 })
    assert.equal(p.action, 'OK')
    assert.equal(p.total, 150)
  })

  it('recuperação financeira: LOAN | FIRE | REDUCE | TRIGGER_BANKRUPTCY', () => {
    const recovery = modalSrc('RecoveryModal.jsx')
    const loan = modalSrc('RecoveryLoan.jsx')
    const fire = modalSrc('RecoveryFire.jsx')
    assert.match(loan, /type: 'LOAN'/)
    assert.match(fire, /type: 'FIRE'/)
    assert.match(recovery, /type: 'REDUCE'/)
    assert.match(recovery, /type: 'TRIGGER_BANKRUPTCY'/)
    assert.equal(buildLoanPayload(500).type, 'LOAN')
    assert.equal(buildTriggerBankruptcyPayload().type, 'TRIGGER_BANKRUPTCY')
    const fired = buildFirePayload({ vendedoresComuns: 2 }, { comum: 1 })
    assert.equal(fired.type, 'FIRE')
    const reduced = buildReducePayload([{ key: 'mix-C', group: 'MIX', level: 'C', credit: 10 }])
    assert.equal(reduced.type, 'REDUCE')
  })

  it('falência: BankruptcyModal reconhecido', () => {
    assert.equal(inferBotDecisionKindByTypeName('BankruptcyModal'), 'BANKRUPT')
  })

  it('InsufficientFunds: ACK, RECOVERY ou BANKRUPT — nunca SKIP', () => {
    const src = modalSrc('InsufficientFundsModal.jsx')
    assert.match(src, /action: 'ACK'/)
    assert.match(src, /action: 'RECOVERY'/)
    assert.match(src, /action: 'BANKRUPT'/)
    const rich = chooseInsufficientFundsAction({ ...starter, cash: 99999 }, { requiredAmount: 10 })
    assert.equal(rich.action, 'ACK')
    const recover = chooseInsufficientFundsAction(
      { ...starter, cash: 0, bens: 50000, loanTakenInMatch: false },
      { requiredAmount: 100 },
    )
    assert.ok(['RECOVERY', 'BANKRUPT'].includes(recover.action))
    assert.notEqual(recover.action, 'SKIP')
    const broke = chooseInsufficientFundsAction(
      {
        ...starter,
        cash: 0,
        bens: 0,
        vendedoresComuns: 0,
        fieldSales: 0,
        insideSales: 0,
        gestores: 0,
        loanTakenInMatch: true,
      },
      { requiredAmount: 50_000 },
    )
    assert.equal(broke.action, 'BANKRUPT')
  })

  it('requestTurnDecision InsufficientFunds nunca devolve SKIP', async () => {
    const payload = await requestTurnDecision({
      kind: 'INSUFFICIENT_FUNDS',
      actor: { ...starter, cash: 0 },
      gameState: { players: [starter], round: 1, maxRounds: 5 },
      context: { requiredAmount: 8000, currentCash: 0 },
    })
    assert.notEqual(payload.action, 'SKIP')
    assert.ok(['ACK', 'RECOVERY', 'BANKRUPT'].includes(payload.action))
  })
})
