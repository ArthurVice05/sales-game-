import React, { useEffect, useMemo, useRef, useState } from 'react'

import { getOrCreateTabPlayerId } from '../../auth.js'
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
import './landscape-board-preview.css'
import './landscape-board.css'

const TRACK_LEN = BOARD_40_CONFIG.length
const TOKEN_STEP_MS = 150
const MAX_ANIMATED_STEPS = 6
const TOKEN_CELL_OFFSETS = Object.freeze([
  Object.freeze({ x: -0.16, y: -0.16 }),
  Object.freeze({ x: 0.16, y: -0.16 }),
  Object.freeze({ x: -0.16, y: 0.16 }),
  Object.freeze({ x: 0.16, y: 0.16 }),
])

const getTokenVisualPosition = (index, layout, slot) => {
  const { columns, rows } = BOARD_VISUAL_LAYOUTS[layout]
  const { row, column } = getBoardVisualCoordinate(index, layout)
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

const forwardDistance = (from, to) => (
  (normalizePosition(to) - normalizePosition(from) + TRACK_LEN) % TRACK_LEN
)

const buildForwardPath = (from, to) => {
  const path = []
  const target = normalizePosition(to)
  let cursor = normalizePosition(from)
  for (let guard = 0; guard < TRACK_LEN && cursor !== target; guard += 1) {
    cursor = (cursor + 1) % TRACK_LEN
    path.push(cursor)
  }
  return path
}

export default function LandscapeBoard({
  players = [],
  turnIdx = 0,
  matchId,
  me,
  onMeHud,
}) {
  const [selectedIndex, setSelectedIndex] = useState(null)
  const [visualPositions, setVisualPositions] = useState({})
  const visualRef = useRef({})
  const timersRef = useRef({})
  const targetsRef = useRef({})
  const playersRef = useRef(players)
  playersRef.current = players

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
      delete timersRef.current[id]
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

      clearTimeout(timersRef.current[id])
      delete timersRef.current[id]
      targetsRef.current[id] = target

      const distance = forwardDistance(current, target)
      if (reducedMotion || distance === 0 || distance > MAX_ANIMATED_STEPS) {
        visualRef.current[id] = target
        setVisualPositions((previous) => ({ ...previous, [id]: target }))
        continue
      }

      const path = buildForwardPath(current, target)
      let step = 0
      const tick = () => {
        const nextPosition = path[step]
        step += 1
        visualRef.current[id] = nextPosition
        setVisualPositions((previous) => ({ ...previous, [id]: nextPosition }))
        if (step < path.length) timersRef.current[id] = setTimeout(tick, TOKEN_STEP_MS)
        else delete timersRef.current[id]
      }
      timersRef.current[id] = setTimeout(tick, TOKEN_STEP_MS)
    }
  }, [positionsSignature])

  useEffect(() => () => {
    Object.values(timersRef.current).forEach(clearTimeout)
    timersRef.current = {}
  }, [])

  const renderedPlayers = useMemo(() => players.map((player) => ({
    player,
    position: visualPositions[String(player?.id)] ?? normalizePosition(player?.pos),
  })), [players, visualPositions])

  const slotById = useMemo(
    () => getDeterministicTokenSlots(renderedPlayers),
    [renderedPlayers],
  )

  const activePlayerId = players[turnIdx]?.id

  return (
    <section
      className="board sg40GameBoard"
      aria-label="Tabuleiro Sales Game com 40 casas"
    >
      <img
        className="sg40Preview__boardImage"
        src={BOARD_PREVIEW_CENTER_SOURCE}
        alt="Identidade visual central do tabuleiro Sales Game"
        width="1448"
        height="1086"
        draggable="false"
      />

      <div className="sg40Preview__track" role="group" aria-label="Percurso de 40 casas">
        {BOARD_40_CONFIG.map((tile) => (
          <BoardTile
            key={tile.index}
            tile={tile}
            selected={selectedIndex === tile.index}
            onSelect={(selectedTile) => setSelectedIndex(selectedTile.index)}
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
          return (
            <div
              key={player.id}
              className={`token sg40GameBoard__token${active ? ' token--active' : ''}`}
              style={{
                '--token-landscape-x': landscapePosition.x,
                '--token-landscape-y': landscapePosition.y,
                '--token-portrait-x': portraitPosition.x,
                '--token-portrait-y': portraitPosition.y,
                '--token-color': player.color || '#6c5ce7',
                zIndex: active ? 5 : 4,
              }}
              data-player-position={position}
              title={`${player.name || 'Jogador'} • Casa ${tile.number}`}
              aria-label={`${player.name || 'Jogador'} está na casa ${tile.number}`}
            >
              <span className="tokenInitial">{initial}</span>
            </div>
          )
        })}
      </div>

      <p className="sg40GameBoard__selection" aria-live="polite">
        {selectedIndex === null
          ? ''
          : `Casa ${String(BOARD_40_CONFIG[selectedIndex].number).padStart(2, '0')}: ${BOARD_40_CONFIG[selectedIndex].label}`}
      </p>
    </section>
  )
}
