/**
 * Conteúdo do tour “Como jogar” — linguagem bem didática e detalhada.
 * Tabelas numéricas: tutorialGlossary.js (fonte alinhada ao motor).
 * Não altera regras: só copy educacional.
 */

import { TOUR_GLOSSARY, MANUAL_CONSTANTS, MIX_PURCHASE_PRICES } from './tutorialGlossary.js'
import { VENDOR_RULES, ERP_RULES, MIX_RULES } from '../game/gameRules.js'

export { TOUR_GLOSSARY }

const money = (n) => `$ ${Number(n || 0).toLocaleString('pt-BR')}`

export const TOUR_WELCOME = {
  title: 'Sales Game: vamos aprender juntos!',
  subtitle: 'Explicação bem devagar, detalhe por detalhe',
  body: [
    'Imagine que você ganhou uma lojinha de brinquedos… só que aqui a lojinha é uma empresa de vendas.',
    'Você vai cuidar de quatro coisas: o DINHEIRO (caixa), as COISAS da empresa (bens), as PESSOAS que vendem e os CLIENTES.',
    'Neste tour a gente explica tudo bem devagar: o que fazer no seu turno, o que cada casa faz, como o dinheiro entra e sai, e o caderninho de valores (glossário).',
    'Pode seguir até o fim ou pular — o botão “Como jogar” abre de novo quando quiser.',
  ],
}

