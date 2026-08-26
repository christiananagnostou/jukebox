# Playlists, queue, and listening history

## Objective

Add durable collection management and a predictable editable queue without compromising local-first simplicity or library performance.

## Current state and evidence

- `store.playlist` and `store.queue` in `src/App.d.ts` are ephemeral track arrays.
- `src/components/audio-sidebar/queue.tsx` displays either manual queued tracks or a calculated five-track window, but offers no remove, reorder, clear, save, or undo behavior.
- There is no playlist schema, smart collection model, play history, recently added/played view, or M3U import/export.
- Queue semantics are spread across `useAudioPlayer.tsx`, keyboard shortcuts, and double-click handlers.

## Scope

1. Persist the queue and playback context.
2. Add manual playlists with ordering and multi-select actions.
3. Add constrained, indexed smart playlists.
4. Add listening history and useful built-in collections.
5. Import/export interoperable M3U/M3U8 playlists.
6. Make queue actions reversible and keyboard complete.

## Non-goals

- No social/collaborative playlists.
- No cloud synchronization in the first version.
- No recommendation service or opaque machine-learning ranking.
- No animated drag choreography; reorder feedback should be immediate and restrained.

## Data model

- `playlists(id, name, kind, created_at, updated_at, sort_order)` where kind is manual or smart.
- `playlist_entries(id, playlist_id, song_id, position, added_at)` with stable entry IDs so duplicate songs are allowed.
- `smart_playlist_rules(playlist_id, version, rule_json)` using a validated versioned rule grammar compiled to parameterized SQL.
- `queue_entries(id, song_id, source_context, position, added_at)` plus playback-session cursor/revision shared with plan 003.
- `play_history(id, song_id, started_at, completed_at, listened_ms, source_context)` with retention settings.
- Foreign-key behavior must preserve collection intent when a track becomes unavailable; show unavailable entries and allow relinking/removal.

## Implementation plan

### 1. Define one queue contract

- Move queue ownership into the playback state machine from plan 003, or introduce the same command/event contract first if plan 004 lands earlier.
- Commands: play now, play next, add to end, remove entries, move entries, clear upcoming, replace queue from context, and undo last structural edit.
- Preserve duplicate entries and identify queue items by entry ID rather than song ID.
- Persist structural edits transactionally and emit one revised snapshot.

### 2. Add playlist repository and commands

- Add migrations from plan 001 and repository methods in the native library/database layer.
- Commands: create, rename, duplicate, delete with confirmation, list, page entries, add/remove/move entries, and replace contents.
- Enforce unique display names case-insensitively while using immutable IDs internally.
- Use fractional/order keys or batched position rewrites so large reorders do not update every row unnecessarily.

### 3. Add multi-select collection actions

- Add selection-by-ID to library and album/artist views without storing selected row objects.
- Provide a compact action surface for play now, play next, queue, add to playlist, reveal file, and remove from library.
- Implement shift-range, command/control toggle, select all within current query, and Escape clear. Virtualized/offscreen selection must remain correct.
- Add a playlist destination chooser optimized for keyboard use and recent destinations.

### 4. Implement smart playlists

- Define a small rule grammar for text, artist, album, genre, year, favorite, date added, last played, play count, duration, codec, sample rate, availability, and root.
- Support all/any rule groups, a result limit, and an indexed sort. Reject recursive or unbounded arbitrary SQL.
- Compile rules in Rust to parameterized query fragments shared with plan 002's `TrackQuery`.
- Ship useful editable defaults: Favorites, Recently Added, Recently Played, Never Played, and Missing.

### 5. Capture meaningful history

- Record a start when playback actually begins, not when a row is clicked.
- Mark completion based on a documented threshold such as 50% or four minutes, with special handling for short tracks. Store listened milliseconds for auditability.
- Batch retention cleanup and let users disable history or clear it independently of the library.
- Expose play count/last played as optional sortable fields and smart-playlist rules.

### 6. Add M3U interoperability

- Import UTF-8 M3U/M3U8 with relative and absolute paths. Resolve against known roots first and retain unresolved entries for review.
- Export manual playlist order using paths appropriate to a selected base directory.
- Provide a dry-run summary for duplicates, missing files, and unmatched paths before mutation.

### 7. Build the collection UI

- Add `/playlists/` with a compact list/sidebar and virtualized entries, plus built-in smart collections.
- Make the existing queue panel editable with remove, move to top/bottom, clear upcoming, save as playlist, and undo.
- Show source context (“Album: …”, “Playlist: …”) and the exact distinction between upcoming context and explicitly queued tracks.
- Keep confirmation inline for destructive actions and avoid modal stacks.

## Verification

- Repository tests for duplicates, ordering, transaction rollback, unavailable songs, playlist deletion, and migration.
- State-machine tests for every queue command, queue/current cursor changes, and undo boundaries.
- Smart-rule golden tests comparing compiled queries with fixture results and injection attempts.
- Import/export round trips on POSIX and Windows paths with Unicode names.
- UI tests for multi-select across virtualized pages and complete keyboard-only playlist creation/editing.

## Acceptance criteria

- Queue and current context survive restart without duplicating or losing entries.
- Users can create, rename, reorder, populate, duplicate, and delete playlists entirely by keyboard.
- Smart playlists update from indexed library/history data without client-side full-library filtering.
- M3U imports disclose unresolved entries and exports preserve order.
- Unavailable tracks remain explainable and repairable rather than silently disappearing from collections.

## Rollout and rollback

- Land schema/repository first, then read-only playlist UI, then mutations, then smart rules/history.
- Version smart-rule JSON and retain a migration path for every version.
- Back up playlist/session tables before destructive schema migration; library rebuild must never drop them.
