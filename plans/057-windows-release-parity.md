# Plan 057: Add Windows CI and installer portability parity

> **Executor instructions**: Follow this plan step by step. Run every verification command and confirm the expected result before moving to the next step. If anything in the "STOP conditions" section occurs, stop and report; do not improvise. When done, update this plan's row in `plans/README.md`.
>
> **Drift check (run first)**: `git diff --stat 331967f..HEAD -- .github/workflows/ci.yml scripts/check-bundle-portability.mjs scripts/check-app-identity.mjs src-tauri/tauri.conf.json README.md`
> If any in-scope file changed since this plan was written, compare the current state below against live code before proceeding. A semantic mismatch is a STOP condition.

## Status

- **Priority**: P1
- **Effort**: M
- **Risk**: MED
- **Depends on**: none
- **Category**: dx / release
- **Planned at**: commit `331967f`, 2026-08-30

## Why this matters

Jukebox claims a cross-platform Tauri desktop architecture, contains Windows-specific code paths and an `.ico`, but required CI currently builds only Ubuntu and macOS. A Windows compile/package regression can therefore merge unnoticed, and the native-output phase cannot honestly claim platform parity without a Windows gate. This plan adds one ordinary Windows runner and verifies the raw executable plus produced installer without publishing or signing anything.

## Current state

- `.github/workflows/ci.yml` defines `matrix.os: [ubuntu-latest, macos-latest]`; its Tauri job already runs Rust formatting, tests, strict Clippy, `npm run tauri build`, and bundle portability.
- `src-tauri/tauri.conf.json` has `bundle.targets: "all"`, a Windows icon, SHA-256 digest configuration, and no certificate. Tauri's current Windows distribution documentation says `.msi` and NSIS setup artifacts must be built on Windows for the supported path.
- `scripts/run-tauri.mjs` already normalizes Windows path separators through Node's `path.resolve` and remaps checkout, Cargo, Rustup, temp, and home roots before release compilation.
- `scripts/check-bundle-portability.mjs` accepts either files or directories and already normalizes Windows temp roots, but CI hard-codes the Unix executable path `src-tauri/target/release/Jukebox`.
- `src-tauri/src/main.rs`, `tailscale.rs`, `diagnostics.rs`, and M3U handling contain Windows branches that currently compile only outside required CI.
- Keep `com.jukebox.app` unchanged. `scripts/check-app-identity.mjs` intentionally enforces it until a signed permission migration exists.

## Commands you will need

| Purpose            | Command                                         | Expected on success                                        |
| ------------------ | ----------------------------------------------- | ---------------------------------------------------------- |
| Full local gate    | `npm run pre-push`                              | exit 0                                                     |
| App build          | `npm run tauri build -- --bundles app`          | exit 0 on macOS                                            |
| Workflow syntax    | `npx prettier --check .github/workflows/ci.yml` | exit 0                                                     |
| Source portability | `npm run check:public-source`                   | exit 0                                                     |
| GitHub checks      | `gh pr checks <PR number> --watch`              | Web, Tauri Ubuntu, Tauri macOS, and Tauri Windows all pass |

## Scope

**In scope**:

- `.github/workflows/ci.yml`
- `scripts/check-bundle-portability.mjs` only if a small platform-target helper is necessary
- `scripts/check-app-identity.mjs` only if a Windows packaging invariant needs an explicit static check
- `README.md` for accurate Windows support/build wording
- `plans/README.md` and this plan's status

**Out of scope**:

- Signing certificates, secrets, release publication, updater setup, or version changes
- Bundle identifier or data-directory changes
- Cross-compiling Windows on Linux/macOS
- ARM64/i686 jobs; establish x64 parity first
- Product source changes merely to silence a Windows failure. A real source portability failure is a STOP condition and gets its own focused plan.

## Git workflow

- Branch from current `master` as `codex/057-windows-release-parity`.
- Use a focused commit such as `ci: add Windows desktop parity`.
- Push and open a PR to `master`; do not merge until the exact head is green on all four required jobs.

