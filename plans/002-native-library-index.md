# Native incremental library index

## Objective

Turn library management into a native, incremental service that watches configured roots, performs bounded metadata work, supports instant indexed search, and does not require the frontend to hold the entire catalog.

## Current state and evidence

- `src/hooks/useLibraryImporter.ts` recursively enumerates directories through frontend plugin calls, holds every discovered path and result in arrays, and invokes Rust once per track.
- `src/routes/layout.tsx` loads every database row into `store.allSongs`; every search/sort builds another full array in `src/utils/Songs.ts`.
- The current path-derived MD5 ID in `src-tauri/src/metadata.rs` changes on rename and cannot distinguish replacement content at the same path.
- Scans are manual; there is no persisted scan-root model, file fingerprint, watcher, removal policy, or art-cache garbage collection.
- Search only covers title, artist, and album with substring matching.

## Scope

1. Move traversal, metadata extraction, fingerprints, and catalog writes into Rust.
2. Persist scan roots and incremental file state.
3. Add debounced filesystem watching and recoverable full reconciliation.
4. Add FTS-backed search, sorting, filters, facets, and paged queries.
5. Bound frontend memory and make virtual views request windows of rows.
6. Reconcile and garbage-collect artwork safely.

## Non-goals

- No cloud/remote library.
- No automatic tag writing to source files.
- No waveform or visualization generation.
- No replacement of the audio output engine.

## Target architecture

- A long-lived `LibraryService` managed by Tauri owns scan roots, watcher handles, scan cancellation, database writes, and progress events.
- The frontend calls coarse commands: `add_library_root`, `remove_library_root`, `start_scan`, `cancel_scan`, `query_tracks`, `query_facets`, and `get_library_status`.
- Events carry operation ID, phase, processed count, total when known, changed-row count, and typed failures. Events are throttled to avoid a render per file.
- SQLite is authoritative; frontend stores only query state, visible pages, selections, playback references, and small facet summaries.

## Data model

- `library_roots(id, path, enabled, created_at, last_scan_at, watch_status)`.
- Extend `songs` with `root_id`, normalized path, file size, modified timestamp, quick fingerprint, availability, last_seen_scan, and metadata version.
- Add `library_scans(id, root_id, status, started_at, completed_at, discovered, updated, removed, failed)` for recovery and diagnostics.
- Add an FTS5 table for title, album, artist, album artist, genre, composer, and filename, maintained transactionally.
- Add indexes for root/path, artist/album/disc/track, date added, favorite, availability, and modified timestamp.

## Implementation plan

### 1. Introduce the native service

- Add `src-tauri/src/library/mod.rs`, `scanner.rs`, `repository.rs`, `query.rs`, and `events.rs`.
- Move directory traversal and existence checks out of `useLibraryImporter.ts` and the Settings route. Keep the current UI contract temporarily through an adapter.
- Use a bounded work queue: one traversal producer, a configurable small metadata worker pool, and one database writer batching transactions. Cancellation must stop new work and commit already completed batches consistently.
- Canonicalize paths carefully per platform while retaining the display path. Do not follow symlink cycles; make hidden-file and symlink behavior explicit settings.

### 2. Make identity and change detection robust

- Use root ID plus normalized relative path as the location key.
- Store size and modified timestamp to skip unchanged files quickly. When those differ, compute a bounded quick fingerprint and re-read metadata.
- Preserve favorites, playlist references, date added, and history when a rename can be correlated confidently. Treat ambiguous matches as a new track rather than silently joining two files.
- Version metadata extraction so parser improvements can trigger targeted re-indexing without pretending files changed.

### 3. Add reconciliation and watching

- Persist a scan generation ID. Mark files seen during reconciliation and mark unseen files unavailable only after a scan completes successfully.
- Add a debounced filesystem watcher per enabled root. Coalesce rename/create/write/remove bursts and schedule targeted refreshes.
- On watcher overflow, permission loss, or sleep/wake ambiguity, mark the root degraded and schedule a full reconciliation.
- Expose “keep unavailable tracks” versus “remove after scan” as an explicit policy; never delete playlist/history references without a migration strategy.

### 4. Build the query API

- Define `TrackQuery` with text, sort field/direction, availability, favorites, root, artist, album, genre, year range, offset/cursor, and limit.
- Use FTS5 for text search and indexed SQL for facets. Escape/query-parse input server-side; do not concatenate user text into SQL.
- Return total count, stable query revision, and a page of compact `TrackSummary` objects. Fetch full technical metadata only for the detail panel.
- Add album and artist aggregate queries so their routes do not regroup the full track array in JavaScript.

### 5. Convert the frontend incrementally

- Add `src/services/library-client.ts` for typed commands/events and query cancellation.
- Replace `allSongs`/`filteredSongs` in `src/App.d.ts` with query descriptors, page cache, revision, total count, and selected IDs.
- Update `VirtualList.tsx` to request missing windows with overscan and discard distant pages under a bounded LRU policy.
- Update library, artist, album, storage, search, favorite, and queue flows one route at a time. Keep a compatibility command during migration, then remove `@tauri-apps/plugin-sql` and broad frontend filesystem permissions.
- Persist query/view state only when useful; startup should render shell and initial rows without waiting for a full scan.

### 6. Manage artwork lifecycle

- Deduplicate album art by content hash, not track path, and store cache records with media type, dimensions, source track, and last reference.
- Generate a small thumbnail used by grids while retaining an appropriately bounded detail image.
- Garbage-collect unreferenced cache entries after successful scans, never during partial/failed reconciliation.

## Verification

- Generate fixture libraries at 1k, 10k, and 100k tracks with nested directories, duplicates, renames, permission errors, symlink cycles, and mixed metadata.
- Measure cold scan, no-change rescan, one-file update, search latency, page latency, peak RSS, and event count.
- Interrupt scans at every phase and verify database consistency/restart recovery.
- Simulate watcher storms and overflow, then confirm reconciliation converges.
- Confirm favorites, queue references, playlists, and date-added survive rescans and detected renames.

## Performance budgets

- No-change rescan performs no metadata decode and completes in time proportional to directory enumeration.
- Search and indexed sort return the first 100 rows in under 100 ms on the reference 100k-track fixture on supported development hardware.
- The frontend retains at most a few visible/near-visible pages, not the full library.
- Progress events are emitted at most 10 times per second.

## Acceptance criteria

- Adding a root triggers a cancellable scan and future filesystem changes appear without a manual full import.
- Failed or interrupted scans never erase valid catalog entries.
- Search covers rich tags and remains responsive at 100k tracks.
- Frontend SQL/filesystem permissions and full-library arrays are removed.
- Art cache size converges after removals and rescans.

## Rollout and rollback

- Dual-write or shadow-index a copied database during development and compare query results with the current frontend implementation.
- Migrate one route at a time behind a local feature flag.
- Retain a database backup before schema migration and provide a “rebuild index from files” recovery action that does not destroy playlists or ratings.
