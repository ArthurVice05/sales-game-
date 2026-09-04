import test from 'node:test'
import assert from 'node:assert/strict'

import {
  applyLoanCharge,
  applyLoanTake,
  armLoanAfterRevenue,
  buildRecoveryFireDeltas,
  canTakeLoan,
  clampFireItems,
  clampLoanAmount,
  computeRecoveryFireCredit,
  createLoanPending,
  ensureLoanId,
  loanChargeAmount,
  loanDueRound,
  shouldChargeLoan,
} from '../loanCycle.js'
import { MANUAL_CONSTANTS } from '../manualConstants.js'
import { applyDeltas } from '../gameMath.js'
import { normalizePlayersAliases } from '../playerShape.js'

/**
 * AUDITORIA — ciclo de empréstimo (§17, §18, §19, §20, §10, §140, §141).
 *
 * Regra do manual, confirmada no código:
 *   1 empréstimo por partida; teto = floor(bens * 0.5);
 *   quita com principal + floor(principal * 0.5) nas despesas da rodada seguinte.
 *
 * Os valores esperados são calculados de forma INDEPENDENTE (§161): nunca
 * reaproveitando a função de produção que está sob teste.
 */

const RATIO = MANUAL_CONSTANTS.loanMaxBensRatio   // 0.5
const JUROS = MANUAL_CONSTANTS.loanInterestRatio  // 0.5

const basePlayer = (over = {}) => ({
  id: 'p1',
  cash: 10_000,
  bens: 20_000,
  loanTakenInMatch: false,
  loanPending: null,
  lastChargedLoanId: null,
  ...over,
})

let idSeq = 0
const fakeId = () => `loan-fixo-${++idSeq}`

/* ------------------------------------------------------- teto e elegibilidade */

test('clampLoanAmount respeita o teto de 50% dos bens em toda a faixa', () => {
  for (const bens of [0, 1, 999, 1000, 4000, 20_000, 123_457]) {
    const teto = Math.floor(bens * RATIO)
    for (const pedido of [0, 1, teto - 1, teto, teto + 1, teto * 10, 1e9]) {
      if (pedido < 0) continue
      const got = clampLoanAmount(pedido, bens)
      const esperado = Math.max(0, Math.min(Math.floor(pedido), teto))
      assert.equal(got, esperado, `bens=${bens} pedido=${pedido}`)
      assert.ok(got <= teto, 'estourou o teto')
      assert.ok(Number.isInteger(got), 'valor nao inteiro')
    }
  }
})

test('clampLoanAmount e fail-safe para todo pedido sujo', () => {
  for (const v of [NaN, undefined, null, -1, -1e9, 'abc', Infinity, -Infinity]) {
    const got = clampLoanAmount(v, 20_000)
    assert.ok(Number.isFinite(got) && got >= 0, `pedido=${String(v)} -> ${got}`)
  }
})

test('bens nao-numerico produz NaN no clamp, mas applyLoanTake CONTEM o NaN', () => {
  // Caracterização: `bens` truthy e nao-numerico escapa do `|| 0` e vira NaN.
  assert.ok(Number.isNaN(clampLoanAmount(5000, 'abc')))
  assert.ok(Number.isNaN(clampLoanAmount(5000, {})))
  // Valores falsy (NaN, null, undefined, 0) caem em 0 e nao propagam NaN.
  assert.equal(clampLoanAmount(5000, NaN), 0)
  assert.equal(clampLoanAmount(5000, null), 0)

  // O invariante que importa (§9): NaN nunca pode chegar ao caixa.
  for (const bens of ['abc', NaN, {}, [], 'R$ 20.000']) {
    const p = basePlayer({ cash: 10_000, bens })
    const r = applyLoanTake(p, 5000, 1)
    assert.equal(r.ok, false, `bens=${String(bens)} deveria recusar`)
    assert.equal(r.reason, 'zero-amount')
    assert.equal(r.player.cash, 10_000, 'caixa foi tocado')
    assert.ok(Number.isFinite(r.player.cash), 'caixa virou nao-finito')
  }

  // bens numericos porem invalidos continuam recusando sem sujar o caixa
  for (const bens of [null, undefined, -5000, 0]) {
    const r = applyLoanTake(basePlayer({ cash: 10_000, bens }), 5000, 1)
    assert.equal(r.ok, false)
    assert.equal(r.player.cash, 10_000)
  }
})

