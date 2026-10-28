# The tall table's fixtures

What "the same" means for any other implementation of the table's base level (the observatory's DOM contenders): the page requests it makes, the text its cells show, and the SQL it sends (root `CLAUDE.md`, "Comparison protocol"). Each fixture runs natively against the table, and in TS against each DOM contender, and each has negative controls that must fail it.

| File | What it pins | Native test | Written by |
|---|---|---|---|
| `paging.json` | Steps on the table → the page requests, in order | `src/state/fixtures.rs` (`paging_scenarios`, `paging_controls_fail`) | Hand, each step's `why` saying where its requests come from |
| `cells.json` | Each float column's budget, and a value's exact and shown text; with `resize`, the budget a set width gives | `src/state/fixtures.rs` (`cell_text`, `cell_controls_fail`); `src/state/fixtures/resize.rs` (`resize_fixture`, `resize_fixture_number_px_gives_the_budgets`, `resize_controls_fail`), with the feature on | `cells`: `just observatory cell-fixture`, from the GPUI contender; `rounding`, `number_px`, and `resize`: hand |
| `sql.json` | The page SQL and the summary queries, as text | `engines/duckdb/crate/src/tall_table.rs` (`sql_fixture`, `sql_fixture_controls_fail`), where the SQL is written | Hand |
| `paint.json` | `custom-cells`: a paint value → the colors and the bar's pixels drawn, in light and dark; with `live` too, a change → its flash's color and opacity | `src/state/fixtures/paint.rs` (`paint_fixture`, `paint_fixture_stops_are_the_theme`, `paint_controls_fail`), with the feature on; `src/state/fixtures/flash.rs` (`flash_fixture`, `flash_fade_backwards_fails`, `flash_fall_as_rise_fails`), with both | Cases and stops: hand; `expect`: `just tall-table paint-fixture`, from Chromium |
| `selection.json` | `select`: presses, drags, wheels during a drag, keys, and `set_rows`, `set_columns`, `jump_to` → the selection, the top row, and the sideways scroll after each, under each kind on | `src/state/fixtures/select.rs` (`selection_scenarios`, `selection_controls_fail`), with the feature on | Hand, a step's `why` saying the rule it checks |

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
| `rows: <n>` | The source now holds `n` rows (`set_rows`); the top row stays where it is, or as near as the new end allows. A short last page that grows is forgotten and read anew, its read cancelled if one is out; with `live` it's kept (below). Shrinking forgets a short last page either way, and every page wholly past the new end, loaded or being read (its read cancelled): grown back, they're read anew. |
| `follow: true` | `follow`: follows the end (`follow()`): the view goes to the end as a jump does, and from then stays at the loaded tail as rows arrive (below). |
| `invalidate: [<start>, <end>]` | `live`: rows `start..end` (end-exclusive) changed in the source (`invalidate_rows`). Its pages loaded or being read go stale; the wanted ones are read again, a loaded one drawn as it is until its read lands. |

A cancelled read always answers as cancelled; the others answer with their page. After each step, everything that can run runs (answers land, reads start) before `expect` is compared.

`expect` lists what the table asked its source for during the step, in order: `load <page>` (rows `page × page_rows` up to the next page or the end) and `cancel <page>` (the table no longer wants that read; it still counts as in flight until it answers). The cancels from one decision are a set, written in page order.

`expect` doesn't tell a re-read from a first read: both are `load <page>`. A stale page's re-read is never cancelled for being stale; a page invalidated during a read (a re-read or its first) is read once more after that read lands; a stale page that isn't wanted is dropped, and its re-read, if one is out, cancelled.

With `live`, a short last page that grows is stale the same way: it draws the rows it was read with (placeholders past them) and is read again, never cancelled for growing; grown during a read (a re-read or its first), it's read once more after that read lands.

