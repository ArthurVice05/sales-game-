/**
 * Quantas pessoas estão assistindo a sala — lógica pura, sem React e sem rede.
 *
 * A assinatura de presença vive em `useSpectatorCount` e usa um canal PRÓPRIO
 * (`spectators:<sala>`), separado do canal que transporta o estado da partida.
 * Assim o contador não interfere em nada do gameplay: espectador continua sem
 * assento, sem identidade e sem escrever no estado da sala — presença é
 * metadado de sessão, não mutação de jogo.
 */

export const SPECTATOR_PRESENCE_ROLE = 'spectator'

/** Nome do canal de presença. Nulo quando não há sala. */
export function spectatorChannelName (roomCode) {
  const code = String(roomCode ?? '').trim()
  return code ? `spectators:${code}` : null
}

/**
 * Conta pessoas assistindo a partir do estado de presença do Realtime.
 * Uma chave = uma pessoa, mesmo com várias entradas (reconexão/aba duplicada).
 */
export function countSpectators (presenceState) {
  if (!presenceState || typeof presenceState !== 'object' || Array.isArray(presenceState)) return 0
  let total = 0
  for (const entries of Object.values(presenceState)) {
    if (!Array.isArray(entries)) continue
    if (entries.some((meta) => meta?.role === SPECTATOR_PRESENCE_ROLE)) total += 1
  }
  return total
}

/** Rótulo acessível do contador. Singular/plural sem inventar número. */
export function spectatorCountLabel (count) {
  const n = Number.isFinite(Number(count)) ? Math.max(0, Math.trunc(Number(count))) : 0
  if (n === 0) return 'Nenhum espectador'
  return n === 1 ? '1 espectador' : `${n} espectadores`
}
