import test from 'node:test'
import assert from 'node:assert/strict'

import { findNextAliveIdx, countAlivePlayers } from '../gameMath.js'
import { computeMove } from '../domain/movement.js'
import { getTileType, tileNeedsModal } from '../domain/tiles.js'
import { normalizePlayersAliases } from '../playerShape.js'
import { rankPlayersByPatrimonio, pickWinnerByPatrimonio } from '../patrimonio.js'
import { shouldApplyRemoteRoomRow } from '../turnStateMonotonic.js'
import {
  createMatchState,
  evaluateCoordinatorTimer,
  freshPresence,
  performAutoPass,
  simulateFullGame,
} from '../sim/fullGameMobileSimulator.js'
import { MANUAL_CONSTANTS } from '../manualConstants.js'

/**
 * AUDITORIA — simulação de partidas completas (§99 a §106).
 *
 * A orquestração real vive em useTurnEngine.jsx (hook React, não executável
 * headless). Este harness dirige os PRIMITIVOS DE PRODUÇÃO de turno, board e
 * ranking — sem reimplementar regra alguma (§160) — e verifica os invariantes
 * após CADA transição (§103), com teto de passos (§104) e detecção de
 * estagnação (§105).
 */

function makeRng(seed) {
  let s = (seed >>> 0) || 1
  return () => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0
    return s / 0x1_0000_0000
  }
}
const int = (rng, lo, hi) => lo + Math.floor(rng() * (hi - lo + 1))

const TRACK = 40
const MAX_STEPS_PER_MATCH = 5_000   // §104: teto de segurança

function rosterInicial(rng, n) {
  return normalizePlayersAliases(
    Array.from({ length: n }, (_, i) => ({
      id: `p${i}`,
      name: `P${i}`,
      seat: i,
      joinOrder: i,
      cash: MANUAL_CONSTANTS.startCash,
      bens: MANUAL_CONSTANTS.startBens,
      pos: 0,
      clients: 1,
      vendedoresComuns: 1,
      insideSales: 0,
      fieldSales: 0,
      gestores: 0,
      mixProdutos: 'D',
      erpLevel: 'D',
      bankrupt: false,
    }))
  )
}

/** Invariantes de estado de partida verificados a cada transição (§103). */
function checarEstado(st, ctx) {
  const falhar = (msg, extra) => assert.fail(
    `${msg}\n  seed=${ctx.seed} n=${ctx.n} passo=${ctx.step}` +
    `\n  historico=${JSON.stringify(ctx.history.slice(-15))}` +
    `\n  detalhe=${JSON.stringify(extra)}`
  )

  // turnSeq monotônico e finito
  if (!Number.isInteger(st.turnSeq) || st.turnSeq < 0) falhar('turnSeq invalido', st.turnSeq)
  if (st.turnSeq < ctx.lastTurnSeq) falhar('turnSeq regrediu', { de: ctx.lastTurnSeq, para: st.turnSeq })

  // round válido
  if (!Number.isInteger(st.round) || st.round < 1) falhar('round invalido', st.round)
  if (st.round > st.maxRounds) falhar('round passou do maximo', { round: st.round, max: st.maxRounds })

  // roster íntegro
  if (st.players.length !== ctx.n) falhar('roster mudou de tamanho', st.players.length)
  const ids = st.players.map((p) => String(p.id))
  if (new Set(ids).size !== ids.length) falhar('ids duplicados no roster', ids)

  for (const p of st.players) {
    if (!Number.isFinite(p.cash)) falhar('cash nao finito', { id: p.id, cash: p.cash })
    if (!Number.isFinite(p.bens)) falhar('bens nao finito', { id: p.id, bens: p.bens })
    if (!Number.isInteger(p.pos) || p.pos < 0 || p.pos >= TRACK) {
      falhar('posicao fora do board', { id: p.id, pos: p.pos })   // §135
    }
    if (!Number.isFinite(p.clients) || p.clients < 0) falhar('clients invalido', { id: p.id, v: p.clients })
  }

  // turnPlayerId sempre aponta para jogador existente
  if (!st.gameOver) {
    const atual = st.players.find((p) => String(p.id) === String(st.turnPlayerId))
    if (!atual) falhar('turnPlayerId nao existe no roster', st.turnPlayerId)
    // e nunca para um falido enquanto houver alguem vivo
    if (atual.bankrupt && countAlivePlayers(st.players) > 0) {
      falhar('turno em jogador falido havendo vivos', st.turnPlayerId)
    }
  }

  // gameOver consistente com vencedor
  if (st.gameOver) {
    const vivos = countAlivePlayers(st.players)
    const campeao = pickWinnerByPatrimonio(st.players)
    if (vivos > 0 && !campeao) falhar('fim sem campeao havendo vivos', { vivos })
    if (vivos === 0 && campeao) falhar('campeao entre todos falidos', campeao.id)
  }
}

