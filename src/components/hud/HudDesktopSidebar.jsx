import React, { useMemo, useState } from 'react'
import { rankPlayersByPatrimonio } from '../../game/patrimonio.js'
import { isBotPlayer } from '../../game/bots/botTypes.js'
import DiceResult from '../DiceResult.jsx'
import HudMetricCard from './HudMetricCard.jsx'
import {
  formatGameMoney,
  formatHudCash,
  gaugeRatio,
  HUD_TABS,
  buildHudGauges,
  rosterPlayerStatus,
  hudTabDomId,
  hudPanelDomId,
  deriveMonthlyResult,
  monthlyResultTone,
} from './hudPresentation.js'
import './desktop-hud.css'

function HudGauge({ label, detail, value, used, total, hasRatio }) {
  const ratio = hasRatio ? gaugeRatio(used, total) : 0
  const deg = Math.round(ratio * 360)
  return (
    <div className={`hudGauge${hasRatio ? '' : ' hudGauge--count'}`}>
      <div
        className={`hudGaugeRing${hasRatio ? '' : ' hudGaugeRing--empty'}`}
        style={hasRatio
          ? { background: `conic-gradient(var(--hud-purple) ${deg}deg, rgba(255,255,255,.08) 0deg)` }
          : undefined}
        aria-hidden="true"
      >
        <span className="hudGaugeHole" />
      </div>
      <div className="hudGaugeMeta">
        <span className="hudGaugeLabel">{label}</span>
        <span className="hudGaugeValue">{value}</span>
        {detail ? <span className="hudGaugeDetail">{detail}</span> : null}
      </div>
    </div>
  )
}

function StatRow({ label, value }) {
  return (
    <div className="hudStatRow">
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  )
}

function chipClass(tone) {
  if (tone === 'danger') return 'hudChip hudChip--danger'
  if (tone === 'warn') return 'hudChip hudChip--warn'
  if (tone === 'active') return 'hudChip hudChip--active'
  return 'hudChip'
}

