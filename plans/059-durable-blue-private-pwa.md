# Plan 059: Make private iPhone listening durable, blue, and recoverable

> **Executor instructions**: Follow this plan step by step. Run every verification command and confirm the expected result before moving to the next step. If anything in the "STOP conditions" section occurs, stop and report; do not improvise. When done, update this plan's row in `plans/README.md`.
>
> **Drift check (run first)**: `git diff --stat 331967f..HEAD -- vitest.config.ts src-tauri/src/remote_access.rs src-tauri/src/remote_access`
> Plan 058 must be DONE. Compare its resulting pure core and browser parity mechanism with this plan before editing; a missing tested core is a STOP condition.

## Status

- **Priority**: P1
- **Effort**: M
- **Risk**: MED
- **Depends on**: plan 058
- **Category**: direction / UX
- **Planned at**: commit `331967f`, 2026-08-30

## Why this matters

The current private PWA can browse and stream music, but reloads discard its queue and position, playback failures have little recovery, and its green accent diverges from Jukebox's steel-blue interface. For an installed iPhone PWA, refreshes, Safari process eviction, lock-screen control, and network changes are normal—not edge cases. This plan keeps playback device-local and the server read-only while making the session restart-safe, compact, and visibly part of Jukebox.

## Current state

- `src-tauri/src/remote_access/index.html` exposes Tracks/Albums/Artists, search, results, a status paragraph, and a native `<audio controls>` footer.
- `app.js` keeps `playQueue` and `playingIndex` only in memory and sets a stream URL directly from an opaque track ID.
- `app.css` uses hard-coded emerald `#34d399`/`#064e3b` for active and focus states, while the desktop app uses steel-blue variables.
- The service worker caches shell assets only and intentionally excludes `/api/`; retain that privacy and freshness boundary.
- The remote HTTP router is read-only and loopback-bound. Device-local persistence must store only bounded opaque IDs and display metadata, never paths, Tailscale hostnames, or bearer material.
- Plan 058 provides the tested versioned device-session parser, queue reducer, seek helpers, and browser parity mechanism.

## Commands you will need

| Purpose             | Command                                                                  | Expected on success                        |
| ------------------- | ------------------------------------------------------------------------ | ------------------------------------------ |
| PWA core tests      | `npm test -- --run src-tauri/src/remote_access/player-core.test.js`      | all pass                                   |
| Remote router tests | `cargo test --locked --manifest-path src-tauri/Cargo.toml remote_access` | all pass                                   |
| Full local gate     | `npm run pre-push`                                                       | exit 0                                     |
| App build           | `npm run tauri build -- --bundles app`                                   | exit 0                                     |
| Native QA           | Computer Use against the packaged app plus the loopback PWA              | queue/resume/error/focus acceptance passes |

## Scope

**In scope**:

- `src-tauri/src/remote_access/index.html`
- `src-tauri/src/remote_access/app.js`
- `src-tauri/src/remote_access/player-core.js`
- `src-tauri/src/remote_access/player-core.test.js`
- `src-tauri/src/remote_access/app.css`
- `src-tauri/src/remote_access/sw.js` only for shell-cache versioning
- `src-tauri/src/remote_access.rs` tests/static asset routing
- `plans/README.md` and this plan's status

**Out of scope**:

- Server-side queue mutation, desktop/iPhone synchronized playback, favorites/history writes, or arbitrary remote commands
- Offline audio caching, background downloads, public sharing, Funnel, accounts, or cloud state
- Custom waveform, visualizer, large artwork animation, or replacing native audio controls without equivalent accessibility
- HLS/transcoding; codec fallback remains a separate strategic slice
- Storing full URLs, hostnames, filesystem paths, or personal diagnostics in localStorage

## Git workflow

- Branch from the merged plan-058 head as `codex/059-durable-private-pwa` so the PR stack is explicit.
- Use a focused commit such as `feat: make private listening durable`.
- PR #059 targets plan 058 until its parent merges, then retargets `master`; use exact-head merge leases.

## Steps

### Step 1: Persist only a bounded device-local session

Extend the tested session contract with:

- schema version;
- queue of at most 500 opaque track summaries;
- current occurrence index;
- position in whole milliseconds;
- paused-only restore policy;
- catalog revision and saved timestamp used only for staleness/recovery decisions.

Write to localStorage only on structural queue/track changes, pause, and a coarse 5-second position checkpoint. Never write on every `timeupdate`. Restore the queue and selected track paused; require an explicit user gesture to resume. If the parser rejects data or the track returns 404, discard or repair the invalid occurrence without losing the remaining queue.

