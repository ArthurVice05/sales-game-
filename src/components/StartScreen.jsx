import React, { useState, useRef, useEffect } from 'react'
import {
  setTabPlayerName,      // grava o nome nesta ABA
} from '../auth'
import TutorialModal from './TutorialModal.jsx'
import './start-screen.css'

import bgImg from '/images/start/salesgame-background.jpg'
import logoGame from '/SalesGame_Logo-removebg-preview.png'

export default function StartScreen({ onEnter, onLocal, onlineDisabledReason = '', currentName = '' }) {
  // ✅ OBJ 2: não auto-preenche via sessionStorage; currentName só reflete o nome
  // já confirmado nesta sessão (ex.: ao voltar da lista de salas).
  const [name, setName] = useState(() => String(currentName || '').trim())
  // Tour também pode abrir na abertura; no tabuleiro segue 1× por partida
  const [tutorialOpen, setTutorialOpen] = useState(true)
  const inputRef = useRef(null)

  // Desktop: foca o nome. Mobile/touch: NÃO autofocar — Safari dá zoom em inputs.
  useEffect(() => {
    if (typeof window === 'undefined') return
    const coarse = window.matchMedia('(pointer: coarse)').matches
    const narrow = window.matchMedia('(max-width: 960px)').matches
    if (coarse || narrow) return
    inputRef.current?.focus()
  }, [])

  function handleEnter() {
    const cleaned = (name || '').trim()
    // Sem client Supabase o fluxo online quebraria no LobbyList (supabase.from
    // em null). O jogo local não depende de rede e segue liberado.
    if (!cleaned || onlineDisabledReason) return
    setTabPlayerName(cleaned)  // <- salva o nome desta ABA (sessionStorage)
    onEnter?.(cleaned)         // callback para navegação (ex.: ir para lista de salas)
  }

  function onKey(e) {
    if (e.key === 'Enter') handleEnter()
  }

  const canEnter = (name || '').trim().length > 0 && !onlineDisabledReason

  return (
    <div className="start">
      <img className="startBg" src={bgImg} alt="" />
      <div className="startShade" aria-hidden="true" />

      <div className="startMain">
        <div className="startStack">
          <div className="startHeader">
            <img className="startLogo" src={logoGame} alt="Sales GAME" />
          </div>

          <div className="startCenter">
            <div className="startCard">
              <p className="startHint">
                Jogue online com outras pessoas ou compartilhe este dispositivo em uma partida local.
              </p>

              <div className="startSummary">
                <p><strong>Duração:</strong> escolhida pelo host entre 1 e 5 rodadas (padrão: 5). A partida termina após esse número.</p>
                <p><strong>Objetivo:</strong> administrar a empresa e tomar decisões comerciais</p>
                <p><strong>Vitória:</strong> vence quem terminar com o maior patrimônio</p>
                <p className="startSummaryNote">
                  Patrimônio = Caixa + Bens. Em empate, maior caixa desempata.
                </p>
              </div>

              <label className="startLabel" htmlFor="playerName">Seu nome para jogar online</label>
              <input
                id="playerName"
                ref={inputRef}
                className="startInput"
                placeholder="Digite seu nome"
                value={name}
                onChange={e => setName(e.target.value)}
                onKeyDown={onKey}
                maxLength={30}
              />
              <button className="startBtn" onClick={handleEnter} disabled={!canEnter} aria-disabled={!canEnter}>
                Jogar online
              </button>
              {onlineDisabledReason && (
                <p className="startOnlineDisabled" role="status">{onlineDisabledReason}</p>
              )}
              <div className="startModeDivider" aria-hidden="true"><span>ou</span></div>
              <button type="button" className="startBtn startBtn--local" onClick={() => onLocal?.()}>
                Jogar neste dispositivo
              </button>
              <button
                type="button"
                className="startBtnSecondary"
                onClick={() => setTutorialOpen(true)}
              >
                Como jogar
              </button>
            </div>
          </div>
        </div>
      </div>

      <TutorialModal
        open={tutorialOpen}
        onClose={() => setTutorialOpen(false)}
        markSessionOnClose={false}
      />
    </div>
  )
}
