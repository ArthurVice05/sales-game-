/**
 * Glossário / manual numérico do Sales Game.
 * Valores derivados de gameRules (fonte do motor) + preços de compra usados nas modais.
 * Linguagem bem didática (explica detalhe por detalhe). Só conteúdo educacional — não altera regras.
 */

import {
  VENDOR_RULES,
  ERP_RULES,
  MIX_RULES,
  CERT_EFFECTS,
  MANAGER_BOOST_BY_CERT,
  MANAGER_BOOST_MAX_CERTS,
  MANAGER_MANAGES_UP_TO,
} from '../game/gameRules.js'
import { MIX_PURCHASE_PRICES, MANUAL_CONSTANTS } from '../game/manualConstants.js'

export { MIX_PURCHASE_PRICES, MANUAL_CONSTANTS }

const money = (n) => `$ ${Number(n || 0).toLocaleString('pt-BR')}`
const pct = (x) => `${Math.round(Number(x || 0) * 100)}%`

function vendorRow(key, label, hire) {
  const r = VENDOR_RULES[key]
  return [
    label,
    String(r.cap),
    money(hire ?? r.hire ?? 0),
    money(r.baseDesp),
    money(r.baseFat),
    `+${money(r.incFat)} / +${money(r.incDesp)}`,
  ]
}

/**
 * Seções do glossário (tabelas) para o tour / “Como jogar”.
 */
