# The tall table's fixtures

What "the same" means for any other implementation of the table's base level (the observatory's DOM contenders): the page requests it makes, the text its cells show, and the SQL it sends (root `CLAUDE.md`, "Comparison protocol"). Each fixture runs natively against the table, and in TS against each DOM contender, and each has negative controls that must fail it.

| File | What it pins | Native test | Written by |
|---|---|---|---|
| `paging.json` | Steps on the table → the page requests, in order | `src/state/fixtures.rs` (`paging_scenarios`, `paging_controls_fail`) | Hand, each step's `why` saying where its requests come from |
| `cells.json` | Each float column's budget, and a value's exact and shown text | `src/state/fixtures.rs` (`cell_text`, `cell_controls_fail`) | `cells`: `just observatory cell-fixture`, from the GPUI contender; `rounding`: hand |
| `sql.json` | The page SQL and the summary queries, as text | `engines/duckdb/crate/src/tall_table.rs` (`sql_fixture`, `sql_fixture_controls_fail`), where the SQL is written | Hand |

`just observatory fixtures` runs the three native tests and checks `cells.json` against what the contender draws.

## `paging.json`

`paging` is the table's `Paging::default()` (the test fails if they part), in the units a TS side uses: `page_rows`, `prefetch`, `budget_bytes`, `max_in_flight`, `scroll_settle_ms`, `drag_settle_ms`. Each scenario has `rows`, `viewport_rows` (the rows the viewport holds, fractional), `page_bytes` (what every answered page counts against `budget_bytes`), and `steps`. A step has one action, `expect`, and maybe a `why`:

| Action | What it does |
|---|---|
| `open: true` | Opens the table over `rows` rows with that viewport. |
| `scroll: <rows>` | Scrolls by that many rows (negative is up), as a wheel or a key does. |
| `jump: <row>` | Puts that row at the top, or as near as the end allows. |
| `fraction: <f>` | Scrolls to `f` of the way down (Home is 0, End is 1): the top row is `f × (rows − viewport_rows)`. |
| `drag: <f>` | Drags the scrollbar thumb so the top is at `f` (as `fraction`), starting a drag if none is on. A track press is a `drag` then a `release`. |
| `release: true` | Lets go of the thumb. |
| `wait: <ms>` | Time passes. Nothing else moves the clock: every other step happens at the same instant. |
| `answer: "all"` | Answers every open read in the order they were sent, one at a time, the reads they start included, until none is open. |
| `answer: [<page>, …]` | Answers the oldest open read of each page, in that order. |
| `fail: [<page>, …]` | As `answer`, but each read fails (not a broken source: only its rows show the error). |

A cancelled read always answers as cancelled; the others answer with their page. After each step, everything that can run runs (answers land, reads start) before `expect` is compared.

`expect` lists what the table asked its source for during the step, in order: `load <page>` (rows `page × page_rows` up to the next page or the end) and `cancel <page>` (the table no longer wants that read; it still counts as in flight until it answers). The cancels from one decision are a set, written in page order.

`controls` each change one `paging` field; every control must fail at least one scenario.

## `cells.json`

`columns` are the float columns as the GPUI contender laid them out (its `ColumnProbe`): `name`, `kind`, `width` (CSS px), and `budget`, the characters a float may take. A DOM contender uses these budgets as they are: they come from GPUI's measured glyph advance, which a DOM measurement can miss by a character.

`cells` are values from the data file as the contender drew them: `column`, `row` (0-based, in file order), `value` (its shortest round-trip text, as JS's `String` writes it, or `null` for NULL), `exact` (the table's exact text, Rust's `{:?}`: `8.0` where JS writes `8`, and the tooltip's text), and `shown` (the cell's text). No value in the data file is too long for its column, so none is rounded there; `rounding` holds values that are, at the same columns' budgets, each with a `why` naming the case.

`cell_controls_fail` checks that each of these fails the fixture: a float's text written without the `.0` of a whole number (Rust's `Display`, as JS's `toString` does), and each budget a character smaller or larger.

## `sql.json`

`pages` are the page query for some pages of `file` (the SQL name it's registered under), and `summary` the queries an open sends, in order (no metadata keys, so the keyed third isn't sent). The text must match exactly. `controls` are page queries that must fail the comparison: the same rows by `LIMIT`/`OFFSET`, and the same query spaced differently.
