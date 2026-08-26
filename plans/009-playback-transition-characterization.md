# Plan 009: Characterize playback transitions and preserve failed queue entries

> **Executor instructions**: Execute each step and verification in order. Stop and report on any STOP condition. Update `plans/README.md` when complete.
>
> **Drift check (run first)**: `git diff --stat 9cfcd61..HEAD -- src/hooks/useAudioPlayer.tsx src/hooks/useAudioPlayer.test.ts src/hooks/useKeyboardShortcuts.ts src/services/audio-transport.ts src/services/playback-state.ts src/components/audio-sidebar/player.tsx src/App.d.ts vitest.config.ts plans/README.md`
> Compare changed files to the excerpts below before proceeding.

## Status

- **Priority**: P1
- **Effort**: M
- **Risk**: LOW
- **Depends on**: none
- **Category**: bug, tests
- **Planned at**: commit `9cfcd61`, 2026-08-26

## Why this matters

Queue progression removes the next entry before playback is known to have started, and the async `ended` listener does not handle rejection. A missing or unsupported track can therefore disappear, halt progression, and emit an unhandled promise rejection. Characterizing these semantics now creates the safety rail required for the larger restart-safe playback engine.

## Current state

- `src/hooks/useAudioPlayer.tsx:27-44` sets the current song/index before awaiting `audioElement.play()` and rethrows a rejection.
- `src/hooks/useAudioPlayer.tsx:55-65` calls `store.queue.shift()` before `playSong`; failure loses the queued item.
- `src/hooks/useAudioPlayer.tsx:81-117` creates one browser `Audio` object and registers the async `nextSong` directly for `ended`; the `error` listener only marks playback paused.
- `src/App.d.ts` stores `Song[]` queue/playlist plus the live `HTMLAudioElement` in a deep Qwik store.
- Vitest discovers `src/**/*.test.ts`; current tests cover only pure Files/Songs utilities. Match their table-driven Vitest style and explicit `Song` fixture construction.
- Preserve current next/previous wraparound and the ten-second previous-track threshold unless tests demonstrate an existing contradiction.

## Commands you will need

| Purpose        | Command                                                                                                             | Expected on success |
| -------------- | ------------------------------------------------------------------------------------------------------------------- | ------------------- |
| Focused tests  | `npm test -- src/services/playback-state.test.ts`                                                                   | all new cases pass  |
| Frontend gates | `npm run lint && npm run build.types && npm test && npm run build`                                                  | all pass            |
| Rust gates     | `cd src-tauri && cargo fmt -- --check && cargo test --locked && cargo clippy --locked --all-targets -- -D warnings` | all pass            |

## Scope

**In scope**:

- `src/hooks/useAudioPlayer.tsx`
- `src/services/audio-transport.ts` (create)
- `src/services/playback-state.ts` and `.test.ts` (create)
- `src/hooks/useAudioPlayer.test.ts` (create; deterministic fake-transport integration suite)
- `src/hooks/useKeyboardShortcuts.ts` and test only for playback command characterization
- `src/App.d.ts`
- `src/components/audio-sidebar/player.tsx`
- `vitest.config.ts` only if required for the chosen test environment
- `plans/README.md`

**Out of scope**:

- Native audio output, gapless decoding, persisted queues, Media Session, device selection, shuffle/repeat redesign
- New UI layout or animation
- Changing queue entries from songs to durable entry IDs; that belongs to plans 003/004
- Skipping failed tracks automatically without an explicitly tested policy

## Git workflow

- Branch `codex/009-playback-transition-characterization` from current `master`.
- Commit the pure adapter/state tests separately from the production bug fix when practical.

## Steps

### Step 1: Extract pure transition decisions

Create a small pure module that computes next/previous candidates and queue-consumption decisions from explicit inputs. It must not import Qwik, Tauri, or browser globals. Characterize empty playlist, queue precedence, duplicate songs, first/last wraparound, stale index bounds, and previous after/before ten seconds.

**Verify**: `npm test -- src/services/playback-state.test.ts` → all table-driven transition cases pass.

### Step 2: Wrap the browser audio transport

Add the narrow `AudioTransport` interface needed by the hook: load source/ID, play, pause, current time/duration, event subscription, and cleanup. Production adapts one `HTMLAudioElement`; tests use a deterministic fake. Do not introduce a general event bus or move playback to Rust.

**Verify**: `npm run build.types && npm test` → types pass and adapter tests do not require a real WebView.

### Step 3: Commit the queue entry only after successful playback

Add `player.error: string` to the store. Clear it when a new play attempt succeeds; on rejection set the bounded generic message “This track could not be played”, preserve the queue entry, and mark playback paused. Render the message with `role="alert"` in the existing player sidebar; do not include a source path or raw browser error. Do not silently recurse through additional tracks.

**Verify**: `npm test -- src/services/playback-state.test.ts src/hooks/useAudioPlayer.test.ts` → success consumes one head; rejection consumes none; duplicates preserve order; the error lifecycle is deterministic.

### Step 4: Handle automatic transition rejection

Replace the direct async `ended` callback with a wrapper that catches and records the rejection. Verify one ended event triggers one transition, cleanup removes the exact listener, media error leaves state consistent, and rapid repeated events do not double-consume the same queue entry.

**Verify**: `npm test` → no unhandled rejection and all transition/adapter tests pass.

### Step 5: Run full gates

Run every command in the commands table.

**Verify**: `git diff --check` → exit 0. Then run `git status --porcelain=v1 | cut -c4- | rg -v '^(src/hooks/use(AudioPlayer|KeyboardShortcuts)(\.test)?\.tsx?|src/services/(audio-transport|playback-state)(\.test)?\.ts|src/components/audio-sidebar/player\.tsx|src/App\.d\.ts|vitest\.config\.ts|plans/README\.md)$'` → exit 1 with no output.

## Test plan

- Pure state tests for boundaries, queue precedence, duplicates, stale indices, and previous threshold.
- Fake transport tests for play success/rejection, ended/error, rapid events, and cleanup.
- Keyboard test only if extraction changes the playback command path; preserve typing guards and default prevention.

## Done criteria

- [ ] A failed queued track remains queued.
- [ ] The ended listener cannot produce an unhandled rejection.
- [ ] Pure tests document current next/previous/queue semantics.
- [ ] Audio behavior is testable without a real WebView.
- [ ] All frontend and Rust gates pass; no out-of-scope changes exist.

## STOP conditions

- Qwik serialization prevents injecting the narrow transport without changing public store contracts broadly.
- Correct handling requires choosing a new skip/retry UX rather than preserving current behavior.
- Tests reveal two contradictory current behaviors that cannot both be characterized.
- The fix expands into native decoding/output or durable queue schema work.

## Maintenance notes

Plan 003 should reuse the pure transition suite as a compatibility contract while replacing transport ownership. Reviewers should focus on command ordering and rapid-event races, not only the happy path.
