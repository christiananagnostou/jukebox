# M3U/M3U8 interoperability

Status: DONE

## Objective

Import and export interoperable UTF-8 M3U/M3U8 playlists through native, bounded, privacy-conscious workflows without granting the renderer arbitrary filesystem access.

## Scope

1. Parse UTF-8 M3U/M3U8 files selected by a native open dialog, with bounded bytes, lines, and path lengths.
2. Resolve absolute and relative entries against enabled library roots and the selected playlist directory before classifying unmatched entries.
3. Produce a dry-run token and bounded issue pages that disclose matched entries, duplicate entries, unavailable/missing tracks, and unmatched paths before mutation.
4. Retain at most four expiring import plans in native memory; never return selected absolute paths or accept an arbitrary source path from the renderer.
5. Apply only the reviewed matched entries to a new manual playlist in one transaction while preserving source order and duplicates.
6. Export manual playlists through a native save dialog using UTF-8 M3U8, stable order, relative paths when beneath the selected destination directory, and absolute paths otherwise.
7. Report skipped unavailable entries without silently changing playlist state.
8. Expose typed frontend commands for the later compact import/export UI.

## Non-goals

- No renderer filesystem API, directory crawling, playlist auto-import, cloud sync, or background file watching.
- No mutation before the dry-run is reviewed and explicitly applied.
- No attempt to invent paths for playlist entries whose catalog path is no longer available.
- No modal stacks, large animations, or new navigation in this phase.

## Verification

- Parser tests cover comments, BOMs, blank lines, UTF-8 names, POSIX paths, Windows drive and UNC paths, relative paths, duplicate lines, CRLF, invalid UTF-8, NULs, excessive bytes, lines, and path lengths.
- Resolver tests cover enabled roots, playlist-relative fallback, unavailable catalog rows, existing unmatched files, missing files, duplicate preservation, and path-redacted errors.
- Import tests prove expiring bounded plans, issue paging, token validation, name conflicts, atomic playlist creation, exact order, and no partial mutation on failure.
- Export tests cover UTF-8, POSIX and Windows separators, relative/absolute path selection, unavailable-entry summaries, exact order, and atomic replacement.
- Typed frontend command tests, the complete pre-push gate, release app/DMG packaging, security/identity checks, and bundle portability are green.

## Acceptance criteria

- Import inspection performs no catalog or playlist mutation.
- The renderer receives no selected absolute path and cannot cause Jukebox to read or write an arbitrary path.
- Applying an import creates either the complete matched manual playlist or nothing.
- Duplicate tracks and source order survive import and export.
- Every response and retained plan is explicitly bounded.
- Unresolved and unavailable entries are reviewable and never silently discarded.

## Stop conditions

- Stop if a renderer-provided path crosses a read/write command boundary.
- Stop if import or export requires loading the full catalog into renderer memory.
- Stop if a failed import can leave a partially created playlist.
- Stop if an error includes a selected absolute path.