## Steps

### Step 1: Make the Tauri matrix platform-explicit

Add `windows-latest` to the existing Tauri matrix. Keep Linux packages conditional on `runner.os == 'Linux'`. Keep the pinned Node 22.12 and Rust 1.93 baselines. Do not add a second duplicate Windows job.

Use platform-specific values for the raw executable and bundle directory, either as matrix `include` fields or a short conditional environment step:

- Windows executable: `src-tauri/target/release/Jukebox.exe`
- Windows bundle directory: `src-tauri/target/release/bundle`
- Unix executable: `src-tauri/target/release/Jukebox`
- Unix bundle directory: `src-tauri/target/release/bundle`

Run the same formatting, test, strict Clippy, Tauri build, and portability sequence on Windows. Use PowerShell-compatible command syntax; do not introduce Bash-only environment writes on that runner.

**Verify**: `npx prettier --check .github/workflows/ci.yml` -> exit 0.

### Step 2: Keep artifact checks honest

Pass the platform-specific raw executable and bundle directory to `check:bundle-portability`. Do not weaken the checker, skip binaries, or ignore Windows installer contents. If an installer format cannot be inspected because it is a container, ensure the raw executable is still scanned and record the container limitation in the workflow comment and README.

Assert after `tauri build` that at least one Windows installer exists under `src-tauri/target/release/bundle/msi` or `.../nsis`. Fail the job if neither exists. Do not upload or publish it in this plan.

**Verify**: GitHub's Windows job reaches the portability step and reports a nonzero scanned-file count.

### Step 3: Document the verified support boundary

Update `README.md` to state that CI builds Windows x64, macOS, and Ubuntu, while distributable releases remain unsigned and are not yet published through an updater. Keep installation prerequisites linked to Tauri rather than embedding machine-specific setup paths.

**Verify**: `npm run check:public-source` -> exit 0.

### Step 4: Run and review the complete gate

Run `npm run pre-push` locally. Push the focused branch, open a PR, and wait for Web plus all three Tauri platform jobs. Inspect the Windows log to confirm it ran Rust tests/Clippy and built an installer rather than passing through skipped conditions.

**Verify**: `gh pr checks <PR number> --watch` -> four required jobs pass on the exact head.

## Test plan

- No new product unit tests are expected; this plan makes existing Rust/frontend coverage execute on Windows.
- The Windows job must run all ordinary Rust tests, including platform-conditional compilation.
- The Windows job must build a raw `.exe` and at least one installer, then scan the raw executable and bundle tree for builder paths.
- The existing Ubuntu and macOS jobs must remain green and unchanged in meaning.

## Done criteria

- [ ] `.github/workflows/ci.yml` has one required Windows x64 Tauri job.
- [ ] Windows runs Rust format, tests, strict Clippy, Tauri build, installer existence, and bundle portability.
- [ ] Web, Ubuntu, macOS, and Windows pass on the exact PR head.
- [ ] No signing secret, machine path, bundle-identity change, or updater is added.
- [ ] `npm run pre-push` exits 0.
- [ ] `plans/README.md` marks plan 057 DONE.

## STOP conditions

- Stop if the hosted Windows image cannot create either supported installer without changing the declared target or installing an unreviewed third-party tool.
- Stop if Windows exposes a real product-code failure; capture the exact failing module and plan the smallest product fix instead of broad conditional compilation.
- Stop if portability can pass only by excluding the raw executable or installer contents.
- Stop if any proposed solution needs signing credentials or changes `com.jukebox.app`.

## Maintenance notes

Windows CI is a compile/package gate, not proof of real audio output, file-picker behavior, or installer launch. Plan 060 uses it as the minimum compile leg for native output, while signed installer smoke tests remain in strategic plan 001. Review future workflow changes for accidental platform-specific shell syntax and for parity drift between matrix legs.
