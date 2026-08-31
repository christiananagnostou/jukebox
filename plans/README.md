# Jukebox implementation plans

Reconciled by the `improve` audit on 2026-08-30 at `331967f`. Execute focused plans in the order below unless dependencies say otherwise. Each executor must read its plan fully, honor its STOP conditions, run every verification gate, and update the status row when done.

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
| [035](035-data-safe-app-identity.md)               | Stabilize packaging and nonblocking desktop playback                | P1       | M      | 034        | DONE   |
| [036](036-native-library-facets.md)                | Add complete metadata and bounded native filters/facets             | P1       | M      | 035        | DONE   |
| [037](037-playlist-repository-foundation.md)       | Establish a durable native manual-playlist repository               | P1       | M      | 036        | DONE   |
| [038](038-playlist-workspace.md)                   | Add a compact bounded manual-playlist workspace                     | P1       | M      | 037        | DONE   |
| [039](039-editable-persistent-queue.md)            | Expose duplicate-safe persistent queue editing                      | P1       | S      | 038        | DONE   |
| [040](040-listening-history-foundation.md)         | Capture bounded privacy-conscious listening history                 | P1       | M      | 039        | DONE   |
| [041](041-history-powered-collections.md)          | Add bounded history-powered built-in collection queries             | P1       | M      | 040        | DONE   |
| [042](042-built-in-collection-workspace.md)        | Surface built-in collections in the compact playlist workspace      | P1       | M      | 041        | DONE   |
| [043](043-reversible-queue-edits.md)               | Add authoritative one-step undo for structural queue edits          | P1       | S      | 042        | DONE   |
| [044](044-manual-playlist-workflows.md)            | Add bounded playlist duplication and keyboard entry reordering      | P1       | M      | 043        | DONE   |
| [045](045-local-pre-push-quality-gate.md)          | Add one executable local frontend and Rust pre-push quality gate    | P1       | S      | 044        | DONE   |
| [046](046-smart-playlist-foundation.md)            | Add a versioned bounded native smart-playlist rule foundation       | P1       | L      | 045        | DONE   |
| [047](047-m3u-interoperability.md)                 | Add bounded native M3U/M3U8 import and export interoperability      | P1       | L      | 046        | DONE   |
| [048](048-smart-playlist-workspace.md)             | Add a compact bounded smart-playlist editor and results workspace   | P1       | L      | 047        | DONE   |
| [049](049-m3u-workspace.md)                        | Surface bounded review-first M3U import and manual export workflows | P1       | M      | 048        | DONE   |
| [050](050-playback-workspace-foundation.md)        | Establish a compact authoritative playback workspace                | P1       | M      | 030, 043   | DONE   |
| [051](051-blue-playback-drawer.md)                 | Refine the playback drawer palette and upcoming activation          | P1       | S      | 050        | DONE   |
| [052](052-navigation-command-import-foundation.md) | Establish Library Index navigation, commands, Listen, and import    | P1       | L      | 051        | DONE   |
| [053](053-settings-remote-workspaces.md)           | Split settings and promote private remote listening                 | P1       | M      | 052        | DONE   |
| [054](054-instant-playback-interaction-polish.md)  | Make track activation instant and simplify interaction hierarchy    | P1       | M      | 053        | DONE   |
| [055](055-focused-artist-album-workspaces.md)      | Add exact bounded artist and album workspaces                       | P1       | M      | 054        | DONE   |
| [056](056-adopt-metadata-deep-links.md)            | Link artist and album metadata throughout the app                   | P1       | M      | 055        | DONE   |
| [057](057-windows-release-parity.md)               | Add Windows CI and installer portability parity                     | P1       | M      | —          | TODO   |
| [058](058-testable-private-pwa-playback-core.md)   | Establish a testable private-PWA playback core                      | P1       | M      | —          | TODO   |
| [059](059-durable-blue-private-pwa.md)             | Make private iPhone listening durable, blue, and recoverable        | P1       | M      | 058        | TODO   |
| [060](060-native-output-real-device-gate.md)       | Prove native audio output on supported desktop platforms            | P1       | L      | 057        | TODO   |

Plans 007-010 are deliberately independent and may be delivered as separate PRs. Plan 011 follows plans 007 and 008 because it extends the router fixture and must inherit proven mutation/failure semantics. Plans 012-016 deliver the native refresh pipeline in persistence, discovery, preparation, atomic apply, and orchestration layers. Plan 017 adds bounded watcher scheduling and recovery over that authoritative full refresh. Plan 018 adopts the service in Settings, and plan 019 makes the 100,000-track performance targets executable.

