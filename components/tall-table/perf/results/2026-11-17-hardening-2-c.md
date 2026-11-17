# Hardening 2 part C: the fixes (2026-11-17)

Measured on Apple M1 (8 cores), Darwin 25.6.0 arm64, machine `local`: native `cargo test` and `cargo clippy` runs, the wasm's bytes, and the smoke check; no frame work or TTFP. Wall times by `time`, one run each.

Raw: `2026-11-17-hardening-2-c-size.json` (`just tall-table size --against ec85d34`).

## What changed

The shipped code, against part C's parent (`ec85d34`):

- **`set_rows`** (the base): the hover is cleared when its row is at or past the new end (it was cleared only when the top row moved), and the jump's mark with it; a hover that's left has its tooltip decided again. With `live` and `custom-cells`, a shrink drops the flashes there (`Flashes::cut`). With `select`, a `Columns` range's anchor's and head's rows move to the last row (0 with none), with `Selected`, a header drag left on.
- **The tooltip** (the base): a page landing on the hovered row, and `set_rows`, undo its decision (`undecide_tooltip`), and the next frame decides again: it goes while its row has no page, and its view is built only when its text changed (`tooltip_for` split into `tooltip_text` and `tooltip_view`).
- **The drags' handlers** (the base): only the left button's release ends a drag, every one; a move with no button ends every drag that's on.
- **`resize`:** a band's listener holds its column's index, and `press_band` finds its place in the order in effect; a press on a band ends a resize still on before starting its own.
- **`reorder`** with `select`: a held press's cell is clamped to the rows at its release.
- **`sort`:** the check that draws no arrow cut at the scrolled columns' left edge loses its `cfg(feature = "pin")`.

Tests only: the random test's exclusions and their type removed, the seven scenario tests un-ignored, the mark's control a flag on the state (`keep_mark`); thirteen window tests added (below, and two after the code review).

The bytes: "The bytes (C4)", below.

## The findings' tests (C1)

Each fails without its fix and passes with it.

| Finding | Test | Failing before |
|---|---|---|
| 1, the tooltip through a re-read | `fixtures::flash::the_tooltip_says_the_value_a_reread_drew` | with `undecide_tooltip` made empty: the tooltip said `value 0 …` over a cell drawn `value 1 …` |
| 1, the hover past a shrink | `random::a_shrink_past_the_hovered_row_clears_the_hover` | part B's, ignored until now (invariant 17) |
| 2, a band's press by its drawn place | `fixtures::reorder::a_band_pressed_before_the_next_frame_holds_its_column` (the press called inside the update that moved the columns) | by reading: the same call with the same number (0) was a place before the fix and held column 1 |
| 3, any button's release | `random::a_right_release_leaves_a_drag_on`; in windows, `fixtures::click::a_context_press_during_a_resize_does_nothing`, `…_during_a_move_…`, and `select`'s `a_context_press_during_a_drag_does_nothing` each send the right button's release during their drag | part B's (invariant 11) |
| 4, the mark | `random::a_shrink_past_the_mark_clears_it` | part B's (invariant 17) |
| 5, a `Columns` range's rows | `random::a_shrink_moves_a_columns_range_to_the_last_row`; the held press's half, `fixtures::reorder::a_held_press_selects_a_row_that_exists` | part B's (invariant 15) |
| 7, a flash past a shrink | `fixtures::flash::a_shrink_drops_the_flashes_past_the_end` | with `Flashes::cut` not called: 2 flashes live after the shrink for 1 |
| 8, a second band press | `random::a_second_band_press_reports_the_first_drags_width` | part B's (invariant 12) |
| 9, a move with no button | `random::a_move_with_no_button_ends_every_drag` | part B's (invariant 11) |
| 10, an arrow cut at the left edge | `random::an_arrow_cut_at_the_left_edge_is_not_drawn` (builds with `sort` and without `pin`) | part B's (invariant 16) |

Part B's seven failed with `--include-ignored` on the parent (its note); they run un-ignored now. Findings 1's re-read half and 7 were checked here by switching the fix off in place and running the test (restored after). Finding 6 is left, and in the README's limits.

