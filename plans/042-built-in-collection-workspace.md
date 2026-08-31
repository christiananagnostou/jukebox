# Built-in collection workspace

Status: DONE — verified on `091a8b6` (2026-08-30)

## Objective

Surface Recently Played, Most Played, and Never Played inside the existing compact Playlists workspace without retaining the full catalog or adding navigation and motion clutter.

## Current state

- The Playlists route has bounded virtualized manual-playlist and entry panes.
- Native built-in collection pages are bounded, revision-aware, playable-only, and benchmarked against 100,000 tracks.
- There is no renderer state, pager, or interface for those collections.

## Scope

1. Add a dedicated bounded collection pager that retains at most five 100-item pages and restarts on revision changes.
2. Place three keyboard-focusable built-in choices above manual playlists in the existing sidebar.
3. Render collection tracks in a compact virtualized table with title, artist, album, completed plays, and last-played context.
4. Play from only the currently loaded native page so playback context remains bounded and deterministic.
5. Keep manual playlist create, rename, delete, add, remove, and playback behavior unchanged.
6. Provide clear loading, empty, stale-revision, and path-free error states.

## Non-goals

- No new top-level route, editable smart rules, history export, bulk selection, recommendations, charts, or animation.
- No client-side sorting or full-library aggregation.
- No mutation of built-in collections.

## Verification

- Pager tests cover bounds, retained-page eviction, revision restart, failures, item lookup, and page-local playback context.
- Route/type tests prove the native kind values and compact labels remain stable.
- Frontend formatting, lint, strict types, complete tests, production build, desktop security, exact app packaging, source portability, and bundle portability pass.
- Computer Use verifies sidebar selection, virtual rows, playback, empty/error presentation, layout, keyboard focus, and coexistence with manual playlists after the existing private folder picker is confirmed by the user.

## Acceptance criteria

- The renderer retains no more than 500 built-in collection tracks.
- Selecting a built-in collection cannot clear or mutate manual playlists or the persistent queue.
- Playback begins at the selected row within its native page and never constructs an unbounded context.
- Built-in collections are visibly read-only and do not expose rename, delete, or add-current controls.
- The workspace remains usable without hover and contains no large animation.

## Stop conditions

- Stop if collection rendering needs full-catalog state.
- Stop if switching built-in collections can issue manual-playlist mutations.
- Stop if the sidebar or track table reintroduces content overlap at supported desktop sizes.
