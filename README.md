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
| App wasm (brotli) | ≤ 3012 KiB | 2654 KiB |
| Sample click → first rows (1.57 M rows, engine warm) | ≤ 500 ms | 239 ms |
| Fling top → bottom in 3 s: p95 / worst frame | ≤ 20 / 50 ms | 16.7 / 33.3 ms |
| Scrollbar jump to 90% → real rows | ≤ 400 ms | 133 ms |
| App memory after scrolling every row twice | ≤ 128 MiB | 89 MiB |

On a throttled run (4× CPU, Fast 4G), frames stay smooth, but rows arrive slowly: first rows 3.4 s, a jump 2.2 s. Details in [`apps/tycho/perf/results/`](apps/tycho/perf/results/).

## Canvas tradeoffs (Tycho, as of M4)

Drawing to a canvas gives up things the DOM does for free. Where Tycho stands today:

- **Accessibility:** the table isn't exposed to screen readers. Keyboard scrolling works (arrows, Page Up/Down, Space, Home/End) once the table has focus.
- **Text selection:** you can't select or copy cells yet.
- **Ctrl+F:** the browser's find doesn't see the rows. There's no in-app search yet.
- **IME:** no text input yet, so nothing to compose into.
- **Bundle size:** the app wasm is 2.6 MiB brotli before first paint; DuckDB (~5.6 MiB brotli: its wasm, worker, and JS, plus the Parquet extension) loads after it.
- **Table features:** no column resizing, selection, or sorting. Tycho draws its own table because GPUI Kit's `DataTable` can't scroll millions of rows precisely. Adding those features is a researched-first goal after v1 ([`PLAN.md`](apps/tycho/PLAN.md), "Long-term goals").

M7 turns this into a full section with what each gap would take to close.

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