No exclusion is left: the `Exclusion` type, the list in effect, and `second_press_excluded` are gone, and `rg Exclusion src/` finds only the module comment's sentence that says so.

## The promises' tests (C2)

| Promise (README) | Test |
|---|---|
| A cut value's exact text in a tooltip, through a re-read ("Columns", "Live rows") | `fixtures::flash::the_tooltip_says_the_value_a_reread_drew` |
| A sort clears the hover and the tooltip ("Sorting") | `fixtures::sort::a_sort_clears_the_hover_and_the_tooltip` |
| `set_order` keeps `pin`'s count as a count of places ("Moving columns") | `fixtures::reorder::set_order_keeps_the_count_of_places` |
| A page's `paint` is read by index: a fill and a bar after a move ("Moving columns") | `fixtures::reorder::a_fill_and_a_bar_stay_on_their_columns` |
| The copy's text is the exact value under a format ("Format") | `copy::tests::a_formatted_columns_copy_is_the_exact_value` |
| The header line is the names alone under groups ("Header groups") | `copy::tests::a_grouped_headers_line_is_the_names_alone` |
| A context press does nothing during `resize`'s and `reorder`'s drags ("Presses") | `fixtures::click::a_context_press_during_a_resize_does_nothing`, `fixtures::click::a_context_press_during_a_move_does_nothing` |

The last two check what the promise says (nothing reported, the drag goes on). They don't check that the press stops at the table: it doesn't, and a `ContextMenuExt` round the table opened its menu over the resize in the test (`PLAN.md`, "Open questions").

## The runs (C3)

Before the code review:

| Run | Result |
|---|---|
| `just tall-table test`, its 18 feature sets | all pass; the all-on run 410 tests, none ignored (393 and 6 ignored at part B), 87.6 s |
| `just tall-table lint` | passes (`check-terms`, fmt, clippy for wasm32 and native with no feature and with every one, tsc) |
| The all-on random test and its 25 controls, `SEED`s 0–6 | the random test passes at all seven with no exclusion; the controls 170 of 175, the misses part B's own (a gap outside the parent at 1, 3, 6; copy and prefetch on one page at 5, 6). The mark's control, now a fault in the table (`keep_mark`), is caught at invariant 17 at all seven |
| `just tall-table pairs` | 89 clippy builds and the 60 pairs' tests, all passing, 21 min 23 s (the machine in use; 15 min at part B) |
| `just tall-table soak` (`SEED`s 1–4 × 500 cases, release with debug assertions and overflow checks) | passes, 83 to 87 s a `SEED`, 8 min 13 s with its build |

`test` ran before one last tidy of `cut_selection` (the same rule in fewer lines); after it, the all-on run (410) and the `select` run (77) again, `lint` again, and `pairs` and the soak, which ran after it.

## After the code review

Ten findings; six fixed, four left as they are.

- **A tooltip over a row with no page** (a bug in this part's fix): without `live`, a short last page that grows is forgotten and read anew, and a tooltip decided before stood over the placeholder until the read landed. `set_rows` undoes the decision, as decided 2026-11-16, and a tooltip goes while its row has no page. Test, in the base build: `cells_text_tests::the_tooltip_follows_its_rows_page` (with `set_rows`' undo commented out it fails: the old text over a row with no page). It's also the base build's test of the landing's undo, which had one only in `live` with `custom-cells`.
- **A shrink ended a header drag** over a `Columns` range, once its rows were clamped: the clamp goes through the drag's own setter. Test: `fixtures::select::a_shrink_mid_drag_keeps_a_columns_drag`.
- **`Flashes::cut` ran at every `set_rows`,** growth included, and left the reduced-motion timer armed with no flash: it runs at a shrink, and clears the timer with the last flash.
- **The `CLAUDE.md` rule and the module comment told what happened** to the exclusions, not how to write one; four test comments named the milestone's findings. Reworded.
- **Left:** a move that reports another button than the left ends the drags, and a press with no move after an unseen release leaves a stale drag beside the new one (both as before this part: the handler's rule for a move without the left button, and no press but a band's ends a drag); no arrow at the left edge on the sorted column either (the decision of 2026-11-16); a band's press ends a stale resize even when its own column is gone (the stale drag ends as a release would end it).

