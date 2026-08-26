# Deterministic large-library performance budgets

## Status

DONE on branch `codex/019-library-performance-budgets`.

## Objective

Turn the 100,000-track targets in plan 002 into a repeatable benchmark and CI-safe structural contracts, then remove the highest-leverage database overhead the baseline exposes.

## Scope

1. Generate a deterministic 100,000-track SQLite fixture without depending on a user's music or filesystem layout.
2. Measure first-page browse, FTS search, continuation-page, no-change preparation, and atomic publish latency in an opt-in release benchmark.
3. Keep wall-clock assertions out of ordinary CI while enforcing query-plan, result-bound, and reconciliation-window invariants in normal tests.
4. Increase the no-change reconciliation query window if the baseline confirms database round trips dominate while memory remains bounded.
5. Document the exact command, reference budgets, fixture shape, and interpretation rules.

## Non-goals

- No benchmark against a user's real library.
- No hardware-specific constants or tracked absolute paths.
- No frontend redesign, animation, playback-engine change, or new product feature.
- No claim that a synthetic database measures filesystem enumeration or audio metadata decoding.

## Performance contracts

- Browse, indexed sort, FTS search, and continuation return at most 100 tracks.
- Representative browse SQL uses the matching catalog index without a temporary sort.
- Representative text search uses the FTS5 virtual table.
- Reconciliation reads a bounded window and writes metadata in a separately bounded batch.
- On supported development hardware, p95 catalog queries stay below 100 ms on the reference 100,000-track fixture.
- No-change preparation and publish budgets are reported separately so discovery, preparation, and transaction costs are not conflated.

## Verification

- `cd src-tauri && cargo test --locked`
- `cd src-tauri && cargo test --release --locked reference_100k_library_performance -- --ignored --nocapture`
- `cd src-tauri && cargo fmt -- --check && cargo clippy --locked --all-targets -- -D warnings`
- `npm run lint && npm run build.types && npm test && npm run build`
- `git diff --check`

## Baseline and result

The same opt-in release benchmark was run immediately before and after changing the reconciliation read window. Fixture generation is excluded from every timed sample.

| Metric                   | 100-row read window | 1,000-row read window |
| ------------------------ | ------------------: | --------------------: |
| Browse first-page p95    |            0.592 ms |              0.596 ms |
| FTS search p95           |            0.902 ms |              0.968 ms |
| Browse continuation p95  |            0.588 ms |              0.616 ms |
| No-change preparation    |            636.6 ms |              268.9 ms |
| Atomic no-change publish |            425.0 ms |              418.9 ms |

The larger bounded read window reduced no-change preparation by about 58%. Metadata writes remain capped at 100 rows, so SQLite bind counts and staged-memory growth do not inherit the larger read bound. Query and publish measurements stayed within normal run-to-run variance.

## Delivery

This phase targets `master` as one focused PR after plan 018. The benchmark is opt-in because shared CI runners are not stable performance reference machines; deterministic structural assertions remain in the normal suite.
