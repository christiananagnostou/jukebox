# Plan 055: Add exact, bounded artist and album workspaces

> **Executor instructions**: Follow this plan step by step. Run every verification command and confirm the expected result before moving to the next step. If a STOP condition occurs, stop and report instead of improvising. When done, update this plan and its row in `plans/README.md` to `DONE`.
>
> **Drift check (run first)**: `git diff --stat 091a8b6..HEAD -- src/services/library-client.ts src/routes/artists src/routes/albums src/components/library src/global.css`
> If these files changed, compare the current-state excerpts below with the live code. Stop if the bounded pager or exact-query contracts no longer match.

## Status

- **Priority**: P1
- **Status**: IN PROGRESS
- **Effort**: M
- **Risk**: MED
- **Depends on**: plan 054
- **Category**: direction, accessibility, performance
- **Planned at**: commit `091a8b6`, 2026-08-30

## Why this matters

Artist and album names currently route by mutating the global search term. That produces a fuzzy filtered browse view rather than a stable destination for the exact entity the user selected. Jukebox already has exact artist/album filters, bounded native pages, virtualized rows, and exact playback-context loading, so focused detail workspaces are an adjacent, high-value improvement with no need for a new unbounded catalog API.

This plan establishes exact URL-addressable artist and album destinations. Plan 056 adopts those destinations throughout the app after their contracts and behavior are independently testable.

## Current state

- `src/components/audio-sidebar/playback-link.tsx:18-25` accepts an `href` plus `searchTerm`, writes `store.searchTerm`, and navigates to a generic route. The URL does not identify the selected artist or album.
- `src/routes/artists/index.tsx:42-118` composes `AggregatePager` and `LibraryPager` into a bounded three-column browser. Exact track queries already use `{ artist, album, direction: 'asc', q, sort: 'track' }`.
- `src/services/library-client.ts:26-41` defines `TrackQuery` with exact `artist` and `album` filters. `LibraryPager` owns five-page retention and stale-generation rejection; do not replace or bypass it.
- `src/services/library-client.ts:291-297` exposes bounded native artist and album aggregate queries. `AggregateQuery.artist` is already exact.
- `src/routes/albums/index.tsx:91-108` uses `loadTrackSelection` for bounded album playback, preserving the existing native query and playback boundary.
- `src/global.css` defines `--app-accent-*`, `--app-focus-ring`, shared form controls, and playback-link focus treatment. Reuse these variables; do not add a new color system.
- Product constraints from `plans/005-fast-accessible-interface.md`: track-first, keyboard complete, exact artist/album reachability, stable virtualized geometry, restrained motion, and no hero presentation.

## Commands you will need

| Purpose                | Command                                                      | Expected on success                    |
| ---------------------- | ------------------------------------------------------------ | -------------------------------------- |
| Focused frontend tests | `npm test -- --run src/services/library-destination.test.ts` | all new destination tests pass         |
| Frontend suite         | `npm test`                                                   | all tests pass                         |
| Format                 | `npm run fmt.check`                                          | exit 0                                 |
| Lint                   | `npm run lint`                                               | exit 0                                 |
| Types                  | `npm run build.types`                                        | exit 0                                 |
| Build                  | `npm run build`                                              | both client and static SSR builds pass |
| Public portability     | `npm run check:public-source`                                | exit 0, no private paths or hostnames  |
| Full local gate        | `npm run pre-push`                                           | every frontend and Rust gate passes    |

## Suggested executor toolkit

- Use `frontend-design` for the compact detail hierarchy and `computer-use:computer-use` for packaged native acceptance.
- Keep Qwik browser-only setup in `useVisibleTask$`; use `useTask$` only for reactive query changes.
- Model pager lifecycle and generation handling on `src/routes/artists/index.tsx` and `src/services/library-client.test.ts`.

## Scope

**In scope**:

- `src/services/library-destination.ts` (create)
- `src/services/library-destination.test.ts` (create)
- `src/components/library/FocusedCollectionView.tsx` (create)
- `src/routes/artists/view/index.tsx` (create)
- `src/routes/albums/view/index.tsx` (create)
- `src/global.css`
- `plans/055-focused-artist-album-workspaces.md`
- `plans/README.md`

**Out of scope**:

- Existing callers of `PlaybackLink`, library rows, playlist rows, smart/built-in collections, queue rows, and album cards; plan 056 migrates them.
- New Rust commands, schema changes, full-catalog state, renderer SQL, or filesystem access.
- Editing `src/routes/artists/index.tsx` or `src/routes/albums/index.tsx` except if the build requires a route-local export with no behavior change. If broader edits are required, stop.
- Recommendations, biographies, online metadata, lyrics, hero art, animated backgrounds, or route transitions.
- A new global keyboard shortcut; exact entity links use standard Enter/Space link behavior.

## Git workflow

- Branch from current `master` as `codex/055-focused-entity-workspaces`.
- Keep one focused implementation commit, matching recent history: `feat: add focused artist and album workspaces`.
- Open the PR against `master`. Do not merge until Web, Tauri macOS, and Tauri Ubuntu pass on the exact head.

## Steps

### Step 1: Define exact, bounded destination contracts

Create `src/services/library-destination.ts` with a discriminated union:

```ts
export type LibraryDestination = { kind: 'artist'; artist: string } | { kind: 'album'; artist: string; album: string }
```

Add pure functions that:

- normalize values with `trim()` only for validation while preserving the exact original catalog value used by native equality filters;
- reject empty artist/album values and any value over the native 1,024-character exact-filter bound;
- produce `/artists/view/?artist=...` and `/albums/view/?artist=...&album=...` using `URLSearchParams`, never manual string concatenation;
- parse a `URLSearchParams` value back into a valid destination or return `undefined`;
- produce the exact `TrackQuery` base used by a focused collection: `direction: 'asc'`, empty `q`, `sort: 'default'` for artists and `sort: 'track'` for albums.

Do not store these destinations in global Qwik state. The URL is the durable selection contract.

Create `src/services/library-destination.test.ts` and cover Unicode, spaces, ampersands, slashes, question marks, repeated query keys, empty values, overlong values, round trips, exact-value preservation, and artist-vs-album query shapes.

**Verify**: `npm test -- --run src/services/library-destination.test.ts` → all new tests pass.

### Step 2: Build one DRY focused collection component

Create `src/components/library/FocusedCollectionView.tsx`. It must accept one validated `LibraryDestination` and render both kinds through one implementation.

Required behavior:

- Own a route-local `LibraryCatalogState`, `LibraryPager`, and observed refresh key. Retain the existing 100-row page size and five-page cap.
- Reset the pager from the exact query returned by `library-destination.ts`. Do not copy pager logic or retain a complete collection.
- Render a compact header with entity kind, exact name, loaded/total track count, and a primary Play action. Album headers link to their exact artist destination.
- Use the first available page item for album art and existing `MusicNote` fallback; keep artwork compact and avoid a hero layout.
- Render the collection through `VirtualList`. Each row exposes title as the playback action, track/disc number when available, duration, and favorite/playing state only when those semantics already exist cleanly. Do not add inert metadata columns merely to fill space.
- Play a selected row through `loadTrackSelection(exactQuery)` and `storeActions.playTracks`. Preserve the selected duplicate occurrence when possible; use track ID plus occurrence, not a global `findIndex` that collapses duplicates.
- Show distinct invalid-link, loading, empty, unavailable, and path-free failure states. Invalid links provide a normal Qwik `Link` back to Artists or Albums.
- Add stable focus-visible treatment using existing app CSS variables. Every link and play action must work by keyboard without a custom key handler.
- Reload on catalog refresh without resetting the URL or global footer search.

Keep the component under roughly 300 lines. Extract pure formatting/query helpers to `library-destination.ts`; do not create a second artist/album implementation.

**Verify**: `npm run build.types && npm run lint` → exit 0 with no errors.

### Step 3: Add static route wrappers

Create:

- `src/routes/artists/view/index.tsx`
- `src/routes/albums/view/index.tsx`

Each wrapper reads `useLocation().url.searchParams`, parses the expected destination, and passes it to `FocusedCollectionView`. It must not mirror query parameters into `store.searchTerm`. Add focused document titles/descriptions that remain generic at static-build time.

The static Qwik build must include both routes. Confirm the generated output contains `artists/view/index.html` and `albums/view/index.html`; do not use runtime-dynamic filesystem route segments for local metadata.

**Verify**: `npm run build && test -f dist/artists/view/index.html && test -f dist/albums/view/index.html` → build passes and both files exist.

### Step 4: Verify the independent foundation

Run the full gate and native acceptance before plan 056 changes existing surfaces.

Computer Use acceptance on the packaged app must cover direct URL navigation to Unicode metadata, refresh/back/forward persistence, keyboard traversal, bounded scrolling, invalid query recovery, and no navigation/player overlap. Verify playback only when the user-controlled music-folder permission is available; otherwise verify the path-free recovery state and report audible output as unverified.

**Verify**: `npm run pre-push` → all gates pass.

## Test plan

- `src/services/library-destination.test.ts` follows the pure-contract style in `src/services/app-commands.test.ts` and query-shape assertions in `src/services/library-client.test.ts`.
- At least 12 destination tests cover validation, exact encoding/parsing, query shapes, and hostile-but-valid local metadata characters.
- Existing `src/services/library-client.test.ts` continues proving page retention and stale-generation rejection.
- The production build is the route-generation integration test; Computer Use covers focus, URL persistence, geometry, and packaged navigation.

## Done criteria

- [ ] Exact artist and album URLs round-trip without using global search state.
- [ ] Both focused routes are statically generated and use one shared component.
- [ ] Tracks remain paged with at most five retained 100-row pages.
- [ ] Playback uses exact native filters and the shared `playTracks` boundary.
- [ ] Invalid or unavailable entities fail path-free with a useful route back.
- [ ] Frontend suite, build, public-source check, and full pre-push gate pass.
- [ ] No file outside the in-scope list changed apart from ignored build artifacts.
- [ ] Packaged native QA results are recorded honestly in the PR.

## STOP conditions

- Exact navigation requires loading or scanning the complete catalog in the renderer.
- A focused route needs a new filesystem permission or path-bearing command.
- The implementation needs dynamic route segments derived from local metadata.
- Artist/album equality semantics diverge from existing native query values.
- Playback requires bypassing the user-owned music-folder picker.
- A full gate fails twice after a reasonable correction.

## Maintenance notes

- `library-destination.ts` is the only URL contract for local artist/album identities. Plan 056 and future search results must reuse it.
- Review duplicate handling, Unicode URL round trips, and pager cleanup closely.
- Unified cross-type search remains separate; this plan creates exact destinations it can target later.