/** Etapas do tour (ordem pedagógica). */
export const TOUR_STEPS = [
  {
    id: 'objetivo',
    title: 'Qual é o objetivo do jogo?',
    icon: '🏆',
    body: [
      'Pense assim: no final da partida, quem “ganhou” não é quem andou mais casas — é quem ficou mais RICO de verdade.',
      'A gente mede isso com o PATRIMÔNIO. Patrimônio é a soma de duas coisas:',
      '1) CAIXA = o dinheiro solto que você tem agora (como notas na carteira).',
      '2) BENS = o valor das coisas que a empresa comprou (equipe, sistemas, mix, clientes etc. — como brinquedos caros que você já pagou).',
      'Continha mágica: Patrimônio = Caixa + Bens.',
      'Se dois jogadores empatam no patrimônio, ganha quem tem MAIS CAIXA. Se ainda empatar, decide pelo nome.',
    ],
    highlight: 'Ganha quem terminar com o maior Patrimônio (Caixa + Bens).',
  },
  {
    id: 'rodadas',
    title: 'O que é uma rodada?',
    icon: '🔁',
    body: [
      'Uma RODADA é como um “mês” da sua empresa.',
      'O dono da sala (host) escolhe quantos meses o jogo vai ter: de 1 até 5. O padrão é 5.',
      'Em cada volta no tabuleiro você passa por duas casas muito importantes: Faturamento (dinheiro ENTRANDO) e Despesas (dinheiro SAINDO).',
      'Quando todos os jogadores vivos completam esse ciclo do mês, a rodada avança.',
      `No começo você já recebe um kit de presente: Caixa ${money(MANUAL_CONSTANTS.startCash)}, Bens ${money(MANUAL_CONSTANTS.startBens)}, Mix nível D, ERP nível D, 1 Vendedor Comum e 1 cliente.`,
    ],
    highlight: 'Mais rodadas = mais tempo para investir e crescer.',
  },
  {
    id: 'turno',
    title: 'Como funciona o SEU turno?',
    icon: '🎲',
    body: [
      'Quando for a sua vez, aparece o botão “Rolar Dado & Andar”.',
      'Passo 1: toque no botão. O dado escolhe um número de 1 a 6.',
      'Passo 2: seu peãozinho anda exatamente essas casas no tabuleiro.',
      'Passo 3: a casa onde você parou (ou as casas que você atravessou) pode abrir uma janelinha pedindo uma decisão — comprar, pagar, ler uma carta…',
      'Passo 4: resolva com calma. Quando terminar, é a vez do próximo amigo.',
      'No celular deitado, se o painel estiver apertado, use “Ver resumo / placar” para ver seus números grandes.',
    ],
    highlight: 'Um turno = rolar → andar → resolver a casa → passar a vez.',
  },
  {
    id: 'casas',
    title: 'As casas do tabuleiro (cada uma tem um trabalho)',
    icon: '🗺️',
    body: [
      'O tabuleiro é um caminho em volta. Cada casa é um “lugarzinho” com uma missão diferente.',
      'Toque nos botões coloridos abaixo para ver o que cada tipo de casa faz.',
      'Os números exatinhos (preços) estão também no glossário, mais à frente — como um caderninho de consulta.',
    ],
    interactive: 'tiles',
  },
  {
    id: 'ciclo',
    title: 'Dinheiro entrando e saindo (o ciclo do mês)',
    icon: '💰',
    body: [
      'Imagine um cofre: no Faturamento o cofre RECEBE; nas Despesas o cofre PAGA as contas.',
      'FATURAMENTO DO MÊS: é o dinheiro das vendas. Ele depende da sua equipe, de quantos clientes conseguem ser atendidos, do Mix e do ERP.',
      'DESPESAS OPERACIONAIS: é a manutenção — pagar salários, manter Mix/ERP e cuidar da carteira de clientes. Se você pegou empréstimo, a cobrança (valor + 50% de juros) também aparece aqui.',
      'Atenção especial: se você tem MAIS clientes do que a equipe consegue atender, os clientes “a mais” não geram venda naquele mês (ficam ociosos). Mas eles ainda podem gerar DESPESA de carteira — por isso capacidade é importante!',
    ],
    highlight: 'Capacidade da equipe ≥ clientes = todo mundo trabalhando e gerando venda.',
  },
  {
    id: 'glossario',
    title: 'Caderninho de valores (glossário)',
    icon: '📘',
    body: [
      'Aqui está o “manualzinho de preços” do jogo — igual o motor usa de verdade.',
      'Role a lista com calma. Cada tabelinha responde: quanto custa comprar? quanto fatura? quanto gasta por mês?',
      'Não precisa decorar tudo de uma vez. Volte aqui sempre que for decidir um investimento.',
    ],
    interactive: 'glossary',
  },
  {
    id: 'hud',
    title: 'O painel (HUD): seu painel de controle',
    icon: '📊',
    body: [
      'O painel é como o painel de um foguete: mostra se a empresa está bem ou apertada.',
      'Toque nos cartões abaixo para entender cada grupo de informações.',
    ],
    interactive: 'hud',
  },
  {
    id: 'recuperacao',
    title: 'E se o dinheiro acabar? (Recuperação)',
    icon: '🛠️',
    body: [
      'Às vezes a conta não fecha — acontece! O jogo te dá ferramentas de emergência.',
      'Abra “Recuperação Financeira” e escolha COM CUIDADO (cada opção tem um preço ou uma consequência).',
      'Veja as opções abaixo, bem explicadinhas:',
    ],
    interactive: 'recovery',
  },
  {
    id: 'falencia',
    title: 'Falência: o botão de “não aguento mais”',
    icon: '⚠️',
    body: [
      'Falência é o último recurso — como dizer “minha empresa não consegue continuar”.',
      'Se você declara falência, sai da disputa ativa: não joga mais turnos de compra.',
      'Se ainda existem outros jogadores vivos, a partida pode seguir sem você.',
      'Se você era o único jogador ativo, a partida termina.',
      'Dica de ouro: tente recuperar antes. Falência é o fim da sua corrida pelo patrimônio.',
    ],
    highlight: 'Prefira recuperar. Falência = sair do jogo ativo.',
  },
  {
    id: 'pronto',
    title: 'Agora é com você!',
    icon: '🚀',
    body: [
      'Resumo de herói: cuide do caixa, mantenha equipe suficiente para os clientes, invista com inteligência e maximize o patrimônio.',
      'Lembre: Caixa + Bens = Patrimônio. É isso que decide o vencedor.',
      'Qualquer dúvida, abra de novo em “Como jogar”. Boa sorte e boas vendas!',
    ],
  },
]

