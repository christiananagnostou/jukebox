# Plan 056: Make artist and album metadata directly navigable throughout Jukebox

> **Executor instructions**: Execute only after plan 055 is merged and marked `DONE`. Follow every step and verification gate. Stop on any STOP condition rather than weakening playback, accessibility, or bounded-memory behavior.
>
> **Drift check (run first)**: `git diff --stat 091a8b6..HEAD -- src/components/audio-sidebar src/components/library/LibraryRow.tsx src/components/playlists src/routes/albums/index.tsx src/routes/playlists/index.tsx src/global.css`
> Plan 055 is expected to add destination contracts and focused routes. Any other behavior change in these files must be reconciled before execution.

## Status

- **Priority**: P1
- **Status**: DONE
- **Effort**: M
- **Risk**: MED
- **Depends on**: plan 055
- **Category**: direction, accessibility, tech-debt
- **Planned at**: commit `091a8b6`, 2026-08-30

## Why this matters

Jukebox exposes artist and album metadata across the library, playlists, built-in collections, smart playlists, queue, and Now Playing, but most of it is inert text. The existing player links mutate a shared fuzzy search term, so they do not reliably reopen the exact entity. Plan 055 creates tested exact destinations; this plan adopts them consistently while preserving instant playback and avoiding invalid nested interactive elements.

## Current state

- `src/components/library/LibraryRow.tsx:63-112` makes the entire row a `role="button"` and nests the favorite button inside it. Artist and album cells are inert. Adding anchors inside this structure would create nested interactive semantics; the row must be decomposed first.
- `src/components/audio-sidebar/playback-link.tsx:18-25` writes `store.searchTerm` before navigation. Player and queue callers use this fuzzy side effect.
- `src/routes/albums/index.tsx:138-167` renders each album as one button whose double-click starts playback. It cannot safely contain artist/album links.
- `src/routes/playlists/index.tsx:740-758`, `src/components/playlists/SmartPlaylistView.tsx:609-627`, and `src/components/playlists/BuiltInCollectionView.tsx:124-139` use a title playback button plus inert artist/album cells.
- Plan 054 established instant `playTracks` activation and removed global row locking. This plan must not reintroduce busy-based disabling for ordinary track selection.

## Commands you will need

| Purpose           | Command                                                                                                                  | Expected on success              |
| ----------------- | ------------------------------------------------------------------------------------------------------------------------ | -------------------------------- |
| Destination tests | `npm test -- --run src/services/library-destination.test.ts`                                                             | all exact-link tests pass        |
| Frontend suite    | `npm test`                                                                                                               | all tests pass                   |
| Format/lint/types | `npm run fmt.check && npm run lint && npm run build.types`                                                               | exit 0                           |
| Full gate         | `npm run pre-push`                                                                                                       | all frontend and Rust gates pass |
| Package           | `npm run tauri build -- --bundles app`                                                                                   | packaged app succeeds            |
| Portability       | `npm run check:bundle-portability -- src-tauri/target/release/Jukebox src-tauri/target/release/bundle/macos/Jukebox.app` | exit 0                           |

## Scope

**In scope**:

- `src/services/library-destination.ts`
- `src/services/library-destination.test.ts`
- `src/components/library/MetadataLink.tsx` (create)
- `src/components/library/LibraryRow.tsx`
- `src/components/audio-sidebar/playback-link.tsx`
- `src/components/audio-sidebar/player.tsx`
- `src/components/audio-sidebar/queue.tsx`
- `src/components/playlists/BuiltInCollectionView.tsx`
- `src/components/playlists/SmartPlaylistView.tsx`
- `src/routes/playlists/index.tsx`
- `src/routes/albums/index.tsx`
- `src/global.css`
- `plans/056-adopt-metadata-deep-links.md`
- `plans/README.md`

**Out of scope**:

- New backend queries, schemas, remote endpoints, full-catalog state, or global search results.
- Making missing/blank metadata clickable, or linking codec/sample rate/year/duration.
- Turning every container into a link; playback, favorite, queue editing, and playlist mutation remain distinct controls.
- Context menus, hover-only actions, route animations, hero art, or external metadata lookup.

## Git workflow

- Branch `codex/056-metadata-deep-links` from the exact plan-055 branch/merge.
- Keep this independently reviewable as layer two of a two-PR stack.
- Commit message: `feat: link artist and album metadata throughout the app`.
- If opened before plan 055 merges, target plan 055. After the parent merges, retarget to `master`, re-check the diff, and wait for all required checks.

## Steps

### Step 1: Create one reusable metadata link

Create `src/components/library/MetadataLink.tsx` using Qwik City `Link` and the exact helpers from plan 055.

