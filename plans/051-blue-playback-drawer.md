# 051 — Blue playback drawer refinement

Status: DONE

## Objective

Align the playback drawer with Jukebox's steel-blue interface language, remove repeated interaction styling, and let a contextual upcoming row activate its exact playback occurrence on double-click.

## Scope

1. Define drawer color and interaction tokens as scoped CSS variables.
2. Replace amber drawer accents with the existing steel-blue app accent.
3. Consolidate focus, hover, link, mode, primary-control, queue-marker, and upcoming-row styles into reusable drawer classes.
4. Consolidate metadata navigation through one reusable playback link component.
5. Preserve exact context indices for upcoming selections, including duplicate track IDs.
6. Double-clicking an upcoming row starts that exact contextual occurrence through the authoritative playback action.

## Verification

- Cover wrapped, stale, and duplicate-ID upcoming context indices.
- Run formatting, TypeScript, ESLint, frontend tests, production build, Rust gates, and packaging.
- Use Computer Use to verify the blue palette, custom/native elements, row affordance, exact double-click transition, link navigation, and non-overlap.

## STOP conditions

- Stop if upcoming activation requires identifying a context entry by track ID alone.
- Stop if a row activation bypasses the native playback transition contract.
- Stop if styling introduces drawer-local hard-coded accent colors outside the scoped variable definitions.
- Stop if the interaction requires large animation or makes metadata links ambiguous.

## Outcome

- The drawer now derives its steel-blue controls, focus rings, range tracks, links, queue marker, and row hover state from scoped CSS variables.
- Repeated metadata navigation and interaction styling are consolidated into shared playback components and classes.
- Contextual upcoming rows activate their exact playlist occurrence on double-click, with Enter and Space equivalents and duplicate-ID coverage.
- Frontend, Rust, packaging, and native UI checks passed. Native playback activation reached the authoritative transition and safely rolled back when macOS required the existing music-folder permission to be reconnected.
