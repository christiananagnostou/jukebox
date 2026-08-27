# Privacy-conscious listening history foundation

Status: ACTIVE

## Objective

Capture bounded, explainable listening history from actual successful playback while preserving local-first privacy and playback reliability.

## Current state

- Native playback transitions are authoritative and are committed only after the browser audio transport successfully starts.
- Position observations are serialized, revision checked, and checkpointed at a bounded interval.
- The playback state persists context and queue but has no durable listening history or play-count source.

## Scope

1. Add a versioned history table with immutable rows, track and metadata snapshots, source kind, listened and duration milliseconds, completion state, and bounded timestamps.
2. Start a history row only after `CommitTransition` or a successful `Play` acknowledgement.
3. Accumulate listened time from bounded forward position deltas so seeks do not inflate history.
4. Checkpoint active progress with the existing five-second persistence cadence and finalize on selection changes, natural endings, errors, or clear operations.
5. Recover stale open rows after process interruption and retain at most 10,000 completed rows.
6. Expose bounded newest-first history pages and an explicit clear command without filesystem paths.
7. Preserve history snapshots when catalog rows disappear and never let history persistence block playback.

## Non-goals

- No history route, smart playlists, recommendations, scrobbling, cloud sync, or external analytics.
- No exact wall-clock reconstruction while the app was suspended or closed.
- No filesystem paths, arbitrary source strings, or unbounded history exports.

## Completion rule

A play is complete after listening to at least the lesser of half its known duration or four minutes. Unknown-duration plays remain incomplete, and short tracks use the same half-duration rule.

## Verification

- Migration tests prove constraints, indexes, snapshot survival, and catalog independence.
- Repository/service tests cover actual-start gating, pause/resume, forward progress, seek caps, duplicate plays, failed transitions, stale-open recovery, completion thresholds, retention, paging, and clearing.
- Existing playback state, persistence, decoder, formatting, strict Clippy, production build, app packaging, security, identity, source portability, and bundle portability gates remain green.

## Acceptance criteria

- Clicking a track or preparing a transition cannot create a history row.
- A successful playback start creates exactly one active row; pausing and resuming it does not duplicate the row.
- Skipping or ending a track finalizes it with bounded listened time and a deterministic completion flag.
- Deleted catalog tracks remain explainable through metadata snapshots.
- History failures are isolated from playback commands and never expose paths.

## Stop conditions

- Stop if database latency can delay a browser playback transition acknowledgement.
- Stop if seeks can be counted wholesale as listened time.
- Stop if clearing history can mutate playback state or the music catalog.
