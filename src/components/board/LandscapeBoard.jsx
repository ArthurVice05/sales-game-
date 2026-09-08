import React, { useEffect, useMemo, useRef, useState } from 'react'

import { getOrCreateTabPlayerId } from '../../auth.js'
import { spectatorCountLabel } from '../../game/spectatorPresence.js'
import {
  BOARD_40_CONFIG,
  getDeterministicTokenSlots,
} from '../../data/board40Preview.js'
import { BOARD_PREVIEW_CENTER_SOURCE } from './previewPresentation.js'
import BoardTile from './BoardTile.jsx'
import {
  BOARD_VISUAL_LAYOUTS,
  getBoardVisualCoordinate,
} from './boardVisualCoordinates.js'
import {
  TOKEN_HOP_MAX_STEPS,
  TOKEN_HOP_STEP_MS,
  normalizeBoardPos,
  planTokenHop,
} from './tokenHop.js'
import { playTokenHopSound, unlockTokenHopAudio } from '../../utils/tokenHopSound.js'
import { getTileHint } from '../../modals/tileContext.js'
import './landscape-board-preview.css'
import './landscape-board.css'

const TRACK_LEN = BOARD_40_CONFIG.length
/** Duração de cada pulo (casa → casa). Deve bater com o CSS `sgTokenHop`. */
const TOKEN_STEP_MS = TOKEN_HOP_STEP_MS
const TOKEN_CELL_OFFSETS = Object.freeze([
  Object.freeze({ x: -0.22, y: -0.22 }),
  Object.freeze({ x: 0.22, y: -0.22 }),
  Object.freeze({ x: -0.22, y: 0.22 }),
  Object.freeze({ x: 0.22, y: 0.22 }),
])


/** Olho pequeno, decorativo: o número ao lado é quem informa. */
function IconEyeSmall () {
  return (
    <svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor"
         strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M1 12s4-7 11-7 11 7 11 7-4 7-11 7-11-7-11-7z" />
      <circle cx="12" cy="12" r="3" />
    </svg>
  )
}

const getTokenVisualPosition = (index, layout, slot) => {
  const { columns, rows } = BOARD_VISUAL_LAYOUTS[layout]
  const safeIndex = normalizeBoardPos(index, TRACK_LEN)
  const { row, column } = getBoardVisualCoordinate(safeIndex, layout)
  const offset = TOKEN_CELL_OFFSETS[slot % TOKEN_CELL_OFFSETS.length]
  return {
    x: `${((column - 0.5 + offset.x) / columns) * 100}%`,
    y: `${((row - 0.5 + offset.y) / rows) * 100}%`,
  }
}

const normalizePosition = (value) => {
  const number = Number(value)
  if (!Number.isFinite(number)) return 0
  return ((Math.trunc(number) % TRACK_LEN) + TRACK_LEN) % TRACK_LEN
}

