# Native library Settings and import adoption

## Status

DONE on branch `codex/018-native-library-settings`.

## Objective

Move user-facing folder import and library maintenance onto native roots, refresh orchestration, cancellation, and watcher health without regressing single-file drag-and-drop.

## Scope

1. Add typed frontend contracts for roots and refreshes.
2. Expose persisted latest-refresh state for every registered root.
3. Register selected directories as native roots instead of traversing them in the renderer.
4. Keep the compatibility importer only for explicitly dropped files.
5. Present root enablement, watcher health, refresh progress, manual refresh, and cancellation in Settings.
6. Invalidate paged and compatibility catalog caches after a native refresh completes.
7. Replace destructive missing-file cleanup with native unavailable-state reconciliation.
8. Disable registered roots before clearing the catalog so automatic recovery does not repopulate it.
9. Persist refresh-run identity so Settings never confuses low-level scans with orchestrated refreshes.
10. Adopt exact-path legacy rows in place while preserving favorite, resume, and date-added state.

## Non-goals

- No redesign of album, artist, or storage views.
- No new animation beyond existing immediate state changes.
- No deletion of unavailable song records.
- No single-file native-root schema in this phase.

## Safety invariants

- Directory enumeration and metadata parsing never run in the renderer.
- A failed or cancelled refresh leaves the last valid catalog visible.
- Watcher and refresh errors remain generic; selected paths are displayed only to the user who selected them.
- Clearing the library cannot race enabled watchers into repopulating it.
- Existing single-file drag-and-drop remains available through an explicit compatibility boundary.

## Verification

- Prove typed root and refresh command wrappers pass stable payloads.
- Prove directory/file partitioning never sends a directory through legacy traversal.
- Prove terminal refresh events invalidate bounded and compatibility catalog state once.
- Prove Settings state labels watcher and refresh outcomes accessibly.
- Prove standalone scans are excluded from persisted refresh history.
- Prove legacy rows are adopted without duplicates or user-state loss.
- Run frontend tests, lint, typecheck, production build, Rust tests/formatting/strict Clippy, and a macOS application bundle.

## Delivery

This PR targets `master` as the first change after the completed native-library stack.
