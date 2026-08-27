# Plan 030: Restore committed playback sessions and queues

Status: DONE on branch `codex/030-playback-session-persistence`.

## Problem

Plan 029 made native state authoritative during a running desktop session, but app restart still discards the current context, manual queue, history, repeat/shuffle settings, volume, and resume position. Persistence must never serialize a provisional browser transition or turn high-frequency media timing into continuous SQLite writes.

## Scope

1. Add a versioned SQLite playback-session schema owned by Rust migrations and repository code.
2. Persist only committed, path-free playback snapshots; exclude rollback state and reject writes while a transition is pending.
3. Restore one validated snapshot at startup, pruning track IDs that no longer exist in the catalog and settling an invalid current selection deterministically.
4. Coalesce timing-only durability so playback observations remain in-memory at up to four hertz while disk checkpoints occur at a much lower bounded cadence and on explicit lifecycle boundaries.
5. Persist structural commands after successful commit without holding the playback mutex across database I/O.
6. Reconcile the restored opaque IDs with bounded catalog lookups in the renderer before loading browser audio; never autoplay on launch.
7. Surface a generic recoverable warning when stored state is unreadable or partly stale, while preserving a usable empty/default session.

## Safety rules

- A pending transition and its rollback snapshot are never persisted.
- Restore accepts no filesystem path, full `Song`, arbitrary JSON object, or unbounded collection.
- Persistence failure cannot roll back an already audible committed transition; it reports degraded durability and retries at a later checkpoint.
- Startup never emits audio without an explicit user action.
- Database work never runs while the playback mutex is held.
- Timing observations do not write to disk at media-event frequency.
- No remote mutation API, native decoder/output dependency, large animation, or unrelated interface work is introduced.

## Verification

- Migration tests upgrade existing installed databases without loss and enforce one bounded versioned session.
- Repository tests cover atomic replacement, malformed state, collection caps, missing-track pruning, pending-state exclusion, and checkpoint coalescing.
- Playback tests cover committed structural persistence, failed-transition non-persistence, monotonic restore revision, and no-autoplay startup.
- Frontend tests cover bounded ID resolution, stale restored entries, explicit resume, and generic recovery warnings.
- Run formatting, lint, typecheck, frontend/Rust/static/build/bundle gates, public-source privacy scan, installed launch, and loopback PWA smoke checks.

## Outcome

- Added a versioned singleton SQLite session with revision-guarded atomic replacement and strict path-free snapshot validation.
- Restores once through native state, pauses rather than autoplaying, prunes unavailable catalog IDs, preserves intentionally stopped queues, and repairs invalid saved state safely.
- Persists committed structural changes immediately and coalesces timing checkpoints to at most once every five seconds without awaiting SQL under the playback mutex.
- Resolves only the restored session's bounded opaque IDs into renderer track summaries, hydrates the browser transport without playback, and surfaces a generic recoverable durability warning.
- Verified formatting, lint, typecheck, 55 frontend tests, 125 ordinary Rust tests with one opt-in benchmark ignored, warning-free Clippy, production frontend build, macOS application bundle, DMG, and public-source privacy scan.

## STOP conditions

- Stop if the schema requires a path or full catalog row in persisted playback state.
- Stop if persistence requires holding the playback mutex during SQL or awaiting renderer output.
- Stop if restart correctness depends on autoplay or synchronous full-catalog loading.
- Stop if timing durability cannot be separated from the four-hertz in-memory observation path.
