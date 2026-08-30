# 050 — Playback workspace foundation

Status: DONE

## Objective

Turn the fixed audio sidebar into a compact playback workspace by exposing the authoritative persisted playback modes, improving now-playing hierarchy, and making queue actions calmer without changing playback transition semantics.

## Scope

1. Mirror native mute, volume, repeat, and shuffle state into the renderer and apply restored volume state to the browser audio transport.
2. Add typed actions for mute, bounded volume, repeat mode, and deterministic native shuffle commands.
3. Give the sidebar a 320px playback-deck layout with clearer artwork, title, artist, album, progress, transport, and mode hierarchy.
4. Add current-track favorite editing through the existing validated native catalog command.
5. Move technical metadata behind a native disclosure and add an actionable playback retry state.
6. Distinguish manually queued entries from context-derived upcoming tracks, show durations, bound rendering, and move row actions behind compact disclosure controls.
7. Keep keyboard focus visible, expose pressed states, preserve exact queue-entry identity, and add no large or decorative animation.

## Safety rules

- Native playback state remains authoritative; renderer controls never mutate mode state optimistically.
- Volume is clamped to 0–100 before dispatch and restored snapshots set both renderer state and the actual audio element.
- Queue edits continue to use stable queue-entry IDs and preserve the existing one-step native undo contract.
- Favorite failures remain local and actionable and cannot interrupt playback.
- The sidebar never overlays navigation or route content.
- No output-device selection, lyrics, drag choreography, playlist mutation, native decoder/output choice, or new persistence schema is introduced.

## Verification

- Frontend controller tests cover restored and changed mute, volume, repeat, and shuffle state, including zero-volume mute behavior.
- Run Prettier, strict TypeScript, ESLint, all frontend tests, the production frontend build, the complete Rust gate, and the Tauri bundle.
- Use Computer Use on the live and packaged app to verify layout, artwork, favorite state, progress, play/pause, shuffle, repeat, mute, volume, details disclosure, queue presentation, and non-overlap.

## Acceptance criteria

- Restored volume, mute, repeat, and shuffle state is visible and controls the real audio transport.
- Mode buttons have clear active states and accessible labels.
- Essential track identity and transport controls are visible before technical metadata.
- Manual queue rows are visually distinct from inherited context and retain duplicate-safe controls.
- Playback failures offer an in-place retry action.
- The full local and CI quality gates pass before merge.

## STOP conditions

- Stop if a renderer control would bypass the native playback revision contract.
- Stop if a volume change cannot be applied without creating two playback authorities.
- Stop if queue presentation requires identifying an entry by track ID.
- Stop if responsive behavior would reintroduce content overlap.

## Outcome

- The packaged sidebar is now a compact 320px playback workspace with app-native progress and volume controls, clear track hierarchy, persistent mute/repeat/shuffle/volume state, favorite editing, retryable errors, and disclosed technical metadata.
- Manual queue entries are visually distinct from source-derived continuation, retain duplicate-safe entry actions, and render through a bounded list.
- Playback continuation identifies its source as an album, artist, playlist, collection, folder, or library. Restored sessions recover a useful album or artist label from the playback context.
- Album art, title, artist, album, continuation source, and queue artists link to focused library views with restrained hover and keyboard-focus treatment.
- The final frontend gate passes 124 tests across 21 files, strict TypeScript, ESLint, Prettier, production Qwik output, the complete Rust gate, and macOS app/DMG packaging.
- Computer Use verified the installed layout, non-overlap, custom control styling, full volume range, mute/shuffle/repeat transitions and restoration, technical disclosure, and context-aware filtered navigation. Direct audio access still correctly requests a music-folder reconnect when macOS withholds the saved folder; QA did not bypass the private picker.
