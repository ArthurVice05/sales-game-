// src/lib/lobbies.js
// ✅ CORREÇÃO: Usa o client Supabase unificado
import { supabase } from './supabaseClient.js'
import { createUuidV4 } from './uuid.js'
import {
  planEmptyLobbyDeletion,
  canSafelyDeleteLobby,
  roomStatePlayerCount,
  roomStateGameOver,
} from './lobbyCleanupLogic.js'

/* ==============================
   LISTAGEM DE LOBBIES
   ============================== */
export async function listLobbies() {
  // uma única query; conta jogadores com LEFT JOIN
  const { data, error } = await supabase
    .from('lobbies')
    .select(`
      id,
      name,
      max_players,
      status,
      created_at,
      lobby_players!left(count)
    `)
    .order('created_at', { ascending: true })

  if (error) throw error

  return (data || []).map(l => ({
    id: l.id,
    name: l.name,
    max: l.max_players,
    status: l.status || 'open',
    created_at: l.created_at,
    players: (l.lobby_players?.[0]?.count ?? 0) | 0,
    lobby_players: l.lobby_players,
  }))
}

/** Realtime da lista de lobbies */
export function onLobbiesRealtime(cb) {
  const ch = supabase
    .channel('lobbies-list')
    .on('postgres_changes', { event: '*', schema: 'public', table: 'lobbies' }, () => cb?.())
    .on('postgres_changes', { event: '*', schema: 'public', table: 'lobby_players' }, () => cb?.())
    .subscribe()
  return () => supabase.removeChannel(ch)
}

/* ==============================
   CRUD LOBBY
   ============================== */
export async function createLobby({ name, hostId, max = 4 }) {
  if (!hostId) throw new Error('hostId obrigatório em createLobby')

  // Sempre UUID válido (lobbies.id é coluna uuid; o fallback antigo
  // "timestamp-texto" quebrava a criação de sala em HTTP na rede local)
  const id = createUuidV4()

  const row = {
    id,
    name,
    host_id: hostId,
    max_players: Number(max) || 4,
    status: 'open',
    created_at: new Date().toISOString(),
  }

  const { data, error } = await supabase
    .from('lobbies')
    .insert(row)
    .select('id')
    .single()
  if (error) throw error
  return data.id
}

export async function deleteLobbyIfEmpty(lobbyId) {
  const { count, error } = await supabase
    .from('lobby_players')
    .select('lobby_id', { count: 'exact', head: true })
    .eq('lobby_id', lobbyId)
  if (error) throw error

  if ((count || 0) === 0) {
    const del = await deleteEmptyLobbyCascade(lobbyId)
    if (!del.ok && del.error) throw del.error
  }
}

/* ==============================
   ENTRAR / SAIR / JOGADORES
   ============================== */
export async function joinLobby({ lobbyId, playerId, playerName, ready = false }) {
  const { data: lobby, error: e1 } = await supabase
    .from('lobbies')
    .select('id, max_players, status, host_id')
    .eq('id', lobbyId)
    .single()
  if (e1) throw e1
  if (lobby.status !== 'open') throw new Error('Sala fechada.')

  const { count, error: e2 } = await supabase
    .from('lobby_players')
    .select('lobby_id', { count: 'exact', head: true })
    .eq('lobby_id', lobbyId)
  if (e2) throw e2
  if ((count || 0) >= lobby.max_players) throw new Error('Sala cheia.')

  // [SYNC FIX] expõe meu player_id do lobby para o app (mesma semântica do Firebase)
  try { window.__MY_UID = playerId } catch {}

  const playerUpsert = {
    lobby_id: lobbyId,
    player_id: playerId,
    player_name: playerName,
    ready: !!ready,
    joined_at: new Date().toISOString(),
    last_seen: new Date().toISOString(), // ✅ NOVO
  }

  const { error: e3 } = await supabase
    .from('lobby_players')
    .upsert(
      playerUpsert,
      { onConflict: 'lobby_id,player_id' }
    )
  if (e3) throw e3

  if (!lobby.host_id) {
    await supabase.from('lobbies').update({ host_id: playerId }).eq('id', lobbyId)
  }
}

