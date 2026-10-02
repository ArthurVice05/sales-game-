/**
 * Treinamento na Calc: seleção múltipla de profissionais × certificações.
 * Somente lê as regras existentes (CERT_EFFECTS, trainingPrice, applyTrainingPurchase).
 */
import { CERT_EFFECTS } from '../game/gameRules.js'
import { MANUAL_CONSTANTS } from '../game/manualConstants.js'
import { applyTrainingPurchase, capacityAndAttendance, computeDespesasFor, computeFaturamentoFor } from '../game/gameMath.js'
import { computePatrimonio } from '../game/patrimonio.js'

export const TRAINING_PRODUCTS = Object.entries(CERT_EFFECTS).map(([id, effect]) => ({ id, label: effect.label, cert: effect.color }))
export const TRAINING_VENDOR_TYPES = ['comum', 'inside', 'field', 'gestor']
export const TRAINING_VENDOR_LABELS = { comum: 'Vendedor Comum', inside: 'Inside Sales', field: 'Canal Representantes', gestor: 'Gestor' }
const STAFF_FIELD = { comum: 'vendedoresComuns', inside: 'insideSales', field: 'fieldSales', gestor: 'gestores' }

export const staffCount = (player, type) => Number(player?.[STAFF_FIELD[type]] || 0)
export const ownedTrainings = (player, type) => Array.from(player?.trainingsByVendor?.[type] || [])

/** Profissionais que existem na equipe e ainda têm certificação a comprar. */
export function getTrainableTypes(player) {
  return TRAINING_VENDOR_TYPES.filter((type) => staffCount(player, type) > 0 && TRAINING_PRODUCTS.some((p) => !ownedTrainings(player, type).includes(p.id)))
}

/** Payload { purchases, grandTotal } no formato aceito por applyTrainingPurchase; null se nada a comprar. */
export function buildCalcTrainingPayload(player, vendorTypes = [], certIds = []) {
  const price = MANUAL_CONSTANTS.trainingPrice
  const purchases = []
  for (const vendorType of vendorTypes) {
    if (!(staffCount(player, vendorType) > 0)) continue
    const owned = ownedTrainings(player, vendorType)
    const items = certIds.filter((id) => CERT_EFFECTS[id] && !owned.includes(id)).map((id) => ({ id, price }))
    if (items.length) purchases.push({ vendorType, items, total: items.length * price })
  }
  if (!purchases.length) return null
  const applications = purchases.reduce((sum, p) => sum + p.items.length, 0)
  return { purchases, grandTotal: applications * price, applications }
}

const metrics = (player) => ({
  cash: Number(player.cash || 0),
  revenue: computeFaturamentoFor(player),
  expenses: computeDespesasFor(player),
  capacity: capacityAndAttendance(player).cap,
  patrimonio: computePatrimonio(player),
})

/** Preview puro (não altera o jogador). */
export function previewCalcTraining(player, payload) {
  const afterPlayer = applyTrainingPurchase(player, payload)
  return { current: metrics(player), after: metrics(afterPlayer), immediateCost: payload.grandTotal, afterPlayer }
}
