// Development-only fixture, never imported by the app or production build.
import React, { StrictMode, useState } from 'react'
import { createRoot } from 'react-dom/client'
import '../../../styles.css'
import FinalWinners from '../../FinalWinners.jsx'

const cases = {
  reference: [{ id: 'jp', name: 'JP', cash: 26570, bens: 15000 }, { id: 'arthur', name: 'Arthur', cash: 20040, bens: 4000 }, { id: 'bia', name: 'Bia', cash: 7000, bens: 5000 }],
  ties: [{ id: 'a', name: 'Ana', cash: 200, bens: 0 }, { id: 'b', name: 'Beto', cash: 100, bens: 100 }],
  signed: [{ id: 'a', name: 'Positivo', cash: 200, bens: 0 }, { id: 'b', name: 'Zero', cash: 0, bens: 0 }, { id: 'c', name: 'Negativo', cash: -100, bens: 0 }],
  zero: [{ id: 'a', name: 'Zero A', cash: 0, bens: 0 }, { id: 'b', name: 'Zero B', cash: 0, bens: 0 }],
  invalid: [{ id: 'a', name: 'Inválido', cash: Infinity, bens: 0 }],
  long: [{ id: 'a', name: 'Nome bastante longo para conferir quebra de linha sem omissões', cash: 10, bens: 5 }, { id: 'b', name: 'Outro nome extenso de jogador', cash: -50, bens: 0 }, { id: 'c', name: 'Falido', bankrupt: true, cash: 99999, bens: 10000 }, { id: 'd', name: 'Quarto jogador também identificado', bankrupt: true, cash: 100, bens: 0 }],
}

function Fixture() {
  const [players, setPlayers] = useState(cases.reference)
  const [open, setOpen] = useState(false)
  const [contract, setContract] = useState('resolve')
  const [exit, setExit] = useState('nenhuma')
  const [version, setVersion] = useState(0)
  window.fwrFixture = {
    open(name = 'reference', count = 3, via = 'resolve') {
      setPlayers(cases[name].slice(0, count)); setContract(via); setExit('nenhuma'); setVersion(v => v + 1); setOpen(true)
    },
    equivalent() { setPlayers(current => current.map(player => ({ ...player }))) },
    change() { setPlayers(current => current.map((player, i) => ({ ...player, cash: i === 0 ? 12345 : player.cash }))) },
    close() { setOpen(false) },
  }
  const resolve = value => { setExit(JSON.stringify(value)); setOpen(false) }
  return <main style={{ padding: 24 }}>
    <h1>Fixture isolada · componente real em StrictMode</h1>
    <p>Este fundo não representa o tabuleiro. A conclusão real é verificada separadamente.</p>
    <button onClick={() => window.fwrFixture.open()}>Abrir placar</button>
    <output id="fixture-exit">{exit}</output>
    {open && <FinalWinners key={version} players={players} maxRounds={10} endedRound={10} exitLabel="Sair do teste"
      onResolve={contract === 'resolve' ? resolve : undefined} onExit={() => resolve('onExit')} />}
  </main>
}

createRoot(document.getElementById('root')).render(<StrictMode><Fixture /></StrictMode>)
