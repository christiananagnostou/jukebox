# Privacy-conscious local diagnostics

## Objective

Make production failures diagnosable without telemetry or personal-path leakage by adding bounded local logs, categorized recent errors, scan operation evidence, and compact Settings actions.

## Scope

1. Add a native diagnostics state that writes structured JSON lines to the application log directory.
2. Bound storage to one 1 MiB active log and three rotations.
3. Retain at most 25 recent categorized errors in memory for a redacted summary.
4. Record application startup, settings recovery warnings, remote-listener failures, watcher failures, and library refresh start/completion/failure with scan IDs, counts, and elapsed time.
5. Add Settings actions to open the diagnostics directory and copy an app/version/platform/schema/error summary.
6. Keep all diagnostics local and exclude music paths, filenames, metadata, hostnames, and tailnet details.

## Non-goals

- No telemetry, crash upload, account, analytics SDK, or network reporting.
- No per-track info-level logging.
- No large animation or decorative diagnostics dashboard.
- No replacement for user-facing errors; diagnostics supplement existing messages.

## Invariants

- Free-form diagnostic detail containing path separators is replaced with a redacted marker before persistence.
- Category and code fields accept only bounded ASCII diagnostic tokens.
- Logging failure never blocks playback, scanning, startup, or settings changes.
- Opening the diagnostics directory uses a fixed application-owned path, never a renderer-provided path.
- Copied summaries contain no diagnostics-directory path or music-library path.

## Verification

- Unit-test detail redaction, error retention, rotation, disabled logging, and summary serialization.
- Unit-test native summary formatting.
- Run formatting, public-source portability, lint, strict types, frontend tests/build, Rust tests, strict Clippy, and Tauri packaging.
- Inspect the installed Settings actions and verify the copied summary and local log contain no music paths.

## Acceptance criteria

- A completed or failed library refresh is identifiable by scan ID with bounded counts and elapsed time.
- Recent categorized failures can be copied from Settings without exposing personal paths.
- The local log directory opens from Settings on supported desktop platforms.
- Log growth is bounded and logging failures are non-fatal.

## Rollout and rollback

- The diagnostics module is additive and has no database migration.
- Removing the module and two Settings actions returns to the prior behavior; existing log files are harmless local JSON lines and may be deleted by the user.

## Status

DONE
