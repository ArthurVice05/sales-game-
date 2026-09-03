import React, { useState } from 'react'
import {
  DEFAULT_MAX_ROUNDS,
  MAX_ROUNDS_LIMIT,
  MIN_ROUNDS,
  normalizeMaxRounds,
} from '../game/roundConfig.js'
import {
  DEFAULT_TURN_TIME_SEC,
  TURN_TIME_PRESETS,
  normalizeTurnTime,
} from '../game/turnTimeConfig.js'
import { validateLocalPlayerNames } from '../game/localHotseat.js'

const PLAYER_COUNTS = [2, 3, 4]

export default function LocalGameSetup({ onStart, onBack }) {
  const [playerCount, setPlayerCount] = useState(2)
  const [names, setNames] = useState(['', '', '', ''])
  const [maxRounds, setMaxRounds] = useState(DEFAULT_MAX_ROUNDS)
  const [turnTimeSec, setTurnTimeSec] = useState(DEFAULT_TURN_TIME_SEC)
  const [submitted, setSubmitted] = useState(false)

  const activeNames = names.slice(0, playerCount)
  const validation = validateLocalPlayerNames(activeNames)

  function updateName(index, value) {
    setNames((current) => current.map((name, i) => (i === index ? value : name)))
  }

  function handleSubmit(event) {
    event.preventDefault()
    setSubmitted(true)
    if (!validation.ok) return
    onStart?.({
      names: validation.names,
      maxRounds: normalizeMaxRounds(maxRounds),
      turnTimeSec: normalizeTurnTime(turnTimeSec),
    })
  }

  return (
    <main className="localSetupPage">
      <form className="localSetupCard" onSubmit={handleSubmit} noValidate>
        <div className="localSetupHeader">
          <p className="localSetupEyebrow">Jogar neste dispositivo</p>
          <h1>Partida local</h1>
          <p>Cadastre os jogadores na ordem em que eles começarão a jogar.</p>
        </div>

        <fieldset className="localSetupFieldset">
          <legend>Quantidade de jogadores</legend>
          <div className="localSetupOptions">
            {PLAYER_COUNTS.map((count) => (
              <button
                key={count}
                type="button"
                className={playerCount === count ? 'is-selected' : ''}
                aria-pressed={playerCount === count}
                onClick={() => {
                  setPlayerCount(count)
                  setSubmitted(false)
                }}
              >
                {count} jogadores
              </button>
            ))}
          </div>
        </fieldset>

        <div className="localSetupNames">
          {activeNames.map((name, index) => (
            <label key={index} htmlFor={`localPlayerName-${index}`}>
              Jogador {index + 1}
              <input
                id={`localPlayerName-${index}`}
                value={name}
                onChange={(event) => updateName(index, event.target.value)}
                placeholder={`Nome do jogador ${index + 1}`}
                maxLength={30}
                autoComplete="off"
              />
            </label>
          ))}
        </div>

        <div className="localSetupConfig">
          <label htmlFor="localMaxRounds">
            Rodadas
            <select
              id="localMaxRounds"
              value={maxRounds}
              onChange={(event) => setMaxRounds(normalizeMaxRounds(event.target.value))}
            >
              {Array.from(
                { length: MAX_ROUNDS_LIMIT - MIN_ROUNDS + 1 },
                (_, index) => MIN_ROUNDS + index,
              ).map((rounds) => (
                <option key={rounds} value={rounds}>{rounds}</option>
              ))}
            </select>
          </label>

          <label htmlFor="localTurnTime">
            Tempo por jogada
            <select
              id="localTurnTime"
              value={turnTimeSec}
              onChange={(event) => setTurnTimeSec(normalizeTurnTime(event.target.value))}
            >
              {TURN_TIME_PRESETS.map((seconds) => (
                <option key={seconds} value={seconds}>{seconds}s</option>
              ))}
            </select>
          </label>
        </div>

        {submitted && !validation.ok && (
          <p className="localSetupError" role="alert">{validation.error}</p>
        )}

        <div className="localSetupActions">
          <button type="button" className="localSetupBack" onClick={() => onBack?.()}>
            Voltar
          </button>
          <button type="submit" className="localSetupStart">
            Iniciar partida
          </button>
        </div>
      </form>
    </main>
  )
}
