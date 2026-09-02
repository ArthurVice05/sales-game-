// src/pages/PlayersLobby.jsx
import { useEffect, useMemo, useRef, useState } from 'react'
import {
  getLobby,
  listLobbyPlayers,
  onLobbyRealtime,
  leaveLobby,
  setReady,
  setLobbyStatus,
  startMatch,
  joinLobby,
  setPlayerName,
  getLatestMatch,          // <<< novo: verificar se já existe match
  findAuthoritativeRoomMeta,
  startLobbyHeartbeat, // ✅ NOVO
  attemptHostTransferFromPresence,
  GAME_PRESENCE_POLL_INTERVAL_MS,
} from '../lib/lobbies'
import {
  resolvePlayerIdForRoom,   // id persistido por sala
  getMatchIdentity,
} from '../auth'
import {
  DEFAULT_MAX_ROUNDS,
  MAX_ROUNDS_LIMIT,
  MIN_ROUNDS,
  normalizeMaxRounds,
} from '../game/roundConfig'
import {
  DEFAULT_TURN_TIME_SEC,
  TURN_TIME_PRESETS,
  normalizeTurnTime,
} from '../game/turnTimeConfig'
import { mergeLobbyMatchSettings, readMatchConfigFromRoomState } from '../game/turnTimerLogic'
import {
  MATCH_ENTRY,
  evaluateMatchEntryReadiness,
} from '../game/matchEntryReadiness.js'
import { useGameNet } from '../net/GameNetProvider.jsx'

/* ---------- Ícones SVG inline (decorativos; sem dependência externa) ---------- */
const svgProps = {
  viewBox: '0 0 24 24',
  fill: 'none',
  stroke: 'currentColor',
  strokeWidth: 2,
  strokeLinecap: 'round',
  strokeLinejoin: 'round',
  'aria-hidden': 'true',
  focusable: 'false',
}

function IconBack(props) {
  return (
    <svg {...svgProps} {...props}>
      <path d="M19 12H5" />
      <path d="M12 19l-7-7 7-7" />
    </svg>
  )
}

function IconGamepad(props) {
  return (
    <svg {...svgProps} {...props}>
      <path d="M6 8h12a4 4 0 0 1 4 4v2a4 4 0 0 1-4 4h-1.5l-2-2h-5l-2 2H6a4 4 0 0 1-4-4v-2a4 4 0 0 1 4-4z" />
      <path d="M8 11v4M6 13h4" />
      <circle cx="15.5" cy="12" r="1" fill="currentColor" stroke="none" />
      <circle cx="18" cy="14" r="1" fill="currentColor" stroke="none" />
    </svg>
  )
}

function IconUsers(props) {
  return (
    <svg {...svgProps} {...props}>
      <path d="M17 21v-2a4 4 0 0 0-4-4H7a4 4 0 0 0-4 4v2" />
      <circle cx="10" cy="7" r="4" />
      <path d="M21 21v-2a4 4 0 0 0-3-3.87" />
      <path d="M16 3.13a4 4 0 0 1 0 7.75" />
    </svg>
  )
}

function IconCheck(props) {
  return (
    <svg {...svgProps} {...props}>
      <path d="M20 6 9 17l-5-5" />
    </svg>
  )
}

function IconBolt(props) {
  return (
    <svg {...svgProps} {...props}>
      <path d="M13 2 3 14h9l-1 8 10-12h-9l1-8z" />
    </svg>
  )
}

function IconUndo(props) {
  return (
    <svg {...svgProps} {...props}>
      <path d="M3 7v6h6" />
      <path d="M21 17a9 9 0 0 0-15-6.7L3 13" />
    </svg>
  )
}

function IconFlag(props) {
  return (
    <svg {...svgProps} {...props}>
      <path d="M4 15s1-1 4-1 5 2 8 2 4-1 4-1V3s-1 1-4 1-5-2-8-2-4 1-4 1z" />
      <path d="M4 22v-7" />
    </svg>
  )
}

function IconPlay(props) {
  return (
    <svg {...svgProps} {...props}>
      <path d="M5 3l14 9-14 9V3z" />
    </svg>
  )
}

