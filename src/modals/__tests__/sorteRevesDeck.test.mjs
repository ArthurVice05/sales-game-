import test from 'node:test'
import assert from 'node:assert/strict'

import { SORTE_REVES_CARDS, resolveCardEffect } from '../sorteRevesDeck.js'
import { applyDeltas } from '../../game/gameMath.js'

/**
 * AUDITORIA — Sorte & Revés (§30, §31, §32, §33, §34).
 *
 * Uma carta por teste, com efeito verificado. Os valores esperados são
 * escritos à mão (§161) — nunca derivados de `card.cashDelta`.
 */

const byId = (id) => {
  const c = SORTE_REVES_CARDS.find((x) => x.id === id)
  assert.ok(c, `carta inexistente no baralho: ${id}`)
  return c
}
const efeito = (id, player = {}) => resolveCardEffect(byId(id), player).payload
const texto = (id, player = {}) => resolveCardEffect(byId(id), player).text

/* ===================== INVENTÁRIO DO BARALHO (§30) ===================== */

test('o baralho tem 34 cartas, ids unicos e metadados completos', () => {
  assert.equal(SORTE_REVES_CARDS.length, 34)

  const ids = SORTE_REVES_CARDS.map((c) => c.id)
  assert.equal(new Set(ids).size, ids.length, 'ids duplicados no baralho')

  for (const c of SORTE_REVES_CARDS) {
    assert.ok(c.id && typeof c.id === 'string', `id invalido: ${c.id}`)
    assert.ok(['SORTE', 'REVES'].includes(c.kind), `kind invalido em ${c.id}: ${c.kind}`)
    assert.ok(c.title && typeof c.title === 'string', `titulo ausente em ${c.id}`)
    assert.ok(c.text && typeof c.text === 'string', `texto ausente em ${c.id}`)
    // toda carta precisa ter algum efeito declarado ou calculado
    const temEfeito =
      typeof c._compute === 'function' ||
      Number.isFinite(c.cashDelta) ||
      Number.isFinite(c.clientsDelta)
    assert.ok(temEfeito, `carta sem efeito algum: ${c.id}`)
  }
})

test('distribuicao SORTE/REVES do baralho', () => {
  const sorte = SORTE_REVES_CARDS.filter((c) => c.kind === 'SORTE')
  const reves = SORTE_REVES_CARDS.filter((c) => c.kind === 'REVES')
  assert.equal(sorte.length, 16)
  assert.equal(reves.length, 18)
})

test('TODA carta resolve para um payload finito, em qualquer estado de jogador (§32)', () => {
  const jogadores = [
    {},
    { cash: 0, clients: 0 },
    { az: 1, am: 1, rox: 1, clients: 10, mixProdutos: 'A', erpLevel: 'A' },
    { az: 0, am: 0, rox: 0, clients: 0, mixProdutos: 'D', erpLevel: 'D' },
    { clients: 999, vendedoresComuns: 9, insideSales: 9, fieldSales: 9, gestores: 9 },
    { clients: NaN, vendedoresComuns: undefined, mixProdutos: null },
    { trainingsByVendor: { gestor: ['a', 'b', 'c'] }, gestores: 3 },
  ]

  for (const card of SORTE_REVES_CARDS) {
    for (const p of jogadores) {
      const { payload, text } = resolveCardEffect(card, p)

      assert.equal(payload.action, 'APPLY_CARD', `action errada em ${card.id}`)
      assert.equal(payload.id, card.id)
      assert.equal(payload.kind, card.kind)
      assert.ok(typeof text === 'string' && text.length > 0, `texto vazio em ${card.id}`)

      if ('cashDelta' in payload) {
        assert.ok(
          Number.isFinite(payload.cashDelta),
          `cashDelta nao finito em ${card.id}: ${payload.cashDelta}`
        )
      }
      if ('clientsDelta' in payload) {
        assert.ok(
          Number.isFinite(payload.clientsDelta),
          `clientsDelta nao finito em ${card.id}: ${payload.clientsDelta}`
        )
        assert.ok(Number.isInteger(payload.clientsDelta), `clientsDelta fracionario em ${card.id}`)
      }
    }
  }
})

