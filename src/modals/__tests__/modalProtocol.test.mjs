/**
 * Protocolo de transporte de respostas de modal.
 *
 * Causa auditada: `pushModal` publicava o elemento e só depois `awaitTop`
 * registrava um consumidor. Uma confirmação que chegasse antes desse registro
 * era descartada (`resolveAllForId` sai cedo quando não há waiters), e como
 * `stackRef` só era atualizado em `useEffect`, o consumidor tardio podia se
 * registrar no modal ERRADO.
 *
 * Aqui a abertura é atômica: a Promise e o concluidor existem ANTES de o
 * elemento ser publicado, e ficam ligados ao id daquela abertura.
 *
 * Executar: node --test src/modals/__tests__/modalProtocol.test.mjs
 */
import { describe, it } from 'node:test'
import assert from 'node:assert/strict'

import { createModalProtocol } from '../modalProtocol.js'

const APPLY = { action: 'APPLY_CARD', cashDelta: 800 }

/** Espera as microtarefas drenarem sem introduzir tempo real. */
const microtarefas = () => Promise.resolve().then().then().then()

let ciclo = 0
function protocoloComIdsPrevisiveis() {
  // prefixo por instância: ids de ciclos diferentes nunca colidem, como no produto
  const prefixo = `c${++ciclo}`
  let n = 0
  return createModalProtocol({ makeId: () => `${prefixo}m${++n}` })
}

describe('Abertura atômica: a resposta nunca depende do momento do await', () => {
  it('confirmar ANTES de qualquer await preserva o payload integral', async () => {
    const p = protocoloComIdsPrevisiveis()
    const { id, result } = p.open()
    // confirmação imediata, antes de o consumidor chamar await
    assert.equal(p.settle(id, APPLY), true)
    assert.deepEqual(await result, APPLY)
  })

  it('confirmar DEPOIS do await entrega o mesmo payload', async () => {
    const p = protocoloComIdsPrevisiveis()
    const { id, result } = p.open()
    let recebido = null
    const consumidor = result.then(v => { recebido = v })
    await microtarefas()
    assert.equal(recebido, null, 'não conclui antes da confirmação')
    p.settle(id, APPLY)
    await consumidor
    assert.deepEqual(recebido, APPLY)
  })

  it('o mesmo resultado é entregue a quantos consumidores aguardarem', async () => {
    const p = protocoloComIdsPrevisiveis()
    const { id, result } = p.open()
    const a = result, b = p.resultFor(id), c = p.awaitTop()
    p.settle(id, APPLY)
    assert.deepEqual(await Promise.all([a, b, c]), [APPLY, APPLY, APPLY])
  })

  it('conclui uma única vez: clique duplo, Enter e callback repetido', async () => {
    const p = protocoloComIdsPrevisiveis()
    const { id, result } = p.open()
    assert.equal(p.settle(id, APPLY), true)
    assert.equal(p.settle(id, { action: 'SKIP' }), false)
    assert.equal(p.settle(id, null), false)
    assert.deepEqual(await result, APPLY, 'o primeiro payload prevalece')
    assert.equal(p.size(), 0, 'a abertura é descartada ao concluir')
  })
})

describe('Isolamento entre modais: resposta de A nunca conclui B', () => {
  it('empilhamento: o topo recebe a própria resposta', async () => {
    const p = protocoloComIdsPrevisiveis()
    const a = p.open()
    const b = p.open()
    assert.equal(p.topId(), b.id)
    p.settle(b.id, { action: 'BACK' })
    assert.deepEqual(await b.result, { action: 'BACK' })
    p.settle(a.id, APPLY)
    assert.deepEqual(await a.result, APPLY)
  })

  it('A fecha e B abre no mesmo ciclo: o resultado de A continua de A', async () => {
    const p = protocoloComIdsPrevisiveis()
    const a = p.open()
    p.settle(a.id, APPLY)
    const b = p.open()
    p.settle(b.id, { action: 'SKIP' })
    assert.deepEqual(await a.result, APPLY)
    assert.deepEqual(await b.result, { action: 'SKIP' })
  })

  it('awaitTop legado enxerga o topo de forma síncrona, sem esperar commit', async () => {
    const p = protocoloComIdsPrevisiveis()
    const pai = p.open()
    // consumidor aninhado: abre e aguarda no mesmo tick (padrão dos modais de compra)
    const filho = p.open()
    const esperaAninhada = p.awaitTop()
    p.settle(filho.id, { action: 'OK' })
    assert.deepEqual(await esperaAninhada, { action: 'OK' }, 'não pode receber a resposta do pai')
    p.settle(pai.id, APPLY)
    assert.deepEqual(await pai.result, APPLY)
  })

  it('awaitTop sem modal aberto resolve null sem prender o motor', async () => {
    const p = protocoloComIdsPrevisiveis()
    assert.equal(await p.awaitTop(), null)
  })
})