test('canTakeLoan bloqueia segunda vez e pendencia em aberto', () => {
  assert.equal(canTakeLoan(basePlayer()), true)
  assert.equal(canTakeLoan(basePlayer({ loanTakenInMatch: true })), false)
  assert.equal(
    canTakeLoan(basePlayer({ loanPending: { amount: 5000, charged: false } })),
    false
  )
  // pendencia já quitada não bloqueia por si só
  assert.equal(
    canTakeLoan(basePlayer({ loanPending: { amount: 5000, charged: true } })),
    true
  )
})

/* --------------------------------------------------------------- take (§17) */

test('applyLoanTake credita exatamente o valor limitado e marca a partida', () => {
  const p = basePlayer({ cash: 10_000, bens: 20_000 })
  const r = applyLoanTake(p, 50_000, 2)

  assert.equal(r.ok, true)
  // expected independente: teto = floor(20000*0.5) = 10000
  assert.equal(r.player.cash, 10_000 + 10_000)
  assert.equal(r.player.loanTakenInMatch, true)
  assert.equal(r.player.loanPending.amount, 10_000)
  assert.equal(r.player.loanPending.charged, false)
  assert.equal(r.player.loanPending.declaredAtRound, 2)
  assert.equal(r.player.loanPending.dueRound, 3)
  // não pode mutar o jogador original
  assert.equal(p.cash, 10_000)
  assert.equal(p.loanTakenInMatch, false)
})

test('applyLoanTake recusa quando o teto resulta em zero', () => {
  const semBens = applyLoanTake(basePlayer({ bens: 0 }), 5000, 1)
  assert.equal(semBens.ok, false)
  assert.equal(semBens.reason, 'zero-amount')
  assert.equal(semBens.player.cash, 10_000, 'nao pode creditar nada')

  const bensBaixos = applyLoanTake(basePlayer({ bens: 1 }), 5000, 1)
  assert.equal(bensBaixos.ok, false, 'floor(1*0.5)=0 deve recusar')
})

test('EMPRESTIMO DUPLICADO: segunda tentativa nao credita de novo (§18)', () => {
  const p = basePlayer({ cash: 10_000, bens: 20_000 })
  const primeiro = applyLoanTake(p, 10_000, 1)
  assert.equal(primeiro.ok, true)
  const caixaAposPrimeiro = primeiro.player.cash

  // double click / callback duplicado sobre o estado JÁ atualizado
  const segundo = applyLoanTake(primeiro.player, 10_000, 1)
  assert.equal(segundo.ok, false)
  assert.equal(segundo.reason, 'already-used')
  assert.equal(segundo.player.cash, caixaAposPrimeiro, 'creditou duas vezes')

  // e uma terceira também
  const terceiro = applyLoanTake(segundo.player, 10_000, 1)
  assert.equal(terceiro.ok, false)
  assert.equal(terceiro.player.cash, caixaAposPrimeiro)
})

test('applyLoanTake duplicado sobre estado STALE nao pode passar (§141)', () => {
  const p = basePlayer({ cash: 10_000, bens: 20_000 })
  const primeiro = applyLoanTake(p, 10_000, 1)
  // callback atrasado reenviando o estado ANTERIOR: aqui o guard e do chamador,
  // entao documentamos que o helper puro por si so nao protege.
  const stale = applyLoanTake(p, 10_000, 1)
  assert.equal(stale.ok, true, 'helper puro nao ve o estado novo')
  // O invariante real e que o motor use sempre o player mais recente:
  assert.equal(primeiro.player.loanTakenInMatch, true)
  assert.equal(canTakeLoan(primeiro.player), false)
})

/* ------------------------------------------------------- due round e arming */

test('loanDueRound sempre aponta para a rodada seguinte', () => {
  for (let r = 1; r <= 10; r += 1) assert.equal(loanDueRound(r), r + 1)
  assert.equal(loanDueRound(0), 0)
  assert.equal(loanDueRound(-5), 0)
  assert.equal(loanDueRound(NaN), 0)
})

