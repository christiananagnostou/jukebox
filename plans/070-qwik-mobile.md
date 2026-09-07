# Qwik mobile migration

Preserve the existing mobile layout, read-only HTTP API, device-local queue,
offline downloads, and desktop behavior. No new runtime server or public release.

## Incremental checkpoints

1. Extract typed, framework-independent library and audio controllers. Reuse the
   existing bounded queue/session/cache modules; add stale-result and teardown tests.
2. Render all browsing, metadata, queue, feedback, and player controls with Qwik.
   Keep a single audio element outside view changes. A small synchronous native
   gesture bridge starts audio without waiting for a lazily loaded event handler.
3. Statically render the shell at build time, externalize generated executable
   scripts to retain the strict CSP, embed an allowlisted asset table in Rust,
   and precache every Qwik chunk needed for offline navigation.
4. Remove the legacy renderer after parity checks. Run unit, compiled-browser,
   Rust/API, packaging, and portability checks, then update the installed host.

## Acceptance gates

- Albums-first browsing, exact compilation drill-down, search, paging and back.
- One audio element and uninterrupted playback during all navigation.
- Main and mini transports, automatic advance, queue edits, restoration,
  media-session actions, scrubbing, sheet gestures and reduced motion.
- Offline saved audio and byte-range seeks; all UI chunks available offline.
- Late requests/errors cannot overwrite current navigation/playback state.
- Controllers release listeners/media handlers on disposal.
- No native IPC in mobile output and no builder paths in the packaged app.

## Implementation

The typed controllers, Qwik components, static shell build, embedded asset router,
and service-worker chunk cache are implemented. The legacy manual renderer and
HTML shell are removed. Existing queue/session storage and offline audio formats
remain compatible; the mobile runtime does not require Node or native IPC.

Regression coverage includes stale responses, compilation browsing, audio
ownership, session restoration, teardown, reactive metadata, cache upgrades, and
compiled Chromium/WebKit playback and offline reloads. CI runs the compiled mobile
suite in the Web job and builds embedded assets before every Rust test/build job.

Physical iPhone background/lock-screen behavior remains a real-device check;
desktop WebKit coverage does not claim to substitute for iOS lifecycle testing.
