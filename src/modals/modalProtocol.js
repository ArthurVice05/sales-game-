/**
 * Transporte de respostas de modal — puro, sem React.
 *
 * PROBLEMA CORRIGIDO: a abertura publicava o elemento e só depois um consumidor
 * se registrava para esperar. Uma confirmação que chegasse nesse intervalo era
 * descartada; e como o topo da pilha só era conhecido depois do commit do React,
 * um consumidor tardio podia acabar registrado no modal errado.
 *
 * AQUI: `open()` cria a Promise e o concluidor ANTES de qualquer renderização e
 * os amarra ao id daquela abertura. A Promise guarda o resultado até alguém
 * fazer `await`, sem depender do topo futuro nem de um buffer global.
 *
 * Retenção é por ciclo de vida: ao concluir (ou ao descartar o provider) a
 * entrada sai do mapa. Não existe cache de "última resposta".
 */

function defaultMakeId() {
  try {
    if (typeof crypto !== 'undefined' && crypto.randomUUID) return crypto.randomUUID()
  } catch { /* ambiente sem crypto */ }
  return `modal_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`
}

export function createModalProtocol({ makeId = defaultMakeId } = {}) {
  /** id -> { promise, settle, settled } */
  const entries = new Map()
  /** ordem de abertura, mantida de forma SÍNCRONA (nunca via efeito). */
  let order = []
  let disposed = false

  const forget = (key) => {
    entries.delete(key)
    order = order.filter((openId) => openId !== key)
  }

  /** Conclui a abertura `id` com `payload`. Retorna se esta chamada concluiu. */
  function settle(id, payload = null) {
    const key = String(id ?? '')
    if (!key) return false
    const entry = entries.get(key)
    if (!entry || entry.settled) return false
    entry.settled = true
    forget(key)
    try { entry.settle(payload ?? null) } catch { /* consumidor sumiu */ }
    return true
  }

  return {
    /** Abertura atômica: o resultado existe antes de o elemento ser publicado. */
    open() {
      if (disposed) return { id: '', result: Promise.resolve(null) }
      const id = String(makeId())
      let settleEntry
      const promise = new Promise((resolve) => { settleEntry = resolve })
      entries.set(id, { promise, settle: settleEntry, settled: false })
      order = [...order, id]
      return { id, result: promise }
    },

    settle,

    /** Conclui a abertura mais recente ainda pendente. */
    settleTop(payload = null) {
      const key = order[order.length - 1]
      return key ? settle(key, payload) : false
    },

    /** Cancelamento explícito: toda espera termina com o mesmo payload. */
    settleAll(payload = null) {
      for (const key of [...order].reverse()) settle(key, payload)
      return true
    },

    /**
     * Compatibilidade com o consumo legado (`pushModal` + `awaitTop`): devolve o
     * resultado do topo lido de forma síncrona, e não de uma pilha já defasada.
     */
    awaitTop() {
      const key = order[order.length - 1]
      const entry = key ? entries.get(key) : null
      return entry ? entry.promise : Promise.resolve(null)
    },

    /** Resultado de uma abertura específica; null se já concluída ou inexistente. */
    resultFor(id) {
      const entry = entries.get(String(id ?? ''))
      return entry ? entry.promise : null
    },

    topId() {
      return order.length ? order[order.length - 1] : null
    },

    isDisposed() {
      return disposed
    },

    openIds() {
      return [...order]
    },

    size() {
      return entries.size
    },

    /** Desmontagem: encerra pendências e recusa callbacks tardios. */
    dispose(payload = null) {
      if (disposed) return
      for (const key of [...order].reverse()) settle(key, payload)
      disposed = true
      entries.clear()
      order = []
    },
  }
}
