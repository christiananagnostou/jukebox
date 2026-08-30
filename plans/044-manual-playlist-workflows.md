# 044 — Manual playlist workflows

Status: ACTIVE

## Outcome

Complete the core manual-playlist lifecycle with duplicate-preserving cloning and keyboard-operable entry reordering, while keeping database work transactional and bounded.

## Scope

- Duplicate a named manual playlist into an explicitly named destination.
- Preserve entry order, duplicate tracks, missing-track snapshots, and stable source data while generating new playlist and entry identities.
- Reject conflicting or invalid names without leaving a partial destination.
- Move one playlist entry up or down in constant database work without loading adjacent pages into the renderer.
- Treat first-row Up and last-row Down as successful no-ops.
- Keep controls compact, focusable, and motion-free.

## Bounds and invariants

- A manual playlist contains at most 100,000 entries.
- Mutation batches remain limited to 500 track or entry identifiers.
- Duplication reads and writes fixed-size chunks inside one transaction.
- Entry positions remain unique, non-negative, and deterministically ordered after every successful mutation.

## Verification

- Rust repository tests cover duplicate tracks, missing snapshots, exact ordering, name conflicts, bounds, no-op moves, and rollback.
- Frontend client tests verify compact camelCase command payloads.
- Lint, strict types, formatting, production build, Rust tests, Clippy, security, source portability, identity, and release bundle checks pass.
- Native Computer Use QA follows when the user-controlled macOS folder picker is no longer covering Jukebox.

## Evidence

- 82 frontend tests pass with lint, strict types, formatting, and the production client/SSR build.
- 164 Rust tests pass with one opt-in benchmark ignored; all three decoder fixtures pass.
- Repository coverage includes the 500-entry duplication chunk boundary and an injected mid-copy database failure.
- Clippy, public-source portability, desktop security, app identity, release app/DMG, and bundle portability checks pass.
