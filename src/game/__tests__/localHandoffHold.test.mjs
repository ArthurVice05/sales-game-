import test from 'node:test'
import assert from 'node:assert/strict'

import {
  GAME_MODE,
  LOCAL_HANDOFF_MIN_DURATION_MS,
  isLocalHandoffHoldSatisfied,
  localHandoffCountdownSeconds,
  localHandoffRemainingMs,
  localTurnKey,
  resolveGameplayActorId,
  shouldEnableTurnTimer,
} from '../localHotseat.js'
import { computeTurnDeadlineAt } from '../turnTimerLogic.js'

/**
 * Transição de turno com duração mínima (~5s) — camada de APRESENTAÇÃO.
 *
 * O motor continua commitando turnPlayerId/turnSeq imediatamente; o que espera
 * é apenas a liberação do próximo jogador (§5, §6, §9, §10).
 */

test('a duracao minima do handoff e uma constante de 5 segundos (§8)', () => {
  assert.equal(LOCAL_HANDOFF_MIN_DURATION_MS, 5000)
})

test('localHandoffRemainingMs decresce de 5000 ate 0 sem passar do zero (§13)', () => {
  const t0 = 1_000_000
  assert.equal(localHandoffRemainingMs({ startedAt: t0, now: t0 }), 5000)
  assert.equal(localHandoffRemainingMs({ startedAt: t0, now: t0 + 1 }), 4999)
  assert.equal(localHandoffRemainingMs({ startedAt: t0, now: t0 + 2500 }), 2500)
  assert.equal(localHandoffRemainingMs({ startedAt: t0, now: t0 + 4999 }), 1)
  assert.equal(localHandoffRemainingMs({ startedAt: t0, now: t0 + 5000 }), 0)
  assert.equal(localHandoffRemainingMs({ startedAt: t0, now: t0 + 9999 }), 0, 'nunca negativo')
})

test('localHandoffRemainingMs e fail-safe: sem timestamp nao prende o jogador', () => {
  const t0 = 1_000_000
  for (const startedAt of [null, undefined, NaN, 'abc', {}]) {
    assert.equal(
      localHandoffRemainingMs({ startedAt, now: t0 }), 0,
      `startedAt=${String(startedAt)} deveria liberar, nunca travar`
    )
  }
  // relógio andando para trás não pode gerar espera infinita
  assert.equal(localHandoffRemainingMs({ startedAt: t0, now: t0 - 60_000 }), 5000)
})

test('isLocalHandoffHoldSatisfied so libera a partir dos 5 segundos (§13)', () => {
  const t0 = 1_000_000
  assert.equal(isLocalHandoffHoldSatisfied({ startedAt: t0, now: t0 }), false)
  assert.equal(isLocalHandoffHoldSatisfied({ startedAt: t0, now: t0 + 4_999 }), false)
  assert.equal(isLocalHandoffHoldSatisfied({ startedAt: t0, now: t0 + 5_000 }), true)
  assert.equal(isLocalHandoffHoldSatisfied({ startedAt: t0, now: t0 + 5_001 }), true)
  // sem timestamp: liberado (fail-safe)
  assert.equal(isLocalHandoffHoldSatisfied({ startedAt: null, now: t0 }), true)
})

test('localHandoffCountdownSeconds mostra 5,4,3,2,1 e depois 0', () => {
  const t0 = 1_000_000
  assert.equal(localHandoffCountdownSeconds({ startedAt: t0, now: t0 }), 5)
  assert.equal(localHandoffCountdownSeconds({ startedAt: t0, now: t0 + 500 }), 5)
  assert.equal(localHandoffCountdownSeconds({ startedAt: t0, now: t0 + 1_000 }), 4)
  assert.equal(localHandoffCountdownSeconds({ startedAt: t0, now: t0 + 2_000 }), 3)
  assert.equal(localHandoffCountdownSeconds({ startedAt: t0, now: t0 + 3_000 }), 2)
  assert.equal(localHandoffCountdownSeconds({ startedAt: t0, now: t0 + 4_000 }), 1)
  assert.equal(localHandoffCountdownSeconds({ startedAt: t0, now: t0 + 5_000 }), 0)
  assert.equal(localHandoffCountdownSeconds({ startedAt: t0, now: t0 + 60_000 }), 0)
})

