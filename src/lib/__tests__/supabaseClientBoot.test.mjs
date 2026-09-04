import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'

// O worktree usa CRLF; normalizamos para manter as asserções legíveis.
const CRLF = /\r\n/g
const clientPath = new URL('../supabaseClient.js', import.meta.url)
const providerPath = new URL('../../net/GameNetProvider.jsx', import.meta.url)
const readSource = async (path) => (await readFile(path, 'utf8')).replace(CRLF, '\n')

/**
 * Regressão de boot (P0 tela preta):
 *
 * createClient() no escopo do módulo lança "supabaseUrl is required" quando
 * VITE_SUPABASE_URL/ANON_KEY não existem (ex.: checkout sem .env, que é
 * gitignored). Como main.jsx -> App/GameNetProvider -> supabaseClient é uma
 * cadeia de import eager, o throw derruba o grafo inteiro e o
 * ReactDOM.createRoot().render() nunca executa: #root fica vazio e a página
 * aparece preta.
 *
 * O contrato do codebase ja e "sem Supabase -> online desabilitado", nao
 * "sem Supabase -> app morto".
 */

test('o client so e criado quando a configuracao existe', async () => {
  const source = await readSource(clientPath)

  // Existe um gate booleano sobre as duas variaveis antes de criar o client.
  assert.match(source, /VITE_SUPABASE_URL/)
  assert.match(source, /VITE_SUPABASE_ANON_KEY/)
  assert.match(
    source,
    /const hasSupabaseConfig\s*=\s*!!supabaseUrl\s*&&\s*!!supabaseAnon/,
    'precisa de um gate explicito de configuracao'
  )

  // O export precisa comecar pelo gate: sem config, createClient nao e avaliado.
  assert.match(
    source,
    /export const supabase = !hasSupabaseConfig/,
    'createClient nao pode rodar sem guard: derruba o boot inteiro'
  )

  // Toda ocorrencia de createClient fica atras do gate.
  const gateIndex = source.search(/const hasSupabaseConfig/)
  const createIndex = source.search(/createClient\(supabaseUrl/)
  assert.notEqual(createIndex, -1)
  assert.ok(gateIndex < createIndex, 'o gate precisa preceder a criacao do client')
})

test('sem configuracao o modulo exporta null em vez de lancar', async () => {
  const source = await readSource(clientPath)
  // O export resolve para null quando nao ha config (contrato !!supabase).
  assert.match(source, /export const supabase = !hasSupabaseConfig\s*\n\s*\?\s*null/)
})

test('o contrato de client ausente ja existe no provider', async () => {
  const source = await readSource(providerPath)
  assert.match(source, /const enabled = !!supabase && !!roomCode/)
})

/**
 * Segunda camada da mesma causa: com supabase = null, lobbies.js quebra em
 * supabase.from / supabase.channel e o LobbyList desmonta a arvore (tela preta
 * de novo). O bloqueio fica no ponto de ENTRADA, cobrindo lobbies, playersLobby
 * e spectator de uma vez; e inerte quando o .env existe.
 */

test('a entrada online e bloqueada quando nao ha client', async () => {
  const source = await readSource(new URL('../../App.jsx', import.meta.url))
  assert.match(source, /const onlineDisabledReason = supabase\s*\n\s*\?\s*''/)
  assert.match(source, /VITE_SUPABASE_URL e VITE_SUPABASE_ANON_KEY/)
  assert.match(source, /<StartScreen[\s\S]{0,300}?onlineDisabledReason=\{onlineDisabledReason\}/)
})

test('StartScreen desabilita apenas o online, nunca o jogo local', async () => {
  const source = await readSource(new URL('../../components/StartScreen.jsx', import.meta.url))
  assert.match(source, /onlineDisabledReason = ''/)
  assert.match(source, /const canEnter = \(name \|\| ''\)\.trim\(\)\.length > 0 && !onlineDisabledReason/)
  // handleEnter tambem barra, nao so o disabled do botao
  assert.match(source, /if \(!cleaned \|\| onlineDisabledReason\) return/)

  // "Jogar neste dispositivo" nao pode depender da configuracao de rede
  const localBtn = source.slice(source.search(/startBtn--local/), source.search(/startBtn--local/) + 200)
  assert.doesNotMatch(localBtn, /onlineDisabledReason|disabled/)
})
