// src/App.jsx
import React, { useEffect, useMemo, useRef, useState } from 'react'
import './styles.css'

// Telas
import StartScreen from './components/StartScreen.jsx'
import LobbyList from './pages/LobbyList.jsx'
import PlayersLobby from './pages/PlayersLobby.jsx'
import Board from './components/board/Board.jsx'
import HUD from './components/panel/HUD.jsx'
import Controls from './components/panel/Controls.jsx'
import DiceResult from './components/DiceResult.jsx'
import DiceRollOverlay from './components/dice/DiceRollOverlay.jsx'
import { unlockDiceAudio } from './utils/diceRollSound.js'
import FinalWinners from './components/FinalWinners.jsx'
import TutorialModal, { shouldAutoOpenTutorial } from './components/TutorialModal.jsx'
import TurnTimer from './components/TurnTimer.jsx'
import BankruptOverlay from './modals/BankruptOverlay.jsx'
import DebugPanel from './components/DebugPanel.jsx'
import { ModalProvider } from './modals/ModalContext.jsx'

// Regras / Engine
import { useTurnEngine } from './game/useTurnEngine.jsx'
import {
  computeDespesasFor,
  computeFaturamentoFor,
  capacityAndAttendance
} from './game/gameMath'
import { debugMode, validateGameState, validateCalculations } from './game/debugMode.js'
import { initCashAudit, captureCashDiff } from './debug/cashAudit.js'
// ✅ CORREÇÃO: Imports de testes apenas em DEV (carregamento dinâmico)
if (import.meta.env.DEV) {
  // Carrega validadores e testes apenas em desenvolvimento
  Promise.all([
    import('./game/__tests__/realTimeValidator.js'),
    import('./game/__tests__/index.js')
  ]).then(([realTimeModule]) => {
    if (realTimeModule?.validateGameState) {
      window.__validateGameStateRealTime = realTimeModule.validateGameState
    }
  }).catch(err => {
    console.warn('[App] Failed to load test modules:', err)
  })
}

// Identidade por aba
import { getOrCreateTabPlayerId, setTabPlayerName, resolvePlayerIdForRoom, setMatchIdentity, clearMatchIdentity, getMatchIdentity } from './auth'

// Net (opcional)
import { useGameNet } from './net/GameNetProvider.jsx'

// Gerenciamento de salas
import { leaveRoom, getLobby, onLobbyRealtime, touchLobbyPlayer } from './lib/lobbies'
import {
  confirmSharedSkipKey,
  releaseSharedSkipKey,
} from './game/sharedTurnSkipGuard.js'
import { useGamePresenceAutoSkip } from './game/useGamePresenceAutoSkip.js'
import { useTurnTimerAutoPass } from './game/useTurnTimerAutoPass.js'
import {
  DEFAULT_TURN_TIME_SEC,
  normalizeTurnTime,
} from './game/turnTimeConfig.js'
import { computeTurnDeadlineAt, sanitizeTurnDeadlineOnHandoff } from './game/turnTimerLogic.js'
import { validateTurnCommit, stripCommitMeta, inferCommitKind, resolveSkipGuardAction } from './game/turnCommitValidation.js'
import {
  shouldApplyDeferredLocalPatch,
  captureTurnEmissionSnapshot,
} from './game/turnStateMonotonic.js'
import {
  mergePlayersById,
  buildPlayersDeltaById,
  resolveSeatIdentity,
  resolveMyCash,
  planRosterApply,
  shouldApplyIncomingState,
  isAuthoritativeStartState,
} from './game/playerStateSync.js'

// Versão do tabuleiro (persistida no JSON da partida)
import {
  getNewGameBoardVersion,
  haveCompatibleBoardVersions,
  resolveBoardVersion,
} from './data/boardVersions.js'
import { DEFAULT_MAX_ROUNDS, normalizeMaxRounds } from './game/roundConfig'
import { isDebugLogsEnabled, isDevVerbose, isVercelDebugEnabled } from './game/debugFlags.js'
import { formatRoundProgress } from './game/roundDisplay.js'
import { normalizePlayersAliases } from './game/playerShape.js'
import { consumeTileTip } from './game/progressiveTips.js'
import { MANUAL_CONSTANTS } from './game/manualConstants.js'
import OrientationGuard from './components/orientation/OrientationGuard.jsx'
import { enterGamePresentation } from './utils/fullscreen.js'
import { useBoardPinchZoom } from './hooks/useBoardPinchZoom.js'

// -------------------------------------------------------------
// App raiz – concentra roteamento de fases e estado global leve
// -------------------------------------------------------------

const clampRound = (r, maxRounds = DEFAULT_MAX_ROUNDS) => {
  const limit = normalizeMaxRounds(maxRounds)
  const n = Number(r)
  if (!Number.isFinite(n)) return 1
  return Math.min(limit, Math.max(1, n))
}

// ✅ Defer: deixa o React renderizar antes de I/O (netCommit / BroadcastChannel)
const defer = (fn) =>
  (typeof queueMicrotask === 'function')
    ? queueMicrotask(fn)
    : Promise.resolve().then(fn)

const getVisibleLoanPending = (player = {}) => {
  const lp = player?.loanPending || null
  const loanId = String(lp?.loanId || '')
  const lastChargedLoanId = String(player?.lastChargedLoanId || '')

  const isAlreadyPaid =
    !!loanId &&
    !!lastChargedLoanId &&
    loanId === lastChargedLoanId

  if (isAlreadyPaid) return null
  return lp
}

// Normalização defensiva do campo passivo lastRoll (somente UI; nenhuma regra depende dele).
function normalizeLastRoll(value) {
  if (!value || typeof value !== 'object') return null

  const steps = Number(value.steps)
  if (!Number.isInteger(steps) || steps < 1 || steps > 6) return null

  const playerId = String(value.playerId || '').trim()
  const playerName = String(value.playerName || '').trim() || 'Jogador'
  const turnKey =
    value.turnKey !== null && value.turnKey !== undefined
      ? String(value.turnKey)
      : null

  if (!playerId || turnKey === null) return null

  return {
    playerId,
    playerName,
    steps,
    turnKey,
  }
}