export async function leaveLobby({ lobbyId, playerId }) {
  const { data: lobby, error: e0 } = await supabase
    .from('lobbies')
    .select('id, host_id')
    .eq('id', lobbyId)
    .single()
  if (e0) throw e0

  const { error } = await supabase
    .from('lobby_players')
    .delete()
    .match({ lobby_id: lobbyId, player_id: playerId })
  if (error) throw error

  const { data: rest, error: er } = await supabase
    .from('lobby_players')
    .select('player_id, joined_at')
    .eq('lobby_id', lobbyId)
    .order('joined_at', { ascending: true })
  if (er) throw er

  if (!rest || rest.length === 0) {
    await deleteEmptyLobbyCascade(lobbyId)
    return
  }

  if (lobby?.host_id === playerId) {
    const nextHost = rest[0]?.player_id
    if (nextHost) {
      await transferLobbyHost({
        lobbyId,
        fromHostId: playerId,
        toHostId: nextHost,
      })
    }
  }
}

export async function listLobbyPlayers(lobbyId) {
  const { data, error } = await supabase
    .from('lobby_players')
    .select('player_id, player_name, ready, joined_at')
    .eq('lobby_id', lobbyId)
    .order('joined_at', { ascending: true })
  if (error) throw error
  return data || []
}

export async function setPlayerReady({ lobbyId, playerId, ready }) {
  const { error } = await supabase
    .from('lobby_players')
    .update({ ready })
    .match({ lobby_id: lobbyId, player_id: playerId })
  if (error) throw error
}
export async function setReady(lobbyId, playerId, ready) {
  return setPlayerReady({ lobbyId, playerId, ready })
}

/** Atualiza o nome do jogador (usado para sincronizar com a StartScreen) */
export async function setPlayerName({ lobbyId, playerId, playerName }) {
  const { error } = await supabase
    .from('lobby_players')
    .update({ player_name: playerName })
    .match({ lobby_id: lobbyId, player_id: playerId })
  if (error) throw error
}

/** Muda status do lobby (host/admin) */
export async function setLobbyStatus(lobbyId, status) {
  const { error } = await supabase
    .from('lobbies')
    .update({ status })
    .eq('id', lobbyId)
  if (error) throw error
}

/**
 * Realtime de um lobby específico (com debounce e logs).
 */
export function onLobbyRealtime(lobbyId, cb) {
  let raf = 0
  const schedule = () => {
    if (raf) cancelAnimationFrame(raf)
    raf = requestAnimationFrame(() => cb?.())
  }

  const ch = supabase
    .channel(`lobby-${lobbyId}`)
    .on('postgres_changes',
      { event: 'INSERT', schema: 'public', table: 'lobby_players', filter: `lobby_id=eq.${lobbyId}` },
      (p) => { console.debug('[rt] lobby_players:INSERT', p.new); schedule() }
    )
    .on('postgres_changes',
      { event: 'UPDATE', schema: 'public', table: 'lobby_players', filter: `lobby_id=eq.${lobbyId}` },
      (p) => { console.debug('[rt] lobby_players:UPDATE', p.new); schedule() }
    )
    .on('postgres_changes',
      { event: 'DELETE', schema: 'public', table: 'lobby_players', filter: `lobby_id=eq.${lobbyId}` },
      (p) => { console.debug('[rt] lobby_players:DELETE', p.old); schedule() }
    )
    .on('postgres_changes',
      { event: '*', schema: 'public', table: 'lobbies', filter: `id=eq.${lobbyId}` },
      (p) => { console.debug('[rt] lobbies:*', p.new || p.old); schedule() }
    )
    .subscribe()

  return () => {
    if (raf) cancelAnimationFrame(raf)
    supabase.removeChannel(ch)
  }
}

/** Detalhes do lobby */
export async function getLobby(lobbyId) {
  const { data, error } = await supabase
    .from('lobbies')
    .select('id,name,status,max_players,host_id,created_at')
    .eq('id', lobbyId)
    .single()
  if (error) throw error
  return data
}

/** Registro do início da partida (retorna o id do match) */
export async function startMatch({ lobbyId }) {
  const { data: players } = await supabase
    .from('lobby_players')
    .select('player_id, player_name, ready')
    .eq('lobby_id', lobbyId)

  const { data, error } = await supabase
    .from('matches')
    .insert({
      lobby_id: lobbyId,
      host_id: players?.[0]?.player_id || null,
      state: { players },
      created_at: new Date().toISOString(),
    })
    .select('id')
    .single()
  if (error) throw error
  return data
}

/** Obtém o match mais recente da sala (para sincronizar a navegação) */
export async function getLatestMatch(lobbyId) {
  const { data, error } = await supabase
    .from('matches')
    .select('id, lobby_id, created_at')
    .eq('lobby_id', lobbyId)
    .order('created_at', { ascending: false })
    .limit(1)
  if (error) throw error
  return data?.[0] || null
}