function IconExit(props) {
  return (
    <svg {...svgProps} {...props}>
      <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" />
      <path d="M16 17l5-5-5-5" />
      <path d="M21 12H9" />
    </svg>
  )
}

// Rótulo/tema amigáveis por status — puramente visual; nenhuma condição
// de habilitação usa este mapa.
const STATUS_UI = {
  open:    { label: 'Aberta',    key: 'open' },
  locked:  { label: 'Bloqueada', key: 'locked' },
  playing: { label: 'Em jogo',   key: 'playing' },
  in_game: { label: 'Em jogo',   key: 'playing' },
}

export default function PlayersLobby({ lobbyId, playerName, onBack, onStartGame }) {
  const meName = String(playerName || '').trim()
  // Mesma room → mesmo playerId (sobrevive fechar aba). Nome não é chave.
  const meId = useMemo(
    () => resolvePlayerIdForRoom(lobbyId, { playerName: meName }),
    [lobbyId, meName]
  )

  const [lobby, setLobby] = useState(null)
  const [players, setPlayers] = useState([])
  const [loading, setLoading] = useState(true)
  const [toggling, setToggling] = useState(false)
  const [maxRounds, setMaxRounds] = useState(DEFAULT_MAX_ROUNDS)
  const [turnTimeSec, setTurnTimeSec] = useState(DEFAULT_TURN_TIME_SEC)
  const settingsSeededRef = useRef(false)

  const net = useGameNet()
  const netState = net?.state
  const netCommit = net?.commit
  const netReady = !!(net?.enabled && net?.ready)

  const triedEnsure   = useRef(false)
  const firstLoad     = useRef(true)
  const nameSynced    = useRef(false)
  const navigatedOnce = useRef(false)

  const amHost = useMemo(() => lobby?.host_id === meId, [lobby, meId])
  const me = useMemo(() => players.find(p => p.player_id === meId), [players, meId])
  const readyCount = useMemo(() => players.filter(p => p.ready).length, [players])
  const hasDuplicateNames = useMemo(() => {
    const names = players.map(p => String(p.player_name || '').trim().toLowerCase()).filter(Boolean)
    return new Set(names).size !== names.length
  }, [players])
  
  // precisa ser host, sala 'open', >=1 jogador e todos prontos
  const canStart = amHost && lobby?.status === 'open' && players.length >= 1 && readyCount === players.length

  // ✅ C3: se nome estiver vazio, impede fluxo do lobby.
  useEffect(() => {
    if (!meName) {
      alert('Digite seu nome primeiro.')
      onBack?.()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [meName])
  
  // Debug logs para identificar o problema
  console.log('[PlayersLobby] Debug:', {
    players: players.length,
    readyCount,
    lobbyStatus: lobby?.status,
    amHost,
    canStart,
    meId,
    meName
  })

  // navega assim que existir match (evita corrida de eventos)
  // WHY: Busca players do banco se pls não vier ou estiver vazio (evita lista local stale)
  async function maybeNavigate(pls) {
    if (navigatedOnce.current) return
    const match = await getLatestMatch(lobbyId)
    if (!match?.id) return

    let roomMeta = { state: null, updatedAt: null }
    try {
      roomMeta = await findAuthoritativeRoomMeta(lobbyId)
    } catch {}

    const decision = evaluateMatchEntryReadiness({
      latestMatchId: match.id,
      latestMatchCreatedAt: match.created_at,
      roomState: roomMeta.state,
      roomUpdatedAt: roomMeta.updatedAt,
      persistedPlayerId: meId,
      mode: 'guest-wait',
    })
    if (decision.action !== MATCH_ENTRY.ENTER_CURRENT_MATCH) {
      return
    }

    navigatedOnce.current = true
    let currentPlayers = pls
    if (!currentPlayers || currentPlayers.length === 0) {
      currentPlayers = await listLobbyPlayers(lobbyId)
    }
    const normalized = (currentPlayers || []).map((p, i) => ({
      id: p.player_id,
      name: p.player_name,
      index: i,
    }))
    onStartGame?.({
      lobbyId,
      matchId: match.id,
      players: normalized,
      me: { id: meId, name: meName },
      resumeExistingMatch: true,
    })
  }

  /**
   * Reentrada em lobby locked/playing sem joinLobby:
   * identidade persistida + playerId em rooms.state.players → resumeExistingMatch.
   */
  async function tryResumeLockedMatch () {
    if (navigatedOnce.current) return false
    const persisted = getMatchIdentity(lobbyId)
    const playerId = persisted?.playerId
    if (!playerId) return false

    let roomMeta = { state: null, updatedAt: null }
    try {
      roomMeta = await findAuthoritativeRoomMeta(lobbyId)
    } catch {}
    const roster = Array.isArray(roomMeta.state?.players) ? roomMeta.state.players : []
    if (!roster.some((p) => String(p?.id) === String(playerId))) return false

    let match = null
    try {
      match = await getLatestMatch(lobbyId)
    } catch {}

    const decision = evaluateMatchEntryReadiness({
      latestMatchId: match?.id || null,
      latestMatchCreatedAt: match?.created_at || null,
      roomState: roomMeta.state,
      roomUpdatedAt: roomMeta.updatedAt,
      persistedPlayerId: playerId,
      mode: 'legacy-resume',
    })
    if (
      decision.action !== MATCH_ENTRY.ENTER_CURRENT_MATCH &&
      decision.action !== MATCH_ENTRY.RESUME_LEGACY_MATCH
    ) {
      return false
    }

    navigatedOnce.current = true

    onStartGame?.({
      lobbyId,
      matchId: match?.id || null,
      players: [],
      me: { id: playerId, name: meName || persisted.playerName || '' },
      resumeExistingMatch: true,
    })
    return true
  }

  async function refreshAll() {
    if (firstLoad.current) setLoading(true)
    try {
      console.log('[PlayersLobby] refreshAll - buscando lobby:', lobbyId)
      const [lb, pls] = await Promise.all([ getLobby(lobbyId), listLobbyPlayers(lobbyId) ])
      console.log('[PlayersLobby] refreshAll - lobby:', lb, 'players:', pls)
      setLobby(lb)
      setPlayers(pls)

      const mine = pls.find(p => p.player_id === meId)
      console.log('[PlayersLobby] refreshAll - mine:', mine, 'meId:', meId)

      const lobbyOpen = lb?.status === 'open'

      // 1) Se não estou na sala e lobby AINDA open, entra (uma vez). Locked → sem join.
      if (!mine && !triedEnsure.current && lobbyOpen) {
        console.log('[PlayersLobby] refreshAll - entrando na sala')
        triedEnsure.current = true
        try { 
          await joinLobby({ lobbyId, playerId: meId, playerName: meName, ready: false })
          console.log('[PlayersLobby] refreshAll - entrada na sala bem-sucedida')
          // Recarrega os jogadores após entrar na sala
          const newPls = await listLobbyPlayers(lobbyId)
          console.log('[PlayersLobby] refreshAll - jogadores após entrada:', newPls)
          setPlayers(newPls)
        } catch (e) {
          console.error('[PlayersLobby] refreshAll - erro ao entrar na sala:', e)
        }
      }

      // 2) Se estou na sala e o nome diverge, sincroniza (uma vez)
      if (mine && !nameSynced.current && meName && mine.player_name !== meName) {
        console.log('[PlayersLobby] refreshAll - sincronizando nome')
        nameSynced.current = true
        try { await setPlayerName({ lobbyId, playerId: meId, playerName: meName }) } catch {}
      }

      // 3) Se já existe match (host iniciou), navega todos imediatamente
      await maybeNavigate(pls)

      // 4) Lobby locked/playing: reentrada legítima via rooms.state (sem joinLobby)
      if (!navigatedOnce.current && !lobbyOpen) {
        await tryResumeLockedMatch()
      }
    } catch (e) {
      console.error('[PlayersLobby] refreshAll - erro:', e)
    } finally {
      if (firstLoad.current) { firstLoad.current = false; setLoading(false) }
    }
  }

  // Saída automática por pagehide/beforeunload REMOVIDA:
  // Android Chrome dispara pagehide ao trocar de app e ejectava o jogador da sala aberta.
  // Cleanup de assentos inativos fica a cargo do heartbeat + TTL (cleanupLobbiesOnce).
  // Saída explícita (botão Sair) continua chamando leaveLobby em handleLeave.

  useEffect(() => {
    if (!lobbyId) return
    const stop = startLobbyHeartbeat({ lobbyId, playerId: meId })
    return stop
  }, [lobbyId, meId])

  // Host offline no lobby open: transferência por presença (mesmo threshold do game).
  // Saída explícita já transfere via leaveLobby; isto cobre queda de rede / aba morta.
  useEffect(() => {
    if (!lobbyId || !meId) return
    if (lobby?.status && lobby.status !== 'open') return

    let cancelled = false
    const tick = async () => {
      if (cancelled) return
      const candidateIds = (players || []).map((p) => p.player_id).filter(Boolean)
      if (!candidateIds.length) return
      try {
        const ht = await attemptHostTransferFromPresence({
          lobbyId,
          myUid: meId,
          candidateIds,
        })
        if (ht?.transferred && !cancelled) {
          if (import.meta.env.DEV) console.log('[host-transfer] lobby committed')
          refreshAll()
        }
      } catch {}
    }

    tick().catch(() => {})
    const t = setInterval(() => { tick().catch(() => {}) }, GAME_PRESENCE_POLL_INTERVAL_MS)
    return () => {
      cancelled = true
      clearInterval(t)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lobbyId, meId, lobby?.status, players])

  useEffect(() => {
    triedEnsure.current = false
    firstLoad.current = true
    nameSynced.current = false
    navigatedOnce.current = false
    settingsSeededRef.current = false
    refreshAll()
    const off = onLobbyRealtime(lobbyId, () => refreshAll())
    // ✅ CORREÇÃO: Polling para garantir navegação em caso de race condition
    const pollInterval = setInterval(() => {
      if (!navigatedOnce.current) {
        refreshAll()
      }
    }, 1000)

    return () => {
      off()
      clearInterval(pollInterval)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lobbyId])

  // Fonte única: rooms.state.maxRounds + turnTimeSec (mesmo canal da partida).
  useEffect(() => {
    if (!netReady || !netState) return
    const cfg = readMatchConfigFromRoomState(netState)
    setMaxRounds(cfg.maxRounds)
    setTurnTimeSec(cfg.turnTimeSec)
  }, [netReady, netState?.maxRounds, netState?.turnTimeSec, netState?.stateId])

  // Host publica defaults uma vez se a sala ainda não tiver config.
  useEffect(() => {
    if (!netReady || !amHost || typeof netCommit !== 'function') return
    if (settingsSeededRef.current) return
    const hasRounds = Object.prototype.hasOwnProperty.call(netState || {}, 'maxRounds')
    const hasTime = Object.prototype.hasOwnProperty.call(netState || {}, 'turnTimeSec')
    if (hasRounds && hasTime) {
      settingsSeededRef.current = true
      return
    }
    settingsSeededRef.current = true
    netCommit((prev) => mergeLobbyMatchSettings(prev, {
      maxRounds: hasRounds ? prev?.maxRounds : DEFAULT_MAX_ROUNDS,
      turnTimeSec: hasTime ? prev?.turnTimeSec : DEFAULT_TURN_TIME_SEC,
    }))
  }, [netReady, amHost, netCommit, netState])

  function publishMatchSettings(next) {
    const cfg = {
      maxRounds: normalizeMaxRounds(
        next.maxRounds != null ? next.maxRounds : maxRounds
      ),
      turnTimeSec: normalizeTurnTime(
        next.turnTimeSec != null ? next.turnTimeSec : turnTimeSec
      ),
    }
    setMaxRounds(cfg.maxRounds)
    setTurnTimeSec(cfg.turnTimeSec)
    if (typeof netCommit === 'function') {
      netCommit((prev) => mergeLobbyMatchSettings(prev, cfg))
    }
  }

  // Toggle otimista
  async function setReadyUI(next) {
    if (!me) return
    setToggling(true)
    const prev = me.ready
    setPlayers(curr => curr.map(p => p.player_id === meId ? { ...p, ready: next } : p))
    try {
      await setReady(lobbyId, meId, next)
    } catch (e) {
      setPlayers(curr => curr.map(p => p.player_id === meId ? { ...p, ready: prev } : p))
      console.error('setReadyUI failed', e)
    } finally {
      setToggling(false)
    }
  }

  async function handleLeave() {
    try { await leaveLobby({ lobbyId, playerId: meId }) } finally { onBack?.() }
  }

  async function handleStart() {
    if (!canStart) return
    const prev = lobby?.status
    await setLobbyStatus(lobbyId, 'locked')   // trava a sala
    try {
      // ✅ CORREÇÃO: Busca lista "fresh" do banco no momento do clique
      // WHY: O estado local "players" pode estar desatualizado (ex: 2 jogadores em vez de 3)
      const currentPlayers = await listLobbyPlayers(lobbyId)
      
      // ✅ Valida se todos estão prontos (com a lista do banco)
      const allReady = currentPlayers.every(p => p.ready)
      if (!allReady || currentPlayers.length === 0) {
        console.warn('[handleStart] Nem todos prontos ou lista vazia:', currentPlayers)
        await setLobbyStatus(lobbyId, prev || 'open') // rollback
        return
      }
      
      const match = await startMatch({ lobbyId })
      navigatedOnce.current = true
      const normalized = currentPlayers.map((p, i) => ({ id: p.player_id, name: p.player_name, index: i }))
      const startResult = await Promise.resolve(onStartGame?.({
        lobbyId,
        matchId: match?.id,
        players: normalized,
        me: { id: meId, name: meName },
        maxRounds: normalizeMaxRounds(maxRounds),
        turnTimeSec: normalizeTurnTime(turnTimeSec),
        resumeExistingMatch: false,
      }))
      if (startResult && startResult.ok === false) {
        navigatedOnce.current = false
        await setLobbyStatus(lobbyId, prev || 'open')
      }
    } catch (e) {
      console.error('startMatch failed', e)
      await setLobbyStatus(lobbyId, prev || 'open') // rollback
    }
  }

  // ---------- valores derivados SÓ para apresentação (nenhuma regra nova) ----------
  const rawStatus = lobby?.status || ''
  const statusUi = STATUS_UI[rawStatus] || { label: rawStatus || '…', key: 'other' }
  const totalPlayers = players.length
  const readyPct = totalPlayers > 0
    ? Math.max(0, Math.min(100, Math.round((readyCount / totalPlayers) * 100)))
    : 0
  const maxPlayers = Number(lobby?.max_players) || null
  const roundsValue = normalizeMaxRounds(maxRounds)
  const turnTimeValue = normalizeTurnTime(turnTimeSec)
  const roomName = String(lobby?.name || '').trim() || '…'

  return (
    <div className="playerLobbyPage">
      <div className="playerLobbyContainer">
        {/* ===== Cabeçalho da sala ===== */}
        <header className="playerLobbyHero">
          <button type="button" className="playerLobbyBackBtn" onClick={handleLeave}>
            <IconBack />
            Voltar
          </button>
          <span className="playerLobbyHeroIcon" aria-hidden="true"><IconGamepad /></span>
          <div className="playerLobbyHeroContent">
            <h2 className="playerLobbyTitle" title={roomName}>{roomName}</h2>
            <p className="playerLobbySubtitle">Sala de espera da partida</p>
            <div className="playerLobbyMeta">
              <span className={`playerLobbyStatusBadge playerLobbyStatusBadge--${statusUi.key}`}>
                {statusUi.label}
              </span>
              <span className="playerLobbyMetaItem">
                <IconUsers />
                {totalPlayers}{maxPlayers ? ` de ${maxPlayers}` : ''} {(maxPlayers ?? totalPlayers) === 1 ? 'jogador' : 'jogadores'}
              </span>
              <span className="playerLobbyMetaItem">
                <IconCheck />
                {readyCount} {readyCount === 1 ? 'pronto' : 'prontos'}
              </span>
            </div>
          </div>
        </header>

        {/* ===== Painel de jogadores ===== */}
        <section className="playerLobbyPanel">
          <div className="playerLobbyPanelHeader">
            <h3 className="playerLobbyPanelTitle"><IconUsers /> Jogadores da sala</h3>
            <p className="playerLobbyPanelHint">
              Todos precisam estar prontos para iniciar a partida.
            </p>
          </div>

          <div className="playerLobbyProgress">
            <div className="playerLobbyProgressHeader">
              <span>Jogadores prontos</span>
              <b>{readyCount}/{totalPlayers}</b>
            </div>
            <div className="playerLobbyProgressTrack" aria-hidden="true">
              <div className="playerLobbyProgressFill" style={{ width: `${readyPct}%` }} />
            </div>
          </div>

          {loading ? (
            <div className="playerLobbyLoading">Carregando…</div>
          ) : (
            <div className="playerLobbyPlayers">
              {players.map((p) => {
                const isHost = lobby?.host_id === p.player_id
                const isMe = p.player_id === meId
                const pName = String(p.player_name || '').trim() || 'Anônimo'
                const initial = pName.charAt(0).toUpperCase() || '?'
                return (
                  <div key={p.player_id} className="playerLobbyPlayerCard">
                    <span className="playerLobbyAvatar" aria-hidden="true">{initial}</span>
                    <div className="playerLobbyPlayerInfo">
                      <div className="playerLobbyPlayerName" title={pName}>{pName}</div>
                      <div className="playerLobbyBadges">
                        {isHost && <span className="playerLobbyBadge playerLobbyBadge--host">Host</span>}
                        {isMe && <span className="playerLobbyBadge playerLobbyBadge--me">Você</span>}
                        {p.ready ? (
                          <span className="playerLobbyBadge playerLobbyBadge--ready">
                            <IconCheck /> Pronto
                          </span>
                        ) : (
                          <span className="playerLobbyBadge playerLobbyBadge--waiting">
                            Não pronto
                          </span>
                        )}
                      </div>
                    </div>
                    {isMe && (
                      <button
                        type="button"
                        className={`playerLobbyReadyBtn${me?.ready ? ' playerLobbyReadyBtn--undo' : ''}`}
                        onClick={() => setReadyUI(!me?.ready)}
                        disabled={toggling}
                      >
                        {me?.ready ? <IconUndo /> : <IconBolt />}
                        {me?.ready ? 'Marcar como não pronto' : 'Ficar pronto'}
                      </button>
                    )}
                  </div>
                )
              })}
            </div>
          )}
        </section>

        {/* ===== Painel de duração da partida ===== */}
        <section className="playerLobbyPanel">
          <div className="playerLobbyPanelHeader">
            <h3 className="playerLobbyPanelTitle"><IconFlag /> Duração da partida</h3>
            <p className="playerLobbyPanelHint">
              O host escolhe quantas rodadas serão jogadas ({MIN_ROUNDS} a {MAX_ROUNDS_LIMIT}; padrão {DEFAULT_MAX_ROUNDS}).
            </p>
          </div>

          {amHost ? (
            <>
              <div className="playerLobbyRounds" role="group" aria-label="Número de rodadas">
                {Array.from({ length: MAX_ROUNDS_LIMIT }, (_, i) => i + MIN_ROUNDS).map((n) => (
                  <button
                    key={n}
                    type="button"
                    className={`playerLobbyRoundBtn${maxRounds === n ? ' playerLobbyRoundBtn--active' : ''}`}
                    aria-pressed={maxRounds === n}
                    onClick={() => publishMatchSettings({ maxRounds: n })}
                  >
                    {n}
                  </button>
                ))}
              </div>
              <p className="playerLobbyRoundSelection">
                Rodadas: <b>{roundsValue}</b>
              </p>
            </>
          ) : (
            <p className="playerLobbyRoundSelection">
              Rodadas: <b>{roundsValue}</b>
            </p>
          )}
          <p className="playerLobbyRoundNote">Somente o host pode alterar esta configuração.</p>
        </section>

        {/* ===== Tempo por jogada ===== */}
        <section className="playerLobbyPanel">
          <div className="playerLobbyPanelHeader">
            <h3 className="playerLobbyPanelTitle"><IconFlag /> Tempo por jogada</h3>
            <p className="playerLobbyPanelHint">
              Contagem regressiva de cada turno ({TURN_TIME_PRESETS[0]}–{TURN_TIME_PRESETS[TURN_TIME_PRESETS.length - 1]}s; padrão {DEFAULT_TURN_TIME_SEC}s).
            </p>
          </div>

          {amHost ? (
            <>
              <div className="playerLobbyRounds" role="group" aria-label="Tempo por jogada">
                {TURN_TIME_PRESETS.map((n) => (
                  <button
                    key={n}
                    type="button"
                    className={`playerLobbyRoundBtn${turnTimeSec === n ? ' playerLobbyRoundBtn--active' : ''}`}
                    aria-pressed={turnTimeSec === n}
                    onClick={() => publishMatchSettings({ turnTimeSec: n })}
                  >
                    {n}s
                  </button>
                ))}
              </div>
              <p className="playerLobbyRoundSelection">
                Tempo por jogada: <b>{turnTimeValue}s</b>
              </p>
            </>
          ) : (
            <p className="playerLobbyRoundSelection">
              Tempo por jogada: <b>{turnTimeValue}s</b>
            </p>
          )}
          <p className="playerLobbyRoundNote">Somente o host pode alterar esta configuração.</p>
        </section>

        {/* ===== Objetivo da partida (mesmo texto para host e convidados) ===== */}
        <section className="playerLobbyPanel">
          <div className="playerLobbyPanelHeader">
            <h3 className="playerLobbyPanelTitle"><IconFlag /> Objetivo</h3>
            <p className="playerLobbyPanelHint">
              Todos veem a mesma regra de vitória desta sala.
            </p>
          </div>
          <p className="playerLobbyRoundSelection">
            Rodadas: <b>{roundsValue}</b>
          </p>
          <p className="playerLobbyRoundSelection">
            Tempo por jogada: <b>{turnTimeValue}s</b>
          </p>
          <p className="playerLobbyRoundSelection">
            Objetivo: termine a partida com o maior patrimônio.
          </p>
          <p className="playerLobbyRoundNote">Patrimônio = Caixa + Bens.</p>
        </section>

        {/* ===== Painel inferior: status + mensagem + ações ===== */}
        <footer className="playerLobbyFooter">
          <div className="playerLobbyStatusGroup">
            <div className="playerLobbyStatusItem">
              <span className="playerLobbyStatusLabel">Status da sala</span>
              <span className="playerLobbyStatusValue">
                <span className={`playerLobbyDot playerLobbyDot--${statusUi.key}`} aria-hidden="true" />
                {statusUi.label}
              </span>
            </div>
            <div className="playerLobbyStatusItem">
              <span className="playerLobbyStatusLabel">Prontos</span>
              <span className="playerLobbyStatusValue">{readyCount} de {totalPlayers}</span>
            </div>
          </div>

          <div className="playerLobbyMessageArea">
            <p className="playerLobbyMessage">
              {amHost
                ? (canStart
                    ? 'Todos prontos — você pode iniciar a partida.'
                    : `Aguardando todos ficarem prontos (${readyCount}/${players.length}).`)
                : (me?.ready
                    ? 'Tudo certo — aguarde o host iniciar a partida.'
                    : 'Marque “Ficar pronto” para o host poder iniciar.')}
            </p>
            {hasDuplicateNames && (
              <p className="playerLobbyWarning">
                Aviso: existe nome duplicado na sala. (A identidade é pelo ID; renomear evita confusão.)
              </p>
            )}
          </div>

          <div className="playerLobbyActions">
            <button
              type="button"
              className="playerLobbyStartBtn"
              onClick={handleStart}
              disabled={!canStart}
            >
              <IconPlay />
              Iniciar partida
            </button>
            <button type="button" className="playerLobbyLeaveBtn" onClick={handleLeave}>
              <IconExit />
              Sair da sala
            </button>
          </div>
        </footer>
      </div>
    </div>
  )
}