Then, on that code:

| Run | Result |
|---|---|
| `just tall-table test` | all 18 feature sets pass; the all-on run 412 tests, none ignored |
| `just tall-table lint` | passes |
| The all-on random test and its controls, `SEED`s 0–6 | as before the review: the test passes at all seven, the controls 170 of 175 with the same five misses |
| `just tall-table soak` | passes, 82 to 89 s a `SEED` (`set_rows` changed: `CLAUDE.md`, rule 5) |
| `just tall-table pairs` | 89 clippy builds and the 60 pairs' tests, passing, 18 min 45 s |
| `just tall-table smoke` on a `sort` build (no `pin`) | passes in Chromium, Firefox, and WebKit, both shapes, glyphs and icons, and opened sorted |

The smoke run is the browsers' check of the one drawing change: a `sort` build without `pin` no longer draws an arrow the cells' left edge cuts, so its scrolled reference screen (`smoke --screens`) can differ from the parent's by that arrow. The screens weren't compared with the parent's (none saved for it).

## The bytes (C4)

`just tall-table size --against ec85d34 --label hardening-2-c-size` (15 min 50 s), after the review's fixes: the base built in a worktree at part C's parent and with part C.

| Build | Raw | After wasm-opt | Brotli |
|---|---|---|---|
| The base at `ec85d34` | 13,323.7 KiB | 9,836.3 KiB | 2,760.4 KiB |
| The base with part C | 13,324.1 KiB | 9,836.6 KiB | 2,760.7 KiB |
| Change | +0.4 KiB | **+0.3 KiB** | +0.3 KiB |

The script exits with "the base changed: 0.3 KiB after wasm-opt": its gate is a feature milestone's, where the base mustn't change. Here the base is what was fixed (`set_rows`, the tooltip, the two handlers), and 0.3 KiB is their cost to every host.

Each feature's added bytes after wasm-opt are the last run's (`2026-11-16-gpui-kit-0.10.0-size.json`) within 0.1 KiB, `sort`'s the same +84.3 KiB with its `cfg` gone, so the README's Features table stands. Brotli moved by up to 2 KiB either way with the bytes (`follow` +8.3 → +6.6, `live` with `custom-cells` +10.7 → +12.8), its noise when a few bytes shift. No feature's symbols in the base, no home path in any build.

Each app that builds the table, its crate built alone at `ec85d34` and then with part C's `src/`, in one worktree at a fixed path with a target of its own, wasm-opt with the apps' flags, brotli 11:

| Build | After wasm-opt | Brotli | Its note |
|---|---|---|---|
| Tycho | +422 bytes (10,691,605 → 10,692,027) | 2,943.4 → 2,942.2 KiB (−1.2, noise) | `apps/tycho/perf/results/2026-11-17-tall-table-hardening-2.md` |
| The observatory's GPUI contender, base level | +271 bytes (10,140,263 → 10,140,534) | 2,780.8 → 2,781.7 KiB (+0.9, noise) | `apps/observatory/perf/results/2026-11-17-tall-table-hardening-2.md` |
| Kirkwood | +385 bytes (10,274,096 → 10,274,481) | 2,821.6 → 2,820.7 KiB (−0.9, noise) | here: a showcase keeps no results |

Kirkwood builds `sort` without `pin`, so it's the one app whose drawing changes: a sortable header scrolled partly past the cells' left edge draws no arrow there.

No app's `check` or perf run was made: a few hundred bytes are far inside every wasm budget, and nothing a frame or the first paint runs changed but a branch in the pointer's handlers.

## Reproducing it

```sh
just tall-table test
just tall-table lint
just tall-table pairs
just tall-table soak
just tall-table size --against ec85d34 --label hardening-2-c-size   # exits 1 on the base's 0.3 KiB, by its gate
just tall-table build sort && just tall-table smoke
SEED=3 cargo test -p seiza-tall-table --features custom-cells,follow,resize,copy,sort,pin,density,format,reorder,clicks,group-headers state::random   # another seed's cases, and the controls
```
