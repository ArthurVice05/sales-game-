/**
 * Dicas progressivas (1× por tipo de casa por sessão de aba).
 * Não altera regras nem sync — só UX local.
 */

import { getTileContext, getTileHint } from '../modals/tileContext.js'

export const TIP_SESSION_PREFIX = 'salesgame_tip_seen_v1:'

const TIP_KINDS = Object.freeze([
  'CLIENTS',
  'COMMON',
  'FIELD',
  'INSIDE',
  'MANAGER',
  'ERP',
  'MIX',
  'TRAINING',
  'DIRECT_BUY',
  'LUCK',
  'REVENUE',
  'EXPENSES',
])

/** Frase curta (≤2 linhas no notebook). Detalhe longo fica em `detail`. */
export const TILE_TIP_SHORT = Object.freeze({
  CLIENTS: 'Carteira: compre clientes; sem capacidade, o excedente não fatura.',
  COMMON: 'Vendedor Comum: contrate e aumente a capacidade de atendimento.',
  FIELD: 'Canal representantes: contrate representantes externos.',
  INSIDE: 'Inside Sales: contrate vendedores internos.',
  MANAGER: 'Gestor Comercial: impulsiona o time (não atende clientes).',
  ERP: 'ERP: escolha um nível A–D; impacto por colaborador.',
  MIX: 'Mix: escolha um nível A–D; define fat e custo por cliente.',
  TRAINING: 'Treinamento: compre certificados azul, amarelo ou roxo.',
  DIRECT_BUY: 'Direito de Compra: escolha exatamente um investimento.',
  LUCK: 'Sorte & Revés: confirme a carta para aplicar o efeito.',
  REVENUE: 'Faturamento: ao passar, receba a venda do ciclo.',
  EXPENSES: 'Despesas: pague a manutenção do mês (e empréstimo, se houver).',
})

function tipKey(kind) {
  return `${TIP_SESSION_PREFIX}${String(kind || '').toUpperCase()}`
}

function normalizeTipKind(kind) {
  const k = String(kind || '').toUpperCase()
  if (k === 'START_REVENUE') return 'REVENUE'
  return k
}

export function hasSeenTileTip(kind) {
  const k = normalizeTipKind(kind)
  if (!TIP_KINDS.includes(k)) return true
  try {
    return sessionStorage.getItem(tipKey(k)) === '1'
  } catch {
    return false
  }
}

export function markTileTipSeen(kind) {
  const k = normalizeTipKind(kind)
  if (!TIP_KINDS.includes(k)) return
  try {
    sessionStorage.setItem(tipKey(k), '1')
  } catch {
    // ignore
  }
}

export function getShortTileTip(kind) {
  const k = normalizeTipKind(kind)
  if (TILE_TIP_SHORT[k]) return TILE_TIP_SHORT[k]
  const long = getTileHint(k) || getTileContext(k) || ''
  if (!long) return ''
  const cut = long.split(/(?<=\.)\s+/)[0] || long
  return cut.length > 110 ? `${cut.slice(0, 107).trim()}…` : cut
}

/**
 * Se ainda não viu a dica desta casa, retorna texto curto + detalhe e marca como vista.
 * @returns {{ kind: string, text: string, detail: string } | null}
 */
export function consumeTileTip(kind) {
  const k = normalizeTipKind(kind)
  if (!TIP_KINDS.includes(k)) return null
  if (hasSeenTileTip(k)) return null
  const detail = getTileHint(k) || getTileContext(k) || ''
  const text = getShortTileTip(k)
  if (!text) return null
  markTileTipSeen(k)
  return { kind: k, text, detail }
}

export function listTipKinds() {
  return [...TIP_KINDS]
}