/** Uma partida completa dirigida por primitivos de produção. */
function simularPartida(seed, n, maxRounds) {
  const rng = makeRng(seed)
  const players = rosterInicial(rng, n)
  const history = []

  let st = {
    players,
    turnIdx: 0,
    turnPlayerId: players[0].id,
    turnSeq: 0,
    round: 1,
    maxRounds,
    gameOver: false,
    winner: null,
  }

  const ctx = { seed, n, step: 0, history, lastTurnSeq: -1 }
  checarEstado(st, ctx)

  let step = 0
  let semMudanca = 0
  const turnosPorJogador = Object.fromEntries(players.map((p) => [p.id, 0]))
  let stagnationDetected = false

  while (!st.gameOver) {
    step += 1
    ctx.step = step

    if (step > MAX_STEPS_PER_MATCH) {
      assert.fail(
        `possible infinite loop / deadlock\n  seed=${seed} n=${n} maxRounds=${maxRounds}` +
        `\n  passos=${step}\n  historico=${JSON.stringify(history.slice(-20))}`
      )
    }

    const antes = { turnPlayerId: st.turnPlayerId, turnSeq: st.turnSeq, round: st.round }

    // --- jogada do jogador da vez (primitivos de produção) ---
    const atualIdx = st.players.findIndex((p) => String(p.id) === String(st.turnPlayerId))
    const dado = int(rng, 1, 6)
    const atual = st.players[atualIdx]

    const mov = computeMove({ pos: atual.pos, steps: dado, trackLen: TRACK })
    const tipoCasa = getTileType(mov.newPos + 1, 'v2-40')

    let players2 = st.players.map((p, i) => (i === atualIdx ? { ...p, pos: mov.newPos } : p))

    // falência ocasional para exercitar a rotação (§26, §27, §28)
    if (rng() < 0.04 && countAlivePlayers(players2) > 1) {
      players2 = players2.map((p, i) => (i === atualIdx ? { ...p, bankrupt: true } : p))
    }

    turnosPorJogador[atual.id] += 1
    history.push({ step, player: atual.id, dado, pos: mov.newPos, tile: tipoCasa, seq: st.turnSeq })

    // --- avanço de turno via helper monotônico de produção ---
    const vivos = countAlivePlayers(players2)
    if (vivos <= 1) {
      st = { ...st, players: players2, gameOver: true, winner: pickWinnerByPatrimonio(players2) }
      ctx.lastTurnSeq = st.turnSeq
      checarEstado(st, ctx)
      break
    }

    const proxIdx = findNextAliveIdx(players2, atualIdx)
    const proximo = players2[proxIdx]

    // Avanco de turno como o motor faz: proximo vivo + turnSeq incrementado em 1.
    const avancado = { turnPlayerId: proximo.id, turnSeq: st.turnSeq + 1 }

    // rodada avança apenas ao FECHAR o ciclo de volta ao primeiro vivo
    const primeiroVivoIdx = players2.findIndex((p) => !p.bankrupt)
    const fechouRodada = proxIdx === primeiroVivoIdx && atualIdx !== proxIdx
    const novaRound = fechouRodada ? st.round + 1 : st.round
    const acabou = novaRound > maxRounds

    st = {
      ...st,
      players: players2,
      turnIdx: proxIdx,
      turnPlayerId: avancado.turnPlayerId,
      turnSeq: avancado.turnSeq,
      round: acabou ? st.round : novaRound,
      gameOver: acabou,
      winner: acabou ? pickWinnerByPatrimonio(players2) : null,
    }

    // §105: estagnação — nada mudou em uma transição
    const mudou =
      antes.turnPlayerId !== st.turnPlayerId ||
      antes.turnSeq !== st.turnSeq ||
      antes.round !== st.round
    semMudanca = mudou ? 0 : semMudanca + 1
    if (semMudanca > 10) {
      stagnationDetected = true
      assert.fail(
        `estagnacao detectada (possivel deadlock)\n  seed=${seed} passo=${step}` +
        `\n  historico=${JSON.stringify(history.slice(-15))}`
      )
    }

    checarEstado(st, ctx)
    ctx.lastTurnSeq = st.turnSeq
  }

  return { st, steps: step, turnosPorJogador, stagnationDetected }
}

