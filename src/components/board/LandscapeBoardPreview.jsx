import React, { useState } from 'react'

import { BOARD_40_PREVIEW } from '../../data/board40Preview.js'
import BoardTile from './BoardTile.jsx'
import {
  BOARD_PREVIEW_CENTER_SOURCE,
  isBoardPreviewPresentation,
} from './previewPresentation.js'
import './landscape-board-preview.css'

export default function LandscapeBoardPreview() {
  const [selectedNumber, setSelectedNumber] = useState(1)
  const presentation = isBoardPreviewPresentation(window.location.search)
  const selectedTile = BOARD_40_PREVIEW[selectedNumber - 1]

  return (
    <main className={`sg40Preview${presentation ? ' sg40Preview--presentation' : ''}`}>
      {!presentation && (
        <header className="sg40Preview__header">
          <div>
            <p className="sg40Preview__eyebrow">Sales Game · Fase 1</p>
            <h1 className="sg40Preview__title">Prévia do tabuleiro de 40 casas</h1>
          </div>
          <div className="sg40Preview__notice" role="status">
            PRÉVIA VISUAL — SEM ALTERAÇÃO DO MOTOR
          </div>
        </header>
      )}

      <div
        className="sg40Preview__boardViewport"
        role="region"
        aria-label="Tabuleiro Sales Game de 40 casas"
        tabIndex={presentation ? undefined : 0}
      >
        <section className="sg40Preview__board" aria-label="Tabuleiro Sales Game com 40 casas">
          <img
            className="sg40Preview__boardImage"
            src={BOARD_PREVIEW_CENTER_SOURCE}
            alt="Identidade visual central do tabuleiro Sales Game"
            width="1448"
            height="1086"
            draggable="false"
          />

          <div className="sg40Preview__track" role="group" aria-label="Percurso de 40 casas">
            {BOARD_40_PREVIEW.map((tile) => (
              <BoardTile
                key={tile.number}
                tile={tile}
                selected={tile.number === selectedNumber}
                onSelect={(nextTile) => setSelectedNumber(nextTile.number)}
                presentation={presentation}
              />
            ))}
          </div>
        </section>
      </div>

      {!presentation && (
        <section className="sg40Preview__details" aria-live="polite">
          <div>
            <span className="sg40Preview__detailsKicker">Casa selecionada</span>
            <strong className="sg40Preview__detailsTitle">
              {String(selectedTile.number).padStart(2, '0')} · {selectedTile.label}
            </strong>
          </div>
          <dl className="sg40Preview__detailsGrid">
            <div>
              <dt>Tipo canônico</dt>
              <dd>{selectedTile.type}</dd>
            </div>
            <div>
              <dt>Coordenada</dt>
              <dd>Linha {selectedTile.row}, coluna {selectedTile.column}</dd>
            </div>
            <div>
              <dt>Estado</dt>
              <dd>Seleção local, sem ação do jogo</dd>
            </div>
          </dl>
        </section>
      )}
    </main>
  )
}
