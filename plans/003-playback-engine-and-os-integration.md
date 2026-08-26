# Playback engine and operating-system integration

## Objective

Provide reliable, gapless, restart-safe playback with first-class media controls and output-device handling while keeping the interface compact and motion-light.

## Current state and evidence

- `src/hooks/useAudioPlayer.tsx` owns one WebView `HTMLAudioElement`; playback disappears with the window lifecycle and cannot guarantee gapless transitions.
- The queue and current index are frontend arrays and are not persisted.
- Media keys are handled through window `keydown` in `src/hooks/useKeyboardShortcuts.ts`, so they are not a dependable global media-session integration.
- There is no output-device selection, volume persistence, ReplayGain, shuffle/repeat model, resume position, sleep/wake recovery, or structured playback error state.
- `symphonia` is already used for metadata parsing and can remain the shared codec foundation for a native playback feasibility spike.

## Scope

1. Create a single authoritative playback state machine.
2. Move decoding/output to a native worker if the feasibility gate passes.
3. Implement gapless transitions, seek, volume, shuffle, repeat, and queue semantics.
4. Persist session state and recover after restart/sleep/device changes.
5. Integrate platform media sessions and global media keys.
6. Add output-device selection and optional ReplayGain.

## Non-goals

- No visualizer, animated waveform, or large transport animation.
- No DSP plugin host or professional audio workstation features.
- No cloud casting in the first implementation.
- Crossfade is optional and off by default; gapless correctness comes first.

## State model

Define a serializable `PlaybackSnapshot` with status, current track ID, source path revision, queue entry IDs, queue cursor, position, duration, volume, mute, repeat mode, shuffle seed/order, selected output ID, error code, and monotonic revision. Commands include an expected revision where stale UI actions could conflict.

The engine emits throttled position events plus immediate state/error/queue/device events. The UI renders the latest snapshot and never mutates queue/index fields directly.

## Implementation plan

### 1. Write the state machine before changing output

- Add a pure Rust playback reducer under `src-tauri/src/playback/state.rs` with events for load, play, pause, seek, next, previous, ended, queue edit, unavailable track, output loss, sleep, wake, and fatal/recoverable errors.
- Specify repeat off/one/all, deterministic shuffle, manual queue precedence, previous-track restart threshold, and behavior when tracks disappear.
- Add table-driven tests for empty queues, end boundaries, repeat/shuffle interactions, queued tracks, rapid next/previous, and stale revisions.
- Expose the state machine behind commands while the HTML transport remains temporarily active; compare frontend and backend snapshots in development.

### 2. Pass a native playback feasibility gate

- Time-box a spike using the existing Symphonia decoder with a cross-platform output layer such as CPAL. Compare maintenance and platform behavior with a higher-level Rust audio crate before choosing.
- The gate must prove MP3, AAC/M4A, FLAC, Ogg/Vorbis, WAV, and ALAC support; seek accuracy; device enumeration; clean shutdown; and two-track gapless handoff on macOS, Windows, and Linux.
- Record the dependency and threading decision in an ADR. If the gate fails on a required platform, keep the state machine/backend queue and use a platform-specific or WebView transport adapter until parity is available.

### 3. Implement the engine actor

- Add `src-tauri/src/playback/engine.rs`, `decoder.rs`, `output.rs`, and `commands.rs`.
- Run one actor owning output and decoder state. Communicate through bounded channels; never hold a Tauri state lock while decoding or blocking on audio output.
- Decode ahead into bounded buffers and prepare the next compatible track before the current buffer drains. Gapless mode must not insert silence or duplicate samples.
- Implement seek cancellation, output underrun metrics, recoverable decoder errors, and deterministic teardown.

### 4. Add session persistence and recovery

- Add playback-session and queue tables through plan 001 migrations, coordinated with plan 004.
- Persist structural changes immediately and position on a coarse interval plus clean shutdown. Do not write on every progress event.
- On startup, restore queue and position but remain paused unless the user explicitly enables resume-on-launch.
- On sleep/wake and output-device loss, pause safely, re-enumerate outputs, restore the selected device when available, and resume only when policy permits.

### 5. Integrate media sessions

- Add a platform media-control adapter with play/pause/next/previous/seek callbacks and now-playing title/artist/album/artwork.
- Evaluate a maintained cross-platform media-session crate first; isolate it behind a trait so native macOS/Windows/Linux implementations can replace it without touching the engine.
- Update media metadata only when the track changes and artwork is available locally. Clear it on queue completion.
- Retire window-only media-key handling once OS callbacks are verified while keeping in-app shortcuts.

### 6. Update the compact player UI

- Replace direct `audioElem` access in `src/components/audio-sidebar/player.tsx` with typed playback commands and snapshot data.
- Add volume/mute, repeat, shuffle, queue editing, output selection, and clear error/retry states using compact controls and native inputs.
- Keep elapsed-time updates at a visually sufficient rate, not audio-buffer frequency.
- Add no large transitions. Honor reduced motion and keep SoundBars optional/disableable.

### 7. Add ReplayGain safely

- Parse track/album ReplayGain tags during indexing and store normalized values.
- Apply gain before output with clipping prevention. Default to off until cross-format loudness tests pass.
- Expose off/track/album modes and preamp in Settings with conservative bounds.

## Verification

- Golden state-machine tests for all queue/repeat/shuffle transitions.
- Decoder/output integration fixtures for every supported codec, sample rate, channel count, tags, corrupt files, and missing files.
- Record loopback or buffer timestamps to quantify inter-track gap and duplicated/dropped samples.
- Test rapid transport commands, long seeks, sleep/wake, output unplug/replug, Bluetooth changes, and window close-to-tray.
- Verify OS lock-screen/menu media controls and artwork on all three platforms.

## Performance budgets

- Transport commands update state within 50 ms under normal load.
- No audible underruns during concurrent library scans on reference hardware.
- Decoder buffers remain bounded and do not grow with queue length.
- Position events reach the frontend no more than 5-10 times per second.

## Acceptance criteria

- Compatible consecutive tracks play gaplessly.
- Queue, repeat, shuffle, volume, output choice, and position survive restart according to policy.
- Media controls work when the window is unfocused or hidden to tray.
- Output loss and corrupt tracks produce recoverable, user-visible errors rather than a stuck player.
- The player adds no large animation or visualization surface.

## Rollout and rollback

- Keep transport adapters behind a feature flag until native playback passes codec/platform soak tests.
- Persist a versioned session format and tolerate older snapshots.
- If native output regresses a platform, ship that platform on the prior adapter without reverting the authoritative state/queue model.
