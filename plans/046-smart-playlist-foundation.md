# Smart playlist foundation

Status: DONE

## Objective

Add a durable, bounded, native smart-playlist contract whose versioned rules are validated in Rust and compiled only to parameterized SQLite queries.

## Scope

1. Persist one versioned rule document for every smart playlist without changing manual-playlist behavior.
2. Support an `all` or `any` rule group over text, artist, album, genre, year, favorite rating, date added, last played, play count, duration, codec, sample rate, availability, and library root.
3. Support field-appropriate operators, an explicit result cap, and deterministic indexed sorting.
4. Create, read, update, and delete smart playlists transactionally through typed Tauri commands.
5. Return bounded smart-playlist pages with catalog/history revisions and playback-ready track summaries.
6. Reject unknown versions, invalid field/operator/value combinations, oversized documents, excessive rules, recursive structures, arbitrary SQL, and unsupported page ranges before database work.
7. Keep renderer memory bounded and expose a typed frontend client for the later compact editor UI.

## Non-goals

- No smart-playlist editor UI in this phase.
- No nested/recursive groups, user-authored SQL, recommendations, cloud rules, or background materialization.
- No large animations or renderer-side full-library filtering.
- No changes to manual playlist entry ordering or unavailable-entry preservation.

## Verification

- Migration tests prove manual playlists remain intact and smart rules cascade only with their owning playlist.
- Golden fixture tests cover every field and operator, `all`/`any`, deterministic ordering, result caps, paging, catalog/history revisions, and unavailable tracks.
- Adversarial tests reject injection-shaped strings, invalid combinations, unknown versions, excessive rules, oversized values, and invalid page bounds.
- Query-plan tests prove representative favorite, date-added, availability, root, and history paths retain usable indexes.
- Frontend command-shape tests, formatting, lint, strict types, production build, complete Rust tests, strict Clippy, and the local pre-push gate pass.

## Acceptance criteria

- Stored rule JSON is canonical, versioned, bounded, and validated again before every query.
- Every page contains at most 100 tracks, respects the smart playlist's result cap, and never loads the full catalog into TypeScript.
- SQL structure is selected only from Rust enums; user values cross the database boundary only as binds.
- Catalog or history changes alter the returned revision.
- Manual playlist behavior and existing user data remain unchanged.

## Stop conditions

- Stop if any user-controlled SQL fragment is concatenated into a query.
- Stop if querying requires a full-catalog renderer load or an unbounded native result.
- Stop if the migration rewrites or drops manual playlist data.
- Stop if history aggregation can block or mutate playback history.

## Completion evidence

- Migration and lifecycle tests prove manual playlists remain intact, smart-rule ownership is enforced, create/update operations are transactional, and deleting a smart playlist cascades only its rule document.
- Native golden tests cover every supported field, every operator family, both match modes, all eleven sorts in both directions, result caps, paging, catalog/history/rule revisions, unavailable tracks, literal wildcard escaping, injection-shaped values, invalid documents, and stored-rule revalidation.
- Representative query plans retain the availability, root, favorite, date-added, and history indexes.
- The full local gate passes with 84 frontend tests, 173 Rust unit tests plus all three decoder fixtures, strict TypeScript, ESLint, rustfmt, strict Clippy, production client/SSR output, identity, desktop-security, and public-source checks.
- The release binary, macOS app, and DMG build successfully; the app and DMG pass bundle-portability verification.