With `follow`, following is a flag, off at open whatever the position. Each move decides it before moving, from where it will land, so a move that starts following reads bottom first. A wheel or key down keeps it on, or turns it on if the view ends at the end; `fraction` (End, a drag) and `jump` turn it on exactly when the view lands at the end (top = rows − viewport_rows) and off otherwise; a wheel or key up by any amount, and Home (`fraction: 0`), turn it off; `scroll_x` and `rows` leave it. During a `drag` it holds as it was, and the `release` decides, as a landing. While it's on, the view's bottom is pinned to the loaded tail: once every row in view is loaded, the view moves down until its bottom is at the end of the rows drawn with their values (a grown page's up to the rows it was read with), only down, and never during a drag. A pin move isn't a scroll: prefetch doesn't lean and no settle timer starts. While following, the visible pages are read bottom first.

A step's `following: <bool>` checks the flag after it, and `bottom: <row>` the end of the rows in view (the row after the last one at least partly visible: `ceil(top + viewport_rows)`, at most `rows`).

`controls` each change one `paging` field, or (`cache`, in every build) name a way of keeping pages wrongly: `keep-past-end` keeps the pages wholly past a shrink's new end, forgetting only a short last page; or (with `live`) a way of re-reading wrongly: `reread-unwanted` keeps stale pages outside `wanted` and reads them again, `restart-stale` cancels a page's read when it's invalidated during it and reads it anew, `drop-grown` forgets a short last page that grows, as the base does; or (with `follow`, its `follow` field) a way of following wrongly: `follow-at-end` takes following to be the view at the end, `follow-ignores-reader` never lets go for the reader, `pin-to-rows` keeps the view at the last row whether it's loaded or not, `top-first` reads the visible pages top first while following. Every control must fail at least one scenario the build runs.

## `cells.json`

`columns` are the float columns as the GPUI contender laid them out (its `ColumnProbe`): `name`, `kind`, `width` (CSS px), and `budget`, the characters a float may take. A DOM contender uses these budgets as they are: they come from GPUI's measured glyph advance, which a DOM measurement can miss by a character.

`cells` are values from the data file as the contender drew them: `column`, `row` (0-based, in file order), `value` (its shortest round-trip text, as JS's `String` writes it, or `null` for NULL), `exact` (the table's exact text, Rust's `{:?}`: `8.0` where JS writes `8`, and the tooltip's text), and `shown` (the cell's text). No value in the data file is too long for its column, so none is rounded there; `rounding` holds values that are, at the same columns' budgets, each with a `why` naming the case.

`cell_controls_fail` checks that each of these fails the fixture: a float's text written without the `.0` of a whole number (Rust's `Display`, as JS's `toString` does), and each budget a character smaller or larger.

`number_px` is GPUI's widest advance of the characters a number is written with (`0123456789.-+e`), in CSS px, at the cells' 14 px IBM Plex Sans: 8.4 (its digits' 600 units of 1000). A float column's budget at width `w` is `max(1, floor((w − 17) / number_px))`: the cell's 16 px of padding and a pixel short of the room. A DOM contender can't measure GPUI's advance, so a resized column takes its budget from this rule. The native test checks it gives each of `columns`' budgets; `cell-fixture.ts` keeps it and fails if the contender's budgets disagree.

`resize` (with `resize`) pins a set width's budget and text. `min_width` and `max_width` are the column defaults (40 and 1200 px) a set width is clamped to. `widths` are a float column's `set` width (`TallTableColumn::width`) → the `width` it's drawn at and its `budget`, at and past both clamps, each with a `why`. `cells` are values at a `set` width, with their `exact` and `shown` text as `rounding`'s are. `resize_controls_fail` checks that each budget a character smaller or larger, and widths laid out without the clamps, fail it. A DOM contender without resizing skips the section (the TanStack contender's test names it skipped).

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

## `selection.json`

What a DOM contender selects and scrolls to (`select`; the table's README), not how it holds it. No contender selects yet: the observatory adds the level when both its sides build it, and the TanStack contender's test names the file skipped.

The table: `columns` float columns, each `column_width` CSS px, over `rows` rows (a scenario's `rows` replaces it), in a view `viewport_rows` rows tall whose cells area (right of the row numbers, left of the vertical scrollbar) is `cells_width` px wide at open. A scenario's `selectable` lists the kinds on (`rows`, `columns`, `cells`; none is the base's input), and its `steps` each have one action, `expect`, and maybe a `why`.

A pointer target is a visible cell's middle (`{"cell": [row, column]}`), a visible row's number (`{"gutter": row}`), a visible column's header (`{"header": column}`), the header over the row numbers (`{"corner": true}`), or past the cells, level with a visible row on their right (`{"right": row}`) or under a visible column below them (`{"below": column}`).

| Action | What it does |
|---|---|
| `press: <target>` | A left press there, with `"shift"`, `"cmd"`, or `"ctrl"` held where true. It starts a drag unless it selected nothing or was on the corner. |
| `drag: <target>` | The pointer moves there with the button down. |
| `release: true` | The button comes up where the pointer is. |
| `wheel: {"rows": n, "at": <target>}` | A wheel of `n` rows (negative is up), the pointer at the target. |
| `key: "<keys>"` | Keys as GPUI writes them (`shift-down`, `cmd-shift-up`, `pagedown`, `space`, `escape`, `cmd-a`, `ctrl-a`). |
| `rows: <n>` | The source now holds `n` rows (`set_rows`). |
| `columns: true` | The same columns again (`set_columns`). |
| `jump: <row>` | `jump_to`. |

`expect` is what holds after the step: `selection`, `null` or its `kind` (`rows`, `columns`, `cells`), `anchor` (the active cell, `[row, column]`), and `head`; `top`, the view's top row (fractional in general; whole here); and `scroll_x`, the cells' sideways scroll in px.

The rules a step checks, in brief (the spec is the table's `PLAN.md`, `select`'s milestone; the decisions are its `docs/DECISIONS.md`, "Features"):

- A press selects the smallest kind that's on and holds what it's on: a cell, else its row; a row's number its row; a header its column (at the top visible row); the corner every column, else every row, else every cell. Otherwise it selects nothing and leaves the selection as it was. Cmd+press is a plain press; Ctrl+press selects nothing.
- Shift+press, a drag, and a wheel during a drag move the head: only along what the press picked (a cell both ways, a row's number its row, a header its column) and the range spans (`rows` up and down, `columns` across, `cells` both). The pointer is clamped to the visible cells, and past the last column to the last.
- A plain arrow moves the active cell one cell and collapses the range to the smallest kind that's on and holds it (a cell, a row, a column); Shift+arrow moves the head along the range's direction and nothing across it. Page keys move by the rows in view less one and scroll the base's page; Home, End, Cmd+Up and Down to the first and last row. At an end nothing moves; nothing loops. A moved cell is scrolled into view the least distance, down, up, and sideways.
- With nothing selected, the first arrow selects the first visible cell (by kind) without moving, and the other keys scroll as without the feature. Cmd+A and Ctrl+A as the corner. Escape clears.
- `set_rows` cuts a `rows` or `cells` range to the new end (clearing one wholly past it); a `columns` range stays. `set_columns` clears. `jump_to` selects the row (rows on), else the cell (cells on, in the active cell's column, else the first visible), else only scrolls.

`selection_controls_fail` checks that each of `controls` fails it: `loop` (a key past an end wraps), `center` (a moved cell centered instead of scrolled the least distance), `plain-moves-head` (a plain arrow moves the head, not the active cell), `extend-across` (Shift+arrow moves across a range's direction), `keep-past-rows` (`set_rows` doesn't cut the range).

