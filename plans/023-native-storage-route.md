# Native storage route

## Status

DONE on branch `codex/023-native-storage-route`.

## Objective

Move Storage from a renderer-built full-catalog tree to the bounded native hierarchy from plan 022, while preserving fast keyboard navigation and explicit folder or track playback.

## Scope

1. Replace the eager nested tree with one revision-aware, virtualized directory page.
2. Browse roots and immediate children through `query_storage` in pages of at most 100 nodes.
3. Keep at most five aggregate pages in renderer memory.
4. Add root and directory breadcrumbs, parent navigation, empty states, search, and sort direction.
5. Load a complete native track selection only after the user explicitly plays a root, directory, or track.
6. Preserve keyboard movement: `j` and `k` select, `h` goes up, `l` opens a container, and Enter plays the selection.
7. Remove the obsolete renderer-side file-tree model and helpers.

## Non-goals

- No filesystem traversal from the renderer.
- No eager complete-catalog load for Storage.
- No persistent disclosure of local paths; displayed paths come only from the current user's runtime-selected roots.
- No user-specific path, host, service, or unrelated application reference.
- No animation or decorative redesign.

## Safety and performance invariants

- Storage startup requests one bounded page instead of materializing every song and path segment in JavaScript.
- Search and sort changes reset the pager after a short debounce and ignore stale generations.
- Catalog revision changes restart from the first page rather than mixing snapshots.
- Folder navigation carries only a validated native root identifier and normalized relative path.
- Rootless explicit imports use the backend's query-only imported-files collection without inventing a local path.
- Qwik event handlers capture individual serializable QRLs so static generation and resumability remain valid.

## Verification

- exact native storage command payload test
- bounded storage paging and root/parent retention test
- exact root/path preservation across multi-page playback selection test
- case-insensitive supported file-extension tests
- complete frontend unit suite
- Prettier, ESLint, strict TypeScript, and production Qwik build
- complete Rust suite, strict Clippy, and application-only desktop bundle
- public-source scan for user-specific or unrelated references

## Delivery

This renderer change stacks on plan 022's backend PR. Merge the backend first, retarget this branch to `master`, rerun required checks on the exact rebased commit, and merge only when every required context is green.
