# Stable app identity and nonblocking desktop playback

## Objective

Correct Jukebox's public package metadata, remove the obsolete renderer SQL surface, and move desktop audio file I/O off Tauri's macOS main thread without invalidating existing Music-folder privacy grants.

## Current state

- The established bundle identifier is `com.jukebox.app`. Changing it makes macOS treat the update as a different application and invalidates existing protected-folder grants.
- Bundle category and descriptions are placeholders, and Cargo package metadata is incomplete.
- Native SQLx owns catalog initialization and migrations; the renderer SQL plugin and preload are unused.
- Tauri's built-in asset protocol opens audio synchronously on the macOS UI thread. A protected, remote, or slow file can freeze the entire interface.
- Jukebox already has a tested asynchronous byte-range streamer for private mobile playback.

## Scope

1. Preserve the established bundle identifier until signing and an explicit permission-reconnect migration are designed.
2. Set accurate Music-category bundle metadata and Cargo package metadata.
3. Remove the unused Tauri SQL plugin and preload; keep native SQLx as the sole migration authority.
4. Start a desktop-only playback server on an ephemeral loopback port.
5. Require a random per-process URL token and revalidate every opaque track ID against the native catalog and enabled root before streaming.
6. Reuse the tested asynchronous HTTP range implementation so file opens and reads never block the UI thread.
7. Restore playback metadata without opening a media file until the user explicitly requests playback.

## Non-goals

- Do not change the bundle identifier, application data location, music-library files, or Tailscale state.
- Do not expose filesystem paths to the renderer or expand the static asset scope beyond cached artwork.
- Do not add signing, notarization, an updater, large animations, or a native decoder/output stack.

## Verification

- Static packaging checks enforce the stable identifier, Music category, complete metadata, native-only SQL migrations, ephemeral loopback binding, and random playback token.
- Frontend tests prove restored metadata is lazy, explicit Play loads and seeks, and authorization failures remain path-free.
- Rust tests prove exact-track/root authorization, token rejection, and byte-range responses.
- Run formatting, desktop security/public-source checks, lint, strict types, frontend tests/build, Rust tests, decoder integration, strict Clippy, macOS app/DMG packaging, and bundle portability.
- Use Computer Use on the packaged build to verify the real catalog, artwork, queue, responsive layout, Play/pause, advancing position, navigation, Settings, and restart persistence. Do not capture system audio.

## Acceptance criteria

- Existing installations retain their catalog, settings, artwork, and macOS Music-folder access.
- Starting or resuming a track cannot block Tauri's UI thread on filesystem I/O.
- Playback streams are loopback-only, unguessable across processes, exact-track authorized, ranged, and path-free.
- The renderer SQL plugin surface is gone and bundle/package metadata is accurate.
- No developer-specific paths, private project names, or large animations are introduced.

## Stop conditions

- Stop before publishing if a packaged update cannot read the existing library or advance real playback.
- Stop if desktop streaming binds a non-loopback address or accepts an invalid token/track/root.
- Stop if changing packaging identity would require the user to re-grant protected-folder access without an explicit migration UX.
