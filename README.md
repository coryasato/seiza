# seiza (星座)

**seiza** ("constellation") is a monorepo of heavy web apps built with [GPUI](https://www.gpui.rs/) (via [GPUI Kit](https://github.com/longbridge/gpui-kit)), compiled to WebAssembly, and drawn on a canvas with WebGPU (WebGL2 where WebGPU isn't available).

The thesis: **WebAssembly + GPU-rendered UI builds heavy web apps better than the DOM.** Every claim here needs a number on screen to back it up, so each utility app ships with a live observation panel and a reproducible measurement suite, its README says where the canvas still falls short, and the observatory measures its components against DOM equivalents.

The repo holds four kinds of thing:

- **Utility apps:** tools meant to be used, each on its own subdomain and named for an astronomer. They grow into real tools.
- **The observatory:** one comparison page, at seiza.io/observatory. It runs each component's base level against a 1:1 DOM equivalent (first GPUI | TanStack: React + TanStack Virtual), one at a time, on the same engine and data, measures what each costs over a session of use, and shows where each side wins.
- **Components:** generic UI libraries in the style of GPUI Kit's components (a table, later others). A minimal base, plus capabilities like sorting as features a build turns on.
- **Engines:** the data layers both sides of a comparison share (DuckDB-Wasm today).

## Apps

| App | What it is | Status |
|---|---|---|
| [**Tycho**](apps/tycho/) | Local-first data workbench. Drop a CSV or Parquet file (or click a sample) and scroll every row. Queried in the tab with DuckDB-Wasm; nothing is uploaded. | v1 live at [tycho.seiza.io](https://tycho.seiza.io) |
| [**Observatory**](apps/observatory/) | The comparison page: a component's base level in GPUI against a DOM equivalent (GPUI \| TanStack), same engine, same data, measured over a session of use. | In progress: its data file is served from seiza.io; no page yet |

Headline numbers, local release builds under the protocol below (each app's README has its full tables, production included):

<!-- report:headlines:start -->
- **[Observatory](apps/observatory/)**: not measured yet
- **[Tycho](apps/tycho/)**: first paint 187.5 ms · 25.1 M rows → first rows 289.4 ms · fling p95 16.7 ms
<!-- report:headlines:end -->

## Principles

1. **Time to first paint is the deciding metric.** Nothing delays first paint: not engines, not data, not extra fonts. Every app has TTFP and wasm-size budgets that fail the build on a regression.
2. **Paint first, load heavy things after.** Engines, workers, and datasets start loading after the first frame. The UI stays usable and says what's still loading.
3. **Measure before and after.** Every milestone ends with a measurement, committed to `apps/<app>/perf/results/`.
4. **Canvas tradeoffs in the open.** Accessibility, IME, text selection, Ctrl+F, and bundle size are real costs of drawing to a canvas. Where an app falls short, it says so in its UI and README.

## How we measure

Playwright with headless Chromium, cold cache, 1440×900 at DPR 2, median of 10 runs, plus a throttled run (4× CPU, Fast 4G). Time to first paint (TTFP) runs from `performance.timeOrigin` to a `gpui:first-frame` mark set right after GPUI presents its first real frame, checked against the page's actual GPU calls on every run. Browser FP/FCP aren't used: a canvas makes them meaningless. Firefox and Safari get a manual check each milestone.

Budgets gate the local release build only. Production numbers are recorded next to the local ones, never enforced: the network and the CDN vary too much to gate on.

## Stack

- **UI:** `gpui-kit`, pinned to an exact version (0.7.3) for every app, targeting `wasm32-unknown-unknown`. The pinned `Cargo.lock` holds the whole gpui family.
- **Shared foundation:** `shared/` (crate `seiza`): the wasm bootstrap (fonts → init → first frame → post-paint hook), the window root (first-frame mark, system theme), the observation panel, and the page clock and marks. Title bars and theme toggles are each app's. `shared-web/`: the JS bootstrap, the Vite config with COOP/COEP headers, the static placeholder shell, the UI font, and the perf harness every app's scripts share.
- **JS host:** a thin Vite layer per app. Logic lives in Rust unless it must touch a JS-only API.
- **Hosting:** Cloudflare Workers (static assets + R2), cross-origin isolated (`COOP: same-origin`, `COEP: require-corp`) in dev and production. Each utility app has its own Worker on its own subdomain of seiza.io, and serves its build precompressed at brotli quality 11, because Cloudflare's own compression is much weaker. The observatory's Worker holds seiza.io itself; today it serves the observatory's data file, by byte range through the edge cache, since Workers static assets don't answer ranges.

## Layout

```
seiza/
  Cargo.toml            # workspace; pins gpui-kit; release profile
  Cargo.lock            # committed; pins the whole gpui family
  rust-toolchain.toml   # dated nightly + wasm32 target
  justfile              # `just <app> <recipe>`; one module per app
  shared/               # crate `seiza`: app-agnostic Rust
  shared-web/           # app-agnostic JS host pieces, fonts, the shared perf harness
  components/
    tall-table/         # the table for tens of millions of rows (seiza-tall-table)
  engines/
    duckdb/             # DuckDB-Wasm for every app: a Rust crate (seiza-duckdb) and an npm package (@seiza/duckdb)
  apps/
    observatory/        # the comparison page: web/, worker/ (seiza.io), data/, perf/, docs/; no page yet
    <app>/
      README.md         # what it is, its numbers, its canvas tradeoffs, how to run it
      CLAUDE.md         # rules, architecture, gotchas, commands
      PLAN.md           # what's next: status, the active milestone, open questions
      crate/            # Rust (cdylib)
      web/              # Vite host
      worker/           # Cloudflare Worker
      data/             # dataset scripts (generated data is gitignored)
      perf/             # Playwright suite, budgets.json, baseline.json, results/
      docs/             # DECISIONS.md, LESSONS.md, milestones.md, reference docs
  docs/
    DECISIONS.md        # repo-wide decisions
    templates/app/      # the docs skeleton a new app starts from
    templates/component/ # the docs skeleton a new component or engine starts from
```

Reusable pieces leave an app once a second consumer needs them: UI to `components/<name>/` (a Rust crate), data layers to `engines/<name>/` (a crate and/or an npm package). The first engine is [`engines/duckdb/`](engines/duckdb/), Tycho's DuckDB layer, and the first component [`components/tall-table/`](components/tall-table/), Tycho's table. The observatory's GPUI contender will be their second consumer.

## Getting started

Prerequisites:

- [rustup](https://rustup.rs). `rust-toolchain.toml` installs the pinned nightly and the `wasm32-unknown-unknown` target on first build.
- `wasm-bindgen-cli` matching the locked version: `cargo install wasm-bindgen-cli --version 0.2.121 --locked`
- [`just`](https://github.com/casey/just) and `wasm-opt` from [Binaryen](https://github.com/WebAssembly/binaryen) (`brew install just binaryen`)
- Node.js 22.18+ (scripts are TypeScript run by Node's built-in type stripping)
- For the measurement suites, Playwright's browsers: `npx playwright install chromium firefox webkit`

```sh
just setup                      # npm install for every app host
just --list --list-submodules   # every recipe, per app
```

Then follow the app's README (Tycho: [Run it locally](apps/tycho/README.md#run-it-locally)).

## Docs

Each fact has one home, and everything else links to it.

| Where | What |
|---|---|
| `CLAUDE.md` (here) | Repo-wide rules, the stack and its pins, the measurement protocol, GPUI Kit and Cloudflare gotchas. Written for contributors and [Claude Code](https://claude.com/claude-code) alike. |
| `apps/<app>/README.md` | The app for a visitor: what it does, its numbers, its canvas tradeoffs and limits, how to run it. |
| `components/<name>/`, `engines/<name>/` | A README for its user (API, features, limits), a CLAUDE.md, and a `docs/DECISIONS.md`. Its work is planned and measured in the app that drives it. |
| `apps/<app>/CLAUDE.md` | The app's rules, architecture, gotchas, and commands. |
| `apps/<app>/PLAN.md` | What's next: status, the active milestone's checks, long-term goals, open questions. |
| `docs/DECISIONS.md`, `apps/<app>/docs/DECISIONS.md` | Why things are built the way they are, by area, with the numbers. Repo-wide here, app-specific in the app. |
| `apps/<app>/docs/LESSONS.md` | What surprised us, milestone by milestone. |
| `apps/<app>/docs/milestones.md` | Finished milestones' specs and evidence. |
| `apps/<app>/perf/budgets.json` | Every budget, and where its current number comes from. |
| `apps/<app>/perf/results/` | Every measurement, dated. Numbers in the READMEs and PLANs are generated from these (`just <app> report`). |

The full rules are in [`CLAUDE.md`](CLAUDE.md), "Docs: one home per fact". A new app starts from [`docs/templates/app/`](docs/templates/app/); a new component or engine from [`docs/templates/component/`](docs/templates/component/).

## Fonts

The UI face is [IBM Plex Sans](https://github.com/IBM/plex), © IBM Corp., under the SIL Open Font License 1.1 ([`shared-web/fonts/OFL.txt`](shared-web/fonts/OFL.txt)). The static placeholder uses a subset of it (printable ASCII and "…"), renamed "Seiza Placeholder" as the license requires of a modified version; [`shared-web/fonts/make-placeholder-font.py`](shared-web/fonts/make-placeholder-font.py) makes it.

The theme button's sun and moon are [Lucide](https://lucide.dev) icons (ISC license), embedded through GPUI Kit's assets.

## License

Licensed under either of

- Apache License, Version 2.0 ([LICENSE-APACHE](LICENSE-APACHE))
- MIT license ([LICENSE-MIT](LICENSE-MIT))

at your option.

Unless you explicitly state otherwise, any contribution intentionally submitted for inclusion in this work, as defined in the Apache-2.0 license, shall be dual licensed as above, without any additional terms or conditions.
