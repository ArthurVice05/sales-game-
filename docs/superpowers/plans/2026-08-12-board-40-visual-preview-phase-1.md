# Board de 40 Casas — Prévia Visual (Fase 1) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use `superpowers:executing-plans` inline para implementar este plano tarefa por tarefa. Subagentes, worktrees e commits são proibidos nesta fase.

**Goal:** Criar uma página de desenvolvimento isolada com o tabuleiro aprovado como base e 40 casas React/CSS interativas, sem integrar o percurso ao motor ativo de 55 posições.

**Architecture:** Uma configuração pura e profundamente congelada fornece número, tipo, rótulo e coordenadas da grade 13 × 9. `LandscapeBoardPreview` mantém apenas o estado de seleção e compõe 40 instâncias de `BoardTile` sobre a imagem copiada sem reprocessamento; todo o CSS usa o namespace `sg40Preview`.

**Tech Stack:** React 18, Vite 5, CSS Grid, `node:test`, `node:assert/strict`.

## Global Constraints

- Criar somente arquivos da allowlist da Fase 1; nenhum arquivo existente pode ser modificado.
- Manter `TRACK_LEN = 55` e não importar `board40Preview.js` no motor ou na entrada normal.
- Não instalar nem atualizar pacotes além da restauração já autorizada do lockfile com `npm ci`.
- Não executar commit, push, pull request, publicação ou deploy.
- Usar a imagem fornecida de 1448 × 1086 sem recorte, redimensionamento ou recompressão.
- Omitir detalhes monetários das casas quando não houver uma fonte pública única e inequívoca.

---

### Task 1: Mapa puro das 40 casas

**Files:**
- Create: `src/data/__tests__/board40Preview.test.mjs`
- Create: `src/data/board40Preview.js`

**Interfaces:**
- Produces: `BOARD_40_TYPES`, `getBoard40GridPosition(number)` e `BOARD_40_PREVIEW`.
- Contract: 40 objetos congelados com `{ number, type, label, row, column }` e tipos limitados a `START_REVENUE`, `CLIENTS`, `ERP`, `INSIDE`, `MANAGER`, `TRAINING`, `FIELD`, `DIRECT_BUY`, `COMMON`, `EXPENSES`, `MIX`, `LUCK`.

- [ ] Criar testes nativos que validem quantidade, sequência 1–40, unicidade, perímetro, transições, adjacência, tipos canônicos, casas `LUCK` e imutabilidade.
- [ ] Executar `node --test src/data/__tests__/board40Preview.test.mjs` e registrar a falha por módulo ausente.
- [ ] Implementar o mapeamento determinístico e a distribuição visual aprovada, congelando array, objetos e conjunto exportado.
- [ ] Reexecutar o teste e registrar todos os casos como aprovados.

### Task 2: Prévia React/CSS isolada

**Files:**
- Create: `public/board-landscape-40.png`
- Create: `src/components/board/BoardTile.jsx`
- Create: `src/components/board/LandscapeBoardPreview.jsx`
- Create: `src/components/board/landscape-board-preview.css`
- Create: `src/board-preview.jsx`
- Create: `board-preview.html`

**Interfaces:**
- Consumes: `BOARD_40_PREVIEW` e `getBoard40GridPosition` apenas na entrada de preview.
- Produces: `/board-preview.html`, com seleção local, foco de teclado e até quatro jogadores fictícios em posições válidas de 0 a 39.

- [ ] Copiar a imagem fornecida byte a byte e comparar SHA-256 entre origem e destino.
- [ ] Implementar `BoardTile` como único componente visual das casas, usando `<button type="button">`, rótulo acessível, estados selecionado/ocupado/jogador atual e área de tokens.
- [ ] Compor a grade absoluta 13 × 9 com posições vindas apenas de `gridRow` e `gridColumn`, faixa de prévia e painel da casa selecionada.
- [ ] Criar CSS totalmente escopado, aspecto 4:3, casas opacas e iguais, sem gaps, margens externas, escala individual ou reposicionamento mobile.
- [ ] Criar a entrada com `createRoot` e HTML raiz sem modificar Vite ou a aplicação normal.

### Task 3: Verificação e evidências

**Files:**
- Create: `artifacts/board-preview/desktop-1440x1080.png`
- Create: `artifacts/board-preview/tablet-1024x768.png`
- Create: `artifacts/board-preview/mobile.png`

- [ ] Revisar os componentes com a checklist de boas práticas React e acessibilidade.
- [ ] Executar o teste nativo e `npm run build`, registrando saídas e códigos de retorno.
- [ ] Abrir `/board-preview.html`, verificar console, DOM, teclado, seleção, tokens e requisições.
- [ ] Medir `getBoundingClientRect()` das 40 casas e registrar mínimos, máximos e diferenças.
- [ ] Gerar os três screenshots somente pela automação de navegador disponível, sem instalar ferramenta adicional.
- [ ] Executar `sha256sum --check /tmp/salesgame-board-phase1-protected-before.sha256` e comparar `git diff --name-only`/`git status --short` com a allowlist e o baseline inicial.

