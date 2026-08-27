# Durable playlist repository foundation

Status: DONE (2026-08-27)

## Objective

Establish a native, transactional manual-playlist repository that preserves duplicate entries and collection intent when catalog tracks become unavailable or are removed.

## Current state

- Playback context and explicit queue entries persist, but users cannot create named collections.
- The catalog intentionally retains unavailable scanned tracks, while explicit library deletion can remove rows entirely.
- Native catalog commands already use bounded validated payloads and one managed SQLite pool.
- No renderer-owned playlist state or schema exists.

## Scope

1. Add versioned `playlists` and `playlist_entries` tables with immutable opaque IDs, case-insensitive unique display names, timestamps, stable positions, and cascade-on-playlist-delete behavior.
2. Store bounded title/artist/album snapshots on entries and deliberately avoid a destructive song foreign key so collection intent remains explainable after catalog deletion.
3. Add native create, list, rename, delete, batch-add, page-entries, and batch-remove repository operations.
4. Preserve duplicate songs by addressing every playlist row through its stable entry ID.
5. Validate all names, IDs, page sizes, offsets, and batch sizes before database work; make every multi-row mutation transactional.
6. Expose typed Tauri commands and a small frontend client without adding UI state.

## Non-goals

- No entry reordering, playlist duplication, smart rules, history, M3U interchange, multi-select UI, or remote mutation API.
- No renderer-side full-playlist loading or direct SQL access.
- No visual changes or animations.

## Verification

- Migration tests prove existing catalog/session data remains intact and playlist constraints are present.
- Repository tests cover unique names, normalization, duplicate songs, stable entry IDs/order, pagination, atomic failure, removal, rename, deletion, and missing-track snapshots.
- Command/client tests prove bounded camelCase payloads and path-free typed errors.
- Run formatting, public-source, packaging, security, lint, strict types, frontend tests/build, Rust tests, strict Clippy, macOS app packaging, and bundle portability.

## Acceptance criteria

- Duplicate songs coexist in one playlist and can be removed independently by entry ID.
- A failed item in a batch leaves the playlist unchanged.
- Deleting a catalog song does not delete or corrupt playlist intent; the paged entry remains with snapshot metadata and a `missing` availability state.
- Names are trimmed, bounded, nonempty, control-character-free, and unique case-insensitively.
- Reads and writes are bounded and use the managed native database pool.
- No private paths, machine-specific details, or large animations are introduced.

## Stop conditions

- Stop if deleting or rebuilding catalog rows can cascade-delete playlist entries.
- Stop if any batch mutation can partially commit.
- Stop if playlist reads require loading every entry into Rust or the renderer.

## Completion evidence

- Migration 0011 adds bounded playlist and entry tables while preserving duplicate songs, stable entry order, entry snapshots, and playlist-delete cascading without a catalog-song foreign key.
- Native repository and typed Tauri commands cover create, list, rename, delete, batch add, bounded entry pages, and batch removal with transactional failure semantics.
- A production catalog rehearsal preserved all 1,135 tracks and FTS rows, proved snapshot survival after catalog deletion, proved playlist-entry cascade deletion, rolled back without residue, and finished with SQLite integrity `ok`.
- Frontend verification passed with strict types, lint, a production build, and 64 tests across 13 files.
- Native verification passed with formatting, strict Clippy, 144 Rust tests plus one ignored performance test, and three decoder tests.
- The macOS application bundle built with the stable `com.jukebox.app` identity, Music category, desktop-security checks, public-source checks, and bundle-portability checks passing.
- Publication remains stacked behind plan 035's real installed-app playback gate; no playlist UI was added in this foundation phase.
