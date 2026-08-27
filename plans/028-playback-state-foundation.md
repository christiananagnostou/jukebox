# Plan 028: Establish the authoritative playback state

Status: DONE on branch `codex/028-playback-state-foundation`.

## Problem

Playback order, queue consumption, and current-track state still live in renderer arrays around one browser audio element. Durable queues, shared mobile controls, restart recovery, and a future native output engine need one typed state machine before transport or persistence changes.

## Scope

1. Add a pure Rust playback reducer with a serializable versioned snapshot and explicit commands.
2. Identify queue items by stable entry ID so duplicate tracks remain distinguishable.
3. Define repeat-off, repeat-one, repeat-all, deterministic shuffle, manual-queue precedence, previous-track restart, unavailable-track skip, and recoverable-error behavior.
4. Require an expected revision for mutations and reject stale commands without changing state.
5. Expose get/dispatch Tauri commands through bounded managed state while the existing HTML audio transport remains authoritative for actual output.
6. Add table-driven tests for empty/boundary queues, duplicates, repeat/shuffle, rapid commands, unavailable tracks, and revision conflicts.

## Safety rules

- The snapshot stores opaque track IDs and queue entry IDs, never paths or full track objects.
- State transitions perform no filesystem, database, network, decoder, or output work.
- Every accepted mutation increments one monotonic revision; rejected commands are no-ops.
- Queue size and incoming identifier lengths are bounded before allocation or mutation.
- No frontend migration, persistence format, audio dependency, large animation, or transport replacement is introduced in this phase.

## Verification

- Rust unit tests prove every transition and invariant.
- Existing frontend playback characterization remains green and behaviorally unchanged.
- Run formatting, lint, typecheck, frontend tests, Rust tests, strict Clippy, production builds, and application bundling.

## STOP conditions

- Stop if a pure transition needs a local path, decoded audio state, or Tauri window state.
- Stop if command handling would block on playback or filesystem work.
- Stop if the compatibility boundary requires changing current audible playback before snapshot parity is implemented.
