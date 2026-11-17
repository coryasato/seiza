# Hardening 2 part B: the random test grown, and every feature pair (2026-11-16)

Measured on Apple M1 (8 cores), Darwin 25.6.0 arm64, machine `local`: native `cargo test` and `cargo clippy` runs, not the browser protocol (no frame or byte numbers here). Wall times by `time`, one run each unless said; the machine otherwise idle for the runs timed.

## What changed

- `src/state/random.rs` (tests only): the pointer's gestures as placed steps (`Down` in a zone, `Drag`, `PointerWheel`, `Up`), a header's drags as those steps (`DragColumns` gone), invariants 11 to 18, their ten controls, what a host last heard of each event (`Heard`), a shrink over the case as run, six exclusions with their `#[ignore]`d scenario tests (`PLAN.md`, "Found by the random test").
- Test-only items in shipped files, each behind `#[cfg(test)]`: `resize`'s `Control` (`KeepOnRelease`, `Unclamped`) and the bands a frame drew; `pin`'s `HitIgnoresRun` and `SilentRepin`; `reorder`'s `BlockOverNeighbor` and `SilentReset`; `DrawnText::visible`; `Flashes::past`. Outside the tests the source is what it was (one `if` in `set_columns` now holds a second on the same flag, where the test's control sits), so no build's bytes should change; not measured here (part C measures the fixes' with `size --against`).
- `perf/pairs.ts` and `just tall-table pairs`; the soak's features gain `clicks`; `ALL_ON` gains `clicks` and `group-headers`.

## Run time (B1)

Against the commit before, on the same machine and day:

| Run | Before | After |
|---|---|---|
| The all-on run of `just tall-table test` (the table's tests) | 64.9 s (383 tests) | 88.3 s (393, 6 ignored); 84.3 s in an earlier run |
| The random test alone, all on, 48 cases | 33.0 s | 39.4 s |
| `just tall-table test`, its 18 runs | not timed | 5 min 16 s |

Each other run's tests take 5 to 7 s (`select` 15 s, `copy` 16 s), their random test 16 cases with the gestures in the zones the run's features have. The all-on run's 23 s are the ten new controls more than the gestures: each control runs the cases until one fails, on eight threads beside `selection_controls_fail`.

A pointer step draws a frame before and after its event. The gestures add up to six a case, each two to five steps; in a `group-headers` build with `reorder`, up to eight header drags of four steps each, where `DragColumns` drew five frames a drag.

## The controls (B2)

`state::random::controls`, the all-on run's 48 cases, `SEED`s 0–6: whether each control fails the cases at its invariant.

| Control | Invariant | `SEED`s caught, of 0–6 |
|---|---|---|
| A release leaves the resize on (`resize`'s `KeepOnRelease`) | 11 | 7 |
| A drag unclamped (`resize`'s `Unclamped`) | 12 | 7 |
| A block over its neighbor (`reorder`'s `BlockOverNeighbor`) | 13 | 7 |
| The order reset unsaid (`reorder`'s `SilentReset`) | 13 | 7 |
| The count kept across the edge (`reorder`'s `CountKept`) | 14 | 7 |
| The count recounted (`reorder`'s `Recount`) | 14 | 7 |
| A shrink keeps the selection (`select`'s `KeepPastRows`) | 15 | 7 |
| A hit test ignores the run (`pin`'s `HitIgnoresRun`) | 16 | 7 |
| A shrink keeps the mark (the mark's exclusion lifted) | 17 | 7 |
| The run changes unsaid (`pin`'s `SilentRepin`) | 18 | 7 |
| The paging's twelve, `reorder`'s `ReadByPlace`, `group-headers`' `GroupsByPlace` | 1 to 9 | 7 each, but copy and prefetch on one page: 5 (missed at 5 and 6) |
| A gap outside the parent (`group-headers`' `GapOutsideParent`) | 10 | 4 (missed at 1, 3, 6) |

170 of 175; the ten new ones 70 of 70; `SEED` 0, which `just tall-table test` runs, catches all 25. The random test itself passes at every one of the seven.

Copy and prefetch on one page was 5 of 7 before this part too (`docs/DECISIONS.md`, "Fixtures", 2026-10-28). The gap control's rate before isn't recorded (M17 checked `SEED` 0); with its drag's four steps back to back, as the old step was, it's caught at the same four `SEED`s as with up to two steps between each.

A block over its neighbor first failed at 14 at `SEED` 4 (the count's check read an order that wasn't one); the order's check now runs before the count's at a move.

## What it found (B3)

Recorded with their steps and seeds in `PLAN.md`, "Found by the random test". How each was reached:

| Finding | Reached | Shrunk to |
|---|---|---|
| 4, the mark past a shrink (had to find) | the first run, `SEED` 0 | 23 steps of the draw (proptest's shrink), the run 3 min 44 s |
| 5, a `Columns` range's rows (had to find) | the second runs, `SEED`s 0 and 1 | 176 and 131 steps, 20 and 13.5 min |
| 3, a right release ends a drag (had to find) | the second runs, `SEED`s 2 and 3 | 201 and 216 steps, 20 and 12 min |
| 8, a second band press loses the first drag's widths | the third run, `SEED` 0 | 4 steps as run, the run 23 s |
| 9, a move with no button ends one drag of two | the third runs, `SEED`s 2 and 3 | 3 steps, 8 s and 4 s |
| 1's `set_rows` half, the hover | the fourth run, `SEED` 3 | 6 steps, 54 s (seven runs at once) |
| 10, an arrow cut at the left edge without `pin` | `pairs`, `live` + `sort`'s 16 cases | 4 steps, 8 s |

The first three shrinks are proptest's, over the draw; the rest are the shrink over the case as run that replaced it (`docs/DECISIONS.md`, "Fixtures"). Each scenario test fails with `--include-ignored` at its invariant, in three to five steps.

Two of the test's own mistakes, fixed in it, not findings: the soak's first run failed at `SEED` 2 pressing a scrolled column's band where the last pinned column's band lies over the run's edge and takes the press by design (the test now presses only a band no other is within 10 px of); and its first control run read an order that wasn't one (above).

## Every pair (B4)

The tool, by its wall time for the clippy half (wasm32, `-D warnings`), each run after a touch of the table's `lib.rs`:

| Candidate | Builds | Wall | |
|---|---|---|---|
| `perf/pairs.ts`: one `cargo clippy -p` the three crates a set | 89 | 109 s, 84 s | chosen |
| `cargo hack clippy --feature-powerset --depth 2 -p` each | 270 (90 a package) | 157 s, 172 s | each package apart: the table's sets without the host that turns them on |
| `cargo all-features clippy` | — | failed in 2 s | ignores `-p`, walks the workspace, and passed `seiza`'s `canvas-font-fallback` to the three; needs `max_combination_size = 2` in each manifest (added for the run, removed after) |

A build is about a second (1.0 to 2.8 s) once the dependencies are checked. A planted function gated on `pin` and `sort` with an unused variable failed that pair's build and no other.

`just tall-table pairs` on the final code: 89 clippy builds (13 singles, 76 pairs; `follow` + `live` and `copy` + `select` are their singles' builds) and the tests of the 60 pairs with code gated on both, all passing, 15 min 12 s (the tests ~19 s a pair: 14 s without `select`, ~29 s with it). The first full run took 20 min 34 s and failed one pair's tests, `live` + `sort`: finding 10, not a build that didn't compile. No pair failed to compile or lint.

The 60 pairs are the script's (`--list`): a `cfg` needing exactly two features, by one expression, by nesting, or through a gated `mod` line, in the table's, the bridge's, and the host's sources, tests included. The research's first count, 30, was the table's own code; the rest come from window tests gated on two features and the host's `any(…)` lists.

## The soak (B5)

`just tall-table soak` (`SEED`s 1–4 × 500 cases, release with debug assertions and overflow checks, `clicks` added to its features): passes, 82 to 88 s a `SEED`, 8 min 3 s once built (the release build 3 min 10 s). A case costs ~0.17 s here.

## After the code review

Six of its seven findings fixed (the seventh, invariant 17's control injecting no fault, is part C's by plan: the table keeps the mark today, so a fault can't differ from it):

- `perf/pairs.ts`: a gated item's end no longer stops at a comma inside a signature's or a field's generics, or at a struct pattern's `}` before its arm's body; an inner `#![cfg(…)]` gates the rest of its file; a plain `mod x;` inside a gated module is followed under its gates; each crate is read from its root down, a file once (it was read ungated, then again under its `mod` line's gate); the flags are checked (`--only tests`, a `--from` with no number or no `--only`, an unknown flag: each exits 2 and runs nothing). The pairs with code gated on both are still 60, the same ones, `live` + `sort` now at 9 places for 7.
- `SecondBandPress` takes the widths as heard only after a press that replaced or ended a resize (a band's), not after any press while one was on.
- The scenario tests' comments and `#[ignore]` reasons name their finding in `PLAN.md`, not the milestone.

Then, on that code: `lint`; the all-on random test at `SEED`s 0–6 and its 25 controls at `SEED` 0, all as before; the six ignored scenarios each failing at its invariant; the soak again (`SEED`s 1–4 × 500, passing, 85 to 88 s a `SEED`) and `pairs` again (89 clippy builds and 60 pairs' tests, passing, 14 min 38 s).

## Reproducing it

```sh
just tall-table test
just tall-table pairs            # --list for the pairs alone
just tall-table soak
SEED=3 cargo test -p seiza-tall-table --features custom-cells,follow,resize,copy,sort,pin,density,format,reorder,clicks,group-headers state::random   # another seed's cases, and the controls
cargo test -p seiza-tall-table --features custom-cells,follow,resize,copy,sort,pin,density,format,reorder,clicks,group-headers -- --ignored state::random   # the findings' scenarios, each failing
```
