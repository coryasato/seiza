# The tall table's fixtures

What "the same" means for any other implementation of the table's base level (the observatory's DOM contenders): the page requests it makes, the text its cells show, and the SQL it sends (root `CLAUDE.md`, "Comparison protocol"). Each fixture runs natively against the table, and in TS against each DOM contender, and each has negative controls that must fail it.

| File | What it pins | Native test | Written by |
|---|---|---|---|
| `paging.json` | Steps on the table → the page requests, in order | `src/state/fixtures.rs` (`paging_scenarios`, `paging_controls_fail`) | Hand, each step's `why` saying where its requests come from |
| `cells.json` | Each float column's budget, and a value's exact and shown text | `src/state/fixtures.rs` (`cell_text`, `cell_controls_fail`) | `cells`: `just observatory cell-fixture`, from the GPUI contender; `rounding`: hand |
| `sql.json` | The page SQL and the summary queries, as text | `engines/duckdb/crate/src/tall_table.rs` (`sql_fixture`, `sql_fixture_controls_fail`), where the SQL is written | Hand |
| `paint.json` | `custom-cells`: a paint value → the colors and the bar's pixels drawn, in light and dark; with `live` too, a change → its flash's color and opacity | `src/state/fixtures/paint.rs` (`paint_fixture`, `paint_fixture_stops_are_the_theme`, `paint_controls_fail`), with the feature on; `src/state/fixtures/flash.rs` (`flash_fixture`, `flash_fade_backwards_fails`, `flash_fall_as_rise_fails`), with both | Cases and stops: hand; `expect`: `just tall-table paint-fixture`, from Chromium |

`just observatory fixtures` runs the first three native tests, the same fixtures and controls against the observatory's TanStack contender (`apps/observatory/contenders/tall-table/tanstack/web/test/fixtures.test.ts`), and checks `cells.json` against what the GPUI contender draws.

## `paging.json`

`paging` is the table's `Paging::default()` (the test fails if they part), in the units a TS side uses: `page_rows`, `prefetch`, `budget_bytes`, `max_in_flight`, `scroll_settle_ms`, `drag_settle_ms`. Each scenario has `rows`, `viewport_rows` (the rows the viewport holds, fractional), `page_bytes` (what every answered page counts against `budget_bytes`), `steps`, and maybe `features`, the table's features it needs (`live`, `follow`), run only by a build with them, and `without`, the features under which it's skipped (the base's drop of a grown page holds only without `live`). A step has one action, `expect`, maybe a `why`, and with `follow` maybe `following` and `bottom` (below):

| Action | What it does |
|---|---|
| `open: true` | Opens the table over `rows` rows with that viewport. |
| `scroll: <rows>` | Scrolls by that many rows (negative is up), as a wheel or a key does. |
| `scroll_x: <px>` | Scrolls sideways by that many pixels, as Shift+wheel does. The fixture's one column fits, so nothing moves; with `follow`, following stays as it was. |
| `jump: <row>` | Puts that row at the top, or as near as the end allows. |
| `fraction: <f>` | Scrolls to `f` of the way down (Home is 0, End is 1): the top row is `f × (rows − viewport_rows)`. |
| `drag: <f>` | Drags the scrollbar thumb so the top is at `f` (as `fraction`), starting a drag if none is on. A track press is a `drag` then a `release`. |
| `release: true` | Lets go of the thumb. |
| `wait: <ms>` | Time passes. Nothing else moves the clock: every other step happens at the same instant. |
| `answer: "all"` | Answers every open read in the order they were sent, one at a time, the reads they start included, until none is open. |
| `answer: [<page>, …]` | Answers the oldest open read of each page, in that order. |
| `fail: [<page>, …]` | As `answer`, but each read fails (not a broken source: only its rows show the error). |
| `rows: <n>` | The source now holds `n` rows (`set_rows`); the top row stays where it is, or as near as the new end allows. A short last page that grows is forgotten and read anew, its read cancelled if one is out; with `live` it's kept (below). Shrinking forgets a short last page either way. |
| `follow: true` | `follow`: follows the end (`follow()`): the view goes to the end as a jump does, and from then stays at the loaded tail as rows arrive (below). |
| `invalidate: [<start>, <end>]` | `live`: rows `start..end` (end-exclusive) changed in the source (`invalidate_rows`). Its pages loaded or being read go stale; the wanted ones are read again, a loaded one drawn as it is until its read lands. |

