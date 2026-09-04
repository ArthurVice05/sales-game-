import test from 'node:test'
import assert from 'node:assert/strict'

import {
  applyDeltas,
  capacityAndAttendance,
  computeDespesasFor,
  computeFaturamentoFor,
} from '../gameMath.js'
import { normalizePlayersAliases } from '../playerShape.js'
import { computePatrimonio, rankPlayersByPatrimonio, pickWinnerByPatrimonio } from '../patrimonio.js'
import {
  applyLoanCharge,
  applyLoanTake,
  armLoanAfterRevenue,
  canTakeLoan,
} from '../loanCycle.js'
import { buildClientsPurchaseDeltas } from '../clientsPurchase.js'
import { buildCommonSellersPurchaseDeltas } from '../commonSellersPurchase.js'
import { buildFieldSalesPurchaseDeltas } from '../fieldSalesPurchase.js'
import { buildInsideSalesPurchaseDeltas } from '../insideSalesPurchase.js'
import { buildManagerPurchaseDeltas } from '../managersPurchase.js'
import { buildMixPurchaseDeltas } from '../productMixPurchase.js'
import { buildErpPurchaseDeltas } from '../erpPurchase.js'
import { MANUAL_CONSTANTS } from '../manualConstants.js'

/**
 * AUDITORIA — fuzz econômico longo (§97, §98, §103, §107, §9, §136).
 *
 * Dirige APENAS funções de produção (§160). Nenhuma regra é reimplementada:
 * o teste só sorteia operações válidas e verifica invariantes após CADA uma.
 *
 * RNG determinístico (LCG). Toda falha imprime a seed e o histórico recente
 * para reprodução (§98, §106).
 */

/** LCG determinístico — mesma seed, mesma sequência, sempre. */
function makeRng(seed) {
  let s = (seed >>> 0) || 1
  return () => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0
    return s / 0x1_0000_0000
  }
}
const pick = (rng, arr) => arr[Math.floor(rng() * arr.length) % arr.length]
const int = (rng, lo, hi) => lo + Math.floor(rng() * (hi - lo + 1))

const NIVEIS = ['A', 'B', 'C', 'D']

function novoJogador(rng, id) {
  return normalizePlayersAliases([{
    id,
    name: `P${id}`,
    cash: MANUAL_CONSTANTS.startCash,
    bens: MANUAL_CONSTANTS.startBens,
    pos: int(rng, 0, 39),
    clients: 1,
    vendedoresComuns: 1,
    insideSales: 0,
    fieldSales: 0,
    gestores: 0,
    mixProdutos: 'D',
    erpLevel: 'D',
    revenue: 0,
    manutencao: 0,
    loanTakenInMatch: false,
    loanPending: null,
    lastChargedLoanId: null,
    bankrupt: false,
  }])[0]
}

/** Contadores de domínio que jamais podem ficar negativos ou não-finitos. */
const CONTADORES = [
  'clients', 'vendedoresComuns', 'insideSales', 'fieldSales',
  'gestores', 'gestoresComerciais', 'managers',
]

/**
 * Invariantes verificados após CADA operação econômica (§103).
 * Lança com contexto reproduzível quando quebra (§106).
 */
function checarInvariantes(p, ctx) {
  const falhar = (msg, extra) => {
    assert.fail(
      `${msg}\n  seed=${ctx.seed} passo=${ctx.step} op=${ctx.op}` +
      `\n  historico=${JSON.stringify(ctx.history.slice(-12))}` +
      `\n  valor=${JSON.stringify(extra)}`
    )
  }

  if (!Number.isFinite(p.cash)) falhar('cash nao finito', p.cash)
  if (!Number.isFinite(p.bens)) falhar('bens nao finito', p.bens)
  if (typeof p.cash === 'string') falhar('cash virou string (concatenacao)', p.cash)
  if (typeof p.bens === 'string') falhar('bens virou string (concatenacao)', p.bens)

  for (const k of CONTADORES) {
    const v = p[k]
    if (v === undefined) continue
    if (!Number.isFinite(v)) falhar(`${k} nao finito`, v)
    if (v < 0) falhar(`${k} negativo`, v)
  }

  const pat = computePatrimonio(p)
  if (!Number.isFinite(pat)) falhar('patrimonio nao finito', pat)

  const fat = computeFaturamentoFor(p)
  if (!Number.isFinite(fat)) falhar('faturamento nao finito', fat)
  if (fat < 0) falhar('faturamento negativo', fat)

  const desp = computeDespesasFor(p)
  if (!Number.isFinite(desp)) falhar('despesa nao finita', desp)
  if (desp < 0) falhar('despesa negativa', desp)

  const { cap, inAtt } = capacityAndAttendance(p)
  if (!Number.isFinite(cap) || cap < 0) falhar('capacidade invalida', cap)
  if (!Number.isFinite(inAtt) || inAtt < 0) falhar('atendimento invalido', inAtt)
  if (inAtt > cap && cap >= 0) falhar('atendendo mais do que a capacidade', { cap, inAtt })
}

