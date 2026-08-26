# Atomic native scan reconciliation

## Status

DONE on branch `codex/015-atomic-scan-reconciliation`.

## Objective

Apply one ready metadata snapshot to the visible catalog through a single failure-safe transaction while preserving user state and stable song identity.

## Scope

1. Prefer an existing song at the same root-relative path.
2. Correlate a rename only when one missing song and one staged file uniquely share size and quick fingerprint.
3. Insert genuinely new songs and refresh changed metadata.
4. Preserve favorites, date added, and playback start offsets for existing identities.
5. Restore observed songs to available and mark unseen songs unavailable only at the successful commit boundary.
6. Update root, scan, and reconciliation counters atomically with the catalog.
7. Delete sensitive metadata staging after success or failure.

## Non-goals

- No permanent deletion of unavailable songs.
- No filesystem watcher.
- No frontend migration from the compatibility importer.

## Safety invariants

- Only a ready reconciliation for the latest completed scan of an enabled root can apply.
- The transaction obtains a write reservation before revalidating snapshot freshness.
- Ambiguous fingerprint matches never reuse an existing identity.
- A candidate ID collision fails instead of overwriting an unrelated song.
- Any database, validation, or injected failure rolls back every catalog and root change.
- Missing files transition to unavailable only; user data is never deleted.
- Errors exposed to the UI never include private paths or metadata.

## Verification

- Prove same-path updates and unique renames retain IDs and user fields.
- Prove ambiguous matches create a new identity and leave old identities unavailable.
- Prove unchanged unavailable songs become available without metadata decoding.
- Prove stale snapshots and candidate collisions cannot apply.
- Inject a failure after upserts and prove songs, revision, root time, and scan counters roll back.
- Run the complete Rust and frontend gate suites plus a macOS application bundle.

## Delivery

This PR targets `codex/014-scan-metadata-staging` as the child of the metadata-preparation foundation. Watcher activation and frontend adoption follow only after this commit boundary is merged and verified.
