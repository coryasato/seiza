# Tycho

> *Tycho Brahe catalogued a thousand stars in a lifetime. Tycho scrolls 25 million before your coffee cools.*

**Live at [tycho.seiza.io](https://tycho.seiza.io).**

> **Version 2 is being built:** a workbench for a file too big for a spreadsheet, to open it, understand it, check what you need, and export the part you want, with nothing uploaded ([`PLAN.md`](PLAN.md)). The live site is still version 1. The sections below describe this tree as it stands, built locally: what version 2 has so far, and what it kept of version 1.

Tycho is a local-first data workbench in the browser. Drop a CSV or Parquet file, or open the sample, and scroll every row. DuckDB-Wasm queries the data in your tab, and GPUI (via GPUI Kit) draws the table on a canvas with WebGPU, or WebGL2 where WebGPU isn't available; the rest of the page is HTML. Nothing is uploaded, and the engine can't reach anything but the files you give it.

- **The sample:** GCAT, Jonathan McDowell's catalog of every object launched to orbit since 1957 (71,431 rows: satellites, rocket stages, and debris, with their launches, owners, orbits, and fates). It's 1.7 MiB, downloaded whole when you open it.
- **Your own files:** Parquet up to 10 GB, read where it lies; CSV up to 6 GB, loaded in chunks while you scroll the rows already in.
- **The table's columns:** drag a header to move a column, and its edge to resize it. Each header's type badge opens the column's menu (so does a right-click on the header): pin it to the left or unpin it, hide it, or fit it to its values. Tycho keeps the arrangement as the file's view, so a CSV column that turns out to be text partway through the load keeps its place and width.
- **The column list:** the top bar's left button opens every column in a panel at the table's left, with a search; a column's row opens its menu, and hidden ones are there to show again. Its head's button lists each column with an eye to hide or show it, and Show all.
- **Cells and rows:** click a cell to select it, Shift+click or drag for a range, and Cmd/Ctrl+C copies it. A right-click on a cell opens its menu: Copy, and Focus row in panel. Text cut by its column fades out, with a chevron: Enter (or the chevron) opens a popover with the whole value, and its "Focus row in panel" (or Enter again) opens the row in the panel's Row tab with focus at that value: every column, hidden ones included, long text in full, with Previous row and Next row, and a copy of a value or of the whole row. A double-click on any cell opens the row too, and leaves focus on the table, so the arrows go on moving through rows while the tab follows.
- **The command bar:** Cmd/Ctrl+K, or the box in the top bar. `pin` and `unpin` a column, `hide` and `show` columns (`hide a, b`, `show all`), `jump` to a row, `undo`; it completes a command's verb and its column as you type, says what Enter will do, and runs an action pasted from your own assistant (JSON, every step checked against the file before any runs, all or none). The grammar's other verbs are answered with the part of the plan they come with. With nothing typed, its list opens another file. Tycho holds no model: a sentence is answered with what the bar takes.
- **The log:** the button at the top bar's right opens the panel on its Log tab. Every step you take, typed, pasted, or dragged, with Tycho's reply, where it came from, and when; any step with a view to go back to has a button that returns to it, and `undo` steps back. At a phone the panel is a sheet over the lower part of the table, with the column list, the row, and the log as its tabs, and a tap on a header opens the column's menu as a sheet.
- **Observation panel:** Cmd/Ctrl+Shift+P, or `?perf` in the URL. It shows the page-load waterfall, frame times and work per frame, memory, bytes read against the file size, and cache hits, live.

Tycho is seiza's first utility app: a tool meant to grow with its users, not a fixed demo. Version 1's milestones are in [`docs/milestones.md`](docs/milestones.md). What's next is in [`PLAN.md`](PLAN.md). Its table and its DuckDB layer are now reusable pieces, a [table component](../../components/tall-table/) and a [DuckDB engine](../../engines/duckdb/), which the [observatory](../observatory/) measures against a DOM equivalent built with React and TanStack Virtual.

## Measurements

Tycho doesn't measure itself: it's a tool, and the [observatory](../observatory/) measures the table it's built on against a DOM equivalent, both on its DuckDB engine. Its build gates one number, the app wasm's size (brotli). Version 1's measurements, the public site's included, stay in [`perf/results/`](perf/results/) as history.

## How it works

- **Paint first.** The page's frame (the top bar, the first screen, the command bar, the panels, the menus, the status bar) is HTML, rendered at build time, so it's the page before anything loads, and its controls work at once: a file chosen before the app is in waits for it. The app wasm (2.84 MiB brotli) holds the table and the app's logic, the command bar's grammar and the log included. React, which draws the frame from then on, and DuckDB (~5.6 MiB brotli, in a worker) load after the first frame, and the status bar says what's still loading.
- **The engine, locked down.** Before Tycho gives DuckDB any file, it loads the one extension it needs, then locks the engine: it reads and writes only the files Tycho registers, and no query can reach a URL, a file outside them, or a setting. A file chosen before the lock waits for it. If the engine doesn't load, or its worker stops, the status bar says so and Retry starts it again.
- **One view.** The open file's arrangement (its columns' order, widths, pin, hidden columns, and formats) is one view state, kept in Rust, which the table reports into and is built from.
- **A narrow bridge.** Rust and DuckDB's JS API talk through three calls: register a file, run a query, cancel a query. Schemas, row counts, and metadata are SQL. Results cross as Arrow IPC bytes, read by a small hand-rolled reader (arrow-rs cost 127 KiB more). The engine and its bridge are their own package, [`engines/duckdb/`](../../engines/duckdb/), which other apps can use.
- **Query per viewport.** The table asks only for the rows on screen plus a little ahead, in 1024-row pages read by row-group range from Parquet. Its scroll position is an f64 row index, because pixel-based lists lose precision past ~16 M px (25 M rows is 640 M px).
- **CSV loads in chunks.** A CSV has no index, so it's cut at record boundaries and each chunk becomes its own compressed in-memory table. The first rows show in ~0.2 s while the rest loads.
- **One origin.** A Cloudflare Worker serves the app, DuckDB's bundles, and the sample, with the cross-origin isolation headers DuckDB needs.