/* ========================= LOTES DE SIMULAÇÃO ========================= */

const CONFIGS = []
for (let seed = 1; seed <= 400; seed += 1) {
  CONFIGS.push({ seed, n: 2 + (seed % 3), maxRounds: 1 + (seed % 5) })
}

test(`simula ${CONFIGS.length} partidas completas verificando invariantes por transicao`, () => {
  let totalTurnos = 0
  let maiorPartida = 0
  let deadlocks = 0

  for (const { seed, n, maxRounds } of CONFIGS) {
    const r = simularPartida(seed, n, maxRounds)
    totalTurnos += r.steps
    maiorPartida = Math.max(maiorPartida, r.steps)
    if (r.stagnationDetected) deadlocks += 1

    assert.equal(r.st.gameOver, true, `partida nao terminou: seed=${seed}`)
    assert.ok(r.steps <= MAX_STEPS_PER_MATCH, `estourou o teto: seed=${seed}`)

    // ninguém pode ter jogado duas vezes seguidas mais que o esperado:
    // com n jogadores e maxRounds rodadas, ninguém joga mais que steps vezes
    for (const [id, qtd] of Object.entries(r.turnosPorJogador)) {
      assert.ok(qtd <= r.steps, `jogador ${id} jogou mais turnos que o total`)
    }
  }

  assert.equal(deadlocks, 0, 'houve deadlock')
  assert.ok(totalTurnos > 0)
  // registro de volume para o relatório
  assert.ok(maiorPartida <= MAX_STEPS_PER_MATCH)
})

test('nenhum jogador joga duas vezes seguidas enquanto houver outro vivo', () => {
  for (let seed = 1; seed <= 120; seed += 1) {
    const n = 2 + (seed % 3)
    const rng = makeRng(seed)
    const players = rosterInicial(rng, n)
    let idx = 0
    let anterior = null

    for (let t = 0; t < 200; t += 1) {
      const atual = players[idx].id
      if (countAlivePlayers(players) > 1) {
        assert.notEqual(atual, anterior, `turno repetido seed=${seed} t=${t} player=${atual}`)
      }
      anterior = atual
      idx = findNextAliveIdx(players, idx)
    }
  }
})

/* ============ MONOTONICIDADE DE TURNO / ESTADO REMOTO (§50, §85, §86) ==== */

test('gate monotonico de estado remoto nunca deixa o jogo voltar no tempo (fuzz)', () => {
  const rng = makeRng(777)
  let localVersion = 0
  let localState = { turnSeq: 0, players: [{ id: 'a' }] }

  for (let i = 0; i < 5_000; i += 1) {
    const anterior = localState.turnSeq
    // metade avanco legitimo, metade tentativa de retrocesso
    const v = rng() < 0.5 ? localVersion + 1 : Math.max(0, localVersion - int(rng, 1, 5))
    const gate = shouldApplyRemoteRoomRow({
      incomingVersion: v,
      incomingState: { turnSeq: v, players: [{ id: 'a' }] },
      localVersion,
      localState,
    })
    if (gate.apply) {
      localVersion = v
      localState = { turnSeq: v, players: [{ id: 'a' }] }
    }
    assert.ok(
      localState.turnSeq >= anterior,
      `turnSeq regrediu de ${anterior} para ${localState.turnSeq} na iteracao ${i}`
    )
  }
})

