# Jukebox improvement roadmap

Planned against `aea10ca4c4c6d01d5d7716d873fde4ef49ae70c0` after the cleanup stack in PRs #41-#44.

## Recommended sequence

| Order | Plan                                                                                     | Outcome                                                                    | Depends on                                            |
| ----- | ---------------------------------------------------------------------------------------- | -------------------------------------------------------------------------- | ----------------------------------------------------- |
| 1     | [001-quality-security-release-foundation.md](001-quality-security-release-foundation.md) | Trustworthy migrations, tests, diagnostics, permissions, and packaging     | PRs #41-#44                                           |
| 2     | [002-native-library-index.md](002-native-library-index.md)                               | Incremental native scanning, file watching, FTS search, bounded memory     | Plan 001 migrations                                   |
| 3     | [003-playback-engine-and-os-integration.md](003-playback-engine-and-os-integration.md)   | Gapless playback, reliable queue state, media controls, output selection   | Plan 001 diagnostics; coordinate schema with plan 004 |
| 4     | [004-playlists-queue-and-history.md](004-playlists-queue-and-history.md)                 | Persistent playlists, smart collections, editable queue, listening history | Plan 001 migrations; plan 002 query API               |
| 5     | [005-fast-accessible-interface.md](005-fast-accessible-interface.md)                     | Denser, clearer, keyboard-complete interface without decorative motion     | Stable APIs from plans 002-004                        |

Plans 2 and 3 can begin in parallel after plan 1 if separate owners agree on the event and persistence contracts first. Plan 5 should be implemented continuously in small slices, but its final information architecture should wait until the library, playback, and collection models are stable.

## Product direction

The strongest direction is a local-first player: instant over large on-disk libraries, reliable offline playback, powerful keyboard control, transparent file management, and no account requirement. Remote streaming, social features, visualizers, and large animated surfaces are explicitly outside this roadmap. They add complexity without improving the core promise.

## Success measures

- A 100,000-track library opens without loading every row into frontend memory.
- Repeat scans only process changed files and react to filesystem changes automatically.
- Track transitions are gapless for compatible formats and remain correct after sleep/wake or output-device changes.
- Queue, playlists, playback position, and settings survive restart.
- Every primary operation is usable by keyboard and screen reader.
- Release artifacts are signed, updateable, permission-scoped, and covered by macOS, Windows, and Linux CI.