test('duracao customizada e respeitada sem virar magic number', () => {
  const t0 = 1_000_000
  assert.equal(localHandoffRemainingMs({ startedAt: t0, now: t0 + 500, minDurationMs: 2000 }), 1500)
  assert.equal(isLocalHandoffHoldSatisfied({ startedAt: t0, now: t0 + 2000, minDurationMs: 2000 }), true)
  // duração inválida cai no padrão
  assert.equal(localHandoffRemainingMs({ startedAt: t0, now: t0, minDurationMs: NaN }), 5000)
  assert.equal(localHandoffRemainingMs({ startedAt: t0, now: t0, minDurationMs: -1 }), 0)
})

/* ============ O MOTOR NÃO PODE SER ATRASADO PELA ESPERA (§5, §10) ======== */

test('durante a espera o proximo jogador NAO tem autoridade de gameplay (§10)', () => {
  // O motor já commitou turnPlayerId=B, mas enquanto localTurnReady=false
  // o ator de gameplay continua nulo — a espera não muda essa regra.
  assert.equal(resolveGameplayActorId({
    gameMode: GAME_MODE.LOCAL,
    localTurnReady: false,
    turnPlayerId: 'B',
    myUid: 'A',
  }), null)

  // e depois da confirmação, B assume
  assert.equal(resolveGameplayActorId({
    gameMode: GAME_MODE.LOCAL,
    localTurnReady: true,
    turnPlayerId: 'B',
    myUid: 'A',
  }), 'B')
})

test('o cronometro do turno fica suspenso durante a espera (§9)', () => {
  assert.equal(shouldEnableTurnTimer({ gameMode: GAME_MODE.LOCAL, localTurnReady: false }), false)
  assert.equal(shouldEnableTurnTimer({ gameMode: GAME_MODE.LOCAL, localTurnReady: true }), true)
  // online nunca é afetado por esta mudança
  assert.equal(shouldEnableTurnTimer({ gameMode: GAME_MODE.ONLINE, localTurnReady: false }), true)
})

test('B recebe o tempo INTEGRAL contado da confirmacao, nao do inicio do turno (§14)', () => {
  const turnTimeSec = 90
  const t0 = 1_000_000              // turno de B commitado pelo motor
  const confirmadoEm = t0 + 5_000   // B confirma após a espera de 5s

  const deadline = computeTurnDeadlineAt(confirmadoEm, turnTimeSec)

  // expected independente: confirmação + 90s
  assert.equal(deadline, confirmadoEm + 90_000)
  // e NÃO o deadline que teria saído do instante do commit
  assert.notEqual(deadline, computeTurnDeadlineAt(t0, turnTimeSec))
  // B nao perdeu nada dos 90s por causa da espera
  assert.equal(deadline - confirmadoEm, turnTimeSec * 1000)
})

/* ================= ESPERA É POR CHAVE DE TURNO (§15) ==================== */

test('a espera pertence a chave turnPlayerId:turnSeq (§15)', () => {
  const chaveB = localTurnKey('B', 7)
  const chaveC = localTurnKey('C', 8)
  assert.notEqual(chaveB, chaveC)

  // Cenário: espera de B começa em t0; o estado pula para C antes dos 5s.
  const t0 = 1_000_000
  const agora = t0 + 3_000

  // Enquanto a chave for a de B, a espera de B vale.
  assert.equal(isLocalHandoffHoldSatisfied({ startedAt: t0, now: agora }), false)

  // Ao trocar para C, o startedAt precisa ser reiniciado — se o chamador
  // reaproveitasse o t0 de B, C seria liberado cedo demais.
  const startedAtC = agora
  assert.equal(isLocalHandoffHoldSatisfied({ startedAt: startedAtC, now: agora }), false)
  assert.equal(
    isLocalHandoffHoldSatisfied({ startedAt: startedAtC, now: agora + 5_000 }), true,
    'C precisa dos seus proprios 5s'
  )
})

/* ================= FIAÇÃO NO APP / OVERLAY (§13, §16, §17) ============== */

