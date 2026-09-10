/**
 * Modo espectador — integração com a árvore React montada de verdade.
 *
 * Executar: node --test src/game/__tests__/spectatorSessionMount.test.mjs
 *
 * Estes cenários existem porque o defeito não aparecia em helper isolado: ele
 * dependia da ORDEM dos effects, da troca de sala no GameNetProvider e do
 * momento em que uma promessa de consulta terminava. Aqui o React é o real; só
 * o Supabase e o DOM são dublês.
 */
import test from 'node:test'
import assert from 'node:assert/strict'

import { createFakeSupabase } from './helpers/fakeSupabase.mjs'
import { mountRoot } from './helpers/mountApp.mjs'
import {
  MATCH_B,
  ROOM_A,
  ROOM_B,
  advanceRoomB,
  playMatchInRoomA,
  roomBRow,
  roomBState,
  worldFixture,
} from './helpers/spectatorWorld.mjs'

const LOADING = 'Carregando estado do jogo'
const WATCHING = 'Modo espectador'

/** A sala B só está realmente aberta quando o roster dela está na tela. */
function isWatchingRoomB (app) {
  return app.includes(WATCHING) && app.includes('Ana') && app.includes('Bruno')
}

test('sessão que jogou a partida A consegue assistir à partida B (matchId diferente)', async () => {
  const fake = createFakeSupabase(worldFixture())
  const app = await mountRoot({ supabase: fake.client, search: `?room=${ROOM_A}` })
  try {
    await playMatchInRoomA(app)
    assert.ok(app.includes('Rolar dado'), 'a sessão precisa estar jogando a partida A')

    await app.click('Sair para Lobbies')
    await app.settle(10)

    await app.click('Assistir partida', { index: 1 })
    await app.waitFor(isWatchingRoomB, { label: 'tabuleiro da sala B' })

    assert.ok(!app.includes(LOADING), 'não pode ficar no "Carregando estado do jogo"')
    // Nada da partida A pode aparecer como dado da B.
    assert.ok(!app.includes('Zeca'), 'roster da partida anterior vazou')
    assert.ok(!app.includes('5/5'), 'rodada da partida anterior vazou')
    // rodada 2 de 5 aparece como "1/5" (rodadas concluídas / total)
    assert.ok(app.includes('1/5'), 'a rodada exibida é a da partida observada')
  } finally {
    await app.unmount()
  }
})

test('versão alta da sala A não bloqueia a hidratação da sala B com versão baixa', async () => {
  // B fica deliberadamente numa versão MENOR que a alcançada em A.
  const fake = createFakeSupabase(worldFixture({ roomB: roomBRow({ version: 1 }) }))
  const app = await mountRoot({ supabase: fake.client, search: `?room=${ROOM_A}` })
  try {
    await playMatchInRoomA(app)
    const roomA = fake.tables.rooms.find((r) => r.code === ROOM_A)
    const roomB = fake.tables.rooms.find((r) => r.code === ROOM_B)
    assert.ok(roomA.version > roomB.version, 'o cenário exige versão de A maior que a de B')

    await app.click('Sair para Lobbies')
    await app.settle(10)
    await app.click('Assistir partida', { index: 1 })

    await app.waitFor(isWatchingRoomB, { label: 'hidratação da sala B com versão menor' })
  } finally {
    await app.unmount()
  }
})

test('assistir por URL em sessão limpa abre a partida em andamento sem novo START', async () => {
  const fake = createFakeSupabase(worldFixture())
  const app = await mountRoot({ supabase: fake.client, search: `?room=${ROOM_B}&spectate=1` })
  try {
    await app.waitFor(isWatchingRoomB, { label: 'tabuleiro pela URL' })
    assert.ok(!app.includes(LOADING))
    // Nenhuma escrita: nem sala, nem jogador, nem presença.
    assert.deepEqual(fake.calls.filter((c) => c.op !== 'select'), [])
  } finally {
    await app.unmount()
  }
})

test('Provider já conectado na sala B hidrata mesmo sem nenhuma atualização nova', async () => {
  const fake = createFakeSupabase(worldFixture())
  const app = await mountRoot({ supabase: fake.client, search: '' })
  try {
    await app.settle(6)
    // A sessão já está inscrita na sala B (como quem acabou de recarregar).
    await app.setRoomCode(ROOM_B)
    await app.settle(8)
    const versionBefore = fake.tables.rooms.find((r) => r.code === ROOM_B).version

    await app.click('Pular tutorial').catch(() => {})
    await app.type('Carla')
    await app.click('Jogar online')
    await app.settle(6)
    await app.click('Assistir partida')

    await app.waitFor(isWatchingRoomB, { label: 'hidratação sem update novo' })
    assert.equal(
      fake.tables.rooms.find((r) => r.code === ROOM_B).version,
      versionBefore,
      'a hidratação não pode depender de escrever na sala',
    )
  } finally {
    await app.unmount()
  }
})

