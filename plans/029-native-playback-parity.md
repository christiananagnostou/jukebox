# Plan 029: Route browser playback through native state

Status: IN PROGRESS on branch `codex/029-native-playback-parity`.

## Problem

Plan 028 established the native playback state but the Qwik player still mutates renderer playlist, queue, and transport fields directly. Directly wiring current `next` behavior would consume a native queue entry before browser playback succeeds, regressing the existing failure-safe transition guarantee.

## Scope

1. Add explicit prepare, commit, and reject semantics around current-selection transitions.
2. Retain the pre-transition snapshot until browser playback succeeds or fails; rejection restores queue, history, context, and current selection while advancing revision and recording a generic error.
3. Add one serialized TypeScript command bridge that owns the latest native revision and retries only by reloading after a typed stale-revision response.
4. Route explicit play, next, previous, ended, play/pause, duration, position, and media errors through native commands while retaining the browser `Audio` transport.
5. Replace direct renderer queue pushes/clears with stable-entry native queue commands and mirror path-free snapshots back to display-only Song arrays.
6. Preserve current audible behavior, path-redacted errors, rapid-transition exclusion, keyboard controls, and cleanup semantics.

## Safety rules

- A track-changing command never becomes committed until the transport reports successful `play()`.
- Rejected transitions restore the exact pre-transition structural state and never lose a queue entry.
- The bridge serializes commands; concurrent callers cannot invent or decrement revisions.
- Native snapshots and commands contain only bounded opaque IDs. Path resolution stays inside the existing local browser transport adapter.
- Position observations are throttled and do not cause unbounded rendering or event traffic.
- No persistence schema, native decoder/output dependency, remote write API, large animation, or unrelated UI change is introduced.

## Verification

- Rust tests cover pending-transition exclusion, commit, rollback, queue restoration, and monotonic revisions.
- Frontend tests cover explicit play, next/previous, queue enqueue/consume/rollback, stale revision recovery, rapid ended events, media events, and exact listener cleanup.
- Run all formatting, lint, typecheck, frontend/Rust/static/build/bundle gates plus installed launch and playback-shell smoke checks.

## STOP conditions

- Stop if rollback requires retaining a filesystem path or full Song in native state.
- Stop if bridge reconciliation can overwrite a newer revision.
- Stop if compatibility requires two simultaneous authorities for queue order after initialization.
