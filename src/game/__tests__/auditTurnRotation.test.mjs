import test from 'node:test'
import assert from 'node:assert/strict'

import { findNextAliveIdx, countAlivePlayers, crossedTile } from '../gameMath.js'
import { computeMove } from '../domain/movement.js'

/**
 * AUDITORIA — rotação de turno (§26, §27, §28, §41, §135).
 *
 * Alvo: quebrar findNextAliveIdx com TODAS as máscaras de falência possíveis
 * para 2, 3 e 4 jogadores, e computeMove em todo o board v2-40.
 */

const mkPlayers = (mask) =>
  mask.map((bankrupt, i) => ({ id: `p${i}`, name: `P${i}`, bankrupt }))

/** Todas as 2^n máscaras de falência. */
function allMasks(n) {
  const out = []
  for (let bits = 0; bits < (1 << n); bits += 1) {
    out.push(Array.from({ length: n }, (_, i) => !!(bits & (1 << i))))
  }
  return out
}

for (const n of [2, 3, 4]) {
  test(`findNextAliveIdx cobre as ${1 << n} mascaras de falencia com ${n} jogadores`, () => {
    for (const mask of allMasks(n)) {
      const players = mkPlayers(mask)
      const aliveIdx = mask.map((b, i) => (b ? -1 : i)).filter((i) => i >= 0)

      for (let from = 0; from < n; from += 1) {
        const next = findNextAliveIdx(players, from)

        // Invariante estrutural: sempre um índice dentro do range.
        assert.ok(
          Number.isInteger(next) && next >= 0 && next < n,
          `indice fora do range: mask=${mask} from=${from} next=${next}`
        )

        if (aliveIdx.length === 0) {
          // Ninguém vivo: fail-safe documentado — devolve o próprio fromIdx.
          assert.equal(next, from, `todos falidos deveria devolver fromIdx`)
          continue
        }

        // Com alguém vivo, o próximo NUNCA pode ser um falido.
        assert.equal(
          players[next].bankrupt,
          false,
          `escolheu falido: mask=${mask} from=${from} next=${next}`
        )

        // E deve ser o PRIMEIRO vivo em ordem circular a partir de from+1.
        let expected = null
        for (let step = 1; step <= n; step += 1) {
          const cand = (from + step) % n
          if (!players[cand].bankrupt) { expected = cand; break }
        }
        assert.equal(next, expected, `nao pegou o primeiro vivo circular`)
      }
    }
  })
}

test('rotacao completa nunca repete jogador antes de fechar o ciclo (todos vivos)', () => {
  for (const n of [2, 3, 4]) {
    const players = mkPlayers(new Array(n).fill(false))
    let idx = 0
    const visited = [idx]
    for (let step = 0; step < n - 1; step += 1) {
      idx = findNextAliveIdx(players, idx)
      visited.push(idx)
    }
    assert.equal(new Set(visited).size, n, `ciclo com repeticao para n=${n}`)
    // fecha o ciclo de volta no inicial
    assert.equal(findNextAliveIdx(players, idx), 0)
  }
})

test('ultimo jogador vivo devolve sempre ele mesmo, sem loop infinito', () => {
  for (const n of [2, 3, 4]) {
    for (let survivor = 0; survivor < n; survivor += 1) {
      const mask = new Array(n).fill(true)
      mask[survivor] = false
      const players = mkPlayers(mask)
      for (let from = 0; from < n; from += 1) {
        assert.equal(findNextAliveIdx(players, from), survivor)
      }
    }
  }
})

test('findNextAliveIdx nao quebra com roster vazio', () => {
  assert.equal(findNextAliveIdx([], 0), 0)
  assert.equal(findNextAliveIdx([], 5), 0)
})

/* ---------------------------------------------------- contagem de vivos */

test('countAlivePlayers deduplica por id e trata bankrupt como sticky', () => {
  // mesmo id aparecendo duas vezes, uma marcada falida -> conta como 1 falido
  const players = [
    { id: 'a', bankrupt: false },
    { id: 'a', bankrupt: true },
    { id: 'b', bankrupt: false },
  ]
  assert.equal(countAlivePlayers(players), 1)
})

test('countAlivePlayers sem ids cai no modo por indice', () => {
  assert.equal(countAlivePlayers([{ bankrupt: false }, { bankrupt: true }]), 1)
  assert.equal(countAlivePlayers([]), 0)
})

