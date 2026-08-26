# Remove renderer full-catalog compatibility

## Status

DONE on branch `codex/024-remove-legacy-catalog`.

## Objective

Finish the bounded-catalog migration by removing the renderer's dormant complete-library compatibility state and moving the final direct database mutation behind the native command boundary.

## Scope

1. Remove the renderer-wide legacy catalog, its derived filtered array, and all load, merge, filter, and sort helpers that only supported those arrays.
2. Keep explicit single-file imports bounded by writing metadata through the native upsert command and refreshing the paged catalog.
3. Preserve user-owned play position, favorite rating, and original import date when an existing track is reimported.
4. Add a native favorite-rating command with input validation and missing-track handling.
5. Remove the frontend SQL package and the main window's SQL execution permissions while retaining the Rust plugin for startup migrations.
6. Surface favorite-write failures in the existing application error area instead of allowing an unhandled async rejection.

## Non-goals

- No schema migration or replacement of the Rust migration runner.
- No visual redesign, animation, or new settings.
- No user-specific path, hostname, service, or unrelated application reference.
- No changes to the native paging limits or query semantics delivered by plans 011-023.

## Safety and performance invariants

- Normal startup, search, sorting, route navigation, imports, and favorite changes never materialize the complete catalog in renderer memory.
- Reimport updates current file metadata without destroying existing user state.
- Favorite ratings accept only the three supported values and report a stale selection cleanly.
- The webview cannot execute arbitrary SQL.
- Runtime-selected paths remain local user data and are never embedded as tracked defaults or documentation examples.

## Verification

- native upsert preservation and favorite mutation tests
- frontend command-wrapper and explicit-import tests
- complete frontend and Rust test suites
- Prettier, ESLint, strict TypeScript, strict Clippy, and production Qwik build
- application-only desktop bundle
- repository scan for removed legacy APIs, frontend SQL access, user-specific paths, and unrelated application references

## Delivery

Branch directly from the merged `master`, open one focused PR, and merge only after the web, macOS, and Ubuntu required checks pass on the exact head commit.
