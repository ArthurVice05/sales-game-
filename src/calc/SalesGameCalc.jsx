import React, { useEffect, useMemo, useState } from 'react'
import {
  CALC_STORAGE_KEY,
  DIRECT_BUY_KINDS,
  SORTE_REVES_CARDS,
  correctCalcPosition,
  createCalcGame,
  finishCalcTurn,
  getCalcEventPreview,
  getCalcReduceOptions,
  getCalcTurnProgress,
  getCalcPlayerMetrics,
  getCalcRanking,
  parseCalcSession,
  planCalcTurn,
  previewCalcPurchase,
  recoverCalcTurn,
  resolveCalcEvent,
  serializeCalcSession,
  undoCalcTurn,
} from './calcModel.js'
import { MAX_ROUNDS_LIMIT, MIN_ROUNDS, DEFAULT_MAX_ROUNDS } from '../game/roundConfig.js'
import { MANUAL_CONSTANTS } from '../game/manualConstants.js'
import { CERT_EFFECTS } from '../game/gameRules.js'
import { clampLoanAmount, canTakeLoan } from '../game/loanCycle.js'
import { markCalcBootReady } from './calcBoot.js'
import './calc.css'

const money = (value) => new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL', maximumFractionDigits: 0 }).format(Number(value) || 0)
const KIND_LABELS = {
  CLIENTS: 'Clientes', ERP: 'ERP', INSIDE: 'Inside Sales', MANAGER: 'Gestor Comercial',
  TRAINING: 'Treinamento', FIELD: 'Canal Representantes', COMMON: 'Vendedor Comum', MIX: 'Mix de Produtos',
}

function readSavedSession() {
  if (typeof window === 'undefined') return null
  try { return parseCalcSession(window.localStorage.getItem(CALC_STORAGE_KEY)) } catch { return null }
}

function Metric({ label, value }) {
  return <div className="calcMetric"><span>{label}</span><strong>{value}</strong></div>
}

function Impact({ impact }) {
  if (!impact) return null
  const rows = [
    ['Caixa', 'cash', money],
    ['Capacidade', 'capacity', String],
    ['Faturamento', 'revenue', money],
    ['Despesas', 'expenses', money],
    ['Patrimônio', 'patrimonio', money],
  ]
  return <div className="calcImpact" aria-label="Prévia da decisão">
    <h4>Se confirmar a compra</h4>
    {rows.map(([label, key, format]) => <div className="calcImpactRow" key={key}>
      <span>{label}</span><span>{format(impact.current[key])} <b aria-label="passa para">→</b> {format(impact.after[key])}</span>
    </div>)}
  </div>
}

function Setup({ savedGame, onStart, onContinue }) {
  const [count, setCount] = useState(2)
  const [names, setNames] = useState(['', '', '', ''])
  const [rounds, setRounds] = useState(DEFAULT_MAX_ROUNDS)
  const [error, setError] = useState('')
  function swap(index, direction) {
    const next = [...names]
    ;[next[index], next[index + direction]] = [next[index + direction], next[index]]
    setNames(next)
  }
  function submit(event) {
    event.preventDefault()
    try { onStart(createCalcGame(names.slice(0, count), rounds)) } catch (issue) { setError(issue.message) }
  }
  return <div className="calcSetupWrap">
    {savedGame && <section className="calcCard calcResume">
      <div><span className="calcEyebrow">Partida salva neste dispositivo</span><h2>Continuar de onde parou</h2>
        <p>Rodada {savedGame.round} de {savedGame.maxRounds} · {savedGame.players.length} jogadores</p></div>
      <button className="calcButton" onClick={onContinue}>Continuar partida</button>
    </section>}
    <form className="calcCard calcSetup" onSubmit={submit}>
      <span className="calcEyebrow">Tabuleiro físico</span>
      <h2>Nova partida</h2>
      <p>O dado, as cartas e as peças ficam na mesa. A Calc acompanha os números e indica a próxima ação.</p>
      <label className="calcField">Quantos jogadores?
        <select value={count} onChange={(event) => setCount(Number(event.target.value))}>
          {[2, 3, 4].map((n) => <option key={n} value={n}>{n} jogadores</option>)}
        </select>
      </label>
      <div className="calcSetupPlayers"><span className="calcFieldTitle">Nomes e ordem de jogo</span>
        {names.slice(0, count).map((name, index) => <div className="calcSetupPlayer" key={index}>
          <span className="calcSeat">{index + 1}</span>
          <input aria-label={`Nome do jogador ${index + 1}`} placeholder={`Jogador ${index + 1}`} maxLength={30}
            value={name} onChange={(event) => { const next = [...names]; next[index] = event.target.value; setNames(next) }} />
          <button type="button" aria-label={`Subir jogador ${index + 1}`} disabled={index === 0} onClick={() => swap(index, -1)}>↑</button>
          <button type="button" aria-label={`Descer jogador ${index + 1}`} disabled={index === count - 1} onClick={() => swap(index, 1)}>↓</button>
        </div>)}
      </div>
      <label className="calcField">Rodadas
        <select value={rounds} onChange={(event) => setRounds(Number(event.target.value))}>
          {Array.from({ length: MAX_ROUNDS_LIMIT - MIN_ROUNDS + 1 }, (_, i) => i + MIN_ROUNDS).map((n) => <option key={n} value={n}>{n}</option>)}
        </select>
      </label>
      {error && <p className="calcError" role="alert">{error}</p>}
      <button className="calcButton" type="submit">Iniciar partida</button>
    </form>
  </div>
}

