# Laboratório concorrente Sales Game

Laboratório externo em JavaScript/Playwright. Cada jogador tem um BrowserContext independente e opera a interface real. O perfil de 100 jogadores usa **25 salas × 4 pessoas**, com no máximo um dono de turno por sala. Não usa IA do produto nem modifica RNG, motor, modais, economia, Supabase/RLS ou Three.js.

**Estado da entrega:** implementação e testes locais do laboratório disponíveis. Smoke online bloqueado por falta de URL autorizada e confirmação do backend exclusivo de teste. Nenhum resultado de capacidade foi obtido. Consulte `DELIVERY.md`.

## Instalação isolada

Node 22+ e Chrome instalado. Na raiz do repositório:

```powershell
npm ci --prefix tests/load-salesgame
npm --prefix tests/load-salesgame test
```

As dependências Playwright/fflate ficam somente aqui. `fflate` sanitiza os ZIPs de trace. Nenhuma dependência entra no bundle do jogo. Se Chrome não estiver instalado, use o Chromium do Playwright:

```powershell
cd tests/load-salesgame
npx playwright install chromium
$env:SG_LAB_CHANNEL = ''
```

Ou configure `SG_LAB_EXECUTABLE_PATH` para um navegador compatível. Não há k6.

## Pré-requisitos obrigatórios

1. Homologação acessível e conectada a um **Supabase exclusivo de teste**, sem salas de terceiros. Não basta servir o frontend em localhost se `.env` aponta para produção.
2. Informe URL e origem do Supabase explicitamente. O laboratório não lê `.env` do produto nem usa service_role. Chaves anônimas/publishable vêm do próprio frontend.
3. Tenha autorização para criar salas sintéticas e executar a carga no destino escolhido. `exclusive-test` é uma declaração do operador, não uma descoberta automática do ambiente.
4. Não altere flags de IA: os scripts exigem zero máquinas no lobby/snapshot.
5. Use um runId novo em cada execução. Diretórios de resultados existentes não devem ser reutilizados.

```powershell
$env:SG_LAB_URL = 'https://SUA-HOMOLOGACAO/'
$env:SG_LAB_SUPABASE_ORIGIN = 'https://SEU-SUPABASE-DE-TESTE'
$env:SG_LAB_TEST_BACKEND = 'exclusive-test'
$env:SG_LAB_OUTPUT = "$PWD/tests/load-salesgame/results"
```

`config.example.json` lista exemplos sem segredos; não é carregado automaticamente. Não use seus endereços fictícios como destino. Nenhum destino é padrão.

O produto possui limpeza global automática ao abrir a lista de salas. O laboratório bloqueia escritas sem filtro para recursos conhecidos do run, incluindo uma eventual limpeza global. Se esse bloqueio disparar, a execução é reprovada e diagnosticada; não há resposta de sucesso simulada. Use backend dedicado/limpo para evitar essa interferência. A lista global é lida pelo produto; não se deve usar este laboratório em backend compartilhado com terceiros.

## Comandos exatos e sequência

Primeiro, smoke (uma partida completa, 1 sala / 4 contextos, uma rodada do tabuleiro):

```powershell
npm --prefix tests/load-salesgame run smoke -- --run-id=smoke-20260909-a
```

Só continue se `results/smoke-20260909-a/shard-0/results.json` tiver `status: PASS` e `criteria.pass: true`. Um smoke interrompido, com efeito sem correlação, modal desconhecido ou sem encerramento não libera carga.

```powershell
$env:SG_LAB_SMOKE_PROOF = "$PWD/tests/load-salesgame/results/smoke-20260909-a/shard-0/results.json"
npm --prefix tests/load-salesgame run load:20 -- --run-id=load20-20260909-a
npm --prefix tests/load-salesgame run load:100 -- --run-id=load100-20260909-a
```

Os comandos verificam o comprovante do smoke para o mesmo destino. **Um JSON editado não é um comprovante confiável**; preserve os resultados originais e controle sua procedência.

