import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'

const appPath = new URL('../../App.jsx', import.meta.url)
const lobbyListPath = new URL('../../pages/LobbyList.jsx', import.meta.url)
const spectatorPanelPath = new URL('../../components/SpectatorPanel.jsx', import.meta.url)
const hotseatPath = new URL('../localHotseat.js', import.meta.url)

// O worktree usa CRLF; normalizamos para manter as asserções legíveis.
const CRLF = /\r\n/g
const readSource = async (path) => (await readFile(path, 'utf8')).replace(CRLF, '\n')
const readApp = () => readSource(appPath)

/* --------------------------------------------------- papel de sessão (§8) */

test('App declara sessionRole separado de gameMode e deriva a autorização central', async () => {
  const source = await readApp()
  assert.match(source, /const \[sessionRole, setSessionRole\] = useState\(SESSION_ROLE\.PLAYER\)/)
  assert.match(source, /const isSpectator = isSpectatorSession\(\{ gameMode, sessionRole \}\)/)
  assert.match(source, /const canMutateGame = !isSpectator/)
  // gameMode continua sendo apenas online|local — spectator NÃO é modo de jogo.
  assert.doesNotMatch(source, /GAME_MODE\.SPECTATOR/)
  assert.doesNotMatch(source, /setGameMode\(\s*SESSION_ROLE/)
})

test('gameplayActorId passa a considerar o papel da sessão (§9)', async () => {
  const source = await readApp()
  assert.match(source, /resolveGameplayActorId\(\{\s*\n\s*gameMode,\s*\n\s*sessionRole,/)
  assert.match(source, /\}\), \[gameMode, sessionRole, localTurnReady, turnPlayerId, myUid\]\)/)
})