/**
 * Busca o state autoritativo em `rooms` pelo code (= lobbyId).
 * Preferência: row com state.players.length > 0.
 * Não altera schema; só leitura.
 */
export async function findAuthoritativeRoomMeta (roomCode) {
  const code = String(roomCode ?? '').trim()
  if (!code) return { state: null, updatedAt: null }

  const { data, error } = await supabase
    .from('rooms')
    .select('id, code, state, version, updated_at')
    .eq('code', code)
    .order('updated_at', { ascending: false })
    .limit(10)

  if (error) throw error
  const rows = Array.isArray(data) ? data : []
  const usable = rows.find(
    (r) => Array.isArray(r?.state?.players) && r.state.players.length > 0
  )
  const row = usable || rows[0]
  return {
    state: row?.state ?? null,
    updatedAt: row?.updated_at ?? null,
  }
}

export async function findAuthoritativeRoomState (roomCode) {
  const { state } = await findAuthoritativeRoomMeta(roomCode)
  return state
}

/**
 * Reentrada legítima em partida locked:
 * identidade persistida da room + playerId presente em rooms.state.players.
 * Nome NÃO é usado.
 */
export async function canResumeLockedMatch (roomCode, playerId) {
  const code = String(roomCode ?? '').trim()
  const pid = String(playerId ?? '').trim()
  if (!code || !pid) return { ok: false, state: null }

  const state = await findAuthoritativeRoomState(code)
  const players = Array.isArray(state?.players) ? state.players : []
  const found = players.some((p) => String(p?.id) === pid)
  return { ok: found, state: found ? state : null }
}

/* ==============================
   GERENCIAMENTO DE SALAS DE JOGO (ROOMS)
   ============================== */

/**
 * Remove um jogador de uma sala de jogo e deleta a sala se ficar vazia
 * Trabalha com a tabela 'lobbies' que é onde as salas realmente estão armazenadas
 */
export async function leaveRoom({ roomCode, playerId }) {
  if (!roomCode || !playerId) {
    console.log('[leaveRoom] Parâmetros inválidos:', { roomCode, playerId })
    return
  }

  try {
    console.log(`[leaveRoom] Tentando remover jogador ${playerId} da sala ${roomCode}`)
    
    // 1. Busca a sala na tabela 'lobbies' pelo ID (roomCode é o ID da sala)
    const { data: lobby, error: lobbyError } = await supabase
      .from('lobbies')
      .select('id, name, host_id')
      .eq('id', roomCode)
      .single()

    if (lobbyError) {
      console.warn('[leaveRoom] Erro ao buscar lobby:', lobbyError)
      return
    }

    if (!lobby) {
      console.log(`[leaveRoom] Lobby ${roomCode} não encontrado`)
      return
    }

    console.log(`[leaveRoom] Lobby encontrado:`, lobby)

    // 2. Remove o jogador da tabela 'lobby_players'
    const { error: removeError } = await supabase
      .from('lobby_players')
      .delete()
      .match({ lobby_id: roomCode, player_id: playerId })

    if (removeError) {
      console.warn('[leaveRoom] Erro ao remover jogador:', removeError)
    } else {
      console.log(`[leaveRoom] Jogador ${playerId} removido do lobby ${roomCode}`)
    }

    // 3. Verifica se ainda há jogadores no lobby
    const { data: remainingPlayers, error: countError } = await supabase
      .from('lobby_players')
      .select('player_id')
      .eq('lobby_id', roomCode)

    if (countError) {
      console.warn('[leaveRoom] Erro ao contar jogadores restantes:', countError)
      return
    }

    // 4. Se não há mais jogadores, deleta lobby + rooms
    if (!remainingPlayers || remainingPlayers.length === 0) {
      const del = await deleteEmptyLobbyCascade(roomCode)
      if (!del.ok && del.error) {
        console.warn('[leaveRoom] Erro ao deletar lobby vazio:', del.error)
      } else if (del.ok) {
        console.log(`[leaveRoom] Lobby ${roomCode} deletado com sucesso (sem jogadores)`)
      }
    } else {
      console.log(`[leaveRoom] Jogador ${playerId} saiu do lobby ${roomCode}. Restam ${remainingPlayers.length} jogadores.`)
      
      // Se o jogador que saiu era o host, transfere para o próximo (CAS)
      if (lobby.host_id === playerId && remainingPlayers.length > 0) {
        const nextHost = remainingPlayers[0].player_id
        const tr = await transferLobbyHost({
          lobbyId: roomCode,
          fromHostId: playerId,
          toHostId: nextHost,
        })
        if (tr.transferred) {
          console.log(`[leaveRoom] Host transferido para ${nextHost}`)
        } else if (tr.casLost) {
          console.log('[leaveRoom] Host já havia sido transferido (CAS)')
        } else if (tr.error) {
          console.warn('[leaveRoom] Erro ao transferir host:', tr.error)
        }
      }
    }
  } catch (error) {
    console.error('[leaveRoom] Erro inesperado:', error)
  }
}