The reasoning and the measurements behind each choice are in [`docs/DECISIONS.md`](docs/DECISIONS.md) and [`docs/LESSONS.md`](docs/LESSONS.md).

## Canvas tradeoffs

Only the table is drawn on a canvas, with its cell popover; the top bar, the first screen, the command bar, the panels (the column list, the log, the row view), the menus, the status bar, and the drop's haze are HTML, so they have what the DOM gives. Drawing the table to a canvas gives up some of it. Here's where Tycho stands on each, what it does today, and what closing the gap would take. The table's own are also in [its component's README](../../components/tall-table/README.md#canvas-tradeoffs).

- **Accessibility:** screen readers read the page's frame (its buttons, the first screen's list, the command bar and its answers, the log's entries, the column list, the menus, the row view, the file's facts, the engine's state) but not the table: the canvas has no accessibility tree. The DOM is the way around it: every column's actions are in the column list, a row per column whose menu holds what the header's does, and every value of the selected row is text in the Row tab, hidden columns and long text included. The cell popover is drawn on the canvas, so a screen reader doesn't read it; Enter again opens the same value in the Row tab. *Today:* everything works from the keyboard. The first screen's list takes the arrows and Enter (or a row's letter). Opening a file gives the table focus, where arrows move the selection (Shift to extend it), Page Up/Down, Space, and Home/End scroll it, and Enter opens a cut cell's popover or the row view, with focus at the cell's field; Escape there gives the table focus back. Cmd/Ctrl+K opens the command bar from anywhere, the table included; Enter runs a command and gives the table focus back, and Escape closes the bar, or in the log puts focus on the table. Cmd/Ctrl+Shift+L switches between the light and dark themes and Cmd/Ctrl+Shift+P opens the observation panel, wherever focus is. *To close it:* a hidden DOM mirror of the visible rows, kept in step with each frame.
- **Text input and IME:** nothing is typed on the canvas. The command bar is an HTML input, so typing, an IME, and paste work as in any page.
- **Text selection and copy:** the table's cells are selected the table's way (a cell, a range, whole rows or columns), not the browser's: Cmd/Ctrl+C or the cell's menu copies the selection as tab-separated text, up to 100,000 cells and 64 MiB, and says so in the status line when it can't. To select part of a value, open its row: the Row tab is text, and select-all there takes its fields alone, as it takes the log's entries in the Log tab.
- **Values wider than their column:** handled like a spreadsheet. A double too long for its column is rounded to the digits that fit (`45.00497837174552` shows as `45.004978372`), and goes scientific (`1.7014118e38`) only when its whole part doesn't fit. Integers are never rounded: their columns fit the type's widest value. An integer or decimal still too wide is cut in the middle (`9999999…999`), keeping its magnitude and its last digits; text ends in "…", and its line breaks show as ¶ (a cell is one line). Rest the pointer on a rounded or cut cell for half a second and a tooltip shows the exact value. Like the cells, the tooltip is drawn on the canvas, so screen readers don't see it, and only the pointer opens it.
- **Non-Latin scripts:** the canvas has only the bundled UI font (IBM Plex Sans: Latin, Greek, Cyrillic) plus emoji. Chinese, Japanese, Korean, and other scripts outside it draw as empty boxes in the table's cells and tooltips; the page's frame draws them with the browser's fonts. *To close it:* a fallback font for those scripts, loaded after first paint.
- **Ctrl+F:** the browser's find sees the page's frame, the log's entries, and the open row's fields, not the table's rows. There's no in-app find, filter, or sort yet ([`PLAN.md`](PLAN.md)).
- **Bundle size:** the app wasm is 2.84 MiB brotli, downloaded and compiled before first paint. It's smaller than version 1's by the canvas's title bar, empty state, and text field, which moved to HTML; the frame's stylesheet adds 6 KiB to what loads before first paint, and React with the frame's components (126 KiB) loads after it. DuckDB loads after first paint.
- **Overlapping panel:** the observation panel floats over the table's lower right, and a click there lands on the panel. *Today:* it keeps clear of the table's scrollbars, so a thumb at the bottom stays grabbable, but it still covers the cells under it. Hide it with its button or Cmd/Ctrl+Shift+P. While it's open it redraws the canvas 4 times a second (~20 ms of work each), even when nothing else moves; closed, an idle canvas draws nothing.