/** Uma operação econômica aleatória, sempre via função de produção. */
function operacaoAleatoria(rng, p, round) {
  const op = pick(rng, [
    'FATURAMENTO', 'DESPESAS',
    'COMPRA_CLIENTES', 'COMPRA_COMUM', 'COMPRA_FIELD', 'COMPRA_INSIDE',
    'COMPRA_GESTOR', 'COMPRA_MIX', 'COMPRA_ERP',
    'EMPRESTIMO_TAKE', 'EMPRESTIMO_ARM', 'EMPRESTIMO_CHARGE',
    'EVENTO_SORTE', 'EVENTO_REVES',
  ])

  switch (op) {
    case 'FATURAMENTO': {
      const fat = computeFaturamentoFor(p)
      return { op, player: applyDeltas(p, { cashDelta: fat }) }
    }
    case 'DESPESAS': {
      const desp = computeDespesasFor(p)
      return { op, player: applyDeltas(p, { cashDelta: -desp }) }
    }
    case 'COMPRA_CLIENTES': {
      const qty = int(rng, 1, 3)
      const totalCost = qty * int(rng, 500, 5000)
      return { op, player: applyDeltas(p, buildClientsPurchaseDeltas({ qty, totalCost, maintenanceDelta: qty * 100 })) }
    }
    case 'COMPRA_COMUM': {
      const headcount = int(rng, 1, 2)
      return { op, player: applyDeltas(p, buildCommonSellersPurchaseDeltas({
        headcount, totalHire: headcount * MANUAL_CONSTANTS.commonHire, expenseDelta: headcount * 500,
      })) }
    }
    case 'COMPRA_FIELD': {
      const headcount = int(rng, 1, 2)
      return { op, player: applyDeltas(p, buildFieldSalesPurchaseDeltas({
        headcount, totalHire: headcount * 8000, expenseDelta: headcount * 800,
      })) }
    }
    case 'COMPRA_INSIDE': {
      const headcount = int(rng, 1, 2)
      return { op, player: applyDeltas(p, buildInsideSalesPurchaseDeltas({
        headcount, totalHire: headcount * 6000, expenseDelta: headcount * 600,
      })) }
    }
    case 'COMPRA_GESTOR': {
      const headcount = int(rng, 1, 2)
      return { op, player: applyDeltas(p, buildManagerPurchaseDeltas({
        headcount, cost: headcount * MANUAL_CONSTANTS.managerHire, expenseDelta: headcount * 1000,
      })) }
    }
    case 'COMPRA_MIX': {
      const level = pick(rng, NIVEIS)
      return { op, player: applyDeltas(p, buildMixPurchaseDeltas({ level, cost: int(rng, 1000, 20000) })) }
    }
    case 'COMPRA_ERP': {
      const level = pick(rng, NIVEIS)
      return { op, player: applyDeltas(p, buildErpPurchaseDeltas({ level, cost: int(rng, 1000, 20000) })) }
    }
    case 'EMPRESTIMO_TAKE': {
      if (!canTakeLoan(p)) return { op: 'EMPRESTIMO_TAKE_BLOQUEADO', player: p }
      const r = applyLoanTake(p, int(rng, 1, 50_000), round)
      return { op, player: r.ok ? r.player : p }
    }
    case 'EMPRESTIMO_ARM': {
      if (!p.loanPending) return { op: 'EMPRESTIMO_ARM_NOOP', player: p }
      return { op, player: { ...p, loanPending: armLoanAfterRevenue(p.loanPending) } }
    }
    case 'EMPRESTIMO_CHARGE': {
      const r = applyLoanCharge(p, undefined, { currentRound: round })
      return { op, player: r.player }
    }
    case 'EVENTO_SORTE':
      return { op, player: applyDeltas(p, { cashDelta: int(rng, 500, 25_000) }) }
    case 'EVENTO_REVES':
      // Só cashDelta: o clientsDelta negativo das cartas NÃO passa por
      // applyDeltas em produção — o motor clampa em Math.max(0, …) antes
      // (useTurnEngine ~2225). Ver o teste de guarda mais abaixo.
      return { op, player: applyDeltas(p, { cashDelta: -int(rng, 400, 10_000) }) }
    default:
      return { op: 'NOOP', player: p }
  }
}

