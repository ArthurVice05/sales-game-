import React from 'react'

import { getBoardVisualCoordinate } from './boardVisualCoordinates.js'

export default function BoardTile({
  tile,
  selected = false,
  onSelect,
  presentation = false,
  game = false,
}) {
  const numberLabel = String(tile.number).padStart(2, '0')
  const desktopCoordinate = getBoardVisualCoordinate(tile.index, 'landscape-13x9')
  const mobileCoordinate = getBoardVisualCoordinate(tile.index, 'portrait-8x14')

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
      <span className="sg40Preview__tileLabel" aria-hidden="true">
        {tile.labelLines.map((line) => (
          <span key={line} className="sg40Preview__tileLabelLine">{line}</span>
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
    'aria-label': `Casa ${numberLabel}, ${tile.label}`,
    title: `Casa ${numberLabel} — ${tile.label}`,
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
    >
      {content}
    </button>
  )
}
