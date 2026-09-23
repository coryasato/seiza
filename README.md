# seiza (星座)

**seiza** ("constellation") is a monorepo of heavy web apps built with [GPUI](https://www.gpui.rs/) (via [GPUI Kit](https://github.com/longbridge/gpui-kit)), compiled to WebAssembly, and drawn on a WebGL2 canvas.

The thesis: **WebAssembly + GPU-rendered UI builds heavy web apps better than the DOM.** Every claim here needs a number on screen to back it up, so each app ships with a perf overlay and a reproducible measurement suite.

> **Status:** M0. Tycho's empty shell paints on the web. Follow along in [`apps/tycho/PLAN.md`](apps/tycho/PLAN.md).

## Apps

| App | What it is | Status |
|---|---|---|
| [**Tycho**](apps/tycho/) | Local-first data workbench. Drop a CSV or Parquet file (or click a sample) and scroll every row instantly. Queried locally with DuckDB-Wasm; nothing is uploaded. | M0: shell only |

> *Tycho Brahe catalogued a thousand stars in a lifetime. Tycho scrolls 25 million before your coffee cools.*

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
just tycho dev      # debug wasm + Vite dev server with COOP/COEP → http://localhost:5173
just tycho build    # release build, prints raw/gzip/brotli asset sizes
just tycho preview  # serve the release build
just tycho smoke    # Chromium/Firefox/WebKit shell check against a running server
just tycho check    # fmt, clippy, tsc, release wasm build
```

For Playwright's browsers, run `npx playwright install chromium firefox webkit` once.

## How we measure

Playwright + headless Chromium, cold cache, 1440×900 at DPR 2, median of 10 runs, plus a throttled run (4× CPU, Fast 4G). TTFP is measured from `performance.timeOrigin` to a `gpui:first-frame` mark set in the first `requestAnimationFrame` after GPUI's first draw. Browser FP/FCP aren't used, since a canvas makes them meaningless. Firefox and Safari get a manual check each milestone.

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