/**
 * Remove um jogador de uma sala de jogo usando o ID da sala
 * Trabalha com a tabela 'lobbies' que é onde as salas realmente estão armazenadas
 */
export async function leaveRoomById({ roomId, playerId }) {
  if (!roomId || !playerId) {
    console.log('[leaveRoomById] Parâmetros inválidos:', { roomId, playerId })
    return
  }

  try {
    console.log(`[leaveRoomById] Tentando remover jogador ${playerId} da sala ${roomId}`)
    
    // 1. Remove o jogador da tabela 'lobby_players'
    const { error: removeError } = await supabase
      .from('lobby_players')
      .delete()
      .match({ lobby_id: roomId, player_id: playerId })

    if (removeError) {
      console.warn('[leaveRoomById] Erro ao remover jogador:', removeError)
    } else {
      console.log(`[leaveRoomById] Jogador ${playerId} removido do lobby ${roomId}`)
    }

    // 2. Verifica se ainda há jogadores no lobby
    const { data: remainingPlayers, error: countError } = await supabase
      .from('lobby_players')
      .select('player_id')
      .eq('lobby_id', roomId)

    if (countError) {
      console.warn('[leaveRoomById] Erro ao contar jogadores restantes:', countError)
      return
    }

    // 3. Se não há mais jogadores, deleta lobby + rooms
    if (!remainingPlayers || remainingPlayers.length === 0) {
      const del = await deleteEmptyLobbyCascade(roomId)
      if (!del.ok && del.error) {
        console.warn('[leaveRoomById] Erro ao deletar lobby vazio:', del.error)
      } else if (del.ok) {
        console.log(`[leaveRoomById] Lobby ${roomId} deletado com sucesso (sem jogadores)`)
      }
    } else {
      console.log(`[leaveRoomById] Jogador ${playerId} saiu do lobby ${roomId}. Restam ${remainingPlayers.length} jogadores.`)
      const { data: lobbyRow } = await supabase
        .from('lobbies')
        .select('host_id')
        .eq('id', roomId)
        .maybeSingle()
      if (lobbyRow?.host_id && String(lobbyRow.host_id) === String(playerId)) {
        const nextHost = remainingPlayers[0]?.player_id
        if (nextHost) {
          await transferLobbyHost({
            lobbyId: roomId,
            fromHostId: playerId,
            toHostId: nextHost,
          })
        }
      }
    }
  } catch (error) {
    console.error('[leaveRoomById] Erro inesperado:', error)
  }
}

// ===============================
// Heartbeat + Cleanup (Lobby)
// ===============================

function _numEnv(name, fallback) {
  const raw = import.meta.env?.[name]
  const n = Number(raw)
  return Number.isFinite(n) ? n : fallback
}

export function getLobbyConfig() {
  return {
    emptyLobbyTtlMin: _numEnv('VITE_EMPTY_LOBBY_TTL_MINUTES', 30),
    /** Locked com assentos ainda no rooms.state (janela de reconnect). */
    emptyLockedTtlMin: _numEnv('VITE_LOCKED_LOBBY_TTL_MINUTES', 120),
    /** Locked vazio / gameOver — TTL a partir da última atividade (rooms.updated_at). */
    emptyLockedIdleTtlMin: _numEnv('VITE_LOCKED_IDLE_TTL_MINUTES', 30),
    stalePlayerTtlMin: _numEnv('VITE_STALE_LOBBY_PLAYER_TTL_MINUTES', 3),
    cleanupIntervalMs: _numEnv('VITE_LOBBY_CLEANUP_INTERVAL_MS', 120000),
    heartbeatIntervalMs: _numEnv('VITE_LOBBY_HEARTBEAT_INTERVAL_MS', 30000),
    maxLobbiesHardCap: _numEnv('VITE_MAX_LOBBIES_HARD_CAP', 200), // opcional
  }
}

/**
 * Remove rows de `rooms` pelo code (= lobbyId). Melhor esforço; não lança.
 */