const CRLF = /\r\n/g
const lerFonte = async (url) => (await (await import('node:fs/promises')).readFile(url, 'utf8')).replace(CRLF, '\n')

test('App reinicia a espera a cada nova chave de turno e limpa o interval (§15, §16, §17)', async () => {
  const src = await lerFonte(new URL('../../App.jsx', import.meta.url))

  // um unico efeito, chaveado por (handoff aberto, chave do turno)
  assert.match(src, /useEffect\(\(\) => \{\s*\n\s*if \(!localHandoffOpen \|\| !currentLocalTurnKey\) \{[\s\S]{0,500}?\}, \[localHandoffOpen, currentLocalTurnKey\]\)/)
  // startedAt reiniciado no inicio de cada espera
  assert.match(src, /const inicio = Date\.now\(\)\s*\n\s*setLocalHandoffStartedAt\(inicio\)/)
  // interval unico e limpo no unmount / troca de chave
  assert.match(src, /const id = setInterval\(\(\) => setLocalHandoffNow\(Date\.now\(\)\), 250\)\s*\n\s*return \(\) => clearInterval\(id\)/)
  // sem timestamp quando o overlay fecha
  assert.match(src, /setLocalHandoffStartedAt\(null\)/)
})

test('a espera bloqueia a liberacao e tambem a confirmacao direta (§13)', async () => {
  const src = await lerFonte(new URL('../../App.jsx', import.meta.url))

  assert.match(src, /const localHandoffReadyToConfirm =\s*\n\s*localHandoffOpen &&\s*\n\s*localHandoffHoldDone &&/)
  // guard duro dentro do confirm, nao so o botao desabilitado
  assert.match(src, /if \(!isLocalHandoffHoldSatisfied\(\{ startedAt: localHandoffStartedAt, now: Date\.now\(\) \}\)\) return/)
})

test('o motor NAO foi atrasado: nenhum setTimeout envolvendo commit de turno (§5)', async () => {
  const src = await lerFonte(new URL('../../App.jsx', import.meta.url))
  const engine = await lerFonte(new URL('../useTurnEngine.jsx', import.meta.url))

  // a espera nao pode ter sido implementada adiando o commit
  assert.doesNotMatch(src, /setTimeout\([^)]*commitTurn/i)
  assert.doesNotMatch(src, /setTimeout\([^)]*setTurnPlayerId/i)
  assert.doesNotMatch(engine, /LOCAL_HANDOFF_MIN_DURATION_MS/, 'o motor nao pode conhecer a espera visual')
  assert.doesNotMatch(engine, /localHandoffStartedAt/, 'o motor nao pode conhecer a espera visual')
})

test('a espera e exclusiva do hot-seat: online e spectator intactos (§11, §12)', async () => {
  const src = await lerFonte(new URL('../../App.jsx', import.meta.url))

  // o overlay so existe em modo local — a guarda vive no helper puro
  const hotseat = await lerFonte(new URL('../localHotseat.js', import.meta.url))
  assert.match(hotseat, /gameMode !== GAME_MODE\.LOCAL \|\| gameOver \|\| localTurnReady/)
  assert.match(src, /shouldOpenLocalHandoff\(\{/)
  // spectator continua sem autoridade, independente da espera
  assert.match(src, /const isSpectator = isSpectatorSession\(\{ gameMode, sessionRole \}\)/)
  // commit remoto nao passa a depender da espera
  assert.doesNotMatch(src, /localHandoffHoldDone[\s\S]{0,120}?commitRemoteState/)
  assert.doesNotMatch(src, /localHandoffHoldDone[\s\S]{0,120}?netCommit/)
})

test('o overlay mostra a contagem sem criar timer proprio (§17)', async () => {
  const src = await lerFonte(new URL('../../components/LocalTurnHandoff.jsx', import.meta.url))

  assert.match(src, /countdownSeconds = 0/)
  assert.match(src, /const contando = !readyToConfirm && restante > 0/)
  assert.match(src, /localHandoffCountdownValue/)
  // o componente e burro: nenhum interval/timeout proprio
  assert.doesNotMatch(src, /setInterval|setTimeout\(/)
})