Plano de configuração, sem abrir navegadores ou criar salas:

```powershell
npm --prefix tests/load-salesgame run plan -- --rooms=25 --run-id=plan-20260909-a
```

Resiliência e confirmação rápida são **execuções separadas**, depois da carga normal:

```powershell
npm --prefix tests/load-salesgame run run -- --rooms=1 --profile=resilience --run-id=resilience-20260909-a
npm --prefix tests/load-salesgame run run -- --rooms=1 --profile=rapid-confirm --run-id=rapid-20260909-a
```

Resiliência: após quatro ações, recarrega B, desconecta C por 5 segundos, reconecta C e recarrega o host. Preserva o mesmo contexto/identidade. Erros de rede durante a injeção ficam identificados; falha de recuperação continua sendo reprovação. Não confundir esse perfil com a janela funcional normal.

Perfil adicional com espectadores:

```powershell
npm --prefix tests/load-salesgame run load:100 -- --run-id=viewers-20260909-a --spectators-per-room=1
```

São 100 jogadores **mais** 25 espectadores. Espectadores não entram na contagem `active`.

## Configuração

Todo argumento usa `--nome=valor`; equivalente por ambiente `SG_LAB_NOME` em maiúsculas, com `_` no lugar de `-`. CLI prevalece sobre ambiente.

| Opção | Padrão / contrato |
|---|---|
| `url`, `supabase-origin`, `test-backend` | obrigatórios; sem destino padrão |
| `rooms`, `players-per-room` | 1–25; exatamente 4 |
| `run-id`, `seed` | ID novo; seed afeta somente compras/recusas dos scripts |
| `entry-interval-ms`, `reaction-ms` | 500 / 600 |
| `ramp-ms`, `window-ms` | 120000 / 900000 no perfil funcional; zero no smoke |
| `idle-ms`, `action-timeout-ms` | 120000 / 45000 |
| `drain-ms`, `total-ms` | 300000; total derivado cobre rampa+janela+drenagem+180000 |
| `rounds`, `turn-seconds` | 5 rodadas (smoke 1); 180 segundos; apenas controles reais 60/90/120/180 |
| `sample-ms`, `poll-ms` | 1000 / 250 |
| `shards`, `shard-index` | 1 / 0; índices zero-based, salas inteiras |
| `start-at`, `coordinator-url` | obrigatórios em distribuição; mesma data ISO UTC e coordenador privado |
| `max-clock-skew-ms` | 250; incerteza/drift acima disto reprova |
| `headless`, `channel`, `executable-path` | true / chrome / vazio |
| `profile` | functional; alternativas smoke, reduced-motion, resilience, rapid-confirm |
| `max-action-ms`, `max-sync-ms`, `max-reconnect-ms` | metas propostas p95: 45000 / 10000 / 30000 |
| `max-error-rate` | percentual de erros espontâneos por ação; padrão 0 |
| `trace-sample-rooms` | 1 sala com trace completo; demais só trace de chamadas/rede + screenshot se falhar |
| `spectators-per-room`, `offline-ms` | 0 / 5000 |
| `output`, `smoke-proof` | diretório de artefatos / comprovante necessário para ampliar |

O perfil funcional mantém WebGL, animações e pixel ratio normais do navegador. `reduced-motion` é separado no relatório e não comprova a capacidade do perfil funcional.

## Concorrência, rampa e drenagem

A rampa de 25 salas inicia grupos acumulados de 1, 5, 10, 15, 20 e 25 salas: 4, 20, 40, 60, 80 e 100 participantes. Dentro de cada sala, A cria e B/C/D entram pela UI, todos verificam os quatro nomes, ficam prontos e A inicia. A seed não é instalada no navegador nem intercepta Math.random.

As salas executam concorrentemente com uma máquina de estados por participante. Não há lote de 100 cliques de dado. Após o término, os mesmos contextos podem criar uma **nova sala**, identificada por geração. Lobby e partida encerrada nunca contam como jogador em partida iniciada.