export function PurchaseChoice({ player, event, onResolve, onOpenRecovery, error, setError }) {
  const [target, setTarget] = useState('')
  const [qty, setQty] = useState(1)
  const [level, setLevel] = useState('')
  const [vendorType, setVendorType] = useState('comum')
  const [certId, setCertId] = useState('personalizado')
  const staff = { comum: player.vendedoresComuns, inside: player.insideSales, field: player.fieldSales, gestor: player.gestores }
  const validStaff = Object.entries(staff).filter(([, quantity]) => Number(quantity) > 0)
  const selectedVendorType = validStaff.some(([type]) => type === vendorType) ? vendorType : validStaff[0]?.[0] || ''
  const kind = event.kind === 'DIRECT_BUY' ? target : event.kind
  const selection = { qty: Number(qty), level, vendorType: selectedVendorType, certId, target }
  const preview = useMemo(() => {
    if (!kind) return null
    try { return previewCalcPurchase(player, kind, selection) } catch { return null }
  }, [player, kind, qty, level, selectedVendorType, certId])
  const canBuy = preview && preview.cost <= Number(player.cash)
  return <div className="calcDecision">
    {event.kind === 'DIRECT_BUY' && <label className="calcField">O que deseja adquirir?
      <select value={target} onChange={(e) => { setTarget(e.target.value); setError(''); setLevel('') }}>
        <option value="">Selecione um recurso</option>
        {DIRECT_BUY_KINDS.map((item) => <option key={item} value={item}>{KIND_LABELS[item]}</option>)}
      </select>
    </label>}
    {['CLIENTS', 'FIELD', 'INSIDE', 'COMMON', 'MANAGER'].includes(kind) && <label className="calcField">Quantidade
      <input type="number" min="1" step="1" inputMode="numeric" value={qty} onChange={(e) => setQty(e.target.value)} />
    </label>}
    {(kind === 'ERP' || kind === 'MIX') && <div className="calcLevels" role="group" aria-label="Escolha o nível">
      {['A', 'B', 'C', 'D'].map((item) => <button key={item} className={level === item ? 'isSelected' : ''} type="button"
        disabled={String(kind === 'ERP' ? player.erpLevel : player.mixProdutos || 'D').toUpperCase() === item}
        onClick={() => setLevel(item)}>Nível {item}</button>)}
    </div>}
    {kind === 'TRAINING' && <div className="calcTrainingFields">
      <label className="calcField">Para qual colaborador?
        <select value={selectedVendorType} onChange={(e) => setVendorType(e.target.value)}>
          {validStaff.map(([type]) => <option key={type} value={type}>{({ comum: 'Vendedor Comum', inside: 'Inside Sales', field: 'Canal Representantes', gestor: 'Gestor' })[type]}</option>)}
        </select>
      </label>
      <label className="calcField">Certificação
        <select value={certId} onChange={(e) => setCertId(e.target.value)}>
          {Object.entries(CERT_EFFECTS).map(([id, value]) => <option key={id} value={id}>{value.label}</option>)}
        </select>
      </label>
      <small>Investimento por treinamento: {money(MANUAL_CONSTANTS.trainingPrice)}</small>
    </div>}
    {preview && <><p className="calcPrice">Investimento imediato <strong>{money(preview.cost)}</strong></p>
      <Impact impact={preview.impact} /></>}
    {preview && !canBuy && <p className="calcError">Caixa insuficiente para esta compra.</p>}
    {preview && !canBuy && <button type="button" className="calcButton calcButtonGhost" onClick={onOpenRecovery}>Abrir recuperação financeira</button>}
    {kind === 'TRAINING' && !validStaff.length && <p className="calcMuted">É preciso ter um colaborador para treinar.</p>}
    <div className="calcActions">
      <button type="button" className="calcButton calcButtonGhost" onClick={() => onResolve({ action: 'SKIP' })}>Não comprar e encerrar evento</button>
      <button type="button" className="calcButton" disabled={!canBuy} onClick={() => onResolve({ action: 'BUY', ...selection })}>Confirmar compra de {KIND_LABELS[kind] || 'recurso'}</button>
    </div>
    {error && <p className="calcError" role="alert">{error}</p>}
  </div>
}