export const TOUR_TILES = [
  {
    key: 'CLIENTS',
    title: 'Carteira de Clientes',
    body: `Aqui você CONSEGUE clientes novos (como fazer amiguinhos para a loja). Cada cliente custa ${money(MANUAL_CONSTANTS.clientPrice)}. Todo ciclo existe uma “mensalidade” da carteira de ${money(MANUAL_CONSTANTS.clientPortfolioDesp)} por cliente. Se a equipe não der conta de atender todo mundo, o excedente não fatura naquele mês.`,
  },
  {
    key: 'COMMON',
    title: 'Vendedor Comum',
    body: `É o “faz-tudo” da equipe. Atende até ${VENDOR_RULES.comum.cap} clientes. Contratar custa ${money(MANUAL_CONSTANTS.commonHire)}. Todo mês gasta cerca de ${money(VENDOR_RULES.comum.baseDesp)} de manutenção base e ajuda a faturar (base ${money(VENDOR_RULES.comum.baseFat)}). Treinamentos deixam ele ainda melhor.`,
  },
  {
    key: 'FIELD',
    title: 'Canal representantes',
    body: `Representantes externos do Canal representantes: vendem com ticket maior. Capacidade ${VENDOR_RULES.field.cap} (atende até ${VENDOR_RULES.field.cap} clientes). Contratação ${money(VENDOR_RULES.field.hire)}; desp. base ${money(VENDOR_RULES.field.baseDesp)}; fat base ${money(VENDOR_RULES.field.baseFat)}. Bom quando você quer faturar forte por pessoa.`,
  },
  {
    key: 'INSIDE',
    title: 'Inside Sales',
    body: `Vendedor de escritório / telefone: atende mais gente. Capacidade ${VENDOR_RULES.inside.cap} (atende até ${VENDOR_RULES.inside.cap} clientes). Contratação ${money(VENDOR_RULES.inside.hire)}; desp. base ${money(VENDOR_RULES.inside.baseDesp)}; fat base ${money(VENDOR_RULES.inside.baseFat)}. Ótimo para volume de atendimento.`,
  },
  {
    key: 'MANAGER',
    title: 'Gestor Comercial',
    body: `O chefe do time! Não atende cliente diretamente, mas impulsiona o faturamento da equipe conforme os certificados. Contratação ${money(MANUAL_CONSTANTS.managerHire)}; desp. base ${money(VENDOR_RULES.gestor.baseDesp)}. Veja a tabelinha de boost no glossário.`,
  },
  {
    key: 'ERP',
    title: 'ERP / Sistemas',
    body: `É o “computador inteligente” da empresa (níveis A–D, um de cada vez). Custa para comprar e depois gera fat/desp POR COLABORADOR. Exemplo nível D: compra ${money(ERP_RULES.D.price)}, fat ${money(ERP_RULES.D.fat)} e desp ${money(ERP_RULES.D.desp)} por pessoa da equipe. Tabelas completas no glossário.`,
  },
  {
    key: 'MIX',
    title: 'Mix de Produtos',
    body: `É a “prateleira” de produtos (níveis A–D). Quanto mais rica a prateleira, mais cada cliente pode faturar — e também mais custa manter. Exemplo D: compra ${money(MIX_PURCHASE_PRICES.D)}, fat ${money(MIX_RULES.D.fatPerClient)} e desp ${money(MIX_RULES.D.despPerClient)} por cliente. Detalhes no glossário.`,
  },
  {
    key: 'TRAINING',
    title: 'Treinamento',
    body: `Aqui você compra “medalhinhas” (certificados) Azul, Amarelo ou Roxo por ${money(MANUAL_CONSTANTS.trainingPrice)} cada. Elas melhoram o desempenho dos vendedores e o efeito do gestor. É como mandar o time para um cursinho.`,
  },
  {
    key: 'DIRECT_BUY',
    title: 'Direito de Compra',
    body: 'Uma chance especial: escolha EXATAMENTE UM investimento livre agora (equipe, mix, ERP, treinamento ou clientes). Os preços são os mesmos das casas específicas — não é promoção, é liberdade de escolher.',
  },
  {
    key: 'LUCK',
    title: 'Sorte & Revés',
    body: 'Puxe a carta do topo! Pode ser uma surpresa boa (sorte: ganhar dinheiro ou ficar isento de algo) ou uma surpresa chata (revés: multa, perda ou queda de produtividade). É a casa da emoção.',
  },
  {
    key: 'REVENUE',
    title: 'Faturamento do Mês',
    body: 'Aqui o dinheiro das vendas ENTRA no caixa. A conta junta equipe + Mix + ERP (só entram os clientes que a equipe consegue atender). Cruzar esta casa marca o fechamento da volta/mês.',
  },
  {
    key: 'EXPENSES',
    title: 'Despesas Operacionais',
    body: 'Aqui o dinheiro SAI para pagar as contas do mês: equipe, Mix, ERP e carteira de clientes. Se pediu empréstimo, a quitação (valor + 50% de juros) cai nesta casa na próxima rodada. Sem caixa, liquide o patrimônio a 50% do valor de compra; se não bastar, falência.',
  },
]

