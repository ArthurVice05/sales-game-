/**
 * Resumo somente leitura da empresa para modais de compra.
 * Fonte: snapshot do comprador + capacityAndAttendance (gameMath).
 * Não inventa zeros: campo ausente → null / omitido.
 */
import { capacityAndAttendance } from '../game/gameMath.js'
import { CERT_EFFECTS } from '../game/gameRules.js'

const VENDOR_CERT_LABELS = Object.freeze({
  comum: 'Vendedores Comuns',
  field: 'Canal representantes',
  inside: 'Inside Sales',
  gestor: 'Gestores Comerciais',
})

function hasOwn(obj, key) {
  return !!obj && Object.prototype.hasOwnProperty.call(obj, key) && obj[key] != null
}

function readNumber(player, keys) {
  for (const key of keys) {
    if (!hasOwn(player, key)) continue
    const n = Number(player[key])
    if (Number.isFinite(n)) return n
  }
  return null
}

function readLevel(player, keys) {
  for (const key of keys) {
    if (!hasOwn(player, key)) continue
    const raw = String(player[key]).trim().toUpperCase()
    if (raw) return raw
  }
  return null
}

function formatCertId(id) {
  const effect = CERT_EFFECTS[id]
  if (effect?.label) return effect.label
  if (id == null || id === '') return null
  return String(id)
}

function buildCertifications(player) {
  if (!hasOwn(player, 'trainingsByVendor')) return null
  const byType = player.trainingsByVendor
  if (!byType || typeof byType !== 'object') return null
  const rows = []
  for (const [type, label] of Object.entries(VENDOR_CERT_LABELS)) {
    if (!hasOwn(byType, type)) continue
    const ids = Array.isArray(byType[type]) ? byType[type] : []
    const labels = [...new Set(ids.map(formatCertId).filter(Boolean))]
    if (labels.length === 0) continue
    rows.push({ type, label, certLabels: labels })
  }
  return rows.length ? rows : null
}

/**
 * @param {{ player?: object|null, cash?: number|null }} args
 * @returns {object} modelo de apresentação (somente leitura)
 */
export function buildCompanySnapshotSummary({ player = null, cash = null } = {}) {
  const p = player && typeof player === 'object' ? player : null
  const cashFromProp = cash != null && Number.isFinite(Number(cash)) ? Number(cash) : null
  const cashFromPlayer = readNumber(p, ['cash'])
  const cashAvailable = cashFromProp != null ? cashFromProp : cashFromPlayer

  let capacity = null
  let inAttendance = null
  let spareCapacity = null
  if (p) {
    const { cap, inAtt } = capacityAndAttendance(p)
    capacity = Number(cap)
    inAttendance = Number(inAtt)
    if (Number.isFinite(capacity) && Number.isFinite(inAttendance)) {
      spareCapacity = Math.max(0, capacity - inAttendance)
    }
  }

  return {
    playerName: hasOwn(p, 'name') ? String(p.name) : null,
    cash: cashAvailable,
    clients: readNumber(p, ['clients']),
    capacity,
    inAttendance,
    spareCapacity,
    vendedoresComuns: readNumber(p, ['vendedoresComuns']),
    insideSales: readNumber(p, ['insideSales']),
    fieldSales: readNumber(p, ['fieldSales']),
    gestores: readNumber(p, ['gestores', 'gestoresComerciais', 'managers']),
    erpLevel: readLevel(p, ['erpLevel', 'erpSistemas', 'erpLevelLetter']),
    mixLevel: readLevel(p, ['mixProdutos', 'mixLevel', 'mixLevelLetter']),
    certifications: buildCertifications(p),
    isOpeningSnapshot: true,
  }
}

export { VENDOR_CERT_LABELS }