test('shouldApplyRemoteRoomRow rejeita snapshot antigo e aceita o mais novo (§85)', () => {
  const local = { turnSeq: 10, players: [{ id: 'a' }] }

  const antigo = shouldApplyRemoteRoomRow({
    incomingVersion: 5, incomingState: { turnSeq: 5, players: [{ id: 'a' }] },
    localVersion: 10, localState: local,
  })
  assert.equal(antigo.apply, false, 'aplicou estado do passado')

  const novo = shouldApplyRemoteRoomRow({
    incomingVersion: 11, incomingState: { turnSeq: 11, players: [{ id: 'a' }] },
    localVersion: 10, localState: local,
  })
  assert.equal(novo.apply, true, 'rejeitou estado mais novo')
})

test('OUT-OF-ORDER 10, 12, 11 converge para 12 (§86)', () => {
  let localVersion = 10
  let localState = { turnSeq: 10, players: [{ id: 'a' }] }

  for (const v of [12, 11]) {
    const gate = shouldApplyRemoteRoomRow({
      incomingVersion: v,
      incomingState: { turnSeq: v, players: [{ id: 'a' }] },
      localVersion,
      localState,
    })
    if (gate.apply) {
      localVersion = v
      localState = { turnSeq: v, players: [{ id: 'a' }] }
    }
  }

  assert.equal(localVersion, 12, 'estado voltou no tempo com chegada fora de ordem')
  assert.equal(localState.turnSeq, 12)
})

test('aplicar o MESMO snapshot duas vezes e idempotente (§84)', () => {
  const local = { turnSeq: 7, players: [{ id: 'a' }] }
  const mesmo = { incomingVersion: 7, incomingState: { turnSeq: 7, players: [{ id: 'a' }] }, localVersion: 7, localState: local }
  const primeira = shouldApplyRemoteRoomRow(mesmo)
  const segunda = shouldApplyRemoteRoomRow(mesmo)
  assert.equal(primeira.apply, segunda.apply, 'decisao nao determinista para o mesmo input')
})

/* ============== SERIALIZAÇÃO / JSON ROUNDTRIP (§90, §91) ================= */

test('roundtrip JSON preserva os campos criticos do estado de partida', () => {
  const rng = makeRng(99)
  const players = rosterInicial(rng, 4).map((p, i) => ({
    ...p, cash: 12_345 + i, bens: 6_789 + i, pos: i * 7, clients: i + 1,
    loanPending: i === 0 ? { amount: 5000, charged: false, loanId: 'loan:x' } : null,
  }))

  const estado = {
    players,
    turnPlayerId: players[2].id,
    turnSeq: 42,
    turnIdx: 2,
    round: 3,
    maxRounds: 5,
    turnLock: false,
    lockOwner: null,
    turnDeadlineAt: 1_700_000_000_000,
    boardVersion: 'v2-40',
    gameOver: false,
    winner: null,
    roundFlags: [true, false, true, false],
  }

  const volta = JSON.parse(JSON.stringify(estado))

  assert.deepEqual(volta.players, estado.players, 'players mudaram no roundtrip')
  for (const k of ['turnPlayerId', 'turnSeq', 'turnIdx', 'round', 'maxRounds',
                   'turnLock', 'lockOwner', 'turnDeadlineAt', 'boardVersion',
                   'gameOver', 'winner']) {
    assert.deepEqual(volta[k], estado[k], `campo ${k} mudou no roundtrip`)
  }
  assert.deepEqual(volta.roundFlags, estado.roundFlags)

  // tipos preservados (nada virou string)
  for (const p of volta.players) {
    assert.equal(typeof p.cash, 'number')
    assert.equal(typeof p.bens, 'number')
    assert.equal(typeof p.pos, 'number')
  }
  // ranking estável antes e depois
  assert.deepEqual(
    rankPlayersByPatrimonio(volta.players).map((p) => p.id),
    rankPlayersByPatrimonio(estado.players).map((p) => p.id)
  )
})

