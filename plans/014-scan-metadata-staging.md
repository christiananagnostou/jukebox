# Native scan metadata staging

## Status

DONE on branch `codex/014-scan-metadata-staging`.

## Objective

Prepare changed audio files from one completed discovery snapshot through a bounded native metadata pipeline without changing the visible catalog.

## Scope

1. Add an explicit reconciliation lifecycle and per-scan metadata staging rows.
2. Detect unchanged files by root-relative path, size, modified time, and metadata schema version.
3. Resolve every staged relative path beneath its canonical root immediately before reading it.
4. Compute a quick content fingerprint from bounded samples and file size.
5. Decode metadata with bounded worker concurrency and persist results through one batched SQLite writer.
6. Refactor the compatibility metadata command to share the same native extractor.
7. Recover abandoned preparation work as interrupted without touching songs.

## Non-goals

- No catalog upsert, rename matching, availability transition, or deletion.
- No filesystem watcher.
- No frontend migration from the compatibility importer.

## Safety invariants

- Only the latest completed discovery snapshot for a root can begin preparation.
- Preparation never mutates `songs`.
- Paths that escape the canonical root, symlinks, non-files, and files changed since discovery fail the preparation.
- Any fingerprint, metadata, artwork, staging, cancellation, or worker failure prevents a ready state.
- Memory is bounded by fixed query, worker, channel, and write-batch limits rather than library size.
- Errors stored for UI display are generic and never include private paths or metadata.

## Verification

- Prove migration constraints, cascade cleanup, and startup recovery.
- Prove unchanged detection avoids file decoding and changed files receive deterministic fingerprints.
- Prove path traversal, symlink substitution, and post-discovery file changes are rejected.
- Prove more than one channel and write batch is processed without song mutation.
- Prove injected parsing and staging failures settle failed and never leave a ready snapshot.
- Run Rust formatting, tests, and strict Clippy plus the existing frontend gates.

## Delivery

This is the first PR in a two-PR stack. Its child atomically applies only a ready snapshot, preserves user state and stable song identity, and marks missing tracks unavailable only after a successful commit.
