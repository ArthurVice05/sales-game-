export const BOARD_40_TYPES = Object.freeze([
  'START_REVENUE',
  'CLIENTS',
  'ERP',
  'INSIDE',
  'MANAGER',
  'TRAINING',
  'FIELD',
  'DIRECT_BUY',
  'COMMON',
  'EXPENSES',
  'MIX',
  'LUCK',
])

const TYPE_LABELS = Object.freeze({
  START_REVENUE: 'Início / Faturamento',
  CLIENTS: 'Carteira de Clientes',
  ERP: 'ERP',
  INSIDE: 'Inside Sales',
  MANAGER: 'Gestor Comercial',
  TRAINING: 'Treinamento',
  FIELD: 'Field Sales',
  DIRECT_BUY: 'Direito de Compra',
  COMMON: 'Vendedor Comum',
  EXPENSES: 'Despesas Operacionais',
  MIX: 'Mix de Produtos',
  LUCK: 'Sorte & Revés',
})

const visual = (icon, labelLines) => Object.freeze({
  icon,
  labelLines: Object.freeze(labelLines),
})

export const BOARD_40_TYPE_VISUALS = Object.freeze({
  START_REVENUE: visual('/board-icons/start-revenue.png', ['INÍCIO', 'FATURAMENTO']),
  CLIENTS: visual('/board-icons/clients.png', ['CARTEIRA', 'DE CLIENTES']),
  ERP: visual('/board-icons/erp.png', ['ERP']),
  INSIDE: visual('/board-icons/inside-sales.png', ['INSIDE SALES']),
  MANAGER: visual('/board-icons/manager.png', ['GESTOR', 'COMERCIAL']),
  TRAINING: visual('/board-icons/training.png', ['TREINAMENTO']),
  FIELD: visual('/board-icons/field-sales.png', ['FIELD SALES']),
  DIRECT_BUY: visual('/board-icons/direct-buy.png', ['DIREITO', 'DE COMPRA']),
  COMMON: visual('/board-icons/common-seller.png', ['VENDEDOR', 'COMUM']),
  EXPENSES: visual('/board-icons/expenses.png', ['DESPESAS', 'OPERACIONAIS']),
  MIX: visual('/board-icons/product-mix.png', ['MIX DE', 'PRODUTOS']),
  LUCK: visual('/board-icons/luck.png', ['SORTE &', 'REVÉS']),
})

const TILE_TYPES = Object.freeze([
  'START_REVENUE',
  'CLIENTS',
  'ERP',
  'INSIDE',
  'MANAGER',
  'TRAINING',
  'CLIENTS',
  'FIELD',
  'DIRECT_BUY',
  'LUCK',
  'INSIDE',
  'COMMON',
  'TRAINING',
  'CLIENTS',
  'ERP',
  'FIELD',
  'CLIENTS',
  'COMMON',
  'TRAINING',
  'LUCK',
  'CLIENTS',
  'DIRECT_BUY',
  'INSIDE',
  'MANAGER',
  'EXPENSES',
  'CLIENTS',
  'ERP',
  'DIRECT_BUY',
  'FIELD',
  'LUCK',
  'CLIENTS',
  'INSIDE',
  'COMMON',
  'MANAGER',
  'CLIENTS',
  'MIX',
  'FIELD',
  'CLIENTS',
  'MIX',
  'LUCK',
])

const EVENT_KINDS = Object.freeze({
  START_REVENUE: 'REVENUE',
  CLIENTS: 'CLIENTS',
  ERP: 'ERP',
  INSIDE: 'INSIDE',
  MANAGER: 'MANAGER',
  TRAINING: 'TRAINING',
  FIELD: 'FIELD',
  DIRECT_BUY: 'DIRECT_BUY',
  COMMON: 'COMMON',
  EXPENSES: 'EXPENSES',
  MIX: 'MIX',
  LUCK: 'LUCK',
})

export function getBoard40GridPosition(number) {
  if (!Number.isInteger(number) || number < 1 || number > 40) {
    throw new RangeError('Board preview tile number must be an integer from 1 through 40')
  }

  if (number <= 13) {
    return { row: 1, column: number }
  }

  if (number <= 20) {
    return { row: number - 12, column: 13 }
  }

  if (number <= 33) {
    return { row: 9, column: 34 - number }
  }

  return { row: 42 - number, column: 1 }
}

export const BOARD_40_CONFIG = Object.freeze(
  TILE_TYPES.map((type, index) => {
    const number = index + 1
    const { row, column } = getBoard40GridPosition(number)
    const tileVisual = BOARD_40_TYPE_VISUALS[type]

    // Região superior direita da célula: preserva número (esquerda), ícone
    // (centro) e rótulo (base). Coordenadas são normalizadas no board 4:3.
    const tokenCenter = Object.freeze({
      nx: (column - 1 + 0.78) / 13,
      ny: (row - 1 + 0.22) / 9,
    })

    return Object.freeze({
      index,
      number,
      type,
      label: TYPE_LABELS[type],
      icon: tileVisual.icon,
      labelLines: tileVisual.labelLines,
      gridRow: row,
      gridColumn: column,
      tokenCenter,
      eventKind: EVENT_KINDS[type],
      passageEvent: type === 'START_REVENUE' || type === 'EXPENSES'
        ? EVENT_KINDS[type]
        : null,
      arrivalEvent: type === 'START_REVENUE' || type === 'EXPENSES'
        ? null
        : EVENT_KINDS[type],
      // Aliases mantidos para a página de prévia existente.
      row,
      column,
    })
  }),
)

export const BOARD_40_PREVIEW = BOARD_40_CONFIG

/** Slot estável por id para até quatro jogadores ocupando a mesma casa. */
export function getDeterministicTokenSlots(entries = []) {
  const groups = new Map()
  for (const entry of entries) {
    const position = Number(entry?.position)
    const group = groups.get(position) || []
    group.push(entry?.player)
    groups.set(position, group)
  }

  const slots = new Map()
  for (const group of groups.values()) {
    group
      .filter((player) => player?.id != null)
      .sort((left, right) => String(left.id).localeCompare(String(right.id)))
      .forEach((player, index) => slots.set(String(player.id), index))
  }
  return slots
}
