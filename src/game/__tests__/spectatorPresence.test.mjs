/**
 * Contagem de espectadores — lógica pura.
 *
 * A presença vem do Realtime do Supabase como um mapa de chaves para listas de
 * metadados. Só conta quem se anunciou como espectador, e cada pessoa conta uma
 * vez mesmo com várias entradas na mesma chave (reconexão, aba duplicada).
 *
 * Executar: node --test src/game/__tests__/spectatorPresence.test.mjs
 */
import { describe, it } from 'node:test'
import assert from 'node:assert/strict'

import {
  SPECTATOR_PRESENCE_ROLE,
  countSpectators,
  spectatorChannelName,
} from '../spectatorPresence.js'

describe('countSpectators', () => {
  it('conta uma pessoa por chave, ignorando duplicatas de reconexão', () => {
    const estado = {
      a: [{ role: SPECTATOR_PRESENCE_ROLE }, { role: SPECTATOR_PRESENCE_ROLE }],
      b: [{ role: SPECTATOR_PRESENCE_ROLE }],
    }
    assert.equal(countSpectators(estado), 2)
  })

  it('ignora quem não é espectador — jogadores só leem o contador', () => {
    const estado = {
      jogador: [{ role: 'player' }],
      esp1: [{ role: SPECTATOR_PRESENCE_ROLE }],
      semRole: [{}],
    }
    assert.equal(countSpectators(estado), 1)
  })

  it('estado vazio, nulo ou malformado resulta em zero, nunca em erro', () => {
    for (const entrada of [null, undefined, {}, [], 'x', 42, { a: null }, { a: [] }, { a: 'y' }]) {
      assert.equal(countSpectators(entrada), 0, `entrada ${JSON.stringify(entrada)}`)
    }
  })

  it('não conta negativo nem devolve fracionário', () => {
    const n = countSpectators({ a: [{ role: SPECTATOR_PRESENCE_ROLE }] })
    assert.ok(Number.isInteger(n) && n >= 0)
  })
})

describe('spectatorChannelName', () => {
  it('é derivado da sala e isolado do canal de estado do jogo', () => {
    assert.equal(spectatorChannelName('abc'), 'spectators:abc')
    // não pode colidir com o canal que transporta o estado da partida
    assert.notEqual(spectatorChannelName('abc'), 'rooms:abc')
  })

  it('sala vazia ou inválida não gera canal', () => {
    for (const code of ['', '   ', null, undefined]) {
      assert.equal(spectatorChannelName(code), null, `code ${String(code)}`)
    }
  })
})

describe('spectatorCountLabel', () => {
  it('singular, plural e ausência sem inventar número', async () => {
    const { spectatorCountLabel } = await import('../spectatorPresence.js')
    assert.equal(spectatorCountLabel(0), 'Nenhum espectador')
    assert.equal(spectatorCountLabel(1), '1 espectador')
    assert.equal(spectatorCountLabel(3), '3 espectadores')
    for (const invalido of [null, undefined, NaN, -5, 'x']) {
      assert.equal(spectatorCountLabel(invalido), 'Nenhum espectador', `valor ${String(invalido)}`)
    }
  })
})

describe('a presença não encosta no gameplay', () => {
  it('o módulo puro não importa Supabase, rede nem estado da partida', async () => {
    const { readFile } = await import('node:fs/promises')
    const src = await readFile(new URL('../spectatorPresence.js', import.meta.url), 'utf8')
    for (const proibido of ['supabase', 'netCommit', 'broadcastState', 'players', 'setPlayers']) {
      assert.ok(!src.includes(proibido), `puro não pode referenciar ${proibido}`)
    }
  })

  it('o hook usa canal próprio e nunca escreve no estado da sala', async () => {
    const { readFile } = await import('node:fs/promises')
    const src = await readFile(new URL('../../components/spectators/useSpectatorCount.js', import.meta.url), 'utf8')
    assert.match(src, /spectatorChannelName/)
    // nada de tabela de salas nem commit de jogo
    for (const proibido of ['from(', 'netCommit', 'broadcastState', 'rooms:', 'update(', 'upsert(']) {
      assert.ok(!src.includes(proibido), `hook não pode usar ${proibido}`)
    }
    // só quem assiste se anuncia
    assert.match(src, /if \(isSpectator\) \{\s*\n\s*Promise\.resolve\(channel\.track/)
    // limpeza obrigatória
    assert.match(src, /untrack/)
    assert.match(src, /removeChannel/)
  })
})
