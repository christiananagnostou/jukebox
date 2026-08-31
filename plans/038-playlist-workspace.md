# Compact playlist workspace

Status: DONE — verified on `091a8b6` (2026-08-30)

## Objective

Turn the durable manual-playlist repository into a compact, keyboard-accessible desktop workspace without loading whole collections into renderer memory or introducing decorative motion.

## Current state

- Plan 037 provides bounded native playlist and entry pages plus transactional create, rename, delete, add, and remove commands.
- Playlist entries preserve duplicate songs and snapshot metadata after catalog deletion, but no route exposes them.
- Playback accepts bounded track-ID lists, although duplicate IDs currently collapse during native resolution.
- Library and aggregate views already use reusable virtual lists and retain only nearby pages.

## Scope

1. Add a `/playlists/` route and navigation shortcut with a compact two-pane layout.
2. Add bounded, virtualized playlist and entry pagers that retain only nearby pages and reject stale asynchronous results.
3. Support inline create, rename, and delete confirmation without modal stacks.
4. Let users add the current track, remove one stable entry at a time, and see unavailable or missing entries without losing their snapshots.
5. Play an available entry in the context of its currently loaded playlist page so normal previous/next controls remain useful without fetching an entire collection.
6. Preserve duplicate track IDs during native playback resolution and cover the behavior with a regression test.
7. Provide concise live status and path-free errors; all controls must be reachable and understandable by keyboard.

## Non-goals

- No drag reordering, multi-select, playlist duplication, smart rules, history, M3U interchange, or remote playlist mutation.
- No whole-playlist renderer load, unbounded query, modal confirmation stack, custom context menu, or large animation.
- No mobile playlist workflow in this phase.

## Verification

- Pager tests cover bounded page requests, page retention, generation changes, mutation reloads, and per-page playback context with duplicates and unavailable entries.
- Native regression tests prove playback resolution preserves requested duplicate IDs while filtering unavailable tracks.
- Frontend formatting, lint, strict types, tests, production build, public-source, app-identity, and desktop-security checks pass.
- Rust formatting, complete tests, strict Clippy, app packaging, and bundle portability pass.
- Computer Use verifies the installed route, keyboard flow, layout, playback controls, and relaunch state after the existing private folder-permission gate is confirmed by the user.

## Acceptance criteria

- Users can create, select, rename, delete, populate, inspect, play from, and remove entries from manual playlists using visible keyboard-focusable controls.
- Duplicate entries remain separately visible and removable by their immutable entry IDs.
- Missing and unavailable entries remain visible, labeled, and non-playable.
- Scrolling never requires loading every playlist or entry into the renderer.
- Playing an entry does not silently discard duplicate available entries in the same loaded page.
- No private paths, machine-specific details, or decorative animation are introduced.

## Stop conditions

- Stop if any UI mutation bypasses the native transactional repository.
- Stop if a route needs to retain every playlist entry or expose filesystem paths.
- Stop if deleting a playlist or entry can happen without an explicit visible user action.
