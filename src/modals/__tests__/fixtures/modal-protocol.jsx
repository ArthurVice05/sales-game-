// Teste de INTEGRAÇÃO do ModalProvider real, em StrictMode.
// Só de desenvolvimento: nunca é importado pela aplicação nem entra no build.
// Não substitui partida real — valida apenas o protocolo de transporte.
//
// As confirmações usam `closeById(id, payload)`, que é EXATAMENTE o que o
// provider injeta como `onResolve` em cada modal. O cenário 10 clica no botão
// real para provar que essa injeção continua ligada.
import React, { StrictMode, useEffect, useRef, useState } from 'react'
import { createRoot } from 'react-dom/client'
import { ModalProvider, useModal } from '../../ModalContext.jsx'

// Para reproduzir o ANTES (provider legado, que falhava 9 destes 10 cenários):
//   git show <commit-anterior>:src/modals/ModalContext.jsx > ./ModalContextAntigo.jsx
// e importar ModalProvider/useModal de lá. A cópia não fica versionada.

const APPLY = { action: 'APPLY_CARD', kind: 'SORTE', cashDelta: 800 }
const REVES = { action: 'APPLY_CARD', kind: 'REVES', cashDelta: -2000, clientsDelta: -1 }
const NULO = { action: 'APPLY_CARD', kind: 'REVES', cashDelta: 0, clientsDelta: 0 }

const espera = ms => new Promise(r => setTimeout(r, ms))
/** Nenhuma espera pode travar a suíte: o legado deixa promessas pendentes. */
const comLimite = (p, ms = 600) => Promise.race([p, espera(ms).then(() => 'PENDENTE')])
const microtarefas = () => Promise.resolve().then().then().then()

function Fake({ onResolve, marca = 'x' }) {
  return <div data-fake={marca}>
    <button data-confirmar={marca} onClick={() => onResolve?.(APPLY)}>confirmar</button>
  </div>
}