- Accept an artist or album destination, never raw `href` plus mutable `searchTerm`.
- Render no link for blank metadata; callers retain their normal fallback.
- Stop click and double-click propagation so a metadata link never starts playback.
- Use anchor keyboard semantics, concise labels, ellipsis, and shared `.metadata-link` styling.
- Derive hover/focus colors from `--app-accent-strong` and `--app-focus-ring`.

**Verify**: `npm test -- --run src/services/library-destination.test.ts` → all tests pass.

### Step 2: Remove fuzzy player navigation

Refactor `PlaybackLink` into a thin exact-destination wrapper or remove it if `MetadataLink` replaces every caller. It must no longer import `StoreContext` or mutate `store.searchTerm`.

Update player and queue so artist links target exact artist URLs, album links use both artist and album identity, and context links use exact destinations only when the context provides sufficient identity. Title remains a Songs search action until exact track routing exists. Queue double-click playback remains independent.

**Verify**: `rg -n "searchTerm=.*artist|searchTerm=.*album|store\.searchTerm" src/components/audio-sidebar` → no fuzzy artist/album navigation remains.

### Step 3: Make primary library rows semantically valid

Refactor `LibraryRow.tsx` so the outer grid is not a `role="button"` containing controls.

- Title becomes the explicit Play button with native Enter/Space semantics.
- Artist and album cells become `MetadataLink` when nonblank.
- Favorite remains independent.
- Preserve hover, playing state, cursor index, SoundBars, virtual positioning, instant `playTracks`, and diagnostic events.
- Do not add a second play target; one clear title action is enough.

**Verify**: `rg -n 'role="button"' src/components/library/LibraryRow.tsx` → no outer role-button; lint and types pass.

### Step 4: Adopt links across collection rows

In manual playlists, smart playlists, and built-in collections, retain title playback and replace nonblank artist/album cells with `MetadataLink`. Album identity always includes the exact artist. Missing snapshot metadata may link only when nonblank, and its destination must handle an unavailable collection usefully. Navigation must not inherit playback or mutation busy state.

**Verify**: inspect every visible `entry.artist`, `entry.album`, `item.track.artist`, and `item.track.album` occurrence; each is a shared link or intentional fallback.

### Step 5: Separate album navigation from playback

Refactor album cards so artwork/title opens the exact album workspace, artist opens the artist workspace, and one compact keyboard-visible Play button runs existing `playAlbum`. Preserve virtual sizing, fallback art, date, count, and bounded paging. Remove double-click-only playback as the sole discoverability path and avoid overlapping click layers.

**Verify**: `npm run build` → static build passes without serialization or interactive-content errors.

### Step 6: Run packaged interaction acceptance

Use Computer Use on the packaged app to verify Library playback versus artist/album navigation, favorite isolation, Now Playing and queue links, manual/smart/built-in collection links, album-card links, keyboard focus, back/forward persistence, playback continuity, and absence of global link disabling. Do not operate the private folder picker; report audible output as unverified if permission remains unavailable.

**Verify**: full pre-push, app-only packaging, and bundle portability all pass.

## Test plan

- Extend destination tests for every exact destination used by callers, including Unicode, blank fallbacks, and identical album names under different artists.
- Preserve the rapid-selection regression in `src/hooks/useAudioPlayer.test.ts` unchanged.
- Existing library, playlist, built-in, smart-playlist, and playback-client suites all pass.
- Computer Use covers focus order, event propagation, absence of accidental playback, and packaged navigation continuity.

## Done criteria

- [x] Every meaningful artist/album link uses one exact destination helper.
- [x] Player and queue artist/album navigation no longer mutates global search state.
- [x] Library rows contain no nested interactive controls and retain instant playback/favorite behavior.
- [x] Manual, smart, and built-in metadata links do not inherit playback busy state.
- [x] Album cards expose separate exact navigation and explicit playback.
- [x] Link journeys work by keyboard and preserve playback during navigation.
- [x] Frontend suite, full pre-push gate, app packaging, and portability pass.
- [x] No large animation, machine-specific content, raw path, or unrelated refactor is introduced.

## STOP conditions

- Correct links require fuzzy search or a complete-catalog scan.
- A parent row cannot be decomposed without broad playback or virtualizer changes.
- Exact album identity lacks the artist at a caller; do not guess.
- A link would create nested interactive content or a hover-only action.
- Busy-state changes would disable navigation or reintroduce global song locking.
- Packaged navigation loses playback state or exposes a local path.

## Maintenance notes

- Future unified search results must reuse `LibraryDestination` and `MetadataLink`.
- Review event propagation and semantic HTML more closely than styling; accidental playback from a metadata click is the primary regression risk.
- Track-ID, genre, and folder destinations remain separate decisions.
