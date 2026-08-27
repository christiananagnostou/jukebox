# Quality, security, and release foundation

## Objective

Make future Jukebox development safe to ship by replacing implicit runtime setup with migrations, adding behavioral coverage and diagnostics, tightening Tauri exposure, and producing reproducible cross-platform releases.

## Current state and evidence

- Planned against commit `aea10ca4c4c6d01d5d7716d873fde4ef49ae70c0`.
- `src/services/library-db.ts` creates the `songs` table at runtime and has no schema version or migration history.
- Coverage is limited to six utility tests in `src/utils/Files.test.ts` and `src/utils/Songs.test.ts`; there are no Rust tests or tests for import, playback, settings, database failure, or recovery.
- `src-tauri/tauri.conf.json` has `csp: null`, asset protocol scope `['**']`, an identifier ending in `.app`, a `DeveloperTool` bundle category, and no signing/updater configuration.
- `src-tauri/capabilities/default.json` grants recursive home-directory read and metadata access to the frontend.
- CI builds Ubuntu and macOS but not Windows, and does not run `cargo test`, `cargo clippy`, an audit check, or artifact smoke checks.
- Operational errors are reduced to strings in the footer or dialogs; there is no structured local log for import or playback failures.
- Public source and packaged-bundle portability checks now reject developer home, checkout, toolchain, and temporary paths. Release builds remap those paths before Rust compilation so distributable binaries do not expose the build machine layout.

## Scope

1. Introduce versioned SQLite migrations and migration tests.
2. Add unit, integration, and desktop-command test seams.
3. Add structured, privacy-conscious local diagnostics.
4. Tighten CSP, filesystem, SQL, and asset-protocol exposure.
5. Correct app identity and bundle metadata with a local-data migration.
6. Expand CI and define a signed/updateable release path.

## Non-goals

- No library scanner rewrite; that is plan 002.
- No playback engine replacement; that is plan 003.
- No telemetry upload or mandatory account.
- No visual redesign or animation work.

## Implementation plan

### 1. Establish migration ownership

- Add `src-tauri/src/database.rs` as the single source for the database URL, connection initialization, and migration registration.
- Add ordered SQL files under `src-tauri/migrations/`, beginning with an idempotent representation of the current `songs` schema.
- Register migrations in `src-tauri/src/main.rs` before the SQL plugin is built. Use the migration facility provided by `tauri-plugin-sql`; do not keep `CREATE TABLE` copies in TypeScript.
- Remove `CREATE_SONGS_TABLE` from `src/services/library-db.ts` after migration initialization is proven on an empty and an existing database.
- Add a schema version table or use the plugin migration ledger. Migration failure must stop library mutation and surface an actionable error.

### 2. Create test seams

- Split pure import mapping from Qwik closures in `src/hooks/useLibraryImporter.ts` into `src/services/library-import.ts`. Inject metadata and filesystem adapters so tests can model unreadable files, duplicates, partial failures, and preserved favorites.
- Wrap `HTMLAudioElement` behind a small `AudioTransport` interface in `src/services/audio-transport.ts`; exercise ended/error/sleep-like state transitions without a real WebView.
- Add database integration tests using a temporary SQLite file for load, upsert, favorite update, delete, clear, and every migration.
- Add Rust unit tests beside `metadata.rs`, `settings.rs`, and the new database module. Use temporary directories and fixture files; never write to the real application data directory.
- Add a minimal Tauri command-contract suite that checks camelCase settings serialization and recoverable poisoned/missing-state paths.

### 3. Add diagnostics

- Add `src-tauri/src/diagnostics.rs` with rotating local logs, level filtering, and redaction helpers. Log path basenames or stable hashes by default, not full personal music paths.
- Give imports and scans an operation ID. Log start, counts, elapsed time, failure categories, and completion; keep per-track logs at debug level.
- Add a Settings action that opens the log directory and a “Copy diagnostics summary” action containing app version, OS, schema version, and recent categorized errors.
- Preserve current user-facing errors, but map backend errors to typed codes so UI text is stable and testable.

### 4. Tighten the Tauri boundary

- Add a non-null CSP in `src-tauri/tauri.conf.json` limited to local assets and the Tauri asset protocol. Verify album art and audio URLs under the production bundle.
- Replace the global asset protocol `['**']` scope with application-cache and approved library-root scopes. Because library roots are chosen at runtime, extend scope only after explicit folder selection and revoke roots when removed.
- Remove frontend recursive-home filesystem permission after scan and existence checks move behind commands. Until plan 002 completes, narrow permissions to user-selected roots where Tauri runtime scopes allow it.
- Review SQL permissions and expose only required statements or move database mutation behind commands as plan 002 proceeds.
- Add negative tests showing an unapproved path cannot be scanned or exposed through `convertFileSrc`.

### 5. Correct identity without losing user data

- Select a reverse-DNS identifier that does not end in `.app`, update the bundle category to `Music`, and fill in descriptions/copyright in `src-tauri/tauri.conf.json` and `src-tauri/Cargo.toml`.
- Before changing the identifier, add a one-time startup migration that detects the old application-data location and moves/copies the database, settings, and art cache safely. Record a marker only after validation succeeds.
- Add fixture tests for fresh install, successful migration, partially copied data, and restart after migration.

### 6. Raise CI and release quality

- Add `cargo test --locked`, `cargo clippy --locked --all-targets -- -D warnings`, and a Windows Tauri build to `.github/workflows/ci.yml`.
- Keep source and bundle portability checks in CI. Build release artifacts through the repository Tauri wrapper so compiler diagnostics and metadata use generic remapped paths.
- Add dependency review and scheduled Rust/npm audit jobs. Keep the current known Qwik build-chain advisory documented until an upstream-compatible release exists; do not force a framework downgrade.
- Add a release workflow that builds signed artifacts for macOS, Windows, and Linux, attaches checksums/SBOMs, and only publishes after artifact launch/install smoke checks.
- Add the Tauri updater only after signing keys are managed outside the repository and rollback behavior is documented.

## Verification

- Migrate a copy of a pre-plan database and confirm song/favorite counts and artwork paths are unchanged.
- Start with an empty data directory and confirm first-run schema/settings creation.
- Run `npm test`, `npm run lint`, `npm run build.types`, `npm run build`, `cargo test --locked`, `cargo clippy --locked --all-targets -- -D warnings`, and all three desktop bundles.
- Attempt access to an unapproved file and assert denial.
- Install an old-identifier build, import music, then upgrade and confirm data is retained.

## Acceptance criteria

- Schema changes can only occur through reviewed, reversible migrations.
- Critical import, persistence, settings, and playback-state paths have automated failure tests.
- Production CSP and runtime scopes no longer grant blanket filesystem/asset access.
- User data survives the identifier correction.
- CI is green on macOS, Windows, and Linux and release artifacts are reproducible and signed.
- Distributed source and binaries contain no developer-specific paths or unrelated project references.

## Rollout and rollback

- Land migrations and tests before permission changes.
- Ship identity/data migration in one release while retaining read-only fallback to the old location for one additional release.
- Gate updater rollout behind a release channel. A failed update must leave the prior signed artifact runnable.
