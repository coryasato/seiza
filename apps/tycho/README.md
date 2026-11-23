# Tycho

> *Tycho Brahe catalogued a thousand stars in a lifetime. Tycho scrolls 25 million before your coffee cools.*

**Live at [tycho.seiza.io](https://tycho.seiza.io).**

> **Version 2 is being built:** a workbench for a file too big for a spreadsheet, to open it, understand it, check what you need, and export the part you want, with nothing uploaded ([`PLAN.md`](PLAN.md)). Until a section below is rewritten by the work that changes it, it describes version 1, the app that's live.

Tycho is a local-first data workbench in the browser. Drop a CSV or Parquet file, or click a sample, and scroll every row. DuckDB-Wasm queries the data in your tab, and GPUI (via GPUI Kit) draws it on a canvas with WebGPU, or WebGL2 where WebGPU isn't available. Nothing is uploaded.

- **Two samples, served by range:** every known asteroid (1.57 M rows, NASA/JPL) and Gaia DR3's 25.1 M brightest stars (ESA). Only the row groups you scroll to are downloaded.
- **Your own files:** Parquet up to 10 GB, read where it lies; CSV up to 6 GB, loaded in chunks while you scroll the rows already in.
- **Jump to row:** Cmd/Ctrl+G.
- **Observation panel:** the title bar's "Observation panel" button, Cmd/Ctrl+Shift+P, or `?perf` in the URL. It shows the page-load waterfall, frame times and work per frame, memory, bytes read against the file size, and cache hits, live.

Tycho is seiza's first utility app: a tool meant to grow with its users, not a fixed demo. v1 is done: all its milestones ([`docs/milestones.md`](docs/milestones.md)). Its table and its DuckDB layer are now reusable pieces, a [table component](../../components/tall-table/) and a [DuckDB engine](../../engines/duckdb/), which the [observatory](../observatory/) measures against a DOM equivalent built with React and TanStack Virtual. What's next is in [`PLAN.md`](PLAN.md).

## Measurements

Tycho doesn't measure itself: it's a tool, and the [observatory](../observatory/) measures the table it's built on against a DOM equivalent, both on its DuckDB engine. Its build gates one number, the app wasm's size (brotli). Version 1's measurements, the public site's included, stay in [`perf/results/`](perf/results/) as history.

## How it works

- **Paint first.** The app wasm (2.76 MiB brotli) holds only the UI. DuckDB (~5.6 MiB brotli) starts loading in a worker after the first frame, and the UI says so until it's ready. Before the wasm arrives, a static HTML copy of the empty shell holds the page.
- **A narrow bridge.** Rust and DuckDB's JS API talk through three calls: register a file, run a query, cancel a query. Schemas, row counts, and metadata are SQL. Results cross as Arrow IPC bytes, read by a small hand-rolled reader (arrow-rs cost 127 KiB more). The engine and its bridge are their own package, [`engines/duckdb/`](../../engines/duckdb/), which other apps can use.
- **Query per viewport.** The table asks only for the rows on screen plus a little ahead, in 1024-row pages read by row-group range from Parquet. Its scroll position is an f64 row index, because pixel-based lists lose precision past ~16 M px (25 M rows is 640 M px).
- **CSV loads in chunks.** A CSV has no index, so it's cut at record boundaries and each chunk becomes its own compressed in-memory table. The first rows show in ~0.2 s while the rest loads.
- **One origin.** A Cloudflare Worker serves the app, DuckDB's bundles, and the samples (by byte range from R2, cached at the edge), with the cross-origin isolation headers DuckDB needs.

The reasoning and the measurements behind each choice are in [`docs/DECISIONS.md`](docs/DECISIONS.md) and [`docs/LESSONS.md`](docs/LESSONS.md).

## Canvas tradeoffs

Drawing to a canvas gives up things the DOM does for free. Here's where Tycho stands on each, what it does today, and what closing the gap would take. The table's own are also in [its component's README](../../components/tall-table/README.md#canvas-tradeoffs).

- **Accessibility:** screen readers see nothing. The canvas has no accessibility tree, so the table, the buttons, and the jump input are invisible to them. *Today:* everything works from the keyboard. Arrows, Page Up/Down, Space, and Home/End scroll the focused table. Cmd/Ctrl+G jumps to a row, and Enter there hands the keys back to the table. Cmd/Ctrl+Shift+L switches between the light and dark themes, and Cmd/Ctrl+Shift+P opens the observation panel. Tab doesn't move between controls: GPUI Kit 0.8.0 binds nothing to it. *To close it:* a hidden DOM mirror of the visible rows and controls, kept in step with each frame.
- **Text input and IME:** the jump-to-row input is a canvas-drawn text field. A hidden browser input underneath it carries keys, composition, and paste. *Today:* typing, selection, undo, and IME composition work. A Japanese IME's full-width digits (`１２３`) are accepted, as are thousands separators (`1,000,000`). In a Mac browser, GPUI Kit 0.8.0's web build doesn't bind Cmd+A/C/X/Z in inputs, so Tycho binds them itself. Keys typed in the input never scroll the table.
- **Paste:** Cmd/Ctrl+V works with no permission prompt, because it's the browser's own paste event. The right-click menu is drawn by GPUI Kit, not the browser. Its Paste item reads the clipboard through the async Clipboard API, so the browser has to grant clipboard access first. If access is refused, nothing is pasted and nothing says why. The menu labels its shortcuts "Ctrl+…" even in a Mac browser, where Cmd works too.
- **Text selection and copy:** cells can't be selected or copied yet. Column resizing, selection, and sorting are planned, researched first, as features of the table ([its `PLAN.md`](../../components/tall-table/PLAN.md)).
- **Values wider than their column:** handled like a spreadsheet. A double too long for its column is rounded to the digits that fit (`45.00497837174552` shows as `45.004978372`), and goes scientific (`1.7014118e38`) only when its whole part doesn't fit. Integers are never rounded: their columns fit the type's widest value. An integer or decimal still too wide is cut in the middle (`9999999…999`), keeping its magnitude and its last digits; text ends in "…", and its line breaks show as ¶ (a cell is one line). Rest the pointer on a rounded or cut cell for half a second and a tooltip shows the exact value. Like the cells, the tooltip is drawn on the canvas, so screen readers don't see it, and only the pointer opens it.
- **Non-Latin scripts:** the canvas has only the bundled UI font (IBM Plex Sans: Latin, Greek, Cyrillic) plus emoji. Chinese, Japanese, Korean, and other scripts outside it draw as empty boxes, in cells and tooltips alike. *To close it:* a fallback font for those scripts, loaded after first paint.
- **Ctrl+F:** the browser's find doesn't see the rows, and there's no in-app search or filter yet. Jump to row is the way to get somewhere. It takes Cmd/Ctrl+G, which in a browser is "find next", since find has nothing to search here anyway.
- **Before the app arrives:** until the wasm has downloaded and drawn its first frame, the page shows a static HTML copy of the empty shell, so a visitor on a slow link sees the app's layout at ~0.25 s instead of a blank page for ~3.7 s (Fast 4G). It's a DOM layer over the canvas, and it's inert: its buttons are skeletons that can't be pressed, nothing in it can be selected, and screen readers skip it. It fades into the first frame over 120 ms (instantly with "reduce motion"). It can't be a perfect copy: the browser and GPUI draw the same font differently (GPUI's text is crisper and sits up to 2 px lower on a DPR 1 display), so the buttons are drawn as skeletons at GPUI's exact sizes rather than as text that would visibly shift. A file dropped before the app starts isn't caught. It adds 10.7 KiB brotli to `index.html`, most of it an inlined 8.5 KiB subset of the UI font; first paint, measured to GPUI's first frame, is unchanged within noise.
- **Bundle size:** the app wasm is 2.76 MiB brotli, downloaded and compiled before first paint. The jump input's text engine (editing, undo, selection, IME) is 88 KiB of that, ~3 ms of first paint on a fast machine and ~100 ms on Fast 4G. GPUI Kit's styled text field would have been 194 KiB, because it also links its multi-line and code-editor engines, so Tycho styles GPUI Kit's bare single-line field itself. DuckDB loads after first paint.
- **Overlapping panel:** the observation panel floats over the window's lower right, and a click there lands on the panel. *Today:* it keeps clear of the table's scrollbars, so a thumb at the bottom stays grabbable, but it still covers the cells under it. Hide it with its button or Cmd/Ctrl+Shift+P. While it's open it redraws the window 4 times a second (~20 ms of work each), even when nothing else moves; closed, an idle window draws nothing.

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
just tycho data         # fetch the asteroid catalog (~2.5 min, network, once), build the sample Parquet + CSV fixture, load local R2
just tycho data gaia    # the big sample: the first run reads ~90 GB from AWS Open Data (~50 min)
just tycho dev          # debug build + Vite with COOP/COEP → http://localhost:5173
just tycho build        # release build; prints raw/gzip/brotli asset sizes and the page's weight before first paint
just tycho preview      # serve the release build → http://localhost:4173
just tycho check        # fmt, clippy, tsc, release build, no home paths in the wasm, then the wasm-size budget
just tycho smoke        # Chromium/Firefox/WebKit: paints, cross-origin isolated, no console errors, resizes; on the preview's URL, nothing loads before first paint but the page
```

The smoke check needs Playwright's browsers: run `npx playwright install chromium firefox webkit` once.

`just --list tycho` lists every recipe; [`CLAUDE.md`](CLAUDE.md) describes each one and its flags. Deploying (`just tycho deploy`) needs a Cloudflare login and an R2 API token; see [`docs/hosting.md`](docs/hosting.md).

## Docs

| File | What's in it |
|---|---|
| [`CLAUDE.md`](CLAUDE.md) | Rules, architecture, every command. Written for contributors and Claude Code alike. |
| [`engines/duckdb/`](../../engines/duckdb/) | The DuckDB engine Tycho runs on: its API, rules, DuckDB-Wasm gotchas, and decisions. |
| [`PLAN.md`](PLAN.md) | What's next: status, the rebuild's goals, open questions. |
| [`docs/DECISIONS.md`](docs/DECISIONS.md) | Why Tycho is built the way it is, by area, with the numbers behind each choice. |
| [`docs/LESSONS.md`](docs/LESSONS.md) | What surprised us, milestone by milestone. |
| [`docs/milestones.md`](docs/milestones.md) | The specs and evidence of each milestone. |
| [`docs/data.md`](docs/data.md), [`docs/hosting.md`](docs/hosting.md) | The samples, and how the app is served. |
| [`perf/budgets.json`](perf/budgets.json), [`perf/results/`](perf/results/) | The wasm-size budget, and version 1's measurements, dated: a JSON per run and a note per milestone. |

## Data credits

The samples are re-hosted copies of public data, rewritten as Parquet:

- **Asteroids:** NASA/JPL Small-Body Database.
- **Stars:** This work has made use of data from the European Space Agency (ESA) mission Gaia, processed by the Gaia Data Processing and Analysis Consortium (DPAC).
