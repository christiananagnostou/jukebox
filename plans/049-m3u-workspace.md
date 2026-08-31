# Compact M3U import and export workspace

Status: DONE — verified on `091a8b6` (2026-08-30)

## Objective

Expose the safe native M3U/M3U8 foundation through a compact review-first playlist workflow without returning selected filesystem paths to the renderer or silently discarding unresolved entries.

## Scope

1. Add a visible playlist import action that invokes only the native open-dialog command and treats picker cancellation as a no-op.
2. Present the opaque dry-run preview with total, matched, duplicate, unavailable, missing, ambiguous, and unmatched counts before mutation.
3. Load redacted issue rows through a token-scoped virtual pager with 100-row requests, five-page retention, stale-selection cancellation, and path-free failures.
4. Let users edit the suggested playlist name, apply matched entries atomically, or explicitly discard the pending plan.
5. Discard an abandoned token when the review closes, another collection is selected, or the component unmounts.
6. Select the newly imported manual playlist and report skipped entries after a successful apply.
7. Add a manual-playlist-only export action that invokes the native save dialog and reports exported and skipped-unavailable counts without receiving the destination path.
8. Keep all states keyboard accessible, visible, bounded, and free of modal stacks or decorative motion.

## Non-goals

- No renderer-provided source or destination path, filesystem plugin access, directory crawling, automatic import, cloud sync, or remote playlist mutation.
- No silent apply, unresolved-entry guessing, smart-playlist export, whole-catalog load, or whole-issue-list load.
- No custom file picker, drag-and-drop, modal stack, or large animation.

## Verification

- Client tests prove picker commands accept no paths and export accepts only a stable manual playlist ID.
- Pager tests cover bounds, five-page retention, superseded tokens, visible-page reload, discard behavior, and path-free errors.
- Workflow-model tests cover count summaries, name bounds, apply eligibility, skipped-entry math, and issue labels.
- Route tests or typed selection guards prove export is unavailable to smart and built-in collections.
- The complete pre-push gate, release app/DMG packaging, identity/security checks, and bundle portability remain green.
- Computer Use verifies picker cancellation, preview presentation, issue scrolling, apply/discard, manual export, keyboard focus, and error feedback after the private folder picker is dismissed.

## Acceptance criteria

- Import never mutates a playlist until the preview is explicitly applied.
- Every unresolved or unavailable entry is counted and reviewable through bounded redacted pages.
- Leaving a review invalidates its opaque native plan.
- A successful import selects exactly the new manual playlist and reports any skipped entries.
- Export is offered only for a selected manual playlist and reports unavailable entries it skipped.
- No selected native path crosses the Tauri command response or request boundary.

## Stop conditions

- Stop if the renderer receives or submits a selected source or destination path.
- Stop if changing selection can leave a usable abandoned import token indefinitely.
- Stop if import can apply without the dry-run review or if failures can create a partial playlist.
- Stop if issue review loads more than one bounded page per request.
