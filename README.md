# seiza (星座)

**seiza** ("constellation") is a monorepo of heavy web apps built with [GPUI](https://www.gpui.rs/) (via [GPUI Kit](https://github.com/longbridge/gpui-kit)), compiled to WebAssembly, and drawn on a canvas with WebGPU (WebGL2 where WebGPU isn't available).

The thesis: **WebAssembly + GPU-rendered UI builds heavy web apps better than the DOM.** Every claim here needs a number on screen to back it up, so each app ships with a perf overlay and a reproducible measurement suite.

> **Status:** Tycho is at M4 of 8. It opens a 1.57-million-row asteroid catalog over HTTP and scrolls every row, all local. Follow along in [`apps/tycho/PLAN.md`](apps/tycho/PLAN.md).

## Apps

| App | What it is | Status |
|---|---|---|
| [**Tycho**](apps/tycho/) | Local-first data workbench. Drop a CSV or Parquet file (or click a sample) and scroll every row instantly. Queried locally with DuckDB-Wasm; nothing is uploaded. | M4: asteroid sample and virtualized table; file drop next |

> *Tycho Brahe catalogued a thousand stars in a lifetime. Tycho scrolls 25 million before your coffee cools.*

## Numbers so far

Tycho, measured locally (Apple M1, headless Chromium, 1440×900 at DPR 2, median of 10) against the release build. The headline numbers will come from the deployed site in M8.

| Metric | Budget | Now |
|---|---|---|
| Time to first paint | ≤ 195 ms (baseline + 10%) | 170 ms |
| App wasm (brotli) | ≤ 3012 KiB | 2806 KiB (M7: +88 KiB for the jump input, +6 KiB for error states and limits) |
| Sample click → first rows (1.57 M rows, engine warm) | ≤ 500 ms | 239 ms |
| Fling top → bottom in 3 s: p95 / worst frame | ≤ 20 / 50 ms | 16.7 / 33.3 ms |
| Scrollbar jump to 90% → real rows | ≤ 400 ms | 133 ms |
| App memory after scrolling every row twice | ≤ 128 MiB | 89 MiB |

On a throttled run (4× CPU, Fast 4G), frames stay smooth, but rows arrive slowly: first rows 3.4 s, a jump 2.2 s. Details in [`apps/tycho/perf/results/`](apps/tycho/perf/results/).

## Canvas tradeoffs (Tycho, as of M7)

Drawing to a canvas gives up things the DOM does for free. Here's where Tycho stands on each, what it does today, and what closing the gap would take.

- **Accessibility:** screen readers see nothing: the canvas has no accessibility tree, so the table, the buttons, and the jump input are invisible to them. *Today:* everything works from the keyboard. Arrows, Page Up/Down, Space, and Home/End scroll the focused table. Cmd/Ctrl+G jumps to a row, and Enter there hands the keys back to the table. *To close it:* a hidden DOM mirror of the visible rows and controls, kept in step with each frame.
- **Text input and IME:** the jump-to-row input is GPUI Kit's canvas-drawn text field. A hidden browser input underneath it carries keys, composition, and paste. *Today:* typing, selection, undo, and IME composition work. A Japanese IME's full-width digits (`１２３`) are accepted, as are thousands separators (`1,000,000`). In a Mac browser, GPUI Kit 0.7.1's web build doesn't bind Cmd+A/C/X/Z in inputs, so Tycho binds them itself. Keys typed in the input never scroll the table.
- **Paste:** Cmd/Ctrl+V works with no permission prompt, because it's the browser's own paste event. The right-click menu is drawn by GPUI Kit, not the browser. Its Paste item reads the clipboard through the async Clipboard API, so the browser has to grant clipboard access first. If access is refused, nothing is pasted and nothing says why. The menu labels its shortcuts "Ctrl+…" even in a Mac browser, where Cmd works too.
- **Text selection and copy:** cells can't be selected or copied yet. Column resizing, selection, and sorting are a researched-first goal after v1 ([`PLAN.md`](apps/tycho/PLAN.md), "Long-term goals").
- **Ctrl+F:** the browser's find doesn't see the rows, and there's no in-app search (v1 scope excludes filtering). Jump to row is the way to get somewhere. It takes Cmd/Ctrl+G, which in a browser is "find next", since find has nothing to search here anyway.
- **Bundle size:** the app wasm is 2.74 MiB brotli, downloaded and compiled before first paint. The jump input's text engine (editing, undo, selection, IME) is 88 KiB of that, ~3 ms of first paint on a fast machine and ~100 ms on Fast 4G. GPUI Kit's styled text field would have been 194 KiB, because it also links its multi-line and code-editor engines, so Tycho styles GPUI Kit's bare single-line field itself. DuckDB (~5.6 MiB brotli: its wasm, worker, and JS, plus the Parquet extension) loads after first paint.
- **Overlapping panel:** the observation panel floats over the window's lower right, and a click there lands on the panel. *Today:* it keeps clear of the table's scrollbars, so a thumb at the bottom stays grabbable, but it still covers the cells under it. Hide it with its button or Cmd/Ctrl+Shift+P. While it's open it redraws the window 4 times a second (~20 ms of work each), even when nothing else moves; closed, an idle window draws nothing.

## File size limits (Tycho, as of M7)

Everything runs in one browser tab, and a tab's engine (DuckDB-Wasm, a 32-bit wasm build) has about 4 GB of address space. Measured on an Apple M1 in Chromium ([`apps/tycho/perf/results/2026-10-08-m7-hardening.md`](apps/tycho/perf/results/2026-10-08-m7-hardening.md)):

- **Parquet: up to 10 GB.** A Parquet file is read where it lies, so its size barely touches memory: a 9.6 GB file (423 M rows) held 5.6 MiB in DuckDB and 147 MiB across the tab. What grows is time, with the number of row groups: every page read sets up every row group. At DuckDB's default 122,880-row groups, first rows took 0.44 s at 2 GB, 1.0 s at 4.6 GB, and 3.5 s at 9.6 GB (3,445 row groups). Files over 10 GB, untested, are refused with a message.
- **CSV: up to 6 GB, and up to 1.5 GiB in memory.** A CSV has no index, so Tycho copies it into DuckDB's memory as it loads: about 0.28 bytes per byte for the asteroid CSV (a 5.4 GB file took 1.5 GiB), more for data that compresses badly (random text took 0.47). Past ~2.1 GiB, DuckDB-Wasm 1.32.0 silently stores empty tables instead of failing, and an 8.6 GB CSV lost 8.8 M rows that way with no error. So Tycho stops a load at 1.5 GiB of DuckDB memory, keeps the rows before it, and says why. It also refuses files over 6 GB before reading them. To open a bigger CSV, convert it to Parquet first.
- **Many files in one session:** each opened Parquet file's parsed footer stays in DuckDB for the session (2.2 MiB for a 1 GB file with 1,378 row groups; across the tab, ~16 MiB per open). Neither unregistering the file nor resetting DuckDB's metadata cache frees it. That's ~250 opens of such a file before the tab runs out; reload the page to start fresh.
- **When the engine stops anyway:** if DuckDB's worker dies (out of memory, say), the open file closes, the page says so, and Retry starts a new engine without a reload. Tycho notices at its next query, such as the next scroll.

## Principles

1. **Time to first paint is the deciding metric.** Nothing delays first paint: not engines, not data, not extra fonts. Every app has TTFP and wasm-size budgets that fail the build on regression.
2. **Paint first, load heavy things after.** Engines, workers, and datasets start loading after the first frame. The UI stays usable and says what's still loading.
3. **Measure before and after.** Every milestone ends with a measurement, committed to `apps/<app>/perf/results/`.
4. **Canvas tradeoffs in the open.** Accessibility, IME, text selection, Ctrl+F, and bundle size are real costs of drawing to a canvas. Where an app falls short, it says so in the UI and README.

## Stack

- **UI:** `gpui-kit`, pinned to an exact version, targeting `wasm32-unknown-unknown`.
- **Shared foundation:** `shared/` (crate `seiza`): wasm bootstrap, app shell, theme, perf overlay. `shared-web/`: JS bootstrap and COOP/COEP dev-server config.
- **JS host:** a thin Vite layer per app. Logic lives in Rust unless it must touch a JS-only API.
- **Hosting:** Cloudflare Workers (static assets + R2), one Worker per app, cross-origin isolated (`COOP: same-origin`, `COEP: require-corp`) in dev and prod.

## Layout

```
seiza/
  Cargo.toml     # workspace; pins gpui-kit
  justfile       # `just <app> <recipe>`
  shared/        # crate `seiza`, app-agnostic
  shared-web/    # reusable JS host bits
  apps/
    tycho/       # crate/, web/, worker/, data/, perf/, docs/
```

## Getting started

Prerequisites:

- [rustup](https://rustup.rs). `rust-toolchain.toml` installs the pinned nightly and the `wasm32-unknown-unknown` target on first build.
- `wasm-bindgen-cli` matching the locked version: `cargo install wasm-bindgen-cli --version 0.2.121 --locked`
- [`just`](https://github.com/casey/just) and `wasm-opt` from [Binaryen](https://github.com/WebAssembly/binaryen) (`brew install just binaryen`)
- Node.js 22.18+ (scripts are TypeScript run by Node's built-in type stripping)

```sh
just setup          # npm install
just tycho data     # fetch the asteroid catalog once (~2.5 min, network), build the sample Parquet, load it into local R2
just tycho data gaia  # the big sample: Gaia DR3's 25 M brightest stars (first run reads ~90 GB from AWS Open Data, ~50 min)
just tycho dev      # debug wasm + Vite dev server with COOP/COEP → http://localhost:5173 (+ the Worker for /data/*)
just tycho build    # release build, prints raw/gzip/brotli asset sizes
just tycho preview  # serve the release build → http://localhost:4173
just tycho check    # fmt, clippy, tsc, release build, then the TTFP and wasm-size budgets
```

Measurement suites, all against the release build (run `just tycho build` first):

```sh
just tycho perf     # cold-load TTFP, reference + throttled, median of 10
just tycho sample   # sample click → schema, bytes transferred, early click, failure modes
just tycho table    # first rows, fling, scrollbar jump, last row, memory (--sweep, --browsers)
just tycho engine   # DuckDB self-test: types, cancel
just tycho smoke    # Chromium/Firefox/WebKit shell check against a running server
```

Add `?perf` to the URL (or press Cmd/Ctrl+Shift+P) for the perf overlay. For Playwright's browsers, run `npx playwright install chromium firefox webkit` once. The full list of recipes is in [`apps/tycho/CLAUDE.md`](apps/tycho/CLAUDE.md).

## How we measure

Playwright + headless Chromium, cold cache, 1440×900 at DPR 2, median of 10 runs, plus a throttled run (4× CPU, Fast 4G). TTFP is measured from `performance.timeOrigin` to a `gpui:first-frame` mark set right after GPUI presents its first real frame (checked against the page's actual GPU calls on every run). Browser FP/FCP aren't used, since a canvas makes them meaningless. Firefox and Safari get a manual check each milestone.

## Working with this repo

The `CLAUDE.md` files (root and per app) are the project's working rules and are written for both humans and [Claude Code](https://claude.com/claude-code). Each app's `PLAN.md` holds its milestones, "done when" checks, decisions log, and measurements; `docs/LESSONS.md` records what each milestone taught us.

## Fonts

The UI face is [IBM Plex Sans](https://github.com/IBM/plex), © IBM Corp., under the SIL Open Font License 1.1 ([`shared-web/fonts/OFL.txt`](shared-web/fonts/OFL.txt)).

## Data credits

Tycho's sample datasets are re-hosted copies of public data:

- **Asteroids:** NASA/JPL Small-Body Database.
- **Stars:** This work has made use of data from the European Space Agency (ESA) mission Gaia, processed by the Gaia Data Processing and Analysis Consortium (DPAC).

## License

Licensed under either of

- Apache License, Version 2.0 ([LICENSE-APACHE](LICENSE-APACHE))
- MIT license ([LICENSE-MIT](LICENSE-MIT))

at your option.

Unless you explicitly state otherwise, any contribution intentionally submitted for inclusion in this work, as defined in the Apache-2.0 license, shall be dual licensed as above, without any additional terms or conditions.
