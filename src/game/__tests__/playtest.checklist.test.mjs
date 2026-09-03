/**
 * Checklist de validação formal — cobre os itens do playtest de integridade.
 * node --test src/game/__tests__/playtest.checklist.test.mjs
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  computeFaturamentoFor,
  computeDespesasFor,
} from '../gameMath.js'
import { MANUAL_CONSTANTS } from '../manualConstants.js'
import { VENDOR_RULES, managerBoostPct, MANAGER_BOOST_MAX_CERTS } from '../gameRules.js'
import { pickWinnerByPatrimonio, computePatrimonio } from '../patrimonio.js'
import {
  canTakeLoan,
  applyLoanTake,
  armLoanAfterRevenue,
  applyLoanCharge,
  shouldChargeLoan,
  loanChargeAmount,
  buildRecoveryFireDeltas,
  computeRecoveryFireCredit,
} from '../loanCycle.js'

const root = join(dirname(fileURLToPath(import.meta.url)), '../../..')
const read = (rel) => readFileSync(join(root, rel), 'utf8')

const kitPlayer = (over = {}) => ({
  cash: MANUAL_CONSTANTS.startCash,
  bens: MANUAL_CONSTANTS.startBens,
  clients: 1,
  vendedoresComuns: 1,
  fieldSales: 0,
  insideSales: 0,
  gestores: 0,
  mixProdutos: 'D',
  erpLevel: 'D',
  ...over,
})

const credit = (hire) => Math.floor(Number(hire) * MANUAL_CONSTANTS.recoveryCreditRatio)

// --- pt1: demissão créditos ---
test('pt1 demissão: Comum $1000; Field/Inside/Gestor = 50% do hire', () => {
  assert.equal(credit(MANUAL_CONSTANTS.commonHire), 1000)
  assert.equal(credit(VENDOR_RULES.field.hire), Math.floor(VENDOR_RULES.field.hire * 0.5))
  assert.equal(credit(VENDOR_RULES.inside.hire), Math.floor(VENDOR_RULES.inside.hire * 0.5))
  assert.equal(credit(MANUAL_CONSTANTS.managerHire), 2500)

  const recovery = read('src/modals/RecoveryModal.jsx')
  assert.match(recovery, /unit:\s*MANUAL_CONSTANTS\.commonHire/)
  assert.match(recovery, /unit:\s*VENDOR_RULES\.field\.hire/)
  assert.match(recovery, /unit:\s*VENDOR_RULES\.inside\.hire/)
  assert.match(recovery, /unit:\s*MANUAL_CONSTANTS\.managerHire/)
  assert.match(read('src/modals/RecoveryFire.jsx'), /recoveryCreditRatio/)
})

// --- pt2: boost gestor ---
test('pt2 gestor boost: máx 3 certs = 40%; 4 não sobe', () => {
  assert.equal(MANAGER_BOOST_MAX_CERTS, 3)
  assert.equal(managerBoostPct(0), 0)
  assert.equal(managerBoostPct(3), 0.4)
  assert.equal(managerBoostPct(4), 0.4)

  const with3 = kitPlayer({
    gestores: 1,
    trainingsByVendor: { gestor: ['a', 'b', 'c'] },
  })
  const with4 = kitPlayer({
    gestores: 1,
    trainingsByVendor: { gestor: ['a', 'b', 'c', 'd'] },
  })
  assert.equal(computeFaturamentoFor(with3), computeFaturamentoFor(with4))

  const training = read('src/modals/TrainingModal.jsx')
  assert.match(training, /MANAGER_BOOST_MAX_CERTS/)
  assert.doesNotMatch(
    training,
    /Math\.max\(0,\s*\(MANAGER_BOOST_BY_CERT \|\| \[\]\)\.length - 1\)/,
  )
})

test('training vazio no Direito de Compra: Voltar reabre DirectBuy', () => {
  const training = read('src/modals/TrainingModal.jsx')
  const start = training.indexOf('{noTypesLeft ? (')
  const end = training.indexOf(') : (', start)
  assert.ok(start >= 0 && end > start, 'ramo noTypesLeft ausente')
  const emptyBranch = training.slice(start, end)
  assert.match(emptyBranch, /allowBack &&/)
  assert.match(emptyBranch, />Voltar</)
  assert.match(emptyBranch, /handleBack/)

  const eng = read('src/game/useTurnEngine.jsx')
  assert.match(
    eng,
    /open === 'TRAINING'[\s\S]{0,1200}allowBack=\{true\}[\s\S]{0,400}r2\.action === 'BACK'[\s\S]{0,180}DirectBuyModal/,
  )
})

// --- pt3: kit inicial ---
test('pt3 kit start: 18k / 4k / fat 770 / desp 1150', () => {
  assert.equal(MANUAL_CONSTANTS.startCash, 18000)
  assert.equal(MANUAL_CONSTANTS.startBens, 4000)
  const p = kitPlayer()
  assert.equal(computeFaturamentoFor(p), 770)
  assert.equal(computeDespesasFor(p), 1150)
  assert.equal(computePatrimonio(p), 22000)
})

// --- pt4: empréstimo ---
test('pt4 empréstimo: take → próxima rodada cobra principal+50% juros → bloqueia 2ª', () => {
  assert.equal(MANUAL_CONSTANTS.loanInterestRatio, 0.5)
  assert.equal(loanChargeAmount({ amount: 2000 }), 3000)

  let p = { id: 'p1', cash: 1500, bens: 4000, loanTakenInMatch: false, loanPending: null }
  assert.equal(canTakeLoan(p), true)

  const taken = applyLoanTake(p, 2000, 1)
  assert.equal(taken.ok, true)
  p = taken.player
  assert.equal(p.cash, 3500)
  assert.equal(p.loanTakenInMatch, true)
  assert.equal(p.loanPending.waitingFullLap, true)
  assert.equal(p.loanPending.eligibleOnExpenses, false)
  assert.equal(p.loanPending.dueRound, 2)

  const pending = { ...p.loanPending, loanId: 'loan:p1:1' }

  // Mesma rodada: não cobra
  assert.equal(
    shouldChargeLoan({ loanPending: pending, lastChargedLoanId: null, currentRound: 1 }),
    false,
  )
  let charge = applyLoanCharge({ ...p, loanPending: pending }, { currentRound: 1 })
  assert.equal(charge.charged, false)

  // 2ª tentativa bloqueada
  assert.equal(canTakeLoan(p), false)
  assert.equal(applyLoanTake(p, 1000, 2).ok, false)

  // Próxima rodada (Despesas): cobra valor + 50% de juros
  assert.equal(
    shouldChargeLoan({ loanPending: pending, lastChargedLoanId: null, currentRound: 2 }),
    true,
  )
  charge = applyLoanCharge({ ...p, loanPending: pending }, { currentRound: 2 })
  assert.equal(charge.charged, true)
  assert.equal(charge.amount, 3000)
  assert.equal(charge.player.cash, 500)
  assert.equal(charge.player.loanPending, null)
  assert.equal(charge.player.lastChargedLoanId, 'loan:p1:1')

  // Ainda bloqueado na partida
  assert.equal(canTakeLoan(charge.player), false)

  // Caminho legado: armar no faturamento também libera a cobrança
  const armed = armLoanAfterRevenue(taken.player.loanPending)
  assert.equal(armed.eligibleOnExpenses, true)
  assert.equal(
    shouldChargeLoan({
      loanPending: { ...armed, loanId: 'loan:p1:arm' },
      lastChargedLoanId: null,
    }),
    true,
  )
})

test('pt4b empréstimo: clamp ao teto de 50% dos bens', () => {
  const p = { id: 'p1', cash: 0, bens: 4000, loanTakenInMatch: false }
  const taken = applyLoanTake(p, 99999, 1)
  assert.equal(taken.ok, true)
  assert.equal(taken.player.loanPending.amount, 2000)
})

test('pt1b demissão SSOT: motor recalcula crédito e clampa owned', () => {
  assert.equal(computeRecoveryFireCredit({ comum: 1 }), 1000)
  assert.equal(computeRecoveryFireCredit({ field: 1 }), 2000)
  assert.equal(computeRecoveryFireCredit({ inside: 1 }), 1250)
  assert.equal(computeRecoveryFireCredit({ gestor: 1 }), 2500)

  const player = { vendedoresComuns: 1, fieldSales: 0, insideSales: 0, gestores: 0 }
  const { credit, items, deltas } = buildRecoveryFireDeltas(player, { comum: 5, field: 2 })
  assert.equal(items.comum, 1)
  assert.equal(items.field, 0)
  assert.equal(credit, 1000)
  assert.equal(deltas.cashDelta, 1000)
  assert.equal(deltas.vendedoresComunsDelta, -1)
})

// --- pt5: falência / patrimônio ---
test('pt5 endgame: patrimônio cash+bens; falido=0; desempate caixa', () => {
  const winner = pickWinnerByPatrimonio([
    { id: 'a', name: 'Ana', cash: 5000, bens: 5000 },
    { id: 'b', name: 'Bruno', cash: 8000, bens: 2000 },
    { id: 'c', name: 'Carla', cash: 99999, bens: 99999, bankrupt: true },
  ])
  assert.equal(winner.name, 'Bruno')
  assert.equal(computePatrimonio({ cash: 100, bens: 50, bankrupt: true }), 0)
})

// --- pt6: Android pagehide ---
test('pt6 Android: sem leaveLobby/leaveRoom em pagehide/beforeunload', () => {
  for (const file of [
    'src/App.jsx',
    'src/pages/PlayersLobby.jsx',
    'src/pages/RoomLobby.jsx',
  ]) {
    const src = read(file)
    assert.doesNotMatch(src, /addEventListener\(\s*['"]pagehide['"]/)
    assert.doesNotMatch(src, /addEventListener\(\s*['"]beforeunload['"]/)
  }
  assert.match(read('src/pages/PlayersLobby.jsx'), /leaveLobby/)
  assert.match(read('src/App.jsx'), /leaveRoom|leaveLobby/)
})

// --- pt7: reset SPA ---
test('pt7 restart: resetMatchLocalUi existe e limpa gameOver/turnLock/hydrate', () => {
  const app = read('src/App.jsx')
  assert.match(app, /const resetMatchLocalUi = React\.useCallback/)
  assert.match(app, /setGameOver\(false\)/)
  assert.match(app, /setTurnLock\(false\)/)
  assert.match(app, /hydratedFromNetRef\.current = false/)
  const calls = app.match(/resetMatchLocalUi\(\)/g) || []
  assert.ok(calls.length >= 3, `esperado ≥3 usos, got ${calls.length}`)
})

// --- pt8: sync helpers existem (smoke; E2E live ainda manual) ---
test('pt8 sync: testes de merge de players presentes no suite', () => {
  const syncTest = read('src/game/__tests__/playerStateSync.test.mjs')
  assert.match(syncTest, /merge|sync|player/i)
})

test('pt8b motor usa loanCycle (wiring)', () => {
  const eng = read('src/game/useTurnEngine.jsx')
  assert.match(eng, /from '\.\/loanCycle\.js'/)
  assert.match(eng, /buildRecoveryFireDeltas/)
  assert.match(eng, /applyLoanTake/)
  assert.match(eng, /armLoanAfterRevenue/)
  assert.match(eng, /shouldChargeLoan/)
  assert.match(eng, /currentRound:\s*currentRoundRef\.current/)
})

test('pt10 HUD rodadas: início 0/N (motor round=1)', () => {
  const mod = read('src/game/roundDisplay.js')
  assert.match(mod, /formatRoundProgress/)
  const app = read('src/App.jsx')
  assert.match(app, /formatRoundProgress\(round, maxRounds, gameOver\)/)
})

test('pt9 skip de turno não corta o dado 3D', () => {
  const eng = read('src/game/useTurnEngine.jsx')
  assert.match(eng, /shouldRejectAbsentTurnSkip/)
  const app = read('src/App.jsx')
  assert.match(app, /setTurnLockBroadcast\(true, String\(gameplayActorId\)\)/)
  assert.match(app, /ROLL descartado/)
  assert.match(app, /onAction\(act\)/)
  assert.match(app, /pendingAction: null/)
  assert.match(app, /resolveTurnDeadlineAfterHandoff/)
  const presence = read('src/game/useGamePresenceAutoSkip.js')
  assert.match(presence, /shouldAttemptPresenceAutoSkip/)
  assert.match(presence, /turnLock:/)
  assert.match(presence, /hud-wait|hud-only-wait/)
  assert.doesNotMatch(presence, /reason: 'AUTO_SKIP_OFFLINE'/)
  const timer = read('src/game/useTurnTimerAutoPass.js')
  assert.match(timer, /shouldArmCoordinatorTimer/)
})
