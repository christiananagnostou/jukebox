# Plan 011: Establish a paged native catalog query service

> **Executor instructions**: This is a high-risk migration slice. Follow every step and verification in order, preserve the compatibility path until parity is proven, and stop on every STOP condition. Update `plans/README.md` when complete.
>
> **Drift check (run first)**: `git diff --stat 9cfcd61..HEAD -- src-tauri/Cargo.toml src-tauri/Cargo.lock src-tauri/src/database.rs src-tauri/src/remote_access.rs src-tauri/src/main.rs src-tauri/src/library src-tauri/migrations src/services/library-db.ts src/services/library-client.ts src/routes src/hooks src/components/Shared/VirtualList.tsx src/components/Shared/VirtualList.test.ts src/components/library src/components/footer.tsx src/App.d.ts src/utils/Songs.ts plans/README.md`
> If any in-scope code changed, compare it to the current-state excerpts and stop on a semantic mismatch.

## Status

- **Priority**: P1
- **Effort**: L
- **Risk**: HIGH
- **Depends on**: plans 007 and 008
- **Category**: perf, architecture, migration
- **Planned at**: commit `9cfcd61`, 2026-08-26

## Why this matters

Jukebox currently loads every song into a deep frontend store, copies/sorts the catalog for every query, and maintains separate renderer and remote SQL. Startup memory and interaction cost therefore grow with the entire library, and schema behavior can drift across callers. A typed, paged Rust repository is the shared foundation for 100k-track performance, richer iPhone browsing, permission narrowing, playlists, and the later incremental scanner.

## Current state

- `src/services/library-db.ts:77-85` opens SQLite in the renderer and executes `SELECT * FROM songs`.
- `src/routes/layout.tsx:66-92` blocks initialization on the full result and derives another full array through `filterAndSortSongs` whenever the catalog, search, or sorting changes.
- `src/App.d.ts` retains `allSongs`, `filteredSongs`, playlist rows, queue rows, and the playing song in one deep Qwik store.
- `src-tauri/src/remote_access.rs:309-353` separately projects songs with three `%query%` `LIKE` predicates, `ORDER BY`, and offset pagination.
- `src-tauri/migrations/0001_initial.sql` has only the songs primary key; no browse index or FTS table exists.
- `src-tauri/src/database.rs` is the migration registry. Add every schema change as a new ordered migration; never edit `0001_initial.sql` after release.
- Plan 002's decided architecture: SQLite is authoritative; Rust owns catalog queries; frontend retains query state, small visible/near-visible pages, selected IDs, and playing/queued references. Text search ultimately uses FTS5 and stable cursor/revision semantics.
- This slice migrates reads, not scanning or all writes. Keep current write wrappers until a later native scanner slice replaces them.

## Commands you will need

| Purpose           | Command                                                                                                             | Expected on success                  |
| ----------------- | ------------------------------------------------------------------------------------------------------------------- | ------------------------------------ |
| Rust gates        | `cd src-tauri && cargo fmt -- --check && cargo test --locked && cargo clippy --locked --all-targets -- -D warnings` | all pass                             |
| Frontend gates    | `npm run lint && npm run build.types && npm test && npm run build`                                                  | all pass                             |
| Production bundle | `npm run tauri build`                                                                                               | exit 0 and bundle artifacts produced |

## Scope

**In scope**:

- `src-tauri/migrations/0002_catalog_query.sql` (create; exact name may change only before first merge)
- `src-tauri/Cargo.toml` and `src-tauri/Cargo.lock` to add `base64 = "0.22.1"`
- `src-tauri/src/database.rs`
- `src-tauri/src/library/mod.rs`, `repository.rs`, `query.rs` and tests (create)
- `src-tauri/src/main.rs`
- `src-tauri/src/remote_access.rs`
- `src/services/library-client.ts` and tests (create)
- `src/services/library-db.ts` only for the temporary write-only compatibility surface
- `src/routes/layout.tsx`
- `src/routes/albums/index.tsx`
- `src/routes/artists/index.tsx`
- `src/routes/storage/index.tsx`
- `src/routes/settings/index.tsx`
- `src/hooks/useLibraryImporter.ts`
- `src/hooks/useKeyboardShortcuts.ts`
- `src/hooks/useLibraryPage.tsx`
- `src/App.d.ts`
- `src/components/Shared/VirtualList.tsx`
- `src/components/Shared/VirtualList.test.ts` (create)
- `src/components/library/index.tsx`
- `src/components/library/LibraryRow.tsx`
- `src/components/footer.tsx`
- `src/utils/Songs.ts`
- `plans/README.md`

