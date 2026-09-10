/**
 * Supabase em memória — só o que o app realmente chama.
 *
 * Serve para montar App/GameNetProvider de verdade e observar QUEM escreve o
 * quê: cada operação fica registrada em `calls`, então "o espectador não
 * escreve" deixa de ser inspeção de código e vira asserção sobre o tráfego.
 */

function clone (value) {
  return value === undefined ? undefined : JSON.parse(JSON.stringify(value))
}

function matchesFilters (row, filters) {
  return filters.every(({ column, op, value }) => {
    const cell = row[column]
    if (op === 'eq') return String(cell) === String(value)
    if (op === 'neq') return String(cell) !== String(value)
    if (op === 'in') return value.some((v) => String(v) === String(cell))
    if (op === 'lt') return cell < value
    if (op === 'lte') return cell <= value
    if (op === 'gt') return cell > value
    if (op === 'gte') return cell >= value
    if (op === 'is') return cell === value || (value === null && (cell === null || cell === undefined))
    return true
  })
}

export function createFakeSupabase (initial = {}) {
  const tables = {
    lobbies: clone(initial.lobbies) || [],
    lobby_players: clone(initial.lobby_players) || [],
    matches: clone(initial.matches) || [],
    rooms: clone(initial.rooms) || [],
  }
  const calls = []
  const channels = []
  /** Erros injetáveis por (tabela, operação). */
  const failures = []
  /** Ganchos assíncronos antes de cada operação — usados para forçar corridas. */
  const hooks = []

  const findFailure = (table, op) => {
    const hit = failures.find((f) => f.table === table && f.op === op && (f.times == null || f.times > 0))
    if (!hit) return null
    if (hit.times != null) hit.times -= 1
    return hit.error
  }

  const runHooks = async (table, op, context) => {
    for (const hook of hooks) {
      if (hook.table === table && hook.op === op) await hook.run(context, tables)
    }
  }

  /**
   * Entrega o evento a todos os canais assinados. Os handlers reais já filtram
   * por tabela/código, então o dublê não precisa reimplementar os filtros do
   * Postgres — e mandar demais é justamente o que expõe filtro frouxo no app.
   */
  function notifyRealtime (table, rows) {
    if (!channels.length) return
    const payloads = (rows.length ? rows : [null]).map((row) => ({
      schema: 'public',
      table,
      eventType: 'UPDATE',
      new: row ? clone(row) : {},
      old: row ? clone(row) : {},
    }))
    for (const channel of [...channels]) {
      if (!channel.subscribed) continue
      for (const payload of payloads) channel.emit(payload)
    }
  }

  function builder (table) {
    const state = {
      op: 'select',
      columns: '*',
      filters: [],
      payload: null,
      orderBy: null,
      limit: null,
      single: null,
      countMode: null,
      head: false,
    }

    function finishSingle (data, count) {
      if (state.single) {
        const first = Array.isArray(data) ? data[0] : data
        if (first === undefined || first === null) {
          if (state.single === 'strict') {
            return { data: null, error: { code: 'PGRST116', message: 'JSON object requested, 0 rows' }, count }
          }
          return { data: null, error: null, count }
        }
        return { data: first, error: null, count }
      }
      return { data, error: null, count }
    }

    async function run () {
      const result = await execute()
      // Realtime: toda escrita bem-sucedida vira evento, como no Postgres changes.
      if (state.op !== 'select' && !result.error) {
        const rows = Array.isArray(result.data) ? result.data : (result.data ? [result.data] : [])
        notifyRealtime(table, rows)
      }
      return result
    }

    async function execute () {
      const rows = tables[table] || (tables[table] = [])
      await runHooks(table, state.op, {
        table,
        op: state.op,
        payload: state.payload,
        filters: state.filters.map((f) => ({ ...f })),
      })
      const failure = findFailure(table, state.op)
      calls.push({
        table,
        op: state.op,
        filters: state.filters.map((f) => ({ ...f })),
        payload: clone(state.payload),
        failed: !!failure,
      })
      if (failure) return { data: null, error: failure, count: null }

      if (state.op === 'select') {
        let out = rows.filter((r) => matchesFilters(r, state.filters))
        if (state.orderBy) {
          const { column, ascending } = state.orderBy
          out = [...out].sort((a, b) => {
            const av = a[column]
            const bv = b[column]
            if (av === bv) return 0
            return (av > bv ? 1 : -1) * (ascending ? 1 : -1)
          })
        }
        if (state.limit != null) out = out.slice(0, state.limit)
        const count = out.length
        if (state.head) return { data: null, error: null, count }
        let data = clone(out)
        // embed de contagem usado por listLobbies: lobby_players!left(count)
        if (table === 'lobbies' && /lobby_players/.test(String(state.columns))) {
          data = data.map((lobby) => ({
            ...lobby,
            lobby_players: [{
              count: tables.lobby_players.filter((p) => String(p.lobby_id) === String(lobby.id)).length,
            }],
          }))
        }
        return finishSingle(data, count)
      }

      if (state.op === 'insert') {
        const incoming = Array.isArray(state.payload) ? state.payload : [state.payload]
        const created = incoming.map((row) => {
          const next = { ...clone(row) }
          if (next.id == null) next.id = `${table}-${rows.length + 1}-${Math.random().toString(16).slice(2, 8)}`
          if (table === 'rooms') {
            if (next.version == null) next.version = 0
            if (next.updated_at == null) next.updated_at = new Date().toISOString()
          }
          rows.push(next)
          return next
        })
        return finishSingle(clone(created), created.length)
      }

      if (state.op === 'update') {
        const affected = rows.filter((r) => matchesFilters(r, state.filters))
        affected.forEach((r) => Object.assign(r, clone(state.payload)))
        return finishSingle(clone(affected), affected.length)
      }

      if (state.op === 'upsert') {
        const incoming = Array.isArray(state.payload) ? state.payload : [state.payload]
        const written = incoming.map((row) => {
          const keys = table === 'lobby_players' ? ['lobby_id', 'player_id'] : ['id']
          const existing = rows.find((r) => keys.every((k) => String(r[k]) === String(row[k])))
          if (existing) {
            Object.assign(existing, clone(row))
            return existing
          }
          const next = clone(row)
          rows.push(next)
          return next
        })
        return finishSingle(clone(written), written.length)
      }

      if (state.op === 'delete') {
        const removed = rows.filter((r) => matchesFilters(r, state.filters))
        tables[table] = rows.filter((r) => !removed.includes(r))
        return finishSingle(clone(removed), removed.length)
      }

      return { data: null, error: new Error(`op não suportada: ${state.op}`), count: null }
    }

    const api = {
      select (columns = '*', options = {}) {
        state.columns = columns
        if (options.count) state.countMode = options.count
        if (options.head) state.head = true
        return api
      },
      insert (payload) { state.op = 'insert'; state.payload = payload; return api },
      update (payload) { state.op = 'update'; state.payload = payload; return api },
      upsert (payload) { state.op = 'upsert'; state.payload = payload; return api },
      delete () { state.op = 'delete'; return api },
      eq (column, value) { state.filters.push({ column, op: 'eq', value }); return api },
      neq (column, value) { state.filters.push({ column, op: 'neq', value }); return api },
      in (column, value) { state.filters.push({ column, op: 'in', value }); return api },
      lt (column, value) { state.filters.push({ column, op: 'lt', value }); return api },
      lte (column, value) { state.filters.push({ column, op: 'lte', value }); return api },
      gt (column, value) { state.filters.push({ column, op: 'gt', value }); return api },
      gte (column, value) { state.filters.push({ column, op: 'gte', value }); return api },
      is (column, value) { state.filters.push({ column, op: 'is', value }); return api },
      /**
       * `.or()` do PostgREST não é reimplementado aqui: a query passa a não
       * casar nada. Assim a limpeza por inatividade fica inerte no teste em vez
       * de apagar o mundo — nenhum cenário deste arquivo testa a limpeza.
       */
      or () { state.filters.push({ column: '__or_nao_suportado__', op: 'eq', value: '__nunca__' }); return api },
      match (spec) {
        for (const [column, value] of Object.entries(spec || {})) {
          state.filters.push({ column, op: 'eq', value })
        }
        return api
      },
      order (column, options = {}) {
        state.orderBy = { column, ascending: options.ascending !== false }
        return api
      },
      limit (n) { state.limit = n; return api },
      maybeSingle () { state.single = 'maybe'; return api },
      single () { state.single = 'strict'; return api },
      then (resolve, reject) { return run().then(resolve, reject) },
      catch (fn) { return run().catch(fn) },
      finally (fn) { return run().finally(fn) },
    }

    return api
  }

  const client = {
    from: (table) => builder(table),
    channel (name) {
      const handlers = []
      const channel = {
        name,
        subscribed: false,
        presence: new Map(),
        on (_event, filterOrHandler, maybeHandler) {
          handlers.push(typeof maybeHandler === 'function' ? maybeHandler : filterOrHandler)
          return channel
        },
        subscribe (cb) { channel.subscribed = true; cb?.('SUBSCRIBED'); return channel },
        presenceState: () => Object.fromEntries(channel.presence),
        track: async (meta) => { channel.presence.set('self', [meta]) },
        untrack: async () => { channel.presence.delete('self') },
        send: async () => {},
        emit (payload) { handlers.forEach((h) => { try { h?.(payload) } catch {} }) },
      }
      channels.push(channel)
      return channel
    },
    removeChannel (ch) {
      const at = channels.indexOf(ch)
      if (at >= 0) channels.splice(at, 1)
    },
  }

  return {
    client,
    tables,
    calls,
    channels,
    failures,
    hooks,
    failOnce (table, op, error) { failures.push({ table, op, error, times: 1 }) },
    failAlways (table, op, error) { failures.push({ table, op, error, times: null }) },
    beforeOp (table, op, run) { hooks.push({ table, op, run }) },
    writesTo (table) { return calls.filter((c) => c.table === table && c.op !== 'select') },
    channelNamed (name) { return channels.find((c) => c.name === name) || null },
    reset () { calls.length = 0 },
  }
}