export async function deleteRoomsByCode(roomCode) {
  const code = String(roomCode || '').trim()
  if (!code) return { ok: false, skipped: true }
  const { error } = await supabase.from('rooms').delete().eq('code', code)
  if (error) {
    console.warn('[rooms] falha ao deletar code=', code, error.message || error)
    return { ok: false, error }
  }
  return { ok: true }
}

/** Deleta lobby + rooms do mesmo code (sala realmente vazia). */
export async function deleteEmptyLobbyCascade(lobbyId) {
  const id = String(lobbyId || '').trim()
  if (!id) return { ok: false, skipped: true }
  await deleteRoomsByCode(id)
  const { error } = await supabase.from('lobbies').delete().eq('id', id)
  if (error) {
    console.warn('[cleanup] falha ao deletar lobby', id, error.message || error)
    return { ok: false, error }
  }
  return { ok: true }
}

let __lastSeenSupported = null
let __lastSeenProbePromise = null

export async function isLastSeenSupported() {
  if (__lastSeenSupported !== null) return __lastSeenSupported
  if (__lastSeenProbePromise) return __lastSeenProbePromise

  __lastSeenProbePromise = (async () => {
    const { error } = await supabase
      .from('lobby_players')
      .select('last_seen')
      .limit(1)

    if (error) {
      console.warn('[lobby] last_seen não disponível no Supabase. Heartbeat/limpeza por inatividade ficará limitada.')
      __lastSeenSupported = false
      return false
    }

    __lastSeenSupported = true
    return true
  })()

  return __lastSeenProbePromise
}

/** Heartbeat / presença durante a partida (não misturar com rooms.state). */
export const GAME_HEARTBEAT_INTERVAL_MS = 10_000
export const GAME_OFFLINE_THRESHOLD_MS = 35_000
export const GAME_PRESENCE_POLL_INTERVAL_MS = 5_000

/**
 * Atualiza last_seen do jogador.
 * - Caminho normal: UPDATE
 * - Se a row sumiu (ex.: cleanup) e allowRecreateIfSeated=true:
 *   só recria via UPSERT se playerId existir em rooms.state.players.
 *   Não abre sala, não faz joinLobby, não cria assento novo na partida.
 */
export async function touchLobbyPlayer({
  lobbyId,
  playerId,
  allowRecreateIfSeated = false,
} = {}) {
  if (!lobbyId || !playerId) return { ok: false, skipped: true }

  const supported = await isLastSeenSupported()
  if (!supported) return { ok: false, skipped: true }

  const nowIso = new Date().toISOString()
  const { data, error } = await supabase
    .from('lobby_players')
    .update({ last_seen: nowIso })
    .eq('lobby_id', lobbyId)
    .eq('player_id', playerId)
    .select('player_id')

  if (error) {
    console.warn('[hb] falha ao atualizar last_seen:', error?.message || error)
    return { ok: false, error }
  }

  if (Array.isArray(data) && data.length > 0) {
    return { ok: true }
  }

  // UPDATE afetou 0 rows → row ausente (cleanup / leave antigo)
  if (!allowRecreateIfSeated) {
    return { ok: false, missing: true }
  }

  let state = null
  try {
    state = await findAuthoritativeRoomState(lobbyId)
  } catch (e) {
    console.warn('[hb] falha ao validar assento p/ recriar presença:', e?.message || e)
    return { ok: false, missing: true, error: e }
  }

  const seated = (Array.isArray(state?.players) ? state.players : []).find(
    (p) => String(p?.id) === String(playerId)
  )
  if (!seated) {
    return { ok: false, missing: true, notSeated: true }
  }

  const playerName =
    typeof seated.name === 'string' && seated.name.trim()
      ? seated.name.trim()
      : 'Jogador'

  const { error: upsertErr } = await supabase
    .from('lobby_players')
    .upsert(
      {
        lobby_id: lobbyId,
        player_id: playerId,
        player_name: playerName,
        ready: true,
        joined_at: nowIso,
        last_seen: nowIso,
      },
      { onConflict: 'lobby_id,player_id' }
    )

  if (upsertErr) {
    console.warn('[hb] falha ao recriar presença:', upsertErr?.message || upsertErr)
    return { ok: false, error: upsertErr }
  }

  if (import.meta.env.DEV) {
    console.log('[presence] row restored for seated player')
  }
  return { ok: true, restored: true }
}

/**
 * Presença mínima da sala (lobby_players).
 * Após START os jogadores permanecem na tabela — reutilizamos last_seen no game.
 * Não usa nome como identidade.
 */
