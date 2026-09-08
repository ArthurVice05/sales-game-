# Validação geral — Sales Game V2

Data: 08/09/2026. Escopo: cópia local atual, incluindo o patch Three.js e o último posicionamento do baralho. Auditoria de funcionamento; nenhuma correção de gameplay foi aplicada nesta etapa.

## Parecer

**A validação automatizada passou, mas não há evidência suficiente para declarar todos os modos funcionando de ponta a ponta.**

Foram executados 906 testes, em 213 suítes e 75 arquivos, com zero falhas, zero testes ignorados e zero cancelamentos. O build passou. A revisão adicional encontrou uma falha de protocolo na comunicação entre modais e motor, reproduzida isoladamente, além de impedimentos de configuração para os modos online e máquinas nesta cópia.

Não houve partida observada em navegador nesta auditoria. Portanto, aprovação de regras e simulações não significa aprovação de interface, sincronização real, áudio ou experiência completa.

## Resultado por área

| Área | Resultado automatizado / revisão | Situação de uso real |
|---|---|---|
| Espectador | Helpers de autorização, entrada, saída e contratos de leitura passaram | Não validado em partida; Supabase ausente na configuração local |
| Pessoa × máquina | Política, rolagem, decisões, recuperação e efeitos econômicos passaram nos cenários existentes | Não validado em partida; flag de bots desligada nesta configuração |
| Casual local | Criação de 2–4 jogadores, identidade por turno, isolamento de rede e regras passaram | Não observado no navegador; protocolo de modais tem risco reproduzido |
| Sorte & Revés | 34 cartas, efeitos condicionais, paridade de payload humano/bot, animação matemática e controlador de áudio passaram | Giro, som e confirmação reais pendentes; possível perda de resposta rápida |
| Movimento e turnos | Tabuleiro de 40 casas, volta, eventos de passagem, rotação e rodada final passaram | Animação, input e temporização React não observados |
| Dinheiro, compras e dívidas | Um milhão de operações econômicas e casos com valores independentes passaram | UI → modal → motor → saldo persistido não validado integralmente |
| Build | Aprovado, 279 módulos, 7,10 s | Avisos de bundle e importação mista permanecem |

## Verificações executadas

| Verificação | Evidência desta execução |
|---|---|
| `npm test` | 906 aprovados; 213 suítes; duração 17.501 ms; código de saída 0 |
| `npm run build -- --outDir <temporário>` | Aprovado; código 0; `dist/` do projeto preservado |
| `npm run test:check` | Aprovado; apenas verifica presença de arquivos, não executa a suíte |
| `git diff --check` | Falhou por linha em branco excedente já existente em `src/game/__tests__/localHandoffHold.test.mjs:198` |
| Leitura de configuração com `loadEnv` do Vite | Desenvolvimento e produção: bots desligados, URL e chave anônima do Supabase ausentes |
| `node docs/validation/modal-response-probe.mjs` | Reproduziu resposta perdida e espera não concluída conforme ordem dos callbacks |
| Navegador integrado | Conexão falhou antes da navegação: `missing field sandboxPolicy` |
| Alternativa de navegador instalada | `agent-browser` não encontrado; `node_modules/playwright` e `node_modules/@playwright/test` ausentes |

O build foi gerado em `C:/Users/jpfma/AppData/Local/Temp/salesgame-audit-4a37ed22aaab485fa66d7e61f60e9177`.

## Achados e prioridades

### 1. Alta prioridade: resposta de modal pode ser perdida antes de o motor começar a aguardá-la

O motor chama `pushModal(element)`, aguarda 100 ms e só então chama `awaitTop()` em `src/game/useTurnEngine.jsx:697–703`.

Em `src/modals/ModalContext.jsx`, `closeById` remove o modal e tenta entregar o resultado. Se ainda não existe um aguardador registrado, `resolveAllForId` retorna sem guardar o payload. `awaitTop` posterior recebe `null` quando a referência da pilha já foi atualizada. Se a referência ainda aponta para o modal fechado, pode registrar uma espera para um modal que não voltará a responder.

