# 052 — Navigation, command, and import foundation

Status: DONE

## Objective

Replace the bare global menu with a compact Library Index, make keyboard control derive from one command registry, establish distinct Listen and Songs destinations, and turn Import Music into a complete reviewable workspace rather than an immediate folder-picker action.

## Scope

1. Define scoped navigation tokens and a restrained active playhead treatment using the existing steel-blue app accent.
2. Group global destinations by user intent, keep library status visible, and use consistent custom line icons.
3. Centralize global route metadata and shortcut labels so navigation, keyboard dispatch, and shortcut help cannot drift.
4. Preserve plain-key list and playback controls while using Shift plus memorable letters for a small set of global destinations.
5. Move the song table to `/songs/` and make `/` a compact local-first Listen workspace.
6. Add `/import/` with folder selection, drag-and-drop feedback, progress, completion summaries, bounded error disclosure, and links to Songs and library settings.
7. Remove the global Shift+I picker side effect; Shift+I must navigate to the Import Music workspace.

## Verification

- Cover the command registry, shortcut matching, route activity, and import presentation helpers with unit tests.
- Run formatting, public-source, identity, desktop-security, frontend tests, production build, Rust gates, packaging, and bundle portability.
- Use Computer Use to verify navigation hierarchy, active states, keyboard routing, focus visibility, Listen, Import Music, drag/drop messaging, and non-overlap with the player drawer.

## STOP conditions

- Stop if a global shortcut fires while the user is typing or holding an unrelated modifier.
- Stop if importing bypasses the existing bounded native path classification and library importer.
- Stop if the Listen page loads an unbounded catalog into renderer memory.
- Stop if route migration breaks metadata links, search, or browser back/forward behavior.
- Stop if styling introduces large animation, gradients, or colors outside scoped variables.

## Outcome

- Replaced the flat menu with a compact Library Index, custom line icons, scoped steel-blue tokens, active-route treatment, track count, and library status.
- Centralized page destinations and shortcut metadata so the sidebar, keyboard dispatcher, and shortcut help share one registry.
- Established `/` as a bounded Listen workspace and moved the complete song table to `/songs/` without breaking persistent search or player metadata links.
- Added a dedicated `/import/` workspace with folder selection, native drag-and-drop classification, progress, completion summaries, and bounded issue disclosure. Shift+I now navigates to this workspace instead of opening a system picker.
- Verified formatting, public-source portability, identity/security gates, 128 frontend tests, production frontend and Rust builds, macOS app and DMG packaging, and bundle portability.
- Verified the installed macOS app with Computer Use: layout hierarchy, player coexistence, Shift+L/Shift+I navigation, `/` search focus, typing guards, and `?`/Escape shortcut help all behaved as intended.