export default function LandscapeBoard({
  players = [],
  turnIdx = 0,
  matchId,
  me,
  onMeHud,
  spectatorCount = 0,
}) {
  const [selectedIndex, setSelectedIndex] = useState(null)
  const [hoveredIndex, setHoveredIndex] = useState(null)
  const [visualPositions, setVisualPositions] = useState({})
  /** Contador por jogador: remonta a face e reinicia o pulo a cada casa. */
  const [hopNonceById, setHopNonceById] = useState({})
  const [hoppingIds, setHoppingIds] = useState(() => new Set())
  const visualRef = useRef({})
  const timersRef = useRef({})
  const targetsRef = useRef({})
  const hopClearTimersRef = useRef({})
  const playersRef = useRef(players)
  playersRef.current = players

  const markHopping = (id) => {
    playTokenHopSound()
    setHoppingIds((previous) => {
      if (previous.has(id)) return previous
      const next = new Set(previous)
      next.add(id)
      return next
    })
    setHopNonceById((previous) => ({
      ...previous,
      [id]: (previous[id] || 0) + 1,
    }))
    clearTimeout(hopClearTimersRef.current[id])
    hopClearTimersRef.current[id] = setTimeout(() => {
      setHoppingIds((previous) => {
        if (!previous.has(id)) return previous
        const next = new Set(previous)
        next.delete(id)
        return next
      })
      delete hopClearTimersRef.current[id]
    }, TOKEN_STEP_MS + 40)
  }

  // Mobile/desktop: AudioContext só roda após gesto — desbloqueia no 1º toque/clique.
  useEffect(() => {
    if (typeof window === 'undefined') return undefined
    const unlock = () => {
      unlockTokenHopAudio().catch(() => {})
    }
    window.addEventListener('pointerdown', unlock, { once: true, passive: true })
    window.addEventListener('keydown', unlock, { once: true })
    return () => {
      window.removeEventListener('pointerdown', unlock)
      window.removeEventListener('keydown', unlock)
    }
  }, [])

  const snapTokenTo = (id, target) => {
    clearTimeout(timersRef.current[id])
    delete timersRef.current[id]
    clearTimeout(hopClearTimersRef.current[id])
    delete hopClearTimersRef.current[id]
    visualRef.current[id] = target
    targetsRef.current[id] = target
    setHoppingIds((previous) => {
      if (!previous.has(id)) return previous
      const next = new Set(previous)
      next.delete(id)
      return next
    })
    setVisualPositions((previous) => (
      previous[id] === target ? previous : { ...previous, [id]: target }
    ))
  }

  const positionsSignature = useMemo(() => players
    .map((player) => `${player?.id}:${normalizePosition(player?.pos)}`)
    .join('|'), [players])

  useEffect(() => {
    const myId = me?.id || getOrCreateTabPlayerId()
    const mine = players.find((player) => String(player?.id) === String(myId))
    if (!mine) return
    onMeHud?.({
      id: mine.id,
      name: mine.name || 'Jogador',
      color: mine.color || '#6c5ce7',
      cash: Number(mine.cash || 0),
      possibAt: 0,
      clientsAt: Number(mine.clients || 0),
      matchId: matchId || 'local',
    })
  }, [matchId, me?.id, onMeHud, players])

  useEffect(() => {
    const list = Array.isArray(playersRef.current) ? playersRef.current : []
    const aliveIds = new Set(list.map((player) => String(player?.id)))
    const reducedMotion = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches === true

    for (const id of Object.keys(visualRef.current)) {
      if (aliveIds.has(id)) continue
      clearTimeout(timersRef.current[id])
      clearTimeout(hopClearTimersRef.current[id])
      delete timersRef.current[id]
      delete hopClearTimersRef.current[id]
      delete targetsRef.current[id]
      delete visualRef.current[id]
    }

    for (const player of list) {
      if (player?.id == null) continue
      const id = String(player.id)
      const target = normalizePosition(player.pos)
      const current = visualRef.current[id]

      if (current === undefined || current === target) {
        visualRef.current[id] = target
        targetsRef.current[id] = target
        setVisualPositions((previous) => (
          previous[id] === target ? previous : { ...previous, [id]: target }
        ))
        continue
      }
      if (timersRef.current[id] && targetsRef.current[id] === target) continue

      const plan = planTokenHop(current, target, TRACK_LEN, TOKEN_HOP_MAX_STEPS)
      if (reducedMotion || plan.mode === 'snap') {
        snapTokenTo(id, target)
        continue
      }

      clearTimeout(timersRef.current[id])
      delete timersRef.current[id]
      targetsRef.current[id] = target

      // path.length === steps do dado (1–6); hard-cap de segurança
      const path = plan.path.slice(0, TOKEN_HOP_MAX_STEPS)
      let step = 0
      const tick = () => {
        // Alvo mudou no meio do pulo (rede): abandona este path.
        if (targetsRef.current[id] !== target) return
        const nextPosition = path[step]
        step += 1
        visualRef.current[id] = nextPosition
        markHopping(id)
        setVisualPositions((previous) => ({ ...previous, [id]: nextPosition }))
        if (step < path.length) timersRef.current[id] = setTimeout(tick, TOKEN_STEP_MS)
        else delete timersRef.current[id]
      }
      // Primeiro pulo imediato; os seguintes no ritmo TOKEN_STEP_MS
      tick()
    }
  }, [positionsSignature])

  useEffect(() => () => {
    Object.values(timersRef.current).forEach(clearTimeout)
    Object.values(hopClearTimersRef.current).forEach(clearTimeout)
    timersRef.current = {}
    hopClearTimersRef.current = {}
  }, [])

  const renderedPlayers = useMemo(() => players.map((player) => ({
    player,
    position: normalizeBoardPos(
      visualPositions[String(player?.id)] ?? player?.pos,
      TRACK_LEN,
    ),
  })), [players, visualPositions])

  const slotById = useMemo(
    () => getDeterministicTokenSlots(renderedPlayers),
    [renderedPlayers],
  )

  const activePlayerId = players[turnIdx]?.id
  const hintIndex = selectedIndex ?? hoveredIndex
  const hintTile = Number.isInteger(hintIndex) ? BOARD_40_CONFIG[hintIndex] : null
  const hintText = hintTile
    ? getTileHint(hintTile.eventKind || hintTile.type)
    : ''

  return (
    <section
      className="board sg40GameBoard"
      aria-label="Tabuleiro Sales Game com 40 casas"
      onClick={(event) => {
        if (!event.target.closest('.sg40Preview__tile')) setSelectedIndex(null)
      }}
    >
      {/* Filhos absolutos não dão tamanho; este sizer define a proporção. */}
      <span className="sg40GameBoard__sizer" aria-hidden="true" />
      <img
        className="sg40Preview__boardImage"
        src={BOARD_PREVIEW_CENTER_SOURCE}
        alt="Sales GAME"
        draggable="false"
      />

      {spectatorCount > 0 && (
        <div
          className="sg40GameBoard__spectators"
          role="status"
          aria-label={spectatorCountLabel(spectatorCount)}
          title={spectatorCountLabel(spectatorCount)}
        >
          <IconEyeSmall />
          <span className="sg40GameBoard__spectatorsCount" aria-hidden="true">{spectatorCount}</span>
        </div>
      )}

      <div className="sg40Preview__track" role="group" aria-label="Percurso de 40 casas">
        {BOARD_40_CONFIG.map((tile) => (
          <BoardTile
            key={tile.index}
            tile={tile}
            selected={selectedIndex === tile.index}
            onSelect={(selectedTile) => setSelectedIndex((current) => (
              current === selectedTile.index ? null : selectedTile.index
            ))}
            onHighlight={(highlighted) => setHoveredIndex(highlighted?.index ?? null)}
            game
          />
        ))}
      </div>

      <div className="sg40GameBoard__tokens" aria-live="off">
        {renderedPlayers.map(({ player, position }) => {
          const tile = BOARD_40_CONFIG[position]
          const slot = slotById.get(String(player?.id)) || 0
          const landscapePosition = getTokenVisualPosition(position, 'landscape-13x9', slot)
          const portraitPosition = getTokenVisualPosition(position, 'portrait-8x14', slot)
          const active = String(player?.id) === String(activePlayerId)
          const initial = String(player?.name || '').trim().charAt(0).toUpperCase() || '?'
          const hopping = hoppingIds.has(String(player.id))
          const hopNonce = hopNonceById[String(player.id)] || 0
          return (
            <div
              key={player.id}
              className={[
                'token',
                'sg40GameBoard__token',
                active ? 'token--active' : '',
                hopping ? 'sg40GameBoard__token--hopping' : '',
              ].filter(Boolean).join(' ')}
              style={{
                '--token-landscape-x': landscapePosition.x,
                '--token-landscape-y': landscapePosition.y,
                '--token-portrait-x': portraitPosition.x,
                '--token-portrait-y': portraitPosition.y,
                '--token-color': player.color || '#6c5ce7',
                '--token-hop-ms': `${TOKEN_STEP_MS}ms`,
                zIndex: hopping ? 8 : (active ? 5 : 4),
              }}
              data-player-position={position}
              title={`${player.name || 'Jogador'} • Casa ${tile.number}`}
              aria-label={`${player.name || 'Jogador'} está na casa ${tile.number}`}
            >
              <span key={hopNonce} className="sg40GameBoard__tokenFace" aria-hidden="true">
                <span className="tokenInitial">{initial}</span>
              </span>
            </div>
          )
        })}
      </div>

      <p className="sg40GameBoard__hint" role="status" aria-live="polite">
        {hintTile ? (
          <>
            <span className="sg40GameBoard__hintKicker">
              {`Casa ${String(hintTile.number).padStart(2, '0')} · ${hintTile.label}`}
            </span>
            <span className="sg40GameBoard__hintText">{hintText}</span>
          </>
        ) : (
          <span className="sg40GameBoard__hintText">
            Toque numa casa para ver o que ela faz.
          </span>
        )}
      </p>
    </section>
  )
}
