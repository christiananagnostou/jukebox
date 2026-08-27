# Native import-path inspection

## Objective

Remove direct filesystem inspection from the desktop renderer by classifying user-selected import paths in a bounded native command, then delete the frontend/Rust filesystem plugin and every renderer filesystem permission.

## Scope

1. Add a native command that classifies selected paths as regular files or directories.
2. Bound the command to 4,096 paths and 32,768 bytes per path.
3. Keep filesystem and join failures path-redacted in command errors.
4. Preserve folder selection, file drop, explicit audio-file import, native-root registration, and existing user-facing progress.
5. Remove the direct `@tauri-apps/plugin-fs` and `tauri-plugin-fs` dependencies, filesystem plugin initialization, and all `fs:*` capability grants. Retain only the dialog open/message permissions that the UI uses. The dialog plugin may retain its own transitive Rust implementation dependency.

## Non-goals

- No change to the asset-protocol wildcard in this slice; playback and artwork need a separately tested runtime-scope lifecycle.
- No identity/bundle migration, CSP change, Windows CI, signing, or updater work.
- No visual redesign or large animation.

## Invariants

- The renderer cannot call a general filesystem read or metadata plugin.
- The native command returns only the selected path strings partitioned by kind; it exposes no filesystem metadata.
- Invalid or inaccessible paths never appear in returned errors.
- Native classification runs off the command thread and has fixed input bounds.

## Verification

- Unit-test regular file/directory classification plus missing, invalid, long, and oversized input rejection.
- Verify no frontend or capability reference to the filesystem plugin remains.
- Run formatting, public-source portability, lint, strict types, frontend tests/build, Rust tests, strict Clippy, and Tauri packaging.
- Smoke-test folder selection and native refresh from the installed release.

## Acceptance criteria

- Existing directory selection and file-drop imports reach the same native refresh/import flows.
- The main renderer capability contains no `fs:*` permission.
- The application has no direct filesystem-plugin dependency, initialization, guest binding, or capability grant.
- All supported platform CI jobs pass before merge.

## Rollout and rollback

- This changes no database or persisted settings.
- Restoring the plugin and prior frontend `stat` call returns to the previous behavior.

## Status

DONE
