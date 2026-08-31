# Plan 058: Establish a testable private-PWA playback core

> **Executor instructions**: Follow this plan step by step. Run every verification command and confirm the expected result before moving to the next step. If anything in the "STOP conditions" section occurs, stop and report; do not improvise. When done, update this plan's row in `plans/README.md`.
>
> **Drift check (run first)**: `git diff --stat 331967f..HEAD -- package.json vitest.config.ts src-tauri/src/remote_access.rs src-tauri/src/remote_access/app.js src-tauri/src/remote_access/index.html src-tauri/src/remote_access/app.css`
> If any in-scope file changed since this plan was written, compare the current state below against live code before proceeding. A semantic mismatch is a STOP condition.

## Status

- **State**: DONE
- **Priority**: P1
- **Effort**: M
- **Risk**: MED
- **Depends on**: none
- **Category**: tests / architecture
- **Planned at**: commit `331967f`, 2026-08-30

## Why this matters

The private iPhone player is a shipping product surface, but its queue, selection, Media Session callbacks, retry text, pagination, and playback errors live in one untested 231-line global script. Rust tests currently assert that strings such as `nexttrack` appear in the asset; they do not prove behavior. Before adding durable queue/resume features, this plan creates a small pure state core with high-value unit tests while preserving the read-only loopback/Tailscale boundary.

## Current state

- `src-tauri/src/remote_access/app.js` owns mutable globals `playQueue`, `playingIndex`, catalog cursor/revision, view, artist, and album.
- `playAt()` changes the `<audio>` source, metadata, and text before awaiting `player.play()`; rejection only writes `Tap play to start audio.`.
- `playAdjacent()` silently does nothing at queue boundaries. Only `ended`, play, pause, previous-track, and next-track handlers exist; seek actions and position-state updates are absent.
- `load()` has useful generation-based stale-request suppression, but this behavior is not executable outside a browser.
- `src-tauri/src/remote_access.rs::pwa_manifest_is_scoped_to_its_private_origin` uses `APP_JS.contains(...)` assertions. Router integration tests strongly cover bounded catalog and byte ranges; retain them.
- Vitest is Node-only and currently includes only `src/**/*.test.ts`. The new pure browser module can be tested directly by extending this include without introducing DOM emulation.
- The PWA must remain a standalone, dependency-light static shell embedded with `include_str!`; do not add a runtime framework, CDN, account, analytics, or public endpoint.

## Commands you will need

| Purpose           | Command                                                                  | Expected on success |
| ----------------- | ------------------------------------------------------------------------ | ------------------- |
| Focused tests     | `npm test -- --run src-tauri/src/remote_access/player-core.test.js`      | all new tests pass  |
| Rust remote tests | `cargo test --locked --manifest-path src-tauri/Cargo.toml remote_access` | all pass            |
| Full local gate   | `npm run pre-push`                                                       | exit 0              |
| App build         | `npm run tauri build -- --bundles app`                                   | exit 0              |

## Scope

**In scope**:

- `src-tauri/src/remote_access/player-core.js` (new pure browser ES module)
- `src-tauri/src/remote_access/player-core.test.js` (new)
- `src-tauri/src/remote_access/app.js`
- `src-tauri/src/remote_access/index.html`
- `src-tauri/src/remote_access.rs` asset-contract assertions
- `vitest.config.ts` to add the one co-located JavaScript unit-test pattern
- `plans/README.md` and this plan's status

**Out of scope**:

- New state-changing HTTP endpoints, desktop queue sharing, listening-history writes, favorites, or authentication changes
- Persistent browser storage; plan 059 owns it after this core is characterized
- Visual redesign; plan 059 owns PWA presentation
- Bundlers, runtime dependencies, service-worker API caching, or offline audio
- Changing stream authorization, loopback binding, Tailscale, or file-range behavior

## Git workflow

- Branch from current `master` as `codex/058-private-pwa-core`.
- Use a focused commit such as `test: characterize private PWA playback`.
- Open a PR to `master`; it is independent of plan 057 and may be stacked only if both are already in flight.

## Steps

### Step 1: Define the pure device-session model

Create `src-tauri/src/remote_access/player-core.js` as a browser-native ES module with JSDoc types and no Qwik, Tauri, DOM, storage, or network imports. Model only device-local PWA state:

- bounded track summaries containing opaque ID plus display metadata;
- queue replacement and append with a maximum of 500 retained entries;
- current index as `number | null`, never an invalid sentinel;
- `select`, `next`, `previous`, and `ended` transitions;
- a versioned persisted shape parser that rejects unknown versions, invalid IDs, oversized arrays, path-like fields, and out-of-range positions;
- a helper that clamps seek targets to known finite duration;
- a helper that derives Media Session position state only when duration and position are valid.

Keep track IDs opaque and bounded consistently with native playback identifiers. Do not include paths or stream URLs in state.