export async function listLobbyPresence(lobbyId) {
  if (!lobbyId) return []

  const supported = await isLastSeenSupported()
  if (!supported) return []

  const { data, error } = await supabase
    .from('lobby_players')
    .select('player_id, last_seen')
    .eq('lobby_id', lobbyId)

  if (error) {
    console.warn('[presence] falha ao ler last_seen:', error?.message || error)
    throw error
  }

  return (data || []).map((row) => ({
    playerId: String(row.player_id),
    lastSeen: row.last_seen ? Date.parse(row.last_seen) : null,
  }))
}

export function isPresenceFresh(
  lastSeenMs,
  now = Date.now(),
  thresholdMs = GAME_OFFLINE_THRESHOLD_MS
) {
  if (lastSeenMs == null || !Number.isFinite(lastSeenMs)) return false
  return (now - lastSeenMs) <= thresholdMs
}

/**
 * Coordinator determinístico: primeiro jogador vivo (ordem do roster)
 * cujo last_seen ainda está fresco. Não usa host.
 * Também usado para escolher quem tenta (e assume) host transfer.
 */
export function pickSkipCoordinator(rosterPlayers, presenceList, now = Date.now()) {
  const byId = new Map(
    (presenceList || []).map((p) => [String(p.playerId), p.lastSeen])
  )
  for (const p of rosterPlayers || []) {
    if (!p || p.bankrupt) continue
    const id = String(p.id ?? '')
    if (!id) continue
    if (isPresenceFresh(byId.get(id), now)) return id
  }
  return null
}

/**
 * Transferência condicional de host (CAS em lobbies.host_id).
 * UPDATE ... WHERE id = lobbyId AND host_id = fromHostId
 * Não toca rooms.state.
 */
export async function transferLobbyHost({ lobbyId, fromHostId, toHostId } = {}) {
  if (!lobbyId || !fromHostId || !toHostId) {
    return { ok: false, skipped: true }
  }
  if (String(fromHostId) === String(toHostId)) {
    return { ok: true, transferred: false }
  }

  const { data, error } = await supabase
    .from('lobbies')
    .update({ host_id: toHostId })
    .eq('id', lobbyId)
    .eq('host_id', fromHostId)
    .select('id, host_id')

  if (error) {
    console.warn('[host-transfer] falha CAS:', error?.message || error)
    return { ok: false, error }
  }

  if (!Array.isArray(data) || data.length === 0) {
    return { ok: true, transferred: false, casLost: true }
  }

  return { ok: true, transferred: true, newHostId: String(toHostId) }
}

/**
 * Se o host atual está offline (mesmo threshold do game), o primeiro
 * jogador presente na ordem de candidateIds tenta assumir via CAS.
 * Fail-safe: erro de presença / ninguém presente → não transferir.
 */
export async function attemptHostTransferFromPresence({
  lobbyId,
  myUid,
  candidateIds,
} = {}) {
  if (!lobbyId || !myUid) return { ok: false, skipped: true }

  const order = (Array.isArray(candidateIds) ? candidateIds : [])
    .map((id) => String(id ?? ''))
    .filter(Boolean)
  if (!order.length) return { ok: false, skipped: true }

  let lobby
  try {
    const { data, error } = await supabase
      .from('lobbies')
      .select('id, host_id, status')
      .eq('id', lobbyId)
      .single()
    if (error) throw error
    lobby = data
  } catch (e) {
    return { ok: false, error: e }
  }

  const currentHost = lobby?.host_id != null ? String(lobby.host_id) : ''
  if (!currentHost) return { ok: true, transferred: false, reason: 'no-host' }

  let presence
  try {
    presence = await listLobbyPresence(lobbyId)
  } catch (e) {
    // Fail-safe: erro de rede ≠ host offline
    return { ok: false, error: e }
  }

  const now = Date.now()
  const hostLastSeen = (presence || []).find(
    (p) => String(p.playerId) === currentHost
  )?.lastSeen
  if (isPresenceFresh(hostLastSeen, now, GAME_OFFLINE_THRESHOLD_MS)) {
    return { ok: true, transferred: false, reason: 'host-present' }
  }

  const roster = order.map((id) => ({ id, bankrupt: false }))
  const coordinatorId = pickSkipCoordinator(roster, presence, now)
  if (!coordinatorId) {
    return { ok: true, transferred: false, reason: 'no-present' }
  }
  if (String(coordinatorId) !== String(myUid)) {
    return { ok: true, transferred: false, reason: 'not-coordinator' }
  }

  // Reconfirma antes do write
  let lobby2
  let presence2
  try {
    const [{ data: l2, error: lErr }, p2] = await Promise.all([
      supabase.from('lobbies').select('id, host_id').eq('id', lobbyId).single(),
      listLobbyPresence(lobbyId),
    ])
    if (lErr) throw lErr
    lobby2 = l2
    presence2 = p2
  } catch (e) {
    return { ok: false, error: e }
  }

  const hostStill = lobby2?.host_id != null ? String(lobby2.host_id) : ''
  if (hostStill !== currentHost) {
    return { ok: true, transferred: false, casLost: true }
  }

  const now2 = Date.now()
  const hostLastSeen2 = (presence2 || []).find(
    (p) => String(p.playerId) === currentHost
  )?.lastSeen
  if (isPresenceFresh(hostLastSeen2, now2, GAME_OFFLINE_THRESHOLD_MS)) {
    return { ok: true, transferred: false, reason: 'host-returned' }
  }

  const coord2 = pickSkipCoordinator(
    order.map((id) => ({ id, bankrupt: false })),
    presence2,
    now2
  )
  if (!coord2 || String(coord2) !== String(myUid)) {
    return { ok: true, transferred: false, reason: 'not-coordinator' }
  }

  return transferLobbyHost({
    lobbyId,
    fromHostId: currentHost,
    toHostId: coord2,
  })
}