export function buildTourGlossary() {
  const c = MANUAL_CONSTANTS

  return [
    {
      id: 'inicio',
      title: 'Presente de começo (kit inicial)',
      note: 'Quando a partida começa, é como ganhar uma caixinha de presente igual para todo mundo — assim ninguém começa zerado e a corrida fica justa.',
      bullets: [
        'Caixa = dinheiro solto na carteira (você pode gastar agora).',
        'Bens = valor das coisas que a empresa já “tem” (contam no patrimônio).',
        'Mix D e ERP D = a prateleira e o computador mais simples.',
        '1 Vendedor Comum + 1 cliente = time pequenininho para começar a vender.',
      ],
      headers: ['O que você ganha', 'Quanto / o quê'],
      rows: [
        ['Dinheiro na carteira (Caixa)', money(c.startCash)],
        ['Coisas da empresa (Bens)', money(c.startBens)],
        ['Patrimônio inicial (Caixa + Bens)', money(c.startCash + c.startBens)],
        ['Prateleira de produtos (Mix)', 'Nível D (a mais simples)'],
        ['Sistema da empresa (ERP)', 'Nível D'],
        ['Pessoas no time', '1 Vendedor Comum'],
        ['Clientes', '1 cliente'],
      ],
    },
    {
      id: 'equipe',
      title: 'Pessoas do time (quanto atendem e quanto custam)',
      note: 'Pense em cada pessoa como um herói com “quantos clientes consegue cuidar”. Capacidade = esse número. Contratação = preço para chamar a pessoa. Desp. base ≈ custo mensal. Fat base ≈ quanto ajuda a vender. Δ cert = o “plus” que os treinamentos somam.',
      bullets: [
        'Se a equipe atende POUCOS clientes e você tem MUITOS clientes, os clientes a mais ficam sem atendimento naquele mês (não geram aquela venda).',
        'O Gestor é o chefe: não atende cliente, mas pode aumentar o faturamento dos vendedores (boost).',
        'Mais gente = mais capacidade e mais custo. É um equilíbrio!',
      ],
      headers: ['Tipo', 'Cap.', 'Contratação', 'Desp. base', 'Fat base', 'Δ cert (fat/desp)'],
      rows: [
        vendorRow('comum', 'Vendedor Comum', c.commonHire),
        vendorRow('field', 'Canal representantes', VENDOR_RULES.field.hire),
        vendorRow('inside', 'Inside Sales', VENDOR_RULES.inside.hire),
        [
          'Gestor Comercial',
          '0*',
          money(c.managerHire),
          money(VENDOR_RULES.gestor.baseDesp),
          '—',
          `desp +${money(VENDOR_RULES.gestor.incDesp)} × certs`,
        ],
      ],
      footnotes: [
        `* O Gestor não atende cliente. Orientação de equipe: até ${MANAGER_MANAGES_UP_TO} colaboradores (não altera o cálculo de fat/desp).`,
      ],
    },
    {
      id: 'certs',
      title: 'Treinamentos (medalhinhas coloridas)',
      note: `Na casa de Treinamento você compra “medalhinhas” por ${money(c.trainingPrice)} cada. É como mandar o time para um cursinho: elas melhoram Comum, Field e Inside. Amarelo ajuda a vender sem aumentar a despesa do incremento; Roxo é mais forte nos dois lados.`,
      bullets: [
        'Azul, Amarelo e Roxo são tipos diferentes de melhoria.',
        'Você escolhe para qual tipo de vendedor (ou gestor) a medalhinha vai.',
        'Não precisa comprar todas de uma vez — escolha com carinho conforme o caixa.',
      ],
      headers: ['Cor', 'Efeito no fat', 'Efeito na desp'],
      rows: Object.values(CERT_EFFECTS).map((e) => [
        e.label,
        `× ${e.multFat} no incremento`,
        e.multDesp === 0 ? 'sem +desp (só ajuda a vender)' : `× ${e.multDesp} no incremento`,
      ]),
      footnotes: [
        'Jeito fácil de pensar: rate de venda ≈ base + (incremento × soma dos multiplicadores). Despesa unitária funciona parecido.',
      ],
    },
    {
      id: 'gestor-boost',
      title: 'Superpoder do Gestor (boost)',
      note: `Quanto mais certificados o gestor tem (até ${MANAGER_BOOST_MAX_CERTS}), maior o percentual EXTRA no faturamento dos VENDEDORES. O Mix e o ERP não recebem esse boost — só a parte da equipe de vendas.`,
      bullets: [
        '0 certificado = sem boost.',
        `Máximo usado no motor: ${MANAGER_BOOST_MAX_CERTS} certificados (${pct(MANAGER_BOOST_BY_CERT[MANAGER_BOOST_MAX_CERTS])}).`,
        'Lembre: gestor custa dinheiro todo mês — o boost precisa “pagar” esse custo.',
      ],
      headers: ['Certificados do gestor', 'Boost'],
      rows: MANAGER_BOOST_BY_CERT
        .slice(0, MANAGER_BOOST_MAX_CERTS + 1)
        .map((b, i) => [String(i), pct(b)]),
    },
    {
      id: 'mix',
      title: 'Mix de Produtos (a prateleira A–D)',
      note: 'O Mix é a prateleira da loja. Só um nível por vez (não soma A+B+C). Quanto mais rica a prateleira, mais cada cliente pode faturar — e mais custa manter. A venda do Mix usa clientes Em Atendimento; a despesa do Mix conta TODOS os clientes.',
      bullets: [
        'D = mais barato e mais fraco.',
        'A = mais caro e mais forte.',
        'Subir de nível troca o nível antigo pelo novo (um de cada vez).',
      ],
      headers: ['Nível', 'Compra', 'Fat / cliente', 'Desp / cliente'],
      rows: ['A', 'B', 'C', 'D'].map((L) => [
        L,
        money(MIX_PURCHASE_PRICES[L]),
        money(MIX_RULES[L].fatPerClient),
        money(MIX_RULES[L].despPerClient),
      ]),
    },
    {
      id: 'erp',
      title: 'ERP / Sistemas (o computador A–D)',
      note: 'O ERP é o “computador inteligente” da empresa. Também é um nível por vez (A–D). Os valores são POR COLABORADOR (Comuns + Field + Inside + Gestores), não por cliente. Mais gente no time = mais efeito (e mais custo) do ERP.',
      bullets: [
        'Compra = preço para instalar/subir o nível.',
        'Fat / colab. = quanto aquele nível ajuda a vender por pessoa do time.',
        'Desp / colab. = quanto custa manter por pessoa do time.',
      ],
      headers: ['Nível', 'Compra', 'Fat / colab.', 'Desp / colab.'],
      rows: ['A', 'B', 'C', 'D'].map((L) => [
        L,
        money(ERP_RULES[L].price),
        money(ERP_RULES[L].fat),
        money(ERP_RULES[L].desp),
      ]),
    },
    {
      id: 'clientes',
      title: 'Clientes (amiguinhos da loja)',
      note: 'Cliente é quem compra da sua empresa. Conquistar cliente custa. Manter a carteira também custa todo ciclo (como uma mensalidade). Se a equipe não der conta, o cliente “a mais” não gera a venda daquele mês — mas ainda pode gerar despesa.',
      bullets: [
        `Preço para conquistar 1 cliente: ${money(c.clientPrice)}.`,
        `Despesa de carteira por cliente / ciclo: ${money(c.clientPortfolioDesp)}.`,
        'Em Atendimento = o menor entre: total de clientes e capacidade da equipe.',
      ],
      headers: ['Item', 'Valor'],
      rows: [
        ['Preço para conquistar 1 cliente', money(c.clientPrice)],
        ['Despesa de carteira por cliente / ciclo', money(c.clientPortfolioDesp)],
        ['Em Atendimento', 'mín(clientes, capacidade da equipe)'],
      ],
      footnotes: [
        'Dica de ouro: antes de comprar muitos clientes, confira se a equipe tem capacidade. Senão você paga a carteira sem faturar o excesso.',
      ],
    },
    {
      id: 'faturamento',
      title: 'Como o Faturamento é somado (passo a passo)',
      note: 'Quando você passa na casa de Faturamento, o jogo abre o cofre e coloca dinheiro DENTRO. Ele faz esta receita, bem direitinho:',
      bullets: [
        '1) Olha a equipe e calcula quanto ela poderia vender (base + efeitos de treinamento).',
        '2) Ajusta pela fração de clientes realmente atendidos (emAtendimento ÷ capacidade). Se sobrar cliente, essa parte não entra.',
        '3) Se tem gestor com boost, aumenta a parte dos vendedores (não o Mix/ERP).',
        '4) Soma o Mix: fat por cliente × clientes Em Atendimento.',
        '5) Soma o ERP: fat por colaborador × tamanho do time.',
        '6) Arredonda para baixo e coloca no Caixa. Pronto: dinheiro entrou!',
      ],
    },
    {
      id: 'despesas',
      title: 'Como as Despesas são somadas (passo a passo)',
      note: 'Quando você passa na casa de Despesas, o jogo tira dinheiro do cofre para pagar as contas do “mês”. A cobrança é assim:',
      bullets: [
        '1) Salários/manutenção da equipe (com efeito dos certificados).',
        '2) Custo do(s) gestor(es).',
        '3) Manutenção do Mix × TODOS os clientes (mesmo os ociosos).',
        '4) Manutenção do ERP × colaboradores.',
        `5) Carteira de clientes: ${money(c.clientPortfolioDesp)} × cada cliente.`,
        '6) Se você pediu empréstimo, nesta casa da próxima rodada quita o valor + 50% de juros (garantia de até 50% dos bens). Sem caixa, liquide o patrimônio a 50% do valor de compra; se não bastar, falência.',
      ],
    },
    {
      id: 'recuperacao',
      title: 'Ferramentas de emergência (valores)',
      note: 'Se o caixa apertar, abra Recuperação Financeira. Cada opção é uma troca: você ganha fôlego agora, mas perde alguma coisa ou cria uma dívida. Escolha com carinho.',
      bullets: [
        'Empréstimo = 1× na partida, até 50% dos bens; quita nas Despesas da próxima rodada com 50% de juros.',
        'Reduzir Mix/ERP = caixa imediato, mas a prateleira/sistema fica mais fraca.',
        'Demitir = caixa imediato, mas cai a capacidade de atender.',
        'Falência = você sai da disputa ativa (último recurso).',
      ],
      headers: ['Opção', 'O que acontece'],
      rows: [
        ['Empréstimo', `Até ${pct(c.loanMaxBensRatio)} dos Bens (garantia); 1× na partida; quita nas Despesas da próxima rodada com ${pct(c.loanInterestRatio)} de juros; sem caixa, itens a ${pct(c.recoveryCreditRatio)}`],
        ['Reduzir Mix/ERP', `Recebe ~${pct(c.recoveryCreditRatio)} do preço, mas o nível cai`],
        ['Demitir', `Recebe ~${pct(c.recoveryCreditRatio)} da contratação, mas perde capacidade`],
        ['Falência', 'Você sai da disputa ativa'],
      ],
    },
    {
      id: 'vitoria',
      title: 'Como se ganha de verdade',
      note: 'No final das rodadas escolhidas pelo host, o jogo olha o patrimônio de cada um. Não ganha quem andou mais casas — ganha quem ficou mais rico de verdade.',
      bullets: [
        'Patrimônio = Caixa + Bens.',
        'Maior patrimônio = campeão.',
        'Empate no patrimônio? Ganha quem tem mais Caixa.',
        'Ainda empatou? Decide pelo nome (desempate técnico).',
      ],
    },
  ]
}

export const TOUR_GLOSSARY = buildTourGlossary()