export default function App() {
  const DEBUG_LOGS = isDebugLogsEnabled()
  const DEBUG_VALIDATE = import.meta.env.DEV && localStorage.getItem('SALES_DEBUG_VALIDATE') === '1'

  // Comparação rápida (sem deep compare / sem JSON.stringify) para reduzir custo no hot-path
  const isSameValue = React.useCallback((a, b, depth = 0) => {
    if (a === b) return true
    if (a == null || b == null) return a === b

    const ta = typeof a
    const tb = typeof b
    if (ta !== tb) return false
    if (ta !== 'object') return a === b

    // limite de profundidade para evitar "deep compare"
    if (depth >= 2) return false

    if (Array.isArray(a)) {
      if (!Array.isArray(b)) return false
      if (a.length !== b.length) return false
      for (let i = 0; i < a.length; i++) {
        const av = a[i]
        const bv = b[i]
        // elementos costumam ser primitivos; se forem objetos pequenos, permite 1 nível
        if (!((av === bv) || isSameValue(av, bv, depth + 1))) return false
      }
      return true
    }
    if (Array.isArray(b)) return false

    const ka = Object.keys(a)
    const kb = Object.keys(b)
    if (ka.length !== kb.length) return false
    for (const k of ka) {
      if (!Object.prototype.hasOwnProperty.call(b, k)) return false
      const av = a[k]
      const bv = b[k]
      if (!((av === bv) || isSameValue(av, bv, depth + 1))) return false
    }
    return true
  }, [])

  const didPlayerChange = React.useCallback((before = {}, after = {}) => {
    if (!before || !after) return true
    // chaves relevantes para UI/sync (sem mudar regras do jogo)
    const keysToCheck = [
      'pos', 'cash', 'bankrupt', 'clients',
      'vendedoresComuns', 'fieldSales', 'insideSales',
      'gestores', 'gestoresComerciais', 'manutencao', 'bens',
      'mixProdutos', 'erpLevel',
      'az', 'am', 'rox', 'onboarding',
      'trainingByVendor', 'trainingsByVendor',
      'loanPending', 'loanTakenInMatch', 'lastChargedLoanId', 'waitingAtRevenue', 'revenue', 'lastRevenueRound',
      'erpOwned', 'erp', 'mixOwned', 'mix',
      'directBuys', 'directBuysPush', 'trainings', 'mixBase',
    ]
    for (const k of keysToCheck) {
      if (!isSameValue(before?.[k], after?.[k])) return true
    }
    return false
  }, [isSameValue])

  // ====== fases da UI
  const [phase, setPhase] = useState('start') // 'start' | 'lobbies' | 'playersLobby' | 'game'
  const [currentLobbyId, setCurrentLobbyId] = useState(null)
  const [roomId, setRoomId] = useState(null)
  const [boardVersion, setBoardVersion] = useState(getNewGameBoardVersion)
  const boardVersionRef = useRef(boardVersion)
  useEffect(() => { boardVersionRef.current = boardVersion }, [boardVersion])

  // ====== identidade por aba
  const meId = useMemo(() => getOrCreateTabPlayerId(), [])
  // ✅ OBJ 2: nome começa vazio; só define após StartScreen confirmar.
  const [myName, setMyName] = useState('')
  const [myUid, setMyUid] = useState(meId)

  // ====== estado mínimo do jogo
  const STARTER_KIT = useMemo(
    () => Object.freeze({ mixProdutos: 'D', erpLevel: 'D', clients: 1, vendedoresComuns: 1 }),
    []
  )
  const applyStarterKit = (obj = {}) => ({
    ...obj,
    mixProdutos: obj.mixProdutos ?? 'D',
    erpLevel: obj.erpLevel ?? 'D',
    clients: obj.clients ?? 1,
    vendedoresComuns: obj.vendedoresComuns ?? 1,
    loanTakenInMatch: obj.loanTakenInMatch ?? false,
    lastChargedLoanId: obj.lastChargedLoanId ?? null,
  })

  // ✅ CORREÇÃO: Normaliza ordem dos players para garantir consistência entre clientes
  // Seat é IMUTÁVEL após atribuído no start - nunca reatribui seat existente
  const normalizePlayers = (players) => {
    if (!Array.isArray(players) || players.length === 0) return players
    
    // Cria cópia para não mutar o original
    const arr = [...players].filter(Boolean)
    
    // ✅ DETERMINÍSTICO: nunca ordenar por campos mutáveis (cash/name/clients/etc).
    // Regra: usa joinOrder (persistido no player) e fallback por seat e depois por id.
    const hasJoinOrder = arr.every(p => Number.isInteger(p.joinOrder))
    const hasSeat = arr.every(p => Number.isInteger(p.seat))

    // 1) ordena por joinOrder se todos tiverem; senão usa seat se todos tiverem; senão fallback por id.
    let ordered = hasJoinOrder
      ? arr.sort((a, b) => (a.joinOrder - b.joinOrder) || String(a?.id ?? '').localeCompare(String(b?.id ?? '')))
      : hasSeat
        ? arr.sort((a, b) => (a.seat - b.seat) || String(a?.id ?? '').localeCompare(String(b?.id ?? '')))
        : arr.sort((a, b) => String(a?.id ?? a?.player_id ?? '').localeCompare(String(b?.id ?? b?.player_id ?? '')))
    
    // Preenche seats faltantes SEM alterar os existentes (determinístico)
    let nextSeat = 0
    const used = new Set(ordered.filter(p => Number.isInteger(p.seat)).map(p => p.seat))
    
    ordered = ordered.map(p => {
      if (Number.isInteger(p.seat)) {
        return p // Preserva seat existente
      }
      // Atribui próximo seat disponível
      while (used.has(nextSeat)) nextSeat++
      used.add(nextSeat)
      return { ...p, seat: nextSeat++ }
    })

    // ✅ joinOrder persistido: se faltante, deriva de seat (imutável) para estabilizar ordenação entre clientes
    ordered = ordered.map(p => {
      if (Number.isInteger(p.joinOrder)) return p
      if (Number.isInteger(p.seat)) return { ...p, joinOrder: p.seat }
      return { ...p, joinOrder: 0 }
    })
    
    // Reordena por seat após preencher faltantes
    // Importante: a ordem global passa a ser joinOrder (determinístico)
    ordered = ordered.sort((a, b) => (a.joinOrder - b.joinOrder) || String(a?.id ?? '').localeCompare(String(b?.id ?? '')))
    
    if (DEBUG_LOGS) console.log('[App] normalizePlayers - ordenados:', ordered.map(p => ({ id: p.id, name: p.name, seat: p.seat })))
    return normalizePlayersAliases(ordered)
  }

  const [players, _setPlayers] = useState([
    applyStarterKit({ id: meId, name: '', cash: MANUAL_CONSTANTS.startCash, pos: 0, color: '#FFD600', bens: MANUAL_CONSTANTS.startBens })
  ])

  // ====== Cash Audit (instrumentação de saldo) ======
  // Wrapper do setPlayers: captura diffs de cash sem mudar schema do estado.
  const setPlayers = React.useCallback((updater, meta = {}) => {
    _setPlayers((prev) => {
      const next = (typeof updater === 'function') ? updater(prev) : updater
      // meta pode ser setado via `setCashAuditContext()` por qualquer fluxo (ex.: useTurnEngine).
      captureCashDiff(prev, next, null)

      // ✅ OBJ 3: log obrigatório de mudança de posição
      try {
        const source = meta?.source || 'UNKNOWN'
        const prevById = new Map((prev || []).map(p => [String(p?.id), p]))
        for (const p of (next || [])) {
          const id = String(p?.id)
          const before = prevById.get(id)?.pos
          const after = p?.pos
          if (after !== undefined && before !== undefined && Number(before) !== Number(after)) {
            if (DEBUG_LOGS) console.log('[POS_CHANGE]', { playerId: id, from: before, to: after, source })
          }
        }
      } catch {}
      return next
    })
  }, [DEBUG_LOGS])

  useEffect(() => {
    // Ativa via ENV ou querystring; por padrão fica OFF e é silencioso.
    let enabled = false
    try {
      enabled = String(import.meta.env.VITE_CASH_AUDIT || '') === '1'
    } catch {}
    try {
      const url = new URL(window.location.href)
      if (url.searchParams.get('cashAudit') === '1') enabled = true
    } catch {}
    initCashAudit({ enabled })
  }, [])
  const [round, setRound] = useState(1)
  const [maxRounds, setMaxRounds] = useState(DEFAULT_MAX_ROUNDS)
  const maxRoundsRef = useRef(maxRounds)
  useEffect(() => { maxRoundsRef.current = maxRounds }, [maxRounds])

  const [turnTimeSec, setTurnTimeSec] = useState(DEFAULT_TURN_TIME_SEC)
  const turnTimeSecRef = useRef(turnTimeSec)
  useEffect(() => { turnTimeSecRef.current = turnTimeSec }, [turnTimeSec])

  const [turnDeadlineAt, setTurnDeadlineAt] = useState(null)
  const turnDeadlineAtRef = useRef(turnDeadlineAt)
  useEffect(() => { turnDeadlineAtRef.current = turnDeadlineAt }, [turnDeadlineAt])
  const prevTurnIdentityRef = useRef({ id: null, seq: 0 })
  const [turnIdx, setTurnIdx] = useState(0)
  const [turnPlayerId, setTurnPlayerId] = useState(null) // ✅ CORREÇÃO: ID do jogador da vez (autoritativo)
  const [roundFlags, setRoundFlags] = useState(new Array(1).fill(false)) // quem já cruzou a casa 1
  const [gameOver, setGameOver] = useState(false)
  const gameOverRef = useRef(false)
  useEffect(() => { gameOverRef.current = !!gameOver }, [gameOver])
  const [winner, setWinner] = useState(null)
  // ✅ Anti-double-roll persistido (independente do lock)
  const [lastRollTurnKey, setLastRollTurnKey] = useState(null)
  // ✅ turnSeq: contador monotônico do turno (1 jogador: 0→1→2…; evita [ROLL_BLOCK])
  const [turnSeq, setTurnSeq] = useState(0)

  // ===== Última rolagem do dado (somente apresentação; não entra em regras) =====
  const [lastRollUI, setLastRollUI] = useState(null)
  const [isRollingUI, setIsRollingUI] = useState(false)
  const [diceFx, setDiceFx] = useState(null)
  const diceAnimatedKeysRef = useRef(new Set())
  const diceFxRef = useRef(null)
  const rollingTimeoutRef = useRef(null)
  const lastRollUIRef = useRef(null)
  const diceInFlightRef = useRef(false)
  const handleDiceFxCompleteRef = useRef(null)
  useEffect(() => { lastRollUIRef.current = lastRollUI }, [lastRollUI])
  useEffect(() => { diceFxRef.current = diceFx }, [diceFx])

  const clearRollingTimeout = React.useCallback(() => {
    if (rollingTimeoutRef.current) {
      clearTimeout(rollingTimeoutRef.current)
      rollingTimeoutRef.current = null
    }
  }, [])

  const clearDiceUi = React.useCallback(() => {
    clearRollingTimeout()
    diceInFlightRef.current = false
    setDiceFx(null)
    setIsRollingUI(false)
  }, [clearRollingTimeout])

  // Aplica lastRoll no espelho local com proteção visual contra regressão de turnKey.
  const applyLastRollUI = React.useCallback((incoming) => {
    if (incoming === null) {
      setLastRollUI(null)
      return
    }
    const normalized = normalizeLastRoll(incoming)
    if (!normalized) return

    const prev = lastRollUIRef.current
    if (prev && prev.turnKey != null && normalized.turnKey != null) {
      const prevN = Number(prev.turnKey)
      const nextN = Number(normalized.turnKey)
      if (Number.isFinite(prevN) && Number.isFinite(nextN) && nextN < prevN) {
        // Proteção apenas visual — não rejeita commits
        return
      }
    }
    setLastRollUI(normalized)
    clearRollingTimeout()

    // Não anima dado depois do fim de jogo (evita “rolar” eterno no pódio)
    if (gameOverRef.current) {
      setIsRollingUI(false)
      return
    }

    // Remoto (ou sync): anima o dado 3D se ainda não mostramos este turnKey.
    const key = normalized.turnKey != null ? String(normalized.turnKey) : null
    if (key && !diceAnimatedKeysRef.current.has(key) && !diceFxRef.current) {
      diceAnimatedKeysRef.current.add(key)
      setIsRollingUI(true)
      setDiceFx({
        id: key,
        steps: normalized.steps,
        playerName: normalized.playerName || 'Jogador',
        pendingAction: null,
      })
    } else {
      setIsRollingUI(false)
    }
  }, [clearRollingTimeout])

  // Limpa UI do dado ao sair da fase de jogo / unmount
  useEffect(() => {
    if (phase !== 'game') {
      clearDiceUi()
      setLastRollUI(null)
      diceAnimatedKeysRef.current.clear()
    }
  }, [phase, clearDiceUi])

  // Fim de jogo: nunca deixar dado “rolando” por cima do pódio
  useEffect(() => {
    if (!gameOver) return
    clearDiceUi()
  }, [gameOver, clearDiceUi])

  // Watchdog: se o overlay ficar preso, aplica o ROLL pendente
  useEffect(() => {
    if (!diceFx) return undefined
    const startedAt = Date.now()
    const t = setInterval(() => {
      if (!diceFxRef.current) return
      if (Date.now() - startedAt < 2800) return
      console.warn('[dice] watchdog: forçando conclusão do overlay')
      handleDiceFxCompleteRef.current?.()
    }, 400)
    return () => clearInterval(t)
  }, [diceFx])

  useEffect(() => {
    return () => { clearRollingTimeout() }
  }, [clearRollingTimeout])

  // ====== HUD do meu jogador
  const [meHud, setMeHud] = useState({
    id: meId,
    name: players[0]?.name || 'Jogador',
    color: players[0]?.color || '#6c5ce7',
    cash: players[0]?.cash ?? MANUAL_CONSTANTS.startCash,
    possibAt: 0,
    clientsAt: 0,
    matchId: 'local',
  })

  // ====== log leve (se quiser usar num console próprio depois)
  const [log, setLog] = useState(['Bem-vindo ao Sales Game!'])
  const appendLog = (msg) => setLog(l => [msg, ...l].slice(0, 12))

  // ====== modo de visualização do tabuleiro (mobile) — estado EXCLUSIVAMENTE
  // visual/local: não entra em rooms.state, não é sincronizado nem persistido.
  // 'fit' = modo normal | 'follow' = modo foco (edge-to-edge, sem scroll)
  const [boardView, setBoardView] = useState('fit')
  const boardWrapRef = useRef(null)
  useBoardPinchZoom(boardWrapRef, phase === 'game')
  const [hudSheetOpen, setHudSheetOpen] = useState(false)

  // ====== bloqueio de turno (cadeado entre abas)
  const [turnLock, setTurnLock] = useState(false)
  const [lockOwner, setLockOwner] = useState(null)
  const turnPlayerIdRef = React.useRef(turnPlayerId)
  const turnSeqRef = React.useRef(turnSeq)
  const lockOwnerRef = React.useRef(lockOwner)
  const turnLockRef = React.useRef(turnLock)
  const lastRollTurnKeyRef = React.useRef(lastRollTurnKey)
  useEffect(() => { turnPlayerIdRef.current = turnPlayerId }, [turnPlayerId])
  useEffect(() => { turnSeqRef.current = turnSeq }, [turnSeq])
  useEffect(() => { lockOwnerRef.current = lockOwner }, [lockOwner])
  useEffect(() => { turnLockRef.current = turnLock }, [turnLock])
  useEffect(() => { lastRollTurnKeyRef.current = lastRollTurnKey }, [lastRollTurnKey])
  const bcRef = useRef(null)
  // ✅ INIT_GUARD: após aplicar snapshot autoritativo do Supabase, nunca mais aceitar "reset local" de turno/round
  const hydratedFromNetRef = useRef(false)
  // Resume: força o effect de hidratação a reavaliar mesmo se netState/version não mudarem
  // (Provider já tinha o snapshot da mesma room antes de limpar players).
  const [resumeHydrateNonce, setResumeHydrateNonce] = useState(0)
  
  // ✅ BUG 2 FIX: Refs para watchdog anti-trava
  const lockSinceRef = useRef(null)
  const lastNetApplyAtRef = useRef(0)
  const fixedCorruptLockRef = React.useRef(null)

  // ✅ Invariante: turnLock=true nunca pode ficar com lockOwner null.
  useEffect(() => {
    if (!turnLock) return
    if (lockOwner) return
    if (turnPlayerId) {
      console.warn('[LOCK_INVARIANT] turnLock=true com lockOwner=null -> corrigindo owner para turnPlayerId', { turnPlayerId })
      setLockOwner(String(turnPlayerId))
    } else {
      console.warn('[LOCK_INVARIANT] turnLock=true sem turnPlayerId -> desligando turnLock')
      setTurnLock(false)
    }
  }, [turnLock, lockOwner, turnPlayerId])

  // ====== “quem sou eu” no array de players
  const isMine = React.useCallback((p) => !!p && String(p.id) === String(myUid), [myUid])
  const [identityMismatch, setIdentityMismatch] = useState(false)
  const myCashInfo = useMemo(
    () => resolveMyCash({ myUid, players }),
    [myUid, players]
  )
  // Sem fallback silencioso para 0 quando o assento não está no roster (identidade quebrada).
  const myCash = myCashInfo.found ? myCashInfo.cash : (identityMismatch ? null : 0)

  // ====== bootstrap de contexto (NÃO muda fase automaticamente)
  // ✅ OBJ 1: StartScreen NUNCA deve ser pulada automaticamente.
  useEffect(() => {
    try {
      const url = new URL(window.location.href)
      const roomFromUrl = url.searchParams.get('room')
      const roomFromStorage = localStorage.getItem('sg:lastRoomName')
      const room = roomFromUrl || roomFromStorage

      // Limpar localStorage antigo para forçar tela inicial
      if (roomFromStorage && !roomFromUrl) {
        localStorage.removeItem('sg:lastRoomName')
      }

      if (room && roomFromUrl) {
        // não entrar automaticamente; apenas guardar para depois do StartScreen
        setRoomId(String(room))
        // mantém referência para quando o usuário confirmar o nome
        setCurrentLobbyId(String(room))
        try {
          url.searchParams.set('room', String(room))
          history.replaceState(null, '', url.toString())
        } catch {}
      }
    } catch {}
  }, [])

  // ====== BroadcastChannel para sync entre abas (mesmo navegador)
  const syncKey = useMemo(() => `sg-sync:${currentLobbyId || 'local'}`, [currentLobbyId])

  useEffect(() => {
    try {
      bcRef.current?.close?.()
      const bc = new BroadcastChannel(syncKey)
      bc.onmessage = (e) => {
        const d = e.data || {}
        if (String(d.source) === String(meId)) return

        if (d.type === 'START') {
          // ✅ INIT_GUARD: em multiplayer via Supabase, ignore START via BroadcastChannel
          // (BC é apenas para abas na mesma máquina; em rede, o snapshot do servidor é a autoridade)
          if (net?.enabled) {
            console.log('[INIT_GUARD] init skipped: net enabled (BC START ignored)')
            return
          }
          if (hydratedFromNetRef.current) {
            console.log('[INIT_GUARD] init skipped: hydratedFromNet=true (BC START ignored)')
            return
          }
          // ✅ OBJ 1: nunca pular StartScreen automaticamente
          if (phase === 'start') {
            console.log('[INIT_GUARD] init skipped: phase=start (BC START ignored)')
            return
          }
          let incomingBoardVersion
          try {
            incomingBoardVersion = resolveBoardVersion(d.boardVersion)
          } catch (error) {
            console.error('[BOARD_VERSION] BC START rejeitado:', error)
            return
          }
          const mapped = Array.isArray(d.players) ? d.players.map(applyStarterKit) : []
          if (!mapped.length) return

          // ✅ CORREÇÃO: Normaliza players antes de usar
          const normalized = normalizePlayers(mapped)

          // adota UID real se PlayersLobby tiver setado
          try {
            const wuid = (window.__MY_UID || window.__myUid || window.__playerId) || null
            if (wuid) setMyUid(String(wuid))
          } catch {}

          setPlayers(normalized, { source: 'BC_START' })
          setBoardVersion(incomingBoardVersion)
          boardVersionRef.current = incomingBoardVersion
          setTurnIdx(0)
          // ✅ CORREÇÃO: Define turnPlayerId no start (fonte autoritativa)
          const firstPlayerId = normalized[0]?.id ? String(normalized[0].id) : null
          setTurnPlayerId(firstPlayerId)
          setRound(1)
          setRoundFlags(new Array(Math.max(1, normalized.length)).fill(false))
          setGameOver(false); setWinner(null)
          setTurnLock(false)
          setLockOwner(null)
          hydratedFromNetRef.current = false
          lastAppliedNetVersionRef.current = 0
          lastAppliedStateIdRef.current = null
          if (Object.prototype.hasOwnProperty.call(d, 'maxRounds')) {
            setMaxRounds(normalizeMaxRounds(d.maxRounds))
          } else {
            setMaxRounds(DEFAULT_MAX_ROUNDS)
          }
          if (Object.prototype.hasOwnProperty.call(d, 'turnTimeSec')) {
            setTurnTimeSec(normalizeTurnTime(d.turnTimeSec))
          } else {
            setTurnTimeSec(DEFAULT_TURN_TIME_SEC)
          }
          const startDeadline = computeTurnDeadlineAt(Date.now(), turnTimeSecRef.current)
          setTurnDeadlineAt(startDeadline)
          setTurnSeq(0)
          setLastRollTurnKey(null)
          setLastRollUI(null)
          setIsRollingUI(false)
          clearRollingTimeout()
          setLog(['Jogo iniciado!'])
          return
        }

        if (d.type === 'TURNLOCK') {
          setTurnLock(!!d.value)
          // ✅ Invariante: turnLock=true deve ter owner
          if (d.value) {
            if (d.owner) setLockOwner(String(d.owner))
          } else {
            setLockOwner(null)
          }
          return
        }

        if (d.type === 'SYNC' && phase === 'game') {
          // ✅ CORREÇÃO: Se netState estiver ativo, ignora SYNC do BroadcastChannel
          // O Supabase (netState) é a fonte autoritativa para multiplayer em rede
          if (net?.enabled) {
            console.log('[App] SYNC ignorado - net enabled, usando Supabase como autoridade única')
            return
          }

          let incomingBoardVersion
          try {
            incomingBoardVersion = resolveBoardVersion(d.boardVersion)
          } catch (error) {
            console.error('[BOARD_VERSION] BC SYNC rejeitado:', error)
            return
          }
          if (!haveCompatibleBoardVersions(boardVersionRef.current, incomingBoardVersion)) {
            console.error('[BOARD_VERSION] BC SYNC rejeitado: versões diferentes na mesma partida', {
              local: boardVersionRef.current,
              incoming: incomingBoardVersion,
            })
            return
          }
          
          const remoteVersion = Number(d.version || 0)
          const remoteTimestamp = Number(d.timestamp || 0)
          const localVersion = lastAcceptedVersionRef.current
          
          console.log('[App] SYNC recebido - versão remota:', remoteVersion, 'versão local:', localVersion, 'turnIdx:', d.turnIdx, 'round:', d.round, 'source:', d.source)
          console.log('[App] SYNC - meu turnIdx atual:', turnIdx, 'meu myUid:', myUid)
          
          // ✅ MELHORIA: Rejeita estados com versão menor que a última aceita (fora de ordem)
          if (remoteVersion > 0 && localVersion > 0 && remoteVersion < localVersion) {
            console.log('[App] SYNC - ❌ REJEITANDO estado remoto - versão antiga:', remoteVersion, '< versão local:', localVersion)
            return
          }
          
          // ✅ CORREÇÃO: Sincroniza turnIdx e round, mas protege mudanças locais recentes
          const now = Date.now()
          const lastLocal = lastLocalStateRef.current
          
          // ✅ MELHORIA: Atualiza versão aceita se a remota for maior
          if (remoteVersion > localVersion) {
            lastAcceptedVersionRef.current = remoteVersion
            console.log('[App] SYNC - ✅ Aceitando versão remota:', remoteVersion, '> versão local:', localVersion)
          }
          
          // ✅ CORREÇÃO MULTIPLAYER: BroadcastChannel SYNC é para mesma máquina (abas)
          // Em multiplayer via Supabase, o netState é a autoridade
          // Aqui aplicamos turnIdx/turnPlayerId do BroadcastChannel apenas se não houver netState ativo
          // REMOVIDO: todas as heurísticas de rejeição baseadas em timestamp local (< 5s)
          if (d.turnIdx !== turnIdx && (!net?.enabled)) {
            // ✅ CORREÇÃO: Aplica turnPlayerId se disponível (fonte autoritativa)
            if (d.turnPlayerId !== undefined && d.turnPlayerId !== null) {
              setTurnPlayerId(d.turnPlayerId)
              // Deriva turnIdx de turnPlayerId
              const normalized = normalizePlayers(d.players || players)
              const derivedTurnIdx = normalized.findIndex(p => String(p.id) === String(d.turnPlayerId))
              if (derivedTurnIdx >= 0) {
                setTurnIdx(derivedTurnIdx)
                console.log('[App] SYNC (BC) - turnIdx derivado de turnPlayerId:', derivedTurnIdx, 'turnPlayerId:', d.turnPlayerId)
              }
            } else if (d.turnIdx >= 0 && d.turnIdx < (d.players?.length || players.length)) {
              // Fallback: usa turnIdx se turnPlayerId não disponível
              setTurnIdx(d.turnIdx)
              console.log('[App] SYNC (BC) - Sincronizando turnIdx', { local: turnIdx, remote: d.turnIdx })
            }
          }
          
          // ✅ CORREÇÃO: Sincroniza roundFlags se presente na mensagem
          if (Array.isArray(d.roundFlags) && d.roundFlags.length > 0) {
            setRoundFlags(prevFlags => {
              // Faz merge: preserva flags locais e aceita flags remotas (OR lógico)
              const merged = d.roundFlags.map((remoteFlag, idx) => {
                const localFlag = prevFlags[idx] || false
                return localFlag || remoteFlag // Se qualquer um passou, marca como true
              })
              // Garante que o array tem o tamanho correto
              while (merged.length < prevFlags.length) {
                merged.push(prevFlags[merged.length] || false)
              }
              console.log('[App] SYNC - roundFlags sincronizado:', merged.map((f, i) => `${players[i]?.name}:${f}`).join(', '))
              return merged
            })
          }
          
          // ✅ CORREÇÃO: Sincroniza round usando Math.max para proteger incrementos locais
          // ✅ PROTEÇÃO: Clamp para garantir que nunca exiba round > maxRounds da partida
          if (d.round !== round) {
            const limit = maxRoundsRef.current
            const incoming = clampRound(d.round, limit)
            if (lastLocal && (now - lastLocal.timestamp) < 3000) {
              const localRoundChanged = lastLocal.round !== round
              if (localRoundChanged) {
                // Se a rodada local mudou recentemente, usa Math.max para proteger o incremento
                setRound(prevRound => {
                  const finalRound = Math.min(limit, Math.max(prevRound, incoming))
                  if (finalRound > prevRound) {
                    console.log('[App] SYNC round aplicado (clamp): local=', prevRound, 'remote=', incoming, 'final=', finalRound)
                  }
                  return finalRound
                })
              } else {
                setRound(incoming)
              }
            } else {
              // Sempre usa Math.max para proteger contra reversão
              setRound(prevRound => {
                const finalRound = Math.min(limit, Math.max(prevRound, incoming))
                console.log('[App] SYNC round aplicado (clamp): local=', prevRound, 'remote=', incoming, 'final=', finalRound)
                return finalRound
              })
            }
          }
          
          // ✅ Se gameOver, força round para maxRounds da partida para estabilizar HUD
          if (d.gameOver === true || d.winner) {
            setRound(maxRoundsRef.current)
          }

          if (Object.prototype.hasOwnProperty.call(d, 'maxRounds')) {
            setMaxRounds(normalizeMaxRounds(d.maxRounds))
          }
          if (Object.prototype.hasOwnProperty.call(d, 'turnTimeSec')) {
            setTurnTimeSec(normalizeTurnTime(d.turnTimeSec))
          }
          if (Object.prototype.hasOwnProperty.call(d, 'turnDeadlineAt')) {
            const dln = Number(d.turnDeadlineAt)
            if (Number.isFinite(dln)) setTurnDeadlineAt(dln)
          }
          
          // ✅ CORREÇÃO: Merge inteligente - preserva propriedades locais do jogador local
          // IMPORTANTE: Sempre aceita propriedades críticas do estado sincronizado (pos, bankrupt, etc)
          const currentPlayers = players
          const syncedPlayers = d.players.map(syncedPlayer => {
            const localPlayer = currentPlayers.find(p => p.id === syncedPlayer.id)
            if (!localPlayer) return syncedPlayer
            
            // ✅ CORREÇÃO: Estado autoritativo vence - aceita posição do snapshot recebido
            // Para jogo de turno, não fazemos merge heurístico de posição (evita desync)
            const isLocalPlayer = String(syncedPlayer.id) === String(myUid)
            
            if (isLocalPlayer) {
              // Compara recursos para detectar se há compras locais
              const localClients = Number(localPlayer.clients || 0)
              const remoteClients = Number(syncedPlayer.clients || 0)
              const localVendedores = Number(localPlayer.vendedoresComuns || 0)
              const remoteVendedores = Number(syncedPlayer.vendedoresComuns || 0)
              const localFieldSales = Number(localPlayer.fieldSales || 0)
              const remoteFieldSales = Number(syncedPlayer.fieldSales || 0)
              const localInsideSales = Number(localPlayer.insideSales || 0)
              const remoteInsideSales = Number(syncedPlayer.insideSales || 0)
              
              // ✅ CORREÇÃO: Se o local tem mais recursos que o remoto, preserva estado local completo
              // (indica que o local fez compras que o remoto ainda não conhece)
              const hasLocalPurchases = localClients > remoteClients || 
                                       localVendedores > remoteVendedores ||
                                       localFieldSales > remoteFieldSales ||
                                       localInsideSales > remoteInsideSales ||
                                       (localPlayer.mixProdutos && localPlayer.mixProdutos !== syncedPlayer.mixProdutos && localPlayer.mixProdutos !== 'D') ||
                                       (localPlayer.erpLevel && localPlayer.erpLevel !== syncedPlayer.erpLevel && localPlayer.erpLevel !== 'D')
              
              if (hasLocalPurchases) {
                console.log('[App] SYNC - Detectadas compras locais, preservando estado local completo', {
                  localClients, remoteClients, localVendedores, remoteVendedores
                })

                const loanStateChanged = !isSameValue(localPlayer.loanPending, syncedPlayer.loanPending)
                
                return {
                  ...localPlayer,
                  pos: syncedPlayer.pos,
                  bankrupt: syncedPlayer.bankrupt ?? localPlayer.bankrupt,
                  loanTakenInMatch: !!syncedPlayer.loanTakenInMatch,

                  ...(loanStateChanged
                    ? {
                        cash: Number(syncedPlayer.cash || 0),
                        loanPending: syncedPlayer.loanPending ?? null,
                      }
                    : {}),

                  az: localPlayer.az || syncedPlayer.az || 0,
                  am: localPlayer.am || syncedPlayer.am || 0,
                  rox: localPlayer.rox || syncedPlayer.rox || 0,
                  trainingsByVendor: localPlayer.trainingsByVendor || syncedPlayer.trainingsByVendor || {},
                  onboarding: localPlayer.onboarding || syncedPlayer.onboarding || false
                }
              }
              
              // Se não há compras locais, aceita snapshot remoto COMO AUTORITATIVO.
              // ⚠️ Nunca usar Math.max em cash/recursos aqui, senão multas/pagamentos "voltam" em testes com múltiplas abas.
              return {
                ...syncedPlayer, // Aceita estado sincronizado autoritativo (pos, bankrupt, etc)
                // Recursos autoritativos (do snapshot recebido)
                cash: Number(syncedPlayer.cash || 0),
                clients: remoteClients,
                mixProdutos: syncedPlayer.mixProdutos,
                erpLevel: syncedPlayer.erpLevel,
                vendedoresComuns: remoteVendedores,
                fieldSales: remoteFieldSales,
                insideSales: remoteInsideSales,
                gestores: Number(syncedPlayer.gestores ?? syncedPlayer.gestoresComerciais ?? syncedPlayer.managers ?? 0),
                gestoresComerciais: Number(syncedPlayer.gestoresComerciais ?? syncedPlayer.gestores ?? syncedPlayer.managers ?? 0),
                managers: Number(syncedPlayer.managers ?? syncedPlayer.gestores ?? syncedPlayer.gestoresComerciais ?? 0),
                bens: Number(syncedPlayer.bens || 0),
                manutencao: syncedPlayer.manutencao,
                loanPending: syncedPlayer.loanPending,
                loanTakenInMatch: !!syncedPlayer.loanTakenInMatch,
                // Preserva dados de progresso local
                az: localPlayer.az || syncedPlayer.az || 0,
                am: localPlayer.am || syncedPlayer.am || 0,
                rox: localPlayer.rox || syncedPlayer.rox || 0,
                trainingsByVendor: localPlayer.trainingsByVendor || syncedPlayer.trainingsByVendor || {},
                onboarding: localPlayer.onboarding || syncedPlayer.onboarding || false
              }
            }
            
            // Para outros jogadores, aceita o snapshot autoritativo mas preserva certificados locais (caso existam)
            return {
              ...syncedPlayer, // Aceita estado sincronizado autoritativo
              az: localPlayer.az || syncedPlayer.az || 0,
              am: localPlayer.am || syncedPlayer.am || 0,
              rox: localPlayer.rox || syncedPlayer.rox || 0,
              trainingsByVendor: localPlayer.trainingsByVendor || syncedPlayer.trainingsByVendor || {},
              onboarding: localPlayer.onboarding || syncedPlayer.onboarding || false
            }
          })
          // ✅ BUG 2 FIX: Usa merge monotônico para evitar reset de cash/assets
          // A lógica de merge já foi aplicada acima em syncedPlayers, então usa diretamente
          setPlayers(syncedPlayers, { source: 'BC_SYNC' })
          
          console.log('[App] SYNC aplicado - novo turnIdx:', d.turnIdx)
          console.log('[App] SYNC - jogador da vez:', syncedPlayers[d.turnIdx]?.name, 'id:', syncedPlayers[d.turnIdx]?.id)
          console.log('[App] SYNC - é minha vez?', String(syncedPlayers[d.turnIdx]?.id) === String(myUid))
          
          // Sincroniza estado do jogo (gameOver e winner)
          // ✅ Monotônico: gameOver nunca volta para false
          setGameOver(prev => prev || !!d.gameOver);
          
          // ✅ Monotônico: winner nunca some depois que gameOver=true
          setWinner(prev => {
            const willBeGameOver = (gameOver || d.gameOver);
            if (willBeGameOver && prev && (!d.winner)) return prev;
            return d.winner ?? prev;
          });
          
          // ✅ Log obrigatório
          if (d.gameOver === true) {
            console.log(`[App] [ENDGAME] estado remoto aplicado: gameOver=true winner=${d.winner?.name ?? d.winner ?? "N/A"}`);
          }

          // lastRoll passivo (somente UI) — mesmo canal BC quando net está desativado
          if (Object.prototype.hasOwnProperty.call(d, 'lastRoll')) {
            if (d.lastRoll === null) {
              setLastRollUI(null)
            } else {
              applyLastRollUI(d.lastRoll)
            }
          }
        }
      }
      bcRef.current = bc
      return () => bc.close()
    } catch (e) {
      console.warn('[App] BroadcastChannel init failed:', e)
    }
  }, [syncKey, meId, phase])

  // ====== Gerenciamento de saída de salas
  // NÃO remove assento em pagehide/beforeunload (Android dispara pagehide ao trocar de app).
  // Em `game`: presença/heartbeat + TTL cuidam de órfãos.
  // Em lobby: saída explícita (botão) chama leaveLobby/leaveRoom.
  // Mantemos o efeito vazio documentado para não reintroduzir o bug.

  const setTurnLockBroadcast = (value, owner = undefined) => {
    const v = !!value
    const nextOwner =
      v
        ? String(owner ?? myUid ?? turnPlayerId ?? '')
        : null

    // ✅ Invariante: turnLock=true nunca deve coexistir com lockOwner null/''.
    setTurnLock(v)
    if (v) {
      if (nextOwner) setLockOwner(nextOwner)
    } else {
      setLockOwner(null)
    }

    // ✅ Propaga para abas (mesma máquina)
    defer(() => {
      try {
        bcRef.current?.postMessage?.({ type: 'TURNLOCK', value: v, owner: nextOwner, ts: Date.now(), source: meId })
      } catch {}
    })

    // ✅ Propaga para Supabase (estado compartilhado) — sem depender de turnIdx
    defer(() => {
      try {
        if (net?.enabled && net?.ready && typeof netCommit === 'function') {
          const expectTurnId = String(turnPlayerIdRef.current ?? turnPlayerId ?? '')
          const expectTurnSeq = Number(turnSeqRef.current ?? turnSeq ?? 0)
          commitGamePatch({
            playersDeltaById: {},
            statePatch: {
              kind: 'LOCK',
              turnLock: v,
              lockOwner: nextOwner,
              lockTs: Date.now(),
              _expectTurnPlayerId: expectTurnId,
              _expectTurnSeq: expectTurnSeq,
              _expectLockOwner: v ? nextOwner : (lockOwnerRef.current ?? lockOwner ?? null),
              _commitKind: v ? 'LOCK_ACQUIRE' : 'LOCK_RELEASE',
            }
          })
        }
      } catch {}
    })
  }

  // ====== multiplayer em rede (opcional) via provider
  // ✅ CORREÇÃO: useGameNet deve ser chamado diretamente, sem try/catch (Rules of Hooks)
  const net = useGameNet()
  const netCommit = net?.commit
  const netVersion = net?.version
  const netState = net?.state
  const netStateId = net?.stateId

  // Handoff offline: sanitize local. Multiplayer: deadline autoritativo via snapshot/broadcastState.
  useEffect(() => {
    const prev = prevTurnIdentityRef.current
    const nextId = turnPlayerId != null ? String(turnPlayerId) : ''
    const nextSeq = Number(turnSeq) || 0
    prevTurnIdentityRef.current = { id: nextId, seq: nextSeq }
    if (net?.enabled) return

    const sanitized = sanitizeTurnDeadlineOnHandoff({
      prevTurnPlayerId: prev.id,
      nextTurnPlayerId: nextId,
      prevTurnSeq: prev.seq,
      nextTurnSeq: nextSeq,
      currentDeadlineAt: turnDeadlineAtRef.current,
      now: Date.now(),
      turnTimeSec: turnTimeSecRef.current,
    })
    if (Number.isFinite(Number(sanitized)) && Number(sanitized) !== Number(turnDeadlineAtRef.current)) {
      setTurnDeadlineAt(Number(sanitized))
      turnDeadlineAtRef.current = Number(sanitized)
    }
  }, [turnPlayerId, turnSeq, net?.enabled])

  // ====== "é minha vez?" (ÚNICA fonte: turnPlayerId) ======
  const isMyTurn = useMemo(() => {
    const me = String(myUid || meId || "")
    if (!me) return false
    if (!turnPlayerId) return false
    const mePlayer = players.find(p => String(p.id) === me)
    if (mePlayer?.bankrupt) return false
    return String(turnPlayerId) === me
  }, [turnPlayerId, myUid, meId, players])

  // ✅ coerência: mantém turnIdx <-> turnPlayerId sincronizados (evita desync UI vs engine)
  useEffect(() => {
    if (!players?.length) return

    if (turnPlayerId) {
      const idx = players.findIndex(p => String(p.id) === String(turnPlayerId))
      if (idx >= 0 && idx !== turnIdx) {
        setTurnIdx(idx)
      }
    } else {
      // ✅ Sem turnPlayerId: não inventa em multiplayer. Em local, pode usar fallback.
      // ✅ OBRIGATÓRIO: fallback SOMENTE offline/local (net.enabled === false).
      if (!net?.enabled) {
        const fallback = players[turnIdx]?.id || players[0]?.id
        if (fallback) setTurnPlayerId(String(fallback))
      }
    }
  }, [players, turnPlayerId, turnIdx])
  
  // ✅ CORREÇÃO: Ref para rastrear quando uma mudança local foi feita recentemente
  const localChangeRef = React.useRef(null)
  const lastLocalStateRef = React.useRef(null)
  
  // ✅ MELHORIA: Versionamento sequencial para garantir ordem de sincronização
  const stateVersionRef = React.useRef(0)
  const lastAcceptedVersionRef = React.useRef(0)
  
  // ✅ CORREÇÃO: Ref para garantir monotonicidade do estado remoto aplicado
  const lastAppliedNetVersionRef = React.useRef(0)
  const lastAppliedStateIdRef = React.useRef(null)
  
  // ✅ CORREÇÃO: Refs para rastrear baseline local antes de mudanças (para merge 3-way)
  const playersBeforeRef = React.useRef(null)
  
  // ✅ CORREÇÃO MULTIPLAYER: Helper para commitar patch/delta (não snapshot completo)
  // Permite fazer merge por ID sem sobrescrever estado completo
  const commitGamePatch = React.useCallback(({ playersDeltaById = {}, statePatch = {} }) => {
    const expectTurnId = statePatch?._expectTurnPlayerId
    const expectTurnSeq = statePatch?._expectTurnSeq
    const commitKind = inferCommitKind(statePatch)
    const isSkipAttempt = commitKind === 'AUTO_PASS' || commitKind === 'AUTO_SKIP_OFFLINE'

    // Sem net: avanço local já aplicado — confirma guard imediatamente.
    if (typeof netCommit !== 'function') {
      if (isSkipAttempt) {
        confirmSharedSkipKey(expectTurnId, expectTurnSeq)
      }
      return Promise.resolve({ ok: true })
    }
    
    // Calcula versionamento e timestamp
    stateVersionRef.current = stateVersionRef.current + 1
    const currentVersion = stateVersionRef.current
    const now = Date.now()
    
    return new Promise((resolve) => {
    defer(async () => {
      let casLost = false
      let commitResult = null
      try {
        commitResult = await netCommit(prev => {
          const prevState = prev || {}
          const localBoardVersion = resolveBoardVersion(boardVersionRef.current)
          const hasRemoteMatch = Array.isArray(prevState.players) && prevState.players.length > 0
          if (
            hasRemoteMatch &&
            !haveCompatibleBoardVersions(prevState.boardVersion, localBoardVersion)
          ) {
            casLost = true
            if (isSkipAttempt) releaseSharedSkipKey(expectTurnId, expectTurnSeq)
            console.error('[BOARD_VERSION] patch bloqueado: sala usa outro mapa', {
              local: localBoardVersion,
              remote: resolveBoardVersion(prevState.boardVersion),
            })
            return prevState
          }

        // Guard de commit: revalida snapshot remoto (auto-pass / handoff / LOCK).
        const commitValidation = validateTurnCommit(prevState, statePatch, { now })
        if (!commitValidation.ok) {
          casLost = true
          if (isSkipAttempt) {
            releaseSharedSkipKey(expectTurnId, expectTurnSeq)
          }
          if (isDevVerbose()) {
            console.log('[commit] rejected:', commitValidation.reason, commitValidation)
          }
          return prevState
        }
        
        // ✅ CORREÇÃO 1: Garantir versão monotônica no commit remoto
        const localStateVersion = currentVersion
        const remoteStateVersion = prevState.stateVersion ?? 0
        const safeVersion = Math.max(localStateVersion, remoteStateVersion) + 1
        
        // ✅ CORREÇÃO CRÍTICA: nunca deixe o patch "encolher" players para 1 só jogador.
        // Em commits iniciais, prevState.players pode vir vazio/stale (antes do primeiro snapshot).
        // Então usamos um seed robusto vindo de refs locais (lastLocalStateRef / playersBeforeRef).
        const seedPlayersRaw =
          (Array.isArray(prevState.players) && prevState.players.length > 0)
            ? prevState.players
            : (Array.isArray(lastLocalStateRef.current?.players) && lastLocalStateRef.current.players.length > 0)
              ? lastLocalStateRef.current.players
              : (Array.isArray(playersBeforeRef.current) && playersBeforeRef.current.length > 0)
                ? playersBeforeRef.current
                : []

        const prevPlayers = normalizePlayers(seedPlayersRaw)

        // Filtra deltas já aplicados (idempotência) ANTES do merge
        const filteredDeltaById = {}
        for (const [id, delta] of Object.entries(playersDeltaById || {})) {
          const playerId = String(id)
          const actionId = delta?._actionId || statePatch?.actionId || null
          const existing = prevPlayers.find((p) => String(p?.id) === playerId)
          if (actionId && existing?.lastActions && existing.lastActions[actionId]) {
            if (DEBUG_LOGS) console.warn('[IDEMPOTENCY] ignorando delta já aplicado', { playerId, actionId })
            continue
          }
          filteredDeltaById[playerId] = delta
        }

        // Merge parcial: cash undefined/null NÃO substitui; outros campos só se presentes
        let mergedPlayers = normalizePlayers(
          mergePlayersById(prevPlayers, filteredDeltaById, { createMissing: true })
        )

        // Registra actionIds aplicados
        for (const [id, delta] of Object.entries(filteredDeltaById)) {
          const playerId = String(id)
          const actionId = delta?._actionId || statePatch?.actionId || null
          if (!actionId) continue
          const idx = mergedPlayers.findIndex((p) => String(p?.id) === playerId)
          if (idx < 0) continue
          const existing = mergedPlayers[idx]
          const lastActions =
            existing.lastActions && typeof existing.lastActions === 'object'
              ? { ...existing.lastActions }
              : {}
          lastActions[actionId] = now
          const keys = Object.keys(lastActions)
          if (keys.length > 50) {
            keys
              .sort((a, b) => Number(lastActions[a] || 0) - Number(lastActions[b] || 0))
              .slice(0, keys.length - 50)
              .forEach((k) => {
                try { delete lastActions[k] } catch {}
              })
          }
          mergedPlayers[idx] = applyStarterKit({
            ...existing,
            lastActions,
          })
        }

        // Baseline = roster commitado (evita reenviar cash stale em patches seguintes)
        try {
          playersBeforeRef.current = JSON.parse(JSON.stringify(mergedPlayers))
        } catch {
          playersBeforeRef.current = mergedPlayers
        }
        
        // Prepara statePatch completo (inclui versionamento monotônico)
        const {
          _expectTurnPlayerId: _dropExpectId,
          _expectTurnSeq: _dropExpectSeq,
          _expectLockOwner: _dropExpectLockOwner,
          _commitKind: _dropCommitKind,
          ...publicStatePatch
        } = statePatch || {}
        const finalStatePatch = {
          ...stripCommitMeta(statePatch),
          boardVersion: localBoardVersion,
          stateVersion: safeVersion, // ✅ CORREÇÃO: Versão monotônica garantida
          updatedAt: now,
          updatedBy: myUid
        }
        
        // Se players foram modificados, inclui no patch
        if (Object.keys(playersDeltaById).length > 0) {
          finalStatePatch.players = mergedPlayers
        }
        
        // Merge do statePatch sobre o estado anterior
        const next = {
          ...prevState,
          ...finalStatePatch
        }
        // ✅ TURNO: turnIdx não é mais persistido no estado compartilhado
        try { delete next.turnIdx } catch {}
        
        // Garante que players sempre está normalizado
        if (next.players) {
          next.players = normalizePlayers(next.players)
        }
        
          if (DEBUG_LOGS) console.log('[NET] ✅ commitGamePatch - tipo:', statePatch.turnPlayerId ? 'TURN' : statePatch.round ? 'ROUND' : 'PLAYER_DELTA', 
            'playersDeltaIds:', Object.keys(playersDeltaById).join(','),
            'statePatchKeys:', Object.keys(statePatch).join(','),
            'stateVersion:', safeVersion, '(local:', localStateVersion, 'remote:', remoteStateVersion, ')')
        
          return next
        })

        const guardAction = resolveSkipGuardAction(statePatch, {
          casLost,
          commitOk: !!commitResult?.ok,
        })
        if (guardAction.action === 'release') {
          releaseSharedSkipKey(expectTurnId, expectTurnSeq)
          if (isDevVerbose()) {
            console.log('[auto-skip] CAS/commit failed — skip key released')
          }
        } else if (guardAction.action === 'confirm') {
          confirmSharedSkipKey(expectTurnId, expectTurnSeq)
          if (isDevVerbose()) console.log('[auto-skip] CAS confirmed')
        }
        resolve({ ok: !casLost && !!commitResult?.ok })
      } catch (e) {
        const failAction = resolveSkipGuardAction(statePatch, { casLost: true, commitOk: false })
        if (failAction.action === 'release') releaseSharedSkipKey(expectTurnId, expectTurnSeq)
        console.warn('[NET] commitGamePatch failed:', e?.message || e)
        resolve({ ok: false })
      }
    })
    })
  }, [netCommit, myUid, DEBUG_LOGS])
  
  // ✅ CORREÇÃO: O baseline é capturado no broadcastState antes de fazer commit
  // Não precisamos capturar via useEffect, pois o baseline deve ser o estado ANTES da mudança
  
  // Rastreia mudanças locais
  // ✅ CORREÇÃO: Atualiza lastLocalStateRef quando turnIdx, round ou players mudam
  // Mas só atualiza o timestamp se realmente mudou E se não foi atualizado recentemente pelo broadcastState
  React.useEffect(() => {
    const current = lastLocalStateRef.current
    const turnIdxChanged = !current || current.turnIdx !== turnIdx
    const roundChanged = !current || current.round !== round
    const playersChanged = !current || current.players !== players
    
    // Só atualiza timestamp se realmente mudou algo crítico
    // E só atualiza se não foi atualizado muito recentemente (< 100ms) pelo broadcastState
    if (turnIdxChanged || roundChanged || playersChanged) {
      const now = Date.now()
      const timeSinceLastUpdate = current ? (now - current.timestamp) : Infinity
      
      // Se foi atualizado muito recentemente pelo broadcastState, não sobrescreve
      if (timeSinceLastUpdate > 100) {
        // ✅ FIX: não sobrescreve o ref com um "shape" menor (isso apagava stateVersion/turnPlayerId/winner etc.)
        lastLocalStateRef.current = {
          ...(current || {}),
          players,
          turnIdx,
          round,
          timestamp: now,
          // mantém stateVersion consistente caso ainda não exista no ref
          stateVersion: (current?.stateVersion ?? stateVersionRef.current ?? 0),
        }
        if (turnIdxChanged && DEBUG_LOGS) {
          console.log('[App] lastLocalStateRef atualizado via useEffect - turnIdx mudou:', current?.turnIdx, '->', turnIdx)
        }
      } else {
        // Atualiza apenas os valores, mantém o timestamp do broadcastState
        lastLocalStateRef.current = { 
          ...lastLocalStateRef.current, 
          players, 
          turnIdx, 
          round 
        }
      }
    }
  }, [players, turnIdx, round])

  // Hidratação autoritativa de rooms.state → estado local (única implementação).
  const applyRemoteNetState = React.useCallback((incomingNetState, incomingNetVersion, incomingNetStateId) => {
    if (!incomingNetState) return false

    const np = Array.isArray(incomingNetState.players) ? incomingNetState.players : null
    const nr = Number.isInteger(incomingNetState.round) ? incomingNetState.round : null

    const incomingTurnId =
      (incomingNetState.turnPlayerId !== undefined && incomingNetState.turnPlayerId !== null && String(incomingNetState.turnPlayerId) !== '')
        ? String(incomingNetState.turnPlayerId)
        : null

    // stateId/actionId muda a cada commit e é um ótimo “dedupe” mesmo se version resetar
    let incomingStateId = null
    try {
      const raw = incomingNetState?.stateId ?? incomingNetState?.actionId ?? incomingNetStateId ?? null
      incomingStateId = (raw === null || raw === undefined) ? null : String(raw)
    } catch {}

    const versionIsNumber = (typeof incomingNetVersion === 'number')

    const isStartState = isAuthoritativeStartState(incomingNetState)

    let incomingBoardVersion
    try {
      incomingBoardVersion = resolveBoardVersion(incomingNetState.boardVersion)
    } catch (error) {
      console.error('[BOARD_VERSION] snapshot rejeitado:', error)
      return false
    }
    if (
      hydratedFromNetRef.current &&
      !isStartState &&
      !haveCompatibleBoardVersions(boardVersionRef.current, incomingBoardVersion)
    ) {
      console.error('[BOARD_VERSION] snapshot rejeitado: versões diferentes na mesma partida', {
        local: boardVersionRef.current,
        incoming: incomingBoardVersion,
      })
      return false
    }

    const lastAppliedVer = Number(lastAppliedNetVersionRef.current) || 0
    const gate = shouldApplyIncomingState({
      isStart: isStartState,
      incomingVersion: versionIsNumber ? incomingNetVersion : undefined,
      lastAppliedVersion: lastAppliedVer,
      incomingStateId,
      lastAppliedStateId: lastAppliedStateIdRef.current,
    })

    if (!gate.apply) return false

    setBoardVersion(incomingBoardVersion)
    boardVersionRef.current = incomingBoardVersion

    // marca aplicado (não exige monotonicidade estrita; nunca rebaixa version/stateId por snapshot mais antigo)
    if (versionIsNumber) {
      lastAppliedNetVersionRef.current = Math.max(lastAppliedVer, incomingNetVersion)
    }
    if (!(versionIsNumber && incomingNetVersion < lastAppliedVer)) {
      if (incomingStateId) lastAppliedStateIdRef.current = incomingStateId
      else if (isStartState && versionIsNumber) lastAppliedStateIdRef.current = `START:${incomingNetVersion}`
    }

    // --- aplica turno (turnPlayerId é a fonte de verdade) ---
    if (incomingTurnId && String(turnPlayerId || '') !== incomingTurnId) {
      setTurnPlayerId(incomingTurnId)
    }

    // --- aplica players (merge seguro; [] não apaga; parcial não zera ausentes) ---
    if (np) {
      const localRoster =
        (Array.isArray(playersBeforeRef.current) && playersBeforeRef.current.length > 0)
          ? playersBeforeRef.current
          : (Array.isArray(players) ? players : [])

      const plan = planRosterApply({
        incomingPlayers: np,
        currentPlayers: localRoster,
        hydrated: hydratedFromNetRef.current,
        isStart: isStartState,
      })

      if (plan.action === 'skip') {
        if (DEBUG_LOGS) {
          console.warn('[NET] ignorando snapshot de players:', plan.reason, {
            version: incomingNetVersion,
            stateId: incomingStateId,
            localCount: localRoster?.length ?? 0,
            hydrated: hydratedFromNetRef.current,
          })
        }
      } else {
        const normalizedPlayers = normalizePlayers(plan.players)
        setPlayers(normalizedPlayers, { source: 'SNAPSHOT' })
        try {
          playersBeforeRef.current = JSON.parse(JSON.stringify(normalizedPlayers))
        } catch {
          playersBeforeRef.current = normalizedPlayers
        }

        // turnIdx derivado do turnPlayerId (nunca do remoto)
        if (incomingTurnId) {
          const derivedTurnIdx = normalizedPlayers.findIndex(p => String(p.id) === String(incomingTurnId))
          if (derivedTurnIdx >= 0 && derivedTurnIdx !== turnIdx) {
            setTurnIdx(derivedTurnIdx)
          }
        }

        // Rebind canônico: matchIdentity → myUid (nunca inventa player)
        try {
          const roomKey = currentLobbyId || roomId
          const persisted = roomKey ? getMatchIdentity(roomKey) : null
          const seat = resolveSeatIdentity({
            identityPlayerId: persisted?.playerId,
            roster: normalizedPlayers,
            currentMyUid: myUid || meId,
          })
          if (seat.ok && seat.myUid) {
            setIdentityMismatch(false)
            if (String(myUid || '') !== String(seat.myUid)) {
              setMyUid(String(seat.myUid))
            }
            if (roomKey && seat.player) {
              setMatchIdentity(roomKey, {
                playerId: String(seat.myUid),
                playerName: String(seat.player.name || myName || ''),
              })
            }
            // Presença canônica imediata após rebind/hydrate (recreate se row ausente)
            const presenceLobby = currentLobbyId || roomKey
            if (presenceLobby) {
              touchLobbyPlayer({
                lobbyId: String(presenceLobby),
                playerId: String(seat.myUid),
                allowRecreateIfSeated: true,
              }).catch(() => {})
            }
          } else if (seat.reason === 'identity-not-in-roster') {
            setIdentityMismatch(true)
            if (DEBUG_LOGS) {
              console.warn('[NET] identidade da sala não está no roster — reentrada necessária', {
                wantId: seat.wantId,
              })
            }
          } else {
            setIdentityMismatch(false)
          }
        } catch {}
      }
    }
    // --- round ---
    if (nr !== null) {
      const limit = Object.prototype.hasOwnProperty.call(incomingNetState, 'maxRounds')
        ? normalizeMaxRounds(incomingNetState.maxRounds)
        : maxRoundsRef.current
      const safeNr = clampRound(nr, limit)
      setRound(prev => {
        const finalRound = (isStartState ? 1 : Math.min(limit, Math.max(prev, safeNr)))
        return finalRound
      })
    }
    if (incomingNetState.gameOver === true || incomingNetState.winner) {
      const limit = Object.prototype.hasOwnProperty.call(incomingNetState, 'maxRounds')
        ? normalizeMaxRounds(incomingNetState.maxRounds)
        : maxRoundsRef.current
      setRound(limit)
    }

    if (Object.prototype.hasOwnProperty.call(incomingNetState, 'maxRounds')) {
      setMaxRounds(normalizeMaxRounds(incomingNetState.maxRounds))
    } else if (isStartState) {
      // Partida antiga completa sem o campo: fallback 5
      setMaxRounds(DEFAULT_MAX_ROUNDS)
    }

    if (Object.prototype.hasOwnProperty.call(incomingNetState, 'turnTimeSec')) {
      setTurnTimeSec(normalizeTurnTime(incomingNetState.turnTimeSec))
    } else if (isStartState) {
      setTurnTimeSec(DEFAULT_TURN_TIME_SEC)
    }

    if (Object.prototype.hasOwnProperty.call(incomingNetState, 'turnDeadlineAt')) {
      const d = Number(incomingNetState.turnDeadlineAt)
      if (Number.isFinite(d)) setTurnDeadlineAt(d)
      else if (incomingNetState.turnDeadlineAt == null) setTurnDeadlineAt(null)
    } else if (isStartState) {
      setTurnDeadlineAt(
        computeTurnDeadlineAt(
          Date.now(),
          Object.prototype.hasOwnProperty.call(incomingNetState, 'turnTimeSec')
            ? normalizeTurnTime(incomingNetState.turnTimeSec)
            : turnTimeSecRef.current
        )
      )
    }

    // --- roundFlags ---
    if (incomingNetState.roundFlags !== undefined) {
      if (Array.isArray(incomingNetState.roundFlags)) setRoundFlags(incomingNetState.roundFlags)
      else if (typeof incomingNetState.roundFlags === 'object' && incomingNetState.roundFlags) setRoundFlags(Object.values(incomingNetState.roundFlags))
    }

    // --- LOCKS (estado compartilhado) ---
    if (typeof incomingNetState.turnLock !== 'undefined') setTurnLock(!!incomingNetState.turnLock)
    if (typeof incomingNetState.lockOwner !== 'undefined') setLockOwner(incomingNetState.lockOwner ? String(incomingNetState.lockOwner) : null)

    // ✅ INVARIANTE CRÍTICA:
    // Se chegar turnLock=true SEM lockOwner => isso trava TODOS (porque controlsCanRoll exige !turnLock).
    // Nesse caso, limpamos o lock localmente e tentamos limpar no Supabase 1 vez por stateId.
    const corruptLock = (incomingNetState.turnLock === true) && (!incomingNetState.lockOwner || String(incomingNetState.lockOwner) === '')
    if (corruptLock) {
      const fixKey = incomingStateId || (versionIsNumber ? `v:${incomingNetVersion}` : 'noid')
      if (fixedCorruptLockRef.current !== fixKey) {
        fixedCorruptLockRef.current = fixKey
        console.warn('[NET] turnLock=true sem lockOwner; limpando lock (anti-trava).', { fixKey })
        setTurnLock(false)
        setLockOwner(null)
        try { commitRemoteState({ turnLock: false, lockOwner: null }) } catch {}
      }
    } else {
      fixedCorruptLockRef.current = null
    }

    lastNetApplyAtRef.current = Date.now()

    // --- START reset explícito ---
    if (isStartState) {
      setGameOver(false)
      setWinner(null)
      setTurnLock(false)
      setLockOwner(null)
      setLastRollTurnKey(null)
      setTurnSeq(0)
      setLastRollUI(null)
      setIsRollingUI(false)
      setShowBankruptOverlay(false)
      clearRollingTimeout()
      hydratedFromNetRef.current = false
      lastAppliedNetVersionRef.current = 0
      lastAppliedStateIdRef.current = null
      lastLocalStateRef.current = null
      playersBeforeRef.current = null
    } else {
      setGameOver(prev => prev || !!incomingNetState.gameOver)
      setWinner(prev => {
        const willBeGameOver = (!!incomingNetState.gameOver || !!incomingNetState.winner)
        if (willBeGameOver && prev && (!incomingNetState.winner)) return prev
        return incomingNetState.winner ?? prev
      })
    }

    // --- anti-double-roll autoritativo ---
    if (incomingNetState.lastRollTurnKey !== undefined) setLastRollTurnKey(incomingNetState.lastRollTurnKey ? String(incomingNetState.lastRollTurnKey) : null)
    if (typeof incomingNetState.turnSeq === 'number') setTurnSeq(incomingNetState.turnSeq)

    // --- última rolagem do dado (passivo; somente UI) ---
    if (Object.prototype.hasOwnProperty.call(incomingNetState, 'lastRoll')) {
      if (incomingNetState.lastRoll === null) {
        setLastRollUI(null)
      } else {
        applyLastRollUI(incomingNetState.lastRoll)
      }
    }

    // init guard
    try {
      const hasPlayers = Array.isArray(incomingNetState.players) && incomingNetState.players.length > 0
      const hasTurn = incomingNetState.turnPlayerId !== undefined && incomingNetState.turnPlayerId !== null && String(incomingNetState.turnPlayerId) !== ''
      if (hasPlayers && hasTurn) hydratedFromNetRef.current = true
    } catch {}

    return true
  }, [turnPlayerId, turnIdx, setPlayers, applyLastRollUI, clearRollingTimeout, DEBUG_LOGS, currentLobbyId, roomId, myUid, meId, myName])

  useEffect(() => {
    if (!net?.enabled || !net?.ready) return
    if (!netState) return
    applyRemoteNetState(netState, netVersion, netStateId)
  }, [netVersion, netState, netStateId, net?.enabled, net?.ready, applyRemoteNetState, resumeHydrateNonce])

  // ✅ BUG 2 FIX: Watchdog anti-trava - libera turnLock se travado por muito tempo
  useEffect(() => {
    if (!turnLock) {
      lockSinceRef.current = null
      return
    }

    // Inicializa lockSinceRef quando turnLock vira true
    if (!lockSinceRef.current) {
      lockSinceRef.current = Date.now()
    }

    const checkInterval = setInterval(() => {
      const now = Date.now()
      const lockAge = lockSinceRef.current ? (now - lockSinceRef.current) : 0
      const currentPlayer = players[turnIdx]
      const isCurrentPlayerMe = currentPlayer && String(currentPlayer.id) === String(myUid)
      const isMyTurnCheck = isMyTurn && isCurrentPlayerMe
      const isLockOwnerMe = lockOwner === myUid
      const shouldSteal = lockAge > 8000 && isMyTurnCheck && !isLockOwnerMe && lockOwner != null

      if (shouldSteal) {
        console.warn('[LOCK-WATCHDOG] stole lock - turnLock travado por', lockAge, 'ms, liberando...', {
          isMyTurn: isMyTurnCheck,
          lockOwner,
          myUid
        })
        // Tenta "steal lock" via commit/broadcast
        commitRemoteState({ turnLock: false, lockOwner: myUid })
        setTurnLockBroadcast(false)
        setLockOwner(myUid)
        lockSinceRef.current = null
      }
    }, 1000)

    return () => clearInterval(checkInterval)
  }, [turnLock, isMyTurn, turnIdx, players, lockOwner, myUid, netCommit])

  async function commitRemoteState(nextStatePartial) {
    if (typeof netCommit === 'function') {
      try {
        await netCommit(prev => {
          const prevState = prev || {}
          const nextPartial = nextStatePartial || {}
          const nextBoardVersion = resolveBoardVersion(
            nextPartial.boardVersion ?? boardVersionRef.current
          )
          const hasRemoteMatch = Array.isArray(prevState.players) && prevState.players.length > 0
          if (
            nextPartial.kind !== 'START' &&
            hasRemoteMatch &&
            !haveCompatibleBoardVersions(prevState.boardVersion, nextBoardVersion)
          ) {
            console.error('[BOARD_VERSION] commit bloqueado: sala usa outro mapa', {
              local: nextBoardVersion,
              remote: resolveBoardVersion(prevState.boardVersion),
            })
            return prevState
          }
          
          // ✅ CORREÇÃO: Merge 3-way para players (evita sobrescrever com snapshot stale)
          if (nextPartial.players && Array.isArray(nextPartial.players)) {
            const baseline = playersBeforeRef.current || prevState.players || []
            const prevPlayers = prevState.players || []
            const nextPlayers = nextPartial.players
            
            // Cria mapas por ID para facilitar lookup
            const baselineMap = new Map(baseline.map(p => [String(p?.id), p]))
            const prevMap = new Map(prevPlayers.map(p => [String(p?.id), p]))
            const nextMap = new Map(nextPlayers.map(p => [String(p?.id), p]))
            
            // Merge 3-way: para cada playerId
            const mergedPlayers = []
            const allPlayerIds = new Set([
              ...baselineMap.keys(),
              ...prevMap.keys(),
              ...nextMap.keys()
            ])
            
            for (const playerId of allPlayerIds) {
              const baselinePlayer = baselineMap.get(playerId)
              const prevPlayer = prevMap.get(playerId)
              const nextPlayer = nextMap.get(playerId)
              
              // Se o player mudou do baseline para nextPlayers => aplicar nextPlayer (mudança local)
              const changedFromBaseline = !!(baselinePlayer && nextPlayer && didPlayerChange(baselinePlayer, nextPlayer))
              
              if (changedFromBaseline && nextPlayer) {
                // Mudança local: aplicar nextPlayer
                mergedPlayers.push(applyStarterKit(nextPlayer))
              } else if (prevPlayer) {
                // Não mudou localmente: manter o que está no servidor (prevPlayer)
                mergedPlayers.push(applyStarterKit(prevPlayer))
              } else if (nextPlayer) {
                // Novo player: aplicar nextPlayer
                mergedPlayers.push(applyStarterKit(nextPlayer))
              }
            }
            
            // Ordena por ordem original (preserva índices)
            const orderedPlayers = []
            const nextOrder = nextPlayers.map(p => String(p?.id))
            for (const playerId of nextOrder) {
              const found = mergedPlayers.find(p => String(p?.id) === playerId)
              if (found) orderedPlayers.push(found)
            }
            // Adiciona players que não estavam em nextPlayers
            for (const player of mergedPlayers) {
              if (!nextOrder.includes(String(player?.id))) {
                orderedPlayers.push(player)
              }
            }
            
            // Limpa baseline após merge
            playersBeforeRef.current = null
            
            // ✅ CORREÇÃO 1: Garantir versão monotônica no commit remoto
            const localStateVersion = nextPartial.stateVersion ?? 0
            const remoteStateVersion = prevState.stateVersion ?? 0
            const safeVersion = Math.max(localStateVersion, remoteStateVersion)
            stateVersionRef.current = Math.max(stateVersionRef.current || 0, safeVersion)
            
            const next = {
              ...prevState,
              ...nextPartial,
              boardVersion: nextBoardVersion,
              players: orderedPlayers.length > 0 ? orderedPlayers : nextPlayers,
              stateVersion: safeVersion // ✅ CORREÇÃO: Versão monotônica garantida
            }
            // ✅ TURNO: turnIdx não é mais persistido
            try { delete next.turnIdx } catch {}
            return next
          }
          
          // ✅ CORREÇÃO 1: Garantir versão monotônica no commit remoto
          const localStateVersion = nextPartial.stateVersion ?? 0
          const remoteStateVersion = prevState.stateVersion ?? 0
          const safeVersion = Math.max(localStateVersion, remoteStateVersion)
          stateVersionRef.current = Math.max(stateVersionRef.current || 0, safeVersion)
          
          // Para outros campos, merge simples com versão monotônica
          const next = {
            ...prevState,
            ...nextPartial,
            boardVersion: nextBoardVersion,
            stateVersion: safeVersion // ✅ CORREÇÃO: Versão monotônica garantida
          }
          // ✅ TURNO: turnIdx não é mais persistido
          try { delete next.turnIdx } catch {}
          return next
        })
      } catch (e) {
        console.warn('[NET] commit failed:', e?.message || e)
        // Limpa baseline em caso de erro
        playersBeforeRef.current = null
      }
    }
  }

  function broadcastState(nextPlayers, nextTurnIdx, nextRound, gameOverState = gameOver, winnerState = winner, patch = {}) {
    // Baseline para diff: último roster commitado (ou estado atual se ainda não houver)
    const baselineSnapshot = (
      Array.isArray(playersBeforeRef.current) && playersBeforeRef.current.length > 0
        ? playersBeforeRef.current
        : (Array.isArray(players) ? players : [])
    )
    if (!playersBeforeRef.current || playersBeforeRef.current.length === 0) {
      try {
        playersBeforeRef.current = JSON.parse(JSON.stringify(baselineSnapshot))
      } catch {
        playersBeforeRef.current = baselineSnapshot
      }
    }
    
    // ✅ MELHORIA: Incrementa versão sequencial
    stateVersionRef.current = stateVersionRef.current + 1
    const currentVersion = stateVersionRef.current
    const safeBoardVersion = resolveBoardVersion(
      patch.boardVersion ?? boardVersionRef.current
    )
    
    // ✅ CORREÇÃO: Usa patch para obter valores atualizados (evita stale closure)
    const nextRoundFlags = patch.roundFlags !== undefined ? patch.roundFlags : roundFlags
    // lock fields podem existir no patch (e são persistidos quando kind='LOCK')
    const nextTurnLock = patch.turnLock !== undefined ? patch.turnLock : turnLock
    const lastKnownLockOwner = lastLocalStateRef.current?.lockOwner ?? null
    const nextLockOwner = patch.lockOwner !== undefined ? patch.lockOwner : lastKnownLockOwner
    // ✅ CORREÇÃO CRÍTICA: gameOver/winner só vêm do patch explícito, não de estado antigo
    // Em START, patch.gameOver deve ser false explicitamente
    // Em patches comuns (PLAYER_DELTA/ROLL), nunca incluir gameOver/winner
    const patchedGameOver = patch.gameOver !== undefined ? patch.gameOver : (patch.isStartGame ? false : gameOverState)
    const finalGameOver = patch.isStartGame ? false : (!!patchedGameOver)

    const patchedWinner = patch.winner !== undefined ? patch.winner : (patch.isStartGame ? null : winnerState)
    const finalWinner = finalGameOver ? patchedWinner : null

    // ✅ FIX CRÍTICO: round monotônico (nunca deixa broadcast rebaixar rodada)
    // - nextRound pode vir stale (closures em modais/compras)
    // - lastLocalStateRef.current.round geralmente já tem o maior round local
    // ✅ CORREÇÃO: Em START, sempre usa round=1 explicitamente (ignora estado antigo)
    const patchedRound = patch.round !== undefined ? patch.round : nextRound
    const safeRound = patch.isStartGame 
      ? 1  // ✅ START sempre com round=1
      : clampRound(Math.max(
          Number(patchedRound || 1),
          Number(round || 1),
          Number(lastLocalStateRef.current?.round || 1)
        ), maxRoundsRef.current)

    const safeMaxRounds = Object.prototype.hasOwnProperty.call(patch, 'maxRounds')
      ? normalizeMaxRounds(patch.maxRounds)
      : normalizeMaxRounds(maxRoundsRef.current)

    const safeTurnTimeSec = Object.prototype.hasOwnProperty.call(patch, 'turnTimeSec')
      ? normalizeTurnTime(patch.turnTimeSec)
      : normalizeTurnTime(turnTimeSecRef.current)
    
    // ✅ CORREÇÃO: Normaliza players antes de broadcast
    const normalizedPlayers = normalizePlayers(nextPlayers)
    
    // ✅ TURNO: turnPlayerId é a ÚNICA fonte de verdade.
    // - TURN: patch.turnPlayerId deve vir explícito
    // - PLAYER_DELTA: nunca mexe em turnPlayerId
    const nextTurnPlayerId =
      (patch.turnPlayerId !== undefined && patch.turnPlayerId !== null)
        ? String(patch.turnPlayerId)
        : String(turnPlayerId || '')

    // ✅ CORREÇÃO 3: Nunca aceitar turnPlayerId mais antigo (proteção monotônica)
    // Aceita mudança de turnPlayerId apenas se:
    // 1. É explícita no patch (mudança de turno intencional)
    // 2. Round mudou (nova rodada = novo turno válido)
    // 3. É uma mudança de turno dentro da mesma rodada (normal)
    // NUNCA aceita rollback (voltar para turnPlayerId anterior)
    const safeTurnPlayerId = (() => {
      if (!nextTurnPlayerId) return turnPlayerId
      if (nextTurnPlayerId === turnPlayerId) return turnPlayerId
      
      // Se é mudança explícita no patch, aceita (mudança de turno intencional)
      if (patch.turnPlayerId !== undefined) {
        return nextTurnPlayerId
      }
      
      // Se round mudou, aceita (nova rodada = novo turno válido)
      if (safeRound !== round) {
        return nextTurnPlayerId
      }
      
      // Se é mudança de turno dentro da mesma rodada, aceita (normal)
      // (não é rollback se está avançando para próximo jogador)
      return nextTurnPlayerId
    })()
    
    // ✅ PATCH KIND: separa atualização de turno (TURN) de atualização de players (PLAYER_DELTA)
    const patchKind =
      patch.kind ||
      (patch.turnPlayerId !== undefined ? 'TURN' : 'PLAYER_DELTA')

    const shouldDeferLocal =
      patch.deferLocalUntilCommit === true
      && net?.enabled
      && typeof netCommit === 'function'
      && patchKind !== 'START'
      && !patch.isStartGame

    // Deadline autoritativo: novo turno / START gera novo deadline; demais patches preservam.
    const turnIdentityChanged = !!(
      patch.isStartGame ||
      patchKind === 'TURN' ||
      (patch.turnPlayerId !== undefined && String(patch.turnPlayerId) !== String(turnPlayerId)) ||
      (patch.turnSeq !== undefined && Number(patch.turnSeq) !== Number(turnSeq))
    )
    let nextTurnDeadlineAt = turnDeadlineAtRef.current
    if (patch.turnDeadlineAt !== undefined) {
      nextTurnDeadlineAt = patch.turnDeadlineAt == null ? null : Number(patch.turnDeadlineAt)
    } else if (patchKind === 'ENDGAME' || finalGameOver) {
      nextTurnDeadlineAt = null
    } else if (turnIdentityChanged) {
      nextTurnDeadlineAt = computeTurnDeadlineAt(Date.now(), safeTurnTimeSec)
    }
    if (Number.isFinite(Number(nextTurnDeadlineAt))) {
      if (!shouldDeferLocal) {
        setTurnDeadlineAt(Number(nextTurnDeadlineAt))
        turnDeadlineAtRef.current = Number(nextTurnDeadlineAt)
      }
    } else if (nextTurnDeadlineAt == null && (patchKind === 'ENDGAME' || finalGameOver)) {
      if (!shouldDeferLocal) {
        setTurnDeadlineAt(null)
        turnDeadlineAtRef.current = null
      }
    }

    // ✅ actionId (idempotência): gera se não vier do chamador
    const mkId = () => {
      try {
        if (typeof crypto !== 'undefined' && crypto.randomUUID) return crypto.randomUUID()
      } catch {}
      return `${String(myUid || 'anon')}-${Date.now()}-${Math.random().toString(16).slice(2)}`
    }
    const stateId = String(patch.stateId || mkId())
    const actionId = String(patch.actionId || `${String(myUid || 'anon')}-${Date.now()}-${currentVersion}`)

    // ✅ CORREÇÃO: Atualiza lastLocalStateRef imediatamente antes de fazer broadcast
    // Isso protege contra estados remotos que chegam logo após a mudança local
    const now = Date.now()
    const derivedTurnIdxForLocal = nextTurnPlayerId
      ? normalizedPlayers.findIndex(p => String(p.id) === String(nextTurnPlayerId))
      : nextTurnIdx

    const emissionSnapshot = captureTurnEmissionSnapshot({
      turnPlayerId: turnPlayerIdRef.current ?? turnPlayerId,
      turnSeq: turnSeqRef.current ?? turnSeq,
      turnLock: turnLockRef.current ?? turnLock,
      lockOwner: lockOwnerRef.current ?? lockOwner,
      lastRollTurnKey: lastRollTurnKeyRef.current ?? lastRollTurnKey,
    })

    const readCurrentTurnSnapshot = () => ({
      turnPlayerId: turnPlayerIdRef.current ?? turnPlayerId,
      turnSeq: turnSeqRef.current ?? turnSeq,
      turnLock: turnLockRef.current ?? turnLock,
      lockOwner: lockOwnerRef.current ?? lockOwner,
      lastRollTurnKey: lastRollTurnKeyRef.current ?? lastRollTurnKey,
    })

    const applyOptimisticLocal = () => {
      if (nextTurnPlayerId !== undefined && nextTurnPlayerId !== null) {
        const nextIdStr = String(nextTurnPlayerId)
        if (String(turnPlayerId || '') !== nextIdStr) setTurnPlayerId(nextIdStr)
      }
      if (Number.isFinite(Number(nextTurnDeadlineAt))) {
        setTurnDeadlineAt(Number(nextTurnDeadlineAt))
        turnDeadlineAtRef.current = Number(nextTurnDeadlineAt)
      } else if (nextTurnDeadlineAt == null && (patchKind === 'ENDGAME' || finalGameOver)) {
        setTurnDeadlineAt(null)
        turnDeadlineAtRef.current = null
      }
      if (patch.turnSeq !== undefined) {
        const seq = Number(patch.turnSeq)
        setTurnSeq(seq)
        turnSeqRef.current = seq
      }
      if (patch.turnLock !== undefined) {
        const locked = !!patch.turnLock
        setTurnLock(locked)
        const owner = patch.lockOwner !== undefined ? patch.lockOwner : null
        setLockOwner(owner)
        lockOwnerRef.current = owner
      }
      if (derivedTurnIdxForLocal >= 0) setTurnIdx(derivedTurnIdxForLocal)
      if (patch.round !== undefined || safeRound !== round) {
        setRound(safeRound)
        maxRoundsRef.current = safeMaxRounds
      }
      lastLocalStateRef.current = {
        players: normalizedPlayers,
        boardVersion: safeBoardVersion,
        turnIdx: derivedTurnIdxForLocal,
        turnPlayerId: safeTurnPlayerId,
        round: safeRound,
        gameOver: finalGameOver,
        winner: finalWinner,
        lockOwner: nextLockOwner,
        timestamp: now,
        version: currentVersion,
        stateVersion: currentVersion,
        updatedAt: now,
        updatedBy: myUid,
      }
      lastAcceptedVersionRef.current = currentVersion
    }

    if (!shouldDeferLocal) {
      applyOptimisticLocal()
    }

    const postBcSync = () => {
      defer(() => {
        try {
          const syncPayload = {
            type: 'SYNC',
            boardVersion: safeBoardVersion,
            version: currentVersion,
            players: normalizedPlayers,
            round: safeRound,
            maxRounds: safeMaxRounds,
            roundFlags: nextRoundFlags,
            turnLock: nextTurnLock,
            lockOwner: nextLockOwner,
            gameOver: finalGameOver,
            winner: finalWinner,
            source: meId,
            timestamp: now,
          }
          if (patch && patch.lastRoll !== undefined) {
            syncPayload.lastRoll =
              patch.lastRoll === null
                ? null
                : normalizeLastRoll(patch.lastRoll)
          }
          bcRef.current?.postMessage?.(syncPayload)
        } catch (e) { console.warn('[App] broadcastState failed:', e) }
      })
    }
    
    // ✅ CORREÇÃO MULTIPLAYER: Detectar se é START GAME (snapshot completo) ou ação parcial (delta)
    // ✅ CORREÇÃO: Verifica explicitamente patch.isStartGame primeiro (não depende de safeRound que pode vir de estado antigo)
    const isStartGame = patch.isStartGame === true || (
      patch.isStartGame !== false &&
      safeRound === 1 && 
      nextTurnIdx === 0 && 
      normalizedPlayers.every(p => Number(p?.pos ?? 0) === 0) &&
      !gameOver &&  // ✅ Garante que não é um jogo antigo
      !winner       // ✅ Garante que não é um jogo antigo
    )
    
    let patchCommit = Promise.resolve()
    if (isStartGame) {
      // ✅ START GAME: Usa commitRemoteState com snapshot completo (única exceção permitida)
      console.log('[App] broadcastState (START) - versão:', currentVersion, 'turnPlayerId:', safeTurnPlayerId, 'round:', safeRound)
      commitRemoteState({
        players: normalizedPlayers,
        boardVersion: safeBoardVersion,
        turnPlayerId: safeTurnPlayerId,
        round: safeRound,
        maxRounds: safeMaxRounds,
        turnTimeSec: safeTurnTimeSec,
        turnDeadlineAt: nextTurnDeadlineAt,
        roundFlags: nextRoundFlags,
        turnSeq: 0,
        lastRollTurnKey: null,
        lastRoll: null,
        turnLock: false,
        lockOwner: null,
        stateId,
        actionId,
        kind: 'START',
        stateVersion: currentVersion,
        updatedAt: now,
        updatedBy: myUid
      })
    } else {
      // ✅ CORREÇÃO MULTIPLAYER: Ação parcial - usar commitGamePatch com delta
      // ✅ Delta sem JSON.stringify (hot-path): usa snapshot direto do player alterado quando houver `playerDeltaIds`
      // normalizedPlayers = players já normalizados
      const nextById = new Map(normalizedPlayers.map(p => [String(p.id), p]))
      let playersDeltaById = patch.playersDeltaById || {}

      if (
        Object.keys(playersDeltaById).length === 0 &&
        Array.isArray(patch.playerDeltaIds)
      ) {
        playersDeltaById = {}
        for (const pid of patch.playerDeltaIds) {
          const p = nextById.get(String(pid))
          const base = (Array.isArray(playersBeforeRef.current) ? playersBeforeRef.current : [])
            .find((x) => String(x?.id) === String(pid))
          if (p) {
            // Delta parcial (não reenvia o player inteiro)
            const built = buildPlayersDeltaById(base ? [base] : [], [p], actionId)
            if (built[String(pid)]) playersDeltaById[String(pid)] = built[String(pid)]
            else playersDeltaById[String(pid)] = { _actionId: actionId }
          }
        }
      }

      // Fallback: só campos que mudaram vs baseline (nunca full-player stale)
      if (Object.keys(playersDeltaById).length === 0) {
        const baselineArr = Array.isArray(playersBeforeRef.current) && playersBeforeRef.current.length > 0
          ? playersBeforeRef.current
          : (Array.isArray(players) ? players : [])
        playersDeltaById = buildPlayersDeltaById(baselineArr, normalizedPlayers, actionId)
      }

      // ✅ evita spam/dedup: se nada mudou e não há patch de estado, não commita/broadcast
      const hasPlayerDelta = Object.keys(playersDeltaById).length > 0
      const hasStateChange = patchKind === 'TURN' || patchKind === 'LOCK' || patch.round !== undefined || patch.roundFlags !== undefined || patch.gameOver !== undefined || patch.winner !== undefined
      if (!hasPlayerDelta && !hasStateChange) {
        if (DEBUG_LOGS) console.log('[App] broadcastState skipped (no-op)', { actionId, patchKind })
        return Promise.resolve()
      }
      
      // ✅ CORREÇÃO MULTIPLAYER: Usa commitGamePatch para fazer merge por delta
      // ✅ CORREÇÃO CRÍTICA: PLAYER_DELTA/ROLL nunca incluem gameOver/winner
      // Apenas ENDGAME (patchKind === 'ENDGAME') inclui gameOver/winner
      const statePatch = {
        kind: patchKind,
        boardVersion: safeBoardVersion,
        actionId,
        stateId,
        // ✅ REMOVIDO: gameOver/winner de patches comuns (vazava estado antigo)
        // ...(finalGameOver ? { gameOver: true, winner: finalWinner } : {}),
        ...(patchKind === 'TURN'
          ? {
              turnPlayerId: nextTurnPlayerId,
              round: safeRound,
              maxRounds: safeMaxRounds,
              turnTimeSec: safeTurnTimeSec,
              turnDeadlineAt: nextTurnDeadlineAt,
              roundFlags: nextRoundFlags,
              // ✅ TURN não inclui gameOver/winner (só ENDGAME)
            }
          : {}),
        ...(patchKind === 'ENDGAME'
          ? {
              gameOver: true,
              winner: finalWinner,
              round: safeRound,
              maxRounds: safeMaxRounds,
              turnTimeSec: safeTurnTimeSec,
              turnDeadlineAt: null,
            }
          : {}),
        ...(patchKind === 'LOCK'
          ? {
              turnLock: nextTurnLock,
              lockOwner: nextLockOwner,
              lockTs: Date.now(),
            }
          : {}),
      }
      // Auto-skip / TURN pode limpar lock no mesmo commit (sem depender só do patch LOCK)
      if (patch && patch.turnLock !== undefined) {
        statePatch.turnLock = !!patch.turnLock
        statePatch.lockOwner = patch.lockOwner !== undefined ? patch.lockOwner : null
      }
      if (patch && patch.lastRollTurnKey !== undefined) {
        statePatch.lastRollTurnKey = patch.lastRollTurnKey ? String(patch.lastRollTurnKey) : null
      }
      if (patch && patch.turnSeq !== undefined) {
        statePatch.turnSeq = Number(patch.turnSeq)
      }
      if (patch && patch._expectTurnPlayerId !== undefined) {
        statePatch._expectTurnPlayerId = patch._expectTurnPlayerId
      }
      if (patch && patch._expectTurnSeq !== undefined) {
        statePatch._expectTurnSeq = patch._expectTurnSeq
      }
      if (patch && patch._expectLockOwner !== undefined) {
        statePatch._expectLockOwner = patch._expectLockOwner
      }
      if (patch && patch._commitKind !== undefined) {
        statePatch._commitKind = patch._commitKind
      }
      if (patch && patch.lastRoll !== undefined) {
        statePatch.lastRoll =
          patch.lastRoll === null
            ? null
            : normalizeLastRoll(patch.lastRoll)
        // Espelho local imediato: a própria aba não recebe o SYNC do BroadcastChannel,
        // e commitGamePatch é no-op quando o net está desativado.
        if (statePatch.lastRoll === null) {
          setLastRollUI(null)
        } else if (statePatch.lastRoll) {
          applyLastRollUI(statePatch.lastRoll)
        }
      }
      patchCommit = commitGamePatch({
        playersDeltaById,
        statePatch
      })

      const updatePlayersBefore = () => {
        try {
          playersBeforeRef.current = JSON.parse(JSON.stringify(normalizedPlayers))
        } catch {
          playersBeforeRef.current = normalizedPlayers
        }
      }

      if (shouldDeferLocal) {
        patchCommit = Promise.resolve(patchCommit).then((r) => {
          if (r?.ok === false) return r
          const gate = shouldApplyDeferredLocalPatch({
            emission: emissionSnapshot,
            current: readCurrentTurnSnapshot(),
            patch,
          })
          if (!gate.apply) {
            if (DEBUG_LOGS) {
              console.log('[broadcastState] deferred apply skipped:', gate.reason)
            }
            return { ok: true, applied: false, reason: gate.reason }
          }
          applyOptimisticLocal()
          updatePlayersBefore()
          postBcSync()
          return { ok: true, applied: true, reason: 'applied' }
        })
      } else {
        updatePlayersBefore()
      }
      
      if (DEBUG_LOGS) console.log('[App] broadcastState (PATCH) - kind:', patchKind,
        'playersDeltaIds:', Object.keys(playersDeltaById).join(','), 
        'turnPlayerId:', safeTurnPlayerId, 'round:', safeRound)
    }
    if (!shouldDeferLocal) {
      postBcSync()
    }
    return patchCommit
  }

  function broadcastStart(nextPlayers, configuredMaxRounds = maxRoundsRef.current, configuredTurnTimeSec = turnTimeSecRef.current) {
    let normalized = normalizePlayers(nextPlayers)
    const startBoardVersion = getNewGameBoardVersion()
    setBoardVersion(startBoardVersion)
    boardVersionRef.current = startBoardVersion
    const startMaxRounds = normalizeMaxRounds(configuredMaxRounds)
    const startTurnTimeSec = normalizeTurnTime(configuredTurnTimeSec)

    // HOST (quem clicou iniciar) joga primeiro:
    const hostIdx = normalized.findIndex(p => String(p?.id) === String(myUid))
    if (hostIdx > 0) {
      normalized = [normalized[hostIdx], ...normalized.slice(0, hostIdx), ...normalized.slice(hostIdx + 1)]
    }

    const firstPlayerId = normalized[0]?.id ? String(normalized[0].id) : null
    
    // ✅ CORREÇÃO CRÍTICA: Reset explícito de refs antes de START
    lastLocalStateRef.current = null
    playersBeforeRef.current = null
    setTurnSeq(0)
    setLastRollTurnKey(null)
    setLastRollUI(null)
    setIsRollingUI(false)
    clearRollingTimeout()
    setMaxRounds(startMaxRounds)
    maxRoundsRef.current = startMaxRounds
    setTurnTimeSec(startTurnTimeSec)
    turnTimeSecRef.current = startTurnTimeSec
    const startDeadline = computeTurnDeadlineAt(Date.now(), startTurnTimeSec)
    setTurnDeadlineAt(startDeadline)
    turnDeadlineAtRef.current = startDeadline

    // rede
    broadcastState(normalized, 0, 1, false, null, {
      boardVersion: startBoardVersion,
      turnPlayerId: firstPlayerId,
      round: 1,
      maxRounds: startMaxRounds,
      turnTimeSec: startTurnTimeSec,
      turnDeadlineAt: startDeadline,
      gameOver: false,
      winner: null,
      roundFlags: Array(normalized.length).fill(false),
      turnSeq: 0,
      lastRollTurnKey: null,
      lastRoll: null,
      isStartGame: true
    })
    // entre abas
    defer(() => {
      try {
        bcRef.current?.postMessage?.({
          type: 'START',
          boardVersion: startBoardVersion,
          players: normalized,
          maxRounds: startMaxRounds,
          turnTimeSec: startTurnTimeSec,
          source: meId,
        })
      } catch (e) { console.warn('[App] broadcastStart failed:', e) }
    })
  }

  // ====== "é minha vez?" (declaração movida para antes do useEffect do watchdog)
  const current = useMemo(() => {
    if (turnPlayerId) {
      const found = players.find(p => String(p.id) === String(turnPlayerId))
      if (found) return found
    }
    return players[turnIdx]
  }, [players, turnPlayerId, turnIdx])

  // ====== Validação do estado do jogo (modo debug)
  useEffect(() => {
    if (phase === 'game') {
      if (DEBUG_VALIDATE) validateGameState(players, turnIdx, round, gameOver, winner, 'Game State Update')
      // Validação em tempo real adicional
      // ✅ CORREÇÃO: Validação apenas em DEV e se disponível
      if (DEBUG_VALIDATE && typeof window.__validateGameStateRealTime === 'function') {
        window.__validateGameStateRealTime(players, turnIdx, round, gameOver, winner, 'Real-time Validation')
      }
    }
  }, [players, turnIdx, round, gameOver, winner, phase, DEBUG_VALIDATE])

  // ====== HUD ao vivo (sem 1 render de atraso via useEffect)
  const meHudLive = useMemo(() => {
    const mine = players.find(isMine)
    if (!mine) return meHud
    const { cap, inAtt } = capacityAndAttendance(mine)
    return {
      ...meHud,
      name: mine.name ?? meHud.name,
      color: mine.color ?? meHud.color,
      cash: mine.cash ?? meHud.cash,
      possibAt: cap,
      clientsAt: inAtt,
    }
  }, [players, isMine, meHud])

  // ====== Totais do HUD (faturamento/ despesas / etc.)
  const me = useMemo(() => players.find(isMine) || players[0] || null, [players, isMine])
  const totals = useMemo(() => {
    if (!me) {
      return {
        faturamento: 0,
        manutencao: 0,
        emprestimos: 0,
        vendedoresComuns: 0,
        fieldSales: 0,
        insideSales: 0,
        mixProdutos: 'D',
        bens: 0,
        erpSistemas: 'D',
        clientes: 0,
        onboarding: false,
        az: 0,
        am: 0,
        rox: 0,
        gestores: 0,
        gestoresComerciais: 0,
        possibAt: 0,
        clientsAt: 0,
      }
    }
    const visibleLoanPending = getVisibleLoanPending(me)
    const fat = computeFaturamentoFor(me)
    const desp = computeDespesasFor(me)
    const { cap, inAtt } = capacityAndAttendance(me)
    const lvl = String(me.erpLevel || 'D').toUpperCase()
    const managerQty = Number(me.gestores ?? me.gestoresComerciais ?? me.managers ?? 0)
    
    if (DEBUG_LOGS) console.log('[App] Totals recalculado - me:', me.name, 'clients:', me.clients, 'faturamento:', fat, 'manutencao:', desp, 'vendedoresComuns:', me.vendedoresComuns, 'fieldSales:', me.fieldSales, 'insideSales:', me.insideSales)
    
    // Validação de cálculos em modo debug
    if (DEBUG_VALIDATE) validateCalculations(me, 'HUD Totals')
    
    return {
      faturamento: fat,
      manutencao: desp,
      emprestimos: visibleLoanPending ? Number(visibleLoanPending.amount || 0) : 0,
      vendedoresComuns: me.vendedoresComuns || 0,
      fieldSales: me.fieldSales || 0,
      insideSales: me.insideSales || 0,
      mixProdutos: me.mixProdutos || 'D',
      bens: me.bens ?? 0,
      erpSistemas: lvl,
      clientes: me.clients || 0,
      onboarding: !!me.onboarding,
      az: me.az || 0, am: me.am || 0, rox: me.rox || 0,
      gestores: managerQty,
      gestoresComerciais: managerQty,
      possibAt: cap,
      clientsAt: inAtt,
    }
  }, [
    me?.id,
    me?.clients,
    me?.mixProdutos,
    me?.erpLevel,
    me?.vendedoresComuns,
    me?.fieldSales,
    me?.insideSales,
    me?.gestores,
    me?.gestoresComerciais,
    me?.managers,
    me?.bens,
    me?.onboarding,
    me?.az,
    me?.am,
    me?.rox,
    me?.loanPending?.amount,
    me?.loanPending?.charged,
    DEBUG_LOGS,
    DEBUG_VALIDATE,
  ])

  // ====== overlay “falido” (mostra quando eu declaro falência)
  const [showBankruptOverlay, setShowBankruptOverlay] = useState(false)

  // ====== tutorial "Como jogar" — auto-open 1× por partida ao entrar no tabuleiro
  const [tutorialOpen, setTutorialOpen] = useState(false)
  const tutorialAutoOpenedRef = useRef('')
  // Dica progressiva (1× por tipo de casa / sessão) — só UI local
  const [progressiveTip, setProgressiveTip] = useState(null)
  const progressiveTipTimerRef = useRef(null)

  /** Limpa flags locais de partida (evita gameOver/turnLock grudados entre matches). */
  const resetMatchLocalUi = React.useCallback(() => {
    setGameOver(false)
    setWinner(null)
    setTurnLock(false)
    setLockOwner(null)
    setTurnSeq(0)
    setDiceFx(null)
    setShowBankruptOverlay(false)
    setTutorialOpen(false)
    tutorialAutoOpenedRef.current = ''
    hydratedFromNetRef.current = false
    lastAppliedNetVersionRef.current = 0
    lastAppliedStateIdRef.current = null
    lastLocalStateRef.current = null
    playersBeforeRef.current = null
  }, [])

  // Não depender da referência de `players` (sync contínuo cancelava o timeout)
  const gameRosterReady =
    phase === 'game' && Array.isArray(players) && players.length > 0
  const tutorialMatchKey = String(currentLobbyId || '')

  useEffect(() => {
    if (!gameRosterReady || !tutorialMatchKey) return undefined

    if (!shouldAutoOpenTutorial(tutorialMatchKey)) {
      console.log('[tutorial] skip auto-open — já fechado nesta partida', tutorialMatchKey)
      return undefined
    }
    if (tutorialAutoOpenedRef.current === tutorialMatchKey) {
      console.log('[tutorial] skip auto-open — já disparado nesta montagem', tutorialMatchKey)
      return undefined
    }

    const t = window.setTimeout(() => {
      if (!shouldAutoOpenTutorial(tutorialMatchKey)) {
        console.log('[tutorial] skip auto-open no timeout — sessão marcada', tutorialMatchKey)
        return
      }
      tutorialAutoOpenedRef.current = tutorialMatchKey
      console.log('[tutorial] auto-open no tabuleiro', tutorialMatchKey)
      setTutorialOpen(true)
    }, 700)

    return () => window.clearTimeout(t)
  }, [gameRosterReady, tutorialMatchKey])

  // Saiu do tabuleiro → permite auto-open de novo na próxima partida
  useEffect(() => {
    if (phase === 'game') return undefined
    tutorialAutoOpenedRef.current = ''
    setTutorialOpen(false)
    return undefined
  }, [phase])

  const handleTileVisit = React.useCallback((kind) => {
    const tip = consumeTileTip(kind)
    if (!tip) return
    setProgressiveTip(tip)
    if (progressiveTipTimerRef.current) {
      clearTimeout(progressiveTipTimerRef.current)
    }
    progressiveTipTimerRef.current = setTimeout(() => {
      setProgressiveTip(null)
      progressiveTipTimerRef.current = null
    }, 9000)
  }, [])

  useEffect(() => () => {
    if (progressiveTipTimerRef.current) clearTimeout(progressiveTipTimerRef.current)
  }, [])

  // ✅ CORREÇÃO DESSYNC: Deriva turnOrder dos players (ordem determinística)
  const turnOrder = useMemo(() => {
    if (!players || players.length === 0) return []
    // Ordena por seat (se disponível), senão por id (determinístico)
    const sorted = [...players].sort((a, b) => {
      if (Number.isInteger(a.seat) && Number.isInteger(b.seat)) {
        return a.seat - b.seat
      }
      return String(a.id).localeCompare(String(b.id))
    })
    return sorted.map(p => String(p.id))
  }, [players])

  // ====== Hook do motor de turnos (centraliza TODA a lógica pesada)
  const {
    advanceAndMaybeLap,
    onAction,
    nextTurn,
    skipAbsentTurn,
    forfeitMatch,
    modalLocks,
  } = useTurnEngine({
    players, setPlayers,
    round, setRound,
    turnIdx, setTurnIdx,
    turnPlayerId, setTurnPlayerId,
    turnOrder,
    roundFlags, setRoundFlags,
    isMyTurn,
    isMine,
    myUid, meId,
    myCash,
    current,
    broadcastState,
    appendLog,
    turnLock,
    setTurnLockBroadcast,
    gameOver, setGameOver,
    winner, setWinner,
    setShowBankruptOverlay,
    lastRollTurnKey,
    setLastRollTurnKey,
    turnSeq,
    setTurnSeq,
    maxRounds,
    boardVersion,
    onTileVisit: handleTileVisit,
  })

  // Presença + auto-skip (Etapa 2) — só durante game multiplayer
  const [turnAbsenceStatus, setTurnAbsenceStatus] = useState(null)

  // Host visual durante game — fonte: lobbies.host_id (realtime de lobby já existente)
  // Declarado antes dos hooks de presença/timer (fallback de autoridade).
  const [lobbyHostId, setLobbyHostId] = useState(null)
  const [hostPromotedHint, setHostPromotedHint] = useState(false)
  const prevLobbyHostIdRef = useRef(null)

  useGamePresenceAutoSkip({
    enabled: phase === 'game' && !!net?.enabled && !!net?.ready,
    lobbyId: currentLobbyId,
    // Canônico: sem fallback para sg_tab_player_id/meId na presença do game
    myUid: myUid || null,
    lobbyHostId,
    players,
    turnPlayerId,
    turnSeq,
    gameOver,
    turnLock: turnLock || !!diceFx,
    attemptSkipTurn: skipAbsentTurn,
    onStatus: setTurnAbsenceStatus,
  })

  // Cronômetro autoritativo: presence-coordinator ou lobby-host-fallback; CAS compartilhado.
  // Bloqueia também enquanto o dado 3D ainda não aplicou o ROLL no motor.
  useTurnTimerAutoPass({
    enabled: phase === 'game' && !gameOver && (!!net?.enabled ? !!net?.ready : true),
    lobbyId: currentLobbyId,
    myUid: myUid || null,
    lobbyHostId,
    players,
    turnPlayerId,
    turnSeq,
    turnDeadlineAt,
    turnLock: turnLock || !!diceFx || diceInFlightRef.current,
    gameOver,
    turnTimeSec,
    attemptSkipTurn: skipAbsentTurn,
  })

  useEffect(() => {
    if (phase !== 'game' || !currentLobbyId) {
      setLobbyHostId(null)
      prevLobbyHostIdRef.current = null
      setHostPromotedHint(false)
      return
    }

    let cancelled = false
    const refreshHost = async () => {
      try {
        const lobby = await getLobby(currentLobbyId)
        if (cancelled) return
        const next = lobby?.host_id != null ? String(lobby.host_id) : null
        setLobbyHostId(next)
      } catch {}
    }

    refreshHost()
    const off = onLobbyRealtime(currentLobbyId, () => { refreshHost() })
    return () => {
      cancelled = true
      try { off?.() } catch {}
    }
  }, [phase, currentLobbyId])

  useEffect(() => {
    const next = lobbyHostId != null ? String(lobbyHostId) : null
    const prev = prevLobbyHostIdRef.current
    const me = String(myUid || meId || '')
    prevLobbyHostIdRef.current = next

    // Só mensagem quando o host_id muda PARA o jogador local (não no load inicial)
    if (prev != null && next != null && prev !== next && me && next === me) {
      setHostPromotedHint(true)
      const t = setTimeout(() => setHostPromotedHint(false), 4000)
      return () => clearTimeout(t)
    }
  }, [lobbyHostId, myUid, meId])

  const iAmLobbyHost =
    !!lobbyHostId &&
    !!myUid &&
    String(lobbyHostId) === String(myUid || meId)
  const lobbyHostPlayer = useMemo(() => {
    if (!lobbyHostId) return null
    return (players || []).find((p) => String(p?.id) === String(lobbyHostId)) || null
  }, [players, lobbyHostId])

  // ====== Jogo (derivações + logs) ======
  // ✅ IMPORTANT: Hooks (useEffect) NÃO podem ficar depois de returns condicionais por phase.
  // Mantemos estas derivações sempre declaradas para evitar React error #310.
  const currentPlayer = players[turnIdx]
  const isCurrentPlayerBankrupt = currentPlayer?.bankrupt === true
  const isWaitingRevenue = round === maxRounds && players[turnIdx]?.waitingAtRevenue
  const isMyTurnExact = (turnPlayerId != null && myUid != null) && (String(turnPlayerId) === String(myUid))
  const lockOwnerOk = turnLock ? (lockOwner != null && String(lockOwner) === String(myUid)) : true
  // ✅ Chave do turno por turnSeq (monotônico; funciona com 1–4 jogadores)
  const currentTurnKey =
    typeof turnSeq === 'number'
      ? String(turnSeq)
      : null
  const alreadyRolledThisTurn =
    !!currentTurnKey &&
    !!lastRollTurnKey &&
    String(lastRollTurnKey) === String(currentTurnKey)
  const controlsCanRoll =
    !gameOver &&
    turnPlayerId != null &&
    myUid != null &&
    String(turnPlayerId) === String(myUid) &&
    turnLock === false &&
    lockOwnerOk &&
    Number(modalLocks || 0) === 0 &&
    !alreadyRolledThisTurn &&
    !isCurrentPlayerBankrupt &&
    !isWaitingRevenue

  // ====== Faixa de próximo passo (somente exibição; não altera turno/ações)
  const nextStepHint = gameOver
    ? 'Partida encerrada — veja o resultado.'
    : hostPromotedHint
    ? 'Você agora é o Host da sala.'
    : turnAbsenceStatus === 'waiting'
    ? 'Jogador desconectado — aguardando reconexão...'
    : turnAbsenceStatus === 'skipped'
    ? 'Turno avançado: jogador desconectado.'
    : me?.bankrupt
    ? 'Você declarou falência — acompanhe o restante da partida.'
    : Number(modalLocks || 0) > 0
    ? 'Resolva a decisão aberta para concluir o turno.'
    : (isMyTurn && isWaitingRevenue)
    ? 'Aguarde na casa de faturamento para concluir esta etapa.'
    : (isMyTurn && controlsCanRoll)
    ? 'Sua vez: role o dado.'
    : current?.name
    ? `Aguarde a jogada de ${current.name}.`
    : 'Aguarde o próximo jogador.'
  const nextStepIsMyTurn = !gameOver && !me?.bankrupt && isMyTurn && controlsCanRoll && !turnAbsenceStatus && !hostPromotedHint

  const onControlsAction = (act) => {
    // Dado 3D é só visual. O motor aplica o ROLL na hora — senão o peão
    // não anda e o host pode passar a vez no meio da animação.
    if (act?.type === 'ROLL' && controlsCanRoll) {
      const steps = Number(act.steps)
      if (!Number.isInteger(steps) || steps < 1 || steps > 6) {
        onAction(act)
        return
      }
      if (diceInFlightRef.current || diceFxRef.current) {
        console.warn('[dice] ROLL ignorado — animação ainda em andamento')
        return
      }
      unlockDiceAudio().catch(() => {})
      diceInFlightRef.current = true
      setIsRollingUI(true)
      clearRollingTimeout()
      const localKey = `local:${currentTurnKey || turnSeq || Date.now()}`
      diceAnimatedKeysRef.current.add(localKey)
      if (currentTurnKey) diceAnimatedKeysRef.current.add(String(currentTurnKey))
      setTurnLockBroadcast(true, String(myUid))
      onAction(act)
      setDiceFx({
        id: localKey,
        steps,
        playerName: meHudLive?.name || meHud?.name || 'Jogador',
        pendingAction: null,
        expectedTurnPlayerId: String(turnPlayerId),
        expectedTurnSeq: Number(turnSeq) || 0,
      })
      return
    }
    onAction(act)
  }

  const handleDiceFxComplete = React.useCallback(() => {
    const fx = diceFxRef.current
    // Consome uma vez (StrictMode / double onComplete não reaplica ROLL)
    if (fx) {
      diceFxRef.current = null
    }
    const pending = fx?.pendingAction || null
    if (fx && fx.pendingAction) fx.pendingAction = null

    setDiceFx(null)
    diceInFlightRef.current = false

    const expectedId = fx?.expectedTurnPlayerId != null ? String(fx.expectedTurnPlayerId) : ''
    const expectedSeq = Number(fx?.expectedTurnSeq)
    const liveId = String(turnPlayerId || '')
    const liveSeq = Number(turnSeq) || 0
    const stillSameTurn =
      !!pending &&
      !!expectedId &&
      expectedId === liveId &&
      expectedId === String(myUid || '') &&
      (!Number.isFinite(expectedSeq) || expectedSeq === liveSeq)

    if (stillSameTurn) {
      try {
        onAction(pending)
      } catch (err) {
        console.error('[dice] falha ao aplicar ROLL após animação', err)
      }
    } else if (pending) {
      console.warn('[dice] ROLL descartado — turno mudou durante a animação', {
        expectedId,
        liveId,
        expectedSeq,
        liveSeq,
      })
    }
    clearRollingTimeout()
    rollingTimeoutRef.current = setTimeout(() => {
      setIsRollingUI(false)
      rollingTimeoutRef.current = null
    }, 200)
  }, [clearRollingTimeout, onAction, turnPlayerId, turnSeq, myUid])

  useEffect(() => {
    handleDiceFxCompleteRef.current = handleDiceFxComplete
  }, [handleDiceFxComplete])

  useEffect(() => {
    // log sempre, mas não interfere no fluxo; ajuda a diagnosticar turn/lock
    if (!DEBUG_LOGS) return
    console.log('[CAN_ROLL_CHECK]', {
      phase,
      myUid,
      turnPlayerId,
      isMyTurn: isMyTurnExact,
      turnLock,
      modalLocks,
      currentTurnKey,
      lastRollTurnKey,
      alreadyRolledThisTurn,
      gameOver,
      bankrupt: isCurrentPlayerBankrupt,
      result: controlsCanRoll,
    })
  }, [phase, myUid, turnPlayerId, isMyTurnExact, turnLock, modalLocks, currentTurnKey, lastRollTurnKey, alreadyRolledThisTurn, gameOver, isCurrentPlayerBankrupt, controlsCanRoll])

  // ====== fases ======

  // 1) Tela inicial: pega o nome e vai para Lobbies
  if (phase === 'start') {
    return (
      <ModalProvider>
        <StartScreen
          currentName={myName}
          onEnter={(typedName) => {
          const clean = String(typedName || '').trim()
          if (!clean) return
          // ✅ salva somente após ação explícita do usuário
          setTabPlayerName(clean)
          setMyName(clean)
          setPlayers([applyStarterKit({ id: meId, name: clean, cash: MANUAL_CONSTANTS.startCash, pos: 0, color: '#FFD600', bens: MANUAL_CONSTANTS.startBens })], { source: 'START' })
          setRound(1); setTurnIdx(0); setGameOver(false); setWinner(null)
          setRoundFlags(new Array(1).fill(false))
          setMeHud(h => ({ ...h, name: clean }))
          setLog([`Bem-vindo, ${clean}!`])

          // ✅ após confirmar nome: se há roomId (URL), entra direto nela; senão vai para lista de salas
          if (roomId) {
            const resolvedId = resolvePlayerIdForRoom(roomId, { playerName: clean })
            setMyUid(String(resolvedId))
            setCurrentLobbyId(roomId)
            window.__setRoomCode?.(roomId)
            setPhase('playersLobby')
          } else {
            setPhase('lobbies')
          }
        }}
        />
      </ModalProvider>
    )
  }

  // 2) Lista de lobbies
  if (phase === 'lobbies') {
    return (
      <ModalProvider>
        <LobbyList
          playerName={myName}
          onEnterRoom={(id) => {
          const resolvedId = resolvePlayerIdForRoom(id, { playerName: myName })
          setMyUid(String(resolvedId))
          setCurrentLobbyId(id)
          window.__setRoomCode?.(id)
          try {
            localStorage.setItem('sg:lastRoomName', String(id))
            const url = new URL(window.location.href)
            url.searchParams.set('room', String(id))
            history.replaceState(null, '', url.toString())
          } catch {}
          setPhase('playersLobby')
        }}
        />
      </ModalProvider>
    )
  }

  // 3) Lobby dos jogadores (aguarda e inicia)
  if (phase === 'playersLobby') {
    return (
      <ModalProvider>
        <PlayersLobby
          lobbyId={currentLobbyId || roomId}
          playerName={myName}
          onBack={() => {
          window.__setRoomCode?.(null)
          setPhase('lobbies')
        }}
          onStartGame={(payload) => {
          // nome/uuid da sala
          const roomName =
            payload?.lobbyName ||
            payload?.lobby?.name ||
            payload?.name ||
            payload?.lobbyId ||
            currentLobbyId ||
            'sala-demo'
          try {
            localStorage.setItem('sg:lastRoomName', String(roomName))
            const url = new URL(window.location.href)
            url.searchParams.set('room', String(roomName))
            history.replaceState(null, '', url.toString())
          } catch {}

          // Garante room code / lobby id para o GameNetProvider continuar inscrito em rooms.state
          if (payload?.lobbyId) {
            setCurrentLobbyId(String(payload.lobbyId))
            window.__setRoomCode?.(String(payload.lobbyId))
          }

          const resumeExistingMatch =
            !Array.isArray(payload) &&
            payload?.resumeExistingMatch === true

          if (resumeExistingMatch) {
            // Retomada: NÃO aplicar starter kit / NÃO broadcastStart.
            // Problema clássico: Provider JÁ tem snapshot da mesma room; limpar players
            // e esperar o effect não funciona porque netState/version/stateId não mudam.
            const roomKey = String(payload?.lobbyId || currentLobbyId || roomId || '')
            const resolvedId = resolvePlayerIdForRoom(roomKey, {
              playerName: myName || payload?.me?.name || '',
            })

            const resumeLog = (msg, extra) => {
              if (!import.meta.env.DEV) return
              try {
                if (extra === undefined) console.log(`[resume] ${msg}`)
                else console.log(`[resume] ${msg}`, extra)
              } catch {}
            }

            resumeLog('room requested', roomKey)
            resumeLog('identity found', !!resolvedId)

            resetMatchLocalUi()
            try { setMyUid(String(resolvedId)) } catch {}
            if (roomKey) {
              setCurrentLobbyId(roomKey)
              window.__setRoomCode?.(roomKey)
              setMatchIdentity(roomKey, {
                playerId: String(resolvedId),
                playerName: String(myName || payload?.me?.name || ''),
              })
              touchLobbyPlayer({
                lobbyId: roomKey,
                playerId: String(resolvedId),
                allowRecreateIfSeated: true,
              }).catch(() => {})
            }
            setPlayers([], { source: 'RESUME_EXISTING_WAIT' })
            setPhase('game')

            // Bootstrap determinístico: se o Provider já tem a MESMA room com roster válido
            // contendo o playerId persistido, aplica AGORA (não espera realtime).
            const snap = net?.state
            const snapPlayers = Array.isArray(snap?.players) ? snap.players : []
            const providerReady = !!(net?.enabled && net?.ready)
            const playerInSnap = snapPlayers.some((p) => String(p?.id) === String(resolvedId))
            const canApplyNow =
              providerReady &&
              !!roomKey &&
              snapPlayers.length > 0 &&
              playerInSnap &&
              (typeof net?.version === 'number' || net?.stateId != null || snap?.stateId != null)

            resumeLog('provider ready', providerReady)
            resumeLog('provider room matches', !!roomKey && providerReady)
            resumeLog('players count', snapPlayers.length)

            if (canApplyNow) {
              const applied = applyRemoteNetState(snap, net.version, net.stateId)
              resumeLog(applied ? 'snapshot apply' : 'snapshot skip', applied ? 'immediate' : 'gate')
            } else {
              resumeLog('snapshot apply', 'wait_effect')
            }

            // Garante reavaliação do effect mesmo se netState for referencialmente estável
            setResumeHydrateNonce((n) => n + 1)
            return
          }

          // normaliza jogadores vindos do lobby
          const raw = Array.isArray(payload) ? payload : (payload?.players ?? payload?.lobbyPlayers ?? [])
          
          // ✅ CORREÇÃO: Ordena raw antes de map para garantir ordem consistente
          // Ordena por created_at/joined_at se existir, senão por id
          const sortedRaw = [...raw].sort((a, b) => {
            // Se ambos têm created_at ou joined_at, ordena por timestamp
            const timeA = a.created_at || a.joined_at || a.createdAt || a.joinedAt
            const timeB = b.created_at || b.joined_at || b.createdAt || b.joinedAt
            if (timeA && timeB) {
              return new Date(timeA) - new Date(timeB)
            }
            // Caso contrário, ordena por id
            const idA = String(a.id ?? a.player_id ?? '')
            const idB = String(b.id ?? b.player_id ?? '')
            return idA.localeCompare(idB)
          })
          
          const mapped = sortedRaw.map((p, i) =>
            applyStarterKit({
              id: String(p.id ?? p.player_id),
              name: p.name ?? p.player_name,
              cash: MANUAL_CONSTANTS.startCash,
              pos: 0,
              bens: MANUAL_CONSTANTS.startBens,
              color: ['#FFD600', '#2196F3', '#00C853', '#FF6D00'][i % 4],
              seat: i // ✅ CORREÇÃO: Atribui seat baseado na ordem ordenada
            })
          )
          if (mapped.length === 0) return

          // ✅ CORREÇÃO: Normaliza players antes de usar
          const normalized = normalizePlayers(mapped)

          // ✅ FIX: myUid pela identidade da sala (UUID), nunca por nome.
          const roomKey = String(payload?.lobbyId || currentLobbyId || roomId || '')
          try {
            const resolvedId = resolvePlayerIdForRoom(roomKey, { playerName: myName })
            const mineById = normalized.find(p => String(p.id) === String(resolvedId))
              || normalized.find(p => String(p.id) === String(meId))
            if (mineById) {
              setMyUid(String(mineById.id))
              if (roomKey) {
                setMatchIdentity(roomKey, {
                  playerId: String(mineById.id),
                  playerName: String(mineById.name || myName || ''),
                })
              }
            } else if (resolvedId) {
              setMyUid(String(resolvedId))
            }
          } catch {}

          // ✅ CORREÇÃO CRÍTICA: Reset explícito de refs antes de iniciar jogo
          lastLocalStateRef.current = null
          playersBeforeRef.current = null
          
          setPlayers(normalized, { source: 'START_GAME' })
          setTurnIdx(0)
          setRound(1)
          if (Object.prototype.hasOwnProperty.call(payload || {}, 'maxRounds')) {
            const nextMax = normalizeMaxRounds(payload.maxRounds)
            setMaxRounds(nextMax)
            maxRoundsRef.current = nextMax
          } else {
            setMaxRounds(DEFAULT_MAX_ROUNDS)
            maxRoundsRef.current = DEFAULT_MAX_ROUNDS
          }
          if (Object.prototype.hasOwnProperty.call(payload || {}, 'turnTimeSec')) {
            const nextTime = normalizeTurnTime(payload.turnTimeSec)
            setTurnTimeSec(nextTime)
            turnTimeSecRef.current = nextTime
          } else {
            setTurnTimeSec(DEFAULT_TURN_TIME_SEC)
            turnTimeSecRef.current = DEFAULT_TURN_TIME_SEC
          }
          setRoundFlags(new Array(normalized.length).fill(false))
          resetMatchLocalUi()
          setGameOver(false); setWinner(null)
          
          console.log('[START] ✅ Estado inicial garantido - round=1, gameOver=false, winner=null, maxRounds=', maxRoundsRef.current, 'turnTimeSec=', turnTimeSecRef.current)
          setMeHud(h => {
            const mine = normalized.find(isMine)
            return {
              ...h,
              name: mine?.name || normalized[0]?.name || 'Jogador',
              color: mine?.color || normalized[0]?.color || '#6c5ce7',
              cash: mine?.cash ?? MANUAL_CONSTANTS.startCash,
              possibAt: 0, clientsAt: 0
            }
          })
          setLog(['Jogo iniciado!'])
          broadcastStart(normalized, maxRoundsRef.current, turnTimeSecRef.current)
          setPhase('game')
        }}
        />
      </ModalProvider>
    )
  }

  // 4) Jogo
  if (!Array.isArray(players) || players.length === 0) {
    return (
      <ModalProvider>
        <div style={{ minHeight:'100vh', display:'flex', alignItems:'center', justifyContent:'center', color:'#fff' }}>
          <div style={{ maxWidth: 520, padding: 16 }}>
            <div style={{ fontSize: 18, marginBottom: 8 }}>Carregando estado do jogo...</div>
            <div style={{ opacity: .75, marginBottom: 12 }}>
              Aguardando snapshot do Supabase (START). Se ficar preso, volte para Lobbies e entre novamente.
            </div>
            <button onClick={() => {
              // NÃO clearMatchIdentity aqui: voltar da tela de loading NÃO é abandonar a partida.
              // Apagar a identidade impede "Reentrar" no card locked.
              if (isDevVerbose()) {
                console.log('[resume] back-to-lobbies from loading (identity preserved)')
              }
              window.__setRoomCode?.(null)
              setPhase('lobbies')
            }} style={{ padding:'10px 12px', borderRadius: 10 }}>
              Voltar para Lobbies
            </button>
          </div>
        </div>
      </ModalProvider>
    )
  }

  // 4) Jogo — landscape/fullscreen só aqui (tabuleiro); lobbies/nome livres em portrait
  return (
    <>
    <OrientationGuard enabled>
    <ModalProvider>
    <div className="page">
      <header className="topbar">
        <div className="status topbarPrimary">
          <div className="topbarRow topbarRow--player">
            <span
              className="topbarDot"
              style={{
                width:18, height:18, borderRadius:'50%',
                border:'2px solid rgba(255,255,255,.9)',
                boxShadow:'0 0 0 2px rgba(0,0,0,.25)',
                background: meHudLive.color
              }}
            />
            <span
              className="topbarName"
              style={{
                background:'#1f2430', border:'1px solid rgba(255,255,255,.12)',
                borderRadius:10, padding:'4px 10px', fontWeight:800
              }}
            >
              👤 {meHudLive.name}
            </span>
            {iAmLobbyHost && (
              <span className="gameHostBadge" title="Você é o Host da sala">
                👑 Você é o Host
              </span>
            )}
            {!iAmLobbyHost && lobbyHostId && (
              <span className="gameHostBadge gameHostBadge--other" title="Host atual da sala">
                👑 Host{lobbyHostPlayer?.name ? `: ${lobbyHostPlayer.name}` : ''}
              </span>
            )}
          </div>
          <div className="topbarRow topbarRow--metrics">
            <span>Possib. Atendimento: <b>{meHudLive.possibAt ?? 0}</b></span>
            <span>Clientes em Atendimento: <b>{meHudLive.clientsAt ?? 0}</b></span>
          </div>
          <DebugPanel players={players} turnIdx={turnIdx} round={round} gameOver={gameOver} winner={winner} />
        </div>

        <div className="status topbarSecondary">
          <span>Rodada: {formatRoundProgress(round, maxRounds, gameOver).label}</span>
          <TurnTimer
            turnDeadlineAt={turnDeadlineAt}
            turnTimeSec={turnTimeSec}
            turnPlayerId={turnPlayerId}
            turnSeq={turnSeq}
            turnLock={turnLock}
            gameOver={gameOver}
            paused={!!turnLock}
          />
          <span className="money">
            💵 ${' '}
            {myCash == null
              ? '—'
              : Number(myCash).toLocaleString()}
          </span>
        </div>
      </header>
      {identityMismatch && (
        <div className="identityMismatchBanner" role="status">
          Não foi possível confirmar seu assento nesta partida neste dispositivo.
          Use “Reentrar” na lista de salas com o mesmo navegador (identidade local).
        </div>
      )}

      <main className={`content${boardView === 'follow' ? ' content--boardFocus' : ''}`}>
        {/* alternância mobile de visualização do tabuleiro (só exibição;
            escondido no desktop via CSS) */}
        <button
          type="button"
          className="boardModeBtn"
          aria-label="Modo ampliado do tabuleiro"
          aria-pressed={boardView === 'follow'}
          onClick={() => {
            // Gesture no tabuleiro: tenta fullscreen + landscape (falha silenciosa).
            enterGamePresentation().catch(() => {})
            setBoardView(v => (v === 'follow' ? 'fit' : 'follow'))
          }}
        >
          {boardView === 'follow'
            ? 'Voltar ao modo normal'
            : 'Expandir tabuleiro'}
        </button>
        <div
          ref={boardWrapRef}
          className={`boardWrap${boardView === 'follow' ? ' boardWrap--follow' : ''}`}
        >
          <Board
            players={players}
            turnIdx={turnIdx}
            onMeHud={setMeHud}
            boardVersion={boardVersion}
            me={players.find(isMine) || null}
            matchId={currentLobbyId || roomId}
          />
          <DiceRollOverlay
            open={!!diceFx}
            result={diceFx?.steps || 1}
            playerName={diceFx?.playerName || ''}
            onComplete={handleDiceFxComplete}
          />
        </div>

        <aside className="side">
          <div className="hud hud--inline">
            <HUD totals={totals} players={players} />
          </div>

          <div className="sideSecondary">
            <div className="controlsSticky">
              <DiceResult lastRoll={lastRollUI} isRolling={isRollingUI} />
            </div>

          </div>

          <div className="turnPrimaryActions">
            {progressiveTip && (
              <div className="progressiveTip" role="status" aria-live="polite">
                <div className="progressiveTipBody">
                  <strong className="progressiveTipLabel">Dica</strong>
                  <span>{progressiveTip.text}</span>
                </div>
                <button
                  type="button"
                  className="progressiveTipDismiss"
                  aria-label="Fechar dica"
                  onClick={() => setProgressiveTip(null)}
                >
                  ×
                </button>
              </div>
            )}
            <div
              className={`nextStepHint${nextStepIsMyTurn ? ' nextStepHintMyTurn' : ''}`}
              role="status"
              aria-live="polite"
            >
              {nextStepHint}
            </div>
            {/* Sempre acima do rolar: não depende do grid/scroll do controlsSticky */}
            <div className="sideQuickActions">
              <Controls
                section="secondary"
                onAction={onControlsAction}
                current={current}
                isMyTurn={isMyTurn}
                myUid={myUid}
                turnPlayerId={turnPlayerId}
                turnLock={turnLock}
                lockOwner={lockOwner}
                modalLocks={modalLocks}
                gameOver={gameOver}
              />
              <button
                type="button"
                className="btn dark"
                onClick={async () => {
                  if (!gameOver && myUid) {
                    try {
                      await forfeitMatch()
                    } catch (error) {
                      console.warn('[App] Erro ao eliminar jogador ao sair:', error)
                    }
                  }
                  if (currentLobbyId && myUid) {
                    try {
                      await leaveRoom({ roomCode: currentLobbyId, playerId: myUid })
                    } catch (error) {
                      console.warn('[App] Erro ao sair da sala:', error)
                    }
                    clearMatchIdentity(currentLobbyId)
                  }
                  window.__setRoomCode?.(null)
                  resetMatchLocalUi()
                  setPhase('lobbies')
                }}
              >
                Sair para Lobbies
              </button>
              <button
                type="button"
                className="btn dark"
                onClick={() => setTutorialOpen(true)}
              >
                Como jogar
              </button>
            </div>
            <button
              type="button"
              className="btn dark hudOpenBtn"
              onClick={() => setHudSheetOpen(true)}
            >
              Ver resumo / placar
            </button>
            <Controls
              section="primary"
              onAction={onControlsAction}
              current={current}
              isMyTurn={isMyTurn}
              myUid={myUid}
              turnPlayerId={turnPlayerId}
              turnLock={turnLock}
              lockOwner={lockOwner}
              modalLocks={modalLocks}
              gameOver={gameOver}
            />
          </div>
        </aside>
      </main>

      {hudSheetOpen && (
        <div
          className="hudSheetBackdrop"
          role="dialog"
          aria-modal="true"
          aria-label="Resumo e placar"
          onClick={() => setHudSheetOpen(false)}
        >
          <div
            className="hudSheet"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="hudSheetHeader">
              <strong>Resumo e placar</strong>
              <button
                type="button"
                className="btn dark hudSheetClose"
                onClick={() => setHudSheetOpen(false)}
              >
                Fechar
              </button>
            </div>
            <div className="hudSheetBody">
              <HUD totals={totals} players={players} />
            </div>
          </div>
        </div>
      )}

      {/* Overlay persistente de FALÊNCIA para o meu jogador */}
      {showBankruptOverlay && (
        <BankruptOverlay
          playerName={meHudLive?.name || current?.name || 'Jogador'}
          onClose={() => setShowBankruptOverlay(false)}
          autoCloseMs={1500}
        />
      )}
    </div>
    </ModalProvider>
    </OrientationGuard>

      {/* Fora de .page (overflow) — FinalWinners ainda usa portal no body */}
      {gameOver && (
        <FinalWinners
          players={players}
          maxRounds={maxRounds}
          endedRound={round}
          onExit={async () => {
            if (currentLobbyId && myUid) {
              try {
                await leaveRoom({ roomCode: currentLobbyId, playerId: myUid })
              } catch (error) {
                console.warn('[App] Erro ao sair da sala:', error)
              }
              clearMatchIdentity(currentLobbyId)
            }
            window.__setRoomCode?.(null)
            resetMatchLocalUi()
            setPhase('lobbies')
          }}
        />
      )}

      {/* Fora do OrientationGuard + portal no body (z-index acima do gate) */}
      <TutorialModal
        open={tutorialOpen}
        onClose={() => setTutorialOpen(false)}
        matchKey={tutorialMatchKey}
        markSessionOnClose
      />
    </>
  )
}