A janela começa em `start-at + ramp-ms`. Se o gerador atrasar, faltar jogador, uma sala falhar ou a reciclagem abrir uma lacuna abaixo da meta, o critério de janela contínua falha. Não deslocamos a janela depois para esconder a rampa lenta. Após a janela, novas salas deixam de ser criadas; partidas já iniciadas drenam até `drain-ms`. Ao atingir o limite, os contextos fecham e a execução reprova com diagnóstico.

`concurrency.csv` registra sessões com transporte observado, participantes em jogo com DOM recente, salas, aguardando turno, espectadores, ações, partidas concluídas, falhas e desconexões. A comprovação tem resolução `sample-ms`; lacunas maiores que 1,75 intervalo reprovam. Atraso do coletor não é tratado como sucesso. Cem abas abertas ou um pico de 100 não aprovam uma janela de 15 minutos.

## Distribuição

Divisão por `roomIndex % shards`. Com cinco executores, cada um recebe cinco salas e 20 contextos. Nomes incluem runId, índice global da sala, assento e geração; não colidem entre executores.

Em uma rede privada protegida, inicie o coordenador (não é endpoint de gameplay):

```powershell
$env:SG_LAB_COORDINATOR_HOST = '0.0.0.0'
node tests/load-salesgame/coordinator.mjs
```

Em cada executor, configure os mesmos destinos, runId, seed e start-at futuro. Copie o comprovante do smoke aprovado. Use índices diferentes (0 a 4):

```powershell
npm --prefix tests/load-salesgame run load:100 -- --run-id=dist-20260909-a --shards=5 --shard-index=0 --start-at=2026-09-10T15:00:00Z --coordinator-url=http://COORDENADOR-PRIVADO:9360
```

Repita a mesma linha nos demais executores, substituindo somente `--shard-index=1`, `2`, `3` e `4`. **Ajuste a data para o futuro.** O coordenador rejeita índice repetido/configuração diferente, mede offset por cinco trocas e exige todos prontos antes do horário. Não contém chaves ou acesso ao Supabase. Não o exponha à Internet.

Copie os cinco JSONs para uma máquina e consolide:

```powershell
node tests/load-salesgame/consolidate.mjs shard-0/results.json shard-1/results.json shard-2/results.json shard-3/results.json shard-4/results.json --output=tests/load-salesgame/results/consolidated
```

Faltou shard, faltou amostra, houve colisão ou não houve sobreposição: FAIL. O consolidador não soma picos independentes. Latências são medidas entre páginas do mesmo executor com `performance.now()`, nunca por subtração entre máquinas. A série temporal usa relógio corrigido e explicita incerteza.

## Correção e cobertura

- IDs lidos **somente** da identidade específica da sala criada pelo produto; não se exportam outros itens de storage. Quatro IDs distintos, nomes esperados e assentos do snapshot distintos.
- UI autoriza rolagem e identifica o dono pelo peão ativo. Snapshot passivo confirma `turnPlayerId`. Nenhum clique forçado em controle desabilitado.
- Modais reconhecidos por título/casca real; sem “OK global”. Compras de quantidade usam 1 unidade, leem preço e saldo, ou recusam. Mix/ERP/Treinamento são reconhecidos e recusados neste cenário normal; não há alegação de cobertura de compra dessas modalidades.
- Empréstimo usa o limite exibido; sem garantia disponível retorna e escolhe falência pelo fluxo real. Declaração não modifica saldo/estado pela console.
- Sorte & Revés aguarda revelação normal e cruza título com o baralho atual. Reutiliza o resolver puro **no processo de teste**, sem invocar o motor na página. Testes independentes conferem efeitos fixos e condicionais conhecidos.
- Deltas conferem jogador dono e ausência de alteração nos demais campos verificados; preço/quantidade e valor exibido de receita/despesa são expectativas independentes da resposta HTTP. Mudanças simultâneas fora desses campos não são uma prova de correção completa de toda a economia.
- Correlação registra `version`, `stateId`, `actionId` e novos `lastActions` já existentes. Falta de correlação inequívoca é `unprovenEffects` e impede PASS. Um saldo final igual não prova aplicação única de todas as operações intermediárias.
- Convergência exige snapshots **e DOM** de rodada, posição e ranking. Ao final, as quatro sessões precisam mostrar os quatro jogadores na ordem do ranking existente.
- Estados/transições não suportados geram falha e screenshot. Não se altera gameplay para passar.

