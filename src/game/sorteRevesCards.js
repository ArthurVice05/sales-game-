function num(v, d = 0) {
  return Number.isFinite(Number(v)) ? Number(v) : d
}

export function hasYellowCert(p) {
  return num(p?.am, 0) > 0
}
export function hasBlueCert(p) {
  return num(p?.az, 0) > 0
}
export function hasPurpleCert(p) {
  const v =
    p?.certPurple ??
    p?.certs?.purple ??
    p?.certificates?.purple ??
    p?.cert_roxo ??
    p?.rox ??
    0
  return v === true || Number(v) > 0
}
export function getMixLevel(p) {
  const lvl =
    p?.mixLevel ??
    p?.mixProdutos?.level ??
    p?.mixProdutos ??
    p?.mix ??
    'D'
  return String(lvl || 'D').toUpperCase()
}
export function hasMixA(p) {
  return getMixLevel(p) === 'A'
}
export function erpLevelA(p) {
  return String(p?.erpLevel || p?.erpSistemas || 'D').toUpperCase() === 'A'
}
export function mixIsAB(p) {
  const lvl = String(p?.mixProdutos || 'D').toUpperCase()
  return lvl === 'A' || lvl === 'B'
}
export function managersCertCount(p) {
  const setSize = (obj) => {
    if (!obj) return 0
    try {
      const arr = Array.isArray(obj) ? obj : Object.values(obj)
      return new Set(arr).size
    } catch {
      return 0
    }
  }
  if (p?.trainingsByVendor?.gestor) return setSize(p.trainingsByVendor.gestor)
  return num(p?.gestoresCertificados, 0)
}
export function teamSize(p) {
  return (
    num(p?.vendedoresComuns) +
    num(p?.insideSales) +
    num(p?.fieldSales) +
    num(p?.gestores ?? p?.gestoresComerciais ?? p?.managers)
  )
}