export const TOUR_HUD = [
  {
    title: 'Financeiro',
    body: 'É a parte do “quanto eu tenho de dinheiro?”. Mostra o Caixa (notas na carteira), o que entrou no mês (faturamento), o que sai de manutenção, se tem empréstimo e o valor dos Bens (suas “coisas”, que também servem de garantia).',
  },
  {
    title: 'Estrutura comercial',
    body: 'Conta as pessoas do time: Vendedores Comuns, Canal representantes, Inside Sales e Gestores. Mais gente = mais clientes você consegue atender… mas também mais salário todo mês.',
  },
  {
    title: 'Infraestrutura',
    body: 'Mostra o nível do Mix (prateleira de produtos) e do ERP (computador/sistema). Começa em D (simples) e pode subir até A (mais forte e mais caro de comprar e manter).',
  },
  {
    title: 'Certificações',
    body: 'São as medalhinhas Azul, Amarelo e Roxo que o time ganha no Treinamento. Cada cor muda um pouquinho o quanto a pessoa vende e quanto custa mantê-la.',
  },
  {
    title: 'Operação',
    body: 'Aqui você vê: quantos clientes tem, qual a capacidade total da equipe e quantos estão “Em Atendimento” (sempre o menor entre clientes e capacidade — ninguém atende o que não cabe!).',
  },
  {
    title: 'Placar',
    body: 'É o placar da corrida entre amigos: Caixa e Patrimônio de cada um. No final da partida, quem tiver o maior Patrimônio (Caixa + Bens) é o campeão!',
  },
]

export const TOUR_RECOVERY = [
  {
    title: 'Empréstimo',
    body: `Peça um único empréstimo (até ${Math.round(MANUAL_CONSTANTS.loanMaxBensRatio * 100)}% do valor de compra dos seus Bens como garantia). Na casa Despesas Operacionais da próxima rodada você devolve o valor + ${Math.round(MANUAL_CONSTANTS.loanInterestRatio * 100)}% de juros. Sem caixa, cada item do patrimônio vale ${Math.round(MANUAL_CONSTANTS.recoveryCreditRatio * 100)}% do que pagou; se ainda não der, é falência.`,
  },
  {
    title: 'Reduzir Mix/ERP',
    body: `Abaixa o nível da prateleira (Mix) ou do sistema (ERP) e recebe de volta cerca de ${Math.round(MANUAL_CONSTANTS.recoveryCreditRatio * 100)}% do valor. Você fica “mais simples”, mas ganha caixa imediato.`,
  },
  {
    title: 'Demitir',
    body: `Manda embora colaboradores e recebe cerca de ${Math.round(MANUAL_CONSTANTS.recoveryCreditRatio * 100)}% do valor de contratação. Cuidado: a capacidade cai e pode sobrar cliente sem atendimento.`,
  },
  {
    title: 'Declarar falência',
    body: 'Último botão de emergência: você sai da disputa ativa. Use só se realmente não houver como continuar.',
  },
]
