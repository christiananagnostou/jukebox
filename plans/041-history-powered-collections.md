# History-powered built-in collections

Status: DONE

## Objective

Turn local listening history into useful, bounded native collections without loading or filtering the full catalog in the renderer.

## Current state

- The native catalog supports indexed bounded track, aggregate, storage, facet, and playlist queries.
- Listening history records successful playback starts, completion, listened time, and immutable metadata snapshots with a 10,000-row retention cap.
- The desktop has no native contract for Recently Played, Most Played, or Never Played collections.

## Scope

1. Define a typed built-in collection query for `recently_played`, `most_played`, and `never_played` with bounded page size and offset.
2. Return playable native track summaries plus completed play count, listened milliseconds, and last-played time.
3. Keep one transactionally coherent page revision derived from both catalog and history state.
4. Use retained-history indexes and available-track indexes; never scan or filter the full catalog in TypeScript.
5. Make Recently Played unique by track and ordered by the latest successful start.
6. Make Most Played count completed plays only, with deterministic recency and track-ID tie breaks.
7. Define Never Played as available tracks with no retained successful-start row.
8. Expose a typed Tauri command and frontend client for later compact collection UI work.

## Non-goals

- No editable smart-rule grammar, recommendations, ratings inference, cloud analytics, history route, or new animation.
- No unavailable-track relinking UI; immutable missing-track history remains available through the history contract.
- No renderer-side aggregation or unbounded export.

## Verification

- Fixture tests prove uniqueness, completion semantics, deterministic order, availability filtering, paging, revisions, and invalid-query rejection.
- Query-plan tests prove the completed-history, track-history, and available-song indexes remain usable.
- The opt-in 100,000-track release benchmark includes all three built-in collections under the existing query p95 budget.
- Frontend command-shape tests, formatting, lint, strict types, complete Rust tests, strict Clippy, production build, app packaging, security, identity, source portability, and bundle portability remain green.

## Acceptance criteria

- Every response is bounded to 100 tracks and offset is capped before database work.
- Repeated plays yield one Recently Played row and an auditable completed-play count.
- Partial starts appear in Recently Played but do not increase Most Played counts.
- Catalog or history changes produce a different page revision.
- Missing or unavailable catalog tracks never appear as playable collection items.

## Stop conditions

- Stop if a collection needs a full-catalog renderer load.
- Stop if arbitrary SQL or unvalidated rule JSON crosses the command boundary.
- Stop if history aggregation can block playback commands or mutate history.

## Completion evidence

- All collection semantics, revision, invalid-query, migration, and query-plan tests pass in the complete Rust suite.
- The 100,000-track release benchmark with 10,000 retained history rows measured p95 of 34.6 ms for Recently Played, 32.5 ms for Most Played, and 65.7 ms for Never Played against the 100 ms budget.
- Frontend types, lint, 75 tests, strict Clippy, production build, exact macOS app packaging, identity, desktop security, public-source portability, and bundle portability pass.
