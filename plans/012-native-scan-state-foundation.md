# Native scan-state foundation

## Status

DONE on branch `codex/012-native-scan-foundation`.

## Objective

Create the durable database and Rust API boundary required for incremental library scanning without changing the current import UI or enabling filesystem watchers yet.

## Scope

1. Persist canonical library roots and enabled state.
2. Persist scan generations, lifecycle state, counters, and failure summaries.
3. Extend songs with optional root/location fingerprints, availability, scan generation, and metadata version.
4. Add typed native commands to register, list, and enable or disable roots.
5. Preserve every existing catalog row during migration and keep scan bookkeeping updates from causing unnecessary FTS rewrites.

## Non-goals

- No renderer migration in this slice.
- No recursive traversal or metadata worker pool.
- No filesystem watcher.
- No automatic removal of songs.
- No destructive migration of the existing settings library path.

## Safety invariants

- Existing songs migrate as available and remain queryable.
- Disabling a root never deletes its songs.
- A root must exist and be a directory before registration.
- Canonical root paths are unique.
- Scan counters cannot be negative, and scan/root status values are constrained.
- Incomplete scans cannot mark unseen songs unavailable; reconciliation behavior lands in the next slice.

## Verification

- Upgrade the historical pre-0002 fixture through every migration and prove catalog data survives.
- Verify root uniqueness, directory validation, enable/disable behavior, and non-destructive retention.
- Verify scan constraints and foreign-key behavior.
- Verify scan-only song updates do not rewrite FTS rows or advance visible catalog revision.
- Run Rust formatting, tests, strict Clippy, frontend lint/typecheck/tests/build, and a macOS application bundle.

## Delivery

This is the first child of the plan 002 scanner stack. A later child will add the bounded traversal/metadata/writer pipeline and reconciliation state machine; watchers follow only after reconciliation recovery is proven.
