# Mobile PWA player

Implemented a familiar mobile music interface using the desktop Jukebox palette.

- Bottom Songs, Albums, and Artists navigation with search and collection drill-down.
- Persistent mini-player with artwork, play/pause, next, and progress.
- Expanded Now Playing with artwork, previous/next, seeking, artist and album links, and queue management.
- Safe artwork endpoints return raster images from the artwork cache without exposing filesystem paths.
- Missing artwork falls back to the shared music icon. Error recovery remains available in Now Playing.
- Shell cache version 6 refreshes installed PWAs. Audio and artwork are not stored by the service worker.

## Verification

The actual DOM controls run in the frontend CI suite. Tests cover synchronized player state, next/previous, seeking, restart behavior, queue clearing, missing artwork, and compilation drill-down. Rust router tests cover artwork responses, missing tracks, out-of-cache paths, and invalid image bytes.

Browser QA covers Chromium and WebKit at 320, 390, and 1440 pixels. Browser transport tests use a simulated audio element; physical iPhone background playback remains device QA.
