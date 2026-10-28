# Hardening part C: the fixes (2026-10-28)

Measured on Apple M1 (8 cores), Darwin 25.6.0 arm64, machine `local`: native `cargo test` runs, not the browser protocol. Wall times as `cargo test` and `time` report them, one run each; the machine otherwise idle.

## What changed

- **A shrink forgets every page wholly past the new end** (`src/pages.rs`, `PageCache::set_rows`): loaded pages' bytes freed, reads and `live`'s re-reads cancelled and draining; it returns every request to cancel, in page order, not one. `paging.json` gains the base scenario "a shrink past a page forgets the pages past it" and a control of a new `cache` kind, `keep-past-end` (the cache's `Control` now in every test build); a native unit test, `shrinking_forgets_every_page_past_the_new_end`.
- **A closed table cancels nothing again** (`src/state.rs`): `close` runs once; `set_rows` on a closed table sends no cancel.
- **A copy and the cache never read a page that grew under them at once** (`live` with `copy`): `PageCache::loading` is any read of the page the cache has out, short of the copy's rows or not (the copy waits for it); a prefetch re-read skips a page the copy reads or was just granted, as a first read does.
- **The random test without exclusions** (`src/state/random.rs`): the `Exclusion` list and its plumbing removed, the five scenario tests un-ignored as regressions, `ShrinkPast` generated (weight 4), the control `the_pages_past_a_shrink_kept`.
- From the code review (no correctness bug found): a closed table's `set_rows` leaves the cache as it was, not only the cancel (forgetting a page whose read `close` cancelled counted it draining twice, for good); `paging.json`'s "a shrink cancels the reads past it", a shrink with reads out past the new end; `TallTableState::set_rows`' docs say the shrink's rule; the cache's control read through `Control::keep_past_shrink` as its others are (the stub and `PageCache::control` no longer `live`'s); the test-only `Sent` down to the cache's read or the copy's.
- Decisions: `docs/DECISIONS.md`, "Table and paging", "Fixtures", "Features" (2026-10-28).

## Tests (C1, C2)

`just tall-table test`, its ten runs, each passing; the table's tests (the host's after the comma), and `cargo test`'s time for the table's:

| Run | Tests | Time |
|---|---|---|
| none | 39, 5 | 5.6 s |
| `custom-cells` | 56, 6 | 6.1 s |
| `live` | 64, 7 | 6.1 s |
| `custom-cells`, `live` | 92, 8 | 5.9 s |
| `follow` | 72, 8 | 6.0 s |
| `custom-cells`, `follow` | 100, 9 | 6.5 s |
| `resize` | 57, 5 | 6.7 s |
| `select` | 67, 5 | 33.4 s |
| `copy` | 112, 6 | 35.4 s |
| all on | 203, 10 | 42.4 s |

None ignored (part B: 2 to 5 in each run, the findings' scenario tests). The recipe: 3 min 57 s with its builds. `just tall-table lint` passes. After the code review's fixes, again: every run passing with the same counts (the second new scenario runs inside `paging_scenarios`), 3 min 39 s; `lint` passes.

`paging.json`'s new scenario ("a shrink past a page forgets the pages past it") passes natively in every run, and `keep-past-end` fails it (`paging_controls_fail`, every run: the scenario is the base's); with the scenario taken out, the control passed every other scenario, with and without `live`, so the new one is what catches it. The review's second scenario ("a shrink cancels the reads past it") pins the cancels a port must send, but doesn't catch the old rule: its plan, right after the shrink, cancels those reads as unwanted, the same requests. `just observatory fixtures` passes after `just observatory gpui-build`: the native fixtures, the TanStack contender's run (the new scenario and the `cache` control skipped, as a `rows` step and a fault in the table's code), the SQL fixture, and the cell fixture against the contender's build (254 cells).

## The controls (C2)

Each control over the all-on build's 48 cases, no shrinking; ✓ caught at its invariant, · passed every case:

