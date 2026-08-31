# Plan 063: Bound refresh discovery and isolate playback access

## Status

TODO

## Outcome

Keep playback responsive when a library filesystem call stalls, and make refresh cancellation settle promptly without weakening catalog safety.

## Evidence

- Native QA observed refresh runs remain at zero discovered files while the underlying blocking discovery call stayed active.
- During those runs, otherwise readable tracks hit the playback access timeout; after refresh recovery, the same catalog and files were healthy.
- The current Cancel refresh action signals cancellation but cannot publish a terminal state until the blocked worker returns.

## Scope

- Put blocking discovery and metadata filesystem operations behind explicit bounded worker ownership and per-operation deadlines.
- Let cancellation publish a terminal refresh state without waiting indefinitely for an uncooperative filesystem call.
- Prevent one timed-out playback access probe from suppressing every later track attempt indefinitely.
- Preserve atomic catalog reconciliation: a timed-out, detached, or cancelled worker may never publish partial discovery state.
- Add deterministic tests with injected blocking filesystem operations for playback during refresh, cancellation latency, late-worker rejection, and restart recovery.

## Done criteria

- [ ] Playback authorization remains responsive while discovery is blocked.
- [ ] Cancel refresh reaches a terminal state within a bounded interval.
- [ ] A late worker cannot mutate scan, staging, or catalog state after cancellation.
- [ ] Repeated timeouts do not create an unbounded thread or task backlog.
- [ ] Native macOS QA proves playback and cancellation against an injected stalled discovery operation.
