# SalesGame Local Hot-Seat Design

## Goal

Add an explicit local pass-and-play mode for two to four players while preserving the existing turn engine, economy, v2-40 board, modal pipeline, round rules, and online multiplayer behavior.

## Invariants

- `turnPlayerId` remains the authoritative turn identity, `turnIdx` remains derived, and `turnSeq` remains monotonic.
- `myUid` remains the online/device identity and is never reassigned on local turn changes.
- Local mode does not create a second turn engine or advance turns by array index.
- A player's authority is retained until the engine commits a different `turnPlayerId`/`turnSeq`.
- Active gameplay modals are never closed to trigger a handoff. The engine must finish its normal pipeline first.
- The runtime board remains `v2-40`; legacy `v1-55` compatibility is untouched.

## Explicit mode and gameplay actor

`gameMode` has the values `null`, `online`, or `local`. `gameplayActorId` is derived as follows:

- online: the physical/canonical `myUid`;
- local and confirmed: the authoritative `turnPlayerId`;
- local during handoff: `null`.

Only gameplay authorization points use `gameplayActorId`: turn checks, HUD ownership, cash/totals, controls, the turn engine actor, dice guards, gameplay lock ownership, recovery, and bankruptcy. Supabase, lobby identity, presence, host election, reconnect, match identity, network metadata, and online leave operations continue to use `myUid`.

## Local setup and initialization

`LocalGameSetup` accepts two to four unique non-empty player names and reuses the official round and timer presets. `createLocalPlayers` assigns UUID v4 IDs, deterministic `seat` and `joinOrder`, the existing four-color palette, and the same starter kit used by online initialization.

Starting a local match clears room and lobby identifiers, keeps `GameNetProvider` structurally mounted but disabled, initializes the normal match state with round 1, turn index 0, first player ID, turn sequence 0, correctly sized round flags, cleared locks/roll/overlays, configured rounds and timer, and board version `v2-40`. The initial deadline is null until the first player confirms the handoff.

## Handoff state machine

The local turn key is `${turnPlayerId}:${turnSeq}`. StrictMode-safe acknowledged-key state records which authoritative turn was confirmed. The initial key and every new committed key make `localTurnReady=false`; only then does `gameplayActorId` become null.

The handoff is a full-viewport opaque dialog rendered above the game. It prevents pointer and keyboard access to the underlying interface, focuses the confirmation button, contains no private statistics, and waits for any residual presentation-only dice overlay to finish before becoming confirmable. It never closes gameplay modals or mutates the turn pipeline.

On confirmation, the component revalidates the current turn key, creates a fresh deadline with `computeTurnDeadlineAt(Date.now(), turnTimeSec)`, updates the deadline state/ref, and sets `localTurnReady=true`. `gameOver` suppresses handoff and displays the existing final result.

## Timer and auto-pass

Local TURN commits leave the next deadline null. While `localTurnReady=false`, the existing timer auto-pass hook is disabled. Confirmation grants the full configured time. Once ready, the existing `useTurnTimerAutoPass` and `planOfflineTurnSkip` behavior applies unchanged, including skipping bankrupt players and producing one authoritative next turn. The resulting turn key opens the next handoff.

## Network isolation

Local mode keeps `roomCode=null`, `currentLobbyId=null`, and `net.enabled=false`. Supabase, lobby, presence, reconnect, host, and remote commit effects receive explicit local-mode guards where existing null guards are insufficient. No `BroadcastChannel` is created in local mode, so `sg-sync:local` is never used. Online behavior retains the existing provider, channels, state commits, identity, and leave flow.

## Components and exits

- `StartScreen` offers online play and play-on-this-device entry points.
- `LocalGameSetup` owns local roster/config form state.
- `LocalTurnHandoff` owns only privacy/accessibility presentation and confirmation.
- Local exit resets local match UI and returns to start without forfeit, Supabase, or lobby operations.
- `FinalWinners` remains the result screen with a configurable local exit label.

## Testing

Pure tests cover player creation, validation, actor resolution, turn keys, handoff transitions, timer gating/deadline refresh, final suppression, and network/channel policy. Integration/source-wiring tests cover engine actor usage, HUD/control identity, committed-turn-only handoff, local exit isolation, and unchanged online paths. The complete existing suite and production build must remain green, followed by browser validation of two- and four-player flows and representative modal/timer/endgame paths.