test('countAlivePlayers concorda com a mascara em todas as combinacoes', () => {
  for (const n of [2, 3, 4]) {
    for (const mask of allMasks(n)) {
      const esperado = mask.filter((b) => !b).length
      assert.equal(countAlivePlayers(mkPlayers(mask)), esperado, `mask=${mask}`)
    }
  }
})

/* ------------------------------------------------- movimento (board v2-40) */

const TRACK = 40

test('computeMove mantem a posicao dentro do board para toda casa x todo dado', () => {
  for (let pos = 0; pos < TRACK; pos += 1) {
    for (let steps = 1; steps <= 6; steps += 1) {
      const { newPos, crossedStart, lapCount } = computeMove({ pos, steps, trackLen: TRACK })

      assert.ok(Number.isInteger(newPos), `newPos nao inteiro: pos=${pos} steps=${steps}`)
      assert.ok(newPos >= 0 && newPos < TRACK, `fora do board: pos=${pos} steps=${steps} -> ${newPos}`)
      assert.equal(newPos, (pos + steps) % TRACK, `movimento incorreto`)

      // volta ao início exatamente quando pos+steps alcança/passa 40
      assert.equal(crossedStart, pos + steps >= TRACK, `crossedStart errado`)
      assert.equal(lapCount, Math.floor((pos + steps) / TRACK))
    }
  }
})

test('computeMove e fail-safe com entradas invalidas', () => {
  for (const steps of [0, NaN, undefined, null, Infinity, -Infinity, '3']) {
    const r = computeMove({ pos: 5, steps, trackLen: TRACK })
    assert.ok(Number.isFinite(r.newPos), `newPos nao finito para steps=${String(steps)}`)
    assert.ok(r.newPos >= 0 && r.newPos < TRACK, `fora do board para steps=${String(steps)}`)
  }
  // trackLen invalido nao pode gerar divisao por zero / NaN
  for (const trackLen of [0, -1, NaN, undefined]) {
    const r = computeMove({ pos: 3, steps: 4, trackLen })
    assert.ok(Number.isFinite(r.newPos), `newPos nao finito para trackLen=${String(trackLen)}`)
    assert.ok(r.newPos >= 0, 'posicao negativa')
  }
})

test('computeMove nunca devolve posicao negativa mesmo com passos negativos', () => {
  for (let pos = 0; pos < TRACK; pos += 1) {
    for (let steps = -1; steps >= -6; steps -= 1) {
      const { newPos } = computeMove({ pos, steps, trackLen: TRACK })
      assert.ok(newPos >= 0 && newPos < TRACK, `pos=${pos} steps=${steps} -> ${newPos}`)
    }
  }
})

/* --------------------------------------------------- passagem por casas */

test('crossedTile detecta passagem inclusive dando a volta no board', () => {
  // sem volta: 3 -> 8 passa pela 5
  assert.equal(crossedTile(3, 8, 5), true)
  assert.equal(crossedTile(3, 8, 3), false, 'origem nao conta como passagem')
  assert.equal(crossedTile(3, 8, 8), true, 'destino conta como passagem')
  assert.equal(crossedTile(3, 8, 9), false)

  // com volta: 38 -> 2 passa pela 0 e pela 1
  assert.equal(crossedTile(38, 2, 0), true)
  assert.equal(crossedTile(38, 2, 1), true)
  assert.equal(crossedTile(38, 2, 2), true)
  assert.equal(crossedTile(38, 2, 3), false)
  assert.equal(crossedTile(38, 2, 38), false, 'origem nao conta na volta')

  // parado nao cruza nada
  for (let i = 0; i < TRACK; i += 1) assert.equal(crossedTile(7, 7, i), false)
})

test('crossedTile: toda volta completa passa pela casa de inicio exatamente uma vez', () => {
  for (let pos = 0; pos < TRACK; pos += 1) {
    for (let steps = 1; steps <= 6; steps += 1) {
      const { newPos, crossedStart } = computeMove({ pos, steps, trackLen: TRACK })
      // a casa 0 e o marco de volta; crossedTile deve concordar com crossedStart
      assert.equal(
        crossedTile(pos, newPos, 0),
        crossedStart,
        `divergencia inicio: pos=${pos} steps=${steps} newPos=${newPos}`
      )
    }
  }
})
