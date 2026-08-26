# Recoverable library watchers

## Status

DONE on branch `codex/017-library-watchers`.

## Objective

Keep enabled library roots current without polling continuously while treating filesystem notifications only as fallible hints to run the authoritative native refresh pipeline.

## Scope

1. Install one recursive native watcher for every enabled library root.
2. Coalesce notifications through a bounded channel and root-keyed overflow set.
3. Debounce bursts with a fixed quiet period and maximum latency.
4. Schedule a complete validated root refresh after relevant changes.
5. Retry a pending hint when a refresh for that root is already active.
6. Persist watcher states for startup, active, degraded, and unavailable conditions.
7. Reinstall watchers and schedule recovery refreshes at startup, after watcher errors, and when the operating system resumes the app.
8. Start or stop the watcher immediately when a root is added, re-enabled, or disabled.

## Non-goals

- No catalog mutation from notification paths or event payloads.
- No permanent deletion of unavailable songs.
- No frontend settings redesign.
- No polling loop over the filesystem.

## Safety invariants

- Event paths are ignored; every catalog decision comes from a new canonical full-root discovery snapshot.
- Access/read events do not schedule work, so playback does not trigger rescans.
- The event channel is fixed-size, and overflow is coalesced to at most one recovery hint per registered root.
- Pending debounce memory is bounded by the number of registered roots.
- Continuous change cannot postpone a refresh for more than five seconds.
- A hint received during an active refresh remains pending until another refresh can start.
- Watcher and scheduler errors expose only generic state and root identifiers, never private paths.

## Verification

- Prove access events are ignored while create, modify, and remove events schedule work.
- Prove debounce has both a quiet delay and a maximum deadline.
- Prove channel overflow coalesces by root without unbounded event storage.
- Prove a valid root reaches `watching` and an unavailable root settles `unavailable`.
- Run Rust formatting, tests, and strict Clippy plus every existing frontend gate and a macOS application bundle.

## Delivery

This PR targets `codex/016-native-library-refresh`. After the base merges, retarget this child to `master`, rerun all GitHub checks, and merge only when the rebuilt stack is green.
