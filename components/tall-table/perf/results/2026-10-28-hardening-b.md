# Hardening part B: the random test of the paging (2026-10-28)

Measured on Apple M1 (8 cores), Darwin 25.6.0 arm64, machine `local`: native `cargo test` runs, not the browser protocol (no frame or byte numbers here). Wall times by `date`, one run each unless said; the machine otherwise idle.

## What changed

- `src/state/random.rs` (tests only): the random test, its scenario tests for the bugs it found, and its controls (`PLAN.md`, "Hardening"; `docs/DECISIONS.md`, "Fixtures").
- Test-only controls in shipped files: `copy`'s `Control` (five) in `src/state/copy.rs` and `close`, four more of the cache's (`src/pages.rs`), and the cache's test-only readers. Outside the tests each control is a constant `false` beside the code it guards; nothing new runs. Its size effect is measured with part C's fixes (C3: `just tall-table size --against`, after the code review).
- The request-id contract in `TallTableDelegate::Request`'s docs and the README; `copy_answered`'s comment.
- `just tall-table soak`.
- From the code review: each read judged as it went out (the source records the reads open when it sends one, the cache logs what each read was started for), so a read answered when sent is held to invariants 1 and 2 too; the grown-page exclusion narrowed to each finding's order; the crate's test delegates (selection, resize, paint fixtures) count their ids.

## Run time (B1)

`just tall-table test`'s ten runs, each after its build (`cargo test -p seiza-tall-table -p tall-table-host` with the run's features):

| Run | Wall | Tests |
|---|---|---|
| none | 9 s | 35 passed, 2 ignored |
| `custom-cells` | 8 s | 52, 2 |
| `live` | 8 s | 59, 3 |
| `custom-cells`, `live` | 9 s | 87, 3 |
| `follow` | 9 s | 67, 3 |
| `custom-cells`, `follow` | 10 s | 95, 3 |
| `resize` | 10 s | 53, 2 |
| `select` | 35 s | 63, 2 |
| `copy` | 37 s | 108, 2 |
| all on | 46 s | 196, 5 |

On the final code. The table's tests; the host's are a few more, all passing. The ignored are the findings' scenario tests, by the features each needs; the controls' tests are built with their features and return at once outside the all-on run.

The all-on run against itself without the random tests (`-- --skip state::random`), two runs each: 41 s and 42 s without, 46 s and 47 s with: **~5 s on the all-on run's wall** (eight test threads; `selection_controls_fail` ~33 s on one of them, the random test and its nine controls on the rest). The main test alone, 48 cases: 16.7–19.9 s over `SEED`s 0–7, every one passing.

## The controls (B2)

Each control (a test-only fault) run over the all-on build's 48 cases, no shrinking, failing at the first case that catches it; ✓ caught at its invariant, · passed every case:

| Control | Invariant | `SEED` 0 | 1 | 2 | 3 | 4 | 5 | 6 |
|---|---|---|---|---|---|---|---|---|
| the places leak | 1 | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |
| copy and prefetch on one page | 2 | ✓ | ✓ | ✓ | · | ✓ | · | ✓ |
| an end without a plan | 8 or 6 | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |
| the limit without draining reads | 1 | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |
| a failed read keeps its copy | 6 | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |
| a turn takes rows a page lacks | 7 | ✓ | · | ✓ | ✓ | ✓ | ✓ | · |
| `close` leaves the copy's reads out | 3 | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |
| no eviction when a re-read lands | 4 | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |
| a shrink unclamped | 5 | ✓ | · | ✓ | ✓ | ✓ | · | ✓ |

57 of 63, on the final code (after the code review's fixes; 59 of 63 before them, on the draw before half of growths filled the last page). `just tall-table test` runs `SEED` 0 (unset), which catches all nine. With 16 cases (the spec's count) and the same draw, 43 of 63, and `SEED` 0 catches six (missing copy and prefetch on one page, a turn taking rows a page lacks, `close` leaving the copy's reads out); caught at every `SEED`: only the places leak, the limit, a failed read keeping its copy, and no eviction when a re-read lands but once. The two that trade against each other by the draw: the shrink unclamped wants more shrinks within a full last page, copy and prefetch on one page fewer (a shrink cancels a copy reaching the cut rows); a third of growths filling the last page missed the first at `SEED` 0, more shrinks within missed the second at five `SEED`s.

## Getting the controls to fail

The first build's 16 cases caught two of the nine (the places leak, the limit); the invariants weren't wrong, the cases never reached the faults' states. Per-case counters (removed) showed why: `close` every few dozen steps taking the rest of its case (one case closed for 230 of its 260 steps), most cases with one read open at most (reads answered when sent half the time), copies with reads out in ~4% of steps, and a full last page almost never. The changes, each in `docs/DECISIONS.md`, "Fixtures", were made a few at a time between seven-`SEED` runs, so no one of them is credited with a count here:

- a new table after `close` (eight steps, a drain, a table over the source), so closes could be ~1 step in 50;
- half the tables fitting the viewport, and half of growths filling the last page (the shrink-unclamped control needs a full last page in view: 0 of 7 `SEED`s before);
- "nothing stalls" and "every copy ends" checked whenever no read is open (the end without a plan: 0 of 7 before, its stall hidden by the drain's settle timer);
- the budget checked after any landing, and while following when reads are held;
- `max_in_flight` and budgets skewed low, far selections, fewer failed answers, drains in either order;
- 48 cases.

## Found (B3)

Recorded in `PLAN.md`, "Hardening", each with its shrunk steps, scenario test, and exclusion:

| Finding | First found | Shrunk to |
|---|---|---|
| A shrink past a page | the first run, `SEED` 0 | 6 steps, the whole run (finding and shrinking) 24 s |
| A closed table cancels a read again | the second run, `SEED` 0 | 6 steps |
| A prefetch re-read beside a copy's read | `SEED` 3 | 15 steps, the run 89 s |
| A copy beside a short read of a grown page | the soak, `SEED` 3 | 7 steps |

The second hid the controls: all of them failed it first, at invariant 1, until its exclusion.

## The soak

`just tall-table soak` (4 `SEED`s × 500 cases, release with debug assertions and overflow checks, every feature on): ~0.07 s a case, 36–40 s a `SEED`, 4 min 17 s with the release build's rebuild (1 min 42 s for the first, the dependencies already built). Its first run found a fourth bug at `SEED` 3 (found and shrunk to 7 steps in a 16 s run): a copy reading a grown page beside the cache's read sent before it grew, off screen (`PLAN.md`, "Found by the random test", 4). With that pair excluded, `SEED`s 1–4 passed, and 5–12 after them (6,000 cases in all). After the code review's fixes (each read judged as it went out, so those answered when sent are checked too; the exclusion narrowed to each finding's order), `SEED`s 1–12 again: all pass, 34–36 s a `SEED`.

## Reproducing it

```sh
just tall-table test
SEED=3 cargo test -p seiza-tall-table --features custom-cells,follow,resize,copy state::random   # another seed's cases, and the controls
cargo test -p seiza-tall-table --features custom-cells,follow,resize,copy state::random -- --include-ignored   # the findings' scenario tests fail
just tall-table soak
```
