# Jukebox implementation plans

Reconciled by the `improve` audit on 2026-08-26. Execute focused plans 007-021 in the order below unless dependencies say otherwise. Each executor must read its plan fully, honor its STOP conditions, run every verification gate, and update the status row when done.

The product direction remains local-first: a fast native catalog, dependable playback, durable collections, a compact accessible interface, and private iPhone listening through loopback-only Jukebox HTTP plus Tailscale Serve. Public sharing, mandatory accounts, visualizers, and large decorative animations remain out of scope.

## Execution order and status

| Plan                                               | Title                                                               | Priority | Effort | Depends on | Status |
| -------------------------------------------------- | ------------------------------------------------------------------- | -------- | ------ | ---------- | ------ |
| [007](007-private-listening-contract-tests.md)     | Harden Tailscale discovery and private-listening boundaries         | P1       | M      | —          | DONE   |
| [008](008-library-mutation-safety.md)              | Make library cleanup and chunked mutations failure-safe             | P1       | M      | —          | DONE   |
| [009](009-playback-transition-characterization.md) | Characterize playback transitions and preserve failed queue entries | P1       | M      | —          | DONE   |
| [010](010-settings-and-bootstrap-durability.md)    | Make settings persistence atomic and bootstrap failures visible     | P1       | M      | —          | DONE   |
| [011](011-native-catalog-query-foundation.md)      | Establish a paged native catalog query service                      | P1       | L      | 007, 008   | DONE   |
| [012](012-native-scan-state-foundation.md)         | Persist roots, scan generations, and incremental file state         | P1       | M      | 011        | DONE   |
| [013](013-native-scan-discovery.md)                | Discover and stage files through a bounded native pipeline          | P1       | L      | 012        | DONE   |
| [014](014-scan-metadata-staging.md)                | Prepare changed metadata without changing the visible catalog       | P1       | L      | 013        | DONE   |
| [015](015-atomic-scan-reconciliation.md)           | Apply one scan snapshot through a failure-safe catalog transaction  | P1       | L      | 014        | DONE   |
| [016](016-native-library-refresh.md)               | Compose scan, preparation, and apply into one cancellable operation | P1       | M      | 015        | DONE   |
| [017](017-library-watchers.md)                     | Schedule recoverable full refreshes from bounded filesystem hints   | P1       | M      | 016        | DONE   |
| [018](018-native-library-settings.md)              | Adopt native roots, refreshes, and watcher health in Settings       | P1       | L      | 017        | DONE   |
| [019](019-library-performance-budgets.md)          | Establish deterministic large-library performance budgets           | P1       | M      | 018        | DONE   |
| [020](020-native-album-artist-aggregates.md)       | Add bounded native album and artist aggregate contracts             | P1       | M      | 019        | DONE   |
| [021](021-native-album-artist-routes.md)           | Migrate album and artist routes to bounded native pages             | P1       | L      | 020        | DONE   |

Plans 007-010 are deliberately independent and may be delivered as separate PRs. Plan 011 follows plans 007 and 008 because it extends the router fixture and must inherit proven mutation/failure semantics. Plans 012-016 deliver the native refresh pipeline in persistence, discovery, preparation, atomic apply, and orchestration layers. Plan 017 adds bounded watcher scheduling and recovery over that authoritative full refresh. Plan 018 adopts the service in Settings, and plan 019 makes the 100,000-track performance targets executable.

## Strategic roadmap status

| Plan                                              | Outcome                                                         | Status on 2026-08-26                                                                                                                                                                                              |
| ------------------------------------------------- | --------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [001](001-quality-security-release-foundation.md) | Migrations, diagnostics, permissions, identity, release quality | IN PROGRESS — migrations plus Rust fmt/test/Clippy CI landed in PR #48; diagnostics, permission narrowing, identity migration, Windows, signing, and updater remain                                               |
| [002](002-native-library-index.md)                | Incremental scanning, watching, FTS, bounded frontend memory    | IN PROGRESS — plans 011-019 delivered bounded queries/memory, a watcher-driven native refresh pipeline, native Settings adoption, and executable 100k-track performance budgets; aggregate views remain           |
| [003](003-playback-engine-and-os-integration.md)  | Reliable restart-safe playback and OS integration               | TODO — plan 009 establishes the characterization gate                                                                                                                                                             |
| [004](004-playlists-queue-and-history.md)         | Durable collections, queue, and history                         | TODO — depends on stable catalog and playback contracts                                                                                                                                                           |
| [005](005-fast-accessible-interface.md)           | Compact, keyboard-complete, motion-light UI                     | TODO — small accessibility fixes may land continuously; structural work follows stable APIs                                                                                                                       |
| [006](006-private-remote-listening.md)            | Private iPhone browsing and playback                            | IN PROGRESS — loopback streaming, one-click Tailscale controls, port coexistence, installable PWA shell, and indexed cursor-ready mobile catalog API are complete; deeper mobile browsing and shared queue remain |

## Dependency notes

- 007 protects the user-visible iPhone/Tailscale feature before it grows additional API surface.
- 008 prevents transient filesystem or mid-batch failures from losing catalog state and creates the mutation contract that 011 must preserve.
- 009 freezes current queue/transport semantics before plan 003 changes playback ownership.
- 010 prevents silent settings loss and makes database startup failures diagnosable; its structured error shape can feed plan 001 diagnostics.
- 011 is the architectural spine for plan 002, plan 004 collections, and plan 006 mobile browsing. It migrates reads first and intentionally does not start native scanning.
- 012 establishes constrained scan state and non-destructive root lifecycle before traversal or reconciliation can mutate catalog availability.
- 013-016 preserve the staged pipeline boundary: discovery and metadata work remain invisible until one validated transaction publishes the complete root snapshot.

## Findings considered and deferred

- Art-cache deduplication, FTS-rich facets, benchmark fixtures, and frontend adoption remain high-impact plan 002 work; plans 011-017 provide the bounded query and recoverable native refresh foundation.
- A native playback backend and gapless output remain plan 003. Do not choose a decoder/output stack before plan 009's state-machine tests and the existing feasibility gate.
- Windows packaging, signing, updater support, CSP/runtime scope narrowing, diagnostics, and app-identity migration remain plan 001. Permission narrowing depends on catalog/filesystem ownership moving behind Rust.
- Mobile album/artist browsing, Media Session transport handlers, shared queue, and optional HLS fallback remain phases 3-5 of plan 006 and depend on plans 009 and 011.
- Performance budgets need an executable 100k-track fixture and benchmark harness. Add that within plan 002 when query and scan APIs exist; a benchmark around the current full-array architecture would be short-lived.
- Narrowing Symphonia features is deferred until one metadata fixture exists for every supported format; binary-size savings do not justify risking format regressions now.
- Redundant direct TypeScript-ESLint packages are real but low leverage and can be removed during routine dependency maintenance after the P1 work.
- The current Qwik/sharp advisories are confined to the trusted build toolchain, and npm's offered fix is an inappropriate framework downgrade. Continue monitoring rather than forcing that downgrade.

## Success measures

- Private access start/stop never mutates another app's Tailscale endpoint and works when a valid CLI exists behind a stale candidate.
- A permission or I/O error never causes “remove missing files” to delete a valid catalog row.
- Failed playback does not silently consume a queued track or leave an unhandled transition rejection.
- Interrupted settings writes preserve the last valid configuration, and database startup failures produce an actionable UI state.
- A 100,000-track library can be queried without loading every row into frontend memory; the same native query contract serves desktop and mobile callers.