O diagnóstico `modal-response-probe.mjs` executa os callbacks extraídos do arquivo real com referências controladas. Resultados:

- Controle: registrar espera e depois confirmar conserva `cashDelta: 800`.
- Confirmar antes de registrar a espera, com referência atualizada: resultado `null`, payload perdido.
- Confirmar antes de registrar a espera, com referência antiga: resposta permanece pendente após as microtarefas verificadas.

Isso comprova a fragilidade do protocolo sob essas ordens de execução. **Não monta React, não comprova a frequência no navegador e não estabelece a causa do relato anterior de avanço de turno com carta aberta.**

A animação normal de 2.400 ms reduz a exposição dessa janela. Porém, movimento reduzido revela por timer de 0 ms (`SorteRevesScene.jsx:32`), falhas do renderer também levam ao fallback e a interface permite adiantar a revelação. Uma confirmação suficientemente rápida é um caminho plausível para a janela, ainda a reproduzir em navegador.

Impacto possível no evento LUCK: o motor recebe resultado sem `APPLY_CARD`, segue sem aplicar o efeito ou fica aguardando, dependendo da ordem. A correção recomendada é tornar abertura e registro de resposta uma operação associada ao ID do modal, capaz de preservar resposta precoce, em vez de depender de atraso de renderização. Não corrigido nesta auditoria.

### 2. Impedimento de configuração: online e espectador indisponíveis nesta cópia

`loadEnv('development', ...)` e `loadEnv('production', ...)` não encontraram `VITE_SUPABASE_URL` nem `VITE_SUPABASE_ANON_KEY`. Nenhum valor sensível foi impresso.

`src/lib/supabaseClient.js:13–24` deixa o client como `null` nessa situação e informa explicitamente a indisponibilidade de multiplayer e espectador. Logo, o build atual pode ser gerado, mas isso não comprova acesso a partidas online.

É um impedimento desta configuração local, não uma conclusão sobre um deploy existente ou um servidor já iniciado com outro ambiente. Não foram consultadas salas remotas, políticas de banco, Realtime nem sessões externas.

### 3. Impedimento de configuração: máquinas desativadas

A flag `VITE_SG_BOTS` não está habilitada nos dois modos consultados. `src/game/bots/botFlags.js` exige o valor exato `1`; `App.jsx:407` usa esse resultado para habilitar as máquinas.

Os testes chamam as funções e cenários de bots diretamente, de modo que podem passar mesmo com a funcionalidade desligada na interface. Para verificar pessoa × máquina no produto, é necessário um ambiente com a flag habilitada e a configuração de rede pertinente. Nenhuma flag foi alterada.

### 4. Apresentação: orientação do monte CSS e do monte animado é configurada separadamente

O monte estático usa `rotateX(48deg) rotateZ(-45deg)`, com centro em `top:24%; left:24%`. A cena Three.js encontra sua posição por `getBoundingClientRect`, mas define a rotação do monte animado separadamente em `SorteRevesScene.jsx:54`.

A posição de origem acompanha o monte; continuidade visual de orientação não é garantida por essa leitura. Trata-se de um ponto de inspeção visual após os últimos ajustes, não de um salto visual comprovado. Não há evidência de alteração de dinheiro ou regras causada pelo CSS.

### 5. Avisos menores

- JavaScript principal de 1.262,10 kB, gzip 353,05 kB; o Vite avisa sobre chunk acima de 500 kB. Isso é tamanho de build, não uma medição de FPS ou tempo de carregamento.
- `screenOrientation.js` tem importações estática e dinâmica; a importação dinâmica não o separa em outro chunk.
- Whitespace anterior em `localHandoffHold.test.mjs:198`; sem relação demonstrada com gameplay.

## Espectador: o que foi coberto

Os testes executam os helpers de papel da sessão, autorização, seleção de jogador observado, URLs de espectador e escolha entre entrar, retomar e assistir.

