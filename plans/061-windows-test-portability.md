# Plan 061: Fix Windows test portability exposed by desktop parity

## Status

- **Priority**: P1
- **Effort**: S
- **Risk**: LOW
- **Depends on**: 057
- **Category**: test / release
- **Discovered by**: PR #120 Windows CI at commit `eff9960`

## Why this matters

The first required Windows run reached the Rust suite and exposed five platform assumptions before packaging. SQLite fixture pools retained Windows file handles through cleanup, one M3U assertion expected native separators even though exports intentionally normalize them, and an expiry fixture subtracted from a young monotonic clock. These are test-lifetime and expectation defects; skipping them would weaken the new platform gate.

## Scope

- Explicitly release owned SQLite pools and their fixture-state clones before removing temporary directories.
- Assert the portable forward-slash M3U contract on every operating system.
- Test expiry by advancing an injected pruning instant instead of subtracting beyond the monotonic clock epoch.
- Keep production behavior, packaging targets, app identity, and supported formats unchanged.

## Verification

- `npm run pre-push`
- PR #121 passes Web and the existing Ubuntu/macOS jobs.
- After stacking into PR #120, its exact head passes Web, Ubuntu, macOS, and Windows; Windows must continue through installer verification and bundle portability.

## Done criteria

- [ ] The five Windows Rust failures pass without platform skips.
- [ ] Existing macOS/Linux behavior remains green.
- [ ] No retry loop, sleep, ignored test, or broad conditional compilation is added.
- [ ] Plan 057 completes on an exact head with all four required jobs green.
