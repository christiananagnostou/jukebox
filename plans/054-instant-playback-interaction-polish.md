# Plan 054: Instant playback interaction polish

## Status

DONE

## Outcome

Make track activation feel immediate across the desktop app while simplifying visual hierarchy and consolidating form and disclosure styling.

## Delivered

- Replaced the transition-time early return with a latest-selection-wins scheduler. Structural transport events remain deduplicated, while rapid direct track choices retain the newest intent.
- Added `playTracks` as the shared context activation boundary so callers no longer mutate the global playlist before the native transition accepts it.
- Added unit coverage for rapid selections, superseded intermediate choices, and the final authoritative context.
- Removed playback-driven global row disabling from Listen, library collections, smart playlists, manual playlists, and the upcoming drawer.
- Removed ornamental page eyebrows, the redundant Continue listening panel, and the passive Library ready strip.
- Unified playlist and smart-playlist controls with one blue, tokenized form style.
- Promoted global search into a larger library-focused control with direct Songs routing, clear action, icon, and `/` shortcut hint.
- Made track details and both playlist groups full-row disclosure controls.

## Verification

- `npm run fmt.check`
- `npm run lint`
- `npm run build.types`
- `npx vitest run`
- `npm run check:public-source`
- `npm run build`
- `npm run check:rust`
- `npm run tauri build`
- `npm run check:bundle-portability -- src-tauri/target/release/Jukebox src-tauri/target/release/bundle`
- Native macOS Computer Use QA for search, disclosures, playlist forms, and rapid playback selection
