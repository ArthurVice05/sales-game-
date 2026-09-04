// src/net/GameNetProvider.jsx
import React, { createContext, useContext, useEffect, useMemo, useRef, useState } from 'react'
// use sempre o único client central
import { supabase } from '../lib/supabaseClient.js'
import { shouldApplyRemoteRoomRow } from '../game/turnStateMonotonic.js'

const Ctx = createContext(null)
// ✅ CORREÇÃO: useGameNet retorna null de forma segura se não houver provider
export const useGameNet = () => {
  // useContext NÃO lança erro sem provider; ele retorna o default do createContext (null aqui).
  return useContext(Ctx)
}

import { isDevVerbose } from '../game/debugFlags.js'

const DEV_NET_LOGS = isDevVerbose()
const LOOKUP_BACKOFF_MS = [250, 500, 1000]

function netLog(tag, payload) {
  if (!DEV_NET_LOGS) return
  try {
    console.log(tag, payload)
  } catch {}
}

function roomHasPlayers(row) {
  const players = row?.state?.players
  return Array.isArray(players) && players.length > 0
}

function applyRoomSnapshotIfNewer(ctx, { version, state, stateId, updatedAt, roomId } = {}) {
  const gate = shouldApplyRemoteRoomRow({
    incomingVersion: version,
    incomingState: state,
    localVersion: ctx.versionRef.current,
    localState: ctx.stateRef.current,
  })
  if (!gate.apply) {
    if (DEV_NET_LOGS) {
      console.log('[NET] skipped stale snapshot:', gate.reason, { version, local: ctx.versionRef.current })
    }
    return false
  }
  if (version != null) {
    ctx.versionRef.current = version
    ctx.setVersion(version)
  }
  if (state) {
    ctx.stateRef.current = state
    ctx.setState(state)
  }
  if (stateId) {
    ctx.stateIdRef.current = String(stateId)
    ctx.setStateId(String(stateId))
  }
  if (updatedAt) ctx.latestKnownUpdatedAtRef.current = updatedAt
  if (roomId) ctx.activeRoomIdRef.current = roomId
  return true
}

/**
 * Escolhe UMA row autoritativa entre candidatas (já ordenadas por updated_at desc).
 * Prioridade: row com players.length > 0; senão a mais recente.
 */
function pickAuthoritativeRoom(rows) {
  if (!Array.isArray(rows) || rows.length === 0) return null
  const usable = rows.find(roomHasPlayers)
  if (usable) return { row: usable, kind: 'usable' }
  return { row: rows[0], kind: 'fallback' }
}

/**
 * Tabela rooms: { id, code (UNIQUE), host_id, state (jsonb), version (int), updated_at }
 * Props:
 *  - roomCode: string que identifica a sala (use o UUID do lobby!)
 *  - hostId: opcional
 */
