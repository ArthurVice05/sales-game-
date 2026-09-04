// src/pages/LobbyList.jsx
import { useEffect, useRef, useState } from 'react'
import {
  getOrCreateTabPlayerId,     // <-- id por ABA (fallback / create)
  resolvePlayerIdForRoom,     // <-- id persistido por sala
  setMatchIdentity,
  getMatchIdentity,
  countMatchIdentities,
} from '../auth'
import { resolveLobbyEntryAction } from '../game/spectatorMode.js'
import {
  listLobbies,
  onLobbiesRealtime,
  cleanupLobbiesOnce,
  getLobbyConfig,
  createLobby,
  joinLobby,
  canResumeLockedMatch,
} from '../lib/lobbies'

/* ---------- Ícones SVG inline (decorativos; sem dependência externa) ----------
   Todos usam currentColor e recebem className/size via props. */
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

function IconRefresh(props) {
  return (
    <svg {...svgProps} {...props}>
      <path d="M23 4v6h-6" />
      <path d="M1 20v-6h6" />
      <path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10" />
      <path d="M1 14l4.64 4.36A9 9 0 0 0 20.49 15" />
    </svg>
  )
}

function IconPlus(props) {
  return (
    <svg {...svgProps} {...props}>
      <path d="M12 5v14M5 12h14" />
    </svg>
  )
}

function IconEnter(props) {
  return (
    <svg {...svgProps} {...props}>
      <path d="M15 3h4a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2h-4" />
      <path d="M10 17l5-5-5-5" />
      <path d="M15 12H3" />
    </svg>
  )
}

function IconEye(props) {
  return (
    <svg {...svgProps} {...props}>
      <path d="M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7-10-7-10-7z" />
      <circle cx="12" cy="12" r="3" />
    </svg>
  )
}

function IconClose(props) {
  return (
    <svg {...svgProps} {...props}>
      <path d="M18 6 6 18M6 6l12 12" />
    </svg>
  )
}

/* Card fantasma exibido apenas durante o primeiro carregamento (visual puro) */
function LobbySkeletonCard() {
  return (
    <div className="lobbyCard lobbySkelCard" aria-hidden="true">
      <div className="lobbyCardTop">
        <span className="lobbySkel lobbySkelAvatar" />
        <div className="lobbyCardInfo">
          <span className="lobbySkel lobbySkelLine lobbySkelLine--lg" />
          <span className="lobbySkel lobbySkelLine lobbySkelLine--sm" />
        </div>
        <span className="lobbySkel lobbySkelBadge" />
      </div>
      <span className="lobbySkel lobbySkelBar" />
      <span className="lobbySkel lobbySkelBtn" />
    </div>
  )
}