## File size limits

Everything runs in one browser tab, and the engine (DuckDB-Wasm, a 32-bit wasm build) has about 4 GB of address space. Measured on an Apple M1 in Chromium ([`perf/results/2026-10-08-m7-hardening.md`](perf/results/2026-10-08-m7-hardening.md)):

- **Parquet: up to 10 GB.** A Parquet file is read where it lies, so its size barely touches memory: a 9.6 GB file (423 M rows) held 5.6 MiB in DuckDB and 147 MiB across the tab. What grows is time, with the number of row groups: every page read sets up every row group. At DuckDB's default 122,880-row groups, first rows took 0.44 s at 2 GB, 1.0 s at 4.6 GB, and 3.5 s at 9.6 GB (3,445 row groups). Files over 10 GB, untested, are refused with a message.
- **CSV: up to 6 GB, and up to 1.5 GiB in memory.** A CSV has no index, so Tycho copies it into DuckDB's memory as it loads: about 0.28 bytes per byte for the asteroid CSV (a 5.4 GB file took 1.5 GiB), more for data that compresses badly (random text took 0.47). Past ~2.1 GiB, DuckDB-Wasm 1.32.0 silently stores empty tables instead of failing, and an 8.6 GB CSV lost 8.8 M rows that way with no error. So Tycho stops a load at 1.5 GiB of DuckDB memory, keeps the rows before it, and says why. It also refuses files over 6 GB before reading them. To open a bigger CSV, convert it to Parquet first.
- **Many files in one session:** each opened Parquet file's parsed footer stays in DuckDB for the session (2.2 MiB for a 1 GB file with 1,378 row groups; across the tab, ~16 MiB per open). Neither unregistering the file nor resetting DuckDB's metadata cache frees it. That's ~250 opens of such a file before the tab runs out; reload the page to start fresh.
- **When the engine stops anyway:** if DuckDB's worker dies (out of memory, say), the open file closes, the page says so, and Retry starts a new engine without a reload. Tycho notices at its next query, such as the next scroll.

