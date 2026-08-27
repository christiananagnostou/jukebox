# 045 — Local pre-push quality gate

Status: DONE

## Outcome

Give contributors and PR automation one documented command that runs Jukebox's high-signal frontend, Rust, privacy, security, and production-build checks before code leaves the workstation.

## Scope

- Add `npm run pre-push` as the stable orchestration entrypoint expected by the PR workflow.
- Add `npm run check:rust` for locked Rust formatting, tests, and Clippy.
- Match the repository's existing CI commands without introducing machine-specific paths.
- Keep macOS/Ubuntu packaging and bundle portability in CI and release verification rather than rebuilding installers on every local push.
- Document both commands in `AGENTS.md`.

## Verification

- Run `npm run pre-push` from a clean dependency install and require a zero exit status.
- Confirm format, source portability, identity, desktop security, frontend tests/build, Rust tests, and Clippy all execute through the single command.

## Evidence

- `npm run pre-push` completes successfully from the repository root.
- The gate runs 82 frontend tests, the production Qwik client/SSR build, 164 passing Rust tests, all three decoder fixtures, and warning-free Clippy.
- Formatting, public-source portability, app identity, and desktop security checks run before compilation-heavy work.
