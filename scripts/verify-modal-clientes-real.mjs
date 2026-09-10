/**
 * Conferência real (partida local) — Carteira de Clientes.
 * node scripts/verify-modal-clientes-real.mjs
 *
 * Partida local tem no máx. 5 rodadas (~10 turnos com 2 jogadores).
 * Não usa preferDirect longo (esgota a partida). Reinicia até cobrir Direito.
 */
import { mkdir, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import {
  launchChromeBrowser,
  pause,
  waitForSelector,
  setViewport,
  click,
  setInputValue,
} from './multiplayer-load/cdp.mjs'

const OUT = resolve('artifacts/modal-clientes-resumo')
const APP = process.env.SG_APP_URL || 'http://127.0.0.1:5174/'
const MAX_GAME_ATTEMPTS = 6

async function probe(url) {
  try {
    const r = await fetch(url, { signal: AbortSignal.timeout(2500) })
    return r.ok || (r.status >= 200 && r.status < 500)
  } catch { return false }
}

async function shot(session, name) {
  const { data } = await session.call('Page.captureScreenshot', { format: 'png' })
  const path = resolve(OUT, name)
  await writeFile(path, Buffer.from(data, 'base64'))
  return path
}

async function skipTour(session) {
  for (let i = 0; i < 8; i += 1) {
    await session.evaluate(`([...document.querySelectorAll('button')].find((b)=>/Pular tutorial/i.test(b.textContent||''))||{click(){}}).click()`)
    await pause(200)
  }
  await session.evaluate(`document.querySelectorAll('.sg-modal-backdrop').forEach((e)=>{
    if (/Tour guiado|Como jogar/i.test(e.innerText||'')) e.remove()
  })`)
}

async function uiState(session) {
  return session.evaluate(`(() => {
    const btn = document.querySelector('.btn.go')
    const title = document.querySelector('.tileModal h2, .tileModalTitle')?.textContent?.trim() || ''
    return {
      canRoll: !!(btn && !btn.disabled && btn.getAttribute('aria-disabled') !== 'true'),
      title,
      hint: (document.querySelector('.nextStepHint')?.textContent || '').trim(),
      buyerInSummary: document.querySelector('.companySnapshotPlayer')?.textContent?.trim() || null,
      gameOver: !!(document.querySelector('.finalWinners, .sg-final-results') || /Fim de jogo|Vencedores/i.test(document.body.innerText || '')),
    }
  })()`)
}

async function dismissOtherModal(session) {
  await session.evaluate(`(() => {
    const title = document.querySelector('.tileModal h2')?.textContent?.trim() || ''
    if (/Carteira de Clientes/i.test(title)) return
    const b = [...document.querySelectorAll('.tileModal button, [role="dialog"] button')]
      .find((x) => /não comprar|pular|voltar|OK|fechar|Entendi|cancel/i.test(x.textContent || ''))
    b?.click()
  })()`)
  await pause(400)
}

async function openDirectBuyClients(session) {
  await session.evaluate(`(() => {
    const cards = [...document.querySelectorAll('.tileCertCard, article')]
    const card = cards.find((el) => {
      const name = (el.querySelector('h3, .tileCertName')?.textContent || '').trim()
      return /^Carteira de Clientes$/i.test(name)
    })
    const buy = card && [...card.querySelectorAll('button')].find((b) => /Comprar/i.test(b.textContent || ''))
    buy?.click()
    return !!buy
  })()`)
  await pause(1100)
}

/** Aceita casa CLIENTS ou Direito→Carteira. Nunca descarta CLIENTS. */
async function huntClientsModal(session, { maxRolls = 24 } = {}) {
  let rolls = 0
  for (let i = 0; i < maxRolls; i += 1) {
    await skipTour(session)
    const s = await uiState(session)
    if (s.gameOver) return null
    if (/^Direito de Compra$/i.test(s.title)) {
      await openDirectBuyClients(session)
      const t = await uiState(session)
      if (/^Carteira de Clientes$/i.test(t.title)) {
        return { path: 'DIRECT_BUY', rolls, buyer: t.buyerInSummary }
      }
      await dismissOtherModal(session)
      continue
    }
    if (/^Carteira de Clientes$/i.test(s.title)) {
      return { path: 'CLIENTS_TILE', rolls, buyer: s.buyerInSummary }
    }
    if (s.title) {
      await dismissOtherModal(session)
      continue
    }
    if (s.canRoll) {
      await click(session, '.btn.go')
      rolls += 1
      await pause(2000)
      continue
    }
    await pause(400)
  }
  return null
}

async function readSummary(session) {
  return session.evaluate(`(() => {
    const root = document.querySelector('.tileModal')
    if (!root || !/Carteira de Clientes/i.test(root.querySelector('h2')?.textContent || '')) return null
    const metrics = {}
    for (const el of root.querySelectorAll('.companySnapshotMetric')) {
      const label = el.querySelector('.companySnapshotMetricLabel')?.textContent?.trim()
      const value = el.querySelector('.companySnapshotMetricValue')?.textContent?.trim()
      if (label) metrics[label] = value
    }
    const roster = {}
    for (const el of root.querySelectorAll('.companySnapshotRosterRow')) {
      const label = el.querySelector('span')?.textContent?.trim()
      const value = el.querySelector('strong')?.textContent?.trim()
      if (label) roster[label] = value
    }
    const certs = [...root.querySelectorAll('.companySnapshotCerts li')].map((el) => ({
      label: el.querySelector('span')?.textContent?.trim() || null,
      value: el.querySelector('strong')?.textContent?.trim() || null,
    }))
    const impactCash = [...root.querySelectorAll('.purchasePreviewTable tr')]
      .find((tr) => /^\\s*Caixa/i.test(tr.querySelector('td')?.textContent || ''))
      ?.querySelector('td[data-label="Agora"], td[data-label="Atual"]')
      ?.textContent?.trim() || null
    const qty = root.querySelector('input[type="number"]')?.value ?? null
    return {
      buyer: root.querySelector('.companySnapshotPlayer')?.textContent?.trim() || null,
      metrics,
      roster,
      certs,
      impactCash,
      qty,
      note: /Situação no momento da abertura/i.test(root.innerText || ''),
    }
  })()`)
}

function money(str) {
  if (str == null) return null
  const n = Number(String(str).replace(/[^\d-]/g, ''))
  return Number.isFinite(n) ? n : null
}

async function expandRoster(session) {
  await session.evaluate(`([...document.querySelectorAll('.tileModal button')].find((b)=>/O que já tenho/i.test(b.textContent||''))||{click(){}}).click()`)
  await pause(280)
}

async function collapseRoster(session) {
  await session.evaluate(`([...document.querySelectorAll('.tileModal button')].find((b)=>/Ocultar o que já tenho/i.test(b.textContent||''))||{click(){}}).click()`)
  await pause(220)
}

async function skipClients(session) {
  await session.evaluate(`([...document.querySelectorAll('.tileModal button')].find((b)=>/Não comprar/i.test(b.textContent||''))||{click(){}}).click()`)
  await pause(700)
}

async function setQty(session, n) {
  await session.evaluate(`(() => {
    for (let i = 0; i < 30; i++) {
      const minus = document.querySelector('.tileModal button[aria-label="Diminuir quantidade"]')
      if (!minus || minus.disabled) break
      minus.click()
    }
  })()`)
  await pause(60)
  for (let i = 0; i < n; i += 1) {
    await session.evaluate(`document.querySelector('.tileModal button[aria-label="Aumentar quantidade"]')?.click()`)
    await pause(40)
  }
}

async function readHudCash(session, playerName) {
  return session.evaluate(`((name) => {
    const rows = [...document.querySelectorAll('.score .row')]
    const row = rows.find((r) => (r.textContent || '').includes(name))
    if (!row) return null
    const m = String(row.textContent || '').match(/Caixa\\s*([\\d.\\s]+)/i)
    if (!m) return null
    const n = Number(String(m[1]).replace(/[^\\d]/g, ''))
    return Number.isFinite(n) ? n : null
  })(${JSON.stringify(playerName)})`)
}

async function readHudClients(session) {
  return session.evaluate(`(() => {
    const byKey = document.querySelector('[data-stat-key="clientes"]')
    const raw = byKey?.querySelector('.game-stat-value, dd')?.textContent
      || [...document.querySelectorAll('.game-stat-row')].find((el) => /^\\s*Clientes\\s*$/i.test(el.querySelector('dt')?.textContent || ''))?.querySelector('dd, .game-stat-value')?.textContent
      || ''
    if (!String(raw).trim()) return null
    const n = Number(String(raw).replace(/[^\\d-]/g, ''))
    return Number.isFinite(n) ? n : null
  })()`)
}

async function buyButtonCost(session) {
  return session.evaluate(`(() => {
    const b = [...document.querySelectorAll('.tileModal button')].find((x) => /Contratar por/i.test(x.textContent || ''))
    const n = Number(String(b?.textContent || '').replace(/[^\\d]/g, ''))
    return Number.isFinite(n) ? n : null
  })()`)
}

async function checkMobile844(sess, rep) {
  await setViewport(sess, 844, 320)
  await pause(350)
  await skipTour(sess)
  await setQty(sess, 2)
  const qtyM = await sess.evaluate(`document.querySelector('.tileModal input[type="number"]')?.value||''`)
  await sess.evaluate(`(() => { const b = document.querySelector('.tileModalBody'); if (b) b.scrollTop = 0 })()`)
  await pause(80)
  rep.captures.push(await shot(sess, 'real-mobile-844x320-collapsed.png'))
  const collapsed = await sess.evaluate(`(() => {
    const root = document.querySelector('.tileModal')
    const body = root?.querySelector('.tileModalBody')
    const footer = root?.querySelector('.tileModalFooter')
    const input = root?.querySelector('input[type="number"]')
    const fr = footer?.getBoundingClientRect()
    if (body && input) {
      const delta = input.getBoundingClientRect().top - body.getBoundingClientRect().top
      body.scrollTop = Math.max(0, body.scrollTop + delta - 12)
    }
    const ir = input?.getBoundingClientRect()
    const footerTop = fr?.top ?? window.innerHeight
    return {
      footerVisible: !!(footer && fr.height > 0 && fr.bottom <= window.innerHeight + 2),
      qtyReachable: !!(input && ir.height > 0 && ir.top >= 0 && ir.bottom <= footerTop + 1),
      hScroll: (body?.scrollWidth || 0) > (body?.clientWidth || 0) + 2,
      bodyCanScroll: body ? body.scrollHeight > body.clientHeight + 1 : false,
    }
  })()`)
  await expandRoster(sess)
  await sess.evaluate(`([...document.querySelectorAll('.tileModal button')].find((b)=>/Entenda a capacidade/i.test(b.textContent||''))||{click(){}}).click()`)
  await pause(250)
  const expanded = await sess.evaluate(`(() => {
    const root = document.querySelector('.tileModal')
    const body = root?.querySelector('.tileModalBody')
    const footer = root?.querySelector('.tileModalFooter')
    const input = root?.querySelector('input[type="number"]')
    const fr = footer?.getBoundingClientRect()
    if (body && input) {
      const delta = input.getBoundingClientRect().top - body.getBoundingClientRect().top
      body.scrollTop = Math.max(0, body.scrollTop + delta - 12)
    }
    const ir = input?.getBoundingClientRect()
    const footerTop = fr?.top ?? window.innerHeight
    return {
      qty: input?.value || '',
      footerInLayout: !!(footer && fr.height > 0 && fr.bottom <= window.innerHeight + 2),
      qtyReachable: !!(input && ir.height > 0 && ir.top >= 0 && ir.bottom <= footerTop + 1),
      hScroll: (body?.scrollWidth || 0) > (body?.clientWidth || 0) + 2,
      roster: /Vendedores Comuns|ERP\\/Sistemas/i.test(root?.innerText || ''),
      detailsOpenFooterOk: !!(footer && fr.height > 0),
    }
  })()`)
  await sess.evaluate(`(() => {
    const body = document.querySelector('.tileModalBody')
    if (body) body.scrollTop = Math.min(body.scrollHeight, 140)
  })()`)
  await pause(100)
  rep.captures.push(await shot(sess, 'real-mobile-844x320-expanded.png'))
  await setViewport(sess, 1366, 768)
  await pause(250)
  return {
    collapsed,
    expanded,
    qtyPreserved: expanded.qty === qtyM,
    ok: collapsed.footerVisible && collapsed.qtyReachable && !collapsed.hScroll
      && expanded.footerInLayout && expanded.qtyReachable && !expanded.hScroll
      && expanded.qty === qtyM && expanded.roster && expanded.detailsOpenFooterOk,
  }
}

async function startLocalGame(page, appUrl) {
  await setViewport(page, 1366, 768)
  await page.call('Page.navigate', { url: appUrl })
  await waitForSelector(page, '#playerName', 40_000)
  await skipTour(page)
  await click(page, '.startBtn--local')
  await waitForSelector(page, '#localPlayerName-0', 20_000)
  await setInputValue(page, '#localPlayerName-0', 'Ana')
  await setInputValue(page, '#localPlayerName-1', 'Bruno')
  // tempo máximo evita auto-skip durante CDP
  await page.evaluate(`(() => {
    const sel = document.querySelector('#localTurnTime')
    if (!sel) return
    const opts = [...sel.options].map((o) => Number(o.value)).filter((n) => Number.isFinite(n))
    const max = Math.max(...opts)
    sel.value = String(max)
    sel.dispatchEvent(new Event('change', { bubbles: true }))
  })()`)
  await click(page, '.localSetupStart')
  await waitForSelector(page, '.sg40GameBoard', 60_000)
  await pause(800)
  await skipTour(page)
}

async function runConferenceAttempt(page, report) {
  const local = {
    openTile: null,
    openDirect: null,
    openBuy: null,
    tileCompare: null,
    skip: null,
    buy: null,
    directCompare: null,
    mobile844x320: null,
    buyPrep: null,
  }

  // 1) primeira Carteira — evidência notebook + desistência
  const openTile = await huntClientsModal(page, { maxRolls: 20 })
  if (!openTile) return { ...local, fail: 'sem Carteira inicial' }
  local.openTile = openTile
  if (openTile.path === 'DIRECT_BUY') local.openDirect = openTile

  await setViewport(page, 1366, 768)
  await pause(200)
  report.captures.push(await shot(page, 'real-notebook-collapsed.png'))
  await setQty(page, 3)
  const qty1 = await page.evaluate(`document.querySelector('.tileModal input[type="number"]')?.value||''`)
  await expandRoster(page)
  const qty2 = await page.evaluate(`document.querySelector('.tileModal input[type="number"]')?.value||''`)
  report.captures.push(await shot(page, 'real-notebook-expanded.png'))
  const sum1 = await readSummary(page)
  local.tileCompare = {
    path: openTile.path,
    buyer: sum1?.buyer,
    qtyPreserved: qty1 === '3' && qty2 === '3',
    metrics: sum1?.metrics,
    roster: sum1?.roster,
    certs: sum1?.certs,
    cashModal: money(sum1?.metrics?.Caixa),
    cashImpact: money(sum1?.impactCash),
    cashCoherent: money(sum1?.metrics?.Caixa) === money(sum1?.impactCash),
    starterShape: {
      clients1: sum1?.metrics?.Clientes === '1',
      capacity2: sum1?.metrics?.Capacidade === '2',
      inAtt1: sum1?.metrics?.['Em atendimento'] === '1',
      comuns1: sum1?.roster?.['Vendedores Comuns'] === '1',
      erpD: sum1?.roster?.['ERP/Sistemas'] === 'Nível D',
      mixD: sum1?.roster?.['Mix de Produtos'] === 'Nível D',
      fieldOmitted: sum1?.roster?.['Canal representantes'] == null,
      insideOmitted: sum1?.roster?.['Inside Sales'] == null,
      certsOmittedOrEmpty: !sum1?.certs?.length,
    },
    note: sum1?.note === true,
  }
  await collapseRoster(page)

  const beforeSkipCash = money(sum1?.metrics?.Caixa)
  const beforeSkipClients = sum1?.metrics?.Clientes
  await skipClients(page)
  const afterSkip = await uiState(page)
  local.skip = {
    modalClosed: afterSkip.title === '',
    beforeCash: beforeSkipCash,
    beforeClients: beforeSkipClients,
    baselineCash: beforeSkipCash,
    baselineClients: beforeSkipClients,
  }

  // 2) loop: compra limpa primeiro; Direito + 844 à parte; confirma efeitos no resumo
  let buyDone = false
  for (let step = 0; step < 10; step += 1) {
    const open = await huntClientsModal(page, { maxRolls: 14 })
    if (!open) break

    const sum = await readSummary(page)
    if (sum?.buyer === sum1?.buyer && local.skip.economyUnchangedOnReopen == null && !buyDone) {
      local.skip.economyUnchangedOnReopen = (
        money(sum.metrics?.Caixa) === beforeSkipCash
        && sum.metrics?.Clientes === beforeSkipClients
      )
    }

    // Confirma compra no mesmo comprador (casa ou Direito) com caixa ainda = pós-compra
    if (buyDone && local.buy && sum?.buyer === local.buy.buyer) {
      const probeCash = money(sum.metrics?.Caixa)
      const probeClients = sum.metrics?.Clientes != null ? Number(sum.metrics.Clientes) : null
      const expected = local.buy.cashBefore - 1000
      if (probeCash === expected) {
        local.buy.cashAfterModal = probeCash
        local.buy.clientsAfter = probeClients
        local.buy.cashDroppedByCost = true
        local.buy.clientsIncreasedByOne = probeClients === local.buy.clientsBefore + 1
        local.buy.buyerAfter = sum.buyer
        console.error(`[verify] confirmou snapshot cash=${probeCash} clients=${probeClients}`)
      }
    }

    // Direito: evidência + 844×320; não compra neste modal (evita qty poluída)
    if (open.path === 'DIRECT_BUY') {
      if (!local.openDirect) {
        local.openDirect = open
        local.directCompare = {
          path: open.path,
          buyer: sum?.buyer,
          cashCoherent: money(sum?.metrics?.Caixa) === money(sum?.impactCash),
          hasSummary: !!sum?.metrics?.Caixa,
          cashModal: money(sum?.metrics?.Caixa),
          cashImpact: money(sum?.impactCash),
        }
      }
      if (!local.mobile844x320) {
        local.mobile844x320 = await checkMobile844(page, report)
      }
      await skipClients(page)
      if (buyDone && local.openDirect && local.mobile844x320?.ok
        && local.buy?.cashDroppedByCost && local.buy?.clientsIncreasedByOne) break
      continue
    }

    // Compra qty=1 só em casa CLIENTS (modal limpo)
    if (!buyDone && open.path === 'CLIENTS_TILE') {
      local.openBuy = open
      const sumBeforeBuy = await readSummary(page)
      local.buyOpening = {
        path: open.path,
        buyer: sumBeforeBuy?.buyer,
        cashModal: money(sumBeforeBuy?.metrics?.Caixa),
        cashImpact: money(sumBeforeBuy?.impactCash),
        cashCoherent: money(sumBeforeBuy?.metrics?.Caixa) === money(sumBeforeBuy?.impactCash),
        clients: sumBeforeBuy?.metrics?.Clientes,
      }

      await collapseRoster(page)
      await page.evaluate(`(() => {
        const btn = [...document.querySelectorAll('.tileModal button')].find((b) => b.getAttribute('aria-expanded') === 'true')
        btn?.click()
      })()`)
      await pause(100)
      let btnCost = null
      let qtyVal = ''
      for (let tryQty = 0; tryQty < 6; tryQty += 1) {
        await setQty(page, 1)
        await pause(80)
        btnCost = await buyButtonCost(page)
        qtyVal = await page.evaluate(`document.querySelector('.tileModal input[type="number"]')?.value||''`)
        if (btnCost === 1000 && qtyVal === '1') break
      }
      const cost = 1000
      const cashBefore = money(sumBeforeBuy?.metrics?.Caixa)
      const clientsBefore = Number(sumBeforeBuy?.metrics?.Clientes)
      const hudCashBefore = await readHudCash(page, sumBeforeBuy?.buyer || '')
      const hudClientsBefore = await readHudClients(page)
      local.buyPrep = { btnCost, qty: qtyVal, hudCashBefore, hudClientsBefore }
      if (btnCost !== cost || qtyVal !== '1') {
        console.error(`[verify] qty não fixou em 1 (qty=${qtyVal} cost=${btnCost}); skip`)
        await skipClients(page)
        continue
      }

      await page.evaluate(`([...document.querySelectorAll('.tileModal button')].find((b)=>/Contratar por/i.test(b.textContent||''))||{click(){}}).click()`)
      await pause(1200)
      await page.evaluate(`([...document.querySelectorAll('button')].find((b)=>/Entendi/i.test(b.textContent||''))||{click(){}}).click()`)
      await pause(900)
      const afterBuyUi = await uiState(page)
      const hudCashAfter = await readHudCash(page, sumBeforeBuy?.buyer || '')
      const hudClientsAfter = await readHudClients(page)
      console.error(`[verify] pós-compra hudCash ${hudCashBefore}->${hudCashAfter} clients ${hudClientsBefore}->${hudClientsAfter}`)
      report.captures.push(await shot(page, 'real-notebook-after-buy.png'))
      await setViewport(page, 844, 320)
      await pause(300)
      report.captures.push(await shot(page, 'real-mobile-844x320-after-buy.png'))
      await setViewport(page, 1366, 768)
      await pause(200)

      local.buy = {
        modalClosedAfterConfirm: afterBuyUi.title === '',
        flowContinued: !!afterBuyUi.hint || afterBuyUi.canRoll || afterBuyUi.title === '',
        cashBefore,
        clientsBefore,
        btnCost,
        hudCashBefore,
        hudCashAfter,
        hudClientsBefore,
        hudClientsAfter,
        cashDroppedByCost: hudCashAfter != null && hudCashBefore != null
          ? hudCashAfter === hudCashBefore - cost
          : null,
        clientsIncreasedByOne: hudClientsAfter != null && hudClientsBefore != null
          ? hudClientsAfter === hudClientsBefore + 1
          : null,
        singleApply: btnCost === cost,
        buyer: sumBeforeBuy?.buyer,
        buyerAfter: null,
        cashAfterModal: null,
        clientsAfter: null,
      }
      buyDone = true
      console.error(`[verify] buy done awaiting snapshot confirm; mobile=${!!local.mobile844x320?.ok} direct=${!!local.openDirect}`)
      continue
    }

    await skipClients(page)
    if (buyDone && local.openDirect && local.mobile844x320?.ok
      && local.buy?.cashDroppedByCost && local.buy?.clientsIncreasedByOne) break
  }

  // se HUD confirmou, aceita sem snapshot
  if (local.buy && local.buy.cashDroppedByCost == null && local.buy.hudCashAfter != null && local.buy.hudCashBefore != null) {
    local.buy.cashDroppedByCost = local.buy.hudCashAfter === local.buy.hudCashBefore - 1000
  }
  if (local.buy && local.buy.clientsIncreasedByOne == null && local.buy.hudClientsAfter != null && local.buy.hudClientsBefore != null) {
    local.buy.clientsIncreasedByOne = local.buy.hudClientsAfter === local.buy.hudClientsBefore + 1
  }

  local.skip.ok = local.skip.modalClosed === true
    && (local.skip.economyUnchangedOnReopen !== false)

  return local
}

async function main() {
  const report = {
    at: new Date().toISOString(),
    ok: false,
    mapping: {
      erp: ['erpLevel', 'erpSistemas', 'erpLevelLetter'],
      mix: ['mixProdutos', 'mixLevel', 'mixLevelLetter'],
      certifications: 'trainingsByVendor[comum|field|inside|gestor] → CERT_EFFECTS.label (Azul/Amarelo/Roxo)',
      zeros: 'propriedade presente com 0 → exibe; ausente/null → omite',
      cash: 'prop currentCash prioridade; fallback player.cash',
      capacity: 'capacityAndAttendance(currentPlayer) → cap / inAtt / spare',
      buyer: 'currentPlayer do fluxo (dono do turno / buyerPlayer); não host fixo',
    },
    captures: [],
    limitations: [],
    attempts: [],
  }
  await mkdir(OUT, { recursive: true })
  let chrome
  try {
    let appUrl = null
    for (const u of [APP, 'http://127.0.0.1:5174/', 'http://localhost:5174/']) {
      if (await probe(u)) { appUrl = u; break }
    }
    if (!appUrl) throw new Error('dev server down')
    report.appUrl = appUrl

    chrome = await launchChromeBrowser({
      cdpPort: Number(process.env.SG_VERIFY_CDP_PORT || 9451),
      headed: false,
      profileDir: resolve(OUT, 'chrome-real-profile'),
    })
    const ctx = await chrome.connection.createBrowserContext()
    const page = await chrome.connection.openPage('about:blank', ctx)

    report.zeroSemantics = null
    let best = null

    for (let attempt = 1; attempt <= MAX_GAME_ATTEMPTS; attempt += 1) {
      console.error(`[verify] tentativa ${attempt}/${MAX_GAME_ATTEMPTS}`)
      report.captures = []
      await startLocalGame(page, appUrl)

      if (!report.zeroSemantics) {
        report.zeroSemantics = await page.evaluate(`(async () => {
          const mod = await import('/src/modals/companySnapshotSummary.js')
          const absent = mod.buildCompanySnapshotSummary({
            cash: 1000,
            player: { name: 'X', clients: 1, vendedoresComuns: 1, erpLevel: 'D', mixProdutos: 'D' },
          })
          const withZero = mod.buildCompanySnapshotSummary({
            cash: 1000,
            player: {
              name: 'X', clients: 0, vendedoresComuns: 0, insideSales: 0, fieldSales: 0,
              gestores: 0, erpLevel: 'D', mixProdutos: 'A',
            },
          })
          return {
            absentFieldSales: absent.fieldSales,
            absentInside: absent.insideSales,
            absentCerts: absent.certifications,
            zeroClients: withZero.clients,
            zeroField: withZero.fieldSales,
            zeroComuns: withZero.vendedoresComuns,
            erpDShown: withZero.erpLevel,
          }
        })()`)
      }

      const local = await runConferenceAttempt(page, report)
      report.attempts.push({
        attempt,
        openTile: local.openTile?.path || null,
        openDirect: local.openDirect?.path || null,
        buyCashOk: local.buy?.cashDroppedByCost ?? null,
        buyClientsOk: local.buy?.clientsIncreasedByOne ?? null,
        mobileOk: local.mobile844x320?.ok ?? null,
        fail: local.fail || null,
      })

      best = local
      const starterOk = local.tileCompare && Object.values(local.tileCompare.starterShape).every(Boolean)
      const pass = !!(
        report.zeroSemantics?.absentFieldSales === null
        && report.zeroSemantics?.zeroField === 0
        && report.zeroSemantics?.zeroClients === 0
        && local.tileCompare?.qtyPreserved
        && local.tileCompare?.cashCoherent
        && starterOk
        && local.skip?.ok
        && local.buy?.modalClosedAfterConfirm
        && local.buy?.singleApply === true
        && local.buy?.cashDroppedByCost === true
        && local.buy?.clientsIncreasedByOne === true
        && local.mobile844x320?.ok
        && !!local.openDirect
      )
      if (pass) {
        Object.assign(report, {
          openTile: local.openTile,
          openDirect: local.openDirect,
          openBuy: local.openBuy,
          tileCompare: local.tileCompare,
          skip: local.skip,
          buy: local.buy,
          buyOpening: local.buyOpening,
          buyPrep: local.buyPrep,
          directCompare: local.directCompare,
          mobile844x320: local.mobile844x320,
          ok: true,
        })
        break
      }

      if (!local.openDirect) {
        report.limitations.push(`tentativa ${attempt}: Direito de Compra não apareceu`)
      }
      if (local.mobile844x320 && !local.mobile844x320.ok) {
        report.limitations.push(`tentativa ${attempt}: 844×320 falhou`)
      }
    }

    if (!report.ok && best) {
      Object.assign(report, {
        openTile: best.openTile,
        openDirect: best.openDirect,
        openBuy: best.openBuy,
        tileCompare: best.tileCompare,
        skip: best.skip,
        buy: best.buy,
        buyOpening: best.buyOpening,
        buyPrep: best.buyPrep,
        directCompare: best.directCompare,
        mobile844x320: best.mobile844x320,
        ok: false,
      })
    }

    await page.close()
    await chrome.connection.disposeBrowserContext(ctx)
  } catch (e) {
    report.ok = false
    report.error = e.message
    report.stack = e.stack
  } finally {
    if (chrome) report.chromeStop = await chrome.stop()
  }

  await writeFile(resolve(OUT, 'real-conference-report.json'), `${JSON.stringify(report, null, 2)}\n`)
  console.log(JSON.stringify(report, null, 2))
  process.exit(report.ok ? 0 : 1)
}

await main()