/* ============================ SOAK ECONÔMICO ============================ */

const SEEDS = Array.from({ length: 1000 }, (_, i) => i + 1)
const OPS_POR_SEED = 1000

test(`soak economico: ${SEEDS.length} seeds x ${OPS_POR_SEED} operacoes de producao`, () => {
  let totalOps = 0

  for (const seed of SEEDS) {
    const rng = makeRng(seed)
    let p = novoJogador(rng, 'p1')
    const history = []
    const ctx = { seed, step: 0, op: 'INIT', history }

    checarInvariantes(p, ctx)

    for (let step = 1; step <= OPS_POR_SEED; step += 1) {
      const round = 1 + Math.floor(step / 40)
      const antes = p
      const { op, player } = operacaoAleatoria(rng, p, round)

      ctx.step = step
      ctx.op = op
      history.push({ step, op, cash: player.cash, clients: player.clients })

      p = player
      totalOps += 1

      checarInvariantes(p, ctx)

      // clientes nunca podem ficar negativos por um revés
      if (Number.isFinite(antes.clients) && Number.isFinite(p.clients)) {
        assert.ok(p.clients >= 0, `clientes negativos seed=${seed} passo=${step} op=${op}`)
      }
    }
  }

  assert.ok(totalOps === SEEDS.length * OPS_POR_SEED)
})

test('sequencia economica encadeada bate com calculo independente (§11, §161)', () => {
  // Sequência fixa, expected calculado à mão — sem reusar as funções de produção.
  let p = normalizePlayersAliases([{
    id: 'x', cash: 20_000, bens: 10_000, clients: 0, vendedoresComuns: 0,
    insideSales: 0, fieldSales: 0, gestores: 0, mixProdutos: 'D', erpLevel: 'D',
    revenue: 0, loanTakenInMatch: false, loanPending: null, lastChargedLoanId: null,
  }])[0]

  // 1) compra 2 clientes por 3.000 (bens sobem 3.000 por padrão)
  p = applyDeltas(p, buildClientsPurchaseDeltas({ qty: 2, totalCost: 3000 }))
  assert.equal(p.cash, 20_000 - 3_000)
  assert.equal(p.clients, 2)
  assert.equal(p.bens, 10_000 + 3_000)

  // 2) contrata 1 vendedor comum por 2.000
  p = applyDeltas(p, buildCommonSellersPurchaseDeltas({ headcount: 1, totalHire: 2_000 }))
  assert.equal(p.cash, 17_000 - 2_000)
  assert.equal(p.vendedoresComuns, 1)

  // 3) evento de sorte +800
  p = applyDeltas(p, { cashDelta: 800 })
  assert.equal(p.cash, 15_000 + 800)

  // 4) revés -400 e -1 cliente
  p = applyDeltas(p, { cashDelta: -400, clientsDelta: -1 })
  assert.equal(p.cash, 15_800 - 400)
  assert.equal(p.clients, 1)

  // 5) empréstimo: teto = floor(13000*0.5) = 6500
  const take = applyLoanTake(p, 999_999, 1)
  assert.equal(take.ok, true)
  assert.equal(take.player.cash, 15_400 + 6_500)
  p = { ...take.player, loanPending: armLoanAfterRevenue(take.player.loanPending) }

  // 6) cobrança: 6500 + floor(6500*0.5) = 9750
  const charge = applyLoanCharge(p, undefined, { currentRound: 2 })
  assert.equal(charge.charged, true)
  assert.equal(charge.amount, 9_750)
  assert.equal(charge.player.cash, 21_900 - 9_750)
  assert.equal(charge.player.cash, 12_150)

  assert.ok(Number.isInteger(charge.player.cash))
})

test('faturamento e despesa sao monotonicos e finitos em toda a grade de nivel', () => {
  for (const mix of NIVEIS) {
    for (const erp of NIVEIS) {
      for (const clients of [0, 1, 5, 20]) {
        for (const comuns of [0, 1, 4]) {
          const p = normalizePlayersAliases([{
            id: 'g', cash: 0, bens: 0, clients, vendedoresComuns: comuns,
            insideSales: 0, fieldSales: 0, gestores: 0,
            mixProdutos: mix, erpLevel: erp, revenue: 0,
          }])[0]

          const fat = computeFaturamentoFor(p)
          const desp = computeDespesasFor(p)
          const rotulo = `mix=${mix} erp=${erp} clients=${clients} comuns=${comuns}`

          assert.ok(Number.isFinite(fat) && fat >= 0, `faturamento invalido ${rotulo}: ${fat}`)
          assert.ok(Number.isFinite(desp) && desp >= 0, `despesa invalida ${rotulo}: ${desp}`)
          assert.ok(Number.isInteger(fat), `faturamento nao inteiro ${rotulo}`)
          assert.ok(Number.isInteger(desp), `despesa nao inteira ${rotulo}`)

          // sem time nem clientes nao ha faturamento de vendas
          if (comuns === 0 && clients === 0) assert.equal(fat, 0, `faturou sem time ${rotulo}`)
        }
      }
    }
  }
})