| Control | Invariant | `SEED` 0 | 1 | 2 | 3 | 4 | 5 | 6 |
|---|---|---|---|---|---|---|---|---|
| the places leak | 1 | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |
| copy and prefetch on one page | 2 | ✓ | · | · | ✓ | ✓ | ✓ | ✓ |
| an end without a plan | 8 or 6 | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |
| the limit without draining reads | 1 | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |
| a failed read keeps its copy | 6 | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |
| a turn takes rows a page lacks | 7 | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |
| `close` leaves the copy's reads out | 3 | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |
| no eviction when a re-read lands | 4 | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |
| a shrink unclamped | 5 | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |
| the pages past a shrink kept (new) | 5 or 8 | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |

68 of 70 (part B: 57 of 63, nine controls); `SEED` 0, which `just tall-table test` runs, catches all ten. The new control is caught at 8 (a page shrunk to its start, kept, never read again with `live`) in `SEED` 0's first case that reaches it, so it asserts 5 or 8, the old rule's two symptoms.

**The shrink step's weight.** Generated at 8 (part A's draft), `ShrinkPast` cost copy and prefetch on one page its catches: caught at 3 of 7 `SEED`s (0 not among them), against 6 of 7 with the step not generated and 5 of 7 at weight 4, the weight kept. A shrink cuts the copy that control needs (`cut_copy`).

## The soak (C2)

`just tall-table soak` on the final code (4 `SEED`s × 500 cases, release with debug assertions and overflow checks, every feature on, no exclusions): `SEED`s 1–4 pass, 35–36 s each, 4 min 5 s with the rebuild (1 min 40 s); then `SEED`s 5–12, 33–37 s each, 4 min 44 s. 6,000 cases, none failing. After the code review's fixes, `SEED`s 1–4 again: all pass, 35–36 s each.

## Size (C3)

After the code review's fixes. `just tall-table size --against e8a1f9f --label hardening-c-size` (`2026-10-28-hardening-c-size.json`, 10 min 43 s): the base, built in a worktree at one fixed path at part C's parent and with part C, **0 KiB after wasm-opt** (9,680.2 KiB both; 13,092.4 KiB raw both) and +0.9 KiB brotli (2,688.1 → 2,689.0, brotli's noise when bytes shift); no failure. Built alone again by hand, the bare host's wasm after wasm-opt has the same length (9,912,552 bytes) and a different hash, so the change is in it and nets to no bytes there (Tycho's build, below, grew 1,023). Each feature's build as M7 recorded it (`copy` +17.0 KiB brotli over the base), and no feature's symbols in the base.

Each app that builds the table, its crate built alone at `e8a1f9f` and with part C, in one worktree at a fixed path:

| Build | After wasm-opt | Brotli | Its note |
|---|---|---|---|
| Tycho | +1,023 bytes | 2,853.6 → 2,853.8 KiB (+0.2) | `apps/tycho/perf/results/2026-10-28-tall-table-hardening.md` |
| The observatory's GPUI contender | +13 bytes | 2,707.8 → 2,707.0 KiB (−0.8, noise) | `apps/observatory/perf/results/2026-10-28-tall-table-hardening.md` |

`just tycho check` passed the wasm budget and failed reference TTFP (221.6 ms against 214.8, runs 199–259 ms, load 5–8 from a browser in use); an interleaved A/B against the parent's build read 196.0 against 198.2 ms, its spreads over the 6% gate: no change, not proven to 3% (Tycho's note). The contender's `sizes --check`, `reach`, and `fixtures` pass.

## Two step mixes, tried after the close

Half the cases drawn from a mix without `ShrinkPast`, the other half with it at weight 8, to let the copy-and-prefetch control's copies run: the ten controls across `SEED`s 0–6 caught 65 of 70 (that control missed at 4; a shrink unclamped at 1, a turn taking rows a page lacks at 5 and 6, the pages past a shrink kept at 5), against one mix's 68. Reverted; the limit is recorded in `docs/DECISIONS.md`, "Fixtures".

## Reproducing it

```sh
just tall-table size --against e8a1f9f --label hardening-c-size
just tall-table test
SEED=1 cargo test -p seiza-tall-table --features custom-cells,follow,resize,copy state::random::controls   # the controls over another seed's cases
just tall-table soak
just tall-table soak "5 6 7 8 9 10 11 12"
just observatory fixtures   # after `just observatory gpui-build`
```