**Out of scope**:

- Native traversal, metadata workers, filesystem watching, fingerprinting, art-cache GC
- Playlist/history schema, playback engine, mobile albums/artists, HLS
- Removing SQL or filesystem capabilities before every remaining caller is migrated
- Changing song IDs or rewriting existing song rows
- Large UI redesign, animation, or route information-architecture changes

## Git workflow

- Branch `codex/011-native-catalog-query-foundation` from `master` after plans 007 and 008 are merged.
- Use a stack only for independently reviewable sub-slices: migration/repository, remote adoption, then desktop adoption. Each PR must keep master buildable and must target its immediate parent if stacked.
- Keep commits focused and imperative, matching examples such as `Add versioned library migrations`.

## Steps

### Step 1: Freeze query contracts and upgrade fixtures

Define serializable `TrackSummary`, `TrackQuery`, `TrackPage`, stable sort fields/directions, and a maximum page size of 100. Add the direct Rust dependency `base64 = "0.22.1"`. Define a version-1 cursor as bounded base64url JSON containing catalog revision, normalized query fingerprint, last sort tuple, and last song ID. Decoding validates version, maximum length, field types, query fingerprint, and revision; a mismatch returns typed `stale_cursor` so the caller restarts at page one. Add a representative pre-0002 SQLite fixture containing Unicode metadata, favorites, duplicate album/title values, discs/tracks, and enough rows for multiple pages.

**Verify**: `cd src-tauri && cargo test --locked database && cargo test --locked library` → fixture upgrades and contract serialization tests pass.

### Step 2: Add indexed browse/search migration

Create migration 0002 with the minimum indexes required for deterministic browse ordering, a singleton `catalog_meta(revision)` row, triggers that increment revision on every songs insert/update/delete regardless of writer connection, and a transactionally maintained FTS5 table for title, artist, album, and filename. Include rebuild/backfill for existing rows and FTS synchronization. Never interpolate request text into SQL. Test Unicode, wildcard-like characters, empty query, revision changes, updates, and deletes.

**Verify**: `cd src-tauri && cargo test --locked database` → upgraded fixture returns correct FTS/ordering, revision changes on every mutation, and row/rating counts are unchanged.

### Step 3: Implement the native repository

Add a Rust repository that owns paged track queries for both internal HTTP and Tauri callers. Return compact summaries, total count, query revision, and a bounded continuation/cursor. Use deterministic tie-breakers including song ID. Keep the database pool bounded and expose typed internal errors without personal paths.

**Verify**: `cd src-tauri && cargo test --locked library` → first/middle/final pages are stable, have no duplicates/omissions, enforce max limits, and reject malformed/query-mismatched/stale cursors and invalid sorts.

### Step 4: Move the remote endpoint onto the repository

Replace the duplicate SQL in `remote_access.rs` with the shared repository. Preserve the current bare JSON-array body consumed by `remote_access/app.js`; publish continuation as `X-Jukebox-Next-Cursor` and revision as `X-Jukebox-Catalog-Revision` response headers, omitting the cursor header on the final page. Accept an optional bounded `cursor` query parameter. The PWA remains unchanged in this slice. Extend plan 007's router tests for FTS, header cursor continuity, and typed stale-revision failure.

**Verify**: `cd src-tauri && cargo test --locked remote_access && cargo test --locked library` → remote and repository tests pass with one query implementation.

### Step 5: Add a typed frontend client and compatibility adapter

