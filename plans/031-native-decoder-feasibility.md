# Plan 031: Prove bounded native decoder feasibility

Status: DONE on branch `codex/031-native-decoder-feasibility`.

## Problem

Jukebox has an authoritative native playback state and restart-safe session persistence, but audio still comes from the WebView. Moving output prematurely could reduce codec coverage, break gapless playback, or silently raise the minimum supported operating system. The decoder and device-output risks need separate executable evidence.

## Scope

1. Add copyright-free synthetic fixtures for MP3, AAC/M4A, FLAC, Ogg/Vorbis, and ALAC; generate WAV input in memory.
2. Exercise the existing Symphonia 0.5.5 stack with gapless container handling enabled.
3. Prove every decoded stream can be forwarded through fixed-size output chunks rather than buffering a track or queue.
4. Prove accurate seek plus decoder reset can reach a requested PCM frame.
5. Prove two compatible decoded tracks can meet at one sample boundary without application-inserted silence or duplication.
6. Record why the OS output layer remains a separate gate rather than adding a dependency to production builds now.

## Decision evidence

- Symphonia's `FormatOptions::enable_gapless` exposes encoder trim information, and its accurate seek contract returns at or before the requested timestamp so the decoder can discard to the exact frame. The repository already ships Symphonia for metadata, avoiding a second codec stack. See the [Symphonia 0.5.5 crate documentation](https://docs.rs/crate/symphonia/0.5.5) and [`FormatReader`](https://docs.rs/symphonia-core/0.5.5/symphonia_core/formats/trait.FormatReader.html).
- Current CPAL exposes host/device enumeration, supported configurations, callback output, stream clocks, and pause/play control. Its documented current platform matrix also requires macOS 14.2 for CoreAudio and ALSA development files on Linux. See the [CPAL 0.18.2 documentation](https://docs.rs/crate/cpal/0.18.2).
- Rodio uses CPAL for output and Symphonia by default for decoding. Its output builder is convenient, but its documented default buffer is 100 ms and the higher-level mixer does not remove the need for Jukebox-specific seek, queue, transition, and underrun semantics. See the [Rodio stream documentation](https://docs.rs/rodio/0.22.2/rodio/stream/index.html).

The phase therefore keeps Symphonia as the decoder candidate and defers choosing direct CPAL versus a higher-level wrapper until Jukebox declares an OS support baseline and can run real-device smoke tests on macOS, Windows, and Linux. No native output dependency enters the shipping graph in this phase.

## Verification

- `cargo test --locked --test native_decoder_feasibility`
- `cargo test --locked`
- `cargo clippy --locked --all-targets -- -D warnings`
- `npm run fmt.check`
- `npm run check:public-source`
- `npm run lint`
- `npm run build.types`
- `npm test -- --run`
- `npm run build`
- `npm run tauri build`

## Acceptance criteria

- All six supported codec/container paths decode at 48 kHz stereo from synthetic inputs.
- A decoded packet may not exceed 65,536 interleaved samples, and samples are emitted in chunks no larger than 4,096.
- Accurate WAV seek recovers the exact requested frame after decoder reset and discard.
- Two compatible PCM tracks produce exactly the sum of their frames, with adjacent positive/negative boundary markers and no inserted zero or duplicated sample.
- No fixture contains personal media, and no tracked source contains a developer home-directory layout.
- Production behavior, dependencies, and browser transport remain unchanged.

## Outcome

- Added copyright-free synthetic MP3, AAC/M4A, FLAC, Ogg/Vorbis, and ALAC fixtures plus in-memory WAV generation; no personal media or machine path is present.
- Proved all six supported codec/container paths decode as 48 kHz stereo with gapless container handling enabled, reject decoded packets above 65,536 interleaved samples, and forward through chunks capped at 4,096 samples.
- Proved accurate seek reaches an exact requested PCM frame after resetting the decoder and discarding the pre-roll portion of the returned packet.
- Proved two compatible decoded tracks meet on one adjacent sample boundary with exactly the sum of their frames and no application-inserted zero or duplicate marker.
- Kept the shipping dependency graph and browser transport unchanged. The next native-output phase must declare an OS support baseline and verify actual devices on macOS, Windows, and Linux before selecting CPAL directly or through a higher-level wrapper.
- Verified formatting, public-source portability, lint, typecheck, 55 frontend tests, 125 ordinary Rust unit tests, 3 native decoder integration tests, one opt-in benchmark ignored, warning-free Clippy, production frontend build, macOS app bundle, and DMG.

## STOP conditions

- Stop if any required codec cannot decode through the existing stack.
- Stop if testing requires personal music, a committed machine path, or a non-redistributable fixture.
- Stop if a decoder packet forces unbounded queue-length or track-length buffering.
- Stop if native output would be selected without a declared OS baseline and real-device evidence on all supported platforms.
- Stop if the spike changes the shipping transport before parity is proven.