Os contratos estáticos verificam que o espectador não recebe identidade fictícia, não assume o assento observado, não executa os principais caminhos de escrita, não mantém presença de jogador, não comanda auto-pass e não ganha controles de gameplay. Entrada valida o estado autoritativo da sala; saída usa caminho sem desistência do jogador. Sala cheia em andamento pode oferecer assistir; identidade existente prioriza retomada.

Arquivos principais: `spectatorMode.test.mjs`, `spectatorModeIntegration.test.mjs`, `spectatorMode.js`, `GameNetProvider.jsx` e `App.jsx`.

Limite: `spectatorModeIntegration.test.mjs` lê código e usa expressões regulares. Não conecta um espectador a uma partida. Não comprova recebimento real de movimentos, atualização de caixa, latência, reconexão, políticas do servidor nem ausência de escritas na rede em uso real.

## Pessoa × máquina: o que foi coberto

As suítes de bots cobrem política de compra ou recusa, reserva financeira, retorno de investimento, capacidade de atendimento, respeito à rodada final e preservação de jogadores humanos quando não há bots.

Os cenários de execução cobrem autorização do executor, confirmação de movimento antes de efeitos, repetição de tentativas sem duplicar efeitos, mudança de executor, mudança de turno cancelando commit antigo, reconstrução após recarga simulada, despesas, empréstimo, recuperação, falência e encerramento. Há cenários em que duas execuções concorrentes produzem um único efeito lógico.

Sorte & Revés inclui reconstrução da mesma carta por seed/recibo e paridade de payload entre humano e máquina. A máquina toma decisões pelo caminho próprio; não depende de um humano clicar no seu modal de carta.

Limite: recarga, concorrência e persistência são exercitadas nos harnesses existentes, com dependências controladas. Não foram abertas duas abas reais nem jogada uma partida pessoa × máquina nesta auditoria.

## Casual local: o que foi coberto

Criação exige entre 2 e 4 jogadores, nomes preenchidos e distintos e IDs distintos. O kit inicial usa caixa 18.000, bens 4.000, um cliente, um vendedor comum, Mix D e ERP D.

O ator de gameplay acompanha o dono do turno local. Operações de rede e BroadcastChannel são desativadas nesse modo. A troca atual dispensa o antigo pop-up: `App.jsx:2744–2767` libera automaticamente o novo turno quando dado, animação, trava e modais estão em repouso. O novo prazo é calculado na confirmação automática.

Os helpers antigos da espera de cinco segundos ainda são testados, mas isso não significa que exista uma contagem de cinco segundos na interface atual. O componente do pop-up permanece removido pelas alterações anteriores.

Limite: interação no mesmo dispositivo, foco real, duplo clique durante a troca e sequência completa de modais não foram observados. O achado de resposta precoce também pode afetar este modo.

## Movimento, dinheiro e encerramento

As verificações de tabuleiro cobrem configuração imutável de 40 casas, movimento circular, diferenciação de tabuleiro legado, mapeamento de eventos, passagem antes de chegada e posicionamento lógico de jogadores na mesma casa. Rodada final tem casos específicos para parar no faturamento e para o cenário com apenas um jogador vivo.

A auditoria de partidas roda 400 simulações de 2–4 jogadores e 1–5 rodadas, verificando posição válida, turno válido, término e ausência de estagnação nos cenários. Ela dirige primitivas de produção; **não executa o hook React completo de turnos nem equivale a 400 partidas no navegador**.

A auditoria econômica roda 1.000 seeds × 1.000 operações: faturamento, despesas, clientes, contratações, Mix, ERP, empréstimos e variações de caixa. Verifica valores finitos, contadores, patrimônio e capacidade. Parte dos preços e eventos é gerada para estresse; não representa compra permitida pela interface em todos os casos.

Há também uma sequência com valores esperados calculados independentemente:

| Operação da fixture | Caixa esperado |
|---|---:|
| Inicial | 20.000 |
| Compra de clientes: −3.000 | 17.000 |
| Contratação: −2.000 | 15.000 |
| Sorte: +800 | 15.800 |
| Revés: −400 | 15.400 |
| Empréstimo: +6.500 | 21.900 |
| Quitação com 50% de juros: −9.750 | 12.150 |