test('espectador não recebe myUid inventado (§10)', async () => {
  const source = await readApp()
  assert.doesNotMatch(source, /setMyUid\(String\(spectator/i)
  assert.doesNotMatch(source, /spectatorUuid/i)
  // O único setMyUid do fluxo de espectador não existe: nenhuma linha combina os dois.
  for (const line of source.split('\n')) {
    if (/setMyUid\(/.test(line)) assert.doesNotMatch(line, /spectator/i)
  }
})

/* ------------------------------------------- guards de mutação (§12 / §43) */

test('as seis funções de mutação têm guard de espectador respeitando seu contrato', async () => {
  const source = await readApp()

  // void permanece void
  assert.match(
    source,
    /const setTurnLockBroadcast = \(value, owner = undefined\) => \{[\s\S]{0,220}?if \(isSpectatorRef\.current\) return\n/
  )
  assert.match(
    source,
    /const onControlsAction = \(act\) => \{[\s\S]{0,220}?if \(isSpectator\) return\n/
  )

  // Promise<result> permanece Promise<result>
  assert.match(
    source,
    /const commitGamePatch = React\.useCallback\(\([\s\S]{0,220}?if \(isSpectatorRef\.current\) return Promise\.resolve\(SPECTATOR_READ_ONLY\)/
  )
  assert.match(
    source,
    /function broadcastState\([\s\S]{0,420}?if \(isSpectatorRef\.current\) return Promise\.resolve\(SPECTATOR_READ_ONLY\)/
  )
  assert.match(
    source,
    /function broadcastStart\([\s\S]{0,420}?if \(isSpectatorRef\.current\) return Promise\.resolve\(SPECTATOR_READ_ONLY\)/
  )
  assert.match(
    source,
    /async function commitRemoteState\([\s\S]{0,220}?if \(isSpectatorRef\.current\) return SPECTATOR_READ_ONLY/
  )
})

test('guards vêm antes de qualquer caminho de escrita das funções guardadas', async () => {
  const source = await readApp()
  const between = (startRe, endRe) => {
    const start = source.search(startRe)
    assert.notEqual(start, -1)
    const rest = source.slice(start)
    const guard = rest.search(/isSpectatorRef\.current/)
    const write = rest.search(endRe)
    assert.notEqual(guard, -1)
    assert.notEqual(write, -1)
    assert.ok(guard < write, 'guard precisa preceder a escrita')
  }
  between(/const commitGamePatch = React\.useCallback\(/, /netCommit\(/)
  between(/async function commitRemoteState\(/, /netCommit\(/)
  between(/function broadcastStart\(/, /broadcastState\(normalized/)
  between(/const setTurnLockBroadcast = /, /bcRef\.current\?\.postMessage/)
})

/* ---------------------------------- rebind / presença / auto-pass (§15-§17) */

test('espectador não faz rebind de assento nem toca presença (§15)', async () => {
  const source = await readApp()
  assert.match(
    source,
    /Rebind canônico[\s\S]{0,400}?if \(!isSpectatorRef\.current\) try \{/
  )
  // touchLobbyPlayer/setMatchIdentity continuam existindo só dentro do bloco de jogador
  const rebindStart = source.search(/Rebind canônico/)
  const rebindBlock = source.slice(rebindStart, rebindStart + 2200)
  assert.match(rebindBlock, /touchLobbyPlayer\(/)
  assert.match(rebindBlock, /setMatchIdentity\(/)
})

test('presença e auto-pass ficam desabilitados para espectador (§16/§17)', async () => {
  const source = await readApp()
  assert.match(source, /useGamePresenceAutoSkip\(\{[\s\S]{0,400}?enabled: !isSpectator && gameMode !== GAME_MODE\.LOCAL/)
  assert.match(source, /useTurnTimerAutoPass\(\{[\s\S]{0,400}?enabled:\s*\n\s*!isSpectator &&/)
  // watchdog de lock também não roda para espectador
  assert.match(source, /if \(isSpectator\) return undefined\n\s*if \(gameMode === GAME_MODE\.LOCAL\) return undefined/)
  // espectador nunca é host
  assert.match(source, /const iAmLobbyHost =\s*\n\s*!isSpectator &&/)
})

test('TurnTimer visual continua renderizado sem condicional de papel (§18)', async () => {
  const source = await readApp()
  const timerStart = source.search(/<TurnTimer/)
  assert.notEqual(timerStart, -1)
  const timerBlock = source.slice(timerStart, timerStart + 420)
  assert.match(timerBlock, /turnDeadlineAt=\{turnDeadlineAt\}/)
  assert.doesNotMatch(timerBlock, /isSpectator/)
  // e o espectador nunca escreve deadline novo
  assert.doesNotMatch(source, /isSpectator[\s\S]{0,80}?setTurnDeadlineAt\(/)
})

/* -------------------------------------------- BroadcastChannel (§19 / §47) */

test('BroadcastChannel do jogo considera o papel da sessão', async () => {
  const source = await readApp()
  assert.match(source, /shouldCreateGameBroadcastChannel\(\{ gameMode, sessionRole, lobbyId: currentLobbyId \}\)/)
  assert.match(source, /\), \[gameMode, sessionRole, currentLobbyId\]\)/)
})

test('localHotseat aceita sessionRole sem quebrar o hot-seat (§33/§52)', async () => {
  const source = await readSource(hotseatPath)
  assert.match(source, /export const SPECTATOR_SESSION_ROLE = 'spectator'/)
  assert.match(source, /export const PLAYER_SESSION_ROLE = 'player'/)
  assert.match(source, /if \(isSpectatorRole\(sessionRole\)\) return null/)
  assert.match(source, /if \(isSpectatorRole\(sessionRole\)\) return false/)
  // regras de hot-seat preservadas
  assert.match(source, /if \(!localTurnReady\) return null/)
  assert.match(source, /export function shouldEnableTurnTimer\(\{ gameMode, localTurnReady \} = \{\}\)/)
  assert.match(source, /export function shouldOpenLocalHandoff\(/)
})

/* ----------------------------------------------- entrada e bootstrap (§29) */

test('a entrada de espectador valida o snapshot autoritativo antes de phase=game', async () => {
  const source = await readApp()
  const start = source.search(/const enterSpectatorMode = React\.useCallback/)
  assert.notEqual(start, -1)
  const block = source.slice(start, start + 1800)

  assert.match(block, /findAuthoritativeRoomMeta\(roomCode\)/)
  assert.match(block, /resolveSpectatorEntry\(\{ roomCode, meta \}\)/)
  const validate = block.search(/resolveSpectatorEntry/)
  const enterGame = block.search(/setPhase\('game'\)/)
  assert.ok(validate < enterGame, 'validação precisa preceder phase=game')

  assert.match(block, /setSessionRole\(SESSION_ROLE\.SPECTATOR\)/)
  assert.match(block, /setGameMode\(GAME_MODE\.ONLINE\)/)
  // recusa volta às salas, sem inventar jogador
  assert.match(block, /if \(!entry\.ok\) \{[\s\S]{0,800}?setPhase\('lobbies'\)/)
  assert.doesNotMatch(block, /joinLobby|resolvePlayerIdForRoom|setMatchIdentity|setPlayerReady|touchLobbyPlayer/)
})

test('bootstrap por URL reconhece spectate e não passa por StartScreen/PlayersLobby (§48)', async () => {
  const source = await readApp()
  assert.match(source, /const spectateRequest = parseSpectateRequest\(url\.search\)/)
  assert.match(source, /if \(spectateRequest\.requested\) \{\s*\n\s*enterSpectatorMode\(spectateRequest\.roomCode\)\s*\n\s*return\s*\n\s*\}/)
  assert.match(source, /const \[spectatorBooting, setSpectatorBooting\] = useState/)
  assert.match(source, /if \(phase === 'start'\) \{\s*\n\s*if \(spectatorBooting\) \{/)
  assert.match(source, /buildSpectateSearch\(url\.search, \{ roomCode \}\)/)
})

/* --------------------------------- provider read-only, sem refatoração (§13) */

test('GameNetProvider continua recebendo estado mas não escreve em sessão read-only', async () => {
  const source = await readSource(new URL('../../net/GameNetProvider.jsx', import.meta.url))
  assert.match(source, /function GameNetProvider\(\{ roomCode, hostId, readOnly = false, children \}\)/)
  // bloqueio de commit
  assert.match(source, /if \(readOnly\) return \{ ok: false, skipped: true, reason: 'read-only-session' \}/)
  // não cria row de sala
  assert.match(source, /if \(!current && lookup\.status === 'empty' && readOnly\) \{/)
  // RECEBIMENTO permanece: realtime, polling e gate monotônico intactos
  assert.match(source, /shouldApplyRemoteRoomRow/)
  assert.match(source, /const enabled = !!supabase && !!roomCode/)
  // sem refatoração de contexto/estado global
  assert.match(source, /const Ctx = createContext\(null\)/)
})

test('main.jsx liga readOnly pela URL e pelo setter existente, sem lift de estado', async () => {
  const source = await readSource(new URL('../../main.jsx', import.meta.url))
  assert.match(source, /parseSpectateRequest\(window\.location\.search\)\.requested/)
  assert.match(source, /<GameNetProvider roomCode=\{roomCode\} readOnly=\{netReadOnly\}>/)
  assert.match(source, /window\.__setRoomCode = \(code, options = \{\}\) => \{/)
  assert.match(source, /setNetReadOnly\(!!c && !!options\.spectate\)/)
  // Root continua sem conhecer sessionRole/gameMode
  assert.doesNotMatch(source, /sessionRole|gameMode|SESSION_ROLE/)
})

test('App marca a sessão de rede como espectadora ao entrar', async () => {
  const source = await readApp()
  assert.match(source, /window\.__setRoomCode\?\.\(roomCode, \{ spectate: true \}\)/)
  // saída volta ao padrão de jogador
  assert.match(source, /const exitSpectatorMode = React\.useCallback[\s\S]{0,600}?window\.__setRoomCode\?\.\(null\)/)
})

/* ------------------------------------------------------------ saída (§31) */

test('sair do modo espectador não executa forfeit/leaveRoom/clearMatchIdentity (§49)', async () => {
  const source = await readApp()
  const start = source.search(/const exitSpectatorMode = React\.useCallback/)
  assert.notEqual(start, -1)
  const block = source.slice(start, start + 900)

  assert.doesNotMatch(block, /forfeitMatch|leaveRoom|leaveLobby|clearMatchIdentity/)
  assert.match(block, /setSessionRole\(SESSION_ROLE\.PLAYER\)/)
  assert.match(block, /setCurrentLobbyId\(null\)/)
  assert.match(block, /window\.__setRoomCode\?\.\(null\)/)
  assert.match(block, /clearSpectateFromSearch\(url\.search\)/)
  assert.match(block, /setPhase\('lobbies'\)/)

  // exitCurrentGame desvia para o fluxo de espectador antes de qualquer forfeit
  assert.match(source, /async function exitCurrentGame\(\) \{\s*\n\s*if \(isSpectator\) \{\s*\n\s*exitSpectatorMode\(\)/)
})

/* ------------------------------------------------- apresentação (§20-§26) */

test('espectador não renderiza Controls e ganha painel read-only (§20)', async () => {
  const source = await readApp()
  assert.match(source, /\{isSpectator \? \(\s*\n\s*<SpectatorPanel/)
  assert.match(source, /\{!isSpectator && \(\s*\n\s*<Controls\s*\n\s*section="primary"/)
  assert.match(source, /<span className="spectatorBadge"/)
})

test('a perspectiva do HUD é visual e não vira identidade (§23 / ajuste 2)', async () => {
  const source = await readApp()
  assert.match(source, /const spectatorViewPlayerId = useMemo/)
  assert.match(source, /resolveSpectatorViewPlayerId\(\{ turnPlayerId, players \}\)/)

  // isMine / isMyTurn / motor / Controls continuam presos ao gameplayActorId
  assert.match(source, /const isMine = React\.useCallback\(\s*\n\s*\(p\) => !!p && gameplayActorId != null/)
  assert.match(source, /myUid: gameplayActorId, meId,/)
  assert.match(source, /<Controls[\s\S]{0,400}?myUid=\{gameplayActorId\}/)

  // e o id observado nunca é usado como ator/identidade
  const forbidden = [
    /isMine[\s\S]{0,40}spectatorViewPlayerId/,
    /myUid=\{spectatorView/,
    /myUid: spectatorView/,
    /setMyUid\([^)]*spectatorView/,
    /turnPlayerId=\{spectatorView/,
  ]
  for (const re of forbidden) assert.doesNotMatch(source, re)
})

test('SpectatorPanel é puramente informativo', async () => {
  const source = await readSource(spectatorPanelPath)
  assert.match(source, /Modo espectador/)
  assert.match(source, /Turno atual/)
  assert.doesNotMatch(source, /onAction|ROLL|commit|Rolar|RECUPERA|FAL[ÊE]NCIA/i)
  // o único botão é o de saída
  assert.equal((source.match(/<button/g) || []).length, 1)
})

test('FinalWinners continua disponível para espectador com saída sem forfeit (§32/§50)', async () => {
  const source = await readApp()
  assert.match(
    source,
    /<FinalWinners[\s\S]{0,420}?exitLabel=\{\s*\n\s*isSpectator\s*\n\s*\? 'Voltar às salas'/
  )
  const fwStart = source.search(/<FinalWinners/)
  const fwBlock = source.slice(fwStart, fwStart + 520)
  assert.match(fwBlock, /players=\{players\}/)
  assert.doesNotMatch(fwBlock, /isSpectator \? null/)
})

/* --------------------------------------------------------- LobbyList (§27) */

test('LobbyList oferece assistir sem passar por joinLobby (§6/§27)', async () => {
  const source = await readSource(lobbyListPath)
  assert.match(source, /import \{ resolveLobbyEntryAction \} from '\.\.\/game\/spectatorMode\.js'/)
  assert.match(source, /onSpectateRoom/)
  assert.match(source, /function handleSpectate\(lobbyId\) \{\s*\n\s*onSpectateRoom\?\.\(lobbyId\)\s*\n\s*\}/)

  const start = source.search(/function handleSpectate/)
  const block = source.slice(start, start + 220)
  assert.doesNotMatch(block, /joinLobby|resolvePlayerIdForRoom|setMatchIdentity|setPlayerReady|touchLobbyPlayer/)
})

test('sala cheia não bloqueia o botão de assistir (§41)', async () => {
  const source = await readSource(lobbyListPath)
  assert.match(source, /const entry = resolveLobbyEntryAction\(\{/)
  assert.match(source, /const disabled = entry\.disabled/)
  // a antiga regra que bloqueava por lotação foi substituída pelo helper testado
  assert.doesNotMatch(source, /const disabled = isFull \|\| \(!isOpen && !hasLocalMatchIdentity\)/)
})

test('identidade local mantém prioridade de retomada sobre assistir (§28/§42)', async () => {
  const source = await readSource(lobbyListPath)
  assert.match(source, /if \(!isOpen && !getMatchIdentity\(lobbyId\)\?\.playerId\) \{/)
  const start = source.search(/if \(!isOpen && !getMatchIdentity/)
  const block = source.slice(start, start + 420)
  assert.match(block, /hasLocalMatchIdentity: false/)
  assert.match(block, /entry\.action === 'spectate'/)
})

test('LobbyList não cria identidade nem lê nome no caminho de espectador (§30)', async () => {
  const source = await readSource(lobbyListPath)
  // o alerta de nome obrigatório fica DEPOIS do desvio para espectador
  const spectateBranch = source.search(/entry\.action === 'spectate'/)
  const nameGuard = source.search(/Digite seu nome na tela inicial antes de entrar em salas/)
  assert.notEqual(spectateBranch, -1)
  assert.notEqual(nameGuard, -1)
  assert.ok(spectateBranch < nameGuard, 'espectador não deve exigir nome de jogador')
})

/* ----------------------------------------------------- regressão (§51/§52) */

test('fluxo online de jogador permanece intacto', async () => {
  const source = await readApp()
  assert.match(source, /onEnterRoom=\{\(id\) => \{/)
  assert.match(source, /const resolvedId = resolvePlayerIdForRoom\(id, \{ playerName: myName \}\)/)
  assert.match(source, /setMyUid\(String\(resolvedId\)\)/)
  assert.match(source, /setPhase\('playersLobby'\)/)
  assert.match(source, /leaveRoom\(\{ roomCode: currentLobbyId, playerId: myUid \}\)/)
  assert.match(source, /clearMatchIdentity\(currentLobbyId\)/)
  assert.match(source, /await forfeitMatch\(\)/)
})

test('hot-seat permanece intacto', async () => {
  const source = await readApp()
  assert.match(source, /phase === 'localSetup'/)
  assert.match(source, /<LocalTurnHandoff/)
  assert.match(source, /shouldEnableTurnTimer\(\{ gameMode, localTurnReady \}\)/)
  assert.match(source, /setAcknowledgedLocalTurnKey\(currentLocalTurnKey\)/)
  assert.match(source, /gameMode === GAME_MODE\.LOCAL && turnIdentityChanged/)
  // o desvio de espectador não intercepta a saída do modo local
  assert.match(source, /if \(isSpectator\) \{\s*\n\s*exitSpectatorMode\(\)\s*\n\s*return\s*\n\s*\}\s*\n\s*if \(gameMode === GAME_MODE\.LOCAL\) \{/)
})

test('o motor de turnos não conhece o modo espectador (§34)', async () => {
  const engine = await readSource(new URL('../useTurnEngine.jsx', import.meta.url))
  assert.doesNotMatch(engine, /spectator|sessionRole/i)
})
