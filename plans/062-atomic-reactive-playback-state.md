# Plan 062: Atomic reactive playback state

## Status

DONE

## Outcome

Keep the current track, artist, album, source, context, queue, and transport metadata coherent as playback changes, while making reactive projections explicit and regression-testable.

## Evidence

- Native-app QA reproduced a split view: audio and the persisted native playback session advanced to Enya's “It's In The Rain,” while the playback drawer remained on Andreas Vollenweider's “Morning At Boma Park.”
- The persisted native snapshot and library row contained the correct current track, artist, and album. The defect was isolated to renderer projections captured as non-reactive component locals.
- Playback state was also spread across four mutable store branches, allowing a newly requested source/context to appear before the native transition committed.

## Scope

- Replace fragmented playback renderer fields with one typed playback view projected from an authoritative native snapshot and resolved track metadata.
- Commit structural current-track metadata, source, context, queue, and native selection together after a transition succeeds; retain the previous coherent view while a transition is pending or rejected.
- Keep rapidly changing transport fields reactive without rebuilding unrelated metadata.
- Replace component-setup aliases of changing store or prop values with computed projections across affected playback, navigation, collection, import, settings, and virtual-list surfaces.
- Keep the native playback protocol, database schema, remote API, and supported audio formats unchanged.

## Verification

- Unit tests for empty, playing, queued, and stopped playback-view projections.
- Controller regression proving artist, album, context, and source remain coherent before and after an asynchronous track transition.
- Rendered Qwik regression proving the drawer's title, artist, album, and upcoming track all update together.
- Full frontend and Rust pre-push gates, desktop package build, bundle-portability scan, and native macOS Computer Use QA.

## Delivered

- One stable `PlaybackViewState` owns current metadata, context, source, queue, and transport projections instead of four independently mutable store branches.
- Native transition commits resolve the complete next view and synchronously update the stable Qwik proxy, keeping optimized production subscribers live while batching one coherent render.
- Pending and rejected transitions retain the prior current track, source, context, and queue.
- Live media duration survives a native commit with a zero-duration snapshot and remains synchronized during time updates.
- Playback, navigation, collections, playlists, import, settings, breadcrumbs, and virtual-list projections no longer cache changing store values during component setup.
- The test suite runs optimized Qwik transforms and includes pure projection, controller, event-binding, and actual rendered-drawer regressions.

## Done criteria

- [x] A track change cannot leave the drawer on the prior track's artist or album.
- [x] A pending or rejected native transition cannot publish a mismatched context or source.
- [x] Upcoming rows use the committed context selection without an invalid index sentinel.
- [x] Reactive component projections do not capture changing store or prop values at setup.
- [x] The full local release gate and packaged-app portability scan pass.