Create `library-client.ts` around Tauri commands/events. Add an explicit `loadLegacyCatalog()` compatibility method that fetches repeated bounded pages only when an unmigrated Albums, Artists, Storage, Settings-cleanup, or importer caller first requests it. It must never run from root startup, the main Library route, or root-route keyboard shortcuts. Store this temporary result as `legacyCatalog`, not as a second copy of the paged library cache; document each remaining caller in the module. Convert root-route shortcuts to operate on the paged selection/current-row state. Keep current write wrappers in `library-db.ts`; remove raw renderer reads once no caller remains.

**Verify**: `npm run build.types && npm test` → client serialization, cancellation/stale-response handling, and compatibility paging tests pass.

### Step 6: Convert the main library view to bounded pages

Replace `allSongs`/`filteredSongs` as the library route's query source with a descriptor, revision, total, and bounded page cache. Extend `VirtualList.tsx` to request missing windows with overscan and stable ID keys, discard distant pages under a documented cap, and ignore stale responses after query/sort changes. Retain playing/queued song summaries independently so page eviction cannot stop playback.

**Verify**: `npm test -- src/services/library-client.test.ts src/components/Shared/VirtualList.test.ts` → initial shell requests one bounded page; scrolling requests adjacent pages; search cancellation ignores stale results; retained page/song count stays below the documented cap; legacy loading never runs at startup.

### Step 7: Remove duplicate read paths and run full gates

Confirm no renderer caller executes `SELECT * FROM songs` and no remote handler embeds its own catalog query. Keep remaining mutations clearly marked as temporary compatibility work for the scanner phase.

**Verify**: `rg "SELECT \\* FROM songs|SELECT id, file, title, album, artist" src src-tauri/src` → no duplicate production catalog-read query matches. Run every command in the commands table, then `git diff --check`. Finally run `git status --porcelain=v1 | cut -c4- | rg -v '^(src-tauri/(Cargo\.(toml|lock)|migrations/0002_catalog_query\.sql|src/(database|remote_access|main)\.rs|src/library/.*)|src/(services/(library-db|library-client)(\.test)?\.ts|routes/(layout|albums/index|artists/index|storage/index|settings/index)\.tsx|hooks/use(LibraryImporter|KeyboardShortcuts|LibraryPage)\.tsx?|components/(Shared/VirtualList(\.test)?\.tsx?|library/(index|LibraryRow)\.tsx|footer\.tsx)|App\.d\.ts|utils/Songs\.ts)|plans/README\.md)$'` → exit 1 with no output.

## Test plan

- Historical database migration fixture with row/rating preservation and restart/reapply.
- Repository integration tests for deterministic paging, Unicode/escaped search, updates/deletes, revision and bounds.
- Router tests showing mobile uses the same repository and preserves byte-stream authorization.
- Frontend client/page-cache tests for loading, scroll, query change, stale cancellation, eviction, selection, and playing-song retention.
- Gate bounded page size and cache retention in CI. The synthetic 100k benchmark harness remains in plan 002, after both query and scan APIs exist.

## Done criteria

- [ ] One Rust repository owns desktop and remote catalog reads.
- [ ] Existing installed databases upgrade through migration 0002 without row/rating loss.
- [ ] Search is FTS-backed and pagination has stable deterministic continuity.
- [ ] Main library rendering no longer requires loading all songs or building a full filtered copy.
- [ ] Frontend retained query data is bounded and playback references survive page eviction.
- [ ] All frontend/Rust gates and a production Tauri bundle pass.
- [ ] No native scanner, identity, playlist, or visual-redesign work leaked into the change.

## STOP conditions

- Plans 007 and 008 are not merged or their router/mutation guarantees are not demonstrably preserved.
- The bundled SQLite build lacks FTS5.
- A migration test loses or rewrites any existing song/rating unexpectedly.
- Stable pagination requires changing song identity.
- Renderer-side writes fail to advance or expose one consistent database-backed revision across the SQL plugin and SQLx pools.
- A route cannot migrate without retaining an unbounded second copy of the catalog.
- The production bundle cannot open an existing pre-0002 database after two reasonable fixes.

## Maintenance notes

The next plan 002 slice should move scanning/writes behind this repository, then remove renderer SQL/filesystem permissions. Reviewers should demand bounded-memory tests, deterministic ordering, and real upgrade fixtures; a visually working 100-row library is not sufficient evidence for this change.
