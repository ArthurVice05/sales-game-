import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'

const appPath = new URL('../../App.jsx', import.meta.url)
const startPath = new URL('../../components/StartScreen.jsx', import.meta.url)
const winnersPath = new URL('../../components/FinalWinners.jsx', import.meta.url)

test('App wires explicit game mode and a separate gameplay actor into gameplay only', async () => {
  const source = await readFile(appPath, 'utf8')
  assert.match(source, /const \[gameMode, setGameMode\] = useState\(null\)/)
  assert.match(source, /resolveGameplayActorId\(/)
  assert.match(source, /myUid: gameplayActorId/)
  assert.match(source, /<Controls[\s\S]*?myUid=\{gameplayActorId\}/)
  assert.match(source, /setTurnLockBroadcast\(true, String\(gameplayActorId\)\)/)
  assert.match(source, /updatedBy: myUid/)
  assert.doesNotMatch(source, /setMyUid\(turnPlayerId\)/)
})

test('local initialization uses v2-40 state and opens the initial authoritative-key handoff', async () => {
  const source = await readFile(appPath, 'utf8')
  assert.match(source, /phase === 'localSetup'/)
  assert.match(source, /createLocalPlayers\(names\)/)
  assert.match(source, /setTurnPlayerId\(firstPlayerId\)/)
  assert.match(source, /setTurnSeq\(0\)/)
  assert.match(source, /setRoundFlags\(new Array\(normalized\.length\)\.fill\(false\)\)/)
  assert.match(source, /setAcknowledgedLocalTurnKey\(null\)/)
  assert.match(source, /getNewGameBoardVersion\(\)/)
  assert.match(source, /<LocalTurnHandoff/)
})

test('handoff observes committed turnPlayerId plus turnSeq and never closes gameplay modals', async () => {
  const source = await readFile(appPath, 'utf8')
  assert.match(source, /localTurnKey\(turnPlayerId, turnSeq\)/)
  assert.match(source, /isLocalTurnReady\(\{[\s\S]*?acknowledgedTurnKey: acknowledgedLocalTurnKey/)
  assert.match(source, /gameplayActorId = useMemo/)
  assert.doesNotMatch(source, /closeModal\(|closeAll\(/)
})

test('local handoff suspends the existing timer and confirmation grants a fresh deadline', async () => {
  const source = await readFile(appPath, 'utf8')
  assert.match(source, /shouldEnableTurnTimer\(/)
  assert.match(source, /computeTurnDeadlineAt\(Date\.now\(\), turnTimeSecRef\.current\)/)
  assert.match(source, /setAcknowledgedLocalTurnKey\(currentLocalTurnKey\)/)
  assert.match(source, /gameMode === GAME_MODE\.LOCAL && turnIdentityChanged/)
  // A suspensão do deadline no handoff é exclusiva do modo local.
  assert.match(source, /if \(gameMode === GAME_MODE\.LOCAL && !localTurnReady\) \{[\s\S]{0,120}?setTurnDeadlineAt\(null\)/)
})

test('local mode disables network/channel operations while retaining online paths', async () => {
  const source = await readFile(appPath, 'utf8')
  assert.match(source, /shouldCreateGameBroadcastChannel\(/)
  assert.doesNotMatch(source, /`sg-sync:\$\{currentLobbyId \|\| 'local'\}`/)
  assert.match(source, /gameMode !== GAME_MODE\.LOCAL && net\?\.enabled/)
  assert.match(source, /gameMode === GAME_MODE\.LOCAL[\s\S]*?setPhase\('start'\)/)
  assert.match(source, /leaveRoom\(\{ roomCode: currentLobbyId, playerId: myUid \}\)/)
})

test('entry and final result expose local-specific labels without changing ranking', async () => {
  const [startSource, winnersSource] = await Promise.all([
    readFile(startPath, 'utf8'),
    readFile(winnersPath, 'utf8'),
  ])
  assert.match(startSource, /Jogar online/i)
  assert.match(startSource, /Jogar neste dispositivo/i)
  assert.match(winnersSource, /exitLabel/)
  assert.match(winnersSource, /rankPlayersByPatrimonio/)
})
