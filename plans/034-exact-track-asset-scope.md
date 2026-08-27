# Exact-track asset scope and production CSP

## Objective

Replace the global Tauri asset-protocol wildcard with exact catalog-track authorization plus app-owned artwork scope, and enable a production Content Security Policy without breaking browser audio, cached covers, imports, or development.

## Scope

1. Add a native playback-asset command that accepts only a bounded opaque track ID.
2. Resolve the current available catalog row, require an enabled native root when one owns the track, canonicalize the file/root, and authorize only the exact file in Tauri's runtime asset scope.
3. Preserve rootless explicit-file compatibility by authorizing only the canonical catalog-owned file.
4. Change the browser playback adapter to await native authorization before converting and loading the returned path.
5. Move folder selection behind a native picker command so the dialog plugin cannot implicitly add selected directories to renderer asset scope; remove `dialog:allow-open`.
6. Replace `assetProtocol.scope: ["**"]` with the content-addressed app-owned artwork directory.
7. Add production and development CSPs that allow only packaged/self resources, Tauri IPC, required asset URLs, inline styles needed by current Qwik layout, and development HMR where applicable.
8. Add a CI structural gate for the capability, CSP, and asset-scope invariants.
9. Replace overlapping fixed navigation/player positioning with a three-column application grid that reserves space for each surface.
10. Make library rows accessible single-click playback controls and correct the camel-case command boundary used by the browser/native playback state machine.

## Non-goals

- No native audio-output migration, decoder change, identifier/data migration, Windows CI, signing, or updater work.
- No removal of paths from catalog DTOs in this slice; the asset protocol rejects them until the exact native authorization succeeds.
- No redesign, visualizer, or large animation.

## Invariants

- A renderer-supplied filesystem path can never authorize playback.
- Track IDs are bounded opaque tokens; missing, unavailable, disabled-root, escaped-root, and non-file targets are rejected with path-free errors.
- Playback authorization adds one canonical file, never a directory or wildcard.
- Folder selection returns path strings through a bounded native command and does not mutate Tauri asset scope.
- The static asset scope contains only `$APPLOCALDATA/Jukebox/art/**`.
- Production CSP is non-null and denies plugins, framing, base-URL changes, and form submission.
- Production CSP permits same-origin route-data requests so packaged Qwik City navigation renders the selected page.
- Navigation, page content, and the optional player occupy separate grid columns at every playback state.

## Verification

- Rust tests cover enabled-root success, rootless explicit-file success, disabled roots, root escape, missing files, and invalid identifiers.
- Frontend tests cover awaited authorization, restored playback initialization, and transition rollback when authorization fails.
- Rust tests cover the camel-case playback-command payload used by the frontend.
- The desktop-security script rejects wildcard scope, missing CSP directives, unexpected capabilities, or absent native authorization wiring.
- Run formatting, public-source portability, desktop-security, lint, strict types, frontend tests/build, Rust tests, strict Clippy, application/DMG packaging, and bundle portability.
- Use Computer Use against the packaged macOS application to verify library activation, advancing playback time, pause/resume, track switching, navigation, artwork, and non-overlapping navigation/content/player layout.
- Smoke-test the installed release for CSP-clean startup, artwork, playback authorization, loopback remote access, and library refresh.

## Acceptance criteria

- Ordinary desktop playback still supports seeking and transitions through browser audio.
- A library row is a keyboard-accessible, single-click playback control.
- Album/sidebar artwork still loads from the app-owned cache.
- No global asset-protocol wildcard exists in source or packaged configuration.
- The renderer cannot invoke the dialog plugin's scope-expanding open command.
- Arbitrary or disabled-root catalog paths cannot be authorized.
- Packaged navigation renders the destination route without interrupting the persistent player.
- Opening the player never overlays the navigation or main page content.
- All required Web, macOS, and Ubuntu CI checks pass before merge.

## Rollout and rollback

- This changes no database schema, persisted settings, or cached artwork layout.
- Rollback restores the wildcard scope and synchronous path conversion, but also restores blanket asset access; use only if a supported platform cannot load exact-authorized media.

## Status

DONE
