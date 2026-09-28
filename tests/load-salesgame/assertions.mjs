export class LabFailure extends Error {
  constructor(code, detail) { super(`${code}: ${detail}`); this.code = code }
}
export function verifyRoster(players, expected) {
  if (players.length !== 4 || new Set(players.map(p => p.id)).size !== 4) throw new LabFailure('identity', 'quatro identidades distintas obrigatórias')
  if (new Set(players.map(p => p.seat)).size !== 4 || players.some(p => !Number.isInteger(p.seat))) throw new LabFailure('seat', 'assento ausente ou duplicado')
  if (players.some(p => !expected.some(e => e.id === p.id && e.name === p.name))) throw new LabFailure('contamination', 'identidade/nome de outra sala')
  if (players.some(p => p.isBot || p.bot)) throw new LabFailure('ai', 'máquina detectada; IA não faz parte da carga')
}
export function verifyDelta(before, after, actorId, expectedDelta) {
  for (const player of before) {
    const next = after.find(p => p.id === player.id)
    if (!next) throw new LabFailure('identity', 'jogador sumiu durante ação')
    for (const field of Object.keys(expectedDelta)) {
      const want = player.id === actorId ? expectedDelta[field] : 0
      if (!Number.isFinite(player[field]) || !Number.isFinite(next[field]) || Math.abs(next[field] - player[field] - want) > .01) {
        throw new LabFailure('effect-delta', `delta ${field} incorreto para ${player.id}: esperado ${want}, observado ${next[field] - player[field]}`)
      }
    }
  }
}
export function canonicalState(state) {
  if (!state) return null
  return JSON.stringify({ turn: state.turnPlayerId, seq: state.turnSeq, round: state.round, gameOver: state.gameOver,
    players: [...state.players].sort((a, b) => a.id.localeCompare(b.id)).map(p => ({ id: p.id, name: p.name, seat: p.seat, cash: p.cash, bens: p.bens, pos: p.pos, bankrupt: !!p.bankrupt })) })
}
export function verifyInitial(players) {
  // Independent fixture from the current manual, not recomputed with the production helper.
  for (const p of players) if (p.cash !== 18000 || p.bens !== 4000 || p.pos !== 0) throw new LabFailure('initial-state', 'kit inicial diverge do cenário controlado 18000/4000/casa 0')
}
export function parseMoney(text) {
  const match = String(text).match(/(-?)\s*(?:R\$|\$)\s*(-?)([\d.,]+)/)
  if (!match) return null
  const raw = match[3]
  // UI has both toLocaleString() (en-US in some browsers) and pt-BR.
  const decimal = /^(.*)[.,](\d{1,2})$/.exec(raw)
  const number = decimal ? Number(decimal[1].replace(/[.,]/g, '') + '.' + decimal[2]) : Number(raw.replace(/[.,]/g, ''))
  return (match[1] || match[2] ? -1 : 1) * number
}