Essa sequência passou. É uma fixture de cálculo; os valores não devem ser interpretados como todos os preços oficiais do catálogo.

Outros testes cobrem limite de empréstimo de 50% dos bens, vencimento, não repetir a cobrança do mesmo empréstimo, recuperação por redução/demissão, ranking por patrimônio e falência. Caixa negativo pode ocorrer em helpers de cobrança conforme a regra atual; a recuperação/falência pertence à orquestração. Não é correto afirmar que todos os helpers sempre mantêm caixa não negativo.

## Sorte & Revés: o que foi coberto

As 34 cartas têm IDs únicos e testes de valores e condicionais: certificados, Mix/ERP, clientes, equipe e gestor certificado. O conjunto verifica payloads finitos, ausência de mutação do jogador ao resolver, snapshot e paridade humano/bot em estados condicionais.

A cena tem testes matemáticos de 2.400 ms, orientação final, continuidade das fases, revelação única, cancelamento, callback tardio e descarte de recursos Three. O controlador de áudio tem testes de variante, preferência, reprodução por abertura, corte e falhas com dependências simuladas.

O modal impede confirmação antes da revelação e usa uma trava por abertura. O motor aplica o resultado ao `ownerId`; Revés com custo passa por recuperação de saldo e usa `skipNegativeCash` para evitar um segundo débito no helper da carta.

Limites: não foram ouvidos MP3s, medidos enquadramento/overflow, observados foco/teclado, testado autoplay real nem forçada perda de contexto WebGL em navegador. Teste do descarte de objetos não é medição de memória GPU. A trava de clique único do modal não resolve a perda de payload antes de `awaitTop`.

## Relato anterior de avanço de turno com carta aberta

Permanece sem reprodução de ponta a ponta. A revisão encontrou proteções explícitas: a fila mantém `eventsInProgressRef` durante o processamento; `openModalAndWait` mantém contador de modais; o tick aguarda modais/eventos; watchdogs não deveriam forçar desbloqueio com pipeline ativo.

Os testes dessas decisões passaram. Isso não exclui uma corrida de integração React, sincronização remota ou outra entrada de avanço. O achado da resposta precoce é separado: não deve ser apresentado como causa confirmada do relato nem como correção realizada.

## Condições para aprovação completa

1. Corrigir e adicionar regressão do protocolo de resposta precoce de modal, incluindo resposta antes do registro de espera e após fechamento.
2. Disponibilizar configuração de teste para rede e máquinas; verificar a configuração efetiva do servidor que será usado.
3. Executar partida local de 2–4 pessoas e pessoa × máquina, com caixa e dono de turno registrados antes/depois de cada confirmação.
4. Conectar espectador independente; observar movimentos/saldos e confirmar que entrar/sair não altera jogadores nem turno. Repetir reconexão e final da partida.
5. Exercitar Sorte e Revés positivos, negativos e condicionais; insuficiência de saldo; clique antecipado; confirmação única; movimento reduzido; fallback sem WebGL.
6. Reproduzir o relato de carta pendente com espera prolongada, cronômetro expirando e nova rolagem; verificar exatamente onde ocorre avanço e aplicação de efeito.
7. Conferir 1920×1080, 844×390 e 394×858, além de áudio, teclado, rolagem e orientação do monte na transição. Chrome, Firefox e Safari/iOS continuam sem aprovação visual nesta versão.

## Entrega desta auditoria

Foram adicionados este relatório e o diagnóstico reproduzível `modal-response-probe.mjs`. Código do produto, preferências, credenciais, flags e regras não foram alterados. Nenhum commit, push ou deploy realizado.

As skills de verificação e diagnóstico orientaram a separação entre evidência automatizada, reprodução isolada e pontos não observados. A impossibilidade de validação visual decorre da falha da ferramenta de navegador; não de um resultado funcional do jogo.