test('armLoanAfterRevenue e idempotente e nao mexe em pendencia quitada', () => {
  const lp = createLoanPending(8000, 1)
  const armado = armLoanAfterRevenue(lp)
  assert.equal(armado.eligibleOnExpenses, true)
  assert.equal(armado.waitingFullLap, false)

  // duplicar a passagem pelo faturamento nao altera nada
  assert.deepEqual(armLoanAfterRevenue(armado), armado)

  const quitada = { ...lp, charged: true }
  assert.deepEqual(armLoanAfterRevenue(quitada), quitada)
  assert.equal(armLoanAfterRevenue(null), null)
})

/* ------------------------------------------------------------ cobranca (§19) */

test('loanChargeAmount cobra principal + 50% de juros, com expected independente', () => {
  for (const principal of [0, 1, 999, 1000, 7777, 10_000, 123_457]) {
    const esperado = principal + Math.floor(principal * JUROS)
    assert.equal(loanChargeAmount({ amount: principal }), esperado, `principal=${principal}`)
  }
  assert.equal(loanChargeAmount(null), 0)
  assert.equal(loanChargeAmount({ amount: NaN }), 0)
})

test('shouldChargeLoan exige loanId — sem id o emprestimo nunca seria cobrado', () => {
  const semId = { ...createLoanPending(5000, 1), loanId: undefined }
  assert.equal(
    shouldChargeLoan({ loanPending: semId, currentRound: 99 }),
    false,
    'sem id deve recusar (o motor precisa chamar ensureLoanId antes)'
  )

  const comId = ensureLoanId(semId, 'p1', fakeId)
  assert.ok(comId.loanId, 'ensureLoanId precisa atribuir id')
  assert.equal(shouldChargeLoan({ loanPending: comId, currentRound: 2 }), true)
})

test('ensureLoanId e idempotente e nao troca id existente', () => {
  const lp = createLoanPending(5000, 1)
  const a = ensureLoanId(lp, 'p1', fakeId)
  const b = ensureLoanId(a, 'p1', fakeId)
  assert.equal(a.loanId, b.loanId, 'id trocou na segunda chamada')
  assert.equal(ensureLoanId(null, 'p1', fakeId), null)
  assert.equal(ensureLoanId({ amount: 0 }, 'p1', fakeId).loanId, undefined)
})

test('shouldChargeLoan respeita a rodada de vencimento', () => {
  const lp = ensureLoanId(createLoanPending(5000, 3), 'p1', fakeId) // dueRound=4
  assert.equal(shouldChargeLoan({ loanPending: lp, currentRound: 3 }), false, 'antes do vencimento')
  assert.equal(shouldChargeLoan({ loanPending: lp, currentRound: 4 }), true, 'na rodada de vencimento')
  assert.equal(shouldChargeLoan({ loanPending: lp, currentRound: 9 }), true, 'depois do vencimento')
})

test('shouldChargeLoan nao recobra o mesmo loanId', () => {
  const lp = ensureLoanId(createLoanPending(5000, 1), 'p1', fakeId)
  assert.equal(shouldChargeLoan({ loanPending: lp, currentRound: 2 }), true)
  assert.equal(
    shouldChargeLoan({ loanPending: lp, lastChargedLoanId: lp.loanId, currentRound: 2 }),
    false,
    'recobrou emprestimo ja quitado'
  )
})

test('COBRANCA DUPLICADA: applyLoanCharge duas vezes debita uma so (§10, §144)', () => {
  const p = basePlayer({ cash: 30_000, bens: 20_000 })
  const take = applyLoanTake(p, 10_000, 1)
  const armado = { ...take.player, loanPending: armLoanAfterRevenue(take.player.loanPending) }

  const caixaAntes = armado.cash
  const primeira = applyLoanCharge(armado, fakeId, { currentRound: 2 })
  assert.equal(primeira.charged, true)
  // expected independente: 10000 + floor(10000*0.5) = 15000
  assert.equal(primeira.amount, 15_000)
  assert.equal(primeira.player.cash, caixaAntes - 15_000)
  assert.equal(primeira.player.loanPending, null)

  // callback duplicado sobre o estado JÁ cobrado
  const segunda = applyLoanCharge(primeira.player, fakeId, { currentRound: 2 })
  assert.equal(segunda.charged, false, 'cobrou duas vezes')
  assert.equal(segunda.amount, 0)
  assert.equal(segunda.player.cash, primeira.player.cash, 'caixa mudou na segunda cobranca')

  // e uma terceira, em rodada posterior, continua sem cobrar
  const terceira = applyLoanCharge(segunda.player, fakeId, { currentRound: 5 })
  assert.equal(terceira.charged, false)
  assert.equal(terceira.player.cash, primeira.player.cash)
})

