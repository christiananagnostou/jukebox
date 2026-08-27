# Plan 027: Add bounded mobile library browsing

Status: DONE on branch `codex/027-mobile-library-browsing`.

## Problem

The private PWA exposes only one flat track page. It cannot browse artists or albums, request continuation pages, or control adjacent tracks from iPhone lock-screen media controls. Stream containment also still relies on the legacy single-folder setting even though the native library supports multiple enabled roots.

## Scope

1. Authorize a stream through its opaque track ID and persisted enabled native root, retaining the legacy folder only for unowned compatibility rows.
2. Add bounded read-only artist and album endpoints backed by the shared native aggregate service.
3. Extend track requests with exact artist/album filters while preserving the existing array response and cursor headers.
4. Add compact Tracks, Albums, and Artists views to the PWA with explicit drill-down and Load more controls.
5. Add current-track presentation plus Media Session play, pause, previous, and next handlers over the loaded selection.
6. Keep the shell origin-scoped, read-only, motion-light, path-free, and excluded from API caching.

## Safety rules

- Requests never accept filesystem paths or root identifiers.
- Remote JSON never exposes source, root, or cached-art paths.
- Disabled, missing, rootless-outside-fallback, and out-of-root tracks fail as not found.
- Aggregate and track queries retain existing length and page-size bounds.
- No public binding, Funnel support, write API, large animation, or machine-specific assumption is introduced.

## Verification

- Router tests cover aggregate bounds, exact drill-down, response path redaction, native multi-root streaming, disabled-root denial, legacy fallback, ranges, and stale cursors.
- Static contract tests cover navigation, continuation, Media Session handlers, CSP, and shell-only service-worker caching.
- Run all frontend/Rust/static/build/bundle gates and live loopback PWA smoke checks.

## STOP conditions

- Stop if native-root authorization requires accepting a client-supplied path or root ID.
- Stop if aggregate responses would expose `visualsPath` or another local path.
- Stop if continuation requires unbounded DOM or catalog retention.
