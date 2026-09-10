/**
 * Resumo “Minha empresa agora” — apresentação somente leitura.
 * Reutilizável; nesta etapa integrado só em BuyClientsModal.
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { buildCompanySnapshotSummary } from '../companySnapshotSummary.js'

const root = join(dirname(fileURLToPath(import.meta.url)), '../..')
const modal = readFileSync(join(root, 'modals/BuyClientsModal.jsx'), 'utf8')
const summaryUi = readFileSync(join(root, 'modals/CompanySnapshotSummary.jsx'), 'utf8')
const shell = readFileSync(join(root, 'modals/TileModalShell.jsx'), 'utf8')
const preview = readFileSync(join(root, 'components/PurchaseImpactPreview.jsx'), 'utf8')

test('buildCompanySnapshotSummary usa capacityAndAttendance e não inventa zeros', () => {
  const empty = buildCompanySnapshotSummary({})
  assert.equal(empty.cash, null)
  assert.equal(empty.clients, null)
  assert.equal(empty.vendedoresComuns, null)
  assert.equal(empty.fieldSales, null)
  assert.equal(empty.erpLevel, null)
  assert.equal(empty.certifications, null)

  const starter = buildCompanySnapshotSummary({
    cash: 18000,
    player: {
      name: 'Ana',
      cash: 17000,
      clients: 1,
      vendedoresComuns: 1,
      erpLevel: 'D',
      mixProdutos: 'D',
    },
  })
  assert.equal(starter.cash, 18000)
  assert.equal(starter.clients, 1)
  assert.equal(starter.capacity, 2)
  assert.equal(starter.inAttendance, 1)
  assert.equal(starter.spareCapacity, 1)
  assert.equal(starter.vendedoresComuns, 1)
  assert.equal(starter.fieldSales, null)
  assert.equal(starter.insideSales, null)
  assert.equal(starter.erpLevel, 'D')
  assert.equal(starter.mixLevel, 'D')
  assert.equal(starter.isOpeningSnapshot, true)

  const rich = buildCompanySnapshotSummary({
    cash: 13000,
    player: {
      clients: 6,
      vendedoresComuns: 2,
      insideSales: 1,
      fieldSales: 1,
      gestores: 1,
      erpLevel: 'B',
      mixProdutos: 'A',
      trainingsByVendor: {
        comum: ['personalizado'],
        field: ['fieldsales'],
        gestor: ['imersaomultiplier'],
      },
    },
  })
  assert.equal(rich.capacity, 2 * 2 + 1 * 6 + 1 * 4)
  assert.equal(rich.inAttendance, 6)
  assert.equal(rich.spareCapacity, Math.max(0, rich.capacity - 6))
  assert.equal(rich.fieldSales, 1)
  assert.ok(Array.isArray(rich.certifications))
  assert.ok(rich.certifications.some((r) => r.label === 'Canal representantes'))
  assert.ok(rich.certifications.some((r) => r.certLabels.includes('Amarelo')))
})

test('BuyClientsModal integra resumo sem mudar payloads BUY/SKIP/BACK', () => {
  assert.match(modal, /CompanySnapshotSummary/)
  assert.match(modal, /buildCompanySnapshotSummary|currentPlayer/)
  assert.match(modal, /action:\s*'BUY'/)
  assert.match(modal, /action:\s*'SKIP'/)
  assert.match(modal, /action:\s*'BACK'/)
  assert.match(modal, /clientsAdded:\s*qtyNum/)
  assert.match(modal, /maintenanceDelta/)
  assert.match(modal, /InsufficientFundsModal/)
  assert.match(modal, /disabled=\{!canBuy\}/)
  assert.match(modal, /Entenda a capacidade|companySnapshotDetails/)
  assert.match(modal, /tileModal--clients|variant=\{?['\"]clients['\"]/)
  assert.doesNotMatch(modal, /supabase|BroadcastChannel|document\.querySelector/)
})

test('CompanySnapshotSummary é somente leitura e reutilizável', () => {
  assert.match(summaryUi, /Minha empresa agora/)
  assert.match(summaryUi, /O que já tenho/)
  assert.match(summaryUi, /Canal representantes/)
  assert.match(summaryUi, /Capacidade/)
  assert.match(summaryUi, /details|aria-expanded|companySnapshotExpand/)
  assert.doesNotMatch(summaryUi, /onResolve|action:\s*'BUY'|setPlayers/)
})

test('shell aceita className/variante sem mudar o padrão', () => {
  assert.match(shell, /className/)
  assert.match(shell, /tileModal--\$\{size\}/)
})

test('PurchaseImpactPreview preserva padrão e oferece variante opcional', () => {
  assert.match(preview, /Impacto da contratação/)
  assert.match(preview, /Atual/)
  assert.match(preview, /Após a ação/)
  assert.match(preview, /density|variant|labels/)
})
