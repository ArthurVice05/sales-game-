// src/pages/RoomLobby.jsx
import { useEffect, useMemo, useState } from 'react'
import {
  getLobby, listLobbyPlayers, onLobbyPlayersRealtime, leaveLobby,
  setPlayerReady, startMatch
} from '../lib/lobbies'
import { getOrCreateLocalPlayerId, getOrSetPlayerName } from '../auth'

export default function RoomLobby({ lobbyId, onLeave, onStartGame }) {
  const meId = getOrCreateLocalPlayerId()
  const meName = getOrSetPlayerName('Jogador')

  const [lobby, setLobby] = useState(null)
  const [players, setPlayers] = useState([])
  const [loading, setLoading] = useState(true)
  const [starting, setStarting] = useState(false)

  async function refresh() {
    setLoading(true)
    try {
      const [L, P] = await Promise.all([
        getLobby(lobbyId),
        listLobbyPlayers(lobbyId),
      ])
      setLobby(L)
      setPlayers(P)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    refresh()
    const off = onLobbyPlayersRealtime(lobbyId, refresh)
    // Não chamar leaveLobby em beforeunload/pagehide: no Android o WebView
    // dispara pagehide ao trocar de app e expulsava o jogador da sala.
    return () => { off?.() }
  }, [lobbyId])

  const isHost = lobby?.host_id === meId
  const allReady = useMemo(() => players.length > 0 && players.every(p => p.ready), [players])
  const me = useMemo(() => players.find(p => p.player_id === meId), [players, meId])

  async function toggleReady() {
    if (!me) return
    await setPlayerReady({ lobbyId, playerId: meId, ready: !me.ready })
  }

  async function handleLeave() {
    await leaveLobby({ lobbyId, playerId: meId })
    onLeave?.()
  }

  async function handleStart() {
    if (!isHost || !allReady) return
    setStarting(true)
    try {
      // marca a sala como "started" e cria o match básico
      const match = await startMatch({ lobbyId, hostPlayerId: meId })
      // devolve a lista dos jogadores para você inicializar o tabuleiro
      onStartGame?.({ players, matchId: match?.id })
    } finally {
      setStarting(false)
    }
  }

  return (
    <div className="room screen">
      <div className="container">
        <div className="top">
          <button className="btn ghost" onClick={onLeave}>← Voltar aos lobbies</button>
          <div className="spacer" />
          <button className="btn danger" onClick={handleLeave}>Sair da sala</button>
        </div>

        <h2>SalesGame — <span className="roomName">{lobby?.name || 'Sala'}</span></h2>

        <div className="players">
          {loading && <div className="empty">Carregando…</div>}

          {!loading && players.map((p, i) => (
            <div key={p.player_id} className={`playerRow ${p.player_id===meId? 'me':''}`}>
              <div className="left">
                <div className="avatar">{i+1}</div>
                <div className="name">{p.player_name}</div>
                {p.player_id === lobby?.host_id && <span className="hostBadge">Host</span>}
              </div>

              <div className="right">
                {p.player_id === meId ? (
                  <div className="readySwitch">
                    <button
                      className={`seg ${!p.ready?'active':''}`}
                      onClick={toggleReady}
                    >Não pronto</button>
                    <button
                      className={`seg ${p.ready?'active':''}`}
                      onClick={toggleReady}
                    >⚡ Pronto!</button>
                  </div>
                ) : (
                  <div className={`pill ${p.ready ? 'ok' : 'wait'}`}>
                    {p.ready ? 'Pronto' : 'Aguardando'}
                  </div>
                )}
              </div>
            </div>
          ))}

          {!loading && players.length===0 && (
            <div className="empty">Ainda não há jogadores nesta sala.</div>
          )}
        </div>

        <div className="actions">
          {isHost ? (
            <button
              className="btn primary lg"
              disabled={!allReady || starting}
              onClick={handleStart}
              title={allReady ? 'Iniciar' : 'Todos devem marcar pronto'}
            >
              {starting ? 'Iniciando…' : 'Iniciar partida'}
            </button>
          ) : (
            <div className="hint">Aguardando o host iniciar…</div>
          )}
        </div>
      </div>

      <style>{css}</style>
    </div>
  )
}

const css = `
.screen{ min-height:100vh; background:#0f0f12; color:#e9ecf1; padding:32px 16px; }
.container{ max-width:960px; margin:0 auto; }
.top{ display:flex; align-items:center; gap:12px; margin-bottom:12px; }
.spacer{ flex:1; }
h2{ margin:8px 0 18px; font-size:28px; font-weight:800; }
.roomName{ opacity:.9 }

.btn{ padding:10px 14px; border:0; border-radius:12px; font-weight:800; cursor:pointer; background:#20222a; color:#fff; border:1px solid #2b2e38; }
.btn.ghost{ background:transparent; }
.btn.primary{ background:#4f46e5; border:none; box-shadow:0 8px 24px rgba(79,70,229,.25); }
.btn.danger{ background:#ef4444; border:none; }
.btn.lg{ padding:14px 20px; font-size:16px; }

.players{ margin-top:8px; display:flex; flex-direction:column; gap:10px; }
.playerRow{ display:flex; align-items:center; justify-content:space-between; gap:12px; padding:12px; border-radius:14px; background:rgba(255,255,255,.02); border:1px solid rgba(255,255,255,.08); }
.playerRow.me{ outline:1px dashed rgba(255,255,255,.18); }
.left{ display:flex; align-items:center; gap:10px; }
.avatar{ width:32px; height:32px; border-radius:10px; background:#11131a; display:flex; align-items:center; justify-content:center; font-weight:800; }
.name{ font-weight:800; }
.hostBadge{ margin-left:6px; font-size:12px; padding:2px 6px; border-radius:8px; background:#1f2937; opacity:.75 }

.readySwitch{ display:flex; border:1px solid rgba(255,255,255,.12); border-radius:999px; overflow:hidden; }
.readySwitch .seg{ padding:8px 12px; font-weight:800; background:transparent; color:#dbe0e6; border:0; }
.readySwitch .seg.active{ background:#10b981; color:#0b1418; }
.readySwitch .seg:first-child.active{ background:#4b5563; color:#e9ecf1; }

.pill{ padding:6px 10px; border-radius:999px; font-weight:700; font-size:12px; }
.pill.ok{ background:#10b981; color:#04110d; }
.pill.wait{ background:#f59e0b; color:#3a2302; }

.actions{ display:flex; justify-content:flex-end; margin-top:18px; }
.hint{ opacity:.75; }
.empty{ opacity:.8; text-align:center; padding:16px; border:1px dashed rgba(255,255,255,.15); border-radius:12px; margin-top:8px; }
`