function Suite() {
  const api = useModal()
  const [linhas, setLinhas] = useState([])
  const rodouRef = useRef(false)

  useEffect(() => {
    if (rodouRef.current) return          // StrictMode remonta: rodar UMA vez
    rodouRef.current = true
    const r = []
    const checar = (nome, ok, detalhe = '') => r.push({ nome, ok, detalhe })

    // O provider antigo não expõe openModal: emula-se com o par legado, que era
    // exatamente o uso do motor (pushModal seguido de awaitTop).
    const abrir = api.openModal
      ? (el) => api.openModal(el)
      : (el) => { const id = api.pushModal(el); return { id, result: api.awaitTop() } }
    ;(async () => {
      // 1. Confirmação ANTES do primeiro efeito passivo; consumidor aguarda depois.
      {
        const { id, result } = abrir(<Fake marca="a" />)
        api.closeById(id, APPLY)          // sem nenhum await no meio
        const p = await comLimite(result)
        checar('1. confirmação antes do primeiro efeito preserva payload', p === APPLY, JSON.stringify(p))
      }

      // 2. Confirmação depois do registro normal da espera.
      {
        const { id, result } = abrir(<Fake marca="b" />)
        await espera(30)
        let recebido = 'pendente'
        const consumidor = result.then(v => { recebido = v })
        await microtarefas()
        const aindaPendente = recebido === 'pendente'
        api.closeById(id, REVES)
        await comLimite(consumidor)
        checar('2. confirmação após await entrega o payload', aindaPendente && recebido === REVES)
      }

      // 3. Confirmação antes e depois dos antigos 100 ms de espera.
      {
        const a = abrir(<Fake marca="c" />)
        api.closeById(a.id, APPLY)                    // 0 ms
        const antes = await comLimite(a.result)
        const b = abrir(<Fake marca="d" />)
        await espera(150); api.closeById(b.id, REVES) // 150 ms
        const depois = await comLimite(b.result)
        checar('3. antes e depois de 100 ms entregam igual', antes === APPLY && depois === REVES)
      }

      // 4. Clique duplo / Enter / callback repetido: uma conclusão, um payload.
      {
        const { id, result } = abrir(<Fake marca="e" />)
        api.closeById(id, APPLY)
        api.closeById(id, { action: 'SKIP' })
        api.closeById(id, null)
        const p = await comLimite(result)
        checar('4. conclusão única com callback repetido', p === APPLY, JSON.stringify(p))
      }

      // 5. A fecha e B abre no mesmo ciclo: resultado de A continua de A.
      {
        const a = abrir(<Fake marca="f" />)
        api.closeById(a.id, APPLY)
        const b = abrir(<Fake marca="g" />)
        api.closeById(b.id, REVES)
        const [ra, rb] = await Promise.all([comLimite(a.result), comLimite(b.result)])
        checar('5. resposta de A não conclui B', ra === APPLY && rb === REVES, `${ra?.kind}/${rb?.kind}`)
      }

      // 6. Legado pushModal + awaitTop aninhado resolve a PRÓPRIA modal.
      {
        const pai = abrir(<Fake marca="h" />)
        await espera(30)
        const filhoId = api.pushModal(<Fake marca="i" />)
        const esperaAninhada = api.awaitTop()          // legado, sem delay
        api.closeById(filhoId, { action: 'BACK' })
        const filho = await comLimite(esperaAninhada)
        api.closeById(pai.id, APPLY)
        const doPai = await comLimite(pai.result)
        checar('6. legado awaitTop aguarda a própria modal aninhada',
          filho?.action === 'BACK' && doPai === APPLY, `${filho?.action}/${doPai?.kind}`)
      }

      // 7. closeAll com espera pendente; próxima abertura limpa.
      {
        const a = abrir(<Fake marca="j" />)
        await espera(30)
        api.closeAll()
        const fechado = await comLimite(a.result)
        const b = abrir(<Fake marca="k" />)
        api.closeById(b.id, APPLY)
        const novo = await comLimite(b.result)
        checar('7. closeAll encerra pendência sem virar APPLY_CARD',
          fechado?.action === 'CLOSE_ALL' && fechado?.action !== 'APPLY_CARD' && novo === APPLY, JSON.stringify(fechado))
      }

      // 8. Caminho do motor: positivo, negativo e condicional sem efeito.
      {
        const entregues = []
        for (const payload of [APPLY, REVES, NULO]) {
          const { id, result } = abrir(<Fake marca="l" />)
          api.closeById(id, payload)                  // confirmação precoce: pior caso
          entregues.push(await comLimite(result))
        }
        checar('8. positivo, negativo e condicional intactos',
          entregues[0] === APPLY && entregues[1] === REVES && entregues[2] === NULO)
      }

      // 9. Callback tardio depois de concluído não reabre nem reconclui.
      {
        const { id, result } = abrir(<Fake marca="m" />)
        api.closeById(id, APPLY)
        await comLimite(result)
        await espera(30)
        api.closeById(id, REVES)                      // tardio
        await espera(30)
        const residuo = document.querySelectorAll('[data-fake]').length
        checar('9. callback tardio ignorado, sem modal residual', residuo === 0, `renderizadas=${residuo}`)
      }

      // 10. onResolve injetado continua ligado: clique real no botão da modal.
      {
        const { result } = abrir(<Fake marca="n" />)
        await espera(40)
        const botao = document.querySelector('[data-confirmar="n"]')
        const existia = !!botao
        botao?.click()
        const p = await Promise.race([result, espera(400).then(() => 'TIMEOUT')])
        checar('10. clique real na modal entrega o payload', existia && p === APPLY, String(p?.kind ?? p))
      }

      setLinhas(r)
      window.__protocolo = { total: r.length, ok: r.filter(x => x.ok).length, falhas: r.filter(x => !x.ok) }
    })().catch(err => {
      r.push({ nome: 'EXCEÇÃO NA SUÍTE', ok: false, detalhe: String(err?.message || err) })
      setLinhas([...r])
      window.__protocolo = { total: r.length, ok: r.filter(x => x.ok).length, falhas: r.filter(x => !x.ok) }
    })
  }, [api])

  return <div style={{ font: '14px system-ui', padding: 16 }}>
    <h1>ModalProvider real · StrictMode</h1>
    <p id="resumo">{linhas.length ? `${linhas.filter(l => l.ok).length}/${linhas.length} ok` : 'executando…'}</p>
    <ol id="linhas">{linhas.map((l, i) => <li key={i} style={{ color: l.ok ? '#2e7d32' : '#c62828' }}>
      {l.ok ? 'OK' : 'FALHOU'} — {l.nome} {l.detalhe ? `(${l.detalhe})` : ''}
    </li>)}</ol>
  </div>
}

createRoot(document.getElementById('root')).render(
  <StrictMode><ModalProvider><Suite /></ModalProvider></StrictMode>
)