## Métricas e evidências

`results/<runId>/shard-N/`: `results.json`, `report.md`, `concurrency.csv`, `latency.csv`, `evidence/`.

| Latência | Definição |
|---|---|
| room-create / room-join | início do fluxo na página inicial até identidade e lobby observados |
| match-start | criação até as quatro UIs em jogo e convergentes; inclui entrada/prontidão |
| script-reaction | pausa real do script antes do clique; excluída de action-visible |
| action-visible | início do clique até mudança de posição, dados ou modal e fim do movimento observado |
| action-all-visible | início do clique até convergência dos quatro DOMs/snapshots |
| sync-after-local-visible | conclusão local até convergência dos quatro participantes |
| observed-animation | intervalo em que overlay do dado/movimento foi observado; resolução de polling, não duração exata do renderer |
| reconnect | intervenção até retomada e convergência; exclui desconexão intencional configurada |

p50/p95/p99 usam nearest-rank e informam `n`. Esperar revelação da carta antecede o clique de OK; não se mistura essa espera com atraso de sincronização. A latência do clique do dado inclui animação intencional, registrada também separadamente. Não subtrair médias de grupos distintos para alegar latência “pura”.

CPU do Node, RSS, memória usada/total do host e atraso do event loop são medidos por executor. O uso global do host inclui navegador **e outros programas**; execute em máquinas dedicadas para atribuição. Lentidão com gerador saturado exige investigação, não confirmação de defeito do Supabase.

Traces completos são amostrados. Falhas fora da amostra guardam trace de chamadas/rede e screenshot final, sem vídeo contínuo. Headers secretos e corpos de rede são removidos dos ZIPs; fontes e storageState não são exportados. Traces perdem recursos de corpo/CSS em favor da sanitização. Não publique diretórios de perfil do navegador, comprovantes adulterados ou traces brutos. Revise screenshots antes de compartilhar.

## Aprovação e limites

PASS exige janela configurada, todas as salas previstas realmente jogando/concluídas, sem falhas, sem efeito não comprovado, sem partida abandonada e dentro das metas propostas. Uma sessão interrompida não aprova. O resultado de 20 não aprova 100. Cada shard sozinho não aprova 100.

Esse laboratório ainda precisa do primeiro smoke online no ambiente autorizado para confirmar todos os seletores e os formatos de eventos na implantação real. Testes unitários, compilação e preflight não substituem esse smoke. A cobertura aleatória é reportada pelo conjunto de cartas/modais efetivamente vistos; não há manipulação do RNG para forçar casos.

## Limpeza restrita

O JSON lista `resources.lobbies`, `resources.rooms`, nomes `SG-<runId>-rNN-gNNN` e identidades. Ao concluir normalmente, os quatro jogadores usam a saída existente. O produto pode remover salas vazias pelo próprio fluxo.

Após falha, preserve primeiro evidências. Um administrador do **backend de teste** deve cruzar nome/runId e IDs registrados antes de remover somente: `lobby_players.lobby_id` nesses IDs; `matches.lobby_id` nesses IDs; `rooms.code` nesses IDs; `lobbies.id` nesses IDs, respeitando FKs/políticas existentes. Não há script de DELETE global, service_role nos jogadores, nem relaxamento de RLS. Não remova salas apenas por prefixo parcial ou intervalo de data. Resíduos são reportados; o laboratório não faz limpeza ampla silenciosa.
