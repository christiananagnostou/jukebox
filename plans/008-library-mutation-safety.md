# Plan 008: Make library cleanup and chunked mutations failure-safe

> **Executor instructions**: Follow this plan step by step, run every verification gate, and stop on any STOP condition. Update the plan status in `plans/README.md` when complete.
>
> **Drift check (run first)**: `git diff --stat 9cfcd61..HEAD -- src/services/library-db.ts src/services/library-maintenance.ts src/hooks/useLibraryImporter.ts src/routes/settings/index.tsx src-tauri/src/catalog_mutations.rs src-tauri/src/main.rs src-tauri/src/database.rs src-tauri/Cargo.toml src-tauri/Cargo.lock vitest.config.ts plans/README.md`
> Any semantic mismatch with the current-state excerpts is a STOP condition.

## Status

- **Priority**: P1
- **Effort**: M
- **Risk**: MED
- **Depends on**: none
- **Category**: bug, tests, migration
- **Planned at**: commit `9cfcd61`, 2026-08-26

## Why this matters

The cleanup screen currently deletes valid rows when a filesystem check throws, and chunked imports/deletes can partially commit while the UI still shows the pre-operation state. These are data-loss and consistency risks around ratings and library membership. The mutation contract must be explicit and covered before catalog ownership moves into Rust.

## Current state

- `src/routes/settings/index.tsx:205-216` maps both `exists(path) === false` and every thrown filesystem error to the same `missingIds` list; line 220 deletes all of them.
- `src/services/library-db.ts:87-109` executes each 100-song upsert independently; there is no transaction spanning the logical import.
- `src/services/library-db.ts:121-135` independently commits each 200-ID deletion chunk.
- `src/hooks/useLibraryImporter.ts:160` updates the frontend only after all metadata results and database chunks finish.
- `src/routes/settings/index.tsx:220-230` updates the frontend only after all deletion chunks finish.
- `src-tauri/src/database.rs` owns migrations and has fresh-schema tests, but it does not yet provide an application repository or historical upgrade fixture.
- Preserve existing song IDs, schema columns, favorite ratings, dates added, and public TypeScript call signatures unless a compatibility wrapper is retained.

## Commands you will need

| Purpose             | Command                                                                                                             | Expected on success |
| ------------------- | ------------------------------------------------------------------------------------------------------------------- | ------------------- |
| Frontend tests      | `npm test`                                                                                                          | all tests pass      |
| Frontend lint/types | `npm run lint && npm run build.types`                                                                               | both exit 0         |
| Frontend build      | `npm run build`                                                                                                     | exit 0              |
| Rust gates          | `cd src-tauri && cargo fmt -- --check && cargo test --locked && cargo clippy --locked --all-targets -- -D warnings` | all pass            |

## Scope

**In scope**:

- `src/services/library-db.ts`
- `src/services/library-db.test.ts` (create)
- `src/services/library-maintenance.ts` and `.test.ts` (create)
- `src/hooks/useLibraryImporter.ts`
- `src/routes/settings/index.tsx`
- `src-tauri/src/catalog_mutations.rs` (create)
- `src-tauri/src/main.rs`
- `src-tauri/src/database.rs`
- `src-tauri/Cargo.toml` and `src-tauri/Cargo.lock` only if the existing SQLx feature set is insufficient
- `vitest.config.ts` only if required to discover new TSX tests
- `plans/README.md`

**Out of scope**:

- New tables, native scanner/watcher, FTS, pagination, or identity changes
- Deleting inaccessible rows, rewriting ratings, or changing the user's chosen music folder
- Visual redesign of Settings
- Broad renderer permission changes

## Git workflow

- Branch `codex/008-library-mutation-safety` from current `master`.
- Prefer one commit for characterization/test seams and one for behavior changes.
- Do not include generated build output.

## Steps

### Step 1: Build an isolated mutation test harness

