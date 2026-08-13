const brlFormatter = new Intl.NumberFormat('pt-BR', {
  style: 'currency',
  currency: 'BRL',
  minimumFractionDigits: 0,
  maximumFractionDigits: 0,
})

export const formatGameMoney = (value) => brlFormatter.format(Number(value) || 0)

const plain = (value) => String(value ?? 0)
const money = (key, label, value, tone = 'neutral') => ({
  key,
  label,
  value: formatGameMoney(value),
  tone,
})
const metric = (key, label, value) => ({ key, label, value: plain(value), tone: 'neutral' })

export function buildGameStatSections(totals = {}) {
  return [
    {
      key: 'financial',
      title: 'Financeiro',
      rows: [
        money('faturamento', 'Faturamento', totals.faturamento, 'positive'),
        money('manutencao', 'Manutenção', totals.manutencao, 'negative'),
        money('emprestimos', 'Empréstimos', totals.emprestimos),
        money('bens', 'Bens', totals.bens),
      ],
    },
    {
      key: 'commercial',
      title: 'Estrutura comercial',
      rows: [
        metric('vendedoresComuns', 'Vendedores Comuns', totals.vendedoresComuns),
        metric('fieldSales', 'Field Sales', totals.fieldSales),
        metric('insideSales', 'Inside Sales', totals.insideSales),
        metric(
          'gestores',
          'Gestores Comerciais',
          totals.gestores ?? totals.gestoresComerciais,
        ),
      ],
    },
    {
      key: 'infrastructure',
      title: 'Infraestrutura',
      rows: [
        metric('mixProdutos', 'Mix de Produtos', totals.mixProdutos),
        metric('erpSistemas', 'ERP/Sistemas', totals.erpSistemas),
      ],
    },
    {
      key: 'certifications',
      title: 'Certificações',
      rows: [
        metric('az', 'Azul', totals.az),
        metric('am', 'Amarelo', totals.am),
        metric('rox', 'Roxo', totals.rox),
      ],
    },
    {
      key: 'operations',
      title: 'Operação',
      rows: [
        metric('clientes', 'Clientes', totals.clientes),
        metric('possibAt', 'Capacidade', totals.possibAt),
        metric('clientsAt', 'Em Atendimento', totals.clientsAt),
      ],
    },
  ]
}