**Verify**: unit tests cover fresh, valid restore, malformed JSON, old version, oversized queue, out-of-range index/position, unavailable current track, and duplicate occurrences.

### Step 2: Add a compact queue and recovery surface

Add a collapsible Upcoming section above the footer with the current item, the next bounded set, explicit remove/clear controls, and direct activation. Keep tap targets at least 44 CSS pixels on iPhone. Use native buttons and disclosures styled as seamless Jukebox controls; the disclosure container itself is the interactive control, not a nested button.

Display distinct, actionable states for:

- autoplay requires a tap;
- temporary network interruption, with Retry;
- track unavailable, with Skip and Remove;
- library request failure, with Retry;
- empty queue/end of queue.

Changing views/search must not interrupt the playing audio element or replace the device queue.

**Verify**: Computer Use can browse Tracks/Albums/Artists while audio identity and Upcoming remain stable.

### Step 3: Align the PWA with the steel-blue design system

Define remote CSS custom properties at `:root` for canvas, surface, elevated surface, border, muted text, primary blue, primary hover/pressed, focus ring, danger, and control height. Replace all green accent literals. Keep dark color-scheme, safe-area padding, high contrast, visible focus, reduced motion, and no decorative animation.

Use a compact two-level hierarchy: sticky library/search header, scrollable results, and a restrained Now Playing/footer. Keep the native audio control unless every transport and slider behavior can be implemented accessibly and verified on iOS; styling around it is preferable to an inferior custom replacement.

**Verify**: `rg -n '#34d399|#064e3b' src-tauri/src/remote_access` returns no matches.

### Step 4: Complete Media Session and lifecycle recovery

Publish metadata only for the selected track. Update Media Session playback state and valid position state on play/pause/time changes at a bounded cadence. Wire play, pause, previous, next, seek backward, seek forward, and seek-to where WebKit supports them. Treat unsupported handlers as capability absence, not an error.

On `visibilitychange`, `pagehide`, `online`, and `offline`, checkpoint safely and show network state without automatically starting audio. A service-worker update must not cache `/api/` or stream responses.

**Verify**: plan-058 unit tests plus Rust asset/router tests pass; service-worker assertions still prove no `/api/` caching.

### Step 5: Run packaged and device-shaped acceptance

Build the app, start only Jukebox's loopback service through its Settings/Remote workspace, and use Computer Use for the desktop controls and browser/PWA at an iPhone-shaped viewport. Do not use private system pickers. Verify restore by reloading the PWA; it must return paused at the checkpoint with queue intact. Verify error recovery with an unavailable synthetic fixture through tests, not personal paths.

If a real iPhone is available through the existing private URL, manually confirm Add to Home Screen launch, lock-screen metadata, pause/resume, seek, and next/previous. If not, record real-device acceptance as unverified rather than claiming it.

**Verify**: `npm run pre-push && npm run tauri build -- --bundles app` -> both exit 0, followed by documented Computer Use results.

## Test plan

- Unit tests own every persistence and queue transition; no localStorage edge is tested only manually.
- Rust tests prove new static assets are routed with CSP/no-store policy and the service worker remains shell-only.
- Computer Use covers visible hierarchy, keyboard/focus order, 44px targets, disclosure semantics, queue activation, reload-paused restore, and error actions.
- Real iPhone Media Session acceptance is reported separately and never inferred from desktop Chromium/WebKit.

## Done criteria

- [ ] Reload/process eviction restores a bounded queue and position paused.
- [ ] The PWA has actionable retry/skip/remove states and no silent playback failure.
- [ ] Queue/search/navigation do not interrupt current playback.
- [ ] All PWA accent/focus/control colors use shared remote CSS variables and steel-blue values.
- [ ] Media Session seek/position handlers are capability-safe and tested at the pure boundary.
- [ ] No API/audio caching, server mutation, account, Funnel, machine URL, or path persistence exists.
- [ ] Full gate, app build, and packaged Computer Use acceptance pass.
- [ ] `plans/README.md` marks plan 059 DONE.

## STOP conditions

- Stop if reliable restore would require autoplay without a user gesture.
- Stop if state must contain a filesystem path, Tailscale URL, token, or more than 500 tracks.
- Stop if a desired action requires making the remote HTTP API mutable; specify that as a separate authenticated/revisioned plan.
- Stop if replacing native audio controls reduces keyboard, VoiceOver, seek, or volume capability.
- Stop if service-worker changes cache catalog or media responses.

## Maintenance notes

Device-local state deliberately avoids cross-device conflict and keeps the HTTP service read-only. A later shared-queue design must explicitly define queue ownership, authentication, CSRF/revision handling, and whether desktop and iPhone are separate output zones. Do not casually post the device session into native playback state.
