const brlFormatter = new Intl.NumberFormat('pt-BR', {
  style: 'currency',
  currency: 'BRL',
  minimumFractionDigits: 0,
  maximumFractionDigits: 0,
})

export const formatGameMoney = (value) => brlFormatter.format(Number(value) || 0)

const brlCompactFormatter = new Intl.NumberFormat('pt-BR', {
  style: 'currency',
  currency: 'BRL',
  notation: 'compact',
  minimumFractionDigits: 0,
  maximumFractionDigits: 1,
})

/**
 * Formato curto para cards estreitos do HUD ("R$ 1,2 mi", "R$ 16,9 mil").
 * Abaixo de mil mantém o formato completo (já é curto).
 */
export const formatGameMoneyCompact = (value) => {
  const n = Number(value) || 0
  if (Math.abs(n) < 1000) return formatGameMoney(n)
  return brlCompactFormatter.format(n)
}

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
        metric('fieldSales', 'Canal representantes', totals.fieldSales),
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
