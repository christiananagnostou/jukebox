# Plan 026: Bound the artwork cache lifecycle

Status: DONE on branch `codex/026-artwork-cache-lifecycle`.

## Problem

Embedded artwork is currently cached under artist/album directories with a track-path-derived filename. The same album image is therefore written once per track, and removing or rescanning tracks never reclaims abandoned files. Failed preparations may also leave files that are not referenced by the committed catalog.

## Scope

1. Address cached artwork by a digest of its bytes so identical embedded images share one file.
2. Write new cache entries atomically and reject oversized embedded images before they consume persistent cache space.
3. Increment the metadata extractor version so one successful refresh migrates unchanged catalog rows to the new addressing scheme.
4. After a reconciliation transaction commits, collect regular files under Jukebox's artwork directory that are not referenced by any catalog row.
5. Run the same post-commit collection after explicit song deletion and library clearing.
6. Never collect artwork during preparation, cancellation, failed reconciliation, or a rolled-back catalog mutation.
7. Preserve existing Tauri command names, song payloads, and frontend artwork rendering.

## Safety rules

- Collection walks only the application-owned artwork directory.
- Symbolic links are skipped and never followed.
- Database paths are reference inputs only; they never become deletion targets.
- Cache cleanup failure is reported to diagnostics but cannot turn an already committed catalog transaction into a false failure.
- Existing legacy artwork remains referenced until the successful metadata-version refresh that replaces it.

## Verification

- Unit tests prove identical bytes deduplicate, oversized images are skipped, referenced files survive, unreferenced files are removed, and symlinks are not followed.
- Reconciliation tests prove collection runs only after a successful commit.
- Mutation tests retain atomic rollback behavior.
- Run formatting, lint, typecheck, frontend build/tests, Rust tests, Clippy, and the desktop release bundle.
- Scan tracked files for private paths or unrelated product names before opening the PR.

## STOP conditions

- Stop if collection would require trusting arbitrary database paths as deletion targets.
- Stop if unchanged tracks cannot be migrated without a schema-breaking command or payload change.
- Stop if supported artwork cannot render from the content-addressed cache path.
