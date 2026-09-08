import React from 'react'

import { getBoardVisualCoordinate } from './boardVisualCoordinates.js'
import { getTileHint } from '../../modals/tileContext.js'

function longestWordChars(line) {
  return Math.max(1, ...String(line).split(/\s+/g).map((part) => part.length))
}

function labelFitVars(labelLines) {
  const lines = Array.isArray(labelLines) ? labelLines : []
  const longestWord = Math.max(1, ...lines.map((line) => longestWordChars(line)))
  const longestLine = Math.max(1, ...lines.map((line) => String(line).length))
  return {
    '--sg40-longest': String(longestWord),
    '--sg40-chars': String(longestLine),
  }
}

export default function BoardTile({
  tile,
  selected = false,
  onSelect,
  onHighlight,
  presentation = false,
  game = false,
}) {
  const numberLabel = String(tile.number).padStart(2, '0')
  const desktopCoordinate = getBoardVisualCoordinate(tile.index, 'landscape-13x9')
  const mobileCoordinate = getBoardVisualCoordinate(tile.index, 'portrait-8x14')
  const hint = getTileHint(tile.eventKind || tile.type)
  const hintTitle = hint
    ? `Casa ${numberLabel} — ${tile.label}. ${hint}`
    : `Casa ${numberLabel} — ${tile.label}`

  const classes = [
    'sg40Preview__tile',
    selected && !presentation ? 'sg40Preview__tile--selected' : '',
    presentation ? 'sg40Preview__tile--presentation' : '',
    game ? 'sg40Preview__tile--game' : '',
  ].filter(Boolean).join(' ')

  const content = (
    <>
      <span className="sg40Preview__tileNumber" aria-hidden="true">{numberLabel}</span>
      <span className="sg40Preview__tileIconFrame" aria-hidden="true">
        <img
          className="sg40Preview__tileIcon"
          src={tile.icon}
          alt=""
          width="96"
          height="96"
          draggable="false"
        />
      </span>
      <span className="sg40Preview__tileLabel" aria-hidden="true" style={labelFitVars(tile.labelLines)}>
        {tile.labelLines.map((line) => (
          <span key={line} className="sg40Preview__tileLabelLine">
            {line}
          </span>
        ))}
      </span>
    </>
  )

  const sharedProps = {
    className: classes,
    style: {
      '--desktop-row': desktopCoordinate.row,
      '--desktop-column': desktopCoordinate.column,
      '--mobile-row': mobileCoordinate.row,
      '--mobile-column': mobileCoordinate.column,
    },
    'data-tile-number': tile.number,
    'data-tile-type': tile.type,
    'data-index': tile.index,
    'data-row': tile.gridRow ?? tile.row,
    'data-column': tile.gridColumn ?? tile.column,
    'aria-label': hintTitle,
    title: hintTitle,
  }

  if (presentation) {
    return (
      <div {...sharedProps} role="group">
        {content}
      </div>
    )
  }

  return (
    <button
      {...sharedProps}
      type="button"
      aria-pressed={selected}
      onClick={() => onSelect?.(tile)}
      onMouseEnter={() => onHighlight?.(tile)}
      onMouseLeave={() => onHighlight?.(null)}
      onFocus={() => onHighlight?.(tile)}
      onBlur={() => onHighlight?.(null)}
    >
      {content}
    </button>
  )
}
