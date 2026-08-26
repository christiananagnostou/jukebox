# Fast, accessible, motion-light interface

## Objective

Turn the current functional shell into a top-tier desktop player interface: information-dense, clear at a glance, keyboard complete, accessible, and fast at every supported window size, without large or decorative animation.

## Current state and evidence

- The shell uses fixed 200 px navigation and 250 px player sidebars in `src/global.css` and `src/routes/layout.tsx`; narrow windows lose core content.
- Library rows are CSS grids built from generic elements, and route-specific cursor/keyboard logic is distributed across three hooks plus `useKeyboardShortcuts.ts`.
- `VirtualList.tsx` assumes fixed row heights and exposes no semantic grid/list metadata, focus model, page-up/down, or page cache integration.
- Artist and storage views use three fixed equal columns/tree indentation without empty states or contextual actions.
- Error/loading/import status is compressed into the footer; there is no consistent notice/toast/details pattern.
- Bundled Poppins font files are present but the global CSS uses the system stack.
- The sound-bars indicator honors reduced motion, but the broader interface still needs a unified motion policy and accessibility regression coverage.

## Scope

1. Define a compact design system and responsive desktop shell.
2. Centralize commands, keyboard bindings, focus, and selection.
3. Make virtualized library views semantically accessible.
4. Improve library, album, artist, storage, queue, and settings workflows.
5. Add consistent empty/loading/error/confirmation states.
6. Establish UI performance and accessibility regression checks.

## Non-goals

- No hero art, animated backgrounds, full-screen visualizer, or large page transitions.
- No visual imitation of a streaming service.
- No mobile-first layout; small desktop windows must still remain usable.
- No remote/social UI before the local-first core is complete.

## Design principles

- The track list is primary; chrome stays quiet and compact.
- Every visible control has a keyboard path, tooltip or label where needed, and a clear focus state.
- Motion is reserved for direct feedback, short, interruptible, and disabled under reduced motion.
- Technical metadata is available on demand without crowding default rows.
- Empty and error states explain the next useful action.

## Implementation plan

### 1. Establish tokens and primitives

- Replace scattered literal colors/sizes with semantic CSS variables for surfaces, borders, text levels, selection, focus, destructive actions, row height, and density.
- Decide whether to use bundled Poppins or the system stack; use one and remove unused font assets/declarations.
- Add primitives for button, icon button, field, notice, progress, inline confirmation, tooltip, empty state, split pane, and command menu under `src/components/ui/`.
- Remove unused font assets/declarations and extend the existing `prefers-reduced-motion` treatment to every nonessential transition.

### 2. Make the shell adaptive

- Refactor `src/routes/layout.tsx`, `src/components/nav.tsx`, and the player sidebar into a CSS grid with min/max constraints instead of margin offsets and fixed overlays.
- Provide compact/collapsed navigation at narrow widths and a toggleable now-playing inspector. Persist density/sidebar choices in settings.
- Keep transport controls available when the detail sidebar is closed, using a compact bottom/footer region rather than hiding playback state.
- Ensure every route can shrink without horizontal content loss; use deliberate horizontal scrolling only for the track grid.

### 3. Centralize commands and shortcuts

- Add a command registry describing ID, label, default shortcut, context predicate, and handler. Generate the shortcuts help UI from this registry.
- Route window key events through one normalized dispatcher. Ignore text fields appropriately, prevent browser defaults only for handled commands, and support remapping later.
- Add a compact command palette for navigation and actions. It should open instantly, filter locally over a small command list, and require no animation.
- Add focus restoration when dialogs/palette/inline confirmations close.

### 4. Build an accessible virtual track grid

- Extend `VirtualList.tsx` with semantic role/row count/row index, stable item keys, focus retention, page-up/down, home/end, and selection metadata.
- Make library headers and rows follow the ARIA grid pattern or use a native table-compatible virtualization approach validated with screen readers.
- Support resizable/reorderable columns, visible sort direction, optional columns, density, and persisted widths. Do not measure every row.
- Keep favorite and row activation as separate valid controls; verify there are no nested interactive elements.
- Add a context/details inspector for codec, sample rate, path, dates, and artwork rather than forcing all metadata into the default row.

### 5. Improve route workflows

- Library: multi-select, clear active query/filter chips, result count, empty import CTA, and reveal-in-file-manager action.
- Albums: deterministic cover sizing, missing-art fallback, album detail/drill-in, disc-aware track order, and no album collision across album artists.
- Artists: counts and optional album-artist handling, clear selected column, and useful empty states after filtering.
- Storage: disclose root boundaries, unavailable paths, folder counts, collapse-all/expand-selected, and avoid exposing raw platform root noise where it adds no value.
- Queue/player: editable upcoming list, visible repeat/shuffle/volume state, error/retry text, and compact output selector after plan 003.
- Settings: group by Playback, Library, Interface, and Advanced; keep dangerous actions isolated with consequences and inline confirmation.

### 6. Standardize asynchronous states

- Add an operation center model for imports/scans/cleanup with phase, counts, cancel/retry, elapsed time, and a short failure summary.
- Use the footer for compact active status and a details surface for full errors. Do not truncate the only error explanation.
- Add route-level skeletons only where data is genuinely delayed; prefer stable geometry and text status over shimmer animation.
- Every empty state should distinguish no library, no results, unavailable root, and operation failure.

### 7. Add regression checks and budgets

- Add a browser-mode Tauri adapter mock for UI tests. Cover navigation, search, sort, selection, queue actions, settings, import progress, and error states.
- Add accessibility checks and keyboard journey tests for every route. Manually validate VoiceOver, NVDA, and a Linux screen reader before release.
- Capture stable screenshots at wide, medium, and minimum supported window sizes in dark mode and reduced motion.
- Track initial JS size, largest route chunk, shell render time, query-to-visible-row latency, and long tasks in CI or a repeatable local benchmark.

## Performance budgets

- No route introduces a client chunk larger than the current largest shared chunk without explicit review.
- Search/command input updates visible results within one frame after data arrives from the native query service.
- Resizing does not install per-route native-window listeners or create sustained layout thrash.
- Background indicators do not update faster than users can perceive.

## Accessibility acceptance criteria

- All primary tasks—import, search, sort, play, queue, navigate, create playlist, clean library, change settings—work without a pointer.
- Focus is always visible and never lost when virtual rows recycle.
- Screen readers announce row position, selected/playing state, sort direction, progress, and actionable errors.
- Text and controls meet WCAG AA contrast and minimum target expectations appropriate to desktop density.
- Reduced-motion mode eliminates continuous SoundBars animation and all nonessential transitions.

## Product acceptance criteria

- The app remains usable at the documented minimum window size and makes better use of large windows.
- Users can reach albums/artists/paths from a track and return without losing query/selection state.
- Technical detail is available without making default views noisy.
- No large animations, visualizer, or decorative motion are introduced.

## Rollout and rollback

- Land tokens/primitives and command registry first, then shell, then one route at a time.
- Keep old route implementations behind short-lived local flags during semantic virtualizer validation.
- Screenshot and keyboard baselines must pass before removing a previous route implementation.