A cancelled read always answers as cancelled; the others answer with their page. After each step, everything that can run runs (answers land, reads start) before `expect` is compared.

`expect` lists what the table asked its source for during the step, in order: `load <page>` (rows `page × page_rows` up to the next page or the end) and `cancel <page>` (the table no longer wants that read; it still counts as in flight until it answers). The cancels from one decision are a set, written in page order.

`expect` doesn't tell a re-read from a first read: both are `load <page>`. A stale page's re-read is never cancelled for being stale; a page invalidated during a read (a re-read or its first) is read once more after that read lands; a stale page that isn't wanted is dropped, and its re-read, if one is out, cancelled.

With `live`, a short last page that grows is stale the same way: it draws the rows it was read with (placeholders past them) and is read again, never cancelled for growing; grown during a read (a re-read or its first), it's read once more after that read lands.

With `follow`, following is a flag, off at open whatever the position. Each move decides it before moving, from where it will land, so a move that starts following reads bottom first. A wheel or key down keeps it on, or turns it on if the view ends at the end; `fraction` (End, a drag) and `jump` turn it on exactly when the view lands at the end (top = rows − viewport_rows) and off otherwise; a wheel or key up by any amount, and Home (`fraction: 0`), turn it off; `scroll_x` and `rows` leave it. During a `drag` it holds as it was, and the `release` decides, as a landing. While it's on, the view's bottom is pinned to the loaded tail: once every row in view is loaded, the view moves down until its bottom is at the end of the rows drawn with their values (a grown page's up to the rows it was read with), only down, and never during a drag. A pin move isn't a scroll: prefetch doesn't lean and no settle timer starts. While following, the visible pages are read bottom first.

A step's `following: <bool>` checks the flag after it, and `bottom: <row>` the end of the rows in view (the row after the last one at least partly visible: `ceil(top + viewport_rows)`, at most `rows`).

`controls` each change one `paging` field, or (with `live`) name a way of re-reading wrongly: `reread-unwanted` keeps stale pages outside `wanted` and reads them again, `restart-stale` cancels a page's read when it's invalidated during it and reads it anew, `drop-grown` forgets a short last page that grows, as the base does; or (with `follow`, its `follow` field) a way of following wrongly: `follow-at-end` takes following to be the view at the end, `follow-ignores-reader` never lets go for the reader, `pin-to-rows` keeps the view at the last row whether it's loaded or not, `top-first` reads the visible pages top first while following. Every control must fail at least one scenario the build runs.

## `cells.json`

`columns` are the float columns as the GPUI contender laid them out (its `ColumnProbe`): `name`, `kind`, `width` (CSS px), and `budget`, the characters a float may take. A DOM contender uses these budgets as they are: they come from GPUI's measured glyph advance, which a DOM measurement can miss by a character.

`cells` are values from the data file as the contender drew them: `column`, `row` (0-based, in file order), `value` (its shortest round-trip text, as JS's `String` writes it, or `null` for NULL), `exact` (the table's exact text, Rust's `{:?}`: `8.0` where JS writes `8`, and the tooltip's text), and `shown` (the cell's text). No value in the data file is too long for its column, so none is rounded there; `rounding` holds values that are, at the same columns' budgets, each with a `why` naming the case.

`cell_controls_fail` checks that each of these fails the fixture: a float's text written without the `.0` of a whole number (Rust's `Display`, as JS's `toString` does), and each budget a character smaller or larger.

## `sql.json`

`pages` are the page query for some pages of `file` (the SQL name it's registered under), and `summary` the queries an open sends, in order (no metadata keys, so the keyed third isn't sent). The text must match exactly. `controls` are page queries that must fail the comparison: the same rows by `LIMIT`/`OFFSET`, and the same query spaced differently.

## `paint.json`

What a DOM contender draws for a cell's paint (`custom-cells`; the table's README, "Use it"), at the protocol's DPR 2. No contender draws paint yet: the observatory adds the level when both its sides build it.

- `cell`: the cell the bars are drawn in: `width` (CSS px, a float column's), `row_height`, `padding` (each side; the bar spans the inner width, `width − 2 × padding`), `bar_inset` (the bar's distance from the row's top and from the row line, which the fill and bar leave clear: they're `row_height − 1` tall).
- `tolerance`: `channel_steps`, 8-bit steps a channel may differ (rounding), and `bar_px`, CSS px a bar's edge may differ (one device pixel: GPUI rounds an x.5 edge down, the browser up).
- `ramps`: each ramp's `stops`, theme tokens evenly spaced over 0..1, and their resolved colors in `light` and `dark` (`#rrggbbaa`). The native test checks them against gpui-kit's default theme, so a theme change fails it.
- `tokens`: the other theme tokens the cases name, in the same form: the text colors (`foreground`, `background`), the rows' backgrounds (`table`; `table_even`, an odd row's stripe drawn over it; `table_active`, the jumped-to row's tint), and the bar's colors. Checked against the theme the same way.
- `bar`: the tokens a bar draws in, its `color` and its `below`.
- `colors`: a ramp, `as` a `fill` or a `text` color, a `value` (clamped to 0..1), and `expect`: the 8-bit RGBA drawn in light and dark. A value between stops `i` and `i + 1` at fraction `t` is `color-mix(in oklab, stop_i (1 − t) × 100%, stop_i+1)`; `expect` is what Chromium draws for that into a canvas.
- `bars`: a column's `zero`, whether it has a `below` color (`below: true`), and a `value` (both clamped to 0..1), and `expect`: the bar's `left` (CSS px from the cell's left: `padding + min(zero, value) × inner`), `width` (`|value − zero| × inner`), and the color it's drawn `in` (`below` where the column has one and the clamped value is left of the clamped zero, else `color`), or `null` where it draws none (`value` at zero).
- `text_over`: a fill through `ramp` at `value` in an `even`, `odd`, or `marked` `row` (the row a jump landed on), with no text color, and `expect`: the token its text is drawn in, in light and dark. The row's background (the table's, with an odd row's stripe or the marked row's tint over it), the fill over that, and on the marked row the tint again over the fill are drawn into a canvas and read back; the token is whichever of `foreground` and `background` has the Oklab lightness farther from that color's (ties to `foreground`). The script fails on a near tie (within 0.02). The drawn text must be the token's color exactly.
- `none`: paints that draw nothing (NaN).
- `flash` (`live` with `custom-cells`): a column's flash through `ramp` (one of `ramps`) for `duration_ms`, and its `cases`: a cell's `old` and `new` value (a number is a float, `"NaN"` a float NaN, `null` NULL, `{"text": …}` text), read again with every case's row changed at once, and drawn `elapsed_ms` later. `expect` is `null` where nothing is drawn (no change, or the flash is over), else `at`, its place in the ramp (a float's rise 1, its fall 0, any other change 0.5; two NaNs are equal), `opacity` (`1 − elapsed / duration`), and the 8-bit RGBA drawn in light and dark: the ramp's color at `at` (Chromium's mix, as `colors`) with `round(opacity × 255)` as its alpha, drawn over the cell's fill. The script writes `at` and `opacity` from the rule above, apart from the table's code.

`paint_controls_fail` checks that each of these fails it: every color two steps off, every bar 2 device pixels off, and the ramps mixed in sRGB instead of Oklab; `below_ignored_fails`, `nearer_token_fails`, and `composite_ignored_fails`, that bars drawn in `color` below zero, text in the token nearer the fill, and a fill read without the row under it and the marked row's tint over it fail the `bars` and `text_over` cases; `flash_fade_backwards_fails` and `flash_fall_as_rise_fails`, that a fade run from nothing to full and a fall flashed as a rise fail the `flash` cases. `just tall-table paint-fixture --check` fails if `expect` is out of date with the cases and stops.
