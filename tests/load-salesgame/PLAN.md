# Laboratório concorrente — plano e estado inicial

Pedido: criar um laboratório externo que joga pela interface real, sem modificar gameplay. Execução local nesta sessão, sem commit, push ou deploy.

Estado registrado em 09/09/2026:
- HEAD e origin/main após `git fetch origin main`: `154da4ca5d729abc74466134d2d20a567bfbef5e`.
- Branch `main`; `git status --short` vazio; diff inicial vazio.
- Os arquivos do placar Three.js já pertencem à main recebida. Não serão editados.
- Nenhum AGENTS.md encontrado na árvore do repositório.

## Implementação

1. Configuração validada antes do navegador: destino explícito, Supabase de teste explicitamente confirmado, 4 pessoas/sala, runId, limites e shards por sala inteira. Dependências exclusivamente nesta pasta.
2. Observação somente leitura: DOM, identidade gerada pelo produto e snapshots recebidos pelo transporte existente. Nunca importar o motor na página, criar assentos por API ou escrever storage.
3. Driver de UI com modais reconhecidos e transições aguardadas; cenário de 4 contextos independentes; evidência de identidades, início, convergência, efeitos e encerramento.
4. Orquestração concorrente com rampa, janela comum, drenagem e reciclagem; métricas de sessões realmente em jogo e recursos do gerador. Consolidação que rejeita shards ausentes, lacunas e meta não alcançada.
5. JSON, CSV, Markdown, screenshots/traces sanitizados de falhas; smoke obrigatório antes de ampliar; resiliência/duplo clique separados da carga normal.
6. Testes dos guardas e das métricas; executar smoke apenas com homologação autorizada. Falta de ambiente é bloqueio registrado, nunca aprovação de capacidade.

## Contratos confirmados no código

- Entrada: nome na tela inicial → Salas de jogo → Criar sala / Entrar → Ficar pronto → Iniciar partida.
- `PlayersLobby.jsx` é o fluxo montado por App. `RoomLobby.jsx` é legado e não deve orientar os seletores.
- Identidade: `sg_tab_player_id` em sessionStorage; `sg:matchIdentity:<roomCode>` em localStorage, criada pelo produto.
- Tabelas `lobbies`, `lobby_players`, `matches` e `rooms`; código da room é UUID do lobby.
- GameNetProvider observa `postgres_changes` e usa polling de segurança. `version`, `stateId`, `actionId`, `turnSeq`, `players.lastActions` existem; não criar versão de teste no protocolo.
- Rodadas configuráveis pela UI: 1–5; tempo por jogada: 60/90/120/180 segundos.
- O produto executa limpeza global de lobbies antigos ao abrir a lista. Exigir Supabase exclusivo de teste e abortar escritas fora dos recursos registrados do run; não permitir que esse comportamento alcance salas de terceiros.

## Pendência de ambiente

URL de homologação e confirmação do Supabase de teste solicitadas ao usuário. Nenhuma carga online autorizada por inferência a partir de `.env` ou do servidor local anterior.