describe('Cancelamento encerra pendências sem inventar efeito', () => {
  it('settleAll conclui todas as esperas com o payload explícito', async () => {
    const p = protocoloComIdsPrevisiveis()
    const a = p.open(), b = p.open()
    const fechamento = { action: 'CLOSE_ALL' }
    p.settleAll(fechamento)
    assert.deepEqual(await a.result, fechamento)
    assert.deepEqual(await b.result, fechamento)
    assert.equal(p.size(), 0)
    assert.equal(p.topId(), null)
  })

  it('cancelamento não vira APPLY_CARD nem deixa espera abandonada', async () => {
    const p = protocoloComIdsPrevisiveis()
    const { result } = p.open()
    p.settleAll(null)
    const recebido = await result
    assert.equal(recebido, null)
    assert.notEqual(recebido?.action, 'APPLY_CARD')
  })

  it('desmontagem conclui pendências e ignora callbacks tardios', async () => {
    const p = protocoloComIdsPrevisiveis()
    const { id, result } = p.open()
    p.dispose()
    assert.equal(await result, null)
    assert.equal(p.settle(id, APPLY), false, 'callback tardio não reabre nem reconclui')
    assert.equal(p.size(), 0)
  })

  it('não retém resultado além do ciclo de vida da abertura', async () => {
    const p = protocoloComIdsPrevisiveis()
    const { id } = p.open()
    p.settle(id, APPLY)
    assert.equal(p.size(), 0)
    assert.equal(p.resultFor(id), null, 'sem buffer de "última resposta"')
    // 200 aberturas concluídas não podem acumular estado
    for (let i = 0; i < 200; i++) { const o = p.open(); p.settle(o.id, { i }) }
    assert.equal(p.size(), 0)
  })
})

describe('Ciclo de vida: StrictMode e reaberturas', () => {
  it('montar, descartar e remontar não gera conclusão fantasma', async () => {
    const primeiro = protocoloComIdsPrevisiveis()
    const a = primeiro.open()
    primeiro.dispose()
    assert.equal(await a.result, null)

    const segundo = protocoloComIdsPrevisiveis()
    const b = segundo.open()
    assert.equal(segundo.settle(a.id, APPLY), false, 'id de outro ciclo não conclui nada aqui')
    segundo.settle(b.id, APPLY)
    assert.deepEqual(await b.result, APPLY)
  })

  it('ids são únicos por abertura', () => {
    const p = createModalProtocol()
    const vistos = new Set()
    for (let i = 0; i < 50; i++) vistos.add(p.open().id)
    assert.equal(vistos.size, 50)
  })

  it('openIds reflete a ordem de abertura de forma síncrona', () => {
    const p = protocoloComIdsPrevisiveis()
    const a = p.open(), b = p.open(), c = p.open()
    assert.deepEqual(p.openIds(), [a.id, b.id, c.id])
    p.settle(b.id, null)
    assert.deepEqual(p.openIds(), [a.id, c.id])
    assert.equal(p.topId(), c.id)
    p.settle(c.id, null)
    assert.equal(p.topId(), a.id)
  })
})

describe('Caminho do motor: efeito positivo, negativo e condicional', () => {
  const cartas = [
    { nome: 'positivo', payload: { action: 'APPLY_CARD', kind: 'SORTE', cashDelta: 800 } },
    { nome: 'negativo', payload: { action: 'APPLY_CARD', kind: 'REVES', cashDelta: -2000, clientsDelta: -1 } },
    { nome: 'condicional sem efeito', payload: { action: 'APPLY_CARD', kind: 'REVES', cashDelta: 0, clientsDelta: 0 } },
  ]

  for (const { nome, payload } of cartas) {
    it(`entrega o payload ${nome} intacto mesmo confirmando antes do await`, async () => {
      const p = protocoloComIdsPrevisiveis()
      const { id, result } = p.open()
      p.settle(id, payload)
      const recebido = await result
      assert.deepEqual(recebido, payload)
      assert.equal(recebido, payload, 'o payload não é clonado nem reconstruído')
    })
  }

  it('uma abertura por evento: a fila serializa sem misturar respostas', async () => {
    const p = protocoloComIdsPrevisiveis()
    const recebidos = []
    const abrirEConfirmar = async (payload) => {
      const { id, result } = p.open()
      p.settle(id, payload)          // confirmação precoce, o pior caso
      recebidos.push(await result)
    }
    let fila = Promise.resolve()
    for (const { payload } of cartas) fila = fila.then(() => abrirEConfirmar(payload))
    await fila
    assert.deepEqual(recebidos, cartas.map(c => c.payload))
  })
})
