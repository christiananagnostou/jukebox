# Compact smart-playlist workspace

Status: DONE

## Objective

Turn the validated native smart-playlist rule engine into a compact, keyboard-accessible workspace that edits every supported rule and renders bounded live results without loading the catalog into frontend memory.

## Scope

1. Distinguish manual and smart playlist rows throughout the shared playlist workspace so smart selections never invoke manual-entry commands.
2. Add a visible `New smart playlist` action and an inline create/edit form with bounded name, match mode, rules, result limit, sort, and direction fields.
3. Support every native rule family: full-text search, artist, album, genre, codec, year, favorite, date added, last played, play count, duration, sample rate, availability, and library root.
4. Load enabled and unavailable library roots only to populate the local root-rule chooser; use a generalized `Imported tracks` option for rootless catalog rows.
5. Validate and normalize drafts before invoking native commands, including user-friendly duration seconds converted to native milliseconds.
6. Render result pages through a revision-aware virtual pager that retains at most five 100-track pages and discards stale async work after selection or rule changes.
7. Play a result in the context of its loaded page and preserve availability, play count, and last-played presentation.
8. Keep create, update, delete, error, empty, and confirmation states visible, path-free, and keyboard operable.

## Non-goals

- No free-form SQL or JSON editor, nested rule groups, recommendations, cloud sync, or remote smart-playlist mutation.
- No whole-catalog or whole-result renderer load.
- No drag-and-drop, modal stack, decorative transition, or large animation.
- No changes to manual playlist ordering, built-in collections, M3U behavior, or native rule semantics.

## Verification

- Pure draft tests cover defaults, every rule family, operator changes, bounds, date/value pairing, duration conversion, and round trips from stored definitions.
- Pager tests cover 100-row requests, five-page retention, revision changes, superseded selections, reloads, page-local playback, and path-free failures.
- Route integration tests or source-level contract tests prove smart rows cannot call manual entry commands.
- The complete pre-push gate, release app/DMG packaging, identity/security checks, and bundle portability are green.
- Computer Use verifies creation, editing, deletion, keyboard focus, virtual scrolling, playback, empty/error states, and coexistence with manual and built-in collections after the private folder picker is dismissed.

## Acceptance criteria

- A user can create, edit, play, and delete a smart playlist entirely from the Playlists route with a keyboard.
- Every rule emitted by the editor conforms to the versioned native grammar and every native rule can be represented by the editor.
- Smart results update from native catalog/history revisions without client-side full-library filtering.
- Manual playlist commands are unavailable for smart selections and manual workflows remain unchanged.
- The editor and result catalog retain explicitly bounded state.

## Stop conditions

- Stop if the editor accepts raw SQL, rule JSON, or arbitrary native paths.
- Stop if any smart result flow loads more than one bounded page per request.
- Stop if selecting a smart playlist can mutate manual entries.
- Stop if a rule supported by the native version-one grammar cannot round-trip through the editor.