test('resposta atrasada da sala A não sobrescreve a entrada já feita na sala B', async () => {
  const world = worldFixture()
  // A sala A também precisa estar em andamento para oferecer "Assistir".
  world.lobbies[0].status = 'locked'
  world.rooms.push({
    id: 'row-fisica-a',
    code: ROOM_A,
    host_id: 'p-z',
    version: 42,
    updated_at: '2026-01-03T00:00:00Z',
    state: roomBState({
      matchId: 'match-a-99999999',
      stateId: 'state-a-42',
      players: [
        { id: 'p-z', name: 'Zeca', cash: 1, pos: 1, seat: 0, joinOrder: 0, color: '#FFD600', bens: 0 },
      ],
      turnPlayerId: 'p-z',
      round: 5,
      roundFlags: [false],
    }),
  })
  const fake = createFakeSupabase(world)

  // A consulta de entrada da sala A fica pendurada; a da sala B responde na hora.
  let releaseA = () => {}
  const pendingA = new Promise((resolve) => { releaseA = resolve })
  fake.beforeOp('rooms', 'select', async ({ filters }) => {
    const wantsA = filters.some((f) => f.column === 'code' && String(f.value) === ROOM_A)
    if (wantsA) await pendingA
  })

  const app = await mountRoot({ supabase: fake.client, search: '' })
  try {
    await app.settle(6)
    await app.click('Pular tutorial').catch(() => {})
    await app.type('Carla')
    await app.click('Jogar online')
    await app.settle(6)

    await app.click('Assistir partida', { index: 0 }) // sala A — consulta pendura
    await app.settle(2)
    assert.ok(app.includes('Consultando partida'), 'a entrada em A fica pendente')

    // A pessoa desiste de A e escolhe B; a consulta de A continua no ar.
    await app.click('Voltar para salas')
    await app.settle(4)
    await app.click('Assistir partida', { index: 1 }) // sala B — resolve primeiro
    await app.waitFor(isWatchingRoomB, { label: 'entrada na sala B' })

    releaseA()
    await app.settle(12)

    assert.ok(isWatchingRoomB(app), 'a resposta atrasada de A não pode trocar a partida observada')
    assert.ok(!app.includes('Zeca'), 'roster da sala A vazou depois da resposta atrasada')
    assert.match(globalThis.location.href, new RegExp(ROOM_B))
  } finally {
    releaseA()
    await app.unmount()
  }
})

test('cancelar a entrada durante a consulta não abre a partida depois', async () => {
  const fake = createFakeSupabase(worldFixture())
  let releaseB = () => {}
  const pendingB = new Promise((resolve) => { releaseB = resolve })
  fake.beforeOp('rooms', 'select', async ({ filters }) => {
    const wantsB = filters.some((f) => f.column === 'code' && String(f.value) === ROOM_B)
    if (wantsB) await pendingB
  })

  const app = await mountRoot({ supabase: fake.client, search: `?room=${ROOM_B}&spectate=1` })
  try {
    await app.settle(4)
    assert.ok(app.includes('Consultando partida'), 'a consulta precisa de estado visível')

    await app.click('Voltar para salas')
    await app.settle(4)

    releaseB()
    await app.settle(12)

    assert.ok(!app.includes(WATCHING), 'entrada cancelada não pode reabrir a partida')
    assert.ok(!app.includes(LOADING), 'entrada cancelada não pode ficar carregando')
    assert.deepEqual(fake.calls.filter((c) => c.op !== 'select'), [], 'cancelar não escreve nada')
  } finally {
    releaseB()
    await app.unmount()
  }
})

test('sair e voltar a assistir a mesma partida hidrata de novo', async () => {
  const fake = createFakeSupabase(worldFixture())
  const app = await mountRoot({ supabase: fake.client, search: `?room=${ROOM_B}&spectate=1` })
  try {
    await app.waitFor(isWatchingRoomB, { label: 'primeira entrada' })

    await app.click('Sair do modo espectador')
    await app.settle(8)
    assert.ok(!app.includes(WATCHING), 'a saída precisa deixar o modo espectador')

    await app.click('Assistir partida')
    await app.waitFor(isWatchingRoomB, { label: 'reentrada na mesma partida' })
    assert.deepEqual(fake.calls.filter((c) => c.op !== 'select'), [], 'reentrada não escreve nada')
  } finally {
    await app.unmount()
  }
})

test('espectador acompanha movimento, caixa, turno e rodada sem estar no roster', async () => {
  const fake = createFakeSupabase(worldFixture())
  const app = await mountRoot({ supabase: fake.client, search: `?room=${ROOM_B}&spectate=1` })
  try {
    await app.waitFor(isWatchingRoomB, { label: 'tabuleiro' })
    assert.ok(app.includes('1/5'), 'rodada inicial observada (rodada 2 de 5)')

    await advanceRoomB(fake, {
      players: [
        { ...roomBState().players[0], cash: 33000, pos: 12 },
        { ...roomBState().players[1], cash: 4000, pos: 20 },
      ],
      turnPlayerId: 'p-bru',
      turnSeq: 5,
      round: 3,
    })
    await app.waitFor((h) => h.includes('2/5'), { label: 'rodada atualizada' })
    assert.ok(app.includes('33.000') || app.includes('33000'), 'caixa observado precisa acompanhar')
    // A única escrita do cenário é a do host simulado; do espectador, nenhuma.
    const writes = fake.calls.filter((c) => c.op !== 'select')
    assert.equal(writes.length, 1, 'só o host escreveu')
    assert.equal(writes[0].table, 'rooms')
  } finally {
    await app.unmount()
  }
})