Create `catalog_mutations.rs` with a `CatalogSongInput` that matches the serialized TypeScript `Song` fields and path helpers that open a temporary test database or the production `app_config_dir()/library.db`. Register narrow `upsert_songs`, `delete_songs`, and `clear_library_songs` Tauri commands in `main.rs`; keep the TypeScript functions in `library-db.ts` as compatibility wrappers around `invoke`. Use one SQLx transaction per command, retain chunked statements inside it, and preserve the existing conflict rule for favorite rating and date added. Do not point tests at the user's `library.db`.

**Verify**: `cd src-tauri && cargo test --locked catalog_mutations` → isolated migrated-schema tests cover the 100-row upsert and 200-ID delete boundaries.

### Step 2: Define atomic logical mutation behavior

Add a test-only fail-after-chunk injection below the public command boundary. A failure after the first chunk must roll back the SQLx transaction, leaving either all or none of the logical upsert/delete visible. The production command must not expose fault injection.

**Verify**: `cd src-tauri && cargo test --locked catalog_mutations` → injected middle-chunk failure leaves the pre-operation row set intact.

### Step 3: Separate missing from inaccessible paths

Extract `classifyLibraryPaths` into `src/services/library-maintenance.ts`. It accepts songs plus an injected async existence checker and returns `{ missingIds, inaccessible }`, where inaccessible entries contain only song ID and a bounded message, never a full path. Only explicit `false` enters `missingIds`. Settings reports “N files could not be checked and were kept” through the existing sync message.

**Verify**: `npm test -- src/services/library-maintenance.test.ts` → present, missing, permission-error, and unavailable-volume cases pass; thrown checks are retained.

### Step 4: Keep persistent and in-memory results aligned

Update importer and Settings orchestration so frontend state changes only after an atomic success. On failure, leave the previous arrays intact and surface the existing error state. Add a regression test for a failed mutation and confirm playback/queue entries are not pruned unless deletion committed.

**Verify**: `npm test -- src/services/library-db.test.ts src/services/library-maintenance.test.ts` → wrapper and classification failure cases pass.

### Step 5: Run full gates

Run every command in the commands table and inspect the diff.

**Verify**: `git diff --check` → exit 0. Then run `git status --porcelain=v1 | cut -c4- | rg -v '^(src/services/(library-db|library-maintenance)(\.test)?\.ts|src/hooks/useLibraryImporter\.ts|src/routes/settings/index\.tsx|src-tauri/src/(catalog_mutations|main|database)\.rs|src-tauri/Cargo\.(toml|lock)|vitest\.config\.ts|plans/README\.md)$'` → exit 1 with no output.

## Test plan

- Isolated migrated SQLite tests: empty upsert, chunk boundaries, conflict preservation, all-or-nothing middle-chunk failure, delete boundaries, and clear.
- Filesystem classification tests: present, confirmed missing, permission error, unavailable volume/error.
- Orchestration regression: database rejection leaves store, queue, and playlist state unchanged.

## Done criteria

- [ ] Cleanup deletes only confirmed-missing files.
- [ ] Inaccessible checks are retained and reported separately.
- [ ] Multi-chunk upsert and delete operations are atomic at the logical-operation boundary.
- [ ] Failure tests prove persistent and in-memory state remain aligned.
- [ ] All frontend and Rust gates pass.
- [ ] No schema or out-of-scope files changed; roadmap row is updated.

## STOP conditions

- Atomicity requires a schema change or broad catalog-service migration.
- The Rust command cannot deserialize the current `Song` shape without changing the public TypeScript model.
- Existing `UPSERT_UPDATE` behavior conflicts with preservation of ratings/date-added; report the exact mismatch before choosing new semantics.
- Tests require a real user database or music directory.

## Maintenance notes

Plan 011 must preserve these mutation guarantees when reads move behind Rust. Reviewers should look for accidental deletion on `exists` exceptions and verify fault-injection truly occurs after an earlier chunk, not before any write.