Plans 057-060 are the next evidence-backed phase. Plan 057 establishes Windows compile/package parity before any native-output choice. Plan 058 characterizes the private PWA's device-local playback semantics; plan 059 then adds bounded paused restore, queue recovery, and steel-blue mobile polish without making the remote API mutable. Plan 060 is a reversible native-output gate that may not replace production playback until real-device evidence exists on macOS, Windows, and Linux.

## Strategic roadmap status

| Plan                                              | Outcome                                                         | Status on 2026-08-30                                                                                                                                                                                                                                                                                                             |
| ------------------------------------------------- | --------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [001](001-quality-security-release-foundation.md) | Migrations, diagnostics, permissions, identity, release quality | IN PROGRESS — migrations, diagnostics, Rust quality gates, portability, build-path remapping, renderer SQL/filesystem-plugin narrowing, exact asset scope, and production CSP are complete; plan 057 covers Windows parity, while signed release identity, signing, and updater remain                                           |
| [002](002-native-library-index.md)                | Incremental scanning, watching, FTS, bounded frontend memory    | IN PROGRESS — plans 011-026 and 036 delivered the native refresh pipeline, executable 100k-track budgets, bounded routes, complete track metadata, indexed filters/facets, renderer-memory cleanup, shared mutation pool ownership, and bounded artwork lifecycle                                                                |
| [003](003-playback-engine-and-os-integration.md)  | Reliable restart-safe playback and OS integration               | IN PROGRESS — plans 009 and 028-031 delivered native authority, browser parity, restart-safe recovery, six-codec decode, exact seek, and sample-boundary evidence; plan 060 is the next reversible real-device native-output gate                                                                                                |
| [004](004-playlists-queue-and-history.md)         | Durable collections, queue, and history                         | IN PROGRESS — stable native queue entries, desktop parity, committed session/queue persistence, bounded history-powered built-ins, duplicate-preserving manual-playlist workflows, smart rules, and review-first M3U interoperability are complete; multi-select remains                                                         |
| [005](005-fast-accessible-interface.md)           | Compact, keyboard-complete, motion-light UI                     | IN PROGRESS — plans 050-056 delivered the playback workspace, blue drawer, Library Index navigation, focused settings, instant activation, exact artist/album workspaces, and metadata deep links; multi-select and broader collection keyboard parity remain                                                                    |
| [006](006-private-remote-listening.md)            | Private iPhone browsing and playback                            | IN PROGRESS — loopback streaming, one-click Tailscale controls, port coexistence, installable PWA shell, bounded artist/album drill-down, native-root authorization, continuation, and lock-screen transport are complete; plans 058-059 add tested durable device-local queue/recovery without weakening the read-only boundary |

## Dependency notes

- 007 protects the user-visible iPhone/Tailscale feature before it grows additional API surface.
- 008 prevents transient filesystem or mid-batch failures from losing catalog state and creates the mutation contract that 011 must preserve.
- 009 freezes current queue/transport semantics before plan 003 changes playback ownership.
- 010 prevents silent settings loss and makes database startup failures diagnosable; its structured error shape can feed plan 001 diagnostics.
- 011 is the architectural spine for plan 002, plan 004 collections, and plan 006 mobile browsing. It migrates reads first and intentionally does not start native scanning.
- 012 establishes constrained scan state and non-destructive root lifecycle before traversal or reconciliation can mutate catalog availability.
- 013-016 preserve the staged pipeline boundary: discovery and metadata work remain invisible until one validated transaction publishes the complete root snapshot.
- 056 depends on 055 because every metadata surface must reuse one validated exact-destination contract and independently accepted focused workspace.
- 059 depends on 058 because persistence and mobile interaction must build on executable queue/seek/error semantics instead of the current untested global script.
- 060 depends on 057 because a native output candidate must at minimum compile and pass strict tests on Windows as well as macOS and Linux before real-device evidence can be evaluated.

## Findings considered and deferred

- FTS-rich filters and facets are active in plan 036; plan 026 addresses content-addressed artwork and post-commit cache collection.
- A native playback backend and gapless output remain plan 003. Plan 060 may choose only an optional output adapter after declaring OS baselines and collecting three-platform real-device evidence; it may not switch production transport.
- Windows packaging, signing, updater support, and a future signed-identity permission migration remain plan 001. Direct renderer filesystem inspection and production CSP are complete; plan 035 preserves the established identity while removing the obsolete renderer SQL surface and main-thread playback I/O.
- Shared desktop/iPhone queue ownership and optional bounded HLS fallback remain later phases of plan 006. Plans 058-059 intentionally keep the iPhone session device-local and the HTTP API read-only until authentication, revision, and output-zone semantics are designed.
- Bundle-identifier migration remains deferred until a signed, permission-aware upgrade path can preserve existing protected-folder access; changing `com.jukebox.app` as routine metadata cleanup is rejected.
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