export function Recovery({ turn, round, onRecover, onCancel }) {
  const [amount, setAmount] = useState(0)
  const [vendorType, setVendorType] = useState('comum')
  const [qty, setQty] = useState(1)
  const [error, setError] = useState('')
  const maxLoan = clampLoanAmount(Number.MAX_SAFE_INTEGER, turn.player.bens)
  const staff = { comum: turn.player.vendedoresComuns, field: turn.player.fieldSales, inside: turn.player.insideSales, gestor: turn.player.gestores }
  const availableStaff = Object.entries(staff).filter(([, n]) => Number(n) > 0)
  const selectedVendorType = availableStaff.some(([type]) => type === vendorType) ? vendorType : availableStaff[0]?.[0] || ''
  const reduceOptions = getCalcReduceOptions(turn.player)
  function run(choice) {
    try { onRecover(choice); setError('') } catch (issue) { setError(issue.message) }
  }
  return <div className="calcRecovery">
    <h4>Recuperação financeira</h4>
    <p>Escolha como obter caixa para resolver este evento.</p>
    {canTakeLoan(turn.player) && maxLoan > 0 && <div className="calcRecoveryRow">
      <label className="calcField">Empréstimo (até {money(maxLoan)})
        <input type="number" min="1" max={maxLoan} value={amount} onChange={(e) => setAmount(e.target.value)} />
      </label>
      <button type="button" className="calcButton" onClick={() => run({ action: 'LOAN', amount: Number(amount) })}>Contratar empréstimo</button>
    </div>}
    <div className="calcRecoveryRow">
      <label className="calcField">Demitir
        <select value={selectedVendorType} onChange={(e) => setVendorType(e.target.value)}>
          {availableStaff.map(([type, n]) => <option key={type} value={type}>{type} · {n}</option>)}
        </select>
      </label>
      <label className="calcField">Quantidade<input type="number" min="1" value={qty} onChange={(e) => setQty(e.target.value)} /></label>
      <button type="button" className="calcButton calcButtonGhost" disabled={!availableStaff.length} onClick={() => run({ action: 'FIRE', vendorType: selectedVendorType, qty: Number(qty) })}>Demitir e recuperar</button>
    </div>
    {reduceOptions.length > 0 && <div className="calcRecoveryReductions">
      <strong>Reduzir investimento</strong>
      {reduceOptions.map((option) => <button key={option.group} type="button" className="calcButton calcButtonGhost"
        onClick={() => run({ action: 'REDUCE', group: option.group, level: option.level })}>
        Reduzir {option.group === 'MIX' ? 'Mix' : 'ERP'} nível {option.level} · +{money(option.credit)}
      </button>)}
    </div>}
    <div className="calcActions">
      <button type="button" className="calcButton calcButtonGhost" onClick={onCancel}>Voltar ao evento</button>
      <button type="button" className="calcButton calcButtonDanger" onClick={() => { if (window.confirm('Declarar falência? A decisão encerra o turno deste jogador.')) run({ action: 'BANKRUPT' }) }}>Declarar falência</button>
    </div>
    {error && <p className="calcError" role="alert">{error}</p>}
  </div>
}

