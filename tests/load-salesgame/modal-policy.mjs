import { SORTE_REVES_CARDS, resolveCardEffect } from '../../src/modals/sorteRevesDeck.js'
import { LabFailure, parseMoney } from './assertions.mjs'

const PURCHASES = ['Vendedor Comum','Comprar Vendedores Comuns','Inside Sales','Field Sales','Gestor Comercial','Carteira de Clientes','Mix de Produtos','ERP / Sistemas','Treinamento']
export function classifyModal(modal) {
  if (!modal) return null
  const title = modal.title
  // Modal do produto, reconhecido explicitamente: nunca é um clique cego.
  if (title === 'Tour guiado' || modal.buttons.some(b => b.text === 'Pular tutorial')) return 'tutorial'
  if (title === 'Fim da partida') return 'final'
  if (title === 'Sorte e Revés') return 'fortune'
  if (PURCHASES.includes(title)) return 'purchase'
  if (title === 'Direito de Compra') return 'purchase-menu'
  if (title === 'Faturamento do mês') return 'revenue'
  if (title === 'Despesas do mês') return 'expenses'
  if (/^Saldo insuficiente/.test(title)) return 'insufficient'
  if (title.includes('RECUPERAÇÃO FINANCEIRA')) return modal.text.includes('Pegar Empréstimo') ? 'loan' : 'recovery'
  if (title === 'Declarar Falência') return 'bankruptcy'
  if (/falido|falência/i.test(title) && modal.buttons.some(b => b.text === 'OK')) return 'bankrupt-notice'
  throw new LabFailure('unknown-modal', `Modal não reconhecido: ${title}; botões: ${modal.buttons.map(b => b.text).join(' | ')}`)
}

export function expectedCard(modal, player) {
  const card = SORTE_REVES_CARDS.find(card => modal.text.includes(card.title))
  if (!card) throw new LabFailure('unknown-card', 'carta não identificada pelo título real')
  const payload = resolveCardEffect(card, player).payload
  const delta = { cash: payload.cashDelta ?? 0, clients: Math.max(0, (player.clients || 0) + (payload.clientsDelta || 0)) - (player.clients || 0) }
  if (payload.certDelta?.az) delta.az = payload.certDelta.az
  return { id: card.id, delta, certificate: payload.certDelta?.az ? 'personalizado' : null, oracle: 'production-contract' }
}

export function purchaseExpectation(title, cost) {
  const field = { 'Carteira de Clientes': 'clients', 'Vendedor Comum': 'vendedoresComuns', 'Comprar Vendedores Comuns': 'vendedoresComuns', 'Inside Sales': 'insideSales', 'Field Sales': 'fieldSales', 'Gestor Comercial': 'gestores' }[title]
  if (!field || !(cost > 0)) throw new LabFailure('purchase-expectation', title)
  // Current quantity-purchase contracts only add bens explicitly for clients.
  return { delta: { cash: -cost, bens: title === 'Carteira de Clientes' ? cost : 0, [field]: 1 }, oracle: 'visible-price-and-quantity' }
}

/** One recognized modal, explicit controls. There is no global "click any OK". */
export async function respondToModal(driver, modal) {
  const kind = classifyModal(modal), scope = driver.page.locator(modal.selector).filter({ visible: true }).last()
  const button = name => scope.getByRole('button', { name, exact: typeof name === 'string' })
  const enabled = async locator => await locator.count() === 1 && await locator.isEnabled()
  const player = driver.snapshot?.players.find(p => p.id === driver.id)
  let expectation = null, label = '', economic = false
  if (kind === 'fortune') {
    await button('OK').waitFor({ state: 'visible' })
    await driver.waitUntil(async () => enabled(button('OK')), 'carta não revelou')
    const refreshed = await driver.observe()
    expectation = expectedCard(refreshed.modal, player); economic = true; label = 'OK'
  } else if (kind === 'revenue' || kind === 'expenses') {
    const value = parseMoney(await scope.locator('.tileValueHuge').innerText())
    if (value === null) throw new LabFailure('amount-unreadable', kind)
    expectation = { delta: { cash: value }, oracle: 'visible-amount' }; economic = true; label = 'OK'
  } else if (kind === 'purchase-menu') {
    if (driver.strategy === 'save') label = 'Não comprar'
    else {
      const card = scope.locator('.tileCertCard').filter({ hasText: 'Carteira de Clientes' })
      const buy = card.getByRole('button', { name: 'Comprar', exact: true })
      if (await enabled(buy)) { await driver.clickObserved(buy, 'purchase-menu:clients'); return { kind, economic: false } }
      label = 'Não comprar'
    }
  } else if (kind === 'purchase') {
    if (driver.strategy === 'save' || driver.random() < .25) label = 'Não comprar'
    else if (['Mix de Produtos', 'ERP / Sistemas', 'Treinamento'].includes(modal.title)) {
      // Normal load covers quantity purchases. These distinct multi-selection flows
      // are explicitly refused, never guessed or silently clicked through.
      label = 'Não comprar'
    } else {
      const quantity = scope.getByRole('spinbutton')
      if (await quantity.count() !== 1) throw new LabFailure('purchase-quantity', modal.title)
      await quantity.fill('1'); await quantity.press('Tab')
      await driver.waitUntil(async () => (await quantity.inputValue()) === '1', 'quantidade não atualizou')
      const buy = button(/^(Contratar|Comprar)( por| por \$| \(|$)/).filter({ hasNotText: 'Não comprar' })
      if (await buy.count() !== 1) throw new LabFailure('purchase-control', modal.title)
      const cost = parseMoney(await buy.innerText())
      if (!(cost > 0) || !player || player.cash < cost || !await enabled(buy)) label = 'Não comprar'
      else {
        expectation = purchaseExpectation(modal.title, cost)
        economic = true
        await driver.clickObserved(buy, `purchase:${modal.title}`)
        return { kind, expectation, economic }
      }
    }
  } else if (kind === 'insufficient') {
    label = await enabled(button('Recuperação Financeira')) ? 'Recuperação Financeira' : 'OK'
  } else if (kind === 'recovery') {
    if (!driver.loanUnavailable && await enabled(button('EMPRÉSTIMO'))) label = 'EMPRÉSTIMO'
    else if (await enabled(button('DECLARAR FALÊNCIA'))) label = 'DECLARAR FALÊNCIA'
    else throw new LabFailure('recovery-subflow', 'subtela não reconhecida; evidência preservada')
  } else if (kind === 'loan') {
    const input = scope.getByPlaceholder('Digite o valor que quer emprestar')
    const max = Number(await input.getAttribute('max'))
    if (!(max > 0)) { driver.loanUnavailable = true; label = '← Voltar' }
    else {
      await input.fill(String(Math.floor(max)))
      expectation = { delta: { cash: Math.floor(max) }, oracle: 'visible-loan' }; economic = true; label = 'Pegar Empréstimo'
    }
  } else if (kind === 'tutorial') { label = 'Pular tutorial' }
  else if (kind === 'bankruptcy') { label = 'Declarar Falência'; economic = true }
  else if (kind === 'bankrupt-notice') label = 'OK'
  else throw new LabFailure('unexpected-final-action', kind)
  if (!await enabled(button(label))) throw new LabFailure('modal-control', `${kind}: ${label} ausente/desabilitado`)
  await driver.clickObserved(button(label), `${kind}:${label}`)
  return { kind, expectation, economic }
}
