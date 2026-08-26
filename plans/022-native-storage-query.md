# Native storage query contract

## Status

DONE on branch `codex/022-native-storage-tree`.

## Objective

Add a bounded, revision-aware native path hierarchy so Storage can browse any user's library without loading the complete catalog into frontend memory.

## Scope

1. Query registered library roots and rootless explicit imports through one typed page contract.
2. Query only the immediate children of one normalized relative directory.
3. Backfill a compact directory/file node index and rebuild each root inside its authoritative reconciliation transaction.
4. Cap every response at 100 nodes and support offset paging, search, and name direction.
5. Extend track queries with exact native root/subtree filters for explicit playback selection.
6. Preserve rootless explicit imports as a generic paged collection.
7. Bind all values, reject traversal-shaped paths, and report one catalog revision per page.

## Non-goals

- No renderer route migration; that is the stacked child after this contract is green.
- No renderer-owned or eager in-memory filesystem tree.
- No direct filesystem traversal from the renderer.
- No user-specific path, host, service, or unrelated application reference.
- No animation or decorative redesign.

## Safety and performance invariants

- Page size is clamped to 100 nodes.
- Native paths use scanner-owned `/`-separated relative identities and reject empty, absolute, dot, and parent components.
- Ordinary directory pages use an indexed `(root_id, parent_path)` lookup; FTS-filtered ancestry remains derived from matching songs.
- The storage index is rebuilt before reconciliation commits, so catalog visibility and hierarchy visibility change atomically.
- Rootless imports use the reserved query-only root identifier `0`; persisted root identifiers remain positive.
- Search remains FTS-backed and values remain SQL-bound.
- Catalog revisions and query-bound track cursors prevent mixed snapshots.

## Verification

- root, nested-directory, direct-track, and imported-track contract tests
- search, paging, direction, response bounds, and revision tests
- invalid root/parent/path rejection tests
- exact native subtree and rootless track-selection tests
- Rust formatting, complete unit suite, and strict Clippy
- opt-in 100,000-track release benchmark, including root and child pages
- public-source scan for user-specific or unrelated references

The verified release benchmark measured storage roots at 64.3 milliseconds p95 and indexed root children at 9.8 milliseconds p95. Rebuilding the complete 100,000-track node index inside the no-change publish kept the atomic publish at 1.43 seconds, below its five-second budget.

## Delivery

This backend contract targets `master`. The renderer adoption branch will stack on it, remove `useLegacyCatalog` from Storage, and remain independently reviewable.