test('applyLoanCharge nao cobra antes do vencimento (§19)', () => {
  const p = basePlayer({ cash: 30_000, bens: 20_000 })
  const take = applyLoanTake(p, 10_000, 3) // dueRound = 4
  const r = applyLoanCharge(take.player, fakeId, { currentRound: 3 })
  assert.equal(r.charged, false)
  assert.equal(r.player.cash, take.player.cash, 'debitou antes da hora')
  // a pendencia continua viva para a rodada seguinte
  assert.ok(r.player.loanPending)
  assert.equal(r.player.loanPending.charged, false)
})

test('ciclo completo take -> revenue -> expenses fecha o caixa exatamente', () => {
  const caixaInicial = 18_000
  const bens = 20_000
  const p = basePlayer({ cash: caixaInicial, bens })

  const take = applyLoanTake(p, 999_999, 1)      // clamp -> 10000
  const armado = { ...take.player, loanPending: armLoanAfterRevenue(take.player.loanPending) }
  const cobrado = applyLoanCharge(armado, fakeId, { currentRound: 2 })

  // expected calculado a mao: +10000 no take, -15000 na cobranca
  assert.equal(cobrado.player.cash, caixaInicial + 10_000 - 15_000)
  assert.ok(Number.isFinite(cobrado.player.cash))
  assert.ok(Number.isInteger(cobrado.player.cash))
  // e continua bloqueado para um segundo emprestimo na partida
  assert.equal(canTakeLoan(cobrado.player), false)
})

test('emprestimo pode deixar o caixa negativo — regra atual, sem clamp silencioso', () => {
  const p = basePlayer({ cash: 0, bens: 20_000 })
  const take = applyLoanTake(p, 10_000, 1)
  const armado = { ...take.player, loanPending: armLoanAfterRevenue(take.player.loanPending) }
  const cobrado = applyLoanCharge(armado, fakeId, { currentRound: 2 })
  // 0 + 10000 - 15000 = -5000 (o motor trata via recuperação/falência)
  assert.equal(cobrado.player.cash, -5_000)
  assert.ok(Number.isFinite(cobrado.player.cash), 'caixa virou nao-finito')
})

/* ------------------------------------------------ recuperacao por demissao */

test('clampFireItems nunca demite mais do que o time possui', () => {
  const p = basePlayer({ vendedoresComuns: 2, fieldSales: 1, insideSales: 0, gestores: 3 })
  const c = clampFireItems(p, { comum: 99, field: 99, inside: 99, gestor: 99 })
  assert.deepEqual(c, { comum: 2, field: 1, inside: 0, gestor: 3 })

  const neg = clampFireItems(p, { comum: -5, field: -1, inside: -1, gestor: -1 })
  for (const v of Object.values(neg)) assert.ok(v >= 0, 'quantidade negativa')

  // NaN/undefined caem em 0 (sao falsy, entao `|| 0` salva); 1.9 vira 1.
  const sujo = clampFireItems(p, { comum: NaN, field: undefined, inside: null, gestor: 1.9 })
  assert.deepEqual(sujo, { comum: 0, field: 0, inside: 0, gestor: 1 })
})

test('string nao-numerica em itens produz NaN no clamp, mas nao corrompe caixa nem time', () => {
  const p = basePlayer({ vendedoresComuns: 2, fieldSales: 1, insideSales: 3, gestores: 1, cash: 500 })

  // Caracterização: 'x' e truthy, entao escapa do `|| 0` e vira NaN.
  const clamped = clampFireItems(p, { inside: 'x' })
  assert.ok(Number.isNaN(clamped.inside), 'caracterizacao mudou')

  // Invariante que importa (§9/§136): o credito continua finito...
  const { credit, deltas } = buildRecoveryFireDeltas(p, { inside: 'x' })
  assert.ok(Number.isFinite(credit) && credit >= 0, `credito invalido: ${credit}`)

  // ...e applyDeltas descarta delta nao-finito, deixando o contador intacto.
  const depois = applyDeltas(p, deltas)
  assert.equal(depois.insideSales, 3, 'contador foi corrompido por NaN')
  assert.ok(Number.isFinite(depois.cash), 'caixa virou nao-finito')
  for (const k of ['vendedoresComuns', 'fieldSales', 'insideSales', 'gestores']) {
    assert.ok(Number.isFinite(depois[k]) && depois[k] >= 0, `${k} invalido: ${depois[k]}`)
  }
})

