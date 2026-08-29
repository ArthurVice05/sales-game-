// src/game/useTurnEngine.jsx
import React from 'react'

// Pista versionada
import { getBoardDefinition, resolveBoardVersion } from '../data/boardVersions.js'
import { getTileType } from './domain/tiles.js'

import { DEFAULT_MAX_ROUNDS, normalizeMaxRounds } from './roundConfig'
import { planOfflineTurnSkip } from './offlineTurnSkip.js'
import { shouldRejectAbsentTurnSkip } from './presenceSkipLogic.js'
import {
  bumpModalLockCount,
  releaseModalLockCount,
  decideModalLockClearWait,
  MODAL_LOCK_DIAGNOSTIC_MS,
  MODAL_LOCK_POLL_MS,
} from './modalLockGate.js'
import {
  decideTurnLockWatchdog,
  decideTickForceUnlock,
  canSafelyHandoffTurn,
} from './turnLockSafety.js'
import { isHandoffPendingObsolete } from './turnStateMonotonic.js'
import {
  applyBankruptcyState,
  planMatchForfeit,
  decideEndgameAfterBankruptcy as decideEndgameAfterBankruptcyPure,
} from './matchForfeit.js'

// Modal system
import { useModal } from '../modals/ModalContext'

// Modais de jogo
import ERPSystemsModal from '../modals/ERPSystemsModal'
import TrainingModal from '../modals/TrainingModal'
import DirectBuyModal from '../modals/DirectBuyModal'
import InsideSalesModal from '../modals/InsideSalesModal'
import ClientsModal from '../modals/BuyClientsModal'
import ManagerModal from '../modals/BuyManagerModal'
import FieldSalesModal from '../modals/BuyFieldSalesModal'
import BuyCommonSellersModal from '../modals/BuyCommonSellersModal'
import MixProductsModal from '../modals/MixProductsModal'
import SorteRevesModal from '../modals/SorteRevesModal'
import FaturamentoDoMesModal from '../modals/FaturamentoMesModal'
import DespesasOperacionaisModal from '../modals/DespesasOperacionaisModal'
import InsufficientFundsModal from '../modals/InsufficientFundsModal'
import RecoveryModal from '../modals/RecoveryModal'
import BankruptcyModal from '../modals/BankruptcyModal'

// Regras & helpers puros
import {
  applyDeltas,
  applyTrainingPurchase,
  crossedTile,
  countManagerCerts,
  hasBlue,
  hasPurple,
  hasYellow,
  capacityAndAttendance, // (importado caso queira usar para depurar HUD)
  computeDespesasFor,
  computeFaturamentoFor,
  countAlivePlayers,
  findNextAliveIdx,
} from './gameMath'
import { resolveFinalRoundMove } from './resolveFinalRoundMove.js'
import { pickWinnerByPatrimonio } from './patrimonio.js'
import {
  canTakeLoan,
  applyLoanTake,
  armLoanAfterRevenue,
  ensureLoanId,
  shouldChargeLoan,
  loanChargeAmount,
  clearLoanAfterCharge,
  makeLoanId,
  buildRecoveryFireDeltas,
} from './loanCycle.js'
import { buildClientsPurchaseDeltas } from './clientsPurchase'
import { buildManagerPurchaseDeltas } from './managersPurchase'
import { buildCommonSellersPurchaseDeltas } from './commonSellersPurchase'
import { buildFieldSalesPurchaseDeltas } from './fieldSalesPurchase'
import { buildInsideSalesPurchaseDeltas } from './insideSalesPurchase'
import { buildErpPurchaseDeltas } from './erpPurchase'
import { buildMixPurchaseDeltas } from './productMixPurchase'
import { setCashAuditContext } from '../debug/cashAudit'
import { mkCashMeta } from '../debug/cashMeta'
import { isDebugLogsEnabled } from './debugFlags.js'

// ===== Engine V2 (refactor incremental) =====
// IMPORTANTE:
// - Mantém contrato externo de `useTurnEngine` intacto.
// - Por padrão, ENGINE_V2 fica DESLIGADO (fallback total para lógica atual).
// - Objetivo: migrar por etapas, reduzindo risco no multiplayer.
import { reduceGame } from './engine/gameReducer'
import { runEvents } from './engine/gameEffects'
import {
  isEngineV2Enabled,
  isEngineV2CutoverEnabled,
  shouldRunEngineV2Shadow,
} from './engineFlag.js'

function findNextActiveIndex(players, fromIdx) {
  const n = players?.length || 0
  if (!n) return -1
  for (let step = 1; step <= n; step++) {
    const idx = (fromIdx + step) % n
    const p = players[idx]
    if (p && !p.bankrupt) return idx
  }
  return -1
}

// ✅ Próximo índice jogável (pula bankrupt)
function pickNextAliveIndex(playersArr, fromIdx) {
  const arr = Array.isArray(playersArr) ? playersArr : []
  const n = arr.length
  if (!n) return 0

  const start = Number.isFinite(fromIdx) ? fromIdx : 0
  for (let step = 1; step <= n; step++) {
    const idx = (start + step) % n
    if (!arr[idx]?.bankrupt) return idx
  }
  return Math.max(0, Math.min(start, n - 1))
}


/**
 * Hook do motor de turnos.
 * Recebe estados do App e devolve handlers (advanceAndMaybeLap, onAction, nextTurn).
 */
