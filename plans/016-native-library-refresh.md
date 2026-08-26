# End-to-end native library refresh

## Status

DONE on branch `codex/016-native-library-refresh`.

## Objective

Expose one persisted, cancellable operation that discovers an enabled library root, prepares changed metadata, and atomically publishes the resulting catalog snapshot.

## Scope

1. Compose discovery, metadata preparation, and atomic reconciliation behind one native refresh command.
2. Reuse one cancellation signal across every interruptible phase.
3. Expose a stable aggregate status while retaining the detailed scan and reconciliation records.
4. Emit aggregate progress events without duplicating the bounded lower-level pipelines.
5. Reject concurrent refreshes for the same root while allowing independent roots to refresh.
6. Preserve the existing lower-level commands as compatibility and diagnostic surfaces.

## Non-goals

- No filesystem watcher or sleep/wake recovery trigger.
- No frontend migration from the compatibility importer.
- No cancellation inside the final atomic catalog transaction.
- No permanent deletion of unavailable songs.

## Safety invariants

- The visible catalog changes only in the final reconciliation transaction.
- Cancellation before that transaction clears partial metadata staging and leaves the catalog unchanged.
- Once the final transaction starts, it either commits completely or rolls back completely.
- A failed discovery or metadata preparation never advances catalog contents.
- Refresh state contains generic errors and root identifiers, never private filesystem paths.
- Work remains bounded by the discovery, metadata-worker, channel, page, and database-batch limits established in plans 013-015.

## Verification

- Prove a refresh inserts a newly discovered track end to end.
- Prove a subsequent changed-file refresh retains stable identity and user-owned song fields.
- Prove cancellation and metadata failure leave the catalog unchanged.
- Prove the serialized aggregate contract uses stable camel-case fields and nested phase state.
- Run Rust formatting, tests, and strict Clippy plus every existing frontend gate and a macOS application bundle.

## Delivery

This is the base PR for watcher activation. Its child treats filesystem events only as debounced hints that schedule this authoritative full-root refresh pipeline.
