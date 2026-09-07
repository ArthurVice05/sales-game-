import { isBotPlayer } from './botTypes.js'
import { chooseBotAction } from './botPolicy.js'
import { pickSorteRevesCard, resolveSorteRevesCard } from '../sorteRevesCards.js'
import { rollFairDie } from './botRandom.js'
import {
  ACTION_SKIP,
  buildExpensesConfirmPayload,
  buildRevenueConfirmPayload,
  chooseInsufficientFundsAction,
  chooseRecoveryPayload,
  buildTriggerBankruptcyPayload,
} from './botModalContracts.js'

const MAX_RECOVERY_STEPS = 8

function botDecide(kind, actor, gameState, context) {
  const round = gameState?.round ?? 1
  const maxRounds = gameState?.maxRounds ?? 5
  const opponents = (gameState?.players || []).filter((p) => String(p?.id) !== String(actor?.id))
  const rng = context?.rng

  if (kind === 'ROLL') {
    return { type: 'ROLL', steps: rollFairDie(rng) }
  }
  if (kind === 'LUCK' || kind === 'SORTE_REVES') {
    const card = pickSorteRevesCard(rng || 0)
    return resolveSorteRevesCard(card, actor).payload
  }
  if (kind === 'REVENUE') {
    return buildRevenueConfirmPayload(context?.value)
  }
  if (kind === 'EXPENSES') {
    return buildExpensesConfirmPayload({
      expense: context?.expense,
      loanCharge: context?.loanCharge,
    })
  }
  if (kind === 'INSUFFICIENT_FUNDS') {
    if (context?.canClose === false && context?.showRecoveryOptions === false) {
      const cash = Number(context?.currentCash ?? actor?.cash ?? 0)
      const need = Number(context?.requiredAmount || 0)
      if (cash >= need) return { action: 'ACK' }
      return { action: 'BANKRUPT' }
    }
    return chooseInsufficientFundsAction(actor, {
      requiredAmount: context?.requiredAmount,
      currentCash: context?.currentCash ?? actor?.cash,
    })
  }
  if (kind === 'RECOVERY') {
    const step = Number(context?.recoveryStep || 0)
    const need = Number(context?.requiredAmount || 0)
    const cash = Number(actor?.cash ?? 0)
    const prevCash = Number(context?.previousCash ?? cash)
    if (step >= MAX_RECOVERY_STEPS) return buildTriggerBankruptcyPayload()
    const payload = chooseRecoveryPayload(actor, context)
    if (payload?.type === 'TRIGGER_BANKRUPTCY') return payload
    if (step > 1 && need > cash && cash <= prevCash) return buildTriggerBankruptcyPayload()
    if (!payload && context?.canClose === false) return buildTriggerBankruptcyPayload()
    return payload
  }
  if (kind === 'BANKRUPT') {
    return true
  }

  const choice = chooseBotAction({
    player: actor,
    opponents,
    round,
    maxRounds,
    kind,
  })
  return choice.payload || { ...ACTION_SKIP }
}

export async function requestTurnDecision({
  kind,
  actor,
  gameState,
  context,
  renderHumanModal,
} = {}) {
  if (isBotPlayer(actor)) {
    return botDecide(kind, actor, gameState, context)
  }
  if (typeof renderHumanModal === 'function') {
    return renderHumanModal()
  }
  return { ...ACTION_SKIP }
}

export { MAX_RECOVERY_STEPS }
