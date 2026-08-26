# Plan 010: Make settings persistence atomic and bootstrap failures visible

> **Executor instructions**: Follow the plan exactly, run each verification, and stop on any STOP condition. Update `plans/README.md` when complete.
>
> **Drift check (run first)**: `git diff --stat 9cfcd61..HEAD -- src-tauri/src/settings.rs src-tauri/src/main.rs src-tauri/Cargo.toml src-tauri/Cargo.lock src/routes/layout.tsx src/routes/settings/index.tsx src/components/footer.tsx src/App.d.ts plans/README.md`
> Reconcile any changed in-scope code with the current-state excerpts before proceeding.

## Status

- **Priority**: P1
- **Effort**: M
- **Risk**: LOW
- **Depends on**: none
- **Category**: bug, tests, dx
- **Planned at**: commit `9cfcd61`, 2026-08-26

## Why this matters

Every settings read or JSON parse failure silently becomes defaults, and writes replace the live file directly. A truncated write can erase the music root and remote-access preference, while a database startup rejection leaves the shell looking empty. This plan preserves the last valid configuration and makes bootstrap failures actionable without introducing a full diagnostics subsystem.

## Current state

- `src-tauri/src/settings.rs:29-34` chains path lookup, file read, and JSON parsing and ends in `unwrap_or_default()` for every failure.
- `src-tauri/src/settings.rs:36-44` serializes JSON and calls `fs::write` directly on `settings.json`.
- The only settings test verifies that older JSON defaults the new `remoteAccessEnabled` field.
- `src/routes/layout.tsx:66-84` awaits `loadLibrarySongs()` and settings in one `Promise.all`; settings has a fallback but database load does not, so a database rejection prevents both assignments.
- Existing error handling uses typed store sync states (`idle`, `scanning`, `error`) and `getErrorMessage`; do not add telemetry or expose full personal paths.
- `settings_path` uses Tauri's app-local-data directory. Do not change the app identifier or data location in this plan.

## Commands you will need

| Purpose                   | Command                                                                                      | Expected on success     |
| ------------------------- | -------------------------------------------------------------------------------------------- | ----------------------- |
| Rust settings tests       | `cd src-tauri && cargo test --locked settings`                                               | all settings cases pass |
| Frontend tests            | `npm test`                                                                                   | all pass                |
| Frontend lint/types/build | `npm run lint && npm run build.types && npm run build`                                       | all exit 0              |
| Rust format/lint          | `cd src-tauri && cargo fmt -- --check && cargo clippy --locked --all-targets -- -D warnings` | both exit 0             |

## Scope

**In scope**:

- `src-tauri/src/settings.rs`
- `src-tauri/src/main.rs` only for startup error propagation/state construction
- `src-tauri/Cargo.toml` and `src-tauri/Cargo.lock` to add `tempfile`
- `src/routes/layout.tsx`
- `src/routes/settings/index.tsx`
- `src/components/footer.tsx`
- `src/services/bootstrap.ts` and `.test.ts` (create)
- `src/App.d.ts`
- `plans/README.md`

**Out of scope**:

- App identifier/data-directory migration, updater/signing, rotating logs, telemetry
- Database schema changes or rebuild implementation
- Settings UI redesign
- Changing setting field names or Tauri command names

## Git workflow

- Branch `codex/010-settings-and-bootstrap-durability` from current `master`.
- Keep native persistence and frontend bootstrap changes in reviewable commits.

## Steps

### Step 1: Separate missing settings from invalid settings

Refactor loading into a path-oriented pure/helper function testable with a temporary directory. A missing file is first run and returns defaults. A read error or malformed JSON returns an explicit typed/error result and preserves the original file. Keep `serde(default)` compatibility for older valid files.

**Verify**: `cd src-tauri && cargo test --locked settings` → missing, valid current, valid older, malformed, and unreadable cases pass.

### Step 2: Write settings atomically

Add `tempfile` as a normal Rust dependency. Serialize through `tempfile::NamedTempFile::new_in(parent)`, write with `Write::write_all`, call `as_file().sync_all()`, and use `persist(path)` for the same-directory atomic replacement. On persistence failure, retain the previous live file and let `PersistError` clean up the temporary file. Keep all tests inside temporary directories and exercise replacement over an existing file.

**Verify**: `cd src-tauri && cargo test --locked settings` → successful replacement loads new JSON; injected write/replace failure leaves old JSON loadable; no orphan temp remains.

### Step 3: Surface startup settings errors safely

Define `SettingsSnapshot { settings: AppSettings, warning: Option<SettingsWarning> }`, with warning codes `unreadable` and `invalid_json` plus a fixed user-safe message. Store the warning in `AppState`; change `get_settings` to return the snapshot; update both layout and Settings callers. When a warning exists, keep defaults in memory, do not auto-start remote access, and preserve the invalid file. Saving valid settings clears the warning only after atomic persistence succeeds.

**Verify**: `cd src-tauri && cargo test --locked settings && cd .. && npm run build.types` → valid first-run behavior is unchanged and malformed settings produce a typed warning.

### Step 4: Decouple library and settings bootstrap

Add `bootstrap: { libraryStatus: 'loading' | 'ready' | 'error'; libraryError: string; settingsWarning: string }` to the root store. `src/services/bootstrap.ts` independently settles `loadLibrarySongs` and `get_settings`, returning both results. The layout assigns each successful result independently; database failure sets the fixed message “Jukebox could not open the library. Restart the app or check Diagnostics.” Settings warning uses the native fixed message. `footer.tsx` renders the library error first, then settings warning, when no scan/import message is active. A later successful load/save clears only its own field.

**Verify**: `npm test -- src/services/bootstrap.test.ts` → all four success/failure combinations and independent clearing rules pass.

### Step 5: Run full gates

Run every command in the commands table and inspect the diff.

**Verify**: `git diff --check` → exit 0. Then run `git status --porcelain=v1 | cut -c4- | rg -v '^(src-tauri/src/(settings|main)\.rs|src-tauri/Cargo\.(toml|lock)|src/routes/(layout|settings/index)\.tsx|src/components/footer\.tsx|src/services/bootstrap(\.test)?\.ts|src/App\.d\.ts|plans/README\.md)$'` → exit 1 with no output.

## Test plan

- Native temporary-directory tests for missing, legacy-valid, current-valid, malformed, unreadable, successful atomic replace, and failed replace.
- Frontend pure bootstrap tests for both success, library-only failure, settings-only failure, and both failure.
- Startup test verifies a settings read failure cannot silently enable/disable the remote server through defaults.

## Done criteria

- [ ] Missing settings still produce defaults; malformed/unreadable settings do not.
- [ ] Failed writes leave the last valid settings file recoverable.
- [ ] Library and settings bootstrap failures are independent and visible.
- [ ] No full personal path appears in user-facing errors.
- [ ] All frontend and Rust gates pass; no out-of-scope files changed.

## STOP conditions

- Atomic replacement cannot be made cross-platform without a dependency or data-location change not listed in scope.
- Tauri startup requires a valid `AppSettings` value before an error can be retained safely.
- The proposed UI recovery needs destructive database rebuild behavior.
- Existing installed settings use undocumented shapes that `serde(default)` cannot preserve.

## Maintenance notes

Plan 001 diagnostics should consume these typed failures instead of changing persistence semantics again. The later app-identifier migration must copy settings atomically and preserve the malformed-file recovery rule.
