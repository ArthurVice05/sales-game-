import React, { useEffect, useState } from 'react'
import {
  readGameSoundEnabled,
  setGameSoundEnabled,
  subscribeGameSound,
} from '../utils/gameSoundPreference.js'
import './game-sound-toggle.css'

/**
 * Controle local de áudio da partida (não sincroniza entre clientes).
 */
export default function GameSoundToggle({ className = '', compact = false }) {
  const [enabled, setEnabled] = useState(() => readGameSoundEnabled())

  useEffect(() => subscribeGameSound(setEnabled), [])

  const label = enabled ? 'Desativar som' : 'Ativar som'

  return (
    <button
      type="button"
      className={`gameSoundToggle ${compact ? 'gameSoundToggle--compact' : ''} ${className}`.trim()}
      aria-pressed={enabled}
      aria-label={label}
      title={label}
      onClick={() => setGameSoundEnabled(!enabled)}
    >
      <span aria-hidden="true">{enabled ? '🔊' : '🔇'}</span>
      {!compact ? <span className="gameSoundToggleLabel">{label}</span> : null}
    </button>
  )
}
