# Plan 060: Prove native audio output on supported desktop platforms

> **Executor instructions**: Follow this plan step by step. Run every verification command and confirm the expected result before moving to the next step. If anything in the "STOP conditions" section occurs, stop and report; do not improvise. When done, update this plan's row in `plans/README.md`.
>
> **Drift check (run first)**: `git diff --stat 331967f..HEAD -- src-tauri/Cargo.toml src-tauri/Cargo.lock src-tauri/src/playback src-tauri/tests/native_decoder_feasibility.rs .github/workflows/ci.yml docs plans/003-playback-engine-and-os-integration.md`
> Plan 057 must be DONE. If playback state, decoder fixtures, or platform CI changed, compare the current state below against live code before proceeding; a semantic mismatch is a STOP condition.

## Status

- **Priority**: P1
- **Effort**: L
- **Risk**: HIGH
- **Depends on**: plan 057
- **Category**: direction / architecture
- **Planned at**: commit `331967f`, 2026-08-30

## Why this matters

Jukebox now has authoritative native playback state, persistent queues, exact asset authorization, and six-codec Symphonia evidence, but actual sound still comes from an `HTMLAudioElement`. That prevents dependable gapless output, output-device recovery, and OS-level playback that survives WebView lifecycle. This plan is intentionally a real-device gate—not a shipping transport switch—so the project can select a native output layer using measured evidence without reducing platform or codec support.

## Current state

- `src-tauri/src/playback/state.rs` owns revisioned playback commands, queue semantics, persistence warnings, repeat, shuffle, volume, transition commit/reject, and extensive table-driven tests.
- `src/hooks/useAudioPlayer.tsx` and `src/services/audio-transport.ts` still adapt state transitions to one `HTMLAudioElement`.
- `src-tauri/tests/native_decoder_feasibility.rs` proves MP3, AAC/M4A, FLAC, Ogg/Vorbis, WAV, and ALAC decode, exact PCM seek, 4,096-sample bounded forwarding, and a zero-insertion-free compatible-track boundary.
- `src-tauri/Cargo.toml` ships Symphonia 0.5.5 with all codecs but no output crate.
- As of this plan, CPAL 0.18.2 exposes CoreAudio, WASAPI, and ALSA output; Linux requires ALSA development headers. Rodio 0.22.2 wraps CPAL and provides configurable output buffering, but its default 100 ms buffer and mixer do not replace Jukebox's state/queue semantics. Re-check these upstream versions before implementation.
- Plan 057 adds Windows compile/package parity. Hosted CI generally cannot prove audible physical-device output, so the gate needs an explicit manual evidence artifact for each required platform.
- The production browser transport must remain the default until all acceptance criteria pass.

## Commands you will need

| Purpose              | Command                                                                                      | Expected on success               |
| -------------------- | -------------------------------------------------------------------------------------------- | --------------------------------- |
| Decoder fixtures     | `cargo test --locked --manifest-path src-tauri/Cargo.toml --test native_decoder_feasibility` | 3 tests pass                      |
| Output harness tests | `cargo test --locked --manifest-path src-tauri/Cargo.toml native_output`                     | all deterministic tests pass      |
| Rust strict gate     | `npm run check:rust`                                                                         | exit 0                            |
| Full local gate      | `npm run pre-push`                                                                           | exit 0                            |
| Platform CI          | `gh pr checks <PR number> --watch`                                                           | Web and all three Tauri jobs pass |

## Suggested executor toolkit

- Re-read current official CPAL and Rodio documentation before selecting versions; do not rely on the versions stamped in this plan if the lockfile ecosystem has moved.
- Use existing copyright-free fixtures under `src-tauri/tests/fixtures`; never use or commit personal music.
- Use Computer Use only for Jukebox UI/device-selection acceptance. Audible output requires a human confirmation or a documented loopback device, not visual inference.

## Scope

**In scope**:

- `src-tauri/Cargo.toml` and `Cargo.lock` for one optional spike dependency
- `src-tauri/src/playback/output.rs` (new trait, device/config model, bounded callback bridge)
- `src-tauri/src/playback/output_cpal.rs` or a clearly named spike adapter
- `src-tauri/src/playback/mod.rs`
- `src-tauri/tests/native_output_feasibility.rs` (new deterministic harness)
- `.github/workflows/ci.yml` for Linux audio build headers and feature compilation
- `docs/decisions/ADR-native-audio-output.md` (new evidence/decision)
- `plans/003-playback-engine-and-os-integration.md`, `plans/README.md`, and this plan's status

**Out of scope**:

- Replacing `BrowserAudioTransport` in production, changing default playback behavior, or removing exact asset authorization
- Rewriting the authoritative playback reducer, queue, history, or persistence schema
- Gapless shipping claims, crossfade, ReplayGain, effects, visualizers, or large animations
- OS media-session integration or global keys; those follow a successful output gate
- Changing the bundle identifier or minimum OS silently
- Personal audio fixtures or machine-specific device names in tracked files

## Git workflow

- Branch from the merged plan-057 head as `codex/060-native-output-gate`.
- Prefer two focused commits: `test: add native output feasibility harness`, then `docs: record native output decision`.
- Open one PR to `master`. Do not merge a dependency that affects default production behavior; the output feature must remain opt-in/spike-only.

## Steps

### Step 1: Declare the supported baseline before choosing the adapter

Add the decision document with the current Tauri/Rust baseline and explicit minimum supported macOS, Windows, and Linux targets. Compare CPAL direct use with Rodio only for output ownership, device enumeration, stream configuration, callback/buffer control, shutdown, dependency/MSRV cost, and integration with the already-proven Symphonia PCM path.