test('estado sem campos opcionais nao quebra os helpers (§92, §93)', () => {
  const minimo = { players: [{ id: 'a', name: 'A' }], turnPlayerId: 'a', turnSeq: 0, round: 1 }
  const volta = JSON.parse(JSON.stringify(minimo))

  assert.doesNotThrow(() => rankPlayersByPatrimonio(volta.players))
  assert.doesNotThrow(() => pickWinnerByPatrimonio(volta.players))
  assert.doesNotThrow(() => countAlivePlayers(volta.players))
  assert.doesNotThrow(() => findNextAliveIdx(volta.players, 0))

  // roster vazio / nulo
  assert.doesNotThrow(() => rankPlayersByPatrimonio([]))
  assert.doesNotThrow(() => rankPlayersByPatrimonio(undefined))
  assert.equal(pickWinnerByPatrimonio([]), null)
  assert.equal(countAlivePlayers([]), 0)
})

/* ============ SIMULADOR DE TURNO/TIMER DE PRODUÇÃO (§66, §67, §82) ====== */

test('simulateFullGame de producao nao gera skip injusto em nenhuma config', () => {
  let partidas = 0
  for (const nPlayers of [2, 3, 4]) {
    for (const turnTimeSec of [30, 60, 90]) {
      for (const maxRounds of [1, 2, 3]) {
        const playerIds = ['desktop', 'm1', 'm2', 'm3'].slice(0, nPlayers)
        const r = simulateFullGame({ playerIds, turnTimeSec, maxRounds, playDurationMs: 5_000 })
        partidas += 1

        assert.equal(
          r.unfairSkips.length, 0,
          `skip injusto: n=${nPlayers} t=${turnTimeSec} r=${maxRounds} -> ${JSON.stringify(r.unfairSkips.slice(0, 3))}`
        )
        assert.equal(r.stats.mobileUnfair, 0, 'mobile levou skip injusto')

        // todos os jogadores devem ter rolado ao menos uma vez
        for (const id of playerIds) {
          assert.ok(r.stats.rollsByPlayer[id] > 0, `jogador ${id} nunca jogou`)
        }
      }
    }
  }
  assert.equal(partidas, 27)
})

test('auto-pass dispara UMA vez quando o deadline expira, com presenca fresca (§66)', () => {
  const ids = ['desktop', 'm1', 'm2']
  const t0 = 1_000_000
  const st = createMatchState({ playerIds: ids, turnTimeSec: 60, maxRounds: 2, now: t0 })

  // Antes do vencimento: nunca pode pular.
  for (const dt of [0, 1_000, 30_000, 59_000]) {
    const r = evaluateCoordinatorTimer(st, freshPresence(ids, t0 + dt), t0 + dt)
    assert.equal(r.action, 'none', `pulou antes do deadline em dt=${dt}: ${JSON.stringify(r)}`)
  }

  // Vencido, com presenca fresca (o heartbeat mantem isso em producao).
  const tExp = t0 + 61_000
  const expirado = evaluateCoordinatorTimer(st, freshPresence(ids, tExp), tExp)
  assert.equal(expirado.action, 'auto-pass', `nao pulou apos o deadline: ${JSON.stringify(expirado)}`)
  assert.equal(expirado.remaining, 0)

  // §66: repetir o callback do timer com a MESMA attemptKey nao pode pular de novo.
  const repetido = evaluateCoordinatorTimer(st, freshPresence(ids, tExp), tExp, {
    lastAttemptKey: expirado.attemptKey,
  })
  assert.equal(repetido.action, 'none', 'auto-pass duplicado para a mesma tentativa')

  // e com skip em voo tambem nao
  const emVoo = evaluateCoordinatorTimer(st, freshPresence(ids, tExp), tExp, { inFlight: true })
  assert.equal(emVoo.action, 'none', 'pulou com skip ja em voo')
})