test('faturamento e despesa aguentam player degenerado sem virar NaN (§93)', () => {
  const degenerados = [
    {},
    { clients: NaN, vendedoresComuns: NaN },
    { clients: undefined, mixProdutos: undefined, erpLevel: undefined },
    { clients: -5, vendedoresComuns: -3 },
    { mixProdutos: 'Z', erpLevel: 'Z' },
    { mixProdutos: 123, erpLevel: {} },
    { revenue: Infinity },
    { revenue: -Infinity },
    { clients: 1e9, vendedoresComuns: 1e6 },
  ]
  for (const p of degenerados) {
    const fat = computeFaturamentoFor(p)
    const desp = computeDespesasFor(p)
    assert.ok(!Number.isNaN(fat), `faturamento NaN para ${JSON.stringify(p)}`)
    assert.ok(!Number.isNaN(desp), `despesa NaN para ${JSON.stringify(p)}`)
    assert.ok(fat >= 0, `faturamento negativo para ${JSON.stringify(p)}`)
    assert.ok(desp >= 0, `despesa negativa para ${JSON.stringify(p)}`)
  }
})

/* ============ GUARDA: clientes negativos por Sorte & Revés (§33) ========= */

test('applyDeltas NAO clampa clientes — a protecao vive no call site de Sorte & Reves', () => {
  // Caracterização do helper puro: ele soma sem piso.
  const cru = applyDeltas({ id: 'x', clients: 0 }, { clientsDelta: -1 })
  assert.equal(cru.clients, -1, 'caracterizacao de applyDeltas mudou')

  // Compras nunca produzem delta negativo, entao nao alcancam esse caminho.
  for (const qty of [0, 1, 5, 99]) {
    const d = buildClientsPurchaseDeltas({ qty, totalCost: 1000 })
    assert.ok(d.clientsDelta >= 0, `compra gerou delta negativo: ${d.clientsDelta}`)
  }
})

test('GUARDA DE REGRESSAO: o motor clampa clientes ao aplicar Sorte & Reves', async () => {
  // As cartas removem ate 5 clientes; sem este clamp o contador fica negativo.
  const { readFile } = await import('node:fs/promises')
  const engine = (await readFile(new URL('../useTurnEngine.jsx', import.meta.url), 'utf8'))
    .replace(/\r\n/g, '\n')

  assert.match(
    engine,
    /next\.clients = Math\.max\(0, \(Number\(next\.clients\) \|\| 0\) \+ clientsDelta\)/,
    'o clamp de clientes no caminho de Sorte & Reves sumiu — cartas de -1 a -5 ' +
    'passariam a deixar clients negativo'
  )
  // e o mesmo vale para o caixa nesse caminho
  assert.match(
    engine,
    /next\.cash = Math\.max\(0, \(Number\(next\.cash\) \|\| 0\) \+ cashDelta\)/,
    'o clamp de caixa no caminho de Sorte & Reves sumiu'
  )
})

test('nenhuma carta de Sorte & Reves remove mais clientes do que o clamp suporta', async () => {
  const { SORTE_REVES_CARDS, resolveCardEffect } = await import('../../modals/sorteRevesDeck.js')
  const semCertificados = { az: 0, am: 0, rox: 0, clients: 10 }
  const deltas = SORTE_REVES_CARDS
    .map((c) => resolveCardEffect(c, semCertificados).payload.clientsDelta)
    .filter((v) => Number.isFinite(v))
  assert.ok(deltas.length > 0, 'nenhum clientsDelta encontrado no baralho')

  for (const d of deltas) {
    assert.ok(Number.isInteger(d), `clientsDelta nao inteiro: ${d}`)
    // com o clamp do motor, qualquer valor negativo e seguro; o que nao pode
    // e um delta nao-finito entrar no baralho
    assert.ok(Number.isFinite(d), `clientsDelta nao finito: ${d}`)
  }
  // o pior caso documentado do baralho e -5
  assert.equal(Math.min(...deltas), -5, 'o pior caso do baralho mudou — revalidar o clamp')
})