Choose direct CPAL unless measured evidence shows the higher-level layer materially reduces risk without duplicating decoder/queue/state ownership. Record rejected alternatives and version-specific platform constraints. If the chosen version raises the declared OS or Rust baseline, STOP for maintainer approval before changing dependencies.

**Verify**: the ADR contains a decision table, declared baseline, rollback, and exact manual evidence still required.

### Step 2: Add an output trait and optional adapter

Define a small native output boundary independent of Tauri and playback state:

- enumerate sanitized device IDs/labels without persisting raw backend internals;
- select default or requested device;
- negotiate sample format/rate/channels;
- accept bounded interleaved PCM through a nonblocking producer;
- expose underrun/output-loss/error counters;
- play, pause, drain, and close deterministically.

Use a bounded single-producer/single-consumer ring or channel sized by time/sample budget, never by track or queue length. The real-time callback must not allocate, lock a contended mutex, decode, perform SQL, log, or call Tauri. Put the implementation behind a non-default Cargo feature such as `native-output-spike` so ordinary production bundles remain unchanged.

**Verify**: `cargo test --locked --manifest-path src-tauri/Cargo.toml native_output` -> deterministic fake-device tests pass without a physical device.

### Step 3: Build the real-device feasibility harness

Create a test-only/manual binary or ignored integration test that:

1. enumerates devices and selects default unless an explicit test-only ID is supplied;
2. emits a short bounded low-volume synthetic tone and silence guard—not a personal file;
3. streams the existing decoded fixtures through the same bounded PCM boundary;
4. exercises pause/resume, clean shutdown, default-device loss/reopen where the platform permits;
5. records negotiated config, buffer capacity, callback cadence, underruns, and teardown result without device serials or user paths.

Keep audible tests `#[ignore]` or behind an explicit command so CI never plays sound. Add a deterministic fake-output test for exact sample counts, backpressure, teardown, and producer cancellation.

**Verify**: ordinary `cargo test --locked` does not require hardware; the explicit harness prints a path-free summary and exits cleanly.

### Step 4: Compile the optional adapter on every required platform

Update CI so the native-output feature compiles/tests on Ubuntu, macOS, and Windows without becoming the default feature. Install `libasound2-dev` on Ubuntu if direct CPAL/Rodio playback needs it. Do not skip strict Clippy for the feature.

**Verify**: Web plus Tauri Ubuntu/macOS/Windows pass, and each Rust job runs `cargo test --locked --features native-output-spike` or an equivalent compile/test command.

### Step 5: Collect real-device evidence and decide

Run the explicit harness on at least one supported physical/default output device for macOS, Windows, and Linux. For each platform record only OS family/version range, backend, negotiated sample config, buffer duration, underrun count, output-loss behavior, and human/loopback confirmation. Never record usernames, device serials, hostnames, or paths.

The ADR verdict must be one of:

- **PASS**: all three platforms meet the gate; dependency may remain for the next engine-actor plan;
- **CONDITIONAL**: keep the spike branch/plan blocked with named platform evidence missing;
- **FAIL**: remove the optional shipping dependency and retain the browser transport, preserving the ADR and deterministic harness findings.

Do not claim audible success from CI compilation or Computer Use visuals.

**Verify**: the evidence table has one real-device row per required platform or the plan is marked BLOCKED/REJECTED rather than DONE.

### Step 6: Run the unchanged production gate

Run the full pre-push gate and an ordinary app bundle without the spike feature. Verify browser playback code and dependency-default behavior did not change.

**Verify**: `npm run pre-push && npm run tauri build -- --bundles app` -> both exit 0 without enabling native output.

## Test plan

- Fake output tests cover bounded capacity, exact sample order/count, producer backpressure, pause/resume, callback underrun, output loss, cancellation, and teardown.
- Existing six-codec decoder fixtures remain green and feed the manual harness.
- Feature builds compile and pass strict Clippy on Ubuntu, macOS, and Windows.
- Audible/device acceptance is explicit and manual per platform; absence cannot be replaced by inference.

## Done criteria

- [ ] A reviewed ADR declares supported OS/Rust baselines and selects or rejects an output layer using current evidence.
- [ ] One optional, non-default adapter has a bounded, real-time-safe output boundary.
- [ ] Ordinary tests require no sound device; fake-output tests cover every concurrency/error invariant.
- [ ] The optional feature compiles/tests on Ubuntu, macOS, and Windows.
- [ ] Real-device evidence exists for all three required platforms; otherwise the plan is not DONE.
- [ ] Production still uses `BrowserAudioTransport` and ordinary bundles pass unchanged.
- [ ] No personal music, device serial, username, host path, or large animation is added.
- [ ] `plans/README.md` records the evidence-backed status.

## STOP conditions

- Stop if the output dependency raises Rust 1.93 or the declared OS baseline without explicit maintainer approval.
- Stop if Linux/Windows/macOS cannot compile the same bounded adapter feature.
- Stop if the callback requires allocation, decoding, SQL, Tauri calls, or contended locks.
- Stop if real-device evidence is unavailable on any required platform; mark the plan BLOCKED rather than weakening acceptance.
- Stop if implementation begins switching production playback or rewriting queue/state semantics.

## Maintenance notes

A passing gate enables a later engine-actor plan; it does not itself deliver gapless production output. The next plan must reuse the authoritative snapshot/revision contract, keep buffers bounded, stage production rollout behind a transport feature flag, and include sleep/wake plus device-unplug recovery. Re-evaluate the chosen crate's platform/MSRV policy before every major update.
