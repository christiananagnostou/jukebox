# Native library filters and facets

## Status

DONE on branch `codex/036-native-library-facets` on 2026-08-27. Publication remains stacked behind phase 035's packaged playback gate.

## Objective

Complete the native track metadata contract and add bounded, indexed filter/facet APIs so desktop and private-mobile interfaces can build fast library refinement without loading or grouping the catalog in the renderer.

## Current state

- Full-text title/artist/album/file search and keyset paging are native, indexed, and benchmarked at 100,000 tracks.
- The native track summary omits genre, BPM, compilation, encoder, and track total, so the renderer currently invents empty or zero values.
- Track queries support artist, album, storage, search, and sorting, but not genre, year, codec, favorite rating, or availability.
- No bounded API exposes distinct filter values and counts.

## Scope

1. Return complete catalog metadata from native track pages and playback resolution; remove renderer-created placeholder metadata.
2. Add validated genre, year, codec, minimum-favorite, and availability filters to the native track query and cursor fingerprint.
3. Extend full-text indexing to genre and add targeted facet/filter indexes through one versioned migration.
4. Add a bounded facet-page contract for genre, year, and codec values with catalog revision and total distinct count.
5. Expose the same typed contracts through Tauri commands and the frontend library client.
6. Add migration, injection/bounds, query-continuity, facet-count, and representative query-plan tests.

## Non-goals

- No filter toolbar, route redesign, playlist rules, or remote API expansion in this phase.
- No client-side full-catalog grouping or filtering.
- No fuzzy ranking, arbitrary SQL syntax, or unbounded facet response.
- No animation or visual changes.

## Verification

- Migration tests prove existing rows are preserved, full-text genre search works, and triggers keep the rebuilt index synchronized.
- Repository tests prove every filter composes with search, paging cursors bind to the complete filter fingerprint, and unavailable tracks are explicit rather than accidental.
- Facet tests prove bounded paging, deterministic ordering, accurate counts, catalog revision, and safe handling of punctuation/Unicode.
- Query-plan tests prove representative filters use the new indexes.
- Run formatting, public-source, packaging, security, lint, strict types, frontend tests/build, Rust tests, strict Clippy, and the opt-in 100,000-track benchmark.

## Completion evidence

- A migration rehearsal against a temporary coherent copy of the installed 1,135-track catalog preserved track, favorite, root, and FTS counts; all four facet indexes and all three FTS triggers were present, trigger synchronization succeeded, and `PRAGMA integrity_check` returned `ok`. The temporary copy was deleted after verification.
- The release benchmark measured indexed combined filters at 33.527 ms p95 and genre facets at 18.729 ms p95 on 100,000 tracks, both below the 100 ms budget. Browse, FTS, continuation, aggregate, storage, no-change preparation, and publish budgets also passed.
- The stale benchmark fixture now consumes the authoritative metadata version instead of duplicating an outdated literal, restoring its 100,000-track no-change assertion.
- All 62 frontend tests, 140 Rust tests, 3 decoder integration tests, strict TypeScript, ESLint, strict Clippy, production frontend build, macOS app bundle, portability, formatting, public-source, packaging, and desktop-security gates passed.

## Acceptance criteria

- Native pages return real metadata instead of renderer placeholders.
- Filters are parameterized, bounded, cursor-safe, and do not require renderer catalog scans.
- Facet responses contain at most 100 values and are stable for a catalog revision.
- Existing databases migrate without losing tracks, favorites, roots, artwork paths, or FTS synchronization.
- No private paths, machine-specific details, or large animations are introduced.

## Stop conditions

- Stop if migration rebuilding changes song counts or leaves FTS triggers stale.
- Stop if a facet requires loading all distinct values into Rust or the renderer.
- Stop if representative filter queries regress to an avoidable full-table scan at 100,000 tracks.