export function startLobbyHeartbeat({
  lobbyId,
  playerId,
  intervalMs,
  allowRecreateIfSeated = false,
} = {}) {
  if (!lobbyId || !playerId) return () => {}

  const cfg = getLobbyConfig()
  const ms = Number.isFinite(intervalMs) ? intervalMs : cfg.heartbeatIntervalMs

  let stopped = false

  const tick = async () => {
    if (stopped) return
    await touchLobbyPlayer({ lobbyId, playerId, allowRecreateIfSeated })
  }

  // dispara já (não esperar o intervalo)
  tick().catch(() => {})
  const t = setInterval(() => tick().catch(() => {}), ms)

  return () => {
    stopped = true
    clearInterval(t)
  }
}

function _chunk(arr, size) {
  const out = []
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size))
  return out
}

async function _fixHostsIfNeeded(lobbyIds) {
  if (!lobbyIds?.length) return

  const chunks = _chunk(lobbyIds, 25)

  for (const ids of chunks) {
    const [{ data: lobbies, error: lErr }, { data: players, error: pErr }] = await Promise.all([
      supabase.from('lobbies').select('id,status,host_id').in('id', ids),
      supabase.from('lobby_players').select('lobby_id,player_id,joined_at').in('lobby_id', ids).order('joined_at', { ascending: true }),
    ])

    if (lErr) {
      console.warn('[cleanup] falha ao buscar lobbies p/ fix host:', lErr.message || lErr)
      continue
    }
    if (pErr) {
      console.warn('[cleanup] falha ao buscar players p/ fix host:', pErr.message || pErr)
      continue
    }

    const byLobby = new Map()
    for (const p of players || []) {
      if (!byLobby.has(p.lobby_id)) byLobby.set(p.lobby_id, [])
      byLobby.get(p.lobby_id).push(p.player_id)
    }

    for (const l of lobbies || []) {
      // só mexe em open (em locked, host não é crítico pro lobby)
      if (l.status !== 'open') continue

      const pids = byLobby.get(l.id) || []
      if (!pids.length) continue

      if (l.host_id && !pids.includes(l.host_id)) {
        const newHost = pids[0]
        const tr = await transferLobbyHost({
          lobbyId: l.id,
          fromHostId: l.host_id,
          toHostId: newHost,
        })
        if (tr.error) console.warn('[cleanup] falha ao atualizar host:', tr.error?.message || tr.error)
      }
    }
  }
}

