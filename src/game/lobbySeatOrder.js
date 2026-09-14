/**
 * Ordem autoritativa de seats no início da partida.
 * Fonte: joined_at (lobby) → index estável da lista → ordem de entrada no array.
 * Nunca usa UUID/id lexicográfico.
 */

function joinTimestamp(p) {
  return p?.joined_at || p?.joinedAt || p?.created_at || p?.createdAt || null
}

function lobbyIndex(p) {
  if (Number.isInteger(p?.index)) return p.index
  if (Number.isInteger(p?.joinOrder)) return p.joinOrder
  return null
}

/**
 * Comparador determinístico para roster pré-seat.
 * @returns {number}
 */
export function compareLobbyJoinOrder(a, b) {
  const timeA = joinTimestamp(a)
  const timeB = joinTimestamp(b)
  if (timeA && timeB) {
    const d = new Date(timeA).getTime() - new Date(timeB).getTime()
    if (d !== 0) return d
  } else if (timeA && !timeB) {
    return -1
  } else if (!timeA && timeB) {
    return 1
  }

  const idxA = lobbyIndex(a)
  const idxB = lobbyIndex(b)
  if (idxA != null && idxB != null && idxA !== idxB) return idxA - idxB

  const ordA = Number.isInteger(a?._stableOrder) ? a._stableOrder : null
  const ordB = Number.isInteger(b?._stableOrder) ? b._stableOrder : null
  if (ordA != null && ordB != null) return ordA - ordB

  // Empate: preservar ordem relativa (sort estável). Nunca localeCompare(id).
  return 0
}

/**
 * Ordena jogadores do lobby para atribuição de seats (sem mutar entrada).
 */
export function sortLobbyPlayersForSeats(rawPlayers) {
  const list = Array.isArray(rawPlayers) ? rawPlayers : []
  return list
    .map((p, i) => ({ ...p, _stableOrder: i }))
    .sort(compareLobbyJoinOrder)
    .map(({ _stableOrder, ...rest }) => rest)
}

/**
 * Atribui seat e joinOrder 0..n-1 na ordem autoritativa de entrada.
 */
export function assignSeatsByJoinOrder(rawPlayers) {
  return sortLobbyPlayersForSeats(rawPlayers).map((p, i) => ({
    ...p,
    seat: i,
    joinOrder: i,
  }))
}

/**
 * Payload enxuto do lobby → App (preserva joined_at + index).
 */
export function normalizeLobbyPlayersForStart(lobbyRows) {
  const rows = Array.isArray(lobbyRows) ? lobbyRows : []
  return rows.map((p, i) => ({
    id: p.player_id ?? p.id,
    name: p.player_name ?? p.name,
    index: i,
    joined_at: p.joined_at ?? p.joinedAt ?? null,
  }))
}