test('cartas de SORTE nunca cobram e cartas de REVES nunca premiam em caixa', () => {
  const p = { clients: 3, vendedoresComuns: 2, gestores: 1, az: 1, am: 1, rox: 1, mixProdutos: 'A', erpLevel: 'A' }
  for (const card of SORTE_REVES_CARDS) {
    const { payload } = resolveCardEffect(card, p)
    const cash = payload.cashDelta ?? 0
    if (card.kind === 'SORTE') {
      assert.ok(cash >= 0, `carta de SORTE cobrando dinheiro: ${card.id} (${cash})`)
    } else {
      assert.ok(cash <= 0, `carta de REVES pagando dinheiro: ${card.id} (${cash})`)
    }
  }
})

/* ========================= SORTE — uma por carta ======================== */

test('referral_bonus: recebe 800 fixos', () => {
  assert.equal(efeito('referral_bonus').cashDelta, 800)
})

test('network_cert_mgr: 5.000 por gestor certificado', () => {
  assert.equal(efeito('network_cert_mgr', {}).cashDelta, 0)
  assert.equal(efeito('network_cert_mgr', { trainingsByVendor: { gestor: ['x'] } }).cashDelta, 5_000)
  assert.equal(efeito('network_cert_mgr', { trainingsByVendor: { gestor: ['x', 'y', 'z'] } }).cashDelta, 15_000)
  // certificados repetidos contam uma vez (Set)
  assert.equal(efeito('network_cert_mgr', { trainingsByVendor: { gestor: ['x', 'x'] } }).cashDelta, 5_000)
})

test('innovation_invest: 25.000 apenas com mix A ou B', () => {
  assert.equal(efeito('innovation_invest', { mixProdutos: 'A' }).cashDelta, 25_000)
  assert.equal(efeito('innovation_invest', { mixProdutos: 'B' }).cashDelta, 25_000)
  assert.equal(efeito('innovation_invest', { mixProdutos: 'C' }).cashDelta, 0)
  assert.equal(efeito('innovation_invest', { mixProdutos: 'D' }).cashDelta, 0)
  assert.equal(efeito('innovation_invest', {}).cashDelta, 0)
})

test('segmentation: recebe 1.000 fixos', () => {
  assert.equal(efeito('segmentation').cashDelta, 1_000)
})

test('casa_bonus_10k: recebe 10.000', () => {
  assert.equal(efeito('casa_bonus_10k').cashDelta, 10_000)
})

test('casa_network_7k: recebe 7.000', () => {
  assert.equal(efeito('casa_network_7k').cashDelta, 7_000)
})

test('casa_strategy_5k: recebe 5.000', () => {
  assert.equal(efeito('casa_strategy_5k').cashDelta, 5_000)
})

test('casa_best_practices_8k: recebe 8.000', () => {
  assert.equal(efeito('casa_best_practices_8k').cashDelta, 8_000)
})

test('casa_start_6k: recebe 6.000', () => {
  assert.equal(efeito('casa_start_6k').cashDelta, 6_000)
})

test('casa_change_cert_blue: concede certificado azul, sem mexer no caixa', () => {
  const e = efeito('casa_change_cert_blue', { az: 0 })
  assert.deepEqual(e.certDelta, { az: 1 })
  assert.equal(e.cashDelta, undefined, 'carta de certificado nao pode mexer em caixa')
})

test('training_roi_team: 500 por membro do time', () => {
  assert.equal(efeito('training_roi_team', {}).cashDelta, 0)
  assert.equal(
    efeito('training_roi_team', { vendedoresComuns: 2, insideSales: 1, fieldSales: 1, gestores: 1 }).cashDelta,
    500 * 5
  )
  // nunca negativo mesmo com time negativo
  assert.ok(efeito('training_roi_team', { vendedoresComuns: -5 }).cashDelta >= 0)
})

