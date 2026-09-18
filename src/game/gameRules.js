// src/game/gameRules.js
// Single source of truth para regras numéricas do jogo (custos/receitas por tipo/nível).
//
// IMPORTANTE:
// - Não altera shape do estado (players/rooms) — apenas centraliza números.
// - Correção A: Vendedor Comum (comum) baseDesp = 1000 (era 100 no gameMath; modal já exibia 1000).
// - Correção B: Gestor com 0 certificados deve ter boost = 0%.

export const VENDOR_RULES = {
  // Observação: `cap` (capacidade de atendimento) já existia no gameMath e é uma regra numérica.
  // Mantemos aqui para evitar divergência futura, sem mudar o schema do estado.
  comum:  { cap: 2, baseFat:  600, incFat: 100, baseDesp: 1000, incDesp: 100 },
  // A2: Canal Representantes = ticket alto; Inside = custo menor.
  // `hire` = CAPEX de contratação (não entra no gameMath mensal).
  inside: { cap: 5, baseFat: 1200, incFat: 500, baseDesp: 1500, incDesp: 100, hire: 2500 },
  field:  { cap: 6, baseFat: 2000, incFat: 500, baseDesp: 2500, incDesp: 100, hire: 4000 },

  // Gestor não gera faturamento direto; ele afeta o faturamento dos colaboradores via boost.
  // Mantemos os campos por consistência e para uso no cálculo de despesas.
  gestor: { cap: 0, baseFat: 0, incFat: 0, baseDesp: 3000, incDesp: 500 },
}

// ERP: fonte única — preço de compra + fat/desp por colaborador
// (vendedoresComuns + insideSales + fieldSales + gestores).
// NÃO escala com clientes (Mix já faz isso).
//
// Rebalanceamento: preços A/B/C/D em hierarquia D < C < B < A.
// Taxas fat/desp por colaborador preservadas. Starter já possui D
// (não cobra price no início — só em compra/recovery).
export const ERP_RULES = {
  A: { price: 2500, fat: 1000, desp: 400 },
  B: { price: 1200, fat:  500, desp: 200 },
  C: { price:  400, fat:  200, desp: 100 },
  D: { price:  200, fat:   70, desp:  50 },
}

/** Preço de compra do nível ERP (upgrade = preço cheio do alvo). */
export function getErpPrice(level) {
  const L = String(level || '').toUpperCase()
  return Number(ERP_RULES[L]?.price || 0)
}

// MIX: valores por cliente — mantém exatamente os valores atuais do gameMath.
export const MIX_RULES = {
  A: { fatPerClient: 1200, despPerClient: 700 },
  B: { fatPerClient:  600, despPerClient: 400 },
  C: { fatPerClient:  300, despPerClient: 200 },
  D: { fatPerClient:  100, despPerClient:  50 },
}

// Boost do Gestor por quantidade de certificados do tipo 'gestor'.
// Regra: índice 0 = 0%. Motor aplica no máx. MANAGER_BOOST_MAX_CERTS (só 3 tipos de cert).
export const MANAGER_BOOST_BY_CERT = [0, 0.20, 0.30, 0.40, 0.60]
/** Máximo de certificados do gestor que entram no boost (alinha com CERT_EFFECTS: 3 tipos). */
export const MANAGER_BOOST_MAX_CERTS = 3

// Orientação de equipe (UI/manual). NÃO altera o cálculo de faturamento/despesa.
export const MANAGER_MANAGES_UP_TO = 7

export function managerBoostPct(certCount = 0) {
  const c = Math.max(0, Math.min(MANAGER_BOOST_MAX_CERTS, Number(certCount) || 0))
  return MANAGER_BOOST_BY_CERT[c] || 0
}

/**
 * Efeitos econômicos por ID de certificado (P2-A2).
 * Aplicam-se a Comum / Field / Inside via soma dos multiplicadores × incFat/incDesp do tipo.
 * NÃO alteram capacidade. NÃO alteram o boost do Gestor.
 *
 * IDs = valores em trainingsByVendor[type]:
 *  - personalizado      → Azul
 *  - fieldsales         → Amarelo
 *  - imersaomultiplier  → Roxo
 */
export const CERT_EFFECTS = {
  personalizado:     { multFat: 1.0, multDesp: 1.0, color: 'azul',    label: 'Azul' },
  fieldsales:        { multFat: 1.0, multDesp: 0.0, color: 'amarelo', label: 'Amarelo' },
  imersaomultiplier: { multFat: 1.2, multDesp: 1.5, color: 'roxo',    label: 'Roxo' },
}

/** Soma dos multiplicadores dos IDs únicos (Set). IDs desconhecidos = 1.0/1.0 (compat). */
export function sumCertMultipliers(certIds = []) {
  let multFatSum = 0
  let multDespSum = 0
  for (const id of new Set(certIds || [])) {
    const effect = CERT_EFFECTS[id]
    if (effect) {
      multFatSum += Number(effect.multFat || 0)
      multDespSum += Number(effect.multDesp || 0)
    } else if (id) {
      multFatSum += 1
      multDespSum += 1
    }
  }
  return { multFatSum, multDespSum }
}

/** Incrementos absolutos de fat/desp de um certificado para um tipo de vendedor. */
export function certDeltaForVendor(vendorType, certId) {
  const rules = VENDOR_RULES[vendorType]
  const effect = CERT_EFFECTS[certId]
  if (!rules || !effect) return { fat: 0, desp: 0 }
  return {
    fat: Number(rules.incFat || 0) * Number(effect.multFat || 0),
    desp: Number(rules.incDesp || 0) * Number(effect.multDesp || 0),
  }
}

