// src/components/FinalWinners.jsx
import React, { useMemo } from "react";
import ModalBase from "../modals/ModalBase";
import { computePatrimonio } from "../game/patrimonio.js";
import "./final-winners.css";

/**
 * Pódio final (Top 3) como **modal travada** no centro da tela.
 * - Não fecha pelo overlay/ESC (travada).
 * - Fecha apenas pelo botão "Voltar aos Lobbies".
 * - Se aberta via ModalProvider.pushModal, use `onResolve({action:'EXIT'})`.
 *   Se usada “solta”, aceita `onExit`.
 */
export default function FinalWinners({ players = [], maxRounds, endedRound, onExit, onResolve }) {
  const rankedPlayers = useMemo(() => {
    const ranked = [...players]
      .map((player) => {
        const isBankrupt = !!player?.bankrupt
        const cash = Number(player?.cash || 0)
        const bens = Number(player?.bens || 0)
        const patrimonio = computePatrimonio(player)

        return {
          ...player,
          cash,
          bens,
          patrimonio,
          isBankrupt,
        }
      })
      .sort((a, b) => {
        if (a.isBankrupt !== b.isBankrupt) {
          return a.isBankrupt ? 1 : -1
        }

        if (b.patrimonio !== a.patrimonio) {
          return b.patrimonio - a.patrimonio
        }

        if (b.cash !== a.cash) {
          return b.cash - a.cash
        }

        return String(a.name || '').localeCompare(String(b.name || ''))
      })

    console.log(
      '[BANKRUPTCY DEBUG] final ranking',
      ranked.map((p) => ({
        name: p.name,
        bankrupt: p.isBankrupt,
        cash: p.cash,
        bens: p.bens,
        patrimonio: p.patrimonio,
      }))
    )

    return ranked
  }, [players])

  const top3 = useMemo(() => {
    // layout: esquerda(2º), centro(1º), direita(3º)
    return [rankedPlayers[1], rankedPlayers[0], rankedPlayers[2]]
  }, [rankedPlayers])

  const first = top3?.[1];
  const second = top3?.[0];
  const third = top3?.[2];

  const doExit = () => {
    if (onResolve) onResolve({ action: "EXIT" });
    else onExit?.();
  };

  return (
    // onClose vazio => clicar no overlay NÃO fecha (travada)
    <ModalBase zIndex={2147483647} onClose={() => {}}>
      <div
        className="finalWinners"
        role="dialog"
        aria-modal="true"
        aria-labelledby="final-winners-title"
        aria-describedby="final-winners-description"
      >
        <h1 id="final-winners-title" className="finalWinners__title">🏁 Fim da partida</h1>
        <p id="final-winners-description" className="finalWinners__subtitle">
          {Number.isFinite(Number(maxRounds))
            ? <>Duração configurada: <b>{Number(maxRounds)}</b> rodada(s).</>
            : null}
          {Number.isFinite(Number(endedRound)) && Number(endedRound) > 0
            ? <> Encerrada na rodada <b>{Number(endedRound)}</b>.</>
            : null}
          {' '}Vence quem tiver <b>Saldo + Bens</b>. Eis o pódio:
        </p>

        <div className="finalWinners__podium">
          <MedalCard place="second" player={second} />
          <MedalCard place="first" player={first} big />
          <MedalCard place="third" player={third} />
        </div>

        <div className="finalWinners__actions">
          <button className="finalWinners__primaryAction" onClick={doExit}>
            🏠 Voltar aos Lobbies
          </button>
        </div>
      </div>
    </ModalBase>
  );
}

function MedalCard({ place, player, big }) {
  if (!player) {
    return <div className="finalWinners__medalColumn finalWinners__medalColumn--empty" aria-hidden="true" />;
  }
  const palette = {
    first: medalPaint("#d4af37", "#f5d76e"), // ouro
    second: medalPaint("#9fa4ad", "#cfd4db"), // prata
    third: medalPaint("#b87333", "#d28c45"), // bronze
  };
  const label = { first: "1º", second: "2º", third: "3º" }[place];
  const ring = palette[place].ring;
  const face = palette[place].face;

  return (
    <div className={`finalWinners__medalColumn${big ? ' finalWinners__medalColumn--first' : ''}`}>
      <div className="finalWinners__ribbon" />
      <div className="finalWinners__medal" style={ring}>
        <div className="finalWinners__medalFace" style={face}>
          <div className="finalWinners__medalNumber">{label}</div>
        </div>
      </div>

      <div className="finalWinners__playerCard">
        <div className="finalWinners__playerName">
          {player.name}
        </div>
        <div className="finalWinners__playerValues">
          Saldo: <b>$ {Number(player.cash || 0).toLocaleString()}</b>
          <br />
          Bens: <b>$ {Number(player.bens || 0).toLocaleString()}</b>
        </div>
        <div className="finalWinners__patrimony">
          Patrimônio: <b>$ {Number(player.patrimonio || 0).toLocaleString()}</b>
        </div>
      </div>
    </div>
  );
}

function medalPaint(dark, light) {
  return {
    ring: {
      background: `radial-gradient(circle at 35% 30%, ${light} 0%, ${dark} 65%, #000 120%)`,
      boxShadow: "0 12px 30px rgba(0,0,0,.35), inset 0 0 12px rgba(255,255,255,.12)",
    },
    face: {
      background: `conic-gradient(from 0deg, ${light}, ${dark}, ${light})`,
    },
  };
}
