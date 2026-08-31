# Plan 063: Bound refresh discovery and isolate playback access

## Status

DONE

## Outcome

Keep playback responsive when a library filesystem call stalls, and make refresh cancellation settle promptly without weakening catalog safety.

## Delivered

- Discovery and changed-metadata work now run through explicitly bounded workers with activity-aware deadlines and cancellation wakeups.
- Cancellation publishes terminal scan and reconciliation state immediately; transactional guards reject staging writes from late workers.
- Playback access probes use an independent two-slot worker budget, so one stalled filesystem probe cannot suppress the next readable track and repeated stalls cannot create an unbounded backlog.
- Injected blocking-operation tests prove prompt cancellation, late-worker isolation, restart recovery, bounded retry ownership, and successful playback authorization while discovery is stalled.
- Installed macOS QA refreshed the real 1,135-track watched folder from failed to completed, advanced audio playback, changed title/artist/album together on Next, and activated an upcoming track by double-click without a playback error.

## Scope

- Put blocking discovery and metadata filesystem operations behind explicit bounded worker ownership and per-operation deadlines.
- Let cancellation publish a terminal refresh state without waiting indefinitely for an uncooperative filesystem call.
- Prevent one timed-out playback access probe from suppressing every later track attempt indefinitely.
- Preserve atomic catalog reconciliation: a timed-out, detached, or cancelled worker may never publish partial discovery state.
- Add deterministic tests with injected blocking filesystem operations for playback during refresh, cancellation latency, late-worker rejection, and restart recovery.

## Done criteria

- [x] Playback authorization remains responsive while discovery is blocked.
- [x] Cancel refresh reaches a terminal state within a bounded interval.
- [x] A late worker cannot mutate scan, staging, or catalog state after cancellation.
- [x] Repeated timeouts do not create an unbounded thread or task backlog.
- [x] Deterministic injected-stall tests cover the uncooperative-worker cases, and installed macOS QA proves the corresponding real refresh and playback paths without shipping a test-only native hook.