test('purple_award_25k: 25.000 apenas com certificado roxo', () => {
  assert.equal(efeito('purple_award_25k', { rox: 1 }).cashDelta, 25_000)
  assert.equal(efeito('purple_award_25k', { certPurple: true }).cashDelta, 25_000)
  assert.equal(efeito('purple_award_25k', { rox: 0 }).cashDelta, 0)
  assert.equal(efeito('purple_award_25k', {}).cashDelta, 0)
})

test('reputation_1500: recebe 1.500', () => {
  assert.equal(efeito('reputation_1500').cashDelta, 1_500)
})

test('client_cheer_per_client: 500 por cliente atual', () => {
  assert.equal(efeito('client_cheer_per_client', { clients: 0 }).cashDelta, 0)
  assert.equal(efeito('client_cheer_per_client', { clients: 4 }).cashDelta, 2_000)
  assert.ok(efeito('client_cheer_per_client', { clients: -3 }).cashDelta >= 0, 'nao pode cobrar')
})

test('big_order_freight_save: recebe 1.500', () => {
  assert.equal(efeito('big_order_freight_save').cashDelta, 1_500)
})

test('sales_win_2k: recebe 2.000', () => {
  assert.equal(efeito('sales_win_2k').cashDelta, 2_000)
})

/* ========================= REVÉS — uma por carta ======================== */

test('missed_admission: paga 3.000', () => {
  assert.equal(efeito('missed_admission').cashDelta, -3_000)
})

test('no_mix_a_pay_7000: paga 7.000 se nao tiver Mix A', () => {
  assert.equal(efeito('no_mix_a_pay_7000', { mixProdutos: 'A' }).cashDelta, 0)
  assert.equal(efeito('no_mix_a_pay_7000', { mixProdutos: 'B' }).cashDelta, -7_000)
  assert.equal(efeito('no_mix_a_pay_7000', {}).cashDelta, -7_000)
})

test('key_client_at_risk: certificado amarelo anula a penalidade', () => {
  const semCert = efeito('key_client_at_risk', { am: 0 })
  assert.equal(semCert.cashDelta, -2_000)
  assert.equal(semCert.clientsDelta, -1)

  const comCert = efeito('key_client_at_risk', { am: 1 })
  assert.equal(comCert.cashDelta, 0)
  assert.equal(comCert.clientsDelta, 0)
  assert.match(texto('key_client_at_risk', { am: 1 }), /amarelo/i)
})

test('social_crisis: paga 400 e perde 2 clientes', () => {
  const e = efeito('social_crisis')
  assert.equal(e.cashDelta, -400)
  assert.equal(e.clientsDelta, -2)
})

test('car_break: paga 1.000', () => {
  assert.equal(efeito('car_break').cashDelta, -1_000)
})

test('service_improvement_1k: paga 1.000', () => {
  assert.equal(efeito('service_improvement_1k').cashDelta, -1_000)
})

test('recovery_failed_5k: paga 5.000', () => {
  assert.equal(efeito('recovery_failed_5k').cashDelta, -5_000)
})

test('discount_pressure_1k: paga 1.000', () => {
  assert.equal(efeito('discount_pressure_1k').cashDelta, -1_000)
})

test('domino_2k: paga 2.000', () => {
  assert.equal(efeito('domino_2k').cashDelta, -2_000)
})

test('needs_change_lose4: certificado azul anula a perda de 4 clientes', () => {
  assert.equal(efeito('needs_change_lose4', { az: 0 }).clientsDelta, -4)
  assert.equal(efeito('needs_change_lose4', { az: 1 }).clientsDelta, 0)
  assert.match(texto('needs_change_lose4', { az: 1 }), /azul/i)
})

test('payroll_error_1k: paga 1.000', () => {
  assert.equal(efeito('payroll_error_1k').cashDelta, -1_000)
})

test('strike_lose5: perde 5 clientes sem custo de caixa', () => {
  const e = efeito('strike_lose5')
  assert.equal(e.clientsDelta, -5)
  assert.equal(e.cashDelta, undefined)
})

test('customs_hold_3k: paga 3.000', () => {
  assert.equal(efeito('customs_hold_3k').cashDelta, -3_000)
})