export default function HudDesktopSidebar({
  totals = {},
  players = [],
  lastRoll,
  isRolling = false,
  hostId,
  turnPlayerId,
  turnAbsenceStatus = null,
  meId,
  idPrefix = 'hud',
  variant = 'sidebar',
  cash,
}) {
  const [activeHudTab, setActiveHudTab] = useState('empresa')
  const ranked = useMemo(
    () => rankPlayersByPatrimonio(Array.isArray(players) ? players : []),
    [players],
  )
  const gauges = buildHudGauges(totals)
  const monthly = deriveMonthlyResult(totals.faturamento, totals.manutencao)
  const resultTone = monthlyResultTone(monthly)

  const onTabKeyDown = (event) => {
    const idx = HUD_TABS.indexOf(activeHudTab)
    if (idx < 0) return
    if (event.key === 'ArrowRight' || event.key === 'ArrowDown') {
      event.preventDefault()
      setActiveHudTab(HUD_TABS[(idx + 1) % HUD_TABS.length])
    } else if (event.key === 'ArrowLeft' || event.key === 'ArrowUp') {
      event.preventDefault()
      setActiveHudTab(HUD_TABS[(idx - 1 + HUD_TABS.length) % HUD_TABS.length])
    }
  }

  return (
    <div className={`hudDesktop hudDesktop--${variant}`}>
      {variant === 'sheet' && (
        <div className="hudFinanceStrip">
          <HudMetricCard label="Caixa" value={formatHudCash(cash)} icon="💵" />
          <HudMetricCard
            label="Faturamento"
            value={formatGameMoney(totals.faturamento)}
            tone="positive"
            icon="📈"
          />
          <HudMetricCard
            label="Despesas"
            value={formatGameMoney(totals.manutencao)}
            tone="negative"
            icon="📉"
          />
          <HudMetricCard
            label="Resultado"
            value={formatGameMoney(monthly)}
            tone={resultTone}
            icon="📊"
          />
        </div>
      )}

      <div
        className="hudDesktopTabs"
        role="tablist"
        aria-label="Painel da partida"
        onKeyDown={onTabKeyDown}
      >
        {HUD_TABS.map((tab) => {
          const selected = activeHudTab === tab
          const label = tab.charAt(0).toUpperCase() + tab.slice(1)
          return (
            <button
              key={tab}
              type="button"
              role="tab"
              id={hudTabDomId(idPrefix, tab)}
              aria-selected={selected}
              aria-controls={hudPanelDomId(idPrefix, tab)}
              tabIndex={selected ? 0 : -1}
              className={`hudDesktopTab${selected ? ' is-active' : ''}`}
              onClick={() => setActiveHudTab(tab)}
            >
              {label}
            </button>
          )
        })}
      </div>

      {activeHudTab === 'empresa' && (
        <div
          className="hudDesktopPanel"
          role="tabpanel"
          id={hudPanelDomId(idPrefix, 'empresa')}
          aria-labelledby={hudTabDomId(idPrefix, 'empresa')}
        >
          <section className="hudCard">
            <h3 className="hudCardTitle">Última ação</h3>
            <DiceResult lastRoll={lastRoll} isRolling={isRolling} />
          </section>

          <section className="hudCard">
            <h3 className="hudCardTitle">Capacidade &amp; Clientes</h3>
            <div className="hudGaugeRow">
              {gauges.map((gauge) => (
                <HudGauge key={gauge.key} {...gauge} />
              ))}
            </div>
          </section>

          <section className="hudCard">
            <h3 className="hudCardTitle">Jogadores</h3>
            <ul className="hudRoster">
              {(players || []).map((player, index) => {
                const isHost = hostId != null && String(player?.id) === String(hostId)
                const isMe = meId != null && String(player?.id) === String(meId)
                const isBot = isBotPlayer(player)
                const status = rosterPlayerStatus(player, { turnPlayerId, turnAbsenceStatus })
                return (
                  <li className="hudRosterRow" key={player?.id || `${player?.name}-${index}`}>
                    <span
                      className="hudRosterDot"
                      style={{ background: player?.color || '#6d5dfc' }}
                      aria-hidden="true"
                    />
                    <div className="hudRosterMeta">
                      <div className="hudRosterName">
                        {player?.name || `Jogador ${index + 1}`}
                        {isMe ? ' (você)' : ''}
                      </div>
                      <div className="hudRosterFlags">
                        {isHost && <span className="hudChip hudChip--gold">Host</span>}
                        {isBot && <span className="hudChip">Máquina</span>}
                        <span className={chipClass(status.tone)}>{status.label}</span>
                      </div>
                    </div>
                  </li>
                )
              })}
            </ul>
            <button
              type="button"
              className="hudRankingLink"
              onClick={() => setActiveHudTab('ranking')}
            >
              Ver ranking completo
            </button>
          </section>
        </div>
      )}

      {activeHudTab === 'comercial' && (
        <div
          className="hudDesktopPanel"
          role="tabpanel"
          id={hudPanelDomId(idPrefix, 'comercial')}
          aria-labelledby={hudTabDomId(idPrefix, 'comercial')}
        >
          <section className="hudCard">
            <h3 className="hudCardTitle">Estrutura comercial</h3>
            <StatRow label="Vendedor Comum" value={totals.vendedoresComuns ?? 0} />
            <StatRow label="Canal representantes" value={totals.fieldSales ?? 0} />
            <StatRow label="Inside Sales" value={totals.insideSales ?? 0} />
            <StatRow label="Gestores Comerciais" value={totals.gestores ?? totals.gestoresComerciais ?? 0} />
            <StatRow label="Clientes" value={totals.clientes ?? 0} />
            <StatRow label="Capacidade" value={totals.possibAt ?? 0} />
            <StatRow label="Em Atendimento" value={totals.clientsAt ?? 0} />
          </section>
        </div>
      )}

      {activeHudTab === 'estrutura' && (
        <div
          className="hudDesktopPanel"
          role="tabpanel"
          id={hudPanelDomId(idPrefix, 'estrutura')}
          aria-labelledby={hudTabDomId(idPrefix, 'estrutura')}
        >
          <section className="hudCard">
            <h3 className="hudCardTitle">Infraestrutura</h3>
            <StatRow label="ERP" value={totals.erpSistemas ?? 'D'} />
            <StatRow label="Mix de Produtos" value={totals.mixProdutos ?? 'D'} />
          </section>
          <section className="hudCard">
            <h3 className="hudCardTitle">Certificações</h3>
            <StatRow label="Azul" value={totals.az ?? 0} />
            <StatRow label="Amarelo" value={totals.am ?? 0} />
            <StatRow label="Roxo" value={totals.rox ?? 0} />
          </section>
        </div>
      )}

      {activeHudTab === 'ranking' && (
        <div
          className="hudDesktopPanel"
          role="tabpanel"
          id={hudPanelDomId(idPrefix, 'ranking')}
          aria-labelledby={hudTabDomId(idPrefix, 'ranking')}
        >
          <section className="hudCard">
            <h3 className="hudCardTitle">Ranking</h3>
            <p className="hudCardHint">1º ao 4º por patrimônio (Caixa + Bens).</p>
            <ol className="hudRanking">
              {ranked.map((player, index) => (
                <li className="hudRankingRow" key={player.id || `${player.name}-${index}`}>
                  <span className="hudRankingPlace">{index + 1}º</span>
                  <div className="hudRankingMeta">
                    <strong>
                      {player.name}
                      {player.isBankrupt ? ' (falido)' : ''}
                    </strong>
                    <span>
                      Caixa {formatGameMoney(player.cash)} · Bens {formatGameMoney(player.bens)}
                    </span>
                  </div>
                  <strong className="hudRankingPat">{formatGameMoney(player.patrimonio)}</strong>
                </li>
              ))}
            </ol>
          </section>
        </div>
      )}
    </div>
  )
}
