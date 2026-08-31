# 043 — Reversible queue edits

Status: DONE — verified on `091a8b6` (2026-08-30)

## Outcome

Give every structural queue edit one authoritative, session-local undo without weakening queue identity, persistence, or transition rollback guarantees.

## Scope

- Keep one previous queue in the native playback machine after enqueue, remove, move, or clear.
- Replace the previous undo only when a structural edit actually changes the queue.
- Invalidate undo when playback advances or replaces the active context.
- Restore undo state when a prepared playback transition is rejected.
- Expose compact Undo affordance and retain only the renderer metadata required for that one step.
- Persist only committed playback state; never persist the session-local undo buffer.

## Verification

- Rust state-machine tests cover exact duplicate/order restoration, replacement, invalidation, no-op behavior, persistence, and transition rollback.
- Frontend tests cover native command shape and song-metadata restoration.
- Lint, types, production build, Rust tests, Clippy, package/security checks, and bundle verification pass.
- Native installed-app QA verifies the queue control with Computer Use when the library picker is available to the user.

## Evidence

- 129 frontend tests pass on current `master`.
- 183 Rust tests pass with one opt-in benchmark ignored; all three decoder fixtures pass.
- Clippy, public-source portability, desktop security, identity, release bundle, and bundle portability checks pass.
- Subsequent packaged-app Computer Use acceptance covered queue controls and playback-workspace coexistence without taking ownership of the user-controlled macOS folder picker.