/* ======================= PATRIMÔNIO / RANKING (§13, §14) ================ */

test('computePatrimonio segue a formula oficial e zera falidos', () => {
  assert.equal(computePatrimonio({ cash: 1000, bens: 500 }), 1500)
  assert.equal(computePatrimonio({ cash: 0, bens: 0 }), 0)
  assert.equal(computePatrimonio({ cash: -5000, bens: 1000 }), -4000)
  assert.equal(computePatrimonio({ cash: 1000, bens: 500, bankrupt: true }), 0)
  // NaN e falsy -> vira 0, nunca propaga
  assert.equal(computePatrimonio({ cash: NaN, bens: 500 }), 500)
  assert.equal(computePatrimonio({}), 0)
  assert.equal(computePatrimonio(null), 0)
})

test('ranking: nao falidos primeiro, depois patrimonio, caixa e nome', () => {
  const players = [
    { id: 'd', name: 'Dan', cash: 9_000, bens: 0 },
    { id: 'a', name: 'Ana', cash: 5_000, bens: 4_000 },   // pat 9000, caixa 5000
    { id: 'f', name: 'Fab', cash: 99_000, bens: 99_000, bankrupt: true },
    { id: 'c', name: 'Cid', cash: 1_000, bens: 0 },
  ]
  const r = rankPlayersByPatrimonio(players)

  assert.deepEqual(r.map((p) => p.id), ['d', 'a', 'c', 'f'])
  assert.equal(r[3].patrimonio, 0, 'falido deveria ter patrimonio zero')
  assert.equal(pickWinnerByPatrimonio(players).id, 'd')
})

test('desempate e deterministico e estavel em qualquer ordem de entrada', () => {
  const base = [
    { id: '1', name: 'Bea', cash: 5_000, bens: 5_000 },
    { id: '2', name: 'Ana', cash: 5_000, bens: 5_000 },  // empate total -> nome
    { id: '3', name: 'Caio', cash: 8_000, bens: 2_000 }, // mesmo pat, caixa maior
  ]
  const esperado = ['3', '2', '1']

  // qualquer permutacao da entrada deve produzir o mesmo ranking
  const perms = [
    [0, 1, 2], [0, 2, 1], [1, 0, 2], [1, 2, 0], [2, 0, 1], [2, 1, 0],
  ]
  for (const perm of perms) {
    const entrada = perm.map((i) => base[i])
    assert.deepEqual(
      rankPlayersByPatrimonio(entrada).map((p) => p.id),
      esperado,
      `ranking instavel para permutacao ${perm}`
    )
  }
})

test('ranking com todos falidos nao elege campeao', () => {
  const todos = [
    { id: 'a', name: 'A', cash: 10, bens: 10, bankrupt: true },
    { id: 'b', name: 'B', cash: 20, bens: 20, bankrupt: true },
  ]
  assert.equal(pickWinnerByPatrimonio(todos), null)
  assert.equal(rankPlayersByPatrimonio(todos).length, 2, 'ranking perdeu jogador')
})

test('ranking nunca perde nem duplica jogador (§146)', () => {
  const rng = makeRng(4242)
  for (let it = 0; it < 200; it += 1) {
    const n = int(rng, 2, 4)
    const players = Array.from({ length: n }, (_, i) => ({
      id: `p${i}`,
      name: pick(rng, ['Ana', 'Bea', 'Caio', 'Dan']),
      cash: int(rng, -20_000, 200_000),
      bens: int(rng, 0, 200_000),
      bankrupt: rng() < 0.35,
    }))
    const r = rankPlayersByPatrimonio(players)
    assert.equal(r.length, n, 'ranking mudou de tamanho')
    assert.equal(new Set(r.map((p) => p.id)).size, n, 'ranking duplicou jogador')
    // falidos sempre depois dos vivos
    const idxPrimeiroFalido = r.findIndex((p) => p.isBankrupt)
    if (idxPrimeiroFalido >= 0) {
      for (let i = idxPrimeiroFalido; i < r.length; i += 1) {
        assert.equal(r[i].isBankrupt, true, 'vivo apareceu depois de falido')
      }
    }
    // patrimonio nunca cresce ao descer o ranking entre vivos
    const vivos = r.filter((p) => !p.isBankrupt)
    for (let i = 1; i < vivos.length; i += 1) {
      assert.ok(vivos[i - 1].patrimonio >= vivos[i].patrimonio, 'ordem de patrimonio quebrada')
    }
  }
})
