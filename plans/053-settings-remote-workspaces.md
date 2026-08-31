# 053 — Settings and remote-listening workspaces

Status: DONE

## Objective

Replace the long mixed-purpose Settings page with focused destinations, and make private remote listening a first-class workspace that explains state and actions without exposing implementation details or interfering with existing private routes.

## Scope

1. Turn `/settings/` into an overview that routes to General, Library, and Privacy & diagnostics sections.
2. Move window behavior into `/settings/general/`.
3. Move folder registration, refresh state, and local catalog cleanup into `/settings/library/` while preserving the native bounded refresh pipeline.
4. Move listening-history controls and privacy-safe diagnostics into `/settings/privacy/`.
5. Move private server and Tailscale Serve controls into `/remote/`, with explicit two-step status and start/stop actions.
6. Add Remote listening to the Tools navigation and shared keyboard command registry as Shift+R.
7. Keep switches, progress, focus, and status treatments custom, restrained, blue-themed, and variable-driven.

## Verification

- Run formatting, public-source, frontend tests, typecheck, lint, production build, Rust gates, packaging, and bundle portability.
- Use Computer Use to verify Settings section routing, Shift+R, remote status and controls, Import-to-Library-settings routing, focus visibility, and player-drawer coexistence.
- Do not start or stop a private route during QA unless the current state requires no security-sensitive network change.

## STOP conditions

- Stop if route extraction changes settings persistence, library refresh, catalog cleanup, listening-history, or diagnostics command contracts.
- Stop if Remote listening can replace or stop a Tailscale route not managed by Jukebox.
- Stop if a route shortcut fires while typing or requires a second source of command metadata.
- Stop if repository content includes a developer path, hostname, tailnet, or unrelated application name.
- Stop if styling introduces large motion, native-looking mismatched controls, or non-token accent colors.

## Outcome

- Replaced the monolithic Settings page with an overview and focused General, Library, and Privacy & diagnostics routes.
- Promoted Remote listening to `/remote/` with a two-step local-player/private-HTTPS status model and preserved the existing ownership-safe Tailscale commands.
- Added Remote listening to the shared Tools navigation and keyboard registry as Shift+R; shortcut help derives from the same metadata.
- Moved Import's folder-management link directly to Library settings and retained existing settings persistence, refresh, cleanup, history, and diagnostics contracts.
- Verified all routes in the installed macOS app with Computer Use without opening private pickers, destructive confirmations, diagnostics folders, or changing live network state.
- Passed frontend tests, typecheck, lint, production static generation, macOS app and DMG packaging, public-source portability, and bundle portability.