## Run it locally

Install the prerequisites in the [root README](../../README.md#getting-started) first. Then, from the repo root:

```sh
just setup              # npm install (once)
just tycho data         # the sample, data/gcat.parquet: fetched from GCAT, decoded, checked (once; dev and build need it)
just tycho dev          # debug build + Vite with COOP/COEP → http://localhost:5173
just tycho build        # release build; prints raw/gzip/brotli asset sizes and the page's weight before first paint
just tycho preview      # serve the release build → http://localhost:4173
just tycho check        # fmt, clippy, tsc, release build, no home paths in the wasm, then the wasm-size budget
just tycho smoke        # Chromium/Firefox/WebKit: paints, cross-origin isolated, no console errors, resizes; on the preview's URL, nothing loads before first paint but the page
just tycho lockdown     # Chromium/Firefox/WebKit: what the locked engine refuses and still reads
just tycho engine       # Chromium/Firefox/WebKit: the engine's self-test, a failed load, a stopped worker, and Retry after each
just tycho view         # Chromium/Firefox/WebKit: a column moved, resized, and pinned, read back from the view
just tycho command      # Chromium/Firefox/WebKit: the command bar and the log, driven by keys, a paste, a drag, and the log's buttons
just tycho table        # Chromium/Firefox/WebKit: the column and cell menus, the column list, the popover, and the row view, wide and at a phone
```

Each browser check runs against the dev server by default; pass the preview's URL (`http://localhost:4173/`) for the release build. They need Playwright's browsers: run `npx playwright install chromium firefox webkit` once.

`just --list tycho` lists every recipe; [`CLAUDE.md`](CLAUDE.md) describes each one and its flags. Deploying (`just tycho deploy`) needs a Cloudflare login and an R2 API token; see [`docs/hosting.md`](docs/hosting.md).

## Docs

| File | What's in it |
|---|---|
| [`CLAUDE.md`](CLAUDE.md) | Rules, architecture, every command. Written for contributors and Claude Code alike. |
| [`engines/duckdb/`](../../engines/duckdb/) | The DuckDB engine Tycho runs on: its API, rules, DuckDB-Wasm gotchas, and decisions. |
| [`PLAN.md`](PLAN.md) | What's next: status, the rebuild's roadmap, open questions. |
| [`docs/DECISIONS.md`](docs/DECISIONS.md) | Why Tycho is built the way it is, by area, with the numbers behind each choice. |
| [`docs/LESSONS.md`](docs/LESSONS.md) | What surprised us, milestone by milestone. |
| [`docs/milestones.md`](docs/milestones.md) | The specs and evidence of each milestone. |
| [`docs/data.md`](docs/data.md), [`docs/hosting.md`](docs/hosting.md) | The sample and the test files, and how the app is served. |
| [`perf/budgets.json`](perf/budgets.json), [`perf/results/`](perf/results/) | The wasm-size budget, and version 1's measurements, dated: a JSON per run and a note per milestone. |

## Data credits

The sample is a re-hosted copy of public data, rewritten as Parquet: data from GCAT (J. McDowell, [planet4589.org/space/gcat](https://planet4589.org/space/gcat)), CC BY 4.0. Full citation: McDowell, Jonathan C., 2020. General Catalog of Artificial Space Objects, Release 1.8.9, https://planet4589.org/space/gcat. The live site, version 1, still serves its two old samples, from the NASA/JPL Small-Body Database and ESA's Gaia mission (processed by the Gaia Data Processing and Analysis Consortium, DPAC), until version 2 replaces it.
