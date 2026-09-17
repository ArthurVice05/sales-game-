function normalizeResumeName (value) {
  return String(value ?? '')
    .normalize('NFKC')
    .trim()
    .replace(/\s+/g, ' ')
    .toLocaleLowerCase('pt-BR')
}

export function findUniqueRecoverableSeatByName (state, playerName) {
  const wanted = normalizeResumeName(playerName)
  if (!wanted) return { ok: false, reason: 'no-name', player: null }
  const matches = (Array.isArray(state?.players) ? state.players : []).filter((player) => {
    if (!player || player.bankrupt === true) return false
    if (
      player.isBot === true ||
      String(player.controller || '').toUpperCase() === 'BOT' ||
      String(player.id || '').startsWith('bot:')
    ) return false
    return normalizeResumeName(player.name) === wanted
  })
  if (matches.length !== 1) {
    return {
      ok: false,
      reason: matches.length > 1 ? 'ambiguous-name' : 'name-not-found',
      player: null,
    }
  }
  const player = matches[0]
  const playerId = String(player.id ?? '').trim()
  if (!playerId) return { ok: false, reason: 'seat-without-id', player: null }
  return {
    ok: true,
    reason: 'unique-name-match',
    player: { id: playerId, name: String(player.name ?? playerName).trim() },
  }
}