export default function SalesGameCalc({ initialGame = null }) {
  const [savedSession, setSavedSession] = useState(readSavedSession)
  const [game, setGame] = useState(initialGame)
  const [turn, setTurn] = useState(null)
  const [tab, setTab] = useState('Jogar')
  const [error, setError] = useState('')
  const [recoverOpen, setRecoverOpen] = useState(false)
  const [correctionOpen, setCorrectionOpen] = useState(false)
  const [correctionHouse, setCorrectionHouse] = useState(1)
  const [cardNumber, setCardNumber] = useState('')

  useEffect(() => { if (typeof window !== 'undefined') markCalcBootReady(window) }, [])

  useEffect(() => {
    if (game && typeof window !== 'undefined') {
      try { window.localStorage.setItem(CALC_STORAGE_KEY, serializeCalcSession({ game, turn })) } catch { setError('Não foi possível salvar neste navegador. Mantenha a página aberta.') }
    }
  }, [game, turn])

  const player = game?.players?.[game.currentPlayerIndex]
  const event = turn?.events?.[turn.eventIndex]
  const eventPreview = turn && game ? getCalcEventPreview(turn, game.round) : null

  function resolve(decision) {
    try {
      const next = resolveCalcEvent(turn, decision, game.round)
      setTurn(next)
      setError('')
      setCardNumber('')
      setRecoverOpen(false)
    } catch (issue) { setError(issue.message) }
  }
  function recover(choice) {
    const next = recoverCalcTurn(turn, choice, game.round)
    setTurn(next)
    setRecoverOpen(false)
    setError('')
  }
  function finish() {
    try {
      const next = finishCalcTurn(game, turn)
      setGame(next)
      setTurn(null)
      setError('')
    } catch (issue) { setError(issue.message) }
  }
  function undo() {
    if (!window.confirm('Desfazer o último registro e restaurar o estado anterior?')) return
    setGame((current) => undoCalcTurn(current))
    setTurn(null)
    setError('')
  }
  function correct() {
    try {
      setGame((current) => correctCalcPosition(current, Number(correctionHouse)))
      setCorrectionOpen(false)
      setError('')
    } catch (issue) { setError(issue.message) }
  }

  return <div className="calcPage">
    <header className="calcHeader">
      <div><span className="calcEyebrow">Ferramenta para o tabuleiro físico</span><h1>Sales Game Calc</h1>
        {game && <p>Rodada {game.round} de {game.maxRounds} · {game.gameOver ? 'Partida encerrada' : 'Partida em andamento'}</p>}</div>
      <a className="calcBack" href="/">← Voltar ao início</a>
    </header>
    {!game ? <Setup savedGame={savedSession?.game} onContinue={() => { setGame(savedSession.game); setTurn(savedSession.turn) }} onStart={(next) => { setGame(next); setTurn(null); setSavedSession(null) }} /> : <>
      {game.gameOver ? <main className="calcCard calcEnd">
        <span className="calcEyebrow">Fim da partida</span><h2>Resultado final</h2>
        <ol>{getCalcRanking(game).map((item) => <li key={item.id}>
          <strong>{item.name}{item.bankrupt ? ' · Falido' : ''}</strong>
          <span>Patrimônio {money(item.patrimonio)} · Caixa {money(item.cash)} · Bens {money(item.bens)}</span>
        </li>)}</ol>
        <button className="calcButton" onClick={() => { if (window.confirm('Começar outra partida? A partida atual será substituída.')) { setGame(null); setTurn(null); setSavedSession(null); window.localStorage.removeItem(CALC_STORAGE_KEY) } }}>Nova partida</button>
      </main> : <>
        <nav className="calcTabs" aria-label="Áreas da calculadora">{['Jogar', 'Placar', 'Histórico'].map((item) => <button type="button" key={item}
          className={tab === item ? 'isActive' : ''} aria-current={tab === item ? 'page' : undefined} onClick={() => setTab(item)}>{item}</button>)}</nav>
        {tab === 'Jogar' && <main className="calcGameGrid">
          <div className="calcMainColumn">
            <section className="calcCard calcPlayerCard">
              <div><span className="calcEyebrow">Jogador da vez</span><h2>{player.name}</h2><p>Casa {player.pos + 1} · {game.round}ª rodada</p></div>
              <div className="calcPlayerMoney"><span>Caixa atual</span><strong>{money(player.cash)}</strong></div>
            </section>
            {!turn ? <section className="calcCard calcTurnCard">
              <span className="calcEyebrow">Próxima jogada</span><h2>Quanto saiu no dado físico?</h2>
              <div className="calcDice" role="group" aria-label="Resultado do dado físico">
                {[1, 2, 3, 4, 5, 6].map((face) => <button key={face} type="button" onClick={() => {
                  try { setTurn(planCalcTurn(game, face)); setError('') } catch (issue) { setError(issue.message) }
                }}>{face}</button>)}
              </div>
              <div className="calcTools">
                <button type="button" onClick={() => { setCorrectionHouse(player.pos + 1); setCorrectionOpen(true) }}>Corrigir posição</button>
                <button type="button" disabled={!game.history.length} onClick={undo}>Desfazer última jogada</button>
              </div>
              {correctionOpen && <div className="calcCorrection">
                <label className="calcField">Casa da peça no tabuleiro
                  <select value={correctionHouse} onChange={(e) => setCorrectionHouse(Number(e.target.value))}>
                    {Array.from({ length: 40 }, (_, i) => i + 1).map((house) => <option key={house} value={house}>Casa {house}</option>)}
                  </select>
                </label>
                <div className="calcActions"><button type="button" className="calcButton calcButtonGhost" onClick={() => setCorrectionOpen(false)}>Cancelar</button>
                  <button type="button" className="calcButton" onClick={correct}>Confirmar correção</button></div>
              </div>}
              {error && <p className="calcError" role="alert">{error}</p>}
            </section> : <section className="calcCard calcTurnCard">
              <span className="calcEyebrow">Dado {turn.dice} · {getCalcTurnProgress(turn)}</span>
              <h2>Casa {turn.startPosition} → {turn.destination}</h2>
              <p className="calcPath">Caminho: {turn.path.join(' → ')}</p>
              {event ? <div className="calcEvent" key={`${turn.playerId}-${turn.eventIndex}`}>
                <span className="calcHouse">Casa {event.house}</span><h3>{event.label}</h3>
                {event.kind === 'REVENUE' || event.kind === 'EXPENSES' ? <>
                  <p className="calcAmount">{event.kind === 'REVENUE' ? '+' : '−'} {money(eventPreview.amount)}</p>
                  {eventPreview.loanCharge > 0 && <p>Inclui {money(eventPreview.loanCharge)} de quitação do empréstimo.</p>}
                  <p>Caixa: {money(turn.player.cash)} → {money(eventPreview.cashAfter)}</p>
                  {event.kind === 'EXPENSES' && eventPreview.cashAfter < 0 ? <button className="calcButton" onClick={() => setRecoverOpen(true)}>Abrir recuperação financeira</button>
                    : <button className="calcButton" onClick={() => resolve({ action: 'APPLY' })}>Aplicar {event.kind === 'REVENUE' ? 'faturamento' : 'despesas'} e continuar</button>}
                </> : event.kind === 'LUCK' ? <>
                  <p>Pegue uma carta física e encontre o título abaixo. O número indica a ordem do catálogo digital.</p>
                  <label className="calcField">Carta física
                    <select value={cardNumber} onChange={(e) => setCardNumber(e.target.value)}>
                      <option value="">Selecione a carta</option>
                      {SORTE_REVES_CARDS.map((card, i) => <option key={card.id} value={i}>{i + 1} · {card.title}</option>)}
                    </select>
                  </label>
                  {cardNumber !== '' && <p className="calcCardDescription">{SORTE_REVES_CARDS[Number(cardNumber)]?.text}</p>}
                  <button className="calcButton" disabled={cardNumber === ''} onClick={() => resolve({ cardId: SORTE_REVES_CARDS[Number(cardNumber)]?.id })}>Aplicar efeito da carta</button>
                  {error.includes('Caixa insuficiente') && <button className="calcButton calcButtonGhost" onClick={() => setRecoverOpen(true)}>Abrir recuperação financeira</button>}
                  {error && <p className="calcError" role="alert">{error}</p>}
                </> : <PurchaseChoice key={`${turn.playerId}-${turn.eventIndex}`} player={turn.player} event={event} onResolve={resolve} onOpenRecovery={() => setRecoverOpen(true)} error={error} setError={setError} />}
                {recoverOpen && <Recovery turn={turn} round={game.round} onRecover={recover} onCancel={() => setRecoverOpen(false)} />}
                {error && !['LUCK'].includes(event.kind) && ['REVENUE', 'EXPENSES'].includes(event.kind) && <p className="calcError" role="alert">{error}</p>}
              </div> : <div className="calcTurnDone"><span className="calcEyebrow">Turno concluído</span>
                <h3>{player.name} · Casa {turn.startPosition} → {turn.destination}</h3>
                <p>Caixa: {money(player.cash)} → {money(turn.player.cash)}</p>
                <ul>{turn.actions.map((action, i) => <li key={i}>{action.label}</li>)}</ul>
                <button className="calcButton" onClick={finish}>Confirmar turno e passar ao próximo jogador</button>
              </div>}
              <button className="calcTextButton" onClick={() => { if (window.confirm('Descartar este turno sem alterar a partida?')) { setTurn(null); setError(''); setRecoverOpen(false) } }}>Descartar turno</button>
            </section>}
          </div>
          <aside className="calcCard calcAside"><h3>Placar rápido</h3>{game.players.map((item, index) => <div className="calcMiniPlayer" key={item.id}>
            <strong>{item.name}{index === game.currentPlayerIndex ? <em>NA VEZ</em> : null}</strong>
            <span>Casa {item.pos + 1} · {money(item.cash)}</span>
          </div>)}</aside>
        </main>}
        {tab === 'Placar' && <main className="calcCard calcList"><h2>Placar</h2>{game.players.map((item, index) => {
          const metrics = getCalcPlayerMetrics(item)
          return <section className="calcScoreRow" key={item.id}><h3>{item.name} {index === game.currentPlayerIndex && <small>NA VEZ</small>}</h3>
            <p>Casa {item.pos + 1}{item.bankrupt ? ' · Falido' : ''}</p>
            <div className="calcMetricGrid"><Metric label="Caixa" value={money(metrics.cash)} /><Metric label="Bens" value={money(metrics.bens)} />
              <Metric label="Patrimônio" value={money(metrics.patrimonio)} /><Metric label="Clientes" value={metrics.clients} />
              <Metric label="Capacidade" value={metrics.capacity} /><Metric label="Faturamento" value={money(metrics.revenue)} />
              <Metric label="Despesas" value={money(metrics.expenses)} /></div>
          </section>
        })}</main>}
        {tab === 'Histórico' && <main className="calcCard calcList"><h2>Histórico</h2>
          {!game.history.length && <p>Os turnos confirmados aparecerão aqui.</p>}
          {[...game.history].reverse().map((entry, index) => <article className="calcHistoryRow" key={`${entry.at}-${index}`}>
            <strong>{entry.playerName} · {entry.kind === 'CORRECTION' ? 'Correção de posição' : `Dado ${entry.dice}`}</strong>
            <span>Casa {entry.from} → {entry.to}{entry.kind === 'TURN' && ` · Caixa ${money(entry.cashBefore)} → ${money(entry.cashAfter)}`}</span>
            {entry.actions?.map((action, i) => <small key={i}>{action.label}</small>)}
          </article>)}
          <button className="calcButton calcButtonGhost" disabled={!game.history.length || !!turn} onClick={undo}>Desfazer última jogada</button>
        </main>}
      </>}
    </>}
  </div>
}
