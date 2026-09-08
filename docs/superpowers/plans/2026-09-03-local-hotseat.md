# SalesGame Local Hot-Seat Implementation Plan

> **For agentic workers:** Execute inline in this session. Do not dispatch subagents and do not commit, push, or deploy.

**Goal:** Add a two-to-four-player local pass-and-play mode that uses the existing authoritative turn engine.

**Architecture:** Introduce explicit `gameMode`, derive a separate `gameplayActorId`, and gate local play behind a turn-keyed handoff. Keep online identity and networking on `myUid`; disable network/channel effects explicitly in local mode.

**Tech Stack:** React 18, Vite 5, Node test runner, Supabase client.

**Spec:** `docs/superpowers/specs/2026-09-03-local-hotseat-design.md`

## Global Constraints

- Preserve `turnPlayerId`, derived `turnIdx`, monotonic `turnSeq`, locks, modal pipeline, round logic, and v2-40.
- Never close active gameplay modals to trigger handoff.
- Never revoke A's local authority until a new authoritative turn key is committed.
- Keep `myUid` for online/device identity and use `gameplayActorId` only for gameplay authority.
- No new dependencies, commits, pushes, or deployments.

---

### Task 1: Pure hot-seat domain

**Files:**
- Create: `src/game/localHotseat.js`
- Create: `src/game/__tests__/localHotseat.test.mjs`

**Interfaces:**
- Produces: `GAME_MODE`, `LOCAL_PLAYER_COLORS`, `applyStarterKit`, `validateLocalPlayerNames`, `createLocalPlayers`, `resolveGameplayActorId`, `localTurnKey`, `shouldEnableTurnTimer`, `shouldCreateGameBroadcastChannel`, and handoff-state helpers.

- [ ] Write tests for 2/3/4 distinct UUID-backed players, seats/order, starter state, name validation, online/local actor resolution, stable keys, handoff readiness, timer enablement, game-over suppression, and channel policy.
- [ ] Run `node --test src/game/__tests__/localHotseat.test.mjs` and verify failure because the module does not exist.
- [ ] Implement the minimal pure helpers, reusing `createUuidV4`, round/time normalizers, and existing starter constants.
- [ ] Re-run the isolated tests and verify they pass.

### Task 2: Setup and handoff components

**Files:**
- Create: `src/components/LocalGameSetup.jsx`
- Create: `src/components/LocalTurnHandoff.jsx`
- Create: `src/components/__tests__/localTurnHandoff.test.mjs`
- Modify: `src/styles.css`

**Interfaces:**
- Consumes: official round/time constants and local validation helpers.
- Produces: `onStart({ names, maxRounds, turnTimeSec })`, `onBack()`, and `onConfirm(turnKey)` UI contracts.

- [ ] Add source/behavior tests for accessible dialog semantics, opaque portal layer, focus/inert handling, no private values, setup constraints, and official presets.
- [ ] Run isolated component tests and verify failure.
- [ ] Implement responsive setup and handoff components without touching board/dice/modal internals.
- [ ] Re-run isolated component tests and verify they pass.

### Task 3: Explicit mode and local initialization

**Files:**
- Modify: `src/App.jsx`
- Modify: `src/components/StartScreen.jsx`
- Test: `src/game/__tests__/localHotseatIntegration.test.mjs`

**Interfaces:**
- Consumes: `createLocalPlayers`, `resolveGameplayActorId`, and existing match initialization constants.
- Produces: explicit `gameMode`, `localSetup` phase, local state reset/start callbacks, and derived `gameplayActorId`.

- [ ] Add failing wiring tests for explicit mode selection, null room/lobby IDs, v2-40 initialization, turn key zero, round flags, shared starter kit, and unchanged online entry.
- [ ] Run the new integration test and verify failure.
- [ ] Add mode selection and local initialization with the smallest possible App diff.
- [ ] Re-run domain/integration tests and verify they pass.

### Task 4: Gameplay actor integration and handoff

**Files:**
- Modify: `src/App.jsx`
- Test: `src/game/__tests__/localHotseatIntegration.test.mjs`

**Interfaces:**
- Consumes: authoritative `turnPlayerId`/`turnSeq` and `gameplayActorId`.
- Produces: engine/controls/HUD/dice authorization and committed-key-only handoff.

- [ ] Add failing tests proving A remains authorized through modal resolution, B is blocked only after the B/N+1 commit, B confirmation revokes A, and game over suppresses handoff.
- [ ] Run the integration test and verify failure.
- [ ] Pass `gameplayActorId` only to gameplay sites while retaining physical `myUid` in online/network sites.
- [ ] Observe authoritative turn-key changes idempotently and render the handoff without closing modals.
- [ ] Re-run integration and existing modal/dice/turn-race tests.

### Task 5: Local deadline and auto-pass

**Files:**
- Modify: `src/App.jsx`
- Test: `src/game/__tests__/localHotseat.test.mjs`
- Test: `src/game/__tests__/localHotseatIntegration.test.mjs`

**Interfaces:**
- Consumes: `computeTurnDeadlineAt`, `localTurnReady`, and existing `useTurnTimerAutoPass`.
- Produces: null handoff deadline and full fresh deadline on confirmation.

- [ ] Add failing tests for suspended handoff time, full-time confirmation, active-turn auto-pass, one transition, and bankrupt-player skip.
- [ ] Run isolated tests and verify failure.
- [ ] Prevent local TURN commits/deadline sanitizers from starting the next clock and gate the existing timer hook while handoff is pending.
- [ ] Re-run timer, offline skip, early handoff, race, and local tests.

### Task 6: Network isolation and local exit

**Files:**
- Modify: `src/App.jsx`
- Modify: `src/components/FinalWinners.jsx`
- Test: `src/game/__tests__/localHotseatIntegration.test.mjs`

**Interfaces:**
- Consumes: `gameMode` and existing online leave/commit paths.
- Produces: no local channel, Supabase, presence, reconnect, forfeit, or leave calls; configurable result exit label.

- [ ] Add failing source-wiring tests for explicit network guards, no `sg-sync:local`, isolated local exit, and retained online operations.
- [ ] Run integration tests and verify failure.
- [ ] Guard local networking/channel effects, implement local reset, and preserve online branches verbatim where possible.
- [ ] Re-run forfeit, presence, player-state sync, final-winner, and local tests.

### Task 7: Full verification

**Files:**
- Modify only defects discovered within hot-seat scope.

- [ ] Run `npm test` and require zero failures.
- [ ] Run `npm run build` and require a successful Vite build.
- [ ] Restore generated tracked/untracked `dist` artifacts so the source diff stays scoped.
- [ ] Start `npm run dev` and browser-check local setup, initial handoff, A→B→C→A, privacy/accessibility, full timer after confirmation, auto-pass, modal completion, bankruptcy, round/endgame, and online two-instance entry/synchronization where available.
- [ ] Inspect `git diff --check`, `git diff --stat`, and `git status --short`; document any environment-limited manual scenario honestly.