export default function LobbyList({ onEnterRoom, onSpectateRoom, playerName, spectateNotice = '' }) {
  const [rows, setRows] = useState([])
  const [loading, setLoading] = useState(false)
  /** lobbyIds que passaram canResumeLockedMatch (identidade + snapshot). */
  const [resumableIds, setResumableIds] = useState(() => new Set())

  // Estados locais do modal "Criar sala" — apenas formulário de interface;
  // nada disso vai para Supabase, realtime ou multiplayer.
  const [createModalOpen, setCreateModalOpen] = useState(false)
  const [lobbyNameDraft, setLobbyNameDraft] = useState('')
  const [createNameError, setCreateNameError] = useState('')      // nome vazio
  const [createSubmitError, setCreateSubmitError] = useState('')  // falha ao criar/entrar
  const [creating, setCreating] = useState(false)
  const creatingRef = useRef(false) // proteção síncrona contra envio duplicado
  const createOpenerRef = useRef(null) // botão que abriu o modal (p/ devolver o foco)
  // iOS: autoFocus em input <16px / ao abrir modal causa zoom residual
  const allowCreateAutoFocus = useRef(
    typeof window === 'undefined'
      ? true
      : !(
          window.matchMedia('(pointer: coarse)').matches ||
          window.matchMedia('(max-width: 960px)').matches
        )
  ).current

  useEffect(() => {
    const cfg = getLobbyConfig()

    cleanupLobbiesOnce().catch(err => console.warn('[cleanup] falha:', err))

    const t = setInterval(() => {
      cleanupLobbiesOnce().catch(err => console.warn('[cleanup] falha:', err))
    }, cfg.cleanupIntervalMs)

    return () => clearInterval(t)
  }, [])

  async function refresh() {
    setLoading(true)
    try {
      const data = await listLobbies()
      setRows(data)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    refresh()
    const off = onLobbiesRealtime(() => refresh())
    return off
  }, [])

  // Valida quais salas locked dá para retomar (identidade local + rooms.state).
  useEffect(() => {
    let cancelled = false

    async function probeResumable() {
      const locked = (rows || []).filter((r) => String(r.status || 'open') !== 'open')
      if (!locked.length) {
        if (!cancelled) setResumableIds(new Set())
        return
      }

      const next = new Set()
      await Promise.all(
        locked.map(async (r) => {
          const playerId = getMatchIdentity(r.id)?.playerId
          if (!playerId) return
          try {
            const { ok } = await canResumeLockedMatch(r.id, playerId)
            if (ok) next.add(String(r.id))
          } catch {
            // rede/snapshot: mantém sem destaque; clique ainda revalida
          }
        })
      )

      if (!cancelled) setResumableIds(next)
    }

    probeResumable()
    return () => { cancelled = true }
  }, [rows])

  // Abre o modal de criação com o mesmo nome padrão do antigo prompt.
  // A criação em si acontece em confirmCreateLobby.
  function handleCreate() {
    const pn = String(playerName || '').trim()
    if (!pn) {
      alert('Digite seu nome na tela inicial antes de criar/entrar em salas.')
      return
    }
    const defaultName = `Sala de ${pn}`
    createOpenerRef.current = document.activeElement
    setLobbyNameDraft(defaultName)
    setCreateNameError('')
    setCreateSubmitError('')
    setCreateModalOpen(true)
  }

  // Confirma o formulário do modal e executa a MESMA criação que antes
  // acontecia após o prompt (createLobby + joinLobby + onEnterRoom).
  // Em caso de falha, o modal permanece aberto com o erro visível.
  async function confirmCreateLobby(e) {
    e.preventDefault()
    if (creatingRef.current) return // evita criação duplicada (síncrono)

    const name = lobbyNameDraft.trim()
    if (!name) {
      setCreateNameError('Digite um nome para a sala.')
      return
    }

    const pn = String(playerName || '').trim()
    if (!pn) {
      setCreateSubmitError('O nome do jogador não está disponível.')
      return
    }

    // usamos o id desta aba como hostId; após criar, vinculamos à sala
    const hostId = getOrCreateTabPlayerId()

    creatingRef.current = true
    setCreating(true)
    setCreateSubmitError('')

    try {
      const lobbyId = await createLobby({ name, hostId, max: 4 })

      setMatchIdentity(lobbyId, { playerId: hostId, playerName: pn })

      await joinLobby({
        lobbyId,
        playerId: hostId,
        playerName: pn,
        ready: false,
      })

      // fecha somente após o sucesso
      setCreateModalOpen(false)
      createOpenerRef.current = null
      onEnterRoom?.(lobbyId)
    } catch (err) {
      // modal continua aberto com o rascunho preservado
      setCreateSubmitError(
        err.message || 'Não foi possível criar a sala. Tente novamente.'
      )
      await refresh()
    } finally {
      creatingRef.current = false
      setCreating(false)
    }
  }

  // Fecha o modal sem criar sala (Cancelar, ×, Escape ou clique no backdrop)
  function closeCreateModal() {
    if (creatingRef.current) return // não fecha durante uma criação em andamento
    setCreateModalOpen(false)
    setCreateNameError('')
    setCreateSubmitError('')
    const opener = createOpenerRef.current
    createOpenerRef.current = null
    if (opener && typeof opener.focus === 'function') opener.focus()
  }

  // Entra em sala open (join) OU reentra em partida locked se identidade + rooms.state validarem.
  // Assistir NÃO cria assento: sem nome, sem joinLobby, sem matchIdentity.
  function handleSpectate(lobbyId) {
    onSpectateRoom?.(lobbyId)
  }

  async function handleJoin(lobbyId, roomStatus = 'open') {
    try {
      const status = String(roomStatus || 'open')
      const isOpen = status === 'open'

      // Prioridade: quem tem identidade nesta sala retoma o assento; só quem não
      // tem é encaminhado para o modo espectador.
      if (!isOpen && !getMatchIdentity(lobbyId)?.playerId) {
        const entry = resolveLobbyEntryAction({ status, hasLocalMatchIdentity: false })
        if (entry.action === 'spectate') {
          handleSpectate(lobbyId)
          return
        }
      }

      const pn = String(playerName || '').trim()
      if (!pn) {
        alert('Digite seu nome na tela inicial antes de entrar em salas.')
        return
      }

      if (!isOpen) {
        // Bypass de "Sala bloqueada" SOMENTE se identidade persistida + player no snapshot.
        const persisted = getMatchIdentity(lobbyId)
        const playerId = persisted?.playerId
        if (import.meta.env.DEV) {
          console.log('[resume-card] click locked', {
            identity: !!playerId,
            idSuffix: String(lobbyId || '').slice(-8),
          })
        }
        if (!playerId) {
          alert('Sala bloqueada.')
          return
        }
        const { ok } = await canResumeLockedMatch(lobbyId, playerId)
        if (import.meta.env.DEV) {
          console.log('[resume-card] snapshot/playerMatch', { ok })
        }
        if (!ok) {
          alert('Sala bloqueada.')
          return
        }
        // Não joinLobby: recuperação de assento existente → PlayersLobby → resumeExistingMatch
        onEnterRoom?.(lobbyId)
        return
      }

      const playerId = resolvePlayerIdForRoom(lobbyId, { playerName: pn })
      await joinLobby({ lobbyId, playerId, playerName: pn, ready: false })
      onEnterRoom?.(lobbyId)
    } catch (e) {
      alert(e.message || 'Não foi possível entrar no lobby.')
    }
  }

  // ---------- UI (somente apresentação; nenhuma regra de negócio) ----------

  // Rótulo/tema amigáveis por status — puramente visual; a lógica de
  // habilitar/desabilitar continua usando o status cru como antes.
  const STATUS_UI = {
    open:    { label: 'Aberta',    key: 'open' },
    locked:  { label: 'Bloqueada', key: 'locked' },
    playing: { label: 'Em jogo',   key: 'playing' },
    in_game: { label: 'Em jogo',   key: 'playing' },
  }

  // contagens apenas de apresentação, derivadas do estado já carregado
  const totalRooms = rows.length
  const openRooms = rows.filter(room => (room.status ?? 'open') === 'open').length

  const showSkeleton = loading && rows.length === 0
  const showEmpty = !loading && rows.length === 0
  const resumableCount = resumableIds.size

  const displayRows = (() => {
    if (!rows.length || !resumableCount) return rows
    const resumable = []
    const rest = []
    for (const r of rows) {
      if (resumableIds.has(String(r.id))) resumable.push(r)
      else rest.push(r)
    }
    return [...resumable, ...rest]
  })()

  return (
    <div className="lobbyPage">
      <div className="lobbyContainer">
        <header className="lobbyPanel">
          <div className="lobbyPanelMain">
            <span className="lobbyPanelIcon" aria-hidden="true"><IconGamepad /></span>
            <div className="lobbyHeaderText">
              <h2 className="lobbyListTitle">Salas de jogo</h2>
              <p className="lobbyListHint">
                Crie uma sala ou entre em uma existente para jogar com outros vendedores.
              </p>
              <p className="lobbyCounts">
                <b>{totalRooms}</b> {totalRooms === 1 ? 'sala disponível' : 'salas disponíveis'}
                {' · '}
                <b>{openRooms}</b> {openRooms === 1 ? 'aberta' : 'abertas'}
              </p>
            </div>
          </div>
          <div className="lobbyActions">
            <button type="button" className="lobbyBtn lobbyBtn--ghost" onClick={refresh} disabled={loading}>
              <IconRefresh className={loading ? 'lobbyRefreshIcon--spinning' : undefined} />
              {loading ? 'Atualizando…' : 'Atualizar'}
            </button>
            <button type="button" className="lobbyBtn lobbyBtn--primary" onClick={handleCreate}>
              <IconPlus />
              Criar sala
            </button>
          </div>
        </header>

        {spectateNotice ? (
          <div className="lobbySpectateNotice" role="status">
            {spectateNotice}
          </div>
        ) : null}

        {resumableCount > 0 && (
          <div className="lobbyResumeBanner" role="status">
            <div className="lobbyResumeBannerText">
              <strong>
                {resumableCount === 1
                  ? 'Você tem 1 partida para retomar'
                  : `Você tem ${resumableCount} partidas para retomar`}
              </strong>
              <span>
                {' '}Use <b>Retomar partida</b> no card destacado — sua identidade nesta sala foi reconhecida.
              </span>
            </div>
          </div>
        )}

        {showEmpty ? (
          <div className="lobbyEmpty">
            <span className="lobbyEmptyIcon" aria-hidden="true"><IconGamepad /></span>
            <div className="lobbyEmptyTitle">Nenhuma sala disponível</div>
            <p className="lobbyEmptyText">
              Crie uma nova sala e convide outros jogadores para começar.
            </p>
            <button type="button" className="lobbyBtn lobbyBtn--primary" onClick={handleCreate}>
              <IconPlus />
              Criar primeira sala
            </button>
          </div>
        ) : (
          <div className="lobbyScroll lobbyScrollArea" aria-busy={loading}>
            <div className="lobbyGrid">
              {showSkeleton
                ? [0, 1, 2, 3].map(i => <LobbySkeletonCard key={i} />)
                : displayRows.map(r => {
                    const isFull = (r.players ?? 0) >= (r.max ?? 4)
                    const isOpen = (r.status ?? 'open') === 'open'
                    // Reentrada: se há identidade local desta room, o botão fica clicável
                    // (validação real contra rooms.state ocorre no clique — localStorage sozinho não basta).
                    const identity = !isOpen ? getMatchIdentity(r.id) : null
                    const hasLocalMatchIdentity = !!identity?.playerId
                    const canResume = !isOpen && resumableIds.has(String(r.id))
                    // Fonte única da ação do card (join / resume / spectate / none).
                    // Espectador não ocupa vaga: isFull nunca bloqueia "Assistir".
                    const entry = resolveLobbyEntryAction({
                      status: r.status ?? 'open',
                      hasLocalMatchIdentity,
                      canResume,
                      isFull,
                    })
                    const canSpectate = entry.action === 'spectate'
                    const disabled = entry.disabled

                    if (import.meta.env.DEV && !isOpen) {
                      // Diagnóstico do card locked — sem UUID completo / sem snapshot financeiro
                      console.log('[resume-card] locked=true', {
                        identity: hasLocalMatchIdentity,
                        canResume,
                        full: isFull,
                        status: String(r.status || ''),
                        idSuffix: String(r.id || '').slice(-8),
                        storedIdentities: countMatchIdentities(),
                        // 1/4 vem de lobby_players (contador visual), NÃO de rooms.state
                        lobbyPlayersCount: Number(r.players ?? 0) || 0,
                      })
                    }
                    // leitura defensiva SÓ para exibição (ocupação/percentual);
                    // as condições acima permanecem a fonte do comportamento
                    const players = Math.max(0, Number(r.players ?? 0) || 0)
                    const max = Math.max(1, Number(r.max ?? 4) || 4)
                    const occPct = Math.max(0, Math.min(100, Math.round((players / max) * 100)))
                    const rawStatus = r.status ?? 'open'
                    const isPlaying =
                      rawStatus === 'playing' || rawStatus === 'in_game'

                    const st = STATUS_UI[rawStatus] || {
                      label: rawStatus,
                      key: 'other',
                    }
                    const roomName = String(r.name || '').trim() || 'Sala sem nome'
                    const initial = roomName.charAt(0).toUpperCase()

                    // vagas como círculos (máx. 6 p/ não quebrar; o texto numérico
                    // continua mostrando o valor completo)
                    const seatCount = Math.min(max, 6)
                    const filledSeats = Math.max(0, Math.min(players, seatCount))

                    // texto do botão conforme estado (apresentação; ação inalterada)
                    const joinLabel = entry.label

                    return (
                      <div
                        key={r.id}
                        className={`lobbyCard lobbyCard--${st.key}${canResume ? ' lobbyCard--resume' : ''}`}
                      >
                        <div className="lobbyCardTop">
                          <span className="lobbyCardAvatar" aria-hidden="true">{initial}</span>
                          <div className="lobbyCardInfo">
                            <div className="lobbyCardName" title={roomName}>{roomName}</div>
                            {canResume && (
                              <div className="lobbyCardResumeNote">Sua partida — pode retomar</div>
                            )}
                          </div>
                          <span className={`lobbyBadge lobbyBadge--${st.key}${canResume ? ' lobbyBadge--resume' : ''}`}>
                            {canResume ? 'Retomar' : st.label}
                          </span>
                        </div>

                        <div className="lobbyCardBody">
                          <div className="lobbyCardPlayersRow">
                            <span className="lobbyCardPlayersLabel">
                              <IconUsers />
                              Jogadores
                            </span>
                            <span className="lobbyCardPlayersCount">{players}/{max}</span>
                          </div>
                          <div className="lobbySeats" aria-hidden="true">
                            {Array.from({ length: seatCount }, (_, i) => (
                              <span
                                key={i}
                                className={`lobbySeat${i < filledSeats ? ' lobbySeat--filled' : ''}`}
                              />
                            ))}
                          </div>
                          <div className="lobbyOcc" aria-hidden="true">
                            <div className="lobbyOccFill" style={{ width: `${occPct}%` }} />
                          </div>
                        </div>

                        <button
                          type="button"
                          className={`lobbyJoinBtn${canResume ? ' lobbyJoinBtn--resume' : ''}${canSpectate ? ' lobbyJoinBtn--spectate' : ''}`}
                          disabled={disabled}
                          onClick={() => (canSpectate ? handleSpectate(r.id) : handleJoin(r.id, rawStatus))}
                          title={
                            disabled
                              ? joinLabel
                              : canSpectate
                              ? 'Assistir esta partida (não ocupa vaga)'
                              : canResume
                              ? 'Retomar partida'
                              : (isOpen ? 'Entrar na sala' : 'Reentrar na partida')
                          }
                        >
                          {!disabled && (canSpectate ? <IconEye /> : <IconEnter />)}
                          {joinLabel}
                        </button>
                      </div>
                    )
                  })}
            </div>
          </div>
        )}
      </div>

      {createModalOpen && (
        <div
          className="lobbyModalBackdrop"
          role="presentation"
          onClick={e => { if (e.target === e.currentTarget) closeCreateModal() }}
          onKeyDown={e => { if (e.key === 'Escape') closeCreateModal() }}
        >
          <div
            className="lobbyModal"
            role="dialog"
            aria-modal="true"
            aria-labelledby="create-lobby-title"
          >
            <div className="lobbyModalHeader">
              <span className="lobbyModalIcon" aria-hidden="true"><IconGamepad /></span>
              <div className="lobbyModalHeading">
                <h3 id="create-lobby-title" className="lobbyModalTitle">Criar nova sala</h3>
                <p className="lobbyModalSubtitle">Escolha um nome para identificar sua sala.</p>
              </div>
              <button
                type="button"
                className="lobbyModalClose"
                onClick={closeCreateModal}
                aria-label="Fechar"
                disabled={creating}
              >
                <IconClose />
              </button>
            </div>

            <form className="lobbyModalBody" onSubmit={confirmCreateLobby}>
              <div className="lobbyModalField">
                <label className="lobbyModalLabel" htmlFor="lobby-name-input">Nome da sala</label>
                <input
                  id="lobby-name-input"
                  className={`lobbyModalInput${createNameError ? ' lobbyModalInput--error' : ''}`}
                  type="text"
                  value={lobbyNameDraft}
                  onChange={e => {
                    setLobbyNameDraft(e.target.value)
                    if (createNameError) setCreateNameError('')
                  }}
                  maxLength={50}
                  autoFocus={allowCreateAutoFocus}
                  autoComplete="off"
                  disabled={creating}
                  aria-invalid={createNameError ? true : undefined}
                  aria-describedby={createNameError ? 'lobby-name-error' : 'lobby-name-help'}
                />
                {createNameError ? (
                  <p id="lobby-name-error" className="lobbyModalError" role="alert">
                    {createNameError}
                  </p>
                ) : (
                  <p id="lobby-name-help" className="lobbyModalHelp">
                    {lobbyNameDraft.length}/50 caracteres
                  </p>
                )}
              </div>

              {createSubmitError && (
                <p className="lobbyModalSubmitError" role="alert">
                  {createSubmitError}
                </p>
              )}

              <div className="lobbyModalFooter">
                <button
                  type="button"
                  className="lobbyBtn lobbyBtn--ghost"
                  onClick={closeCreateModal}
                  disabled={creating}
                >
                  Cancelar
                </button>
                <button type="submit" className="lobbyBtn lobbyBtn--primary" disabled={creating}>
                  <IconPlus />
                  {creating ? 'Criando…' : 'Criar sala'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  )
}