export function useTurnEngine({
  players, setPlayers,
  round, setRound,
  turnIdx, setTurnIdx,
  turnPlayerId, setTurnPlayerId,
  turnOrder = [],  // ✅ CORREÇÃO DESSYNC: Recebe turnOrder como prop (default: array vazio)
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
  turnSeq = 0,
  setTurnSeq,
  maxRounds: maxRoundsProp,
  boardVersion,
  onTileVisit = null,
}) {
  const DEBUG_LOGS = isDebugLogsEnabled()
  const MAX_ROUNDS = normalizeMaxRounds(maxRoundsProp, DEFAULT_MAX_ROUNDS)
  const resolvedBoardVersion = resolveBoardVersion(boardVersion)
  const boardDefinition = getBoardDefinition(resolvedBoardVersion)
  const trackLen = boardDefinition.trackLen
  const expensesIndex = boardDefinition.expensesIndex
  // ===== Modais =====
  // ✅ Hooks devem ser chamados sempre (evita React #310).
  // O app é envolvido por <ModalProvider>, então useModal() deve existir.
  const modalApi = useModal()
  const pushModal = modalApi?.pushModal
  const awaitTop = modalApi?.awaitTop
  const closeTop = modalApi?.closeTop
  const popModal = modalApi?.popModal
  const safeCloseTop = React.useCallback((payload) => {
    try {
      if (typeof closeTop === 'function') return closeTop(payload)
      if (typeof popModal === 'function') return popModal()
    } catch {}
  }, [closeTop, popModal])

  // 🔒 contagem de modais abertas (para saber quando destravar turno)
  // modalLocksRef é autoritativo e síncrono; modalLocks (state) é espelho para UI/debug.
  // NÃO sincronizar ref ← state via effect: isso pode sobrescrever bumps síncronos e causar deadlock.
  const [modalLocks, setModalLocks] = React.useState(0)
  const modalLocksRef = React.useRef(0)

  // ✅ Anti-double-roll: snapshot local do último "turnKey" rolado (sincronizado com turnSeq)
  const lastRollTurnKeyRef = React.useRef(lastRollTurnKey ?? null)
  React.useEffect(() => {
    lastRollTurnKeyRef.current = lastRollTurnKey ?? null
  }, [lastRollTurnKey])
  const turnLockRef = React.useRef(!!turnLock)
  React.useEffect(() => { turnLockRef.current = !!turnLock }, [turnLock])

  const turnSeqRef = React.useRef(turnSeq ?? 0)
  React.useEffect(() => {
    turnSeqRef.current = typeof turnSeq === 'number' ? turnSeq : 0
  }, [turnSeq])

  // ✅ CORREÇÃO: Flag para indicar que uma modal está sendo aberta (evita race condition)
  const openingModalRef = React.useRef(false)
  
  // ✅ MULTIPLAYER/TURNO: fila única para serializar eventos/modais por ROLL (evita IIFEs concorrentes)
  const eventsInProgressRef = React.useRef(false)
  const actionQueueRef = React.useRef(Promise.resolve())
  const enqueueAction = React.useCallback((job) => {
    const wrapped = async () => {
      eventsInProgressRef.current = true
      try {
        return await job()
      } finally {
        eventsInProgressRef.current = false
      }
    }
    const p = actionQueueRef.current.then(wrapped, wrapped)
    // mantém a cadeia viva mesmo se der erro
    actionQueueRef.current = p.catch((err) => {
      console.error('[DEBUG] actionQueue error:', err)
    })
    return p
  }, [])
  
  // ✅ CORREÇÃO: Ref para rastrear se há uma mudança de turno em progresso
  const turnChangeInProgressRef = React.useRef(false)

  // ✅ Evita duplicação: quando advanceAndMaybeLap agenda retry por causa de modais abertas,
  // múltiplos cliques/entradas não podem agendar múltiplos retries (o que duplicaria Sorte & Revés).
  const advanceRetryTimerRef = React.useRef(null)
  const pendingAdvanceArgsRef = React.useRef(null)
  
  // ✅ CORREÇÃO: Ref para timeout de segurança do turnLock
  const turnLockTimeoutRef = React.useRef(null)
  
  // ✅ CORREÇÃO: Ref para rastrear quando a última modal foi fechada
  // Isso garante que há um delay antes de mudar o turno, dando tempo para todas as modais serem fechadas
  const lastModalClosedTimeRef = React.useRef(null)
  
  // ✅ CORREÇÃO OBRIGATÓRIA 1: Fila de modais para serializar chamadas (evitar modalLocks > 1)
  // Garante que apenas uma modal aguarda por vez, evitando sobrescrita de resolverRef no ModalContext
  const modalQueueRef = React.useRef(Promise.resolve())

  // ✅ CORREÇÃO: Normaliza players para garantir ordem consistente
  // Seat é IMUTÁVEL após atribuído no start - nunca reatribui seat existente
  const normalizePlayers = React.useCallback((players) => {
    if (!Array.isArray(players) || players.length === 0) return players
    
    // Cria cópia para não mutar o original
    const arr = [...players].filter(Boolean)
    
    // Verifica se TODOS possuem seat válido
    const hasSeat = arr.every(p => Number.isInteger(p.seat))
    
    // Ordena: se todos têm seat, ordena por seat; senão, ordena por id
    let ordered = hasSeat 
      ? arr.sort((a, b) => a.seat - b.seat)
      : arr.sort((a, b) => String(a?.id ?? a?.player_id ?? '').localeCompare(String(b?.id ?? b?.player_id ?? '')))
    
    // Preenche seats faltantes SEM alterar os existentes
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
    
    // Reordena por seat após preencher faltantes
    ordered = ordered.sort((a, b) => a.seat - b.seat)
    
    return ordered
  }, [])

  // ✅ CORREÇÃO: Players ordenados (memoizado) para uso em toda a lógica
  const playersOrdered = React.useMemo(() => normalizePlayers(players), [players, normalizePlayers])

  // Helpers por ID (evita bugs por índice quando players é reordenado)
  const idxById = React.useCallback((arr, id) => (arr || []).findIndex(p => String(p?.id) === String(id)), [])
  const getById = React.useCallback((arr, id) => (arr || []).find(p => String(p?.id) === String(id)), [])
  const mapById = React.useCallback((arr, id, fn) => (arr || []).map(p => (String(p?.id) === String(id) ? fn(p) : p)), [])

  // ✅ Helper: Aguarda um tick após modal para UI atualizar
  // WHY: Evita corrida de lock/broadcast quando eventos são encadeados (ex: manutenção → sorte/revés)
  const tickAfterModal = React.useCallback(() => {
    return new Promise(resolve => setTimeout(resolve, 50))
  }, [])

  // ✅ Helper: Aguarda modalLocks zerar (modals fechadas).
  // WHY: Garante que modals anteriores foram processadas antes de continuar.
  // NÃO reconcilia/zera locks por tempo: locks>0 && opening===false é modal real aguardando usuário.
  const waitForLocksClear = React.useCallback(() => {
    return new Promise(resolve => {
      const startedAt = Date.now()
      let lastDiagnosticAt = 0
      const check = () => {
        const locks = modalLocksRef.current
        const opening = !!openingModalRef.current
        const elapsedMs = Date.now() - startedAt
        const decision = decideModalLockClearWait({
          locks,
          opening,
          elapsedMs,
          diagnosticMs: MODAL_LOCK_DIAGNOSTIC_MS,
        })

        if (decision.clear) {
          resolve()
          return
        }

        // Watchdog só diagnostica — nunca inventa fechamento nem libera pipeline.
        if (decision.shouldLog && elapsedMs - lastDiagnosticAt >= MODAL_LOCK_DIAGNOSTIC_MS) {
          lastDiagnosticAt = elapsedMs
          console.warn('[MODAL LOCK] waitForLocksClear ainda aguardando modal ativa', {
            locks,
            opening,
            elapsedMs,
            reason: decision.reason,
          })
        }

        setTimeout(check, MODAL_LOCK_POLL_MS)
      }
      check()
    })
  }, [])

  // 🔄 Sincronização de modalLocks entre jogadores
  React.useEffect(() => {
    if (isMyTurn) {
      // Só o jogador da vez pode ter modais abertas
      console.log('[DEBUG] modalLocks sync - isMyTurn:', isMyTurn, 'modalLocks:', modalLocks)
    } else {
      // Outros jogadores devem ter modalLocks = 0
      if (modalLocks > 0) {
        console.log('[DEBUG] modalLocks sync - resetando modalLocks para 0 (não é minha vez)')
        setModalLocks(0)
        modalLocksRef.current = 0
        openingModalRef.current = false
      }
    }
  }, [isMyTurn, modalLocks])
  
  // Timeout de segurança para turnLock ÓRFÃO — NÃO é limite de jogada (não usa 30s = metade de 60s).
  // Enquanto houver pipeline (eventos/modais/pending), só diagnostica.
  React.useEffect(() => {
    if (turnLock) {
      if (turnLockTimeoutRef.current) {
        clearTimeout(turnLockTimeoutRef.current)
      }

      turnLockTimeoutRef.current = setTimeout(() => {
        const currentLockOwner = lockOwnerRef.current
        const isLockOwner = String(currentLockOwner || '') === String(myUid)
        const decision = decideTurnLockWatchdog({
          turnLock: true,
          isLockOwner,
          lockOwnerNull: currentLockOwner == null,
          modalLocks: modalLocksRef.current,
          opening: !!openingModalRef.current,
          eventsInProgress: !!eventsInProgressRef.current,
          turnChangeInProgress: !!turnChangeInProgressRef.current,
          hasPendingTurnData: !!pendingTurnDataRef.current,
        })

        console.warn('[TURN_LOCK_WATCHDOG]', {
          decision,
          lockOwner: currentLockOwner,
          modalLocks: modalLocksRef.current,
          opening: openingModalRef.current,
          eventsInProgress: eventsInProgressRef.current,
          turnChangeInProgress: turnChangeInProgressRef.current,
          hasPending: !!pendingTurnDataRef.current,
        })

        if (decision.forceUnlock) {
          setTurnLockBroadcast(false)
          turnChangeInProgressRef.current = false
        }
      }, 120000) // só órfãos extremos (2 min); nunca alinhado a 30s / metade do turno
    } else {
      if (turnLockTimeoutRef.current) {
        clearTimeout(turnLockTimeoutRef.current)
        turnLockTimeoutRef.current = null
      }
    }

    return () => {
      if (turnLockTimeoutRef.current) {
        clearTimeout(turnLockTimeoutRef.current)
        turnLockTimeoutRef.current = null
      }
    }
  }, [turnLock, myUid, setTurnLockBroadcast])

  // 🔒 dono do cadeado de turno (garante que só o iniciador destrava)
  // ✅ CORREÇÃO: Declarado ANTES do useEffect que o usa
  const [lockOwner, setLockOwner] = React.useState(null)
  const lockOwnerRef = React.useRef(null)
  React.useEffect(() => { lockOwnerRef.current = lockOwner }, [lockOwner])

  // 🔄 dados do próximo turno (para evitar stale closure)
  // ✅ CORREÇÃO: Declarado ANTES do useEffect que o usa
  const pendingTurnDataRef = React.useRef(null)
  
  // ✅ CORREÇÃO CRÍTICA: Ref para pegar valor atualizado de round (evita stale closure)
  const currentRoundRef = React.useRef(round)
  React.useEffect(() => { 
    currentRoundRef.current = round
    console.log('[DEBUG] 🔄 currentRoundRef atualizado para:', round)
  }, [round])

  // ✅ Regra de falência por quantidade inicial de jogadores:
  // 1 jogador: termina quando ele declarar falência (alive === 0)
  // 2+ jogadores: termina quando sobrar <= 1 vivo (alive <= 1)
  const uniquePlayerCount = React.useCallback((arr) => {
    const list = Array.isArray(arr) ? arr : []
    const ids = list
      .map(p => p?.id)
      .filter(v => v !== undefined && v !== null)
      .map(v => String(v))
      .filter(Boolean)

    if (ids.length === 0) return list.length
    return new Set(ids).size
  }, [])

  const initialPlayerCountRef = React.useRef(null)

  React.useEffect(() => {
    if (gameOver) return
    const n = uniquePlayerCount(players)
    if (!n) return

    // START reseta turnSeq para 0 e round para 1 (ver App.jsx)
    const isFreshStart = Number(turnSeq || 0) === 0 && Number(round || 1) === 1
    if (isFreshStart) {
      initialPlayerCountRef.current = n
      return
    }

    // Nunca diminui
    if (initialPlayerCountRef.current == null || n > initialPlayerCountRef.current) {
      initialPlayerCountRef.current = n
    }
  }, [players, round, turnSeq, gameOver, uniquePlayerCount])

  const decideEndgameAfterBankruptcy = React.useCallback((nextPlayers) => {
    return decideEndgameAfterBankruptcyPure(nextPlayers, initialPlayerCountRef.current)
  }, [])

  // ✅ refs do estado mais recente (evita stale no tick / winner)
  const playersRef = React.useRef(players)
  React.useEffect(() => { playersRef.current = players }, [players])
  // ✅ Commit local que atualiza ref + estado (evita snapshot atrasado)
  const commitLocalPlayers = React.useCallback((nextPlayers, meta) => {
    playersRef.current = nextPlayers
    setPlayers(nextPlayers, meta)
  }, [setPlayers])

  const turnIdxRef = React.useRef(turnIdx)
  React.useEffect(() => { turnIdxRef.current = turnIdx }, [turnIdx])
  
  const turnPlayerIdRef = React.useRef(turnPlayerId)
  React.useEffect(() => { turnPlayerIdRef.current = turnPlayerId }, [turnPlayerId])

  const roundFlagsRef = React.useRef(roundFlags || [])
  React.useEffect(() => { roundFlagsRef.current = Array.isArray(roundFlags) ? roundFlags : [] }, [roundFlags])

  // ✅ Commit local meta: mantém refs coerentes com estado
  const commitLocalMeta = React.useCallback(({ nextTurnIdx, nextRound, nextTurnPlayerId, nextRoundFlags }) => {
    if (typeof nextTurnIdx === 'number') {
      turnIdxRef.current = nextTurnIdx
      setTurnIdx(nextTurnIdx)
    }
    if (typeof nextRound === 'number') {
      currentRoundRef.current = nextRound
      setRound(nextRound)
    }
    if (nextTurnPlayerId !== undefined && nextTurnPlayerId !== null) {
      const id = String(nextTurnPlayerId)
      turnPlayerIdRef.current = id
      if (typeof setTurnPlayerId === 'function') setTurnPlayerId(id)
    }
    if (nextRoundFlags) {
      roundFlagsRef.current = nextRoundFlags
      setRoundFlags(nextRoundFlags)
    }
  }, [setRound, setRoundFlags, setTurnIdx, setTurnPlayerId])

  const gameOverRef = React.useRef(gameOver)
  React.useEffect(() => { gameOverRef.current = gameOver }, [gameOver])

  // ✅ CORREÇÃO DESSYNC: Ref para turnOrder (evita stale closure)
  const turnOrderRef = React.useRef(turnOrder || [])
  React.useEffect(() => { 
    turnOrderRef.current = Array.isArray(turnOrder) ? turnOrder : []
  }, [turnOrder])

  // ✅ ENDGAME: pendente + idempotência
  const endGamePendingRef = React.useRef(false)
  const endGameFinalizedRef = React.useRef(false)

  // ✅ IMPORTANT: lockOwner deve vir do estado replicado (Supabase/BC TURNLOCK),
  // não de heurística local "é minha vez".
  // Mantemos este effect apenas para limpeza de pendingTurnDataRef; não toca em lockOwner.
  React.useEffect(() => {
    const currentPlayer = players[turnIdx]
    if (currentPlayer && String(currentPlayer.id) === String(myUid)) {
    } else {
      // ✅ NÃO limpe pendências futuras aqui.
      // Só limpa se por algum motivo já for da vez atual (stale).
      if (pendingTurnDataRef.current && pendingTurnDataRef.current.nextTurnIdx === turnIdx) {
        pendingTurnDataRef.current = null
      }
    }
  }, [turnIdx, players, myUid])

  // helper: abrir modal e "travar"/"destravar" o contador
  // ✅ CORREÇÃO OBRIGATÓRIA 1: Serialização via fila + decremento único no finally
  const openModalAndWait = React.useCallback((element) => {
    if (!pushModal || !awaitTop) return Promise.resolve(null)

    const job = async () => {
      let lockHeld = false

      try {
        openingModalRef.current = true

        // Ref síncrono ANTES do setState — decisões do motor não podem esperar o commit React.
        const nextOpen = bumpModalLockCount(modalLocksRef.current)
        modalLocksRef.current = nextOpen
        lockHeld = true
        lastModalClosedTimeRef.current = null
        setModalLocks(nextOpen)
        console.log('[DEBUG] openModalAndWait - ABRINDO modal, modalLocks ->', nextOpen, 'openingModalRef:', openingModalRef.current)

        pushModal(element)
        
        // ✅ CORREÇÃO: Pequeno delay para garantir que a modal foi renderizada
        await new Promise(resolve => setTimeout(resolve, 100))
        openingModalRef.current = false
        console.log('[DEBUG] openModalAndWait - Modal renderizada, openingModalRef:', openingModalRef.current)

        const payload = await awaitTop()

        // ✅ Pequeno delay após resolver para garantir que a modal foi completamente fechada
        await new Promise(resolve => setTimeout(resolve, 50))
        return payload ?? null
      } catch (err) {
        console.error('[DEBUG] openModalAndWait - erro aguardando modal:', err)
        return null
      } finally {
        openingModalRef.current = false

        // Se o lock foi adquirido, sempre libera no finally (exceção, awaitTop, etc.).
        // Não depender de modalResolved: lockHeld abandonado = deadlock permanente.
        if (lockHeld) {
          const nextClose = releaseModalLockCount(modalLocksRef.current)
          modalLocksRef.current = nextClose
          if (nextClose === 0) {
            lastModalClosedTimeRef.current = Date.now()
            console.log('[DEBUG] openModalAndWait - ÚLTIMA MODAL FECHADA - timestamp:', lastModalClosedTimeRef.current)
          }
          setModalLocks(nextClose)
          console.log('[DEBUG] openModalAndWait - FECHANDO modal, modalLocks ->', nextClose)
        }
      }
    }

    // ✅ CORREÇÃO OBRIGATÓRIA 1: Serialização via fila de promises
    const p = modalQueueRef.current.then(job, job)
    modalQueueRef.current = p.catch(() => {})
    return p
  }, [pushModal, awaitTop, safeCloseTop])


  // ========= regras auxiliares de saldo =========
  const canPay = React.useCallback((idx, amount) => {
    const p = players[idx]
    const amt = Math.max(0, Number(amount || 0))
    return (Number(p?.cash || 0) >= amt)
  }, [players])

  const requireFunds = React.useCallback((idx, amount, reason) => {
    const ok = canPay(idx, amount)
    if (!ok) {
      appendLog(`Saldo insuficiente${reason ? ' para ' + reason : ''}. Use RECUPERAÇÃO (demitir / emprestar / reduzir) ou declare FALÊNCIA.`)
    }
    return ok
  }, [canPay, appendLog])

  // ========= fim de jogo =========
  // ✅ CORREÇÃO: Retorna objeto com { finished, winner, finalRound } em vez de apenas boolean
  const maybeFinishGame = React.useCallback((
    finalPlayers,
    nextRound,
    { forceFinish = false } = {}
  ) => {
    // forceFinish: endGame na rodada final (nextRound === MAX_ROUNDS)
    // OU nextRound > MAX_ROUNDS (última rodada já ultrapassada)
    const shouldFinish =
      forceFinish === true ||
      Number(nextRound) > MAX_ROUNDS

    if (!shouldFinish) {
      return {
        finished: false,
        winner: null,
        finalRound: nextRound,
      }
    }

    const alivePlayers = (finalPlayers || []).filter(p => !p?.bankrupt)

    // caso extremo: ninguém vivo
    if (alivePlayers.length === 0) {
      console.log('[DEBUG] 🏁 FIM DE JOGO - Nenhum jogador vivo restante')
      return { finished: true, winner: null, finalRound: MAX_ROUNDS }
    }

    // vencedor: maior patrimônio (cash + bens). Desempate: cash, depois nome.
    const champ = pickWinnerByPatrimonio(alivePlayers)

    console.log("[ENDGAME] finalizando: vencedor=", champ?.name || "N/A", ", round=", MAX_ROUNDS)

    return { finished: true, winner: champ, finalRound: MAX_ROUNDS }
  }, [MAX_ROUNDS])

  // ========= ação de andar no tabuleiro (inclui TODA a lógica de casas/modais) =========
  const advanceAndMaybeLap = React.useCallback((steps, deltaCash, note) => {
    console.log('[DEBUG] 🎯 advanceAndMaybeLap chamada - steps:', steps, 'deltaCash:', deltaCash, 'note:', note)
    if (gameOverRef.current || endGamePendingRef.current || endGameFinalizedRef.current || !players.length) return false

    // ✅ CORREÇÃO: Verifica se já há uma mudança de turno em progresso
    if (turnChangeInProgressRef.current) {
      console.warn('[DEBUG] ⚠️ advanceAndMaybeLap - mudança de turno já em progresso, ignorando')
      return false
    }

    // ✅ CORREÇÃO: Verifica se há modais abertas antes de iniciar
    if (modalLocksRef.current > 0 || openingModalRef.current) {
      console.warn('[DEBUG] ⚠️ advanceAndMaybeLap - há modais abertas, aguardando...', {
        modalLocks: modalLocksRef.current,
        opening: openingModalRef.current
      })
      // Consolida retries até liberar (antes: 1 tentativa de 200ms descartava o movimento)
      pendingAdvanceArgsRef.current = { steps, deltaCash, note }
      if (advanceRetryTimerRef.current) return true
      let attempts = 0
      const maxAttempts = 25 // ~5s
      const scheduleRetry = () => {
        advanceRetryTimerRef.current = setTimeout(() => {
          advanceRetryTimerRef.current = null
          const args = pendingAdvanceArgsRef.current
          if (!args) return
          attempts += 1
          if (modalLocksRef.current === 0 && !openingModalRef.current) {
            pendingAdvanceArgsRef.current = null
            advanceAndMaybeLap(args.steps, args.deltaCash, args.note)
            return
          }
          if (attempts < maxAttempts) {
            scheduleRetry()
            return
          }
          pendingAdvanceArgsRef.current = null
          console.warn('[DEBUG] ⚠️ advanceAndMaybeLap - desistiu após retries; movimento descartado')
          const key = typeof turnSeqRef.current === 'number' ? String(turnSeqRef.current) : null
          if (key && lastRollTurnKeyRef.current === key) {
            lastRollTurnKeyRef.current = null
            try {
              if (typeof setLastRollTurnKey === 'function') setLastRollTurnKey(null)
            } catch {}
          }
        }, 200)
      }
      scheduleRetry()
      return true
    }

    // ✅ BUG 2 FIX: try/finally para garantir liberação de turnLock em caso de erro
    // Bloqueia os próximos jogadores até esta ação (e todas as modais) terminar
    turnChangeInProgressRef.current = true
    setTurnLockBroadcast(true, String(myUid))
    setLockOwner(String(myUid))
    
    try {
    // ✅ CORREÇÃO DESSYNC: Usa turnPlayerId como fonte principal
    const currentTurnOrder = turnOrderRef.current || []
    const curIdFromTurn = turnPlayerIdRef.current
    const fallbackId = (Array.isArray(currentTurnOrder) && currentTurnOrder.length > 0)
      ? currentTurnOrder[turnIdxRef.current % currentTurnOrder.length]
      : null
    const ownerId = String(curIdFromTurn || fallbackId || '')
    if (!ownerId) {
      console.warn('[TURN] ⚠️ sem ownerId válido - abortando advanceAndMaybeLap', {
        turnPlayerId: curIdFromTurn,
        turnIdx: turnIdxRef.current,
        turnOrder: currentTurnOrder,
      })
      setTurnLockBroadcast(false)
      turnChangeInProgressRef.current = false
      return false
    }
    
    // Encontra o jogador no array ordenado
    const cur = playersOrdered.find(p => String(p.id) === ownerId)
    const curIdx = playersOrdered.findIndex(p => String(p.id) === ownerId)
    
    if (!cur || curIdx < 0) { 
      console.warn('[TURN] ❌ Jogador não encontrado no array:', { 
        ownerId, 
        turnIdx, 
        turnOrder: currentTurnOrder,
        playersIds: playersOrdered.map(p => p.id)
      })
      setTurnLockBroadcast(false)
      turnChangeInProgressRef.current = false
      return false
    }
    
    console.log('[DEBUG] 📍 POSIÇÃO INICIAL - Jogador:', cur.name, 'Posição:', cur.pos, 'Saldo:', cur.cash)

    // ========= função recursiva para lidar com saldo insuficiente =========
    // WHY: Retorna { ok, players } para que o chamador sempre tenha o snapshot atualizado
    // Isso evita que eventos subsequentes (ex: Sorte & Revés) usem um snapshot antigo sem manutenção
    const handleInsufficientFunds = async (requiredAmount, context, action, currentPlayers = players) => {
      // Helpers para retorno consistente - SEMPRE retorna { ok, players }
      const okRes = (ps) => ({ ok: true, players: ps })
      const failRes = (ps) => ({ ok: false, players: ps })
      
      const curById = getById(currentPlayers, ownerId) || {}
      const currentCash = Number(curById?.cash || 0)
      
      if (currentCash >= requiredAmount) {
        // Processa o pagamento já que tem saldo suficiente
        console.log('[DEBUG] ✅ Saldo suficiente! Processando pagamento de:', requiredAmount)
        // ✅ CORREÇÃO: Atualiza jogador por ID, não por índice
        const updatedPlayers = normalizePlayers(currentPlayers).map((p) => 
          String(p.id) !== ownerId ? p : { ...p, cash: Math.max(0, (p.cash || 0) - requiredAmount), pos: p.pos }
        )
        // WHY: commitLocalPlayers atualiza playersRef.current imediatamente, evitando snapshot stale
        commitLocalPlayers(updatedPlayers)
        broadcastState(updatedPlayers, turnIdx, currentRoundRef.current)
        return okRes(updatedPlayers)
      }

      // ✅ CORREÇÃO: Marca que uma modal será aberta ANTES de abrir
      openingModalRef.current = true
      // Mostra modal de saldo insuficiente
      const recoveryRes = await openModalAndWait(
        <InsufficientFundsModal
          requiredAmount={requiredAmount}
          currentCash={currentCash}
          title={`Saldo insuficiente para ${action} ${context}`}
          message={`Você precisa ${action} R$ ${requiredAmount.toLocaleString()} mas possui apenas R$ ${currentCash.toLocaleString()}.${
            String(context || '').includes('Despesas')
              ? ' Sem caixa, use o patrimônio: cada item vale 50% do valor pago na compra. Se ainda assim não der para continuar, é falência.'
              : ''
          }`}
          showRecoveryOptions={true}
        />
      )
      
      if (!recoveryRes) {
        setTurnLockBroadcast(false)
        return failRes(currentPlayers)
      }
      
      if (recoveryRes.action === 'RECOVERY') {
        // Abre modal de recuperação financeira (não pode ser fechada)
        console.log('[DEBUG] Abrindo RecoveryModal para jogador:', curById)
        const recoveryModalRes = await openModalAndWait(<RecoveryModal currentPlayer={curById} canClose={false} />)
        console.log('[DEBUG] RecoveryModal retornou:', recoveryModalRes)
        if (recoveryModalRes) {
          // Processa a ação de recuperação
          console.log('[DEBUG] recoveryModalRes existe, tipo:', recoveryModalRes.type, 'action:', recoveryModalRes.action)
          let updatedPlayers = currentPlayers
          
          if (recoveryModalRes.type === 'FIRE') {
            console.log('[DEBUG] ✅ Condição FIRE atendida! Processando demissões:', recoveryModalRes)
            const currentPlayer = getById(currentPlayers, ownerId) || {}
            const { deltas, credit } = buildRecoveryFireDeltas(
              currentPlayer,
              recoveryModalRes.items || {},
            )
            console.log('[DEBUG] Deltas de demissão (SSOT):', deltas, 'credit:', credit)
            // ✅ CORREÇÃO: Preserva a posição do jogador ao atualizar
            updatedPlayers = mapById(currentPlayers, ownerId, (p) => {
              const updated = applyDeltas(p, deltas)
              return { ...updated, pos: p.pos }
            })
            console.log('[DEBUG] Novo saldo após demissões:', getById(updatedPlayers, ownerId)?.cash)
            // WHY: commitLocalPlayers atualiza playersRef.current imediatamente
            commitLocalPlayers(updatedPlayers)
            broadcastState(updatedPlayers, turnIdx, currentRoundRef.current)
          } else if (recoveryModalRes.type === 'LOAN') {
            console.log('[DEBUG] ✅ Condição LOAN atendida! Processando empréstimo:', recoveryModalRes)

            const currentPlayer = getById(currentPlayers, ownerId) || {}

            if (!canTakeLoan(currentPlayer)) {
              console.log('[LOAN DEBUG] bloqueado por empréstimo único da partida', {
                ownerId,
                loanTakenInMatch: currentPlayer?.loanTakenInMatch,
                loanPending: currentPlayer.loanPending || null,
              })

              const loanModalRes = await openModalAndWait(
                <InsufficientFundsModal
                  requiredAmount={requiredAmount}
                  currentCash={Number(currentPlayer.cash || 0)}
                  title="Empréstimo indisponível"
                  message="Cada jogador só pode pegar empréstimo uma única vez por partida."
                  showRecoveryOptions={false}
                  canClose={false}
                />
              )

              if (!loanModalRes || loanModalRes.action !== 'BANKRUPT') {
                setTurnLockBroadcast(false)
                return failRes(currentPlayers)
              }
            }

            const taken = applyLoanTake(
              currentPlayer,
              recoveryModalRes.amount,
              currentRoundRef.current,
            )
            if (!taken.ok) {
              setTurnLockBroadcast(false)
              return failRes(currentPlayers)
            }
            console.log('[LOAN DEBUG] criado', {
              ownerId,
              loanTakenInMatch: true,
              amount: taken.player.loanPending?.amount,
            })
            updatedPlayers = mapById(currentPlayers, ownerId, (p) => ({
              ...taken.player,
              pos: p.pos,
            }))
            console.log('[DEBUG] Novo saldo do jogador:', getById(updatedPlayers, ownerId)?.cash)
            // WHY: commitLocalPlayers atualiza playersRef.current imediatamente
            commitLocalPlayers(updatedPlayers)
            broadcastState(updatedPlayers, turnIdx, currentRoundRef.current)
          } else if (recoveryModalRes.type === 'REDUCE') {
            console.log('[DEBUG] ✅ Condição REDUCE atendida! Processando redução:', recoveryModalRes)
            const selections = recoveryModalRes.items || []
            let totalCredit = 0
            console.log('[DEBUG] Seleções para reduzir:', selections)
            
            // ✅ CORREÇÃO: Helper para calcular nível atual baseado em owned
            const letterFromOwned = (owned) => {
              if (owned?.A === true) return 'A'
              if (owned?.B === true) return 'B'
              if (owned?.C === true) return 'C'
              return 'D'
            }
            
            // ✅ CORREÇÃO: Preserva a posição do jogador ao atualizar
            updatedPlayers = mapById(currentPlayers, ownerId, (p0) => {
              let next = { ...p0 }
              
              // Inicializa mixOwned e erpOwned se não existirem
              let mixOwned = { A: false, B: false, C: false, D: false, ...(next.mixOwned || next.mix || {}) }
              let erpOwned = { A: false, B: false, C: false, D: false, ...(next.erpOwned || next.erp || {}) }
              
              // ✅ CORREÇÃO: Se owned estiver vazio, infere de mixProdutos/erpLevel
              const currentMixLevel = String(next.mixProdutos || 'D').toUpperCase()
              const currentErpLevel = String(next.erpLevel || next.erpSistemas || 'D').toUpperCase()
              
              // Se mixOwned está vazio mas tem mixProdutos, infere
              if (!mixOwned.A && !mixOwned.B && !mixOwned.C && !mixOwned.D && currentMixLevel) {
                if (currentMixLevel === 'A') {
                  mixOwned = { A: true, B: true, C: true, D: true }
                } else if (currentMixLevel === 'B') {
                  mixOwned = { A: false, B: true, C: true, D: true }
                } else if (currentMixLevel === 'C') {
                  mixOwned = { A: false, B: false, C: true, D: true }
                } else {
                  mixOwned = { A: false, B: false, C: false, D: true }
                }
              }
              
              // Se erpOwned está vazio mas tem erpLevel, infere
              if (!erpOwned.A && !erpOwned.B && !erpOwned.C && !erpOwned.D && currentErpLevel) {
                if (currentErpLevel === 'A') {
                  erpOwned = { A: true, B: true, C: true, D: true }
                } else if (currentErpLevel === 'B') {
                  erpOwned = { A: false, B: true, C: true, D: true }
                } else if (currentErpLevel === 'C') {
                  erpOwned = { A: false, B: false, C: true, D: true }
                } else {
                  erpOwned = { A: false, B: false, C: false, D: true }
                }
              }
              
              let currentMixLevelAfter = currentMixLevel
              let currentErpLevelAfter = currentErpLevel
              
              for (const sel of selections) {
                if (sel.selected) {
                  totalCredit += Number(sel.credit || 0)
                  if (sel.group === 'MIX') {
                    // Remove o nível do owned
                    mixOwned[sel.level] = false
                    // ✅ CORREÇÃO: Se está reduzindo o nível atual, faz downgrade
                    if (sel.level === currentMixLevelAfter) {
                      const levels = ['A', 'B', 'C', 'D']
                      const currentIdx = levels.indexOf(currentMixLevelAfter)
                      // Vai para o próximo nível disponível
                      for (let idx = currentIdx + 1; idx < levels.length; idx++) {
                        const nextLevel = levels[idx]
                        if (mixOwned[nextLevel] || nextLevel === 'D') {
                          currentMixLevelAfter = nextLevel
                          break
                        }
                      }
                    }
                  } else if (sel.group === 'ERP') {
                    // Remove o nível do owned
                    erpOwned[sel.level] = false
                    // ✅ CORREÇÃO: Se está reduzindo o nível atual, faz downgrade
                    if (sel.level === currentErpLevelAfter) {
                      const levels = ['A', 'B', 'C', 'D']
                      const currentIdx = levels.indexOf(currentErpLevelAfter)
                      // Vai para o próximo nível disponível
                      for (let idx = currentIdx + 1; idx < levels.length; idx++) {
                        const nextLevel = levels[idx]
                        if (erpOwned[nextLevel] || nextLevel === 'D') {
                          currentErpLevelAfter = nextLevel
                          break
                        }
                      }
                    }
                  }
                }
              }
              
              // ✅ CORREÇÃO: Recalcula mixProdutos e erpLevel após redução
              const finalMixLevel = letterFromOwned(mixOwned) || currentMixLevelAfter || 'D'
              const finalErpLevel = letterFromOwned(erpOwned) || currentErpLevelAfter || 'D'
              
              next.mixOwned = mixOwned
              next.mix = mixOwned
              next.erpOwned = erpOwned
              next.erp = erpOwned
              next.mixProdutos = finalMixLevel
              next.erpLevel = finalErpLevel
              next.erpSistemas = finalErpLevel
              // Aliases adicionais
              next.mixLevel = finalMixLevel
              next.mixProducts = finalMixLevel
              next.mixLevelLetter = finalMixLevel
              next.erpLevelLetter = finalErpLevel
              
              next.cash = (Number(next.cash) || 0) + totalCredit
              // ✅ CORREÇÃO: Preserva a posição original
              next.pos = p0.pos
              
              console.log('[DEBUG] Redução aplicada - mixProdutos:', finalMixLevel, 'erpLevel:', finalErpLevel, 'crédito:', totalCredit)
              
              return next
            })
            console.log('[DEBUG] Total de crédito da redução:', totalCredit)
            console.log('[DEBUG] Novo saldo após redução:', getById(updatedPlayers, ownerId)?.cash)
            console.log('[DEBUG] Novo mixProdutos:', getById(updatedPlayers, ownerId)?.mixProdutos, 'Novo erpLevel:', getById(updatedPlayers, ownerId)?.erpLevel)
            // WHY: commitLocalPlayers atualiza playersRef.current imediatamente
            commitLocalPlayers(updatedPlayers)
            broadcastState(updatedPlayers, turnIdx, currentRoundRef.current)
          } else if (recoveryModalRes?.type === 'TRIGGER_BANKRUPTCY') {
            console.log('[DEBUG] ✅ RecoveryModal pediu TRIGGER_BANKRUPTCY - abrindo confirmação de falência...')

            const confirmRes = await openModalAndWait(<BankruptcyModal playerName={cur?.name || 'Jogador'} />)

            if (confirmRes === true) {
              console.log('[BANKRUPTCY] RecoveryModal confirmou falência — preparando troca de turno completa')

              const currIdx = Number(turnIdxRef.current ?? turnIdx) || 0
              const basePlayers = Array.isArray(playersRef.current) ? playersRef.current : currentPlayers
              const bankruptId = basePlayers?.[currIdx]?.id

              const nextPlayers = (basePlayers || []).map(p => {
                if (!p) return p
                if (p.id !== bankruptId) return p
                return applyBankruptcyState(p)
              })

              const decision = decideEndgameAfterBankruptcy(nextPlayers)
              const endGame = !!decision?.shouldEnd
              const winnerPlayer = decision?.winner ?? null

              commitLocalPlayers(nextPlayers)

              if (endGame) {
                const baseTurnSeq = Number(turnSeqRef.current ?? turnSeq ?? 0) || 0
                const nextTurnSeq = baseTurnSeq + 1

                if (typeof setTurnSeq === 'function') setTurnSeq(nextTurnSeq)
                turnSeqRef.current = nextTurnSeq
                if (typeof setLastRollTurnKey === 'function') setLastRollTurnKey(null)
                lastRollTurnKeyRef.current = null

                setWinner(winnerPlayer)
                setGameOver(true)

                pendingTurnDataRef.current = null
                turnChangeInProgressRef.current = false

                broadcastState(
                  nextPlayers,
                  currIdx,
                  currentRoundRef.current,
                  true,
                  winnerPlayer,
                  {
                    kind: 'ENDGAME',
                    lastAction: 'BANKRUPT',
                    gameOver: true,
                    winner: winnerPlayer,
                    round: currentRoundRef.current,
                    turnPlayerId: winnerPlayer?.id ?? bankruptId ?? (turnPlayerIdRef.current ?? turnPlayerId),
                    turnSeq: nextTurnSeq,
                    lastRollTurnKey: null,
                    lastTurnAt: Date.now(),
                  }
                )

                setTurnLockBroadcast(false)
                return failRes(nextPlayers)
              }

              const nextIdx = pickNextAliveIndex(nextPlayers, currIdx)
              const nextTurnPlayerId = nextPlayers?.[nextIdx]?.id

              const nextRoundFlags =
                (roundFlagsRef?.current && typeof roundFlagsRef.current === 'object')
                  ? roundFlagsRef.current
                  : (typeof roundFlags === 'object' ? roundFlags : {})

              pendingTurnDataRef.current = {
                nextPlayers,
                nextTurnIdx: nextIdx,
                nextTurnPlayerId: nextTurnPlayerId != null ? String(nextTurnPlayerId) : null,
                nextRound: currentRoundRef.current,
                shouldIncrementRound: false,
                nextRoundFlags,
                meta: { kind: 'BANKRUPT', source: 'RecoveryModal' },
              }

              return failRes(nextPlayers)
            }

            console.log('[DEBUG] Falência cancelada no RecoveryModal - mantendo fluxo de recuperação')
            return await handleInsufficientFunds(requiredAmount, context, action, currentPlayers)
          } else {
            console.log('[DEBUG] ❌ Nenhuma condição foi atendida! Tipo:', recoveryModalRes.type, 'Action:', recoveryModalRes.action)
          }
          
          // Verifica se agora tem saldo suficiente após a recuperação
          const newCash = Number((getById(updatedPlayers, ownerId) || {}).cash || 0)
          console.log('[DEBUG] Verificando saldo após recuperação - Novo saldo:', newCash, 'Necessário:', requiredAmount)
          
          if (newCash >= requiredAmount) {
            console.log('[DEBUG] ✅ Saldo suficiente após recuperação! Processando pagamento de:', requiredAmount)
            // Processa o pagamento já que tem saldo suficiente
            // ✅ CORREÇÃO: Preserva a posição do jogador ao atualizar
            const finalPlayers = mapById(updatedPlayers, ownerId, (p) => ({ ...p, cash: Math.max(0, (p.cash || 0) - requiredAmount), pos: p.pos }))
            console.log('[DEBUG] 💰 PAGAMENTO - Saldo antes:', Number((getById(updatedPlayers, ownerId) || {}).cash || 0), 'Valor a pagar:', requiredAmount, 'Saldo após:', Number((getById(finalPlayers, ownerId) || {}).cash || 0))
            // WHY: commitLocalPlayers atualiza playersRef.current imediatamente
            commitLocalPlayers(finalPlayers)
            broadcastState(finalPlayers, turnIdx, currentRoundRef.current)
            return okRes(finalPlayers)
          } else {
            console.log('[DEBUG] ❌ Saldo ainda insuficiente após recuperação. Continuando recursão...')
            // Recursivamente verifica se agora tem saldo suficiente com o estado atualizado
            return await handleInsufficientFunds(requiredAmount, context, action, updatedPlayers)
          }
        } else {
          setTurnLockBroadcast(false)
          return failRes(currentPlayers)
        }
      } else if (recoveryRes.action === 'BANKRUPT') {
        console.log('[BANKRUPTCY] InsufficientFundsModal: player declarou falência — preparando troca de turno completa')

        const currIdx = Number(turnIdxRef.current ?? turnIdx) || 0
        const basePlayers = Array.isArray(playersRef.current) ? playersRef.current : currentPlayers
        const bankruptId = basePlayers?.[currIdx]?.id

        const nextPlayers = (basePlayers || []).map(p => {
          if (!p) return p
          if (p.id !== bankruptId) return p
          return applyBankruptcyState(p)
        })

        const decision = decideEndgameAfterBankruptcy(nextPlayers)
        const endGame = !!decision?.shouldEnd
        const winnerPlayer = decision?.winner ?? null

        commitLocalPlayers(nextPlayers)

        if (endGame) {
          const baseTurnSeq = Number(turnSeqRef.current ?? turnSeq ?? 0) || 0
          const nextTurnSeq = baseTurnSeq + 1

          if (typeof setTurnSeq === 'function') setTurnSeq(nextTurnSeq)
          turnSeqRef.current = nextTurnSeq
          if (typeof setLastRollTurnKey === 'function') setLastRollTurnKey(null)
          lastRollTurnKeyRef.current = null

          setWinner(winnerPlayer)
          setGameOver(true)

          pendingTurnDataRef.current = null
          turnChangeInProgressRef.current = false

          broadcastState(
            nextPlayers,
            currIdx,
            currentRoundRef.current,
            true,
            winnerPlayer,
            {
              kind: 'ENDGAME',
              lastAction: 'BANKRUPT',
              gameOver: true,
              winner: winnerPlayer,
              round: currentRoundRef.current,
              turnPlayerId: winnerPlayer?.id ?? bankruptId ?? (turnPlayerIdRef.current ?? turnPlayerId),
              turnSeq: nextTurnSeq,
              lastRollTurnKey: null,
              lastTurnAt: Date.now(),
            }
          )

          setTurnLockBroadcast(false)
          return failRes(nextPlayers)
        }

        const nextIdx = pickNextAliveIndex(nextPlayers, currIdx)
        const nextTurnPlayerId = nextPlayers?.[nextIdx]?.id

        const nextRoundFlags =
          (roundFlagsRef?.current && typeof roundFlagsRef.current === 'object')
            ? roundFlagsRef.current
            : (typeof roundFlags === 'object' ? roundFlags : {})

        pendingTurnDataRef.current = {
          nextPlayers,
          nextTurnIdx: nextIdx,
          nextTurnPlayerId: nextTurnPlayerId != null ? String(nextTurnPlayerId) : null,
          nextRound: currentRoundRef.current,
          shouldIncrementRound: false,
          nextRoundFlags,
          meta: { kind: 'BANKRUPT', source: 'InsufficientFundsModal' },
        }

        return failRes(nextPlayers)
      } else {
        setTurnLockBroadcast(false)
        return failRes(currentPlayers)
      }
    }

    const oldPos = cur.pos
    const roundNow = currentRoundRef.current
    const aliveCount = players.filter(p => !p?.bankrupt).length

    const moveResolved = resolveFinalRoundMove({
      oldPos,
      steps,
      trackLen,
      roundNow,
      maxRounds: MAX_ROUNDS,
      aliveCount,
      prevWaitingAtRevenue: cur.waitingAtRevenue === true,
      prevLastRevenueRound: Number(cur.lastRevenueRound) || 0,
    })
    const newPos = moveResolved.mathPos
    const lap = moveResolved.lap
    const crossedStart1ForRound = moveResolved.crossedStart
    const stopAtRevenue = moveResolved.stopAtRevenue === true

    // ✅ CORREÇÃO CRÍTICA: Detecta volta completa e incrementa rodada individual do jogador
    // NOTA: A rodada geral só incrementa quando TODOS passam pela casa 0, mas aqui detectamos volta completa
    const completedLap = lap && oldPos >= trackLen - 1  // Se estava na última casa e deu volta

    console.log('[DEBUG] 🚶 MOVIMENTO - De posição:', oldPos, 'Para posição:', newPos, 'Steps:', steps, 'Lap:', lap, 'CompletedLap:', completedLap, 'stopAtRevenue:', stopAtRevenue)

    // aplica movimento + eventual cashDelta imediato (sem permitir negativo)
    // ✅ Adiciona lastRevenueRound e waitingAtRevenue
    
    // ✅ CORREÇÃO: Atualiza jogador por ID/seat, não por índice
    const nextPlayers = normalizePlayers(players).map((p) => {
      if (String(p.id) !== ownerId) return p

      const nextCash = (p.cash || 0) + (deltaCash || 0)

      return {
        ...p,
        pos: moveResolved.finalPos,
        cash: Math.max(0, nextCash),
        lastRevenueRound: moveResolved.lastRevenueRound,
        waitingAtRevenue: moveResolved.waitingAtRevenue
      }
    })
    
    // ✅ CORREÇÃO: Encontra jogador atualizado por ID para log
    const updatedCur = nextPlayers.find(p => String(p.id) === ownerId)
    console.log('[DEBUG] 📍 APÓS MOVIMENTO - Jogador:', updatedCur?.name, 'Posição:', updatedCur?.pos, 'Saldo:', updatedCur?.cash, 'lastRevenueRound:', updatedCur?.lastRevenueRound, 'waitingAtRevenue:', updatedCur?.waitingAtRevenue)

    // >>> controle de rodada: só vira quando TODOS os jogadores VIVOS cruzarem a casa 0
    // ✅ CORREÇÃO CRÍTICA: Usa ref para pegar valor atualizado de round (evita stale closure)
    let nextRound = currentRoundRef.current
    let nextFlags = [...roundFlags]
    let shouldIncrementRound = false
    let shouldEndGameAfterTick = false
    
    // ✅ CORREÇÃO CRÍTICA: Se jogador completou volta completa (lap), marca flag imediatamente
    // Isso garante que a flag seja marcada mesmo se crossedStart1ForRound não detectar corretamente
    if (lap) {
      console.log('[DEBUG] 🏁 VOLTA COMPLETA DETECTADA (lap=true) - Jogador completou uma volta completa!', {
        jogador: cur.name,
        posicaoAnterior: oldPos,
        posicaoNova: newPos,
        rodadaAtual: currentRoundRef.current
      })
      
      // Garante que o array de flags tem o tamanho correto
      if (nextFlags.length < players.length) {
        nextFlags = [...nextFlags, ...new Array(players.length - nextFlags.length).fill(false)]
      }
      
      // ✅ CORREÇÃO: Encontra índice do jogador atual por ID para marcar flag
      const curIdxForFlag = playersOrdered.findIndex(p => String(p.id) === ownerId)
      if (curIdxForFlag >= 0) {
        nextFlags[curIdxForFlag] = true
      }
      console.log('[DEBUG] 🏁 Flag marcada por volta completa (lap) - Flags:', nextFlags.map((f, i) => `${playersOrdered[i]?.name}:${f}`).join(', '))
    }
    
    // ✅ CORREÇÃO: Usa crossedStart1ForRound para detectar passagem pela casa 0 (pode ser sem dar volta completa)
    // Se lap já marcou a flag, isso garante que não perde a marcação
    if (crossedStart1ForRound) {
      // Garante que o array de flags tem o tamanho correto
      if (nextFlags.length < players.length) {
        nextFlags = [...nextFlags, ...new Array(players.length - nextFlags.length).fill(false)]
      }
      
      // ✅ CORREÇÃO: Encontra índice do jogador atual por ID para marcar flag
      const curIdxForFlag = playersOrdered.findIndex(p => String(p.id) === ownerId)
      if (curIdxForFlag >= 0) {
        if (!nextFlags[curIdxForFlag]) {
          nextFlags[curIdxForFlag] = true
          console.log('[DEBUG] 🏁 Jogador passou pela casa 0 (crossedStart1ForRound) - Flags:', nextFlags.map((f, i) => `${playersOrdered[i]?.name}:${f}`).join(', '))
        } else {
          console.log('[DEBUG] 🏁 Jogador já tinha flag marcada (por lap) - Flags:', nextFlags.map((f, i) => `${playersOrdered[i]?.name}:${f}`).join(', '))
        }
      }
      
      // ✅ CORREÇÃO: Conta apenas jogadores vivos para verificar se todos passaram
      const alivePlayers = nextPlayers.filter(p => !p?.bankrupt)
      const aliveIndices = nextPlayers.map((p, i) => !p?.bankrupt ? i : -1).filter(i => i >= 0)
      
      // ✅ CORREÇÃO: Verifica se todos os jogadores vivos passaram pela casa 0
      // Usa lastRevenueRound >= roundNow (robusto)
      const alive = nextPlayers.filter(p => !p?.bankrupt)
      const allAliveDone =
        alive.length > 0 &&
        alive.every(p => (Number(p.lastRevenueRound) || 0) >= roundNow)
      
      console.log('[DEBUG] 🔍 Verificando allAliveDone - Rodada atual:', roundNow, 'Jogadores vivos:', alive.map(p => ({ name: p.name, lastRevenueRound: p.lastRevenueRound })))
      
      const curForLog = nextPlayers.find(p => String(p.id) === ownerId)
      console.log('[DEBUG] 🔍 Verificação de rodada - Jogador:', curForLog?.name, 'Rodada atual:', roundNow, 'round do closure:', round)
      console.log('[DEBUG] 🔍 Jogadores vivos:', aliveIndices.map(i => {
        const p = nextPlayers[i]
        const flagIdx = playersOrdered.findIndex(po => String(po.id) === String(p?.id))
        return `${p?.name}:${flagIdx >= 0 ? nextFlags[flagIdx] : false}`
      }).join(', '))
      console.log('[DEBUG] 🔍 Total de jogadores vivos:', aliveIndices.length)
      console.log('[DEBUG] 🔍 Flags completas:', nextFlags.map((f, i) => `${nextPlayers[i]?.name}:${f ? '✓' : '✗'}`).join(', '))
      console.log('[DEBUG] 🔍 Todos passaram pela casa 0?', allAliveDone)
      
      if (allAliveDone) {
        if (roundNow < MAX_ROUNDS) {
          nextRound = roundNow + 1
          shouldIncrementRound = true
        } else {
          // ✅ RODADA FINAL + TODOS CHEGARAM → ENCERRA O JOGO
          shouldEndGameAfterTick = true
        }
        
        // ✅ CORREÇÃO: Reseta apenas as flags dos jogadores vivos (mantém flags de falidos)
        if (shouldIncrementRound) {
          nextFlags = nextFlags.map((_, idx) => {
            if (nextPlayers[idx]?.bankrupt) {
              // Mantém a flag do jogador falido (não reseta)
              return nextFlags[idx]
            } else {
              // Reseta a flag do jogador vivo
              return false
            }
          })
          console.log('[DEBUG] 🔄 RODADA INCREMENTADA - Nova rodada:', nextRound, 'Rodada anterior:', roundNow, 'Jogadores vivos:', alive.length)
          console.log('[DEBUG] 🔄 Flags resetadas:', nextFlags.map((f, i) => `${nextPlayers[i]?.name}:${f}`).join(', '))
          appendLog(`🔄 Rodada ${nextRound} iniciada! Todos os jogadores vivos passaram pela casa de faturamento.`)
        } else if (shouldEndGameAfterTick) {
          console.log('[DEBUG] 🏁 FIM DE JOGO - Rodada final completa, todos os jogadores vivos chegaram!')
        }
      } else {
        const missingPlayers = alive.filter(p => (Number(p.lastRevenueRound) || 0) < roundNow).map(p => p.name)
        console.log('[DEBUG] ⏳ Rodada NÃO incrementada - ainda faltam jogadores completarem o mês:', missingPlayers.join(', '))
      }
    }
    
    // ✅ CORREÇÃO: Atualiza as flags ANTES de atualizar a rodada
    setRoundFlags(nextFlags)
    console.log('[DEBUG] roundFlags updated / round closed:', nextFlags.map((f, i) => `${nextPlayers[i]?.name}:${f}`).join(', '))
    
    // >>> pular jogadores falidos ao decidir o próximo turno
    // ✅ Na rodada final, pula também quem está waitingAtRevenue
    let nextTurnIdx = findNextAliveIdx(nextPlayers, curIdx)
    
    // Pula waiting na última rodada
    if (currentRoundRef.current === MAX_ROUNDS) {
      let guard = 0
      while (guard < nextPlayers.length) {
        const p = nextPlayers[nextTurnIdx]
        if (!p.bankrupt && !(p.waitingAtRevenue === true)) break
        nextTurnIdx = (nextTurnIdx + 1) % nextPlayers.length
        guard++
      }
    }
    
    if (deltaCash) appendLog(`${cur.name} ${deltaCash>0? 'ganhou' : 'pagou'} $${(Math.abs(deltaCash)).toLocaleString()}`)
    if (note) appendLog(note)
    
    // ✅ OBJ 4: movimento precisa refletir para todos imediatamente (pos/cash/flags)
    // WHY: commitLocalPlayers atualiza playersRef.current imediatamente, evitando snapshot stale
    commitLocalPlayers(nextPlayers)
    // Broadcast imediatamente como PLAYER_DELTA (não mexe em turno aqui)
    // ✅ CORREÇÃO CRÍTICA: PLAYER_DELTA nunca inclui gameOver/winner (evita vazamento de estado antigo)
    broadcastState(nextPlayers, turnIdx, currentRoundRef.current, false, null, {
      kind: 'PLAYER_DELTA',
      lastRollTurnKey: typeof turnSeqRef.current === 'number' ? String(turnSeqRef.current) : null,
      // Campo passivo só para UI (última face do dado). Nenhuma regra depende dele.
      lastRoll: {
        playerId: String(cur.id),
        playerName: String(cur.name || '').trim() || 'Jogador',
        steps: Number(steps),
        turnKey:
          typeof turnSeqRef.current === 'number'
            ? String(turnSeqRef.current)
            : null,
      },
    })
    
    // ✅ CORREÇÃO CRÍTICA: Atualiza a rodada garantindo que o incremento aconteça corretamente
    // Usa função de atualização para sempre pegar o valor mais recente do estado
    // NUNCA usa prevRound + 1 - em multiplayer, se prevRound já está adiantado por sync, NÃO incrementa novamente
    setRound(prevRound => {
      const safeNext = Math.min(MAX_ROUNDS, nextRound)
      const finalRound = Math.min(MAX_ROUNDS, Math.max(prevRound, safeNext))
      
      // ✅ CORREÇÃO: Log e appendLog só quando realmente incrementou (shouldIncrementRound E finalRound > prevRound)
      if (shouldIncrementRound && finalRound > prevRound) {
        console.log('[ROUND] allAliveDone=true -> round', prevRound, '->', finalRound)
        appendLog(`🔄 Rodada ${finalRound} iniciada! Todos os jogadores vivos passaram pela casa de faturamento.`)
      }
      
      // ✅ CORREÇÃO: Log obrigatório quando round muda
      if (finalRound !== prevRound) {
        console.log('[ROUND]', prevRound, '->', finalRound)
      }
      
      // ✅ CORREÇÃO: Atualiza o ref com o valor final para uso futuro
      currentRoundRef.current = finalRound
      
      return finalRound
    })
    
    // ✅ CORREÇÃO: Armazena os dados do próximo turno para uso na função tick
    // IMPORTANTE: Não atualiza turnIdx ainda - isso será feito pelo tick quando todas as modais fecharem
    // IMPORTANTE: Usa nextRound calculado acima (pode ser diferente de round se todos passaram pela casa 0)
    // ✅ FIX: pendingTurnDataRef deve carregar EXATAMENTE a rodada calculada
    // (nunca somar +1 aqui, senão o tick/broadcast sai com round errado)
    const finalNextRound = nextRound
    const finalNextFlags = nextFlags
    // ✅ CORREÇÃO MULTIPLAYER: Calcula turnPlayerId do próximo jogador (fonte autoritativa)
    const nextPlayer = nextPlayers[nextTurnIdx]
    const nextTurnPlayerId = nextPlayer?.id ? String(nextPlayer.id) : null
    const originTurnPlayerId = String(turnPlayerIdRef.current || turnPlayerId || '')
    const originTurnSeq = Number(turnSeqRef.current ?? turnSeq ?? 0)
    pendingTurnDataRef.current = {
      nextPlayers,
      nextTurnIdx,
      nextTurnPlayerId, // ✅ CORREÇÃO: turnPlayerId do próximo jogador
      originTurnPlayerId,
      originTurnSeq,
      nextRound: finalNextRound,
      nextRoundFlags: finalNextFlags,
      timestamp: Date.now(),
      shouldIncrementRound,
      endGame: shouldEndGameAfterTick
    }
    console.log('[DEBUG] 📝 pendingTurnDataRef preenchido - próximo turno:', nextTurnIdx, 'rodada atual:', round, 'próxima rodada:', finalNextRound, 'nextRound calculado:', nextRound, 'shouldIncrementRound:', shouldIncrementRound, 'rodada foi incrementada?', nextRound > round, 'roundFlags:', finalNextFlags.map((f, i) => `${nextPlayers[i]?.name}:${f}`).join(', '))
    
    // NÃO muda o turno aqui - aguarda todas as modais serem fechadas
    // O turno será mudado na função tick() quando modalLocks === 0
    // ✅ CORREÇÃO: Finalização por rodada será detectada no tick() quando shouldIncrementRound && nextRound > MAX_ROUNDS

    const landPos = moveResolved.landPos
    const landedOneBased = landPos + 1
    const landedTileType = stopAtRevenue
      ? 'NONE'
      : getTileType(landedOneBased, resolvedBoardVersion)
    const crossedStart1 = crossedStart1ForRound
    const crossedExpenses23 = stopAtRevenue
      ? false
      : crossedTile(oldPos, newPos, expensesIndex)

    // Dicas progressivas (HUD) — só para o jogador local, sem sync
    try {
      if (typeof onTileVisit === 'function' && String(ownerId) === String(myUid)) {
        if (crossedStart1) onTileVisit('REVENUE')
        if (crossedExpenses23) onTileVisit('EXPENSES')
        if (landedTileType && landedTileType !== 'NONE' && landedTileType !== 'UNKNOWN') {
          onTileVisit(landedTileType)
        }
      }
    } catch {}

    // ================== Regras por casas (modais) ==================

    // ✅ CORREÇÃO: Flag para indicar que uma modal será aberta (setada antes de abrir)
    let willOpenModal = false

    // ✅ CORREÇÃO: Definindo flags de tiles ANTES das IIFEs para poder usar shouldProcessPurchaseInQueue
    // ERP
    const isErpTile = landedTileType === 'ERP'
    // Treinamento
    const isTrainingTile = landedTileType === 'TRAINING'
    // Compra direta (menu)
    const isDirectBuyTile = landedTileType === 'DIRECT_BUY'
    // Inside Sales (casa específica)
    const isInsideTile = landedTileType === 'INSIDE'
    // Clientes
    const isClientsTile = landedTileType === 'CLIENTS'
    // Gestor
    const isManagerTile = landedTileType === 'MANAGER'
    // Field Sales
    const isFieldTile = landedTileType === 'FIELD'
    // Vendedores Comuns
    const isCommonSellersTile = landedTileType === 'COMMON'
    // Mix de Produtos
    const isMixTile = landedTileType === 'MIX'
    
    // ✅ CORREÇÃO: Detecta se há eventos de passagem que afetam o saldo
    const hasPassageEvents = crossedStart1 || crossedExpenses23
    
    // ✅ CORREÇÃO: Detecta se a casa final é uma casa de compra (não Sorte/Revés)
    const isPurchaseTile = isErpTile || isTrainingTile || isDirectBuyTile || isInsideTile || 
                           isClientsTile || isManagerTile || isFieldTile || isCommonSellersTile || isMixTile
    
    // ✅ CORREÇÃO: Se há eventos de passagem E a casa é de compra, processa tudo no enqueueAction
    // Isso garante que o saldo seja cumulativo (despesas aplicadas antes da compra)
    const shouldProcessPurchaseInQueue = hasPassageEvents && isPurchaseTile

    // ✅ CORREÇÃO: Só executa IIFE se NÃO há eventos de passagem (caso contrário, será processado no enqueueAction)
    if (isErpTile && isMyTurn && pushModal && awaitTop && !shouldProcessPurchaseInQueue) {
      willOpenModal = true
      openingModalRef.current = true // ✅ CORREÇÃO: Marca ANTES de abrir
      ;(async () => {
        const buyerPlayer = nextPlayers.find(p => String(p.id) === ownerId) || nextPlayers[curIdx]
        const currentErpLevel = buyerPlayer?.erpLevel || players[curIdx]?.erpLevel || null
        const erpOwned = buyerPlayer?.erpOwned || buyerPlayer?.erp || players[curIdx]?.erpOwned || players[curIdx]?.erp || {}
        const res = await openModalAndWait(<ERPSystemsModal 
          currentCash={buyerPlayer?.cash ?? nextPlayers[curIdx]?.cash ?? myCash}
          currentLevel={currentErpLevel}
          erpOwned={erpOwned}
          currentPlayer={buyerPlayer || null}
         horizonRounds={MAX_ROUNDS}/>)
        if (!res || res.action !== 'BUY') return
        const deltas = buildErpPurchaseDeltas(res)
        const price = deltas.cashDelta < 0 ? -deltas.cashDelta : 0
        if (!requireFunds(curIdx, price, 'comprar ERP')) { setTurnLockBroadcast(false); return }
        setPlayers(ps => {
          const upd = mapById(ps, ownerId, (p) => applyDeltas(p, deltas))
          // ✅ CORREÇÃO: Usa turnIdx e round atuais (não nextTurnIdx/nextRound) para compras durante o turno
          broadcastState(upd, turnIdx, currentRoundRef.current)
          return upd
        })
      })()
    }

    // ✅ CORREÇÃO: Só executa IIFE se NÃO há eventos de passagem
    if (isTrainingTile && isMyTurn && pushModal && awaitTop && !shouldProcessPurchaseInQueue) {
      openingModalRef.current = true // ✅ CORREÇÃO: Marca ANTES de abrir
      ;(async () => {
        const buyerPlayer = nextPlayers.find(p => String(p.id) === ownerId) || players.find(isMine) || nextPlayers[curIdx]
        const res = await openModalAndWait(<TrainingModal
          currentCash={Number(buyerPlayer?.cash ?? myCash)}
          currentPlayer={buyerPlayer || null}
          canTrain={{
            comum:  Number(buyerPlayer?.vendedoresComuns) || 0,
            field:  Number(buyerPlayer?.fieldSales) || 0,
            inside: Number(buyerPlayer?.insideSales) || 0,
            gestor: Number(buyerPlayer?.gestores ?? buyerPlayer?.gestoresComerciais ?? buyerPlayer?.managers) || 0
          }}
          ownedByType={{
            comum: buyerPlayer?.trainingsByVendor?.comum || [],
            field: buyerPlayer?.trainingsByVendor?.field || [],
            inside: buyerPlayer?.trainingsByVendor?.inside || [],
            gestor: buyerPlayer?.trainingsByVendor?.gestor || []
          }}
        />)
        if (!res || res.action !== 'BUY') return
        const trainCost = Number(res.grandTotal || 0)
        if (!requireFunds(curIdx, trainCost, 'comprar Treinamento')) { setTurnLockBroadcast(false); return }
          setPlayers(ps => {
          const upd = mapById(ps, ownerId, (p) => applyTrainingPurchase(p, res))
            // ✅ CORREÇÃO: Usa turnIdx e round atuais para compras durante o turno
            broadcastState(upd, turnIdx, currentRoundRef.current)
            return upd
          })
      })()
    }

    // ✅ CORREÇÃO: Só executa IIFE se NÃO há eventos de passagem
    if (isDirectBuyTile && isMyTurn && pushModal && awaitTop && !shouldProcessPurchaseInQueue) {
      openingModalRef.current = true // ✅ CORREÇÃO: Marca ANTES de abrir
      ;(async () => {
        const getCash = () => nextPlayers[curIdx]?.cash ?? myCash
        let currentSelection = await openModalAndWait(<DirectBuyModal currentCash={getCash()} />)
        if (!currentSelection) return

        while (currentSelection && currentSelection.action === 'OPEN') {
          const open = String(currentSelection.open || '').toUpperCase()

          if (open === 'MIX') {
            const buyerPlayer = nextPlayers.find(p => String(p.id) === ownerId)
            const currentMixLevel = buyerPlayer?.mixProdutos || players[curIdx]?.mixProdutos || null
            const mixOwned = buyerPlayer?.mixOwned || buyerPlayer?.mix || players[curIdx]?.mixOwned || players[curIdx]?.mix || {}
            const r2 = await openModalAndWait(<MixProductsModal 
              currentCash={getCash()}
              currentLevel={currentMixLevel}
              mixOwned={mixOwned}
              currentPlayer={buyerPlayer || null}
              allowBack={true}
             horizonRounds={MAX_ROUNDS}/>)
            if (!r2 || r2.action === 'SKIP') return
            if (r2.action === 'BACK') { currentSelection = await openModalAndWait(<DirectBuyModal currentCash={getCash()} />); if (!currentSelection) return; continue }
            if (r2.action === 'BUY') {
              const deltas = buildMixPurchaseDeltas(r2)
              const price = deltas.cashDelta < 0 ? -deltas.cashDelta : 0
              if (!requireFunds(curIdx, price, 'comprar MIX')) { setTurnLockBroadcast(false); return }
              setPlayers(ps => {
                const upd = mapById(ps, ownerId, (p) => applyDeltas(p, deltas))
                // ✅ CORREÇÃO: Usa turnIdx e round atuais para compras durante o turno
                broadcastState(upd, turnIdx, currentRoundRef.current); return upd
              })
              return
            }
          }

          if (open === 'MANAGER') {
            const buyerPlayer = nextPlayers.find(p => String(p.id) === ownerId)
            const r2 = await openModalAndWait(
              <ManagerModal
                currentCash={getCash()}
                currentPlayer={buyerPlayer || null}
                allowBack={true}
              />
            )
            if (!r2 || r2.action === 'SKIP') return
            if (r2.action === 'BACK') { currentSelection = await openModalAndWait(<DirectBuyModal currentCash={getCash()} />); if (!currentSelection) return; continue }
            if (r2.action === 'BUY' || r2.action === 'HIRE') {
              const managerDeltas = buildManagerPurchaseDeltas(r2)
              const payAbs = managerDeltas.cashDelta < 0 ? -managerDeltas.cashDelta : 0
              if (payAbs > 0 && !requireFunds(curIdx, payAbs, 'contratar Gestor')) { setTurnLockBroadcast(false); return }
              setPlayers(ps => {
                const upd = mapById(ps, ownerId, (p) => applyDeltas(p, managerDeltas))
                // ✅ CORREÇÃO: Usa turnIdx e round atuais para compras durante o turno
                broadcastState(upd, turnIdx, currentRoundRef.current); return upd
              })
              return
            }
          }

          if (open === 'INSIDE') {
            const buyerPlayer = nextPlayers.find(p => String(p.id) === ownerId)
            const r2 = await openModalAndWait(
              <InsideSalesModal
                currentCash={getCash()}
                currentPlayer={buyerPlayer || null}
                allowBack={true}
              />
            )
            if (!r2 || r2.action === 'SKIP') return
            if (r2.action === 'BACK') { currentSelection = await openModalAndWait(<DirectBuyModal currentCash={getCash()} />); if (!currentSelection) return; continue }
            if (r2.action === 'BUY' || r2.action === 'HIRE') {
              const deltas = buildInsideSalesPurchaseDeltas(r2)
              const payAbs = deltas.cashDelta < 0 ? -deltas.cashDelta : 0
              if (payAbs > 0 && !requireFunds(curIdx, payAbs, 'contratar Inside Sales')) { setTurnLockBroadcast(false); return }
              setPlayers(ps => {
                const upd = mapById(ps, ownerId, (p) => applyDeltas(p, deltas))
                // ✅ CORREÇÃO: Usa turnIdx e round atuais para compras durante o turno
                broadcastState(upd, turnIdx, currentRoundRef.current); return upd
              })
              return
            }
          }

          if (open === 'FIELD') {
            const buyerPlayer = nextPlayers.find(p => String(p.id) === ownerId)
            const r2 = await openModalAndWait(
              <FieldSalesModal
                currentCash={getCash()}
                currentPlayer={buyerPlayer || null}
                allowBack={true}
              />
            )
            if (!r2 || r2.action === 'SKIP') return
            if (r2.action === 'BACK') { currentSelection = await openModalAndWait(<DirectBuyModal currentCash={getCash()} />); if (!currentSelection) return; continue }
            if (r2.action === 'HIRE' || r2.action === 'BUY') {
              const deltas = buildFieldSalesPurchaseDeltas(r2)
              const payAbs = deltas.cashDelta < 0 ? -deltas.cashDelta : 0
              if (payAbs > 0 && !requireFunds(curIdx, payAbs, 'contratar Field Sales')) { setTurnLockBroadcast(false); return }
              setPlayers(ps => {
                const upd = mapById(ps, ownerId, (p) => applyDeltas(p, deltas))
                // ✅ CORREÇÃO: Usa turnIdx e round atuais para compras durante o turno
                broadcastState(upd, turnIdx, currentRoundRef.current); return upd
              })
              return
            }
          }

          if (open === 'COMMON') {
            const buyerPlayer = nextPlayers.find(p => String(p.id) === ownerId)
            const r2 = await openModalAndWait(
              <BuyCommonSellersModal
                currentCash={getCash()}
                currentPlayer={buyerPlayer || null}
                allowBack={true}
              />
            )
            if (!r2 || r2.action === 'SKIP') return
            if (r2.action === 'BACK') { currentSelection = await openModalAndWait(<DirectBuyModal currentCash={getCash()} />); if (!currentSelection) return; continue }
            if (r2.action === 'BUY') {
              const deltas = buildCommonSellersPurchaseDeltas(r2)
              const payAbs = deltas.cashDelta < 0 ? -deltas.cashDelta : 0
              if (payAbs > 0 && !requireFunds(curIdx, payAbs, 'contratar Vendedores Comuns')) { setTurnLockBroadcast(false); return }
              setPlayers(ps => {
                const upd = mapById(ps, ownerId, (p) => applyDeltas(p, deltas))
                // ✅ CORREÇÃO: Usa turnIdx e round atuais para compras durante o turno
                broadcastState(upd, turnIdx, currentRoundRef.current); return upd
              })
              return
            }
          }

          if (open === 'ERP') {
            const buyerPlayer = nextPlayers.find(p => String(p.id) === ownerId)
            const currentErpLevel = buyerPlayer?.erpLevel || players[curIdx]?.erpLevel || null
            const erpOwned = buyerPlayer?.erpOwned || buyerPlayer?.erp || players[curIdx]?.erpOwned || players[curIdx]?.erp || {}
            const r2 = await openModalAndWait(<ERPSystemsModal 
              currentCash={getCash()}
              currentLevel={currentErpLevel}
              erpOwned={erpOwned}
              currentPlayer={buyerPlayer || null}
              allowBack={true}
             horizonRounds={MAX_ROUNDS}/>)
            if (!r2 || r2.action === 'SKIP') return
            if (r2.action === 'BACK') { currentSelection = await openModalAndWait(<DirectBuyModal currentCash={getCash()} />); if (!currentSelection) return; continue }
            if (r2.action === 'BUY') {
              const deltas = buildErpPurchaseDeltas(r2)
              const price = deltas.cashDelta < 0 ? -deltas.cashDelta : 0
              if (!requireFunds(curIdx, price, 'comprar ERP')) { setTurnLockBroadcast(false); return }
              setPlayers(ps => {
                const upd = mapById(ps, ownerId, (p) => applyDeltas(p, deltas))
                // ✅ CORREÇÃO: Usa turnIdx e round atuais para compras durante o turno
                broadcastState(upd, turnIdx, currentRoundRef.current); return upd
              })
              return
            }
          }

          if (open === 'CLIENTS') {
            const buyerPlayer = nextPlayers.find(p => String(p.id) === ownerId)
            const buyerCash = Number(buyerPlayer?.cash ?? myCash)
            const r2 = await openModalAndWait(
              <ClientsModal
                currentCash={buyerCash}
                currentPlayer={buyerPlayer || null}
                allowBack={true}
              />
            )
            if (!r2 || r2.action === 'SKIP') return
            if (r2.action === 'BACK') { currentSelection = await openModalAndWait(<DirectBuyModal currentCash={getCash()} />); if (!currentSelection) return; continue }
            if (r2.action === 'BUY') {
              const cost  = Number(r2.totalCost || 0)
              if (buyerCash < cost) {
                appendLog('Saldo insuficiente para comprar Clientes.')
                setTurnLockBroadcast(false)
                return
              }
              const clientsDeltas = buildClientsPurchaseDeltas(r2)

              setPlayers(ps => {
                const upd = ps.map(p =>
                  String(p.id) !== ownerId
                    ? p
                    : applyDeltas(p, clientsDeltas)
                )
                broadcastState(upd, turnIdx, currentRoundRef.current)
                return upd
              })
              return
            }
          }

          if (open === 'TRAINING') {
            const buyerPlayer = nextPlayers.find(p => String(p.id) === ownerId) || players.find(isMine) || nextPlayers[curIdx]
            const r2 = await openModalAndWait(<TrainingModal
              currentCash={getCash()}
              currentPlayer={buyerPlayer || null}
              canTrain={{
                comum:  Number(buyerPlayer?.vendedoresComuns) || 0,
                field:  Number(buyerPlayer?.fieldSales) || 0,
                inside: Number(buyerPlayer?.insideSales) || 0,
                gestor: Number(buyerPlayer?.gestores ?? buyerPlayer?.gestoresComerciais ?? buyerPlayer?.managers) || 0
              }}
              ownedByType={{
                comum: buyerPlayer?.trainingsByVendor?.comum || [],
                field: buyerPlayer?.trainingsByVendor?.field || [],
                inside: buyerPlayer?.trainingsByVendor?.inside || [],
                gestor: buyerPlayer?.trainingsByVendor?.gestor || []
              }}
              allowBack={true}
            />)
            if (!r2 || r2.action === 'SKIP') return
            if (r2.action === 'BACK') { currentSelection = await openModalAndWait(<DirectBuyModal currentCash={getCash()} />); if (!currentSelection) return; continue }
            if (r2.action === 'BUY') {
              const trainCost = Number(r2.grandTotal || 0)
              if (!requireFunds(curIdx, trainCost, 'comprar Treinamento')) { setTurnLockBroadcast(false); return }
              setPlayers(ps => {
                const upd = mapById(ps, ownerId, (p) => applyTrainingPurchase(p, r2))
                // ✅ CORREÇÃO: Usa turnIdx e round atuais para compras durante o turno
                broadcastState(upd, turnIdx, currentRoundRef.current); return upd
              })
              return
            }
          }
        }

        // Fallback: BUY direto
        if (currentSelection && currentSelection.action === 'BUY') {
          const res = currentSelection
          const isClientsBuy =
            res.kind === 'CLIENTS' ||
            res.modal === 'CLIENTS' ||
            typeof res.clientsQty !== 'undefined' ||
            typeof res.numClients !== 'undefined' ||
            typeof res.totalCost !== 'undefined' ||
            typeof res.maintenanceDelta !== 'undefined'

          if (isClientsBuy) {
            const cost  = Number(res.totalCost ?? res.total ?? res.amount ?? 0)
            const buyerCash = Number(nextPlayers.find(p => String(p.id) === ownerId)?.cash ?? myCash)
            if (buyerCash < cost) { appendLog('Saldo insuficiente para comprar Clientes.'); setTurnLockBroadcast(false); return }
            const clientsDeltas = buildClientsPurchaseDeltas({
              totalCost: cost,
              qty: Number(res.clientsQty ?? res.numClients ?? res.qty ?? 0),
              maintenanceDelta: Number(res.maintenanceDelta ?? res.maintenance ?? res.mexp ?? 0),
              bensDelta: Number(res.bensDelta ?? cost),
            })

            setPlayers(ps => {
              const upd = ps.map(p =>
                String(p.id) !== ownerId
                  ? p
                  : applyDeltas(p, clientsDeltas)
              )
              // ✅ CORREÇÃO: Usa turnIdx e round atuais para compras durante o turno
              broadcastState(upd, turnIdx, currentRoundRef.current)
              return upd
            })
            return
          }

          const total = Number(res.total ?? res.amount ?? 0)
          if (!requireFunds(curIdx, total, 'esta compra')) { setTurnLockBroadcast(false); return }
          setPlayers(ps => {
            const upd = ps.map((p, i) =>
              i !== curIdx
                ? p
                : applyDeltas(p, {
                    cashDelta: -total,
                    directBuysPush: [ (res.item || { total }) ]
                  })
            )
            // ✅ CORREÇÃO: Usa turnIdx e round atuais para compras durante o turno
            broadcastState(upd, turnIdx, currentRoundRef.current)
            return upd
          })
        }
      })()
    }

    // ✅ CORREÇÃO: Só executa IIFE se NÃO há eventos de passagem
    if (isInsideTile && isMyTurn && pushModal && awaitTop && !shouldProcessPurchaseInQueue) {
      openingModalRef.current = true // ✅ CORREÇÃO: Marca ANTES de abrir
      ;(async () => {
        const buyerPlayer = nextPlayers.find(p => String(p.id) === ownerId) || nextPlayers[curIdx]
        const res = await openModalAndWait(
          <InsideSalesModal
            currentCash={buyerPlayer?.cash ?? myCash}
            currentPlayer={buyerPlayer || null}
          />
        )
        if (!res || (res.action !== 'HIRE' && res.action !== 'BUY')) return
        const deltas = buildInsideSalesPurchaseDeltas(res)
        const payAbs = deltas.cashDelta < 0 ? -deltas.cashDelta : 0
        if (payAbs > 0 && !requireFunds(curIdx, payAbs, 'contratar Inside Sales')) { setTurnLockBroadcast(false); return }
        setPlayers(ps => {
          const upd = mapById(ps, ownerId, (p) => applyDeltas(p, deltas))
          // ✅ CORREÇÃO: Usa turnIdx e round atuais para compras durante o turno
          broadcastState(upd, turnIdx, currentRoundRef.current)
          return upd
        })
      })()
    }

    // ✅ CORREÇÃO: Só executa IIFE se NÃO há eventos de passagem
    if (isClientsTile && isMyTurn && pushModal && awaitTop && !shouldProcessPurchaseInQueue) {
      openingModalRef.current = true // ✅ CORREÇÃO: Marca ANTES de abrir
      ;(async () => {
        const buyerPlayer = nextPlayers.find(p => String(p.id) === ownerId)
        const buyerCash = Number(buyerPlayer?.cash ?? myCash)
        const res = await openModalAndWait(
          <ClientsModal
            currentCash={buyerCash}
            currentPlayer={buyerPlayer || null}
          />
        )
        if (!res || res.action !== 'BUY') return

        const cost  = Number(res.totalCost || 0)
        if (buyerCash < cost) {
          appendLog('Saldo insuficiente para comprar Clientes.')
          setTurnLockBroadcast(false)
          return
        }

        const clientsDeltas = buildClientsPurchaseDeltas(res)

        setPlayers(ps => {
          const upd = ps.map(p =>
            String(p.id) !== ownerId
              ? p
              : applyDeltas(p, clientsDeltas)
          )
          broadcastState(upd, turnIdx, currentRoundRef.current)
          return upd
        })
      })()
    }

    // ✅ CORREÇÃO: Só executa IIFE se NÃO há eventos de passagem
    if (isManagerTile && isMyTurn && pushModal && awaitTop && !shouldProcessPurchaseInQueue) {
      openingModalRef.current = true // ✅ CORREÇÃO: Marca ANTES de abrir
      ;(async () => {
        const buyerPlayer = nextPlayers.find(p => String(p.id) === ownerId) || nextPlayers[curIdx]
        const res = await openModalAndWait(
          <ManagerModal
            currentCash={buyerPlayer?.cash ?? myCash}
            currentPlayer={buyerPlayer || null}
          />
        )
        if (!res || (res.action !== 'BUY' && res.action !== 'HIRE')) return
        const managerDeltas = buildManagerPurchaseDeltas(res)
        const payAbs = managerDeltas.cashDelta < 0 ? -managerDeltas.cashDelta : 0
        if (payAbs > 0 && !requireFunds(curIdx, payAbs, 'contratar Gestor')) { setTurnLockBroadcast(false); return }
        setPlayers(ps => {
          const upd = mapById(ps, ownerId, (p) => applyDeltas(p, managerDeltas))
          // ✅ CORREÇÃO: Usa turnIdx e round atuais para compras durante o turno
          broadcastState(upd, turnIdx, currentRoundRef.current)
          return upd
        })
      })()
    }

    // ✅ CORREÇÃO: Só executa IIFE se NÃO há eventos de passagem
    if (isFieldTile && isMyTurn && pushModal && awaitTop && !shouldProcessPurchaseInQueue) {
      openingModalRef.current = true // ✅ CORREÇÃO: Marca ANTES de abrir
      ;(async () => {
        const buyerPlayer = nextPlayers.find(p => String(p.id) === ownerId) || nextPlayers[curIdx]
        const res = await openModalAndWait(
          <FieldSalesModal
            currentCash={buyerPlayer?.cash ?? myCash}
            currentPlayer={buyerPlayer || null}
          />
        )
        if (res && (res.action === 'HIRE' || res.action === 'BUY')) {
          const deltas = buildFieldSalesPurchaseDeltas(res)
          const payAbs = deltas.cashDelta < 0 ? -deltas.cashDelta : 0
          if (payAbs > 0 && !requireFunds(curIdx, payAbs, 'contratar Field Sales')) { setTurnLockBroadcast(false); return }
          setPlayers(ps => {
            const upd = mapById(ps, ownerId, (p) => applyDeltas(p, deltas))
            // ✅ CORREÇÃO: Usa turnIdx e round atuais para compras durante o turno
            broadcastState(upd, turnIdx, currentRoundRef.current)
            return upd
          })
        }
      })()
    }

    // ✅ CORREÇÃO: Só executa IIFE se NÃO há eventos de passagem
    if (isCommonSellersTile && isMyTurn && pushModal && awaitTop && !shouldProcessPurchaseInQueue) {
      openingModalRef.current = true // ✅ CORREÇÃO: Marca ANTES de abrir
      ;(async () => {
        const buyerPlayer = nextPlayers.find(p => String(p.id) === ownerId) || nextPlayers[curIdx]
        const res = await openModalAndWait(
          <BuyCommonSellersModal
            currentCash={buyerPlayer?.cash ?? myCash}
            currentPlayer={buyerPlayer || null}
          />
        )
        if (!res || res.action !== 'BUY') return
        const deltas = buildCommonSellersPurchaseDeltas(res)
        const payAbs = deltas.cashDelta < 0 ? -deltas.cashDelta : 0
        if (payAbs > 0 && !requireFunds(curIdx, payAbs, 'contratar Vendedores Comuns')) { setTurnLockBroadcast(false); return }
        setPlayers(ps => {
          const upd = mapById(ps, ownerId, (p) => applyDeltas(p, deltas))
          // ✅ CORREÇÃO: Usa turnIdx e round atuais para compras durante o turno
          broadcastState(upd, turnIdx, currentRoundRef.current)
          return upd
        })
      })()
    }

    // ✅ CORREÇÃO: Só executa IIFE se NÃO há eventos de passagem
    if (isMixTile && isMyTurn && pushModal && awaitTop && !shouldProcessPurchaseInQueue) {
      openingModalRef.current = true // ✅ CORREÇÃO: Marca ANTES de abrir
      ;(async () => {
        const buyerPlayer = nextPlayers.find(p => String(p.id) === ownerId) || nextPlayers[curIdx]
        const currentMixLevel = buyerPlayer?.mixProdutos || players[curIdx]?.mixProdutos || null
        const mixOwned = buyerPlayer?.mixOwned || buyerPlayer?.mix || players[curIdx]?.mixOwned || players[curIdx]?.mix || {}
        const res = await openModalAndWait(<MixProductsModal 
          currentCash={buyerPlayer?.cash ?? nextPlayers[curIdx]?.cash ?? myCash}
          currentLevel={currentMixLevel}
          mixOwned={mixOwned}
          currentPlayer={buyerPlayer || null}
         horizonRounds={MAX_ROUNDS}/>)
        if (!res || res.action !== 'BUY') return
        const deltas = buildMixPurchaseDeltas(res)
        const price = deltas.cashDelta < 0 ? -deltas.cashDelta : 0
        if (!requireFunds(curIdx, price, 'comprar MIX')) { setTurnLockBroadcast(false); return }
        setPlayers(ps => {
          const upd = ps.map((p, i) =>
            i !== curIdx
              ? p
              : applyDeltas(p, deltas)
          )
          // ✅ CORREÇÃO: Usa turnIdx e round atuais para compras durante o turno
          broadcastState(upd, turnIdx, currentRoundRef.current)
          return upd
        })
      })()
    }

    // ====== EVENTOS SEQUENCIAIS POR ROLL (sem IIFEs concorrentes) ======
    // Ordem garantida: eventos cruzados (Faturamento/Despesas/Empréstimo) -> evento da casa final (Sorte & Revés)
    const isLuckMisfortuneTile = landedTileType === 'LUCK'
    const canRunSequenced = isMyTurn && !!pushModal && !!awaitTop

    const shouldRunSequenced = crossedStart1 || crossedExpenses23 || isLuckMisfortuneTile || shouldProcessPurchaseInQueue

    if (canRunSequenced && shouldRunSequenced) {
      const td = pendingTurnDataRef.current
      td._once = td._once || {}

      const forwardDist = (from, to, len) => {
        const d = (to - from + len) % len
        return d === 0 ? len : d
      }

      const events = []
      
      if (crossedStart1 && !td._once.faturamento) {
        td._once.faturamento = true
        events.push({ type: 'REVENUE', at: forwardDist(oldPos, boardDefinition.revenueIndex, trackLen) })
      }
      if (crossedExpenses23 && !td._once.expenses23) {
        td._once.expenses23 = true
        events.push({ type: 'EXPENSES', at: forwardDist(oldPos, expensesIndex, trackLen) })
      }
      if (isLuckMisfortuneTile && !td._once.luck) {
        td._once.luck = true
        events.push({ type: 'LUCK', at: steps })
      }
      
      // ✅ CORREÇÃO: Se há eventos de passagem E casa de compra, adiciona a compra como evento final
      if (shouldProcessPurchaseInQueue && !td._once.purchaseTile) {
        td._once.purchaseTile = true
        if (isErpTile) events.push({ type: 'ERP_PURCHASE', at: steps })
        else if (isTrainingTile) events.push({ type: 'TRAINING_PURCHASE', at: steps })
        else if (isDirectBuyTile) events.push({ type: 'DIRECT_BUY_PURCHASE', at: steps })
        else if (isInsideTile) events.push({ type: 'INSIDE_PURCHASE', at: steps })
        else if (isClientsTile) events.push({ type: 'CLIENTS_PURCHASE', at: steps })
        else if (isManagerTile) events.push({ type: 'MANAGER_PURCHASE', at: steps })
        else if (isFieldTile) events.push({ type: 'FIELD_PURCHASE', at: steps })
        else if (isCommonSellersTile) events.push({ type: 'COMMON_PURCHASE', at: steps })
        else if (isMixTile) events.push({ type: 'MIX_PURCHASE', at: steps })
      }

      events.sort((a, b) => a.at - b.at)
      
      // ✅ CORREÇÃO: Só enfileira se houver eventos a processar
      // Isso evita travamento quando re-renders causam _once já estar marcado
      if (events.length > 0) {
        enqueueAction(async () => {
        // WHY: nextPlayers é o snapshot mais correto da jogada atual, já com movimento aplicado
        // Não usa playersRef.current pois pode estar atrasado ou sofrer commit assíncrono no meio
        let localPlayers = nextPlayers
        
        // ✅ CORREÇÃO: Helper para obter saldo atualizado
        const getCurrentCash = () => Number(getById(localPlayers, ownerId)?.cash || 0)
        
        for (const ev of events) {
          const meNow = getById(localPlayers, ownerId) || {}
          if (!meNow?.id) break

          if (ev.type === 'REVENUE') {
            openingModalRef.current = true
            const fat = Math.max(0, Math.floor(computeFaturamentoFor(meNow)))
            console.log('[LOAN DEBUG] revenue/arm', { ownerId, before: meNow.loanPending || null })
            await openModalAndWait(<FaturamentoDoMesModal value={fat} />)

            localPlayers = mapById(localPlayers, ownerId, (p) => {
              const lp = p.loanPending || null
              const shouldArmLoan =
                lp &&
                Number(lp.amount) > 0 &&
                lp.charged !== true &&
                lp.eligibleOnExpenses !== true

              return {
                ...p,
                cash: (Number(p.cash) || 0) + fat,
                ...(shouldArmLoan
                  ? { loanPending: armLoanAfterRevenue(lp) }
                  : {}),
              }
            })

            console.log('[LOAN DEBUG] armed after full lap', { ownerId, loanPending: getById(localPlayers, ownerId)?.loanPending || null })
            commitLocalPlayers(localPlayers)
            broadcastState(localPlayers, turnIdxRef.current, currentRoundRef.current)
            if (pendingTurnDataRef.current) pendingTurnDataRef.current.nextPlayers = localPlayers
            appendLog(`${meNow.name} recebeu faturamento do mês: +$${fat.toLocaleString()}`)
            await tickAfterModal()
            await waitForLocksClear()
            continue
          }

          if (ev.type === 'EXPENSES') {
            openingModalRef.current = true
            const expense = Math.max(0, Math.floor(computeDespesasFor(meNow)))
            let freshMe = getById(localPlayers, ownerId) || meNow
            let lp = freshMe.loanPending || null
            let currentLoanId = String(lp?.loanId || '')

            if (lp && Number(lp.amount) > 0 && !lp.loanId) {
              const normalizedLoanId = makeLoanId(ownerId)

              localPlayers = mapById(localPlayers, ownerId, (p) => ({
                ...p,
                loanPending: ensureLoanId(p.loanPending, ownerId, () => normalizedLoanId),
              }))

              freshMe = getById(localPlayers, ownerId) || freshMe
              lp = freshMe.loanPending || lp
              currentLoanId = String(lp?.loanId || '')
            }

            const alreadyChargedThisLoan =
              !!currentLoanId &&
              String(freshMe.lastChargedLoanId || '') === currentLoanId

            if (lp && alreadyChargedThisLoan) {
              localPlayers = mapById(localPlayers, ownerId, (p) => ({
                ...p,
                loanPending: null,
              }))

              freshMe = getById(localPlayers, ownerId) || {
                ...freshMe,
                loanPending: null,
              }
              lp = null
              currentLoanId = ''
            }

            const declaredAtRound = Number(lp?.declaredAtRound || 0)
            const dueRound = Number(lp?.dueRound) > 0
              ? Number(lp.dueRound)
              : (declaredAtRound > 0 ? declaredAtRound + 1 : 0)
            const reachedRevenueAfterLoan =
              dueRound > 0 && Number(freshMe.lastRevenueRound || 0) >= dueRound

            console.log('[LOAN DEBUG] expenses/pre-check', {
              ownerId,
              loanPending: lp,
              currentLoanId,
              lastChargedLoanId: freshMe.lastChargedLoanId || null,
              lastRevenueRound: freshMe.lastRevenueRound || 0,
              declaredAtRound,
              reachedRevenueAfterLoan,
            })

            if (
              lp &&
              Number(lp.amount) > 0 &&
              lp.charged !== true &&
              reachedRevenueAfterLoan &&
              String(lp?.stage || '').toUpperCase() !== 'ARMED_FOR_NEXT_EXPENSES'
            ) {
              localPlayers = mapById(localPlayers, ownerId, (p) => ({
                ...p,
                loanPending: armLoanAfterRevenue(p.loanPending),
              }))

              freshMe = getById(localPlayers, ownerId) || freshMe
              lp = freshMe.loanPending || lp

              console.log('[LOAN DEBUG] normalized armed in expenses', {
                ownerId,
                loanPending: lp,
              })
            }

            const shouldCharge = shouldChargeLoan({
              loanPending: lp,
              lastChargedLoanId: freshMe.lastChargedLoanId,
              currentRound: currentRoundRef.current,
            })

            const loanCharge = shouldCharge ? loanChargeAmount(lp) : 0

            const totalCharge = expense + loanCharge

            await openModalAndWait(<DespesasOperacionaisModal expense={expense} loanCharge={loanCharge} />)

            const expensesRes = await handleInsufficientFunds(totalCharge, 'Despesas Operacionais', 'pagar', localPlayers)
            if (!expensesRes?.ok) return

            localPlayers = expensesRes.players

            if (shouldCharge) {
              localPlayers = mapById(localPlayers, ownerId, (p) =>
                clearLoanAfterCharge(p, currentLoanId || lp?.loanId),
              )

              console.log('[LOAN DEBUG] liquidado', {
                ownerId,
                currentLoanId,
                lastChargedLoanId: currentLoanId,
              })
            }

            commitLocalPlayers(localPlayers)
            broadcastState(localPlayers, turnIdxRef.current, currentRoundRef.current)
            if (pendingTurnDataRef.current) pendingTurnDataRef.current.nextPlayers = localPlayers

            appendLog(`${meNow.name} pagou despesas operacionais: -$${expense.toLocaleString()}`)
            if (loanCharge > 0) appendLog(`${meNow.name} teve empréstimo cobrado (valor + 50% juros): -$${loanCharge.toLocaleString()}`)
            
            // WHY: Aguarda UI atualizar e locks limparem antes de prosseguir para próximo evento (ex: Sorte & Revés)
            await tickAfterModal()
            await waitForLocksClear()
            continue
          }

          if (ev.type === 'LUCK') {
            openingModalRef.current = true
            // WHY: Usa localPlayers (não playersRef) para ter o snapshot correto com manutenção já aplicada
            const curPlayer = getById(localPlayers, ownerId) || meNow
            const res = await openModalAndWait(<SorteRevesModal player={curPlayer} />)
            if (!res || res.action !== 'APPLY_CARD') {
              await tickAfterModal()
              await waitForLocksClear()
              continue
            }

            let cashDelta = Number.isFinite(res.cashDelta) ? Number(res.cashDelta) : 0
            const clientsDelta = Number.isFinite(res.clientsDelta) ? Number(res.clientsDelta) : 0

            // ✅ Revés sem cash: usa recuperação e, se falhar, pode levar a falência
            // WHY: handleInsufficientFunds retorna { ok, players } para manter snapshot consistente
            if (cashDelta < 0) {
              const luckRes = await handleInsufficientFunds(Math.abs(cashDelta), 'Sorte & Revés', 'pagar', localPlayers)
              if (!luckRes?.ok) return
              cashDelta = 0 // ✅ evita cobrar 2x (já foi cobrado em handleInsufficientFunds)
              // ✅ CRÍTICO: Usa o snapshot retornado, não playersRef.current
              localPlayers = luckRes.players
            }

            // ✅ CORREÇÃO: Aplica cashDelta e clientsDelta
            localPlayers = mapById(localPlayers, ownerId, (p) => {
              let next = { ...p }
              // ✅ CORREÇÃO: Aplica cashDelta (positivo ou negativo) - removido "if (cashDelta)" pois 0 é válido
              if (cashDelta !== 0) {
                next.cash = Math.max(0, (Number(next.cash) || 0) + cashDelta)
              }
              if (clientsDelta !== 0) {
                next.clients = Math.max(0, (Number(next.clients) || 0) + clientsDelta)
              }
            if (res.gainSpecialCell) {
              next.fieldSales = (next.fieldSales || 0) + (res.gainSpecialCell.fieldSales || 0)
                next.support = (next.support || 0) + (res.gainSpecialCell.support || 0)
                next.gestores = (next.gestores || 0) + (res.gainSpecialCell.manager || 0)
              next.gestoresComerciais = (next.gestoresComerciais || 0) + (res.gainSpecialCell.manager || 0)
                next.managers = (next.managers || 0) + (res.gainSpecialCell.manager || 0)
            }
            if (res.id === 'casa_change_cert_blue') {
              next.az = (next.az || 0) + 1
              const curSet = new Set((next.trainingsByVendor?.comum || []))
              curSet.add('personalizado')
              next.trainingsByVendor = { ...(next.trainingsByVendor || {}), comum: Array.from(curSet) }
            }
            return next
          })
            commitLocalPlayers(localPlayers)
            broadcastState(localPlayers, turnIdxRef.current, currentRoundRef.current)
            if (pendingTurnDataRef.current) pendingTurnDataRef.current.nextPlayers = localPlayers

            // ✅ Bônus derivados (por cliente, por gestor certificado, por mix A/B)
            const anyDerived = res.perClientBonus || res.perCertifiedManagerBonus || res.mixLevelBonusABOnly
            if (anyDerived) {
              const me2 = getById(localPlayers, ownerId) || {}
              let extra = 0
              if (res.perClientBonus) extra += (Number(me2.clients) || 0) * Number(res.perClientBonus || 0)
              if (res.perCertifiedManagerBonus) extra += countManagerCerts(me2) * Number(res.perCertifiedManagerBonus || 0)
              if (res.mixLevelBonusABOnly) {
                const level = String(me2.mixProdutos || '').toUpperCase()
                if (level === 'A' || level === 'B') extra += Number(res.mixLevelBonusABOnly || 0)
              }
              if (extra) {
                localPlayers = mapById(localPlayers, ownerId, (p) => ({ ...p, cash: (Number(p.cash) || 0) + extra }))
                commitLocalPlayers(localPlayers)
                broadcastState(localPlayers, turnIdxRef.current, currentRoundRef.current)
                if (pendingTurnDataRef.current) pendingTurnDataRef.current.nextPlayers = localPlayers
              }
            }
            await tickAfterModal()
            await waitForLocksClear()
            continue
          }
          
          // ✅ CORREÇÃO: Casas de compra processadas após eventos de passagem
          if (ev.type === 'ERP_PURCHASE') {
            openingModalRef.current = true
            const buyerPlayer = getById(localPlayers, ownerId) || meNow
            const currentErpLevel = buyerPlayer?.erpLevel || null
            const erpOwned = buyerPlayer?.erpOwned || buyerPlayer?.erp || {}
            const res = await openModalAndWait(<ERPSystemsModal 
              currentCash={getCurrentCash()}
              currentLevel={currentErpLevel}
              erpOwned={erpOwned}
              currentPlayer={buyerPlayer || null}
             horizonRounds={MAX_ROUNDS}/>)
            if (res && res.action === 'BUY') {
              const deltas = buildErpPurchaseDeltas(res)
              const price = deltas.cashDelta < 0 ? -deltas.cashDelta : 0
              if (getCurrentCash() >= price) {
                localPlayers = mapById(localPlayers, ownerId, (p) => applyDeltas(p, deltas))
                commitLocalPlayers(localPlayers)
                broadcastState(localPlayers, turnIdxRef.current, currentRoundRef.current)
                if (pendingTurnDataRef.current) pendingTurnDataRef.current.nextPlayers = localPlayers
              } else {
                appendLog('Saldo insuficiente para comprar ERP.')
              }
            }
            continue
          }
          
          if (ev.type === 'TRAINING_PURCHASE') {
            openingModalRef.current = true
            const buyerPlayer = getById(localPlayers, ownerId) || meNow
            const res = await openModalAndWait(<TrainingModal
              currentCash={getCurrentCash()}
              currentPlayer={buyerPlayer || null}
              canTrain={{
                comum: Number(buyerPlayer?.vendedoresComuns) || 0,
                field: Number(buyerPlayer?.fieldSales) || 0,
                inside: Number(buyerPlayer?.insideSales) || 0,
                gestor: Number(buyerPlayer?.gestores ?? buyerPlayer?.gestoresComerciais ?? buyerPlayer?.managers) || 0
              }}
              ownedByType={{
                comum: buyerPlayer?.trainingsByVendor?.comum || [],
                field: buyerPlayer?.trainingsByVendor?.field || [],
                inside: buyerPlayer?.trainingsByVendor?.inside || [],
                gestor: buyerPlayer?.trainingsByVendor?.gestor || []
              }}
            />)
            if (res && res.action === 'BUY') {
              const trainCost = Number(res.grandTotal || 0)
              if (getCurrentCash() >= trainCost) {
                localPlayers = mapById(localPlayers, ownerId, (p) => applyTrainingPurchase(p, res))
                commitLocalPlayers(localPlayers)
                broadcastState(localPlayers, turnIdxRef.current, currentRoundRef.current)
                if (pendingTurnDataRef.current) pendingTurnDataRef.current.nextPlayers = localPlayers
              } else {
                appendLog('Saldo insuficiente para comprar Treinamento.')
              }
            }
            continue
          }
          
          if (ev.type === 'INSIDE_PURCHASE') {
            openingModalRef.current = true
            const buyerPlayer = getById(localPlayers, ownerId)
            const res = await openModalAndWait(
              <InsideSalesModal
                currentCash={getCurrentCash()}
                currentPlayer={buyerPlayer || null}
              />
            )
            if (res && (res.action === 'HIRE' || res.action === 'BUY')) {
              const deltas = buildInsideSalesPurchaseDeltas(res)
              const payAbs = deltas.cashDelta < 0 ? -deltas.cashDelta : 0
              if (getCurrentCash() >= payAbs) {
                localPlayers = mapById(localPlayers, ownerId, (p) => applyDeltas(p, deltas))
                commitLocalPlayers(localPlayers)
                broadcastState(localPlayers, turnIdxRef.current, currentRoundRef.current)
                if (pendingTurnDataRef.current) pendingTurnDataRef.current.nextPlayers = localPlayers
              } else {
                appendLog('Saldo insuficiente para contratar Inside Sales.')
              }
            }
            continue
          }
          
          if (ev.type === 'CLIENTS_PURCHASE') {
            openingModalRef.current = true
            const buyerPlayer = getById(localPlayers, ownerId)
            const res = await openModalAndWait(
              <ClientsModal
                currentCash={getCurrentCash()}
                currentPlayer={buyerPlayer || null}
              />
            )
            if (res && res.action === 'BUY') {
              const cost = Number(res.totalCost || 0)
              if (getCurrentCash() >= cost) {
                const clientsDeltas = buildClientsPurchaseDeltas(res)
                localPlayers = mapById(localPlayers, ownerId, (p) => applyDeltas(p, clientsDeltas))
                commitLocalPlayers(localPlayers)
                broadcastState(localPlayers, turnIdxRef.current, currentRoundRef.current)
                if (pendingTurnDataRef.current) pendingTurnDataRef.current.nextPlayers = localPlayers
              } else {
                appendLog('Saldo insuficiente para comprar Clientes.')
              }
            }
            continue
          }
          
          if (ev.type === 'MANAGER_PURCHASE') {
            openingModalRef.current = true
            const buyerPlayer = getById(localPlayers, ownerId)
            const res = await openModalAndWait(
              <ManagerModal
                currentCash={getCurrentCash()}
                currentPlayer={buyerPlayer || null}
              />
            )
            if (res && (res.action === 'BUY' || res.action === 'HIRE')) {
              const managerDeltas = buildManagerPurchaseDeltas(res)
              const payAbs = managerDeltas.cashDelta < 0 ? -managerDeltas.cashDelta : 0
              if (getCurrentCash() >= payAbs) {
                localPlayers = mapById(localPlayers, ownerId, (p) => applyDeltas(p, managerDeltas))
                commitLocalPlayers(localPlayers)
                broadcastState(localPlayers, turnIdxRef.current, currentRoundRef.current)
                if (pendingTurnDataRef.current) pendingTurnDataRef.current.nextPlayers = localPlayers
              } else {
                appendLog('Saldo insuficiente para contratar Gestor.')
              }
            }
            continue
          }
          
          if (ev.type === 'FIELD_PURCHASE') {
            openingModalRef.current = true
            const buyerPlayer = getById(localPlayers, ownerId)
            const res = await openModalAndWait(
              <FieldSalesModal
                currentCash={getCurrentCash()}
                currentPlayer={buyerPlayer || null}
              />
            )
            if (res && (res.action === 'HIRE' || res.action === 'BUY')) {
              const deltas = buildFieldSalesPurchaseDeltas(res)
              const payAbs = deltas.cashDelta < 0 ? -deltas.cashDelta : 0
              if (getCurrentCash() >= payAbs) {
                localPlayers = mapById(localPlayers, ownerId, (p) => applyDeltas(p, deltas))
                commitLocalPlayers(localPlayers)
                broadcastState(localPlayers, turnIdxRef.current, currentRoundRef.current)
                if (pendingTurnDataRef.current) pendingTurnDataRef.current.nextPlayers = localPlayers
              } else {
                appendLog('Saldo insuficiente para contratar Field Sales.')
              }
            }
            continue
          }
          
          if (ev.type === 'COMMON_PURCHASE') {
            openingModalRef.current = true
            const buyerPlayer = getById(localPlayers, ownerId)
            const res = await openModalAndWait(
              <BuyCommonSellersModal
                currentCash={getCurrentCash()}
                currentPlayer={buyerPlayer || null}
              />
            )
            if (res && res.action === 'BUY') {
              const deltas = buildCommonSellersPurchaseDeltas(res)
              const payAbs = deltas.cashDelta < 0 ? -deltas.cashDelta : 0
              if (getCurrentCash() >= payAbs) {
                localPlayers = mapById(localPlayers, ownerId, (p) => applyDeltas(p, deltas))
                commitLocalPlayers(localPlayers)
                broadcastState(localPlayers, turnIdxRef.current, currentRoundRef.current)
                if (pendingTurnDataRef.current) pendingTurnDataRef.current.nextPlayers = localPlayers
              } else {
                appendLog('Saldo insuficiente para contratar Vendedores Comuns.')
              }
            }
            continue
          }
          
          if (ev.type === 'MIX_PURCHASE') {
            openingModalRef.current = true
            const buyerPlayer = getById(localPlayers, ownerId) || meNow
            const currentMixLevel = buyerPlayer?.mixProdutos || null
            const mixOwned = buyerPlayer?.mixOwned || buyerPlayer?.mix || {}
            const res = await openModalAndWait(<MixProductsModal 
              currentCash={getCurrentCash()}
              currentLevel={currentMixLevel}
              mixOwned={mixOwned}
              currentPlayer={buyerPlayer || null}
             horizonRounds={MAX_ROUNDS}/>)
            if (res && res.action === 'BUY') {
              const deltas = buildMixPurchaseDeltas(res)
              const price = deltas.cashDelta < 0 ? -deltas.cashDelta : 0
              if (getCurrentCash() >= price) {
                localPlayers = mapById(localPlayers, ownerId, (p) => applyDeltas(p, deltas))
                commitLocalPlayers(localPlayers)
                broadcastState(localPlayers, turnIdxRef.current, currentRoundRef.current)
                if (pendingTurnDataRef.current) pendingTurnDataRef.current.nextPlayers = localPlayers
              } else {
                appendLog('Saldo insuficiente para comprar MIX.')
              }
            }
            continue
          }
          
          if (ev.type === 'DIRECT_BUY_PURCHASE') {
            openingModalRef.current = true
            let currentSelection = await openModalAndWait(<DirectBuyModal currentCash={getCurrentCash()} />)
            if (!currentSelection) continue
            
            while (currentSelection && currentSelection.action === 'OPEN') {
              const open = String(currentSelection.open || '').toUpperCase()
              const meForBuy = getById(localPlayers, ownerId) || meNow

              if (open === 'MIX') {
                const buyerPlayer = getById(localPlayers, ownerId) || meForBuy
                const r2 = await openModalAndWait(<MixProductsModal currentCash={getCurrentCash()} currentLevel={buyerPlayer?.mixProdutos || null} mixOwned={buyerPlayer?.mixOwned || buyerPlayer?.mix || {}} currentPlayer={buyerPlayer || null} allowBack={true}  horizonRounds={MAX_ROUNDS}/>)
                if (!r2 || r2.action === 'SKIP') break
                if (r2.action === 'BACK') { currentSelection = await openModalAndWait(<DirectBuyModal currentCash={getCurrentCash()} />); if (!currentSelection) break; continue }
                if (r2.action === 'BUY') {
                  const deltas = buildMixPurchaseDeltas(r2)
                  const price = deltas.cashDelta < 0 ? -deltas.cashDelta : 0
                  if (getCurrentCash() >= price) {
                    localPlayers = mapById(localPlayers, ownerId, (p) => applyDeltas(p, deltas))
                    commitLocalPlayers(localPlayers); broadcastState(localPlayers, turnIdxRef.current, currentRoundRef.current)
                    if (pendingTurnDataRef.current) pendingTurnDataRef.current.nextPlayers = localPlayers
                  }
                  break
                }
              } else if (open === 'MANAGER') {
                const buyerPlayer = getById(localPlayers, ownerId)
                const r2 = await openModalAndWait(
                  <ManagerModal
                    currentCash={getCurrentCash()}
                    currentPlayer={buyerPlayer || null}
                    allowBack={true}
                  />
                )
                if (!r2 || r2.action === 'SKIP') break
                if (r2.action === 'BACK') { currentSelection = await openModalAndWait(<DirectBuyModal currentCash={getCurrentCash()} />); if (!currentSelection) break; continue }
                if (r2.action === 'BUY' || r2.action === 'HIRE') {
                  const managerDeltas = buildManagerPurchaseDeltas(r2)
                  const payAbs = managerDeltas.cashDelta < 0 ? -managerDeltas.cashDelta : 0
                  if (getCurrentCash() >= payAbs) {
                    localPlayers = mapById(localPlayers, ownerId, (p) => applyDeltas(p, managerDeltas))
                    commitLocalPlayers(localPlayers); broadcastState(localPlayers, turnIdxRef.current, currentRoundRef.current)
                    if (pendingTurnDataRef.current) pendingTurnDataRef.current.nextPlayers = localPlayers
                  }
                  break
                }
              } else if (open === 'INSIDE') {
                const buyerPlayer = getById(localPlayers, ownerId)
                const r2 = await openModalAndWait(
                  <InsideSalesModal
                    currentCash={getCurrentCash()}
                    currentPlayer={buyerPlayer || null}
                    allowBack={true}
                  />
                )
                if (!r2 || r2.action === 'SKIP') break
                if (r2.action === 'BACK') { currentSelection = await openModalAndWait(<DirectBuyModal currentCash={getCurrentCash()} />); if (!currentSelection) break; continue }
                if (r2.action === 'BUY' || r2.action === 'HIRE') {
                  const deltas = buildInsideSalesPurchaseDeltas(r2)
                  const payAbs = deltas.cashDelta < 0 ? -deltas.cashDelta : 0
                  if (getCurrentCash() >= payAbs) {
                    localPlayers = mapById(localPlayers, ownerId, (p) => applyDeltas(p, deltas))
                    commitLocalPlayers(localPlayers); broadcastState(localPlayers, turnIdxRef.current, currentRoundRef.current)
                    if (pendingTurnDataRef.current) pendingTurnDataRef.current.nextPlayers = localPlayers
                  }
                  break
                }
              } else if (open === 'FIELD') {
                const buyerPlayer = getById(localPlayers, ownerId)
                const r2 = await openModalAndWait(
                  <FieldSalesModal
                    currentCash={getCurrentCash()}
                    currentPlayer={buyerPlayer || null}
                    allowBack={true}
                  />
                )
                if (!r2 || r2.action === 'SKIP') break
                if (r2.action === 'BACK') { currentSelection = await openModalAndWait(<DirectBuyModal currentCash={getCurrentCash()} />); if (!currentSelection) break; continue }
                if (r2.action === 'HIRE' || r2.action === 'BUY') {
                  const deltas = buildFieldSalesPurchaseDeltas(r2)
                  if (getCurrentCash() >= (deltas.cashDelta < 0 ? -deltas.cashDelta : 0)) {
                    localPlayers = mapById(localPlayers, ownerId, (p) => applyDeltas(p, deltas))
                    commitLocalPlayers(localPlayers); broadcastState(localPlayers, turnIdxRef.current, currentRoundRef.current)
                    if (pendingTurnDataRef.current) pendingTurnDataRef.current.nextPlayers = localPlayers
                  }
                  break
                }
              } else if (open === 'COMMON') {
                const buyerPlayer = getById(localPlayers, ownerId)
                const r2 = await openModalAndWait(
                  <BuyCommonSellersModal
                    currentCash={getCurrentCash()}
                    currentPlayer={buyerPlayer || null}
                    allowBack={true}
                  />
                )
                if (!r2 || r2.action === 'SKIP') break
                if (r2.action === 'BACK') { currentSelection = await openModalAndWait(<DirectBuyModal currentCash={getCurrentCash()} />); if (!currentSelection) break; continue }
                if (r2.action === 'BUY') {
                  const deltas = buildCommonSellersPurchaseDeltas(r2)
                  if (getCurrentCash() >= (deltas.cashDelta < 0 ? -deltas.cashDelta : 0)) {
                    localPlayers = mapById(localPlayers, ownerId, (p) => applyDeltas(p, deltas))
                    commitLocalPlayers(localPlayers); broadcastState(localPlayers, turnIdxRef.current, currentRoundRef.current)
                    if (pendingTurnDataRef.current) pendingTurnDataRef.current.nextPlayers = localPlayers
                  }
                  break
                }
              } else if (open === 'ERP') {
                const buyerPlayer = getById(localPlayers, ownerId) || meForBuy
                const r2 = await openModalAndWait(<ERPSystemsModal currentCash={getCurrentCash()} currentLevel={buyerPlayer?.erpLevel || null} erpOwned={buyerPlayer?.erpOwned || buyerPlayer?.erp || {}} currentPlayer={buyerPlayer || null} allowBack={true}  horizonRounds={MAX_ROUNDS}/>)
                if (!r2 || r2.action === 'SKIP') break
                if (r2.action === 'BACK') { currentSelection = await openModalAndWait(<DirectBuyModal currentCash={getCurrentCash()} />); if (!currentSelection) break; continue }
                if (r2.action === 'BUY') {
                  const deltas = buildErpPurchaseDeltas(r2)
                  const price = deltas.cashDelta < 0 ? -deltas.cashDelta : 0
                  if (getCurrentCash() >= price) {
                    localPlayers = mapById(localPlayers, ownerId, (p) => applyDeltas(p, deltas))
                    commitLocalPlayers(localPlayers); broadcastState(localPlayers, turnIdxRef.current, currentRoundRef.current)
                    if (pendingTurnDataRef.current) pendingTurnDataRef.current.nextPlayers = localPlayers
                  }
                  break
                }
              } else if (open === 'CLIENTS') {
                const buyerPlayer = getById(localPlayers, ownerId)
                const r2 = await openModalAndWait(
                  <ClientsModal
                    currentCash={getCurrentCash()}
                    currentPlayer={buyerPlayer || null}
                    allowBack={true}
                  />
                )
                if (!r2 || r2.action === 'SKIP') break
                if (r2.action === 'BACK') { currentSelection = await openModalAndWait(<DirectBuyModal currentCash={getCurrentCash()} />); if (!currentSelection) break; continue }
                if (r2.action === 'BUY') {
                  const cost = Number(r2.totalCost || 0)
                  if (getCurrentCash() >= cost) {
                    const clientsDeltas = buildClientsPurchaseDeltas(r2)
                    localPlayers = mapById(localPlayers, ownerId, (p) => applyDeltas(p, clientsDeltas))
                    commitLocalPlayers(localPlayers); broadcastState(localPlayers, turnIdxRef.current, currentRoundRef.current)
                    if (pendingTurnDataRef.current) pendingTurnDataRef.current.nextPlayers = localPlayers
                  }
                  break
                }
              } else if (open === 'TRAINING') {
                const buyerPlayer = getById(localPlayers, ownerId) || meForBuy
                const r2 = await openModalAndWait(<TrainingModal currentCash={getCurrentCash()} currentPlayer={buyerPlayer || null} canTrain={{ comum: Number(buyerPlayer?.vendedoresComuns) || 0, field: Number(buyerPlayer?.fieldSales) || 0, inside: Number(buyerPlayer?.insideSales) || 0, gestor: Number(buyerPlayer?.gestores ?? buyerPlayer?.gestoresComerciais ?? buyerPlayer?.managers) || 0 }} ownedByType={{ comum: buyerPlayer?.trainingsByVendor?.comum || [], field: buyerPlayer?.trainingsByVendor?.field || [], inside: buyerPlayer?.trainingsByVendor?.inside || [], gestor: buyerPlayer?.trainingsByVendor?.gestor || [] }} allowBack={true} />)
                if (!r2 || r2.action === 'SKIP') break
                if (r2.action === 'BACK') { currentSelection = await openModalAndWait(<DirectBuyModal currentCash={getCurrentCash()} />); if (!currentSelection) break; continue }
                if (r2.action === 'BUY') {
                  const trainCost = Number(r2.grandTotal || 0)
                  if (getCurrentCash() >= trainCost) {
                    localPlayers = mapById(localPlayers, ownerId, (p) => applyTrainingPurchase(p, r2))
                    commitLocalPlayers(localPlayers); broadcastState(localPlayers, turnIdxRef.current, currentRoundRef.current)
                    if (pendingTurnDataRef.current) pendingTurnDataRef.current.nextPlayers = localPlayers
                  }
                  break
                }
              }
            }
            if (currentSelection?.action === 'BUY') {
              const total = Number(currentSelection.total ?? currentSelection.amount ?? 0)
              if (getCurrentCash() >= total) {
                localPlayers = mapById(localPlayers, ownerId, (p) => applyDeltas(p, { cashDelta: -total, directBuysPush: [(currentSelection.item || { total })] }))
                commitLocalPlayers(localPlayers); broadcastState(localPlayers, turnIdxRef.current, currentRoundRef.current)
                if (pendingTurnDataRef.current) pendingTurnDataRef.current.nextPlayers = localPlayers
              }
            }
            continue
          }
        }
      })
      } // fim do if (events.length > 0)
    }

    // fail-safe: solta o cadeado quando todas as modais fecharem
    const start = Date.now()
    let tickAttempts = 0
    const maxTickAttempts = 200 // ~20–30s só quando idle; pipeline ativa não consome o teto da mesma forma
    
    const tick = () => {
      tickAttempts++
      
      const currentModalLocks = modalLocksRef.current
      const currentOpening = openingModalRef.current || eventsInProgressRef.current
      const currentLockOwner = lockOwnerRef.current
      const isLockOwner = String(currentLockOwner || '') === String(myUid)

      // ✅ Pipeline ativa: não conta como travamento e NUNCA força unlock/clear de locks
      if (currentOpening || currentModalLocks > 0) {
        const forceDec = decideTickForceUnlock({
          tickAttempts,
          maxTickAttempts,
          modalLocks: currentModalLocks,
          opening: !!openingModalRef.current,
          eventsInProgress: !!eventsInProgressRef.current,
          hasPendingTurnData: !!pendingTurnDataRef.current,
        })
        if (forceDec.continueWaiting || tickAttempts > maxTickAttempts) {
          // reseta metade do contador para não estourar enquanto a jogada real continua
          tickAttempts = Math.min(tickAttempts, Math.floor(maxTickAttempts / 2))
        }
        console.log('[DEBUG] ⚠️ tick - pipeline ativa, aguardando...', {
          modalLocks: currentModalLocks,
          opening: openingModalRef.current,
          eventsInProgress: eventsInProgressRef.current,
        })
        setTimeout(tick, 150)
        return
      }

      if (tickAttempts > maxTickAttempts) {
        const forceDec = decideTickForceUnlock({
          tickAttempts,
          maxTickAttempts,
          modalLocks: currentModalLocks,
          opening: !!openingModalRef.current,
          eventsInProgress: !!eventsInProgressRef.current,
          hasPendingTurnData: !!pendingTurnDataRef.current,
        })
        console.warn('[DEBUG] ⏰ TIMEOUT tick', forceDec)
        if (forceDec.continueWaiting) {
          tickAttempts = Math.floor(maxTickAttempts / 2)
          setTimeout(tick, 150)
          return
        }
        if (forceDec.forceUnlock && isLockOwner) {
          setTurnLockBroadcast(false)
          turnChangeInProgressRef.current = false
        }
        return
      }
      
      console.log('[DEBUG] tick - tentativa:', tickAttempts, 'modalLocks:', currentModalLocks, 'openingModalRef:', currentOpening, 'lockOwner:', currentLockOwner, 'myUid:', myUid, 'isLockOwner:', isLockOwner)
      
      // ✅ CORREÇÃO: Só muda turno se realmente não houver modais abertas
      // ✅ CORREÇÃO: Verifica também se passou tempo suficiente desde que a última modal foi fechada
      // Isso garante que todas as modais (incluindo aninhadas) foram completamente fechadas
      const timeSinceLastModalClosed = lastModalClosedTimeRef.current ? (Date.now() - lastModalClosedTimeRef.current) : Infinity
      const minTimeAfterModalClose = 100 // após fechar modal, handoff rápido (antes 200ms)
      const canChangeTurn =
        canSafelyHandoffTurn({
          modalLocks: currentModalLocks,
          opening: !!openingModalRef.current,
          eventsInProgress: !!eventsInProgressRef.current,
        }) &&
        (timeSinceLastModalClosed >= minTimeAfterModalClose || !lastModalClosedTimeRef.current)
      
      if (canChangeTurn) {
        // ✅ ENDGAME autoritativo: finaliza assim que não houver modais
        const td = pendingTurnDataRef.current
        const shouldEnd = !!(td?.endGame || endGamePendingRef.current)

        if (shouldEnd && !endGameFinalizedRef.current) {
          endGameFinalizedRef.current = true
          endGamePendingRef.current = false

          // pega estado mais recente (inclui faturamento/despesas já aplicados)
          const finalPlayers = Array.isArray(playersRef.current) ? playersRef.current : (td?.nextPlayers || [])
          const champ = pickWinnerByPatrimonio(finalPlayers)

          console.log('[ENDGAME] finalizando: vencedor=%s, round=%s', champ?.name || '—', MAX_ROUNDS)

          // estado final local (obrigatório)
          setPlayers(finalPlayers || [])
          setGameOver(true)
          setWinner(champ)
          setRound(MAX_ROUNDS)
          currentRoundRef.current = MAX_ROUNDS

          // limpa pendências / destrava / não avança turno
          pendingTurnDataRef.current = null
          turnChangeInProgressRef.current = false
          openingModalRef.current = false
          setTurnLockBroadcast(false)

          // propaga para todos (obrigatório)
          broadcastState(finalPlayers || [], turnIdxRef.current, MAX_ROUNDS, true, champ, {
            kind: 'ENDGAME',
            lastAction: 'ENDGAME',
            round: MAX_ROUNDS,
            maxRounds: MAX_ROUNDS,
            gameOver: true,
            winner: champ,
          })

          return
        }

        // ✅ CORREÇÃO: Verifica se o turnIdx atual corresponde ao lockOwner
        // Se o turno mudou via SYNC, o lockOwner pode estar desatualizado
        const currentPlayer = players[turnIdx]
        const isCurrentPlayerMe = currentPlayer && String(currentPlayer.id) === String(myUid)
        
        // libera apenas se EU for o dono do cadeado OU se é minha vez e não há lockOwner
        if (isLockOwner || (isCurrentPlayerMe && !currentLockOwner)) {
          // Agora muda o turno quando todas as modais são fechadas
          const turnData = pendingTurnDataRef.current
          console.log('[DEBUG] 🔍 tick - verificando pendingTurnDataRef:', turnData ? `próximo turno: ${turnData.nextTurnIdx}` : 'null')
          if (turnData) {
            const latestPlayers =
              (Array.isArray(playersRef.current) && playersRef.current.length)
                ? playersRef.current
                : (turnData.nextPlayers || [])

            // ✅ Double-check: pipeline de eventos também deve estar idle
            const finalModalLocks = modalLocksRef.current
            const finalOpening = openingModalRef.current
            const finalEvents = eventsInProgressRef.current
            // ✅ CORREÇÃO: Verifica se o turnIdx ainda é o mesmo (não mudou via SYNC)
            const finalTurnIdx = turnIdx
            const finalLockOwner = lockOwnerRef.current
            const finalIsLockOwner = String(finalLockOwner || '') === String(myUid)
            
            // ✅ CORREÇÃO: Verifica também se passou tempo suficiente desde que a última modal foi fechada
            const finalTimeSinceLastModalClosed = lastModalClosedTimeRef.current ? (Date.now() - lastModalClosedTimeRef.current) : Infinity
            const finalCanChangeTurn =
              canSafelyHandoffTurn({
                modalLocks: finalModalLocks,
                opening: !!finalOpening,
                eventsInProgress: !!finalEvents,
              }) &&
              (finalTimeSinceLastModalClosed >= 100 || !lastModalClosedTimeRef.current)
            
              // ✅ CORREÇÃO: Verifica se ainda sou o dono do lock (pode ter mudado via SYNC)
              if (finalCanChangeTurn && finalTurnIdx === turnIdx && finalIsLockOwner) {
                console.log('[DEBUG] ✅ Mudando turno - de:', turnIdx, 'para:', turnData.nextTurnIdx, 'finalModalLocks:', finalModalLocks, 'finalOpening:', finalOpening, 'timeSinceLastModalClosed:', finalTimeSinceLastModalClosed)
              
              // ✅ CORREÇÃO C: Detecta finalização por rodada ANTES de mudar turno
              // Condição autoritativa: currentRoundRef.current === MAX_ROUNDS E shouldIncrementRound === true
              // OU endGame === true (todos chegaram na rodada final)
              // (não usa pos/TRACK_LEN - apenas round-based)
              const isEndgameCondition = currentRoundRef.current === MAX_ROUNDS && turnData.shouldIncrementRound
              const isEndgameByFlag = turnData.endGame === true
              if (isEndgameCondition || isEndgameByFlag || (turnData.shouldIncrementRound && turnData.nextRound > MAX_ROUNDS)) {
                console.log('[ENDGAME] detectado: fim da partida - currentRound:', currentRoundRef.current, 'shouldIncrementRound:', turnData.shouldIncrementRound, 'nextRound:', turnData.nextRound)
                
                const forceFinish =
                  isEndgameCondition ||
                  isEndgameByFlag

                // Chama maybeFinishGame para calcular vencedor
                const finishResult = maybeFinishGame(
                  latestPlayers,
                  turnData.nextRound,
                  { forceFinish }
                )
                
                if (finishResult.finished) {
                  console.log('[DEBUG] 🏁 FIM DE JOGO finalizando - Rodada:', finishResult.finalRound, 'Vencedor:', finishResult.winner?.name || null)
                  
                  // Atualiza estado local
                  setPlayers(latestPlayers)
                  setWinner(finishResult.winner)
                  setGameOver(true)
                  setRound(finishResult.finalRound)
                  currentRoundRef.current = finishResult.finalRound
                  appendLog(`Fim de jogo! ${MAX_ROUNDS} rodada(s) configurada(s). Vencedor: ${finishResult.winner?.name || '—'}`)
                  
                  // Prepara patch para broadcast
                  const patch = {
                    kind: 'ENDGAME',  // ✅ CORREÇÃO: Marca explicitamente como ENDGAME
                    round: finishResult.finalRound,
                    maxRounds: MAX_ROUNDS,
                    gameOver: true,
                    winner: finishResult.winner
                  }
                  if (turnData.nextRoundFlags) patch.roundFlags = turnData.nextRoundFlags
                  
                  // Broadcast estado final (não muda turnIdx ao encerrar)
                  broadcastState(latestPlayers, turnIdx, finishResult.finalRound, true, finishResult.winner, patch)
                  
                  // Limpa estado e libera lock
                  pendingTurnDataRef.current = null
                  setTurnLockBroadcast(false)
                  turnChangeInProgressRef.current = false
                  return
                }
              }
              
              // ✅ CORREÇÃO: Marca que mudança de turno está em progresso
              turnChangeInProgressRef.current = true
              
              // ✅ CORREÇÃO: Garante que a rodada seja atualizada antes do broadcast
              // Isso garante que o broadcast sempre use o valor correto da rodada
              const roundToBroadcast = turnData.nextRound
              const shouldIncrement = turnData.shouldIncrementRound || false
              console.log('[DEBUG] 🔄 Broadcast - Rodada a ser transmitida:', roundToBroadcast, 'Rodada atual no estado:', round, 'shouldIncrement:', shouldIncrement)

              const nextTurnSeq = (typeof turnSeqRef.current === 'number' ? turnSeqRef.current : 0) + 1

              const patch = {
                kind: 'TURN',
                roundFlags: turnData.nextRoundFlags ?? undefined,
                round: turnData.shouldIncrementRound ? roundToBroadcast : undefined,
                turnPlayerId: turnData.nextTurnPlayerId,
                turnSeq: nextTurnSeq,
                lastRollTurnKey: null,
                turnLock: false,
                lockOwner: null,
                _expectTurnPlayerId: turnData.originTurnPlayerId,
                _expectTurnSeq: turnData.originTurnSeq,
                _commitKind: 'NORMAL_HANDOFF',
                deferLocalUntilCommit: true,
              }
              if (turnData.nextRoundFlags) patch.roundFlags = turnData.nextRoundFlags
              if (turnData.shouldIncrementRound) patch.round = roundToBroadcast
              if (turnData.nextTurnPlayerId) patch.turnPlayerId = turnData.nextTurnPlayerId

              Promise.resolve(
                broadcastState(latestPlayers, turnData.nextTurnIdx, roundToBroadcast, gameOver, winner, patch)
              ).then((r) => {
                const currentTurn = {
                  turnPlayerId: turnPlayerIdRef.current,
                  turnSeq: turnSeqRef.current,
                }
                if (r?.ok === false) {
                  turnChangeInProgressRef.current = false
                  const td = pendingTurnDataRef.current
                  if (td && !isHandoffPendingObsolete(td, currentTurn)) {
                    setTimeout(tick, 400)
                  }
                  return
                }
                if (r?.applied === false) {
                  turnChangeInProgressRef.current = false
                  const td = pendingTurnDataRef.current
                  if (td && isHandoffPendingObsolete(td, currentTurn)) {
                    pendingTurnDataRef.current = null
                  }
                  return
                }
                if (typeof setTurnSeq === 'function') setTurnSeq(nextTurnSeq)
                turnSeqRef.current = nextTurnSeq
                setTurnIdx(turnData.nextTurnIdx)
                turnIdxRef.current = turnData.nextTurnIdx
                if (setTurnPlayerId) setTurnPlayerId(turnData.nextTurnPlayerId ?? null)
                turnPlayerIdRef.current = turnData.nextTurnPlayerId ?? null
                setRound(prevRound => {
                  const safeRoundToBroadcast = Math.min(MAX_ROUNDS, roundToBroadcast)
                  const finalRound = Math.min(MAX_ROUNDS, Math.max(prevRound, safeRoundToBroadcast))
                  currentRoundRef.current = finalRound
                  return finalRound
                })
                pendingTurnDataRef.current = null
                turnChangeInProgressRef.current = false
                console.log('[DEBUG] ✅ Turno mudado com sucesso - Rodada:', roundToBroadcast)
              }).catch(() => {
                turnChangeInProgressRef.current = false
              })
            } else {
              console.log('[DEBUG] ⚠️ tick - condições não atendidas, não mudando turno', { 
                finalModalLocks, 
                finalOpening, 
                finalCanChangeTurn,
                timeSinceLastModalClosed: finalTimeSinceLastModalClosed,
                finalTurnIdx, 
                turnIdx,
                finalIsLockOwner,
                isLockOwner
              })
              console.log('[DEBUG] ⚠️ tick - condições não atendidas, não mudando turno', { 
                finalModalLocks, 
                finalOpening, 
                finalTurnIdx, 
                turnIdx,
                finalIsLockOwner,
                isLockOwner
              })
              // Continua verificando
              setTimeout(tick, 150)
              return
            }
          } else {
            if (DEBUG_LOGS) console.log('[DEBUG] ⚠️ tick - turnData é null, não mudando turno. turnIdx atual:', turnIdx, 'lockOwner:', currentLockOwner, 'isLockOwner:', isLockOwner)
            // ✅ CORREÇÃO: Se não há turnData mas deveria haver, tenta novamente após um delay
            // Pode ser que o pendingTurnDataRef ainda não foi preenchido
            // ✅ CORREÇÃO: Verifica também se passou tempo suficiente desde que a última modal foi fechada
            const retryTimeSinceLastModalClosed = lastModalClosedTimeRef.current ? (Date.now() - lastModalClosedTimeRef.current) : Infinity
            const retryCanChangeTurn = currentModalLocks === 0 && (retryTimeSinceLastModalClosed >= 200 || !lastModalClosedTimeRef.current)
            
            if (isLockOwner && retryCanChangeTurn && !currentOpening) {
              // ✅ CORREÇÃO: Limita tentativas de retry
              if (tickAttempts < 10) {
                if (DEBUG_LOGS) console.log('[DEBUG] ⚠️ tick - tentando novamente em 200ms (pode ser que pendingTurnDataRef ainda não foi preenchido)')
                setTimeout(tick, 200)
                return
              } else {
                console.warn('[DEBUG] ⚠️ tick - excedeu tentativas de retry, liberando turnLock')
                setTurnLockBroadcast(false)
                turnChangeInProgressRef.current = false
              }
            } else {
              // ✅ Não libera lock aqui se não for o dono: evita corrida por não-dono
              if (isLockOwner) {
                setTurnLockBroadcast(false)
                turnChangeInProgressRef.current = false
              }
            }
          }
        } else {
          if (DEBUG_LOGS) console.log('[DEBUG] ❌ tick - não sou o dono do cadeado e não é minha vez, não mudando turno', { isLockOwner, isCurrentPlayerMe, currentLockOwner, myUid, turnIdx })
          // ✅ Não libera lock aqui: evita corrida por não-dono
        }
        return
      }
      
      // Continua verificando a cada 100ms
      setTimeout(tick, 100)
    }
    // ✅ CORREÇÃO: Adiciona um delay inicial maior para garantir que modais abertas sejam detectadas
    // Isso evita que o tick rode antes das modais serem realmente abertas
    // Verifica se há modais sendo abertas antes de iniciar o tick
    let checkAttempts = 0
    const maxCheckAttempts = 50 // ~10s com backoff
    const checkBeforeTick = () => {
      checkAttempts++
      const hasOpening = openingModalRef.current
      const hasLocks = modalLocksRef.current > 0
      if ((hasOpening || hasLocks) && checkAttempts < maxCheckAttempts) {
        // reduz spam: loga só a cada 5 tentativas
        if (DEBUG_LOGS && checkAttempts % 5 === 1) {
          console.log('[DEBUG] ⚠️ checkBeforeTick - aguardando modais...', {
            hasOpening,
            hasLocks,
            modalLocks: modalLocksRef.current,
            attempt: checkAttempts
          })
        }
        const delay = Math.min(1000, Math.floor(150 * Math.pow(1.35, checkAttempts)))
        setTimeout(checkBeforeTick, delay)
        return
      }
      // ✅ Se excedeu tentativas com pipeline real, continua esperando (não apaga locks)
      if (checkAttempts >= maxCheckAttempts) {
        const stillActive =
          openingModalRef.current ||
          eventsInProgressRef.current ||
          modalLocksRef.current > 0
        console.warn('[DEBUG] ⚠️ checkBeforeTick - excedeu tentativas', {
          hasOpening,
          hasLocks,
          eventsInProgress: eventsInProgressRef.current,
          stillActive,
        })
        if (stillActive) {
          checkAttempts = Math.floor(maxCheckAttempts / 2)
          setTimeout(checkBeforeTick, 200)
          return
        }
      }
      // Só inicia o tick se não houver modais sendo abertas
      if (DEBUG_LOGS) console.log('[DEBUG] ✅ checkBeforeTick - iniciando tick, sem modais abertas')
      tick()
    }
    // Delay inicial curto: só o necessário para IIFEs de modal marcarem openingModalRef.
    // Se não houver modal, o handoff não fica +500ms parado (solo/multiplayer).
    const initialDelay =
      (openingModalRef.current || modalLocksRef.current > 0 || eventsInProgressRef.current)
        ? 60
        : 90
    setTimeout(checkBeforeTick, initialDelay)
  } catch (error) {
    console.error('[DEBUG] Erro em advanceAndMaybeLap:', error)
    // ✅ BUG 2 FIX: Libera turnLock em caso de erro
    if (lockOwnerRef.current === String(myUid)) {
      setTurnLockBroadcast(false)
    }
    throw error
  } finally {
    // ✅ NÃO destravar aqui. O lock só cai no tick (TURN) ou no watchdog/erro.
    if (lockOwnerRef.current !== String(myUid)) {
      turnChangeInProgressRef.current = false
    }
  }
  }, [
    players, round, turnIdx, roundFlags, isMyTurn, isMine,
    myUid, myCash, gameOver,
    appendLog, broadcastState,
    setPlayers, setRound, setTurnIdx, setRoundFlags,
    setTurnLockBroadcast, requireFunds, maybeFinishGame,
    pushModal, awaitTop, closeTop,
    resolvedBoardVersion, trackLen, expensesIndex, boardDefinition
  ])

  // ========= handlers menores =========
  const nextTurn = React.useCallback(() => {
    if (gameOver || !players.length) return
    const nextTurnIdx = findNextAliveIdx(players, turnIdx)
    // ✅ CORREÇÃO MULTIPLAYER: Calcula turnPlayerId do próximo jogador
    const nextPlayer = players[nextTurnIdx]
    const nextTurnPlayerId = nextPlayer?.id ? String(nextPlayer.id) : null
    setTurnIdx(nextTurnIdx)
    if (setTurnPlayerId) setTurnPlayerId(nextTurnPlayerId)
    broadcastState(players, nextTurnIdx, currentRoundRef.current, false, null, {
      turnPlayerId: nextTurnPlayerId // ✅ CORREÇÃO: turnPlayerId autoritativo
    })
  }, [broadcastState, gameOver, players, round, setTurnIdx, setTurnPlayerId, turnIdx])

  /**
   * Auto-skip: avança turno do jogador ausente sem movimento/dado/eventos.
   * Reutiliza findNextAliveIdx (via planOfflineTurnSkip) + turnSeq + TURN patch.
   * Retorna true se o avanço local foi aplicado (CAS remoto pode ainda falhar).
   */
  const skipAbsentTurn = React.useCallback(({ expectedTurnPlayerId, expectedTurnSeq, reason } = {}) => {
    if (gameOverRef.current) return false

    const expectId = expectedTurnPlayerId != null
      ? String(expectedTurnPlayerId)
      : String(turnPlayerIdRef.current || '')
    const expectSeq = Number.isFinite(Number(expectedTurnSeq))
      ? Number(expectedTurnSeq)
      : (Number(turnSeqRef.current) || 0)
    const lastAction =
      reason === 'AUTO_PASS_TIMER' ? 'AUTO_PASS_TIMER' : 'AUTO_SKIP_OFFLINE'

    if (!expectId) return false
    if (String(turnPlayerIdRef.current || '') !== expectId) return false
    if ((Number(turnSeqRef.current) || 0) !== expectSeq) return false

    const skipGuard = shouldRejectAbsentTurnSkip({
      turnLock: !!turnLockRef.current,
      lastRollTurnKey: lastRollTurnKeyRef.current,
      expectedTurnSeq: expectSeq,
    })
    if (skipGuard.reject) {
      console.log('[TURN] skip ausente recusado:', skipGuard.reason)
      return false
    }

    const roster = Array.isArray(playersRef.current) && playersRef.current.length
      ? playersRef.current
      : (Array.isArray(players) ? players : [])

    const plan = planOfflineTurnSkip({
      players: roster,
      turnPlayerId: expectId,
      turnSeq: expectSeq,
      round: currentRoundRef.current,
      maxRounds: MAX_ROUNDS,
    })
    if (!plan) return false

    // Reconfirma imediatamente antes do commit local
    if (String(turnPlayerIdRef.current || '') !== expectId) return false
    if ((Number(turnSeqRef.current) || 0) !== expectSeq) return false
    const skipGuard2 = shouldRejectAbsentTurnSkip({
      turnLock: !!turnLockRef.current,
      lastRollTurnKey: lastRollTurnKeyRef.current,
      expectedTurnSeq: expectSeq,
    })
    if (skipGuard2.reject) return false

    const patch = {
      kind: 'TURN',
      turnPlayerId: plan.nextTurnPlayerId,
      turnSeq: plan.nextTurnSeq,
      lastRollTurnKey: null,
      lastAction,
      turnLock: false,
      lockOwner: null,
      _expectTurnPlayerId: expectId,
      _expectTurnSeq: expectSeq,
      _commitKind: lastAction === 'AUTO_PASS_TIMER' ? 'AUTO_PASS' : 'AUTO_SKIP_OFFLINE',
      deferLocalUntilCommit: true,
    }

    const commitPromise = broadcastState(
      roster,
      plan.nextTurnIdx,
      currentRoundRef.current,
      false,
      null,
      patch,
    )

    const applyEngineOnSuccess = () => {
      if (typeof setTurnSeq === 'function') setTurnSeq(plan.nextTurnSeq)
      turnSeqRef.current = plan.nextTurnSeq
      if (typeof setLastRollTurnKey === 'function') setLastRollTurnKey(null)
      lastRollTurnKeyRef.current = null
      setTurnIdx(plan.nextTurnIdx)
      turnIdxRef.current = plan.nextTurnIdx
      if (setTurnPlayerId) setTurnPlayerId(plan.nextTurnPlayerId)
      turnPlayerIdRef.current = plan.nextTurnPlayerId
      pendingTurnDataRef.current = null
      turnChangeInProgressRef.current = false
      openingModalRef.current = false
      try {
        if (lastAction === 'AUTO_PASS_TIMER') {
          appendLog?.('Turno avançado: tempo esgotado.')
        } else {
          appendLog?.('Turno avançado: jogador desconectado.')
        }
      } catch {}
    }

    if (commitPromise && typeof commitPromise.then === 'function') {
      return commitPromise.then((r) => {
        if (r?.ok === false) return false
        if (r?.applied === false) return false
        applyEngineOnSuccess()
        return true
      }).catch(() => false)
    }

    applyEngineOnSuccess()
    return true
  }, [
    players,
    MAX_ROUNDS,
    broadcastState,
    setTurnIdx,
    setTurnPlayerId,
    setTurnSeq,
    setLastRollTurnKey,
    setTurnLockBroadcast,
    appendLog,
  ])

  const applyCommittedForfeit = React.useCallback((plan, { reason } = {}) => {
    if (!plan || !plan.ok || plan.alreadyBankrupt) return Promise.resolve(false)

    const logName = plan.playerName || 'Jogador'
    if (reason === 'LEAVE') {
      appendLog(`${logName} saiu da partida e foi eliminado (falência).`)
    } else {
      appendLog(`${logName} declarou FALÊNCIA.`)
    }

    const nextPlayers = plan.nextPlayers
    const playerDeltaIds = [plan.playerId]
    const lastAction = reason === 'LEAVE' ? 'FORFEIT' : 'BANKRUPT'

    if (plan.shouldEnd) {
      const safeRound = currentRoundRef.current
      const finalWinner = plan.winner
      setWinner(finalWinner)
      commitLocalPlayers(nextPlayers)
      setGameOver(true)
      gameOverRef.current = true
      if (plan.wasTheirTurn) setTurnLockBroadcast(false)
      return Promise.resolve(broadcastState(
        nextPlayers,
        plan.nextTurnIdx,
        safeRound,
        true,
        finalWinner,
        {
          kind: 'ENDGAME',
          isStartGame: false,
          round: safeRound,
          gameOver: true,
          winner: finalWinner,
          playerDeltaIds,
          lastAction,
        }
      )).then(() => true)
    }

    commitLocalPlayers(nextPlayers)

    if (plan.turnChanged) {
      const nextTurnSeq = plan.nextTurnSeq
      if (typeof setTurnSeq === 'function') setTurnSeq(nextTurnSeq)
      turnSeqRef.current = nextTurnSeq
      const nextIdx = plan.nextTurnIdx >= 0 ? plan.nextTurnIdx : 0
      setTurnIdx(nextIdx)
      turnIdxRef.current = nextIdx
      if (setTurnPlayerId) setTurnPlayerId(plan.nextTurnPlayerId)
      turnPlayerIdRef.current = plan.nextTurnPlayerId
      setTurnLockBroadcast(false)
      if (reason === 'BANKRUPT') setShowBankruptOverlay?.(true)
      return Promise.resolve(broadcastState(
        nextPlayers,
        nextIdx,
        currentRoundRef.current,
        false,
        null,
        {
          kind: 'TURN',
          isStartGame: false,
          turnPlayerId: plan.nextTurnPlayerId,
          turnSeq: nextTurnSeq,
          lastRollTurnKey: null,
          playerDeltaIds,
          lastAction,
        }
      )).then(() => true)
    }

    return Promise.resolve(broadcastState(
      nextPlayers,
      plan.nextTurnIdx >= 0 ? plan.nextTurnIdx : turnIdxRef.current,
      currentRoundRef.current,
      false,
      null,
      {
        kind: 'PLAYER_DELTA',
        isStartGame: false,
        playerDeltaIds,
        lastAction,
      }
    )).then(() => true)
  }, [
    appendLog,
    broadcastState,
    commitLocalPlayers,
    setGameOver,
    setWinner,
    setTurnSeq,
    setTurnIdx,
    setTurnPlayerId,
    setTurnLockBroadcast,
    setShowBankruptOverlay,
  ])

  const planSelfForfeit = React.useCallback((reason) => {
    if (gameOverRef.current || endGamePendingRef.current || endGameFinalizedRef.current) {
      return Promise.resolve(false)
    }
    const myId = myUid != null ? String(myUid) : ''
    if (!myId) return Promise.resolve(false)

    const curPlayers = pendingTurnDataRef.current?.nextPlayers || playersRef.current || players
    const plan = planMatchForfeit({
      players: curPlayers,
      playerId: myId,
      turnPlayerId: turnPlayerIdRef.current,
      turnSeq: turnSeqRef.current,
      round: currentRoundRef.current,
      initialPlayerCount: initialPlayerCountRef.current,
    })
    if (!plan) return Promise.resolve(false)
    if (plan.alreadyBankrupt) return Promise.resolve(true)
    return applyCommittedForfeit(plan, { reason })
  }, [applyCommittedForfeit, myUid, players])

  const forfeitMatch = React.useCallback(
    () => planSelfForfeit('LEAVE'),
    [planSelfForfeit]
  )

  const onAction = React.useCallback((act) => {
    if (!act?.type || gameOverRef.current || endGamePendingRef.current || endGameFinalizedRef.current) return

    if (act.type === 'ROLL'){
      // ✅ HARD GUARD (ENGINE): turnPlayerId é a verdade. Sem isso, nunca executa ROLL.
      const liveTurnId = String(turnPlayerIdRef.current || turnPlayerId || '')
      if (!liveTurnId || liveTurnId !== String(myUid)) {
        console.warn('[ROLL_BLOCK] not my turn (turnPlayerId mismatch)', { turnPlayerId: liveTurnId, myUid })
        return
      }
      // ✅ CORREÇÃO: Single-writer - apenas o jogador da vez pode rolar
      if (!isMyTurn && liveTurnId !== String(myUid)) {
        console.warn('[DEBUG] ⚠️ onAction ROLL - não é minha vez, ignorando')
        return
      }
      // Lock compartilhado (dado 3D / movimento): o dono pode aplicar o ROLL.
      if (turnLockRef.current) {
        const lo = lockOwnerRef.current != null ? String(lockOwnerRef.current) : ''
        if (lo && lo !== String(myUid)) {
          console.warn('[ROLL_BLOCK] locked by other', { lockOwner: lo, myUid })
          return
        }
      }
      // ✅ CORREÇÃO: Verifica modalLocks antes de executar
      if (modalLocksRef.current > 0) {
        console.warn('[DEBUG] ⚠️ onAction ROLL - há modais abertas, ignorando')
        return
      }

      if (turnChangeInProgressRef.current) {
        console.log('[DEBUG] 🚫 onAction bloqueado - turnChangeInProgress')
        return
      }

      const currentTurnKey =
        typeof turnSeqRef.current === 'number'
          ? String(turnSeqRef.current)
          : null
      if (currentTurnKey && lastRollTurnKeyRef.current === currentTurnKey) {
        console.warn('[ROLL_BLOCK] already rolled this turn', { currentTurnKey })
        return
      }
      if (currentTurnKey) {
        lastRollTurnKeyRef.current = currentTurnKey
        try {
          if (typeof setLastRollTurnKey === 'function') setLastRollTurnKey(currentTurnKey)
        } catch {}
      }

      // Cash audit: define um trace/meta para correlacionar o "turn/action".
      // (não altera schema do state; apenas runtime)
      try {
        const traceId = `ROLL:r${currentRoundRef.current}:t${turnIdxRef.current}:${Date.now()}`
        setCashAuditContext(mkCashMeta({
          traceId,
          actionType: 'ROLL',
          reason: act.note || 'ROLL',
          origin: { file: 'src/game/useTurnEngine.jsx', fn: 'onAction(ROLL)' },
          context: { round: currentRoundRef.current },
        }))
      } catch {}

      // ===== ENGINE V2 (feature flag; shadow por padrão) =====
      // Cutover completo ainda incompleto (effects/modais). Shadow observa reduceGame
      // e SEMPRE cai no legado para não quebrar jogabilidade.
      if (isEngineV2Enabled()) {
        try {
          const snapshot = {
            players,
            turnIdx,
            turnPlayerId: String(current?.id ?? players?.[turnIdx]?.id ?? ''),
            turnLock: !!turnLock,
            lockOwner,
          }
          const { nextState, events } = reduceGame(snapshot, { type: 'ROLL', steps: act.steps }, {
            myUid,
            boardVersion: resolvedBoardVersion,
            trackLen,
          })
          runEvents(events, { logger: console })

          if (isEngineV2CutoverEnabled()) {
            // Cutover experimental: aplica só posição do reducer e ainda chama legado
            // para modais/turno — evitar double-move: NÃO aplicar nextState.players.
            console.warn(
              '[ENGINE_V2] cutover pedido, mas wiring de modais incompleto — shadow+legado.',
              { events: (events || []).map((e) => e?.type), moved: !!nextState?.players }
            )
          } else if (shouldRunEngineV2Shadow() && DEBUG_LOGS) {
            const legacyPos = Number(players?.[turnIdx]?.pos || 0)
            const v2Pos = Number(nextState?.players?.[turnIdx]?.pos)
            console.log('[ENGINE_V2][shadow]', {
              steps: act.steps,
              legacyPosHint: legacyPos,
              v2Pos,
              events: (events || []).map((e) => e?.type),
            })
          }
        } catch (e) {
          console.error('[ENGINE_V2] erro no shadow (ignorado):', e)
        }
      }

      // ✅ BUG 2 FIX: try/finally para garantir liberação de turnLock
      try {
        const started = advanceAndMaybeLap(act.steps, act.cashDelta, act.note)
        if (started === false && currentTurnKey && lastRollTurnKeyRef.current === currentTurnKey) {
          lastRollTurnKeyRef.current = null
          try {
            if (typeof setLastRollTurnKey === 'function') setLastRollTurnKey(null)
          } catch {}
        }
      } catch (error) {
        console.error('[DEBUG] Erro em advanceAndMaybeLap:', error)
        // Libera turnLock em caso de erro
        if (lockOwnerRef.current === String(myUid)) {
          setTurnLockBroadcast(false)
        }
      }
      return
    }

    if (act.type === 'RECOVERY'){
      const recover = Math.floor(Math.random()*3000)+1000
      const cur = players.find(isMine)
      if (!cur) return
      const nextPlayers = players.map(p => (isMine(p) ? { ...p, cash: p.cash + recover } : p))
      appendLog(`${cur.name} ativou Recuperação Financeira (+$${recover})`)
      setPlayers(nextPlayers)
      broadcastState(nextPlayers, turnIdx, currentRoundRef.current)
      // ✅ CORREÇÃO: Não destrava o turno - jogador continua no seu turno após recuperação
      // setTurnLockBroadcast(false)
      return
    }

    if (act.type === 'RECOVERY_CUSTOM'){
      const amount = Number(act.amount || 0)
      const cur = players.find(isMine)
      if (!cur) return
      const nextPlayers = players.map(p => (isMine(p) ? { ...p, cash: p.cash + amount } : p))
      appendLog(`${cur.name} recuperou +$${amount}`)
      setPlayers(nextPlayers)
      broadcastState(nextPlayers, turnIdx, currentRoundRef.current)
      // ✅ CORREÇÃO: Não destrava o turno - jogador continua no seu turno após recuperação
      // setTurnLockBroadcast(false)
      return
    }

    if (act.type === 'RECOVERY_MODAL') {
      if (!isMyTurn || !pushModal || !awaitTop) return
      ;(async () => {
        const res = await openModalAndWait(<RecoveryModal playerName={current?.name || 'Jogador'} currentPlayer={current} />)
        if (!res) return

        if (res?.type === 'TRIGGER_BANKRUPTCY') {
          const ok = await openModalAndWait(
            <BankruptcyModal playerName={current?.name || 'Jogador'} />
          )
          if (ok === true) {
            await onAction({ type: 'BANKRUPT' })
          }
          return
        }

        switch (res.type) {
          case 'FIRE':
            onAction?.({
              type: 'RECOVERY_FIRE',
              items: res.items,
              amount: res.totalCredit ?? res.amount ?? 0,
              note: res.note,
              creditByRole: res.creditByRole
            })
            break

          case 'REDUCE': {
            // --- SUPORTE: seleção única ou múltipla ---
            const isMulti = Array.isArray(res.items) && res.items.length > 0

            // Se veio lista, marcamos selected=true para o App.jsx aceitar (ele usa o primeiro "selected")
            const items = isMulti
              ? res.items.map((i, idx) => ({
                  ...i,
                  // garante campos padronizados
                  group: String(i.group || i.tipo || '').toUpperCase(),
                  level: String(i.level || i.nivel || '').toUpperCase(),
                  credit: Number(i.credit ?? i.amount ?? 0),
                  selected: idx === 0 ? true : !!i.selected
                }))
              : undefined

            // Seleção "principal" (o App.jsx usa sel/selection quando presente)
            const first =
              (isMulti && items?.[0]) ||
              res.selection ||
              res.sel ||
              (res.group && res.level
                ? {
                    group: String(res.group).toUpperCase(),
                    level: String(res.level).toUpperCase(),
                    credit: Number(res.credit ?? res.amount ?? 0)
                  }
                : null)

            // Valor total: total/totalCredit quando múltiplo; senão credit/amount
            const amount = Number(
              (isMulti ? (res.total ?? res.totalCredit) : undefined) ??
              first?.credit ??
              res.amount ??
              0
            )

            const note =
              res.note ||
              (isMulti
                ? `Redução múltipla +R$ ${amount.toLocaleString()}`
                : (first
                    ? `Redução ${first.group} nível ${first.level} +R$ ${amount.toLocaleString()}`
                    : `Redução +R$ ${amount.toLocaleString()}`))

            onAction?.({
              type: 'RECOVERY_REDUCE',
              // passa a lista completa para o App.jsx (ele já entende 'items' e usa o primeiro selecionado)
              items,
              selection: first || null,
              amount,
              note
            })
            break
          }

          case 'LOAN': {
            // Normaliza a resposta do empréstimo
            const pack = (typeof res.amount === 'object' && res.amount !== null)
              ? res.amount
              : {
                  amount: Number(res.amount ?? 0),
                  cashDelta: Number(res.cashDelta ?? res.amount ?? 0),
                  loan: res.loan
                }

            const amount = Number(pack.amount ?? 0)
            const cashDelta = Number(pack.cashDelta ?? amount ?? 0)
            const loan = pack.loan ?? res.loan ?? {}

            onAction?.({
              type: 'RECOVERY_LOAN',
              amount,
              cashDelta,
              loan,
              note: res.note
            })
            break
          }

          default:
            if (res.amount > 0) {
              onAction?.({ type: 'RECOVERY_CUSTOM', amount: res.amount, note: res.note })
            }
        }
      })()
      return
    }

    if (act.type === 'BANKRUPT_MODAL') {
      if (!isMyTurn || !pushModal || !awaitTop) return
      ;(async () => {
        const ok = await openModalAndWait(<BankruptcyModal playerName={current?.name || 'Jogador'} />)
        if (ok === true) onAction?.({ type: 'BANKRUPT' })
      })()
      return
    }

    if (act.type === 'RECOVERY_FIRE') {
      const curIdx = turnIdx;
      const ownerIdNow = String(players[curIdx]?.id ?? '')
      const cur = players[curIdx] || {}
      const { deltas } = buildRecoveryFireDeltas(cur, act.items || {})

      setPlayers(ps => {
        const upd = ownerIdNow ? mapById(ps, ownerIdNow, (p) => applyDeltas(p, deltas)) : ps
        broadcastState(upd, turnIdx, currentRoundRef.current);
        return upd;
      });

      appendLog(`${players[curIdx]?.name || 'Jogador'}: ${act.note || 'Demissões'}`);
      // ✅ CORREÇÃO: Não destrava o turno - jogador continua no seu turno após recuperação
      // setTurnLockBroadcast(false);
      return;
    }

    if (act.type === 'RECOVERY_LOAN') {
      const curIdx = turnIdx;
      const cur = players[curIdx];

      if (!canTakeLoan(cur || {})) {
        console.log('[LOAN DEBUG] bloqueado por empréstimo único da partida', {
          ownerId: cur?.id,
          loanTakenInMatch: cur?.loanTakenInMatch,
          loanPending: cur?.loanPending || null,
        })
        appendLog(`${cur?.name || 'Jogador'} já utilizou o empréstimo desta partida.`);
        return
      }

      const taken = applyLoanTake(cur || {}, act.amount, currentRoundRef.current)
      if (!taken.ok) {
        return
      }

      setPlayers(ps => {
        const upd = ps.map((p, i) => (i !== curIdx ? p : taken.player));
        broadcastState(upd, turnIdx, currentRoundRef.current);
        return upd;
      });

      appendLog(
        `${cur?.name || 'Jogador'} pegou empréstimo: +$${Number(taken.player.loanPending?.amount || 0).toLocaleString()}`,
      );
      // ✅ CORREÇÃO: Não destrava o turno - jogador continua no seu turno após recuperação
      // setTurnLockBroadcast(false);
      return;
    }

    if (act.type === 'BUY_MIX' || act.kind === 'MIX_BUY' || act.type === 'DIRECT_BUY_MIX') {
      const level = String(act.level || '').toUpperCase();
      const price = Math.max(0, Number(act.price ?? 0));
      if (!['A','B','C','D'].includes(level)) { setTurnLockBroadcast(false); return; }

      const curIdx = turnIdx;
      if (!canPay(curIdx, price)) { appendLog('Saldo insuficiente para comprar MIX'); setTurnLockBroadcast(false); return }

      setPlayers(ps => {
        const upd = ps.map((p, i) => {
          if (i !== curIdx) return p;
          const mixOwned = { ...(p.mixOwned || p.mix || {}), D: true };
          mixOwned[level] = true;
          return {
            ...p,
            cash: Math.max(0, (Number(p.cash) || 0) - price),
            // ✅ BUG 2 FIX: custo da compra vira bens (patrimônio), mantendo Saldo + Bens coerente
            bens: (Number(p.bens) || 0) + price,
            mixOwned,
            mix: mixOwned,
            mixLevel: level,
            mixProdutos: level
          };
        });
        broadcastState(upd, turnIdx, currentRoundRef.current);
        return upd;
      });

      appendLog(`${players[curIdx]?.name || 'Jogador'} comprou MIX nível ${level} por -$${price.toLocaleString()}`);
      setTurnLockBroadcast(false);
      return;
    }

    if (act.type === 'BUY_ERP' || act.kind === 'ERP_BUY' || act.type === 'DIRECT_BUY_ERP') {
      const level = String(act.level || '').toUpperCase();
      const price = Math.max(0, Number(act.price ?? 0));
      if (!['A','B','C','D'].includes(level)) { setTurnLockBroadcast(false); return; }

      const curIdx = turnIdx;
      if (!canPay(curIdx, price)) { appendLog('Saldo insuficiente para comprar ERP'); setTurnLockBroadcast(false); return }

      setPlayers(ps => {
        const upd = ps.map((p, i) => {
          if (i !== curIdx) return p;
          const erpOwned = { ...(p.erpOwned || p.erp || {}), D: true };
          erpOwned[level] = true;
          return {
            ...p,
            cash: Math.max(0, (Number(p.cash) || 0) - price),
            erpOwned,
            erp: erpOwned,
            erpLevel: level,
            erpSystems: { ...(p.erpSystems || {}), level }
          };
        });
        broadcastState(upd, turnIdx, currentRoundRef.current);
        return upd;
      });

      appendLog(`${players[curIdx]?.name || 'Jogador'} comprou ERP nível ${level} por -$${price.toLocaleString()}`);
      setTurnLockBroadcast(false);
      return;
    }

    if (act.type === 'RECOVERY_REDUCE') {
      const normLevel = (v) => String(v || '').toUpperCase();
      const normGroup = (v) => {
        const g = String(v || '').toUpperCase();
        if (g === 'MIX' || g === 'ERP') return g;
        if (g.includes('MIX')) return 'MIX';
        if (g.includes('ERP')) return 'ERP';
        return '';
      };

      const collectSelections = () => {
        if (Array.isArray(act.items) && act.items.length) {
          return act.items
            .filter(it => (it?.selected ?? true))
            .map(it => ({
              group: normGroup(it.group || it.kind),
              level: normLevel(it.level),
              credit: Math.max(0, Number(it.credit ?? it.amount ?? 0)),
            }))
            // ✅ CORREÇÃO: Não permite reduzir nível D (básico)
            .filter(s => (s.group === 'MIX' || s.group === 'ERP') && ['A','B','C'].includes(s.level));
        }
        const one = act.selection || act.target || null;
        if (one) {
          const s = {
            group: normGroup(one.group || one.kind),
            level: normLevel(one.level),
            credit: Math.max(0, Number(one.credit ?? one.amount ?? act.amount ?? 0)),
          };
          // ✅ CORREÇÃO: Não permite reduzir nível D (básico)
          if ((s.group === 'MIX' || s.group === 'ERP') && ['A','B','C'].includes(s.level)) {
            return [s];
          }
        }
        return [];
      };

      const selections = collectSelections();

      if (!selections.length) {
        const creditOnly = Math.max(0, Number(act.amount ?? 0));
        if (creditOnly > 0) {
          const curIdx = turnIdx;
          setPlayers(ps => {
            const upd = ps.map((p, i) =>
              i !== curIdx ? p : { ...p, cash: (Number(p.cash) || 0) + creditOnly }
            );
            broadcastState(upd, turnIdx, currentRoundRef.current);
            return upd;
          });
        }
        // ✅ CORREÇÃO: Não destrava o turno - jogador continua no seu turno
        // setTurnLockBroadcast(false);
        return;
      }

      const ensureOwnedFromLetter = (store, letter) => {
        const s = { A:false, B:false, C:false, D:false, ...(store || {}) };
        const L = normLevel(letter);
        if (!s.A && !s.B && !s.C && !s.D) {
          if (['A','B','C','D'].includes(L)) s[L] = true;
          else s.D = true;
        }
        return s;
      };
      const letterFromOwned = (s) => (s?.A ? 'A' : s?.B ? 'B' : s?.C ? 'C' : s?.D ? 'D' : '-');

      const curIdx = turnIdx;
      const cur = players[curIdx];

      // ✅ CORREÇÃO: Valida que não está tentando reduzir nível D
      const hasInvalidLevel = selections.some(s => s.level === 'D');
      if (hasInvalidLevel) {
        appendLog('Não é possível reduzir o nível D (básico).');
        return;
      }

      // ✅ CORREÇÃO: Valida que não está tentando reduzir nível já reduzido
      const reducedMix = Array.isArray(cur.reducedLevels?.MIX) ? cur.reducedLevels.MIX : [];
      const reducedErp = Array.isArray(cur.reducedLevels?.ERP) ? cur.reducedLevels.ERP : [];
      const alreadyReduced = selections.some(s => 
        (s.group === 'MIX' && reducedMix.includes(s.level)) ||
        (s.group === 'ERP' && reducedErp.includes(s.level))
      );
      if (alreadyReduced) {
        appendLog('Não é possível reduzir um nível que já foi reduzido anteriormente.');
        return;
      }

      setPlayers(ps => {
        const upd = ps.map((p, i) => {
          if (i !== curIdx) return p;

          let mixOwned = { A:false, B:false, C:false, D:false, ...(p.mixOwned || p.mix || {}) };
          let erpOwned = { A:false, B:false, C:false, D:false, ...(p.erpOwned || p.erp || {}) };

          mixOwned = ensureOwnedFromLetter(mixOwned, p.mixProdutos);
          erpOwned = ensureOwnedFromLetter(erpOwned, p.erpSistemas);

          // ✅ CORREÇÃO: Rastreia níveis reduzidos
          const newReducedMix = [...(Array.isArray(p.reducedLevels?.MIX) ? p.reducedLevels.MIX : [])];
          const newReducedErp = [...(Array.isArray(p.reducedLevels?.ERP) ? p.reducedLevels.ERP : [])];

          let totalCredit = 0;
          let currentMixLevel = String(p.mixProdutos || 'D').toUpperCase();
          let currentErpLevel = String(p.erpLevel || p.erpSistemas || 'D').toUpperCase();

          for (const s of selections) {
            totalCredit += Math.max(0, Number(s.credit || 0));
            if (s.group === 'MIX') {
              // ✅ CORREÇÃO: Se está reduzindo o nível atual, faz downgrade ANTES de remover
              if (s.level === currentMixLevel) {
                // Encontra o próximo nível disponível (B, C ou D)
                const levels = ['A', 'B', 'C', 'D'];
                const currentIdx = levels.indexOf(currentMixLevel);
                for (let idx = currentIdx + 1; idx < levels.length; idx++) {
                  const nextLevel = levels[idx];
                  // Verifica se o próximo nível está disponível (antes de remover o atual)
                  if (mixOwned[nextLevel] || nextLevel === 'D') {
                    currentMixLevel = nextLevel;
                    break;
                  }
                }
              }
              // ✅ CORREÇÃO: Remove completamente do owned (zera a variável)
              delete mixOwned[s.level];
              mixOwned[s.level] = false; // Garante que está explicitamente false
              // ✅ CORREÇÃO: Adiciona à lista de reduzidos (só uma vez por nível)
              if (!newReducedMix.includes(s.level)) {
                newReducedMix.push(s.level);
              }
            } else if (s.group === 'ERP') {
              // ✅ CORREÇÃO: Se está reduzindo o nível atual, faz downgrade ANTES de remover
              if (s.level === currentErpLevel) {
                // Encontra o próximo nível disponível (B, C ou D)
                const levels = ['A', 'B', 'C', 'D'];
                const currentIdx = levels.indexOf(currentErpLevel);
                for (let idx = currentIdx + 1; idx < levels.length; idx++) {
                  const nextLevel = levels[idx];
                  // Verifica se o próximo nível está disponível (antes de remover o atual)
                  if (erpOwned[nextLevel] || nextLevel === 'D') {
                    currentErpLevel = nextLevel;
                    break;
                  }
                }
              }
              // ✅ CORREÇÃO: Remove completamente do owned (zera a variável)
              delete erpOwned[s.level];
              erpOwned[s.level] = false; // Garante que está explicitamente false
              // ✅ CORREÇÃO: Adiciona à lista de reduzidos (só uma vez por nível)
              if (!newReducedErp.includes(s.level)) {
                newReducedErp.push(s.level);
              }
            }
          }

          // ✅ CORREÇÃO: Garante que D sempre esteja disponível se não houver outros níveis
          const hasAnyMix = mixOwned.A || mixOwned.B || mixOwned.C;
          if (!hasAnyMix) {
            mixOwned.D = true;
            // ✅ CORREÇÃO: Se só tem D, garante que está explicitamente true
            mixOwned.A = false;
            mixOwned.B = false;
            mixOwned.C = false;
          }
          const hasAnyErp = erpOwned.A || erpOwned.B || erpOwned.C;
          if (!hasAnyErp) {
            erpOwned.D = true;
            // ✅ CORREÇÃO: Se só tem D, garante que está explicitamente true
            erpOwned.A = false;
            erpOwned.B = false;
            erpOwned.C = false;
          }

          const mixLetter = letterFromOwned(mixOwned);
          const erpLetter = letterFromOwned(erpOwned);

          // ✅ CORREÇÃO: Garante que o nível atual seja atualizado corretamente após redução
          const finalMixLevel = mixLetter !== '-' ? mixLetter : (currentMixLevel || 'D');
          const finalErpLevel = erpLetter !== '-' ? erpLetter : (currentErpLevel || 'D');

          // ✅ CORREÇÃO: Cria novos objetos para garantir que o React detecte a mudança
          const newMixOwned = { ...mixOwned };
          const newErpOwned = { ...erpOwned };

          return {
            ...p,
            cash: (Number(p.cash) || 0) + totalCredit,
            mixOwned: newMixOwned,
            erpOwned: newErpOwned,
            mix: newMixOwned,
            erp: newErpOwned,
            mixProdutos: finalMixLevel,
            erpLevel: finalErpLevel,
            erpSistemas: finalErpLevel,
            // ✅ CORREÇÃO: Salva lista de níveis reduzidos
            reducedLevels: {
              MIX: newReducedMix,
              ERP: newReducedErp,
            },
          };
        });

        broadcastState(upd, turnIdx, currentRoundRef.current);
        return upd;
      });

      const total = selections.reduce((acc, s) => acc + Math.max(0, Number(s.credit || 0)), 0);
      if (selections.length === 1) {
        const s = selections[0];
        appendLog(`${cur?.name || 'Jogador'} reduziu ${s.group} nível ${s.level} e recebeu +$${total.toLocaleString()}`);
      } else {
        appendLog(`${cur?.name || 'Jogador'} reduziu ${selections.length} níveis e recebeu +$${total.toLocaleString()}`);
      }

      // ✅ CORREÇÃO: Não destrava o turno - jogador continua no seu turno após recuperação
      // setTurnLockBroadcast(false);
      return;
    }

    if (act.type === 'BANKRUPT') {
      if (String(turnPlayerIdRef.current) !== String(myUid)) return
      planSelfForfeit('BANKRUPT')
      return
    }

    if (act.type === 'FORFEIT') {
      planSelfForfeit('LEAVE')
      return
    }
    if (DEBUG_LOGS) console.log('[DEBUG] 🏁 advanceAndMaybeLap finalizada normalmente - posição final:', nextPlayers[curIdx]?.pos)
  }, [
    players, round, turnIdx, isMyTurn, isMine, myUid, myCash,
    gameOver, appendLog, broadcastState,
    setPlayers, setRound, setTurnIdx, setTurnLockBroadcast, setGameOver, setWinner,
    requireFunds, pushModal, awaitTop, closeTop, setShowBankruptOverlay,
    commitLocalPlayers, commitLocalMeta,
    decideEndgameAfterBankruptcy,
    planSelfForfeit,
    resolvedBoardVersion, trackLen,
    onTileVisit,
  ])

  // ====== auto-unlock removido ======
  // ✅ Evita liberar turno por não-dono (corrida em multi-client).
  // O lock só deve cair quando o turno muda (tick) ou em erro (catch).
  
  // ✅ CORREÇÃO: Cleanup ao desmontar componente
  React.useEffect(() => {
    return () => {
      // Limpa timeouts e refs ao desmontar
      if (turnLockTimeoutRef.current) {
        clearTimeout(turnLockTimeoutRef.current)
        turnLockTimeoutRef.current = null
      }
      turnChangeInProgressRef.current = false
      openingModalRef.current = false
    }
  }, [])

  return {
    advanceAndMaybeLap,
    onAction,
    nextTurn,
    skipAbsentTurn,
    forfeitMatch,
    modalLocks,
    lockOwner,
  }
}