test('cyber_breach_7k_or_A: paga 7.000 sem ERP nivel A', () => {
  assert.equal(efeito('cyber_breach_7k_or_A', { erpLevel: 'A' }).cashDelta, 0)
  assert.equal(efeito('cyber_breach_7k_or_A', { erpSistemas: 'A' }).cashDelta, 0)
  assert.equal(efeito('cyber_breach_7k_or_A', { erpLevel: 'B' }).cashDelta, -7_000)
  assert.equal(efeito('cyber_breach_7k_or_A', {}).cashDelta, -7_000)
})

test('supplier_issue_2k: paga 2.000', () => {
  assert.equal(efeito('supplier_issue_2k').cashDelta, -2_000)
})

test('reg_change_10k: paga 10.000', () => {
  assert.equal(efeito('reg_change_10k').cashDelta, -10_000)
})

test('bad_mix_2500: paga 2.500', () => {
  assert.equal(efeito('bad_mix_2500').cashDelta, -2_500)
})

test('quality_crisis: paga 1.000 e perde 1 cliente', () => {
  const e = efeito('quality_crisis')
  assert.equal(e.cashDelta, -1_000)
  assert.equal(e.clientsDelta, -1)
})

/* ============= DINHEIRO INSUFICIENTE E DUPLICIDADE (§33, §34) ============ */

test('carta de custo alto nao muda de valor conforme o caixa do jogador (§33)', () => {
  // A regra de caixa insuficiente é do motor (recuperação/falência), não da carta.
  for (const cash of [0, 1, 9_999, 10_000, 10_001, -5_000]) {
    assert.equal(
      efeito('reg_change_10k', { cash }).cashDelta,
      -10_000,
      `carta mudou de valor com cash=${cash}`
    )
  }
})

test('resolver a MESMA carta duas vezes produz payload identico e sem acumulo (§34)', () => {
  for (const card of SORTE_REVES_CARDS) {
    const p = { cash: 50_000, clients: 5, az: 0, am: 0, rox: 0, mixProdutos: 'C', erpLevel: 'C', gestores: 2 }
    const a = resolveCardEffect(card, p)
    const b = resolveCardEffect(card, p)
    assert.deepEqual(a.payload, b.payload, `resolucao nao determinista em ${card.id}`)
    assert.equal(a.text, b.text, `texto nao determinista em ${card.id}`)
  }
})

test('resolver a carta NAO muta o jogador recebido (§137)', () => {
  for (const card of SORTE_REVES_CARDS) {
    const p = { cash: 10_000, clients: 3, az: 1, am: 1, rox: 1, gestores: 2, mixProdutos: 'B', erpLevel: 'B' }
    const copia = JSON.parse(JSON.stringify(p))
    resolveCardEffect(card, p)
    assert.deepEqual(p, copia, `carta ${card.id} mutou o jogador`)
  }
})

test('aplicar qualquer carta via applyDeltas mantem o caixa finito', () => {
  for (const card of SORTE_REVES_CARDS) {
    const p = { id: 'x', cash: 10_000, clients: 5 }
    const { payload } = resolveCardEffect(card, p)
    const depois = applyDeltas(p, payload)
    assert.ok(Number.isFinite(depois.cash), `caixa nao finito apos ${card.id}: ${depois.cash}`)
    assert.ok(Number.isFinite(depois.clients), `clientes nao finito apos ${card.id}`)
  }
})

test('o pior revés de caixa e -10.000 e o melhor ganho fixo e +25.000', () => {
  const p = { clients: 0, vendedoresComuns: 0, gestores: 0, az: 0, am: 0, rox: 1, mixProdutos: 'A', erpLevel: 'D' }
  const valores = SORTE_REVES_CARDS.map((c) => resolveCardEffect(c, p).payload.cashDelta ?? 0)
  assert.equal(Math.min(...valores), -10_000, 'pior revés mudou — revalidar recuperação/falência')
  assert.equal(Math.max(...valores), 25_000, 'melhor sorte mudou')
})