function GameNetProvider({ roomCode, hostId, readOnly = false, children }) {
  const enabled = !!supabase && !!roomCode
  const code = String(roomCode || '').trim()

  const [ready, setReady] = useState(false)
  const [state, setState] = useState({})
  const [version, setVersion] = useState(0)
  const [stateId, setStateId] = useState(null)

  const stateRef = useRef(state)
  const versionRef = useRef(version)
  const stateIdRef = useRef(stateId)
  const lastEvtRef = useRef(0)
  const activeRoomIdRef = useRef(null)
  const latestKnownUpdatedAtRef = useRef(null)
  const activeCodeRef = useRef(code)
  useEffect(() => { stateRef.current = state }, [state])
  useEffect(() => { versionRef.current = version }, [version])
  useEffect(() => { stateIdRef.current = stateId }, [stateId])
  useEffect(() => { activeCodeRef.current = code }, [code])

  /**
   * Lookup autoritativo por code.
   * Retorno:
   *  - { status: 'ok', row }
   *  - { status: 'empty', row: null }  // SELECT ok, zero rows
   *  - { status: 'error', row: null, error }  // SELECT falhou após retries
   * Nunca trata erro de SELECT como "sala inexistente".
   */
  const getLatestRoomByCode = async (roomCode) => {
    const targetCode = String(roomCode || '').trim()
    let lastError = null
    // attempt 0 = imediato; depois até 3 backoffs (total até 4 leituras)
    const maxAttempts = LOOKUP_BACKOFF_MS.length + 1

    for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
      if (attempt > 0) {
        await new Promise((resolve) => setTimeout(resolve, LOOKUP_BACKOFF_MS[attempt - 1]))
      }

      const { data, error } = await supabase
        .from('rooms')
        .select('id, code, host_id, state, version, updated_at')
        .eq('code', targetCode)
        .order('updated_at', { ascending: false })
        .limit(10)

      if (error) {
        lastError = error
        netLog('[NET] room lookup error', {
          code: targetCode,
          attempt: attempt + 1,
          message: error.message || String(error),
        })
        continue
      }

      const rows = Array.isArray(data) ? data : []
      netLog('[NET] room candidates', { code: targetCode, count: rows.length })

      if (rows.length === 0) {
        netLog('[NET] room lookup empty', { code: targetCode })
        return { status: 'empty', row: null }
      }

      const picked = pickAuthoritativeRoom(rows)
      const row = picked.row
      const hasPlayers = roomHasPlayers(row)
      if (picked.kind === 'usable') {
        netLog('[NET] selected usable room', {
          code: targetCode,
          id: row.id,
          version: row.version ?? 0,
          hasPlayers,
          candidates: rows.length,
        })
      } else {
        netLog('[NET] selected fallback room', {
          code: targetCode,
          id: row.id,
          version: row.version ?? 0,
          hasPlayers,
          candidates: rows.length,
        })
      }
      return { status: 'ok', row }
    }

    return { status: 'error', row: null, error: lastError }
  }

  const resetLocalRoom = () => {
    setReady(false)
    setState({})
    setVersion(0)
    setStateId(null)
    versionRef.current = 0
    stateIdRef.current = null
    stateRef.current = {}
    activeRoomIdRef.current = null
    latestKnownUpdatedAtRef.current = null
    lastEvtRef.current = 0
  }

  // bootstrap: carrega/cria pelo code (ciclo limpo a cada code)
  useEffect(() => {
    if (!enabled) {
      resetLocalRoom()
      return
    }

    let cancelled = false
    const bootCode = code

    // Novo code: zera sala anterior antes do SELECT (evita A vazar como B)
    resetLocalRoom()
    netLog('[NET] bootstrap start', { code: bootCode })

    const applyRoomRow = (row) => {
      if (!row || cancelled) return false
      // Resposta atrasada da sala antiga não sobrescreve a nova
      if (activeCodeRef.current !== bootCode) return false
      const nextState = row.state || {}
      const nextVersion = row.version ?? 0
      const nextStateId = nextState?.stateId != null ? String(nextState.stateId) : null
      activeRoomIdRef.current = row.id
      latestKnownUpdatedAtRef.current = row.updated_at
      versionRef.current = nextVersion
      stateIdRef.current = nextStateId
      stateRef.current = nextState
      setState(nextState)
      setVersion(nextVersion)
      setStateId(nextStateId)
      return true
    }

    ;(async () => {
      const lookup = await getLatestRoomByCode(bootCode)
      if (cancelled || activeCodeRef.current !== bootCode) return

      if (lookup.status === 'error') {
        netLog('[NET] bootstrap ready', {
          code: bootCode,
          ready: true,
          hasPlayers: false,
          reason: 'lookup_error_after_retries',
        })
        // Bootstrap terminou sem inventar row; polling/realtime podem recuperar depois
        setReady(true)
        return
      }

      let current = lookup.status === 'ok' ? lookup.row : null

      if (!current && lookup.status === 'empty' && readOnly) {
        // Sessão read-only (espectador): observa a sala, nunca a cria.
        netLog('[NET] bootstrap ready', {
          code: bootCode,
          ready: true,
          hasPlayers: false,
          reason: 'read-only-session',
        })
        setReady(true)
        return
      }

      if (!current && lookup.status === 'empty') {
        // Só INSERT quando SELECT confirmou ZERO rows (nunca após erro)
        const initial = { code: bootCode, state: {}, version: 0, host_id: hostId || null }
        const { data, error: upErr } = await supabase
          .from('rooms')
          .insert(initial)
          .select('id, code, host_id, state, version, updated_at')
          .maybeSingle()

        if (cancelled || activeCodeRef.current !== bootCode) return

        if (upErr) {
          // Concorrência/unique: 1 re-SELECT (sem loop)
          console.warn('[NET] rooms/create:', upErr.message || upErr, '- re-SELECT uma vez')
          const retry = await getLatestRoomByCode(bootCode)
          if (cancelled || activeCodeRef.current !== bootCode) return
          if (retry.status === 'ok' && retry.row) {
            applyRoomRow(retry.row)
            netLog('[NET] bootstrap ready', {
              code: bootCode,
              id: retry.row.id,
              version: retry.row.version ?? 0,
              hasPlayers: roomHasPlayers(retry.row),
              ready: true,
            })
            setReady(true)
            return
          }
          console.warn('[NET] rooms/bootstrap failed: insert error and re-SELECT empty/error', {
            code: bootCode,
            error: upErr.message || upErr,
            retryStatus: retry.status,
          })
          setReady(true)
          return
        }

        if (data) {
          current = data
        } else {
          const again = await getLatestRoomByCode(bootCode)
          if (cancelled || activeCodeRef.current !== bootCode) return
          current = again.status === 'ok' ? again.row : null
        }
      }

      if (cancelled || activeCodeRef.current !== bootCode) return
      if (current) {
        applyRoomRow(current)
        netLog('[NET] bootstrap ready', {
          code: bootCode,
          id: current.id,
          version: current.version ?? 0,
          hasPlayers: roomHasPlayers(current),
          ready: true,
        })
      } else {
        console.warn('[NET] rooms/bootstrap: nenhuma row para code=', bootCode)
        netLog('[NET] bootstrap ready', {
          code: bootCode,
          ready: true,
          hasPlayers: false,
          reason: 'no_row',
        })
      }
      setReady(true)
    })()
    return () => { cancelled = true }
  }, [enabled, code, hostId])

  // realtime por code
  useEffect(() => {
    if (!enabled) return
    const ch = supabase
      .channel(`rooms:${code}`)
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'rooms', filter: `code=eq.${code}` },
        (payload) => {
          const row = payload.new || payload.old || {}
          if (!row || (row.code != null && String(row.code) !== String(code))) return

          const incomingVersion = (typeof row.version === 'number') ? row.version : null
          const incomingState = row.state || null
          const incomingStateId = incomingState?.stateId ?? null
          const remoteHasPlayers =
            Array.isArray(incomingState?.players) && incomingState.players.length > 0
          const localHasPlayers =
            Array.isArray(stateRef.current?.players) && stateRef.current.players.length > 0

          // Aplica se versão avançou, stateId mudou, OU recuperação: local sem players e remoto com players
          const shouldApply =
            (remoteHasPlayers && !localHasPlayers) ||
            (incomingVersion != null && incomingVersion > versionRef.current) ||
            (incomingVersion != null && incomingVersion === versionRef.current && incomingStateId && incomingStateId !== stateIdRef.current)

          if (shouldApply) {
            applyRoomSnapshotIfNewer(
              {
                versionRef,
                stateRef,
                stateIdRef,
                latestKnownUpdatedAtRef,
                activeRoomIdRef,
                setVersion,
                setState,
                setStateId,
              },
              {
                version: incomingVersion,
                state: incomingState,
                stateId: incomingStateId,
                updatedAt: row.updated_at,
                roomId: row.id,
              },
            )
            lastEvtRef.current = Date.now()
            if (DEV_NET_LOGS) {
              console.log('[NET] ✅ applied remote (realtime)', {
                version: incomingVersion,
                hasPlayers: remoteHasPlayers,
              })
            }
          }
        }
      )
      .subscribe()
    return () => { try { supabase.removeChannel(ch) } catch {} }
  }, [enabled, code])

  // polling de segurança (se o realtime estiver off)
  useEffect(() => {
    if (!enabled) return
    const pollCode = code
    const id = setInterval(async () => {
      if (Date.now() - (lastEvtRef.current || 0) < 2000) return
      if (activeCodeRef.current !== pollCode) return

      const lookup = await getLatestRoomByCode(pollCode)
      if (activeCodeRef.current !== pollCode) return
      // SELECT_ERROR: não tratar como empty; só tenta de novo no próximo tick
      if (lookup.status !== 'ok' || !lookup.row) return

      const current = lookup.row
      const incomingStateId = current.state?.stateId ?? null
      const remoteHasPlayers = roomHasPlayers(current)
      const localHasPlayers =
        Array.isArray(stateRef.current?.players) && stateRef.current.players.length > 0

      const shouldApply =
        (remoteHasPlayers && !localHasPlayers) ||
        (current.version > versionRef.current) ||
        (current.version === versionRef.current && incomingStateId && incomingStateId !== stateIdRef.current)

      if (shouldApply) {
        applyRoomSnapshotIfNewer(
          {
            versionRef,
            stateRef,
            stateIdRef,
            latestKnownUpdatedAtRef,
            activeRoomIdRef,
            setVersion,
            setState,
            setStateId,
          },
          {
            version: current.version,
            state: current.state || {},
            stateId: incomingStateId,
            updatedAt: current.updated_at,
            roomId: current.id,
          },
        )
      }
    }, 700)
    return () => clearInterval(id)
  }, [enabled, code])

  // commit (CAS robusto usando ID em vez de code)
  // Retorna { ok: true } se o UPDATE venceu o CAS; { ok: false } se falhou/esgotou retries.
  const commit = async (updater) => {
    if (!enabled || !ready) return { ok: false, skipped: true }
    // Sessão read-only (espectador): recebe estado, nunca escreve.
    if (readOnly) return { ok: false, skipped: true, reason: 'read-only-session' }

    const MAX_ATTEMPTS = 3
    const nowISO = new Date().toISOString()

    for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
      // 1) lê snapshot autoritativo (mesma seleção do bootstrap/poll)
      const lookup = await getLatestRoomByCode(code)
      let current = null

      if (lookup.status === 'error') {
        console.warn(`[NET] commit - lookup error (attempt ${attempt}/${MAX_ATTEMPTS}):`, lookup.error?.message || lookup.error)
        if (attempt < MAX_ATTEMPTS) {
          await new Promise(resolve => setTimeout(resolve, 50 * attempt))
          continue
        }
        return { ok: false }
      }

      if (lookup.status === 'ok') {
        current = lookup.row
      }

      if (!current) {
        // Só cria row se SELECT confirmou empty (não após erro)
        const initial = { code, state: {}, version: 0, host_id: hostId || null }
        const { data, error: insErr } = await supabase
          .from('rooms')
          .insert(initial)
          .select('id, code, host_id, state, version, updated_at')
          .maybeSingle()
        if (insErr) {
          console.warn(`[NET] commit - insert failed (attempt ${attempt}/${MAX_ATTEMPTS}):`, insErr.message || insErr)
          const retry = await getLatestRoomByCode(code)
          if (retry.status === 'ok' && retry.row) {
            current = retry.row
            activeRoomIdRef.current = current.id
            latestKnownUpdatedAtRef.current = current.updated_at
          } else if (attempt < MAX_ATTEMPTS) {
            await new Promise(resolve => setTimeout(resolve, 50 * attempt))
            continue
          } else {
            return { ok: false }
          }
        } else if (data) {
          current = data
          activeRoomIdRef.current = current.id
          latestKnownUpdatedAtRef.current = current.updated_at
        } else {
          const again = await getLatestRoomByCode(code)
          if (again.status === 'ok' && again.row) {
            current = again.row
          } else {
            console.warn(`[NET] commit - no row after insert (attempt ${attempt}/${MAX_ATTEMPTS})`)
            if (attempt < MAX_ATTEMPTS) {
              await new Promise(resolve => setTimeout(resolve, 50 * attempt))
              continue
            }
            return { ok: false }
          }
        }
      }

      if (!current) return { ok: false }

      // Atualiza activeRoomIdRef se necessário
      if (current.id) activeRoomIdRef.current = current.id

      let base = current.state || {}
      let next = typeof updater === 'function' ? (updater(base) || {}) : (updater || {})

      // ✅ OBRIGATÓRIO: força um stateId novo a cada commit (evita clientes divergirem em "same version")
      const mkStateId = () => {
        try {
          if (typeof crypto !== 'undefined' && crypto.randomUUID) return crypto.randomUUID()
        } catch {}
        return `${Date.now()}-${Math.random().toString(16).slice(2)}`
      }
      if (next && typeof next === 'object') {
        next = { ...next, stateId: mkStateId() }
      }

      // 2) CAS usando ID (não code) para evitar conflitos com duplicatas
      const targetId = activeRoomIdRef.current || current.id
      if (!targetId) {
        console.warn('[NET] commit - no target ID available')
        if (attempt < MAX_ATTEMPTS) {
          await new Promise(resolve => setTimeout(resolve, 50 * attempt))
          continue
        }
        return { ok: false }
      }

      const { data: updated, error: e2 } = await supabase
        .from('rooms')
        .update({
          state: next,
          version: (current.version || 0) + 1,
          updated_at: nowISO,
        })
        .eq('id', targetId)
        .eq('version', current.version)
        .select('state, version, updated_at')
        .maybeSingle()

      if (!e2 && updated) {
        applyRoomSnapshotIfNewer(
          {
            versionRef,
            stateRef,
            stateIdRef,
            latestKnownUpdatedAtRef,
            activeRoomIdRef,
            setVersion,
            setState,
            setStateId,
          },
          {
            version: updated.version ?? ((current.version || 0) + 1),
            state: updated.state || {},
            stateId: updated.state?.stateId,
            updatedAt: updated.updated_at,
            roomId: targetId,
          },
        )
        if (attempt > 1) {
          console.log(`[NET] commit succeeded on attempt ${attempt}/${MAX_ATTEMPTS}`)
        }
        return { ok: true }
      }

      // ✅ CORREÇÃO: Trata conflito de versão, "0 rows", ou "Cannot coerce" como conflito e re-tenta
      const isConflict = e2?.code === 'PGRST116' ||
                         e2?.status === 406 || // ✅ trata 406 (no rows / single mismatch) como conflito de versão
                         e2?.message?.includes('0 rows') ||
                         e2?.message?.includes('Cannot coerce') ||
                         e2?.code === '23505' || // unique violation
                         (e2?.message && e2.message.includes('version')) ||
                         !updated // Se não retornou row, é conflito de versão

      if (isConflict && attempt < MAX_ATTEMPTS) {
        console.warn(`[NET] commit conflict (attempt ${attempt}/${MAX_ATTEMPTS}):`, e2?.message || e2 || 'no rows updated', '- retrying with merge monotônico...')

        // ✅ CORREÇÃO 2: Retry robusto com merge monotônico
        // Re-fetch estado mais recente
        const freshLookup = await getLatestRoomByCode(code)
        if (freshLookup.status === 'ok' && freshLookup.row) {
          const fresh = freshLookup.row
          current = fresh
          activeRoomIdRef.current = fresh.id
          latestKnownUpdatedAtRef.current = fresh.updated_at

          // CAS retry: reaplicar updater no base fresco (já faz merge parcial de players).
          // NÃO espalhar localState.players por cima de forma a ressuscitar cash stale —
          // o retorno do updater já é o estado completo mergeado.
          base = fresh.state || {}
          const localState = typeof updater === 'function' ? (updater(base) || {}) : (updater || {})

          const freshStateVersion = fresh.state?.stateVersion ?? 0
          const localStateVersion = localState?.stateVersion ?? 0
          const mergedStateVersion = Math.max(freshStateVersion, localStateVersion) + 1

          next = {
            ...localState,
            stateVersion: mergedStateVersion,
          }
          // Preserva players do updater (já mergeados em cima do fresh base)
          if (!Array.isArray(next.players) && Array.isArray(base.players)) {
            next.players = base.players
          }
        }

        // Pequeno delay antes de re-tentar para evitar race condition
        await new Promise(resolve => setTimeout(resolve, 50 * attempt))
        continue
      }

      console.warn(`[NET] commit conflict (attempt ${attempt}/${MAX_ATTEMPTS}):`, e2?.message || e2 || 'no rows updated')
    }

    // fallback: resync final
    const finalLookup = await getLatestRoomByCode(code)
    if (finalLookup.status === 'ok' && finalLookup.row) {
      const current = finalLookup.row
      applyRoomSnapshotIfNewer(
        {
          versionRef,
          stateRef,
          stateIdRef,
          latestKnownUpdatedAtRef,
          activeRoomIdRef,
          setVersion,
          setState,
          setStateId,
        },
        {
          version: current.version ?? 0,
          state: current.state || {},
          stateId: current.state?.stateId,
          updatedAt: current.updated_at,
          roomId: current.id,
        },
      )
      console.warn('[NET] commit failed after retries, resynced to latest state')
    } else {
      console.warn('[NET] commit fallback resync failed: no row found', finalLookup.status)
    }
    return { ok: false }
  }

  const value = useMemo(() => ({ enabled, ready, state, version, stateId, commit }), [enabled, ready, state, version, stateId])
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>
}

export default GameNetProvider
export { GameNetProvider }
