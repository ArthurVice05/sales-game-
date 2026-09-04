# Regras permanentes deste repositório

## Proibido alterar (qualquer tarefa)
- `src/game/useTurnEngine.jsx`, `src/game/engine/**`, `src/engine/**`
- regras econômicas, valores, dado, movimento, turnos, rodadas, vitória, falência
- `src/data/board40Preview.js` (índices, números, tipos, labels, ícones, ordem)
- `src/data/track.js`, `src/data/boardVersions.js`, versionamento `v1-55` / `v2-40`
- Supabase, `src/net/**`, `src/game/useGameSync.js`, BroadcastChannel, locks, reconexão
- conteúdo do baralho em `src/modals/SorteRevesModal.jsx`: array `CARDS`, `_compute`,
  `cashDelta`, `clientsDelta`, `certDelta`, sorteio da carta e formato do `onResolve`
- `.env.local` e qualquer credencial

## Proibido fazer
- `git commit`, `git push`, deploy, `git checkout`/`reset` que descarte trabalho
- versionar `dist/` (após qualquer `npm run build`, rodar `git restore -- dist`)
- adicionar dependências novas (nem de responsividade, nem de teste, nem Playwright)
- usar `transform: scale()` para layout (permitido só em animação de token/dado/carta)
- refatoração ampla ou renomeação de arquivos fora do escopo do prompt atual
- declarar concluído sem `npm run test:check` verde e `npm run build` verde

## Obrigatório
- TDD: teste que falha primeiro, depois a implementação
- alterações cirúrgicas, mínimas, no módulo pedido — não reescrever arquivos inteiros
- fonte única de verdade das variáveis: `--board-ratio`, `--board-width`,
  `--sidebar-min`, `--layout-gap`, `--game-header-height`
- ao terminar: listar arquivos tocados, o que foi provado por teste e o que não foi