export function buildSorteRevesCatalog() {
  return [
    { id: 'referral_bonus', kind: 'SORTE', title: 'Indicação Lucrativa',
      text: 'Um cliente indicou amigos e a primeira compra foi ótima. Receba R$ 800,00.',
      cashDelta: +800 },
    { id: 'network_cert_mgr', kind: 'SORTE', title: 'Rede Estratégica',
      text: 'Para cada gestor com certificado, receba R$ 5.000,00.',
      _compute: (p) => ({ cashDelta: 5000 * managersCertCount(p) }) },
    { id: 'innovation_invest', kind: 'SORTE', title: 'Inovação Premiada',
      text: 'Se tiver infraestrutura (mix/sistemas) nível A ou B, receba aporte de R$ 25.000,00.',
      _compute: (p) => ({ cashDelta: mixIsAB(p) ? 25000 : 0 }) },
    { id: 'segmentation', kind: 'SORTE', title: 'Segmentação Inteligente',
      text: 'Novo segmento lucrativo. Receba R$ 1.000,00.',
      cashDelta: +1000 },
    { id: 'casa_bonus_10k', kind: 'SORTE', title: 'Casagrande Insights',
      text: 'Implementação bem-sucedida. Receba R$ 10.000,00.',
      cashDelta: +10000 },
    { id: 'casa_network_7k', kind: 'SORTE', title: 'Rede de Contatos Valiosa',
      text: 'Parceria estratégica. Ganhe R$ 7.000,00.',
      cashDelta: +7000 },
    { id: 'casa_strategy_5k', kind: 'SORTE', title: 'Estratégia Personalizada',
      text: 'Processos melhorados. Receba R$ 5.000,00.',
      cashDelta: +5000 },
    { id: 'casa_best_practices_8k', kind: 'SORTE', title: 'Melhores Práticas',
      text: 'Eficiência aumentada. Receba R$ 8.000,00.',
      cashDelta: +8000 },
    { id: 'casa_start_6k', kind: 'SORTE', title: 'Satisfação do Cliente em Alta',
      text: 'Fidelidade e vendas sobem. Receba R$ 6.000,00.',
      cashDelta: +6000 },
    { id: 'casa_change_cert_blue', kind: 'SORTE', title: 'Gestão de Mudanças Bem-sucedida',
      text: 'Um vendedor generalista concluiu todos os treinamentos. Ganhe um certificado AZUL para esse vendedor.',
      _compute: () => ({ certDelta: { az: 1 } }) },
    { id: 'training_roi_team', kind: 'SORTE', title: 'Treinamento Personalizado',
      text: 'Receba R$ 500,00 por membro participante.',
      _compute: (p) => ({ cashDelta: 500 * Math.max(0, teamSize(p)) }) },
    { id: 'purple_award_25k', kind: 'SORTE', title: 'Profissional do Ano (Roxo)',
      text: 'Se houver pelo menos um colaborador com certificado roxo, receba R$ 25.000,00.',
      _compute: (p) => ({ cashDelta: hasPurpleCert(p) ? 25000 : 0 }) },
    { id: 'reputation_1500', kind: 'SORTE', title: 'Reputação Impecável',
      text: 'Ótimas avaliações elevam a confiança. Receba R$ 1.500,00.',
      cashDelta: +1500 },
    { id: 'client_cheer_per_client', kind: 'SORTE', title: 'Cliente Promotor',
      text: 'Ganhe R$ 500,00 por cada cliente atual.',
      _compute: (p) => ({ cashDelta: 500 * Math.max(0, num(p.clients)) }) },
    { id: 'big_order_freight_save', kind: 'SORTE', title: 'Grande Pedido + Frete Econômico',
      text: 'Receba R$ 1.500,00.',
      cashDelta: +1500 },
    { id: 'sales_win_2k', kind: 'SORTE', title: 'Vitória de Vendas',
      text: 'Venda aguardada foi fechada. Receba R$ 2.000,00.',
      cashDelta: +2000 },
    { id: 'missed_admission', kind: 'REVES', title: 'Admissão Não Reportada',
      text: 'Multa governamental. Pague R$ 3.000,00.',
      cashDelta: -3000 },
    { id: 'no_mix_a_pay_7000', kind: 'REVES', title: 'Mix A Ausente',
      text: 'Se não tiver Mix nível A, pague R$ 7.000,00.',
      _compute: (p) => ({ cashDelta: hasMixA(p) ? 0 : -7000 }) },
    { id: 'key_client_at_risk', kind: 'REVES', title: 'Cliente Chave em Risco',
      text: 'Sem certificado AMARELO: perca 1 cliente e pague R$ 2.000,00.',
      _compute: (p) => hasYellowCert(p)
        ? { clientsDelta: 0, cashDelta: 0, _overrideText: 'Você possui certificado amarelo. Nada acontece.' }
        : { clientsDelta: -1, cashDelta: -2000 } },
    { id: 'social_crisis', kind: 'REVES', title: 'Crise nas Redes',
      text: 'Pague R$ 400,00 e perca 2 clientes.',
      cashDelta: -400, clientsDelta: -2 },
    { id: 'car_break', kind: 'REVES', title: 'Carro Quebrou',
      text: 'Conserto urgente. Pague R$ 1.000,00.',
      cashDelta: -1000 },
    { id: 'service_improvement_1k', kind: 'REVES', title: 'Aprimoramentos de Serviço',
      text: 'Pague R$ 1.000,00.',
      cashDelta: -1000 },
    { id: 'recovery_failed_5k', kind: 'REVES', title: 'Recuperação Mal Sucedida',
      text: 'Cancele grande pedido. Pague R$ 5.000,00.',
      cashDelta: -5000 },
    { id: 'discount_pressure_1k', kind: 'REVES', title: 'Descontos Forçados',
      text: 'Pressão por descontos reduziu sua margem. Pague R$ 1.000,00.',
      cashDelta: -1000 },
    { id: 'domino_2k', kind: 'REVES', title: 'Efeito Dominó',
      text: 'Cancelamentos em cadeia. Perca R$ 2.000,00.',
      cashDelta: -2000 },
    { id: 'needs_change_lose4', kind: 'REVES', title: 'Necessidades Mudaram',
      text: 'Sem certificado AZUL: perca 4 clientes.',
      _compute: (p) => hasBlueCert(p)
        ? { clientsDelta: 0, _overrideText: 'Você possui certificado azul. Nada acontece.' }
        : { clientsDelta: -4 } },
    { id: 'payroll_error_1k', kind: 'REVES', title: 'Erro na Folha',
      text: 'Corrigir problema. Pague R$ 1.000,00.',
      cashDelta: -1000 },
    { id: 'strike_lose5', kind: 'REVES', title: 'Greve Inesperada',
      text: 'Atrasos e perdas. Perca 5 clientes.',
      clientsDelta: -5 },
    { id: 'customs_hold_3k', kind: 'REVES', title: 'Alfândega',
      text: 'Pague R$ 3.000,00.',
      cashDelta: -3000 },
    { id: 'cyber_breach_7k_or_A', kind: 'REVES', title: 'Falha de Segurança',
      text: 'Se NÃO tiver sistemas nível A, pague R$ 7.000,00.',
      _compute: (p) => ({ cashDelta: erpLevelA(p) ? 0 : -7000 }) },
    { id: 'supplier_issue_2k', kind: 'REVES', title: 'Fornecedor em Crise',
      text: 'Expedição expressa. Pague R$ 2.000,00.',
      cashDelta: -2000 },
    { id: 'reg_change_10k', kind: 'REVES', title: 'Regulamentação Nova',
      text: 'Adequação de processos. Pague R$ 10.000,00.',
      cashDelta: -10000 },
    { id: 'bad_mix_2500', kind: 'REVES', title: 'Mix de Produtos Desequilibrado',
      text: 'Descontos e liquidações. Pague R$ 2.500,00.',
      cashDelta: -2500 },
    { id: 'quality_crisis', kind: 'REVES', title: 'Crise de Qualidade',
      text: 'Perca 1 cliente e pague R$ 1.000,00.',
      cashDelta: -1000, clientsDelta: -1 },
  ]
}

export const SORTE_REVES_CARDS = buildSorteRevesCatalog()

export function resolveSorteRevesCard(card, player = {}) {
  const base = { action: 'APPLY_CARD', kind: card.kind, id: card.id, title: card.title }
  if (typeof card._compute === 'function') {
    const dyn = card._compute(player || {})
    const { _overrideText, ...effect } = dyn || {}
    return {
      text: _overrideText || card.text,
      payload: { ...base, ...effect },
    }
  }
  const fixed = {}
  if (Number.isFinite(card.cashDelta)) fixed.cashDelta = Number(card.cashDelta)
  if (Number.isFinite(card.clientsDelta)) fixed.clientsDelta = Number(card.clientsDelta)
  return { text: card.text, payload: { ...base, ...fixed } }
}

export function pickSorteRevesCard(indexOrRng) {
  const cards = SORTE_REVES_CARDS
  let idx = 0
  if (typeof indexOrRng === 'function') {
    idx = Math.min(cards.length - 1, Math.floor(indexOrRng() * cards.length))
  } else if (Number.isFinite(Number(indexOrRng))) {
    idx = Math.abs(Math.floor(Number(indexOrRng))) % cards.length
  }
  return cards[idx]
}