export async function cleanupLobbiesOnce() {
  const cfg = getLobbyConfig()
  const now = Date.now()

  // 1) remover players inativos (precisa last_seen)
  const supported = await isLastSeenSupported()
  if (supported) {
    const cutoffIso = new Date(now - cfg.stalePlayerTtlMin * 60_000).toISOString()

    const { data: staleRows, error: sErr } = await supabase
      .from('lobby_players')
      .select('lobby_id,player_id,joined_at,last_seen')
      .or(`last_seen.lt.${cutoffIso},and(last_seen.is.null,joined_at.lt.${cutoffIso})`)
      .limit(1000)

    if (sErr) {
      console.warn('[cleanup] erro buscando stale players:', sErr.message || sErr)
    } else if (staleRows?.length) {
      const impactedLobbyIds = [...new Set(staleRows.map(r => r.lobby_id))]

      const { error: dErr } = await supabase
        .from('lobby_players')
        .delete()
        .or(`last_seen.lt.${cutoffIso},and(last_seen.is.null,joined_at.lt.${cutoffIso})`)

      if (dErr) console.warn('[cleanup] erro deletando stale players:', dErr.message || dErr)
      else console.log(`[cleanup] removidos players inativos: ${staleRows.length}`)

      await _fixHostsIfNeeded(impactedLobbyIds)
    } else {
      console.log('[cleanup] nenhum player inativo pra remover.')
    }
  } else {
    console.warn('[cleanup] last_seen indisponível: pulando limpeza por inatividade.')
  }

  // 2) deletar salas vazias por TTL (atividade = rooms.updated_at || created_at)
  const lobbies = await listLobbies()
  const lobbyIds = (lobbies || []).map((l) => l.id).filter(Boolean)

  const roomByCode = new Map()
  for (const ids of _chunk(lobbyIds, 25)) {
    const { data: roomRows, error: rErr } = await supabase
      .from('rooms')
      .select('code, state, updated_at')
      .in('code', ids)
    if (rErr) {
      console.warn('[cleanup] erro lendo rooms:', rErr.message || rErr)
      continue
    }
    for (const row of roomRows || []) {
      const code = String(row.code || '')
      if (!code) continue
      const prev = roomByCode.get(code)
      const ts = Date.parse(row.updated_at || '') || 0
      const prevTs = prev ? (Date.parse(prev.updated_at || '') || 0) : -1
      if (!prev || ts >= prevTs) roomByCode.set(code, row)
    }
  }

  const emptyCandidates = []
  for (const l of lobbies || []) {
    const count = Array.isArray(l.lobby_players)
      ? Number(l.lobby_players?.[0]?.count || 0)
      : 0
    const createdAtMs = Date.parse(l.created_at || '')
    const room = roomByCode.get(String(l.id))
    const roomUpdatedAtMs = room ? Date.parse(room.updated_at || '') : null
    const plan = planEmptyLobbyDeletion({
      status: l.status,
      playerCount: count,
      createdAtMs: Number.isFinite(createdAtMs) ? createdAtMs : null,
      roomUpdatedAtMs: Number.isFinite(roomUpdatedAtMs) ? roomUpdatedAtMs : null,
      roomPlayerCount: roomStatePlayerCount(room?.state),
      roomGameOver: roomStateGameOver(room?.state),
      now,
      emptyOpenTtlMin: cfg.emptyLobbyTtlMin,
      emptyLockedTtlMin: cfg.emptyLockedTtlMin,
      emptyLockedIdleTtlMin: cfg.emptyLockedIdleTtlMin,
    })
    if (plan.delete) emptyCandidates.push(l.id)
  }

  if ((lobbies?.length || 0) > cfg.maxLobbiesHardCap) {
    console.warn('[cleanup] hard cap de lobbies excedido - priorizando remoção de vazias antigas.')
  }

  if (!emptyCandidates.length) {
    console.log('[cleanup] nada para deletar (salas vazias fora do TTL).')
    return
  }

  // 3) Revalida presença antes do DELETE (nunca apaga jogo vivo)
  const confirmed = []
  for (const ids of _chunk(emptyCandidates, 25)) {
    const { data: livePlayers, error: pErr } = await supabase
      .from('lobby_players')
      .select('lobby_id, last_seen')
      .in('lobby_id', ids)

    if (pErr) {
      console.warn('[cleanup] erro revalidando players:', pErr.message || pErr)
      continue
    }

    const byLobby = new Map()
    for (const row of livePlayers || []) {
      const lid = row.lobby_id
      if (!byLobby.has(lid)) byLobby.set(lid, [])
      byLobby.get(lid).push(row)
    }

    const freshCut = now - GAME_OFFLINE_THRESHOLD_MS
    for (const id of ids) {
      const rows = byLobby.get(id) || []
      const freshPresenceCount = rows.filter((r) => {
        const t = Date.parse(r.last_seen || '')
        return Number.isFinite(t) && t >= freshCut
      }).length
      const guard = canSafelyDeleteLobby({
        playerCount: rows.length,
        freshPresenceCount,
      })
      if (guard.ok) confirmed.push(id)
      else console.log(`[cleanup] skip lobby ${id}: ${guard.reason}`)
    }
  }

  if (!confirmed.length) {
    console.log('[cleanup] candidatos TTL rejeitados pelos guards de presença.')
    return
  }

  for (const id of confirmed) {
    await deleteEmptyLobbyCascade(id)
  }

  console.log(`[cleanup] lobbies vazios deletados: ${confirmed.length}`)
}