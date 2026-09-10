/**
 * Textos das casas — alinhados ao motor (gameRules) e ao glossário do tour.
 * Não altera regras do motor — só copy de UI (modal + hint no tabuleiro).
 */
import { VENDOR_RULES } from '../game/gameRules.js'
import { MANUAL_CONSTANTS } from '../game/manualConstants.js'

const money = (n) => `$ ${Number(n || 0).toLocaleString('pt-BR')}`

export const TILE_CONTEXT = Object.freeze({
  CLIENTS:
    `Carteira de Clientes: aquisição ${money(MANUAL_CONSTANTS.clientPrice)}/cliente; despesa de carteira ${money(MANUAL_CONSTANTS.clientPortfolioDesp)}/cliente no ciclo. Sem capacidade, o excedente não fatura.`,
  COMMON:
    `Vendedor Comum: atende até ${VENDOR_RULES.comum.cap} clientes. Contratação ${money(MANUAL_CONSTANTS.commonHire)}; desp. base ${money(VENDOR_RULES.comum.baseDesp)}; fat base ${money(VENDOR_RULES.comum.baseFat)}.`,
  FIELD:
    `Canal representantes: atende até ${VENDOR_RULES.field.cap} clientes. Contratação ${money(VENDOR_RULES.field.hire)}; desp. base ${money(VENDOR_RULES.field.baseDesp)}; fat base ${money(VENDOR_RULES.field.baseFat)}.`,
  INSIDE:
    `Inside Sales: atende até ${VENDOR_RULES.inside.cap} clientes. Contratação ${money(VENDOR_RULES.inside.hire)}; desp. base ${money(VENDOR_RULES.inside.baseDesp)}; fat base ${money(VENDOR_RULES.inside.baseFat)}.`,
  MANAGER:
    `Gestor Comercial: contratação ${money(MANUAL_CONSTANTS.managerHire)}; desp. base ${money(VENDOR_RULES.gestor.baseDesp)}. Não atende clientes; impulsiona o time conforme certificados.`,
  ERP:
    'ERP/Sistemas: níveis A–D (não cumulativos). Valores por colaborador — o retorno cresce com o tamanho da equipe. Tabelas no glossário (Como jogar).',
  MIX:
    'Mix de Produtos: níveis A–D (não cumulativos). Fat por cliente em atendimento; desp por todos os clientes. Tabelas no glossário (Como jogar).',
  TRAINING:
    `Treinamento: certificados azul/amarelo/roxo a ${money(MANUAL_CONSTANTS.trainingPrice)} cada. Detalhes no glossário (Como jogar).`,
  DIRECT_BUY:
    'Direito de Compra: escolha exatamente um investimento livre — equipe, mix, ERP, treinamento ou clientes.',
  LUCK:
    'Sorte & Revés: compre a carta do topo. Sorte pode gerar ganho ou isenção; revés pode cobrar, multar ou reduzir produtividade.',
  REVENUE:
    'Faturamento do Mês: receba a venda do ciclo (equipe × clientes em atendimento × mix × ERP). Cruzar esta casa encerra a volta/rodada.',
  EXPENSES:
    'Despesas Operacionais: pague a manutenção do mês (equipe, clientes, Mix, ERP e carteira). Empréstimo da partida é quitado aqui na rodada seguinte, com 50% de juros.',
})

/** Texto no tabuleiro (desktop/mobile): função da casa em 1–2 frases. */
export const TILE_HINTS = Object.freeze({
  REVENUE:
    'Início/Faturamento: ao passar, receba a venda do mês (equipe, clientes em atendimento, mix e ERP). Esta casa fecha a volta.',
  CLIENTS:
    `Carteira de Clientes: ${money(MANUAL_CONSTANTS.clientPrice)}/cliente. Sem capacidade da equipe, o excedente não fatura neste ciclo.`,
  ERP:
    'ERP/Sistemas: compre um nível (A–D). Ganho e custo são por colaborador. Valores no glossário (Como jogar).',
  INSIDE:
    `Inside Sales: contrate vendedores internos (até ${VENDOR_RULES.inside.cap} clientes cada). Contratação ${money(VENDOR_RULES.inside.hire)}.`,
  MANAGER:
    `Gestor Comercial: ${money(MANUAL_CONSTANTS.managerHire)} para contratar. Aumenta o faturamento da equipe conforme certificados.`,
  TRAINING:
    `Treinamento: certificados (azul, amarelo ou roxo) a ${money(MANUAL_CONSTANTS.trainingPrice)} cada.`,
  FIELD:
    `Canal representantes: representantes externos (até ${VENDOR_RULES.field.cap} clientes). Contratação ${money(VENDOR_RULES.field.hire)}.`,
  DIRECT_BUY:
    'Direito de Compra: escolha exatamente um investimento agora — equipe, mix, ERP, treinamento ou clientes.',
  LUCK:
    'Sorte & Revés: tire a carta do topo. Pode creditar o caixa, isentar custos, ou aplicar multa e perdas.',
  COMMON:
    `Vendedor Comum: atende até ${VENDOR_RULES.comum.cap} clientes. Contratação ${money(MANUAL_CONSTANTS.commonHire)}.`,
  EXPENSES:
    'Despesas: manutenção do mês. Empréstimo (1× na partida, garantia de 50% dos bens) é quitado nesta casa na próxima rodada, com 50% de juros.',
  MIX:
    'Mix de Produtos: compre um nível (A–D). Define quanto cada cliente fatura e custa por ciclo. Tabelas no glossário.',
})

function hintKey(kind) {
  const key = String(kind || '').toUpperCase()
  if (key === 'START_REVENUE') return 'REVENUE'
  return key
}

export function getTileContext(kind) {
  const key = hintKey(kind)
  return TILE_CONTEXT[key] || ''
}

export function getTileHint(kind) {
  const key = hintKey(kind)
  return TILE_HINTS[key] || TILE_CONTEXT[key] || ''
}
