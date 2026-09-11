// src/components/DiceResult.jsx
// Apresentação da última rolagem do dado (somente UI; sem regras de jogo).

const PIP_MAP = {
  1: ['c'],
  2: ['tl', 'br'],
  3: ['tl', 'c', 'br'],
  4: ['tl', 'tr', 'bl', 'br'],
  5: ['tl', 'tr', 'c', 'bl', 'br'],
  6: ['tl', 'ml', 'bl', 'tr', 'mr', 'br'],
}

function DieFace({ steps, rolling }) {
  const pips = rolling ? [] : (PIP_MAP[steps] || [])
  return (
    <div
      className={`diceResultDie${rolling ? ' diceResultDie--rolling' : ''}`}
      aria-hidden="true"
    >
      {pips.map((pos) => (
        <span key={pos} className={`diceResultPip diceResultPip--${pos}`} />
      ))}
    </div>
  )
}

export default function DiceResult({ lastRoll, isRolling, compact = false }) {
  const hasResult = !!(lastRoll && lastRoll.steps)

  let statusText = 'Aguardando o primeiro lançamento'
  if (isRolling) statusText = 'Rolando o dado…'
  else if (hasResult) {
    statusText = `${lastRoll.playerName} tirou ${lastRoll.steps}`
  }

  return (
    <section
      className={`diceResult${compact ? ' diceResult--compact' : ''}`}
      role="status"
      aria-live="polite"
    >
      {!compact && (
        <div className="diceResultHeader">
          <span className="diceResultLabel">Última rolagem</span>
        </div>
      )}
      <div className="diceResultContent">
        <DieFace
          steps={hasResult ? lastRoll.steps : null}
          rolling={!!isRolling}
        />
        <div className="diceResultText">
          <p className="diceResultPlayer">{statusText}</p>
          {!compact && hasResult && !isRolling && (
            <p className="diceResultHelp">Último resultado da partida</p>
          )}
          {!compact && !hasResult && !isRolling && (
            <p className="diceResultHelp">O resultado aparecerá aqui para todos</p>
          )}
        </div>
      </div>
    </section>
  )
}