Add the module as a self-hosted route and load `app.js` with `type="module"`; CSP remains `script-src 'self'` and must not gain inline/eval allowances.

**Verify**: `npm run build.types` and `cargo test --locked --manifest-path src-tauri/Cargo.toml remote_access` -> both exit 0.

### Step 2: Characterize the state core with unit tests

Extend `vitest.config.ts` with the exact `src-tauri/src/remote_access/**/*.test.js` pattern. Add table-driven Vitest coverage that imports the production `player-core.js` module directly and covers empty state, first selection, append, duplicate track occurrences, next/previous boundaries, ended-at-end, replacement, 500-entry truncation/rejection policy, malformed persisted JSON values, stale catalog revision recovery, seek clamping, and Media Session position-state validity.

Tests must prove duplicates remain distinct queue occurrences and no operation can produce an invalid current index.

**Verify**: `npm test -- --run src-tauri/src/remote_access/player-core.test.js` -> all tests pass.

### Step 3: Consume the tested production module

Update `app.js` to import `player-core.js` and use it for queue/index/seek decisions. The same exact file is imported by Vitest and served to the browser; do not create a TypeScript mirror, generated copy, or second reducer. Keep DOM, fetch, storage, and audio side effects in the shell.

**Verify**: `cargo test --locked --manifest-path src-tauri/Cargo.toml remote_access` -> the router serves the new module with the same CSP/no-store security posture and asset parity assertions pass.

### Step 4: Make transport outcomes explicit

Handle audio `error`, `stalled`, `waiting`, `playing`, `pause`, `ended`, `durationchange`, and `timeupdate` without throwing unhandled promises. A failed `play()` leaves the selected item ready to retry and never advances the queue. `ended` advances exactly once. Add supported Media Session handlers for seek backward, seek forward, and seek-to using the pure clamping helper; continue tolerating WebKit actions it does not expose.

Do not persist yet. Do not report a generic catalog error for autoplay policy; keep that as an actionable tap-to-play state.

**Verify**: focused Vitest plus Rust remote tests pass.

### Step 5: Run the complete product gate

Run the full pre-push gate and build the application bundle to prove the embedded assets remain distributable.

**Verify**: `npm run pre-push && npm run tauri build -- --bundles app` -> both exit 0.

## Test plan

- New pure-state tests cover every queue/index transition, duplicate occurrence, persistence parser boundary, and seek helper.
- Rust tests assert the browser core is actually routed, CSP permits only self modules, API responses remain no-store, and source parity is enforced.
- No test needs a personal music file, live Tailscale state, or a browser audio device.
- Packaged Computer Use is deferred to plan 059 because this plan intentionally does not redesign the visible PWA.

## Done criteria

- [x] Private-PWA queue/selection/seek rules have direct unit tests, not string-presence tests.
- [x] Vitest imports the same `player-core.js` file the PWA loads.
- [x] Duplicate tracks remain distinct occurrences; queue/index state is bounded and valid.
- [x] Audio failures never skip the selected track or create an unhandled rejection.
- [x] No new mutable HTTP endpoint, filesystem field, account, or runtime framework exists.
- [x] `npm run pre-push` and app bundling pass.
- [x] `plans/README.md` marks plan 058 DONE.

## Delivered

- One dependency-free production ES module now owns the bounded device-session queue, occurrence-preserving selection transitions, versioned path-free persistence parser, seek clamping, and Media Session position validation.
- Thirty-nine direct Vitest cases import that production module and cover empty/replacement/append transitions, duplicate IDs, every queue boundary, 500-entry runtime and persistence policies, malformed/stale session recovery, and finite seek/position rules.
- The browser shell consumes the tested core and explicitly handles playback errors, stalls, buffering, playing, pause, ended, duration, time, previous/next, and Media Session seek actions without adding storage or a mutable server endpoint.
- The Rust router serves the exact embedded module under the existing self-only CSP and asserts source parity, cache headers, and module loading without behavior-by-string tests.
- The complete pre-push gate passed with 193 frontend/PWA tests, 187 ordinary Rust unit tests, three native decoder tests, strict Clippy, and production builds. The macOS application bundle and 10-file portability scan also passed.

## STOP conditions

- Stop if sharing the core requires adding a bundler/runtime solely for the PWA or duplicating the reducer.
- Stop if the only proposed test asserts source strings instead of behavior.
- Stop if implementation needs a state-changing remote API or desktop playback-state mutation.
- Stop if any persisted/session type contains an absolute path or raw stream URL.

## Maintenance notes

This plan deliberately establishes behavior before persistence and styling. Plan 059 owns device-local persistence and the blue mobile workspace. If later remote queue ownership becomes server-authoritative, keep this pure reducer as the optimistic client boundary and add revision-conflict tests rather than deleting characterization coverage.
