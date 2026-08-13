import assert from 'node:assert/strict'
import test from 'node:test'

const statsModule = await import('../../components/gameStats.js').catch(() => ({
  buildGameStatSections() {
    throw new Error('game stats adapter is not implemented')
  },
  formatGameMoney() {
    throw new Error('money formatter is not implemented')
  },
}))

const { buildGameStatSections, formatGameMoney } = statsModule

const totals = Object.freeze({
  faturamento: 770,
  manutencao: 1150,
  emprestimos: 0,
  bens: 4000,
  vendedoresComuns: 2,
  fieldSales: 1,
  insideSales: 3,
  gestores: 4,
  mixProdutos: 'D',
  erpSistemas: 'B',
  az: 1,
  am: 2,
  rox: 3,
  clientes: 5,
  possibAt: 7,
  clientsAt: 6,
})

test('money values use Brazilian currency formatting without cents', () => {
  assert.equal(formatGameMoney(770).replace(/\u00a0/g, ' '), 'R$ 770')
  assert.equal(formatGameMoney(1150).replace(/\u00a0/g, ' '), 'R$ 1.150')
  assert.equal(formatGameMoney(4000).replace(/\u00a0/g, ' '), 'R$ 4.000')
})

test('stats adapter creates one ordered row for every previously displayed value', () => {
  const sections = buildGameStatSections(totals)
  assert.deepEqual(sections.map(({ title }) => title), [
    'Financeiro',
    'Estrutura comercial',
    'Infraestrutura',
    'Certificações',
    'Operação',
  ])

  const rows = sections.flatMap(({ rows }) => rows)
  assert.deepEqual(rows.map(({ label }) => label), [
    'Faturamento',
    'Manutenção',
    'Empréstimos',
    'Bens',
    'Vendedores Comuns',
    'Field Sales',
    'Inside Sales',
    'Gestores Comerciais',
    'Mix de Produtos',
    'ERP/Sistemas',
    'Azul',
    'Amarelo',
    'Roxo',
    'Clientes',
    'Capacidade',
    'Em Atendimento',
  ])
  assert.equal(new Set(rows.map(({ key }) => key)).size, 16)
  assert.equal(rows.find(({ key }) => key === 'mixProdutos').value, 'D')
  assert.equal(rows.find(({ key }) => key === 'clientes').value, '5')
  assert.equal(rows.find(({ key }) => key === 'clientsAt').value, '6')
})

test('stats adapter keeps positive negative and neutral value tones', () => {
  const rows = buildGameStatSections(totals).flatMap(({ rows }) => rows)
  assert.equal(rows.find(({ key }) => key === 'faturamento').tone, 'positive')
  assert.equal(rows.find(({ key }) => key === 'manutencao').tone, 'negative')
  assert.equal(rows.find(({ key }) => key === 'emprestimos').tone, 'neutral')
})
