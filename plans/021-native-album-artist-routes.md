# Native album and artist routes

## Status

DONE on branch `codex/021-native-album-artist-ui`.

## Objective

Move the album grid and three-column artist browser onto the bounded native catalog contracts without changing Jukebox's compact interaction model.

## Scope

1. Add a reusable offset pager that retains at most five 100-item aggregate pages.
2. Restart aggregate paging when catalog revisions change between requests.
3. Render album and artist virtual lists from sparse native pages.
4. Load exact artist albums and exact album tracks as the user changes selection.
5. Keep keyboard navigation and double-click playback behavior.
6. Load a full filtered playback selection only after an explicit play action.
7. React to search, sort, and completed library refreshes without legacy full-catalog work.

## Non-goals

- No route redesign or decorative motion.
- No storage-tree migration; that requires a separate lazy path contract.
- No background preloading of complete artist or album track lists.
- No removal of the compatibility catalog used by storage and explicit import flows.

## Safety and performance invariants

- Route startup requests at most one bounded page per active column.
- Sparse page retention remains capped at 500 aggregate summaries and 500 track summaries per pager.
- Raw artist and album values are used for exact filters; normalized labels are display-only.
- Mixed catalog revisions are discarded and restarted from the first page.
- User-specific paths and unrelated service names never enter source, fixtures, or UI.

## Verification

- aggregate pager unit tests, including direct ranges, retention, and revision restart
- explicit playback-selection paging test
- full frontend formatting, lint, typecheck, unit, and production build gates
- full Rust formatting, strict Clippy, and unit gates inherited from the stacked base
- macOS application bundle and installed-app smoke test after merge

The development Tauri smoke test verified native artist selection, exact album and track drill-down, cross-column search, and the album card grid against the local catalog.

## Delivery

This PR targets the Phase 020 aggregate-contract branch as a stacked child. After its base merges, it will be retargeted to `master`, revalidated, and merged independently.
