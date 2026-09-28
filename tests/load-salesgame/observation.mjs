import { performance } from 'node:perf_hooks'
import { sanitize } from './safety.mjs'

const PLAYER_FIELDS = ['id','name','seat','cash','bens','pos','bankrupt','isBot','bot','clients','vendedoresComuns','insideSales','fieldSales','gestores','mixProdutos','erpLevel','lastActions','loanTakenInMatch','lastChargedLoanId','certPurple','certs','certificates','cert_roxo','rox','am','az','mixLevel','mix','erpSistemas','trainingsByVendor','gestoresCertificados','managers','gestoresComerciais']
export function publicSnapshot(row) {
  const s = row?.state
  if (!s || !Array.isArray(s.players)) return null
  return {
    code: row.code, version: row.version, stateId: s.stateId, actionId: s.actionId,
    turnPlayerId: s.turnPlayerId, turnSeq: s.turnSeq, round: s.round, gameOver: !!s.gameOver,
    botCount: s.botCount ?? s.botConfig?.count ?? 0,
    players: s.players.map(p => ({ clients: 0, insideSales: 0, fieldSales: 0, gestores: 0, vendedoresComuns: 0, az: 0,
      ...Object.fromEntries(PLAYER_FIELDS.filter(k => k in p).map(k => [k, p[k]])) })),
  }
}

export function observeTransport(driver, registry) {
  const { page, metrics } = driver
  const ingest = row => {
    if (registry.roomNames.has(row?.name) && row?.id) registry.roomIds.add(String(row.id))
    if (!row?.code || !registry.roomIds.has(String(row.code))) return
    if (row.id) registry.roomRowIds.add(String(row.id))
    const snapshot = publicSnapshot(row)
    if (!snapshot || String(row.code) !== driver.roomId) return
    if (driver.snapshot && Number(snapshot.version) < Number(driver.snapshot.version)) return
    driver.snapshot = snapshot; driver.snapshotAt = performance.now()
    driver.seenSnapshots.push({ at: performance.now(), snapshot })
    if (driver.seenSnapshots.length > 100) driver.seenSnapshots.shift()
  }
  page.on('response', response => {
    const task = (async () => {
      const url = new URL(response.url())
      if (url.origin !== driver.config.supabaseOrigin) return
      if (response.status() === 429 || response.status() >= 500) metrics.event('http-error', { player: driver.name, status: response.status(), url: url.origin + url.pathname, injected: driver.injected })
      if (!response.ok()) return
      if (/\/rest\/v1\/(lobbies|rooms)$/.test(url.pathname)) {
        const body = await response.json()
        for (const row of Array.isArray(body) ? body : [body]) ingest(row)
      }
    })().catch(() => {})
    registry.pending.add(task); task.finally(() => registry.pending.delete(task))
  })
  page.on('websocket', socket => {
    if (new URL(socket.url()).host !== new URL(driver.config.supabaseOrigin).host) return
    driver.realtimeSockets++
    socket.on('close', () => { driver.realtimeSockets--; metrics.event('realtime-disconnect', { player: driver.name, injected: driver.injected }) })
    socket.on('framereceived', ({ payload }) => {
      try {
        const frame = JSON.parse(String(payload))
        const payloadData = Array.isArray(frame) ? frame[4] : frame.payload
        const data = payloadData?.data ?? payloadData
        if (data?.table === 'rooms') ingest(data.record ?? data.new)
        if (data?.table === 'lobbies') ingest(data.record ?? data.new)
      } catch { /* heartbeat or non-JSON frame */ }
    })
  })
  page.on('console', message => {
    if (message.type() === 'error') metrics.event('console-error', { player: driver.name, message: sanitize(message.text()).slice(0, 1500), injected: driver.injected })
  })
  page.on('pageerror', error => metrics.event('page-error', { player: driver.name, message: sanitize(error.message), injected: driver.injected }))
  page.on('requestfailed', request => metrics.event('network-error', { player: driver.name, url: sanitize(request.url()), error: request.failure()?.errorText, injected: driver.injected }))
  page.on('dialog', async dialog => {
    metrics.fail('unexpected-native-dialog', { player: driver.name, detail: sanitize(dialog.message()) })
    await dialog.dismiss().catch(() => {})
  })
}

/** DOM only; no React fibers, globals from the engine, or writes to browser storage. */
export async function readUI(page) {
  return page.evaluate(() => {
    const visible = el => !!el && el.getClientRects().length > 0 && getComputedStyle(el).visibility !== 'hidden'
    const text = el => (el?.textContent || '').replace(/\s+/g, ' ').trim()
    const all = [...document.querySelectorAll('.sr3d-wrap,.tileModal,.recovery-card,.finalWinners,.sg-modal-card,.tutorialModal')].filter(visible)
    const leaves = all.filter(el => !all.some(other => other !== el && el.contains(other)))
    const modal = leaves.at(-1)
    const buttons = modal ? [...modal.querySelectorAll('button')].filter(visible).map(el => ({ text: text(el), label: el.getAttribute('aria-label'), enabled: !el.disabled && el.getAttribute('aria-disabled') !== 'true' })) : []
    const roll = [...document.querySelectorAll('.controls .turnBox button')].find(visible)
    const tokenElements = [...document.querySelectorAll('[data-player-position]')].filter(visible)
    const active = tokenElements.find(el => el.classList.contains('token--active'))
    const summary = [...document.querySelectorAll('.score .row,.hudRankingRow')].filter(visible).map(text)
    return {
      online: navigator.onLine,
      inGame: tokenElements.length > 0,
      final: !!document.querySelector('.finalWinners'),
      finalRows: [...document.querySelectorAll('.fwr3d-result,.finalWinnersList li')].map(el => ({ name: text(el.querySelector('.fwr3d-resultName,.finalWinnersListName')), value: text(el.querySelector('.fwr3d-srOnly,.finalWinnersListPat')), details: text(el.querySelector('.fwr3d-breakdown')) })),
      finalNames: [...document.querySelectorAll('.fwr3d-resultName,.finalWinnersListName')].map(text),
      tokens: tokenElements.map(el => ({ label: el.getAttribute('aria-label'), pos: Number(el.getAttribute('data-player-position')) })),
      activeName: active?.getAttribute('aria-label')?.split(' está na casa ')[0] ?? null,
      round: [...document.querySelectorAll('.gdhMetrics .hudMetricCard')].find(el => text(el).includes('Rodada'))?.textContent?.replace(/\s+/g, ' ').trim() ?? null,
      summary,
      rolling: !![...document.querySelectorAll('.diceRollOverlay,.sg40GameBoard__token--hopping')].find(visible),
      rollEnabled: !!roll && !roll.disabled && roll.getAttribute('aria-disabled') !== 'true',
      modal: modal ? { title: modal.getAttribute('aria-label') || text(modal.querySelector('h1,h2,.recovery-header')), text: text(modal).slice(0, 12000), buttons,
        selector: modal.classList.contains('sr3d-wrap') ? '.sr3d-wrap' : modal.classList.contains('recovery-card') ? '.recovery-card' : modal.classList.contains('finalWinners') ? '.finalWinners' : modal.classList.contains('tileModal') ? '.tileModal' : '.sg-modal-card',
      } : null,
    }
  })
}
