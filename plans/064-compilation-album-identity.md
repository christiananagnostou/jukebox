# Plan 064: Preserve compilation album identity

## Status

DONE

## Outcome

Present explicitly tagged compilation releases as complete albums without weakening artist-scoped identity for ordinary albums, and keep the shared `/` search shortcut on the current page.

## Scope

- Group compilation albums by their exact album title across track-level artist credits.
- Keep non-compilation albums scoped by exact artist and title so unrelated same-named albums remain distinct.
- Let compilation album links and playback load the complete album without an artist filter.
- Make `/` focus the shared search field without route navigation or stealing input while the user is already typing.
- Cover aggregate identity, exact destination parsing, and shortcut eligibility with deterministic unit tests.

## Done criteria

- [x] Known compilation albums appear once with their complete track counts.
- [x] Opening or playing a compilation includes every track in disc/track order.
- [x] Ordinary same-named albums by different artists remain distinct.
- [x] `/` focuses search without changing the current route.
- [x] Full frontend and Rust quality gates pass, followed by installed macOS QA.

## Verification

- `npm run pre-push` passed with 209 frontend tests and 191 active Rust/integration tests.
- The app-only macOS release bundle built successfully and passed bundle-portability checks before and after installation.
- Installed native QA kept `/` search on `/albums/` and showed one complete card each for `Disneyland Park Official Album (c) 2001` (17 tracks), `Remember The Titans` (12 tracks), and `Supernatural` (13 tracks).
- The installed now-playing drawer resolves compilation album links without a track-artist filter, so every metadata entry point opens the complete album.