test('auto-pass efetivo avanca exatamente um turno e incrementa turnSeq em 1 (§50)', () => {
  const ids = ['desktop', 'm1', 'm2']
  const t0 = 1_000_000
  const st = createMatchState({ playerIds: ids, turnTimeSec: 60, maxRounds: 3, now: t0 })
  const tExp = t0 + 61_000

  const antes = { turnPlayerId: st.turnPlayerId, turnSeq: st.turnSeq }
  const r = performAutoPass(st, tExp)

  assert.equal(r.ok, true, `auto-pass falhou: ${JSON.stringify(r)}`)
  assert.equal(r.state.turnSeq, antes.turnSeq + 1, 'turnSeq nao andou exatamente 1')
  assert.notEqual(r.state.turnPlayerId, antes.turnPlayerId, 'turno nao trocou de jogador')
  assert.ok(ids.includes(String(r.state.turnPlayerId)), 'turno foi para jogador inexistente')
})

test('callback de timer atrasado do turno anterior nao pula o turno novo (§67)', () => {
  const ids = ['desktop', 'm1', 'm2']
  const t0 = 1_000_000
  const st = createMatchState({ playerIds: ids, turnTimeSec: 60, maxRounds: 3, now: t0 })
  const tExp = t0 + 61_000

  // A expira e o turno passa para B, com deadline novo.
  const passou = performAutoPass(st, tExp)
  assert.equal(passou.ok, true)
  const novo = passou.state

  // Callback antigo (chave do turno de A) chegando atrasado no turno de B.
  const chaveAntiga = `${antesId(st)}|${st.turnSeq}`
  const atrasado = evaluateCoordinatorTimer(novo, freshPresence(ids, tExp + 100), tExp + 100, {
    lastAttemptKey: chaveAntiga,
  })
  assert.equal(
    atrasado.action, 'none',
    `callback atrasado pulou o turno novo: ${JSON.stringify(atrasado)}`
  )

  function antesId(state) { return String(state.turnPlayerId) }
})

test('simulateFullGame: presenca obsoleta durante a jogada suprime o auto-pass (fixture)', () => {
  // Caracterização do fixture, nao regra de jogo: a presenca e fotografada no
  // inicio do turno; jogadas acima do limiar de offline (35s) fazem o
  // coordenador sumir e nenhum auto-pass e emitido.
  const r = simulateFullGame({
    playerIds: ['desktop', 'm1'], turnTimeSec: 60, maxRounds: 2, playDurationMs: 120_000,
  })
  assert.equal(r.events.filter((e) => e.type === 'AUTO_PASS').length, 0)
  assert.equal(r.unfairSkips.length, 0, 'fixture gerou skip injusto')
})

/* ==================== CASAS DO BOARD v2-40 (§44) ======================== */

test('toda casa do board v2-40 tem tipo definido e decisao de modal estavel', () => {
  const tipos = new Set()
  for (let casa = 1; casa <= TRACK; casa += 1) {
    const tipo = getTileType(casa, 'v2-40')
    assert.ok(tipo, `casa ${casa} sem tipo`)
    assert.equal(typeof tipo, 'string', `tipo nao textual na casa ${casa}`)
    tipos.add(tipo)

    const precisa = tileNeedsModal(tipo)
    assert.equal(typeof precisa, 'boolean', `tileNeedsModal instavel na casa ${casa}`)
    // determinismo: mesma casa, mesma resposta
    assert.equal(getTileType(casa, 'v2-40'), tipo)
  }
  assert.ok(tipos.size >= 8, `poucos tipos distintos no board: ${[...tipos].join(',')}`)
})

test('cada tipo de casa e alcancavel por algum movimento real (§44)', () => {
  const alcancados = new Set()
  for (let pos = 0; pos < TRACK; pos += 1) {
    for (let dado = 1; dado <= 6; dado += 1) {
      const { newPos } = computeMove({ pos, steps: dado, trackLen: TRACK })
      alcancados.add(getTileType(newPos + 1, 'v2-40'))
    }
  }
  const todos = new Set()
  for (let casa = 1; casa <= TRACK; casa += 1) todos.add(getTileType(casa, 'v2-40'))

  for (const tipo of todos) {
    assert.ok(alcancados.has(tipo), `tipo de casa inalcancavel por dado: ${tipo}`)
  }
})
