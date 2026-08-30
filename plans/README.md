# Jukebox implementation plans

Reconciled by the `improve` audit on 2026-08-26. Execute focused plans 007-037 in the order below unless dependencies say otherwise. Each executor must read its plan fully, honor its STOP conditions, run every verification gate, and update the status row when done.

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
| [022](022-native-storage-query.md)                 | Add a bounded native storage hierarchy contract                     | P1       | M      | 021        | DONE   |
| [023](023-native-storage-route.md)                 | Migrate Storage to bounded native pages                             | P1       | M      | 022        | DONE   |
| [024](024-remove-legacy-catalog.md)                | Remove renderer full-catalog compatibility                          | P1       | M      | 023        | DONE   |
| [025](025-shared-catalog-mutation-pool.md)         | Reuse the managed catalog pool for mutations                        | P1       | S      | 024        | DONE   |
| [026](026-artwork-cache-lifecycle.md)              | Deduplicate and safely collect cached artwork                       | P1       | M      | 025        | DONE   |
| [027](027-mobile-library-browsing.md)              | Add bounded artist and album browsing to the private PWA            | P1       | M      | 026        | DONE   |
| [028](028-playback-state-foundation.md)            | Establish the authoritative playback state                          | P1       | M      | 027        | DONE   |
| [029](029-native-playback-parity.md)               | Route browser playback through native state                         | P1       | L      | 028        | DONE   |
| [030](030-playback-session-persistence.md)         | Restore committed playback sessions and queues                      | P1       | L      | 029        | DONE   |
| [031](031-native-decoder-feasibility.md)           | Prove bounded native decoder feasibility                            | P1       | M      | 030        | DONE   |
| [032](032-privacy-conscious-diagnostics.md)        | Add bounded privacy-conscious local diagnostics                     | P1       | M      | 031        | DONE   |
| [033](033-native-import-path-inspection.md)        | Remove direct renderer filesystem inspection                        | P1       | S      | 032        | DONE   |
| [034](034-exact-track-asset-scope.md)              | Authorize exact playback assets and enable production CSP           | P1       | M      | 033        | DONE   |
| [035](035-data-safe-app-identity.md)               | Stabilize packaging and nonblocking desktop playback                | P1       | M      | 034        | ACTIVE |
| [036](036-native-library-facets.md)                | Add complete metadata and bounded native filters/facets             | P1       | M      | 035        | DONE   |
| [037](037-playlist-repository-foundation.md)       | Establish a durable native manual-playlist repository               | P1       | M      | 036        | DONE   |

Plans 007-010 are deliberately independent and may be delivered as separate PRs. Plan 011 follows plans 007 and 008 because it extends the router fixture and must inherit proven mutation/failure semantics. Plans 012-016 deliver the native refresh pipeline in persistence, discovery, preparation, atomic apply, and orchestration layers. Plan 017 adds bounded watcher scheduling and recovery over that authoritative full refresh. Plan 018 adopts the service in Settings, and plan 019 makes the 100,000-track performance targets executable.

## Strategic roadmap status

| Plan                                              | Outcome                                                         | Status on 2026-08-27                                                                                                                                                                                                                                              |
| ------------------------------------------------- | --------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [001](001-quality-security-release-foundation.md) | Migrations, diagnostics, permissions, identity, release quality | IN PROGRESS — migrations, diagnostics, Rust quality gates, portability, build-path remapping, renderer SQL/filesystem-plugin narrowing, exact asset scope, and production CSP are complete; identity migration, Windows, signing, and updater remain              |
| [002](002-native-library-index.md)                | Incremental scanning, watching, FTS, bounded frontend memory    | IN PROGRESS — plans 011-026 and 036 delivered the native refresh pipeline, executable 100k-track budgets, bounded routes, complete track metadata, indexed filters/facets, renderer-memory cleanup, shared mutation pool ownership, and bounded artwork lifecycle |
| [003](003-playback-engine-and-os-integration.md)  | Reliable restart-safe playback and OS integration               | IN PROGRESS — plans 009 and 028-031 delivered native authority, browser parity, restart-safe recovery, six-codec decode, exact seek, and sample-boundary evidence; real-device native output remains                                                              |
| [004](004-playlists-queue-and-history.md)         | Durable collections, queue, and history                         | IN PROGRESS — stable native queue entries, desktop parity, committed session/queue persistence, and the named manual-playlist repository are complete; playlist UI, reordering, smart rules, history, and broader collection workflows remain                     |
| [005](005-fast-accessible-interface.md)           | Compact, keyboard-complete, motion-light UI                     | TODO — small accessibility fixes may land continuously; structural work follows stable APIs                                                                                                                                                                       |
| [006](006-private-remote-listening.md)            | Private iPhone browsing and playback                            | IN PROGRESS — loopback streaming, one-click Tailscale controls, port coexistence, installable PWA shell, bounded artist/album drill-down, native-root authorization, continuation, and lock-screen transport are complete                                         |

## Dependency notes

- 007 protects the user-visible iPhone/Tailscale feature before it grows additional API surface.
- 008 prevents transient filesystem or mid-batch failures from losing catalog state and creates the mutation contract that 011 must preserve.
- 009 freezes current queue/transport semantics before plan 003 changes playback ownership.
- 010 prevents silent settings loss and makes database startup failures diagnosable; its structured error shape can feed plan 001 diagnostics.
- 011 is the architectural spine for plan 002, plan 004 collections, and plan 006 mobile browsing. It migrates reads first and intentionally does not start native scanning.
- 012 establishes constrained scan state and non-destructive root lifecycle before traversal or reconciliation can mutate catalog availability.
- 013-016 preserve the staged pipeline boundary: discovery and metadata work remain invisible until one validated transaction publishes the complete root snapshot.

## Findings considered and deferred

- FTS-rich filters and facets are active in plan 036; plan 026 addresses content-addressed artwork and post-commit cache collection.
- A native playback backend and gapless output remain plan 003. Do not choose a decoder/output stack before plan 009's state-machine tests and the existing feasibility gate.
- Windows packaging, signing, updater support, and a future signed-identity permission migration remain plan 001. Direct renderer filesystem inspection and production CSP are complete; plan 035 preserves the established identity while removing the obsolete renderer SQL surface and main-thread playback I/O.
- Shared queue state and optional bounded HLS fallback remain later phases of plan 006; mobile artist/album browsing and Media Session transport handlers landed in plan 027.
- Separate filesystem-discovery and changed-metadata benchmarks remain useful additions to the existing executable 100,000-track query and no-change preparation budgets.
- Narrowing Symphonia features is deferred until one metadata fixture exists for every supported format; binary-size savings do not justify risking format regressions now.
- Redundant direct TypeScript-ESLint packages are real but low leverage and can be removed during routine dependency maintenance after the P1 work.
- The current Qwik/sharp advisories are confined to the trusted build toolchain, and npm's offered fix is an inappropriate framework downgrade. Continue monitoring rather than forcing that downgrade.

## Success measures

- Private access start/stop never mutates another app's Tailscale endpoint and works when a valid CLI exists behind a stale candidate.
- A permission or I/O error never causes “remove missing files” to delete a valid catalog row.
- Failed playback does not silently consume a queued track or leave an unhandled transition rejection.
- Interrupted settings writes preserve the last valid configuration, and database startup failures produce an actionable UI state.
- A 100,000-track library can be queried without loading every row into frontend memory; the same native query contract serves desktop and mobile callers.