test('credito de demissao e sempre finito e nao negativo', () => {
  const p = basePlayer({ vendedoresComuns: 4, fieldSales: 4, insideSales: 4, gestores: 4 })
  for (const q of [0, 1, 2, 4, 99]) {
    const { credit, deltas, items } = buildRecoveryFireDeltas(p, {
      comum: q, field: q, inside: q, gestor: q,
    })
    assert.ok(Number.isFinite(credit) && credit >= 0, `credito invalido: ${credit}`)
    assert.ok(Number.isInteger(credit), 'credito nao inteiro')
    assert.equal(deltas.cashDelta, credit)
    // demissão nunca pode aumentar o time
    assert.ok(deltas.vendedoresComunsDelta <= 0)
    assert.ok(deltas.fieldSalesDelta <= 0)
    assert.ok(deltas.insideSalesDelta <= 0)
    assert.ok(deltas.gestoresDelta <= 0)
    // e nunca demite mais do que possui
    assert.ok(items.comum <= 4 && items.field <= 4 && items.inside <= 4 && items.gestor <= 4)
  }
  assert.equal(computeRecoveryFireCredit({}), 0)
})

test('recuperacao aplicada via applyDeltas zera o time e credita o caixa', () => {
  // Player NORMALIZADO (é o que o motor sempre produz via normalizePlayersAliases).
  const p = normalizePlayersAliases([
    basePlayer({ vendedoresComuns: 2, fieldSales: 1, insideSales: 1, gestores: 1, cash: 100 }),
  ])[0]

  const { deltas, credit } = buildRecoveryFireDeltas(p, { comum: 99, field: 99, inside: 99, gestor: 99 })
  const depois = applyDeltas(p, deltas)

  assert.equal(depois.cash, 100 + credit)
  assert.equal(depois.vendedoresComuns, 0)
  assert.equal(depois.fieldSales, 0)
  assert.equal(depois.insideSales, 0)
  assert.equal(depois.gestores, 0)
  // com o roster normalizado os tres aliases andam juntos
  assert.equal(depois.gestoresComerciais, 0)
  assert.equal(depois.managers, 0)
})

test('applyDeltas dessincroniza aliases de gestor se o player NAO passou por normalizacao', () => {
  // Caracterização de fragilidade (§96): partindo de um player que tem apenas
  // `gestores`, os outros dois aliases começam em 0 e vão a NEGATIVO.
  const naoNormalizado = { id: 'x', cash: 0, gestores: 1 }
  const depois = applyDeltas(naoNormalizado, { gestoresDelta: -1 })

  assert.equal(depois.gestores, 0)
  assert.equal(depois.gestoresComerciais, -1, 'caracterizacao mudou')
  assert.equal(depois.managers, -1, 'caracterizacao mudou')

  // A proteção real e normalizePlayersAliases, que o motor aplica em todo commit:
  const normalizado = normalizePlayersAliases([naoNormalizado])[0]
  const depoisOk = applyDeltas(normalizado, { gestoresDelta: -1 })
  assert.equal(depoisOk.gestores, 0)
  assert.equal(depoisOk.gestoresComerciais, 0, 'normalizacao deveria proteger')
  assert.equal(depoisOk.managers, 0, 'normalizacao deveria proteger')
})

test('normalizePlayersAliases mantem os tres aliases de gestor iguais e finitos', () => {
  const casos = [
    { id: 'a', gestores: 3 },
    { id: 'b', gestoresComerciais: 2 },
    { id: 'c', managers: 1 },
    { id: 'd' },
    { id: 'e', gestores: NaN },
    { id: 'f', gestores: -1 },
  ]
  for (const p of normalizePlayersAliases(casos)) {
    assert.equal(p.gestores, p.gestoresComerciais, `desync em ${p.id}`)
    assert.equal(p.gestores, p.managers, `desync em ${p.id}`)
    assert.ok(Number.isFinite(p.gestores), `nao finito em ${p.id}: ${p.gestores}`)
  }
})
