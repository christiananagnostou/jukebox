# Editable persistent queue

Status: ACTIVE

## Objective

Expose the existing persistent native queue as a predictable, duplicate-safe, keyboard-accessible editor without changing playback transition semantics.

## Current state

- Native playback state already persists stable queue entry IDs and supports enqueue, remove, move, and clear commands.
- The frontend mirrors queued tracks as plain songs, discarding entry identity and preventing safe edits when duplicates exist.
- The audio sidebar shows either explicit queued tracks or upcoming context, but gives users no distinction or controls.

## Scope

1. Preserve `{ entryId, song }` for explicit queue entries in renderer state.
2. Expose remove, move-before, and clear-upcoming actions through the playback controller and store action contract.
3. Keep all mutations serialized behind pending playback transitions and mirror only authoritative native snapshots.
4. Render explicit queue entries with compact Move up, Move down, Remove, and Clear controls.
5. Label calculated context separately as “Up next” and keep it read-only.
6. Keep duplicate songs independently editable through stable entry IDs and path-free failure messages.

## Non-goals

- No drag choreography, undo stack, save-as-playlist, batch selection, remote queue mutation, or history UI.
- No change to queue precedence, previous/next behavior, persistence schema, or transition rollback.

## Verification

- Controller tests cover restored duplicate entries, stable-ID removal, move-before ordering, clear, failure propagation, and authoritative mirroring.
- UI data-shape tests prove calculated context is never mistaken for the explicit queue.
- Frontend formatting, lint, strict types, complete tests, production build, and desktop security checks pass.
- Native complete tests and strict Clippy remain green; exact app packaging and bundle portability pass.
- Computer Use verifies the installed queue controls, playback continuity, layout, keyboard focus, and relaunch persistence after the existing private folder-permission gate is confirmed by the user.

## Acceptance criteria

- Duplicate queued songs can be moved or removed independently.
- A failed queue mutation does not optimistically change the visible queue.
- Clear removes only explicit upcoming entries and does not replace the active playback context.
- Context-derived upcoming tracks remain visibly distinct from explicitly queued tracks.
- Every mutation control is keyboard focusable, restrained, and free of large animation.

## Stop conditions

- Stop if renderer order can diverge from the authoritative native snapshot.
- Stop if any queue mutation identifies an entry by song ID.
- Stop if structural editing can run during an unresolved playback transition.
