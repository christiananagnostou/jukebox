# Bounded native scan discovery

## Status

DONE on branch `codex/013-native-scan-discovery`.

## Objective

Discover supported audio files beneath a registered library root through a cancellable, bounded native pipeline and persist one scan snapshot without decoding metadata or changing the visible catalog.

## Scope

1. Add per-scan staging rows keyed by scan generation and normalized relative path.
2. Enforce at most one pending or running scan per root.
3. Traverse directories in Rust without following symlinks or accumulating a catalog-sized path array.
4. Send observations through a bounded channel to one batched SQLite writer.
5. Record file size and modified time for later change detection.
6. Expose typed start, cancel, and status commands plus progress events throttled to at most ten updates per second.
7. Mark abandoned pending/running scans interrupted during startup recovery.

## Non-goals

- No metadata decoding or artwork extraction.
- No song upsert, unavailability reconciliation, or deletion.
- No filesystem watcher.
- No frontend replacement of the current importer.

## Safety invariants

- Discovery never mutates `songs`.
- Hidden entries and symlinks are skipped explicitly.
- Directory and metadata errors increment a bounded failure count without exposing paths in generic UI errors.
- Cancellation stops new traversal work, drains or discards staging safely, and settles the scan as cancelled.
- A failed or interrupted discovery cannot be mistaken for a complete reconciliation snapshot.
- Staging rows are deleted automatically with their scan generation.

## Verification

- Traverse nested fixtures with supported and unsupported extensions, hidden entries, and symlinks.
- Prove channel and batch bounds with a large generated tree.
- Prove cancellation and injected traversal/writer failures settle the correct status.
- Prove two active scans for one root are rejected while different roots remain independent.
- Prove startup recovery marks abandoned active scans interrupted.
- Run all existing Rust/frontend gates and a macOS application bundle.

## Delivery

This PR targets `codex/012-native-scan-foundation`. The next child will consume only completed discovery snapshots to perform metadata work and failure-safe reconciliation; watcher activation follows after reconciliation recovery is proven.
