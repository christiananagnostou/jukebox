# Plan 007: Harden Tailscale discovery and private-listening boundaries

> **Executor instructions**: Follow this plan step by step. Run every verification command and confirm the expected result before moving on. If a STOP condition occurs, stop and report; do not improvise. When done, update this plan's status row in `plans/README.md`.
>
> **Drift check (run first)**: `git diff --stat 9cfcd61..HEAD -- src-tauri/src/tailscale.rs src-tauri/src/remote_access.rs src-tauri/Cargo.toml src-tauri/Cargo.lock plans/README.md`
> If any in-scope source changed, compare the current-state excerpts below with live code. A semantic mismatch is a STOP condition.

## Status

- **Priority**: P1
- **Effort**: M
- **Risk**: LOW
- **Depends on**: none
- **Category**: bug, tests, security
- **Planned at**: commit `9cfcd61`, 2026-08-26

## Why this matters

Private iPhone listening is shipped and user-facing, but its tests stop at pure parsers and helper functions. A stale Tailscale binary can shadow a working installation, while regressions at the real router/database/process seams can pass every current test. This plan makes discovery resilient and verifies the security-sensitive Serve and stream contracts without touching the developer's real Tailscale configuration.

## Current state

- `src-tauri/src/tailscale.rs:243-263` returns immediately after the first absolute candidate that exists, even when `status --json` fails. Candidate order on macOS begins with `/usr/local/bin/tailscale`, then `/opt/homebrew/bin/tailscale`, then the app bundle.
- `src-tauri/src/tailscale.rs:266-282` directly constructs `tokio::process::Command`; current tests at line 398 onward cover JSON parsing and port choice, not exact argv, timeout, retry, or state transition behavior.
- `src-tauri/src/remote_access.rs:224-235` composes the production Axum router, including PWA assets, `/api/tracks`, and `/api/tracks/{id}/stream`.
- `src-tauri/src/remote_access.rs:309-353` queries a real read-only SQLite pool with bounded limit/offset and escaped `LIKE`; existing tests do not issue requests through the router.
- `src-tauri/src/remote_access.rs:356-376` resolves an opaque ID, reads the configured music root, enforces containment, and streams the file; helper tests do not verify the joined HTTP behavior.
- Security invariants from plan 006: bind Jukebox only to loopback, never configure Funnel, never accept request filesystem paths, and never remove shared or named Tailscale endpoints.
- Rust conventions: return `Result` for recoverable failures, avoid panics outside provably static response construction, and keep Tauri command signatures stable.

## Commands you will need

| Purpose        | Command                                                              | Expected on success |
| -------------- | -------------------------------------------------------------------- | ------------------- |
| Rust format    | `cd src-tauri && cargo fmt -- --check`                               | exit 0              |
| Rust tests     | `cd src-tauri && cargo test --locked`                                | all tests pass      |
| Rust lint      | `cd src-tauri && cargo clippy --locked --all-targets -- -D warnings` | exit 0, no warnings |
| Frontend gates | `npm run lint && npm run build.types && npm test && npm run build`   | all commands exit 0 |

## Scope

**In scope**:

- `src-tauri/src/tailscale.rs`
- `src-tauri/src/remote_access.rs`
- `src-tauri/Cargo.toml` and `src-tauri/Cargo.lock` only if a small test-only HTTP utility is required
- `plans/README.md`

**Out of scope**:

- Mobile UI features, FTS, albums/artists, shared queues, and transcoding
- Changing the loopback port or Tailscale HTTPS-port selection policy
- Invoking or mutating the machine's real Tailscale configuration from tests
- Broad authentication or public/LAN exposure

## Git workflow

- Branch from current `master` as `codex/007-private-listening-contract-tests`.
- Keep implementation and tests in focused commits using the repository's imperative commit style, for example `Harden Tailscale command discovery`.
- Push and open a PR only when instructed by the operator; never merge with failing gates.

## Steps

### Step 1: Introduce a fakeable Tailscale command boundary

Extract the minimal command-execution seam needed for tests. It must accept an explicit binary path, argument list, and timeout and return the existing bounded `CommandOutput` shape. Production still uses `tokio::process::Command`; tests use a fake recording runner. Do not create a general subprocess framework.

**Verify**: `cd src-tauri && cargo test --locked tailscale` → existing and new Tailscale tests pass without executing a real CLI.

### Step 2: Try candidates until one returns usable status

Change candidate selection so an existing but failing, timed-out, or unparsable candidate does not shadow a later working candidate. Preserve actionable error reporting when every candidate fails. Add tests for: failing first candidate then successful second; malformed first response then successful second; all candidates absent; and all candidates failing.

**Verify**: `cd src-tauri && cargo test --locked tailscale` → all candidate-order cases pass.

### Step 3: Characterize start and stop orchestration

Using the fake runner, assert exact command arguments and postcondition inspection for a dedicated endpoint. Cover selection of 8443 when 443 belongs to another application, refusal to remove a shared path or named service, command timeout, command non-zero exit, and a successful command whose follow-up status does not show the requested state. Preserve the rule that tests never run `tailscale serve` for real.

**Verify**: `cd src-tauri && cargo test --locked tailscale` → orchestration tests pass and the fake runner records no unexpected calls.

### Step 4: Add router-level private-listening tests

Build `HttpState` with a temporary migrated SQLite database, temporary approved music root, and small fixture media bytes. Issue Axum requests through `router(...)`. Cover shell CSP/no-store headers, bounded/escaped catalog search, stable ordering, full stream, one valid byte range, malformed/multipart ranges, unknown ID, and a database row whose path escapes the approved root.

**Verify**: `cd src-tauri && cargo test --locked remote_access` → all router tests pass using only temporary files and databases.

### Step 5: Run full gates

Run every command in the commands table. Then inspect `git status --short` and confirm only in-scope files plus `plans/README.md` changed.

**Verify**: `git diff --check` → exit 0. Then run `git status --porcelain=v1 | cut -c4- | rg -v '^(src-tauri/src/(tailscale|remote_access)\.rs|src-tauri/Cargo\.(toml|lock)|plans/README\.md)$'` → exit 1 with no output; any output is a scope violation.

## Test plan

- Tailscale fake-runner tests cover candidate fallback, exact argv, timeouts, non-zero exits, unsafe-stop refusal, and postcondition mismatches.
- Router integration tests use temporary SQLite/media fixtures and cover successful and denied requests through the production router.
- Tests must not depend on the local Tailscale installation, tailnet, music library, app-data directory, or network.

## Done criteria

- [ ] A failing earlier Tailscale candidate no longer shadows a later usable candidate.
- [ ] Start/stop orchestration is tested without invoking the real CLI.
- [ ] Production router tests cover PWA headers, catalog query, full/ranged streaming, and path denial.
- [ ] Rust format, tests, and Clippy pass.
- [ ] Frontend lint, types, tests, and build pass.
- [ ] No out-of-scope files changed and `plans/README.md` is updated.

## STOP conditions

- Candidate fallback requires changing public Tauri command names or serialized status fields.
- Router tests cannot construct state without binding a real port or touching real app data.
- A proposed test would run a real `tailscale serve` or `tailscale funnel` command.
- Safe removal cannot distinguish a dedicated Jukebox endpoint from a shared/named endpoint.

## Maintenance notes

Keep the command seam local to Tailscale. Reviewers should scrutinize argv, timeout handling, and proof that stop cannot affect any other endpoint. Plan 006 mobile/API additions must extend the router fixture rather than reverting to helper-only tests.