test('falha de consulta vira erro de acesso com nova tentativa — e não cria sala nem jogador', async () => {
  const fake = createFakeSupabase(worldFixture())
  fake.failAlways('rooms', 'select', { code: '08006', message: 'connection failure' })

  const app = await mountRoot({ supabase: fake.client, search: `?room=${ROOM_B}&spectate=1` })
  try {
    await app.waitFor((h) => h.includes('Não foi possível'), { label: 'estado de falha' })
    assert.ok(!app.includes(LOADING), 'falha não pode virar carregamento infinito')
    assert.ok(!app.includes('não está mais disponível'), 'erro de SELECT não é "sala inexistente"')
    assert.ok(app.clickables().some((l) => l.includes('Tentar novamente')), 'precisa oferecer nova tentativa')
    assert.ok(app.clickables().some((l) => l.includes('Voltar para salas')), 'precisa oferecer saída')

    const writes = fake.calls.filter((c) => c.op !== 'select')
    assert.deepEqual(writes, [], 'falha de consulta não cria sala nem jogador')

    // Rede volta: a nova tentativa hidrata sem recarregar a página.
    fake.failures.length = 0
    await app.click('Tentar novamente')
    await app.waitFor(isWatchingRoomB, { label: 'retentativa bem-sucedida' })
  } finally {
    await app.unmount()
  }
})

test('sala sem partida iniciada é recusada sem criar jogador', async () => {
  const world = worldFixture({ roomB: roomBRow({ version: 0, state: { players: [] } }) })
  const fake = createFakeSupabase(world)
  const app = await mountRoot({ supabase: fake.client, search: `?room=${ROOM_B}&spectate=1` })
  try {
    await app.waitFor((h) => h.includes('Criar sala'), { label: 'volta para a lista de salas' })
    assert.ok(!app.includes(WATCHING))
    assert.deepEqual(fake.calls.filter((c) => c.op !== 'select'), [])
  } finally {
    await app.unmount()
  }
})

test('sair do modo espectador não altera jogadores nem a partida', async () => {
  const fake = createFakeSupabase(worldFixture())
  const app = await mountRoot({ supabase: fake.client, search: `?room=${ROOM_B}&spectate=1` })
  try {
    await app.waitFor(isWatchingRoomB, { label: 'tabuleiro' })
    const roomBefore = JSON.stringify(fake.tables.rooms)
    const playersBefore = JSON.stringify(fake.tables.lobby_players)

    await app.click('Sair do modo espectador')
    await app.settle(12)

    assert.equal(JSON.stringify(fake.tables.rooms), roomBefore, 'a partida não pode mudar na saída')
    assert.equal(JSON.stringify(fake.tables.lobby_players), playersBefore, 'a presença não pode mudar na saída')
    assert.deepEqual(fake.calls.filter((c) => c.op !== 'select'), [])
    assert.ok(!globalThis.location.href.includes('spectate'))
  } finally {
    await app.unmount()
  }
})

test('partida legada sem matchId é assistível sem inventar identificador', async () => {
  const legacyState = roomBState()
  delete legacyState.matchId
  legacyState.stateId = 'state-legado-1'
  const fake = createFakeSupabase(worldFixture({ roomB: roomBRow({ version: 2, state: legacyState }) }))
  const app = await mountRoot({ supabase: fake.client, search: `?room=${ROOM_B}&spectate=1` })
  try {
    await app.waitFor(isWatchingRoomB, { label: 'partida legada' })
    const row = fake.tables.rooms.find((r) => r.code === ROOM_B)
    assert.equal(row.state.matchId, undefined, 'nenhum matchId fictício pode ser gravado')
    assert.deepEqual(fake.calls.filter((c) => c.op !== 'select'), [])
  } finally {
    await app.unmount()
  }
})

test('o espectador não usa o matchId como se fosse o id da sala', async () => {
  // id do lobby, code da sala, id físico da row e matchId são todos diferentes.
  const fake = createFakeSupabase(worldFixture())
  const app = await mountRoot({ supabase: fake.client, search: `?room=${ROOM_B}&spectate=1` })
  try {
    await app.waitFor(isWatchingRoomB, { label: 'tabuleiro' })
    const consultasPorMatchId = fake.calls.filter((c) => c.filters.some((f) => String(f.value) === MATCH_B))
    assert.deepEqual(consultasPorMatchId, [], 'matchId não é chave de sala')
  } finally {
    await app.unmount()
  }
})
