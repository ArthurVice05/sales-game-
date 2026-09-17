# Recuperação do botão de rolar dado

Correção de 17/09/2026 para os bloqueios reproduzidos no código. A causa do episódio informado entre 9h45 e 9h54 não foi confirmada: o projeto do jogo não estava disponível na conta Vercel conectada.

## Comportamento

- Botão e processamento consultam a mesma permissão. Confirmação, animação, decisão aberta e turno já jogado impedem uma segunda rolagem.
- A confirmação mostra “Confirmando jogada…”. Cada tentativa aguarda até 8 segundos; uma falha transitória recebe uma segunda tentativa automática.
- Se ambas falharem, aparece “Tentar novamente”. A tentativa conserva a identidade e o valor original do dado.
- Antes de prosseguir, o cliente consulta o estado autoritativo. Uma confirmação cuja resposta se perdeu é recuperada pelo recibo existente, sem aplicar outra jogada.
- Requisições canceladas e respostas de turno, partida ou sala anteriores não iniciam movimento. Um estado remoto rejeitado é sincronizado de volta à interface.
- O motor informa explicitamente quando recusa o início. Uma decisão aberta durante a confirmação permite retomar a mesma tentativa depois de fechada.

## Monitoração

Eventos enviados pelo transporte existente para `/api/client-logs`:

| Evento | Significado |
| --- | --- |
| `ROLL_CONFIRMATION_RETRY` | Falha transitória ou tempo de confirmação excedido; nova tentativa automática. |
| `ROLL_CONFIRMATION_FAILED` | Confirmação não concluída ou rejeitada; inclui o motivo. |
| `ROLL_BLOCKED` | Ação recusada por estado do turno, modal ou operação em andamento. |
| `ROLL_CONFIRMED` | Reserva da jogada confirmada no servidor; não significa partida ou movimento finalizado. |

Os eventos incluem sala, partida, jogador, turno, motivo e identidade da tentativa quando disponíveis. O UUID da sala é preservado por inteiro. Falhas transitórias no envio dos logs recolocam os eventos na fila limitada de memória para a próxima tentativa, enquanto a página permanecer aberta.

## Validação

Testes foram escritos e executados com falha antes da implementação. Os testes de integração montam Root, App, controles, motor e provider reais; DOM, WebGL e transporte Supabase são simulados.

Cobertura específica: confirmação lenta, cliques repetidos, resposta perdida após gravação, perda completa de conexão e retomada, conservação do dado, resposta tardia, troca de turno, estado remoto não recebido, modal aberta durante confirmação e transporte dos logs.

A suíte completa passou: 1.268 testes, zero falhas. `npm run test:check` e o build também passaram. O build mantém os avisos existentes de tamanho de chunks e importação dinâmica inefetiva de orientação de tela. Ele usa `.tmp/roll-fix-build` para preservar o `dist` que já estava alterado. Saídas em `.tmp/roll-fix-tests.txt` e `.tmp/roll-fix-build.txt`.

No navegador, foi conferida uma partida local com dois jogadores, incluindo rolagem, decisão e passagem de turno em 1280×720 e 844×390. Nenhum erro de console foi observado nesse fluxo.

Não foi executado teste de carga, nem validada a correção em produção ou em aparelhos físicos. O multiplayer foi validado com transporte simulado, incluindo falhas injetadas. Uma indisponibilidade persistente do servidor ou da internet continua impedindo a confirmação; a interface agora informa a situação e permite retomar sem duplicação. Não há alteração de schema, migração SQL ou nova autenticação. Publicação não realizada nesta tarefa.

## Arquivos alterados ou criados

| Arquivo | Alteração |
| --- | --- |
| `src/App.jsx` | Permissão compartilhada, mensagens, ciclo de confirmação/retomada e eventos. |
| `src/components/Controls.jsx` | Estado e rótulo do botão derivados da permissão do App; acessibilidade de operação em andamento. |
| `src/game/rollStartRecovery.js` | Tentativas limitadas e cancelamento. |
| `src/game/useTurnEngine.jsx` | Retorno explícito do resultado de início de ROLL. |
| `src/net/GameNetProvider.jsx` | Cancelamento de requisições e hidratação da leitura autoritativa ao rejeitar o commit. |
| `src/game/logCapture.js` | Captura dos bloqueios de dado. |
| `src/game/vercelLogTransport.js` | Classificação, contexto e reenvio dos eventos. |
| `api/client-logs.js` | Preservação do identificador completo da sala. |
| `src/game/__tests__/rollStartRecovery.test.mjs` | Testes de espera limitada, cancelamento e rejeição. |
| `src/game/__tests__/rollButtonAppIntegration.test.mjs` | Regressões de interface e rede no App real. |
| `src/game/__tests__/vercelClientLogs.test.mjs` | Testes do contexto e reenvio dos logs. |
| `src/game/__tests__/helpers/fakeSupabase.mjs` | Simulação de cancelamento e resposta perdida após gravação. |
| `docs/roll-button-recovery.md` | Registro dos ajustes, evidências e limites. |

Referências consultadas: [Supabase abortSignal](https://supabase.com/docs/reference/javascript/using-modifiers-abortsignal), [Vercel Runtime Logs](https://vercel.com/docs/logs/runtime).
