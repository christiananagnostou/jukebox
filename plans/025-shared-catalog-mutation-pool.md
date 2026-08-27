# Reuse the managed catalog pool for mutations

## Status

DONE on branch `codex/025-shared-catalog-mutations`.

## Objective

Make imports, favorite changes, deletions, and library clearing reuse the initialized native library service instead of resolving the database path and opening a separate SQLite pool for every command.

## Scope

1. Inject managed `LibraryState` into all catalog mutation commands without changing frontend command names or payloads.
2. Ensure the native schema and recovery boundary settles before the first non-empty mutation.
3. Reuse a clone of the existing bounded SQLx pool and leave its lifecycle owned by the application.
4. Remove duplicate production path resolution, pool configuration, per-command connection setup, and close calls.
5. Exercise upsert, favorite, delete, and clear through `LibraryState` in one regression test.

## Non-goals

- No schema, query, watcher, or reconciliation semantic change.
- No frontend behavior or visual change.
- No broader write scheduler or cancellation redesign.
- No user-specific path, hostname, service, or unrelated application reference.
- No animation.

## Safety and performance invariants

- Empty upsert/delete requests remain no-ops and do not initialize the database unnecessarily.
- Favorite values remain restricted to 0, 1, or 2 before database work.
- Each logical mutation retains its existing all-or-nothing transaction.
- The shared pool remains capped by `LibraryState`; mutation commands never close it.
- Command identifiers and serialized frontend inputs remain stable.

## Verification

- managed-state mutation lifecycle regression
- complete frontend and Rust test suites
- Prettier, ESLint, strict TypeScript, rustfmt, and strict Clippy
- production Qwik build and application-only desktop bundle
- live installed-app Library/Settings smoke test
- public-source scan for personal paths and unrelated application references

## Delivery

Branch directly from the merged `master`, open one focused PR, and merge only after the web, macOS, and Ubuntu required checks pass on the exact head commit.
