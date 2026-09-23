# webgpui

**webgpui** is a monorepo of heavy web apps built with GPUI (via GPUI Kit) compiled to WebAssembly and drawn on a WebGL2 canvas. The apps share one Cargo workspace, one `gpui-kit` pin, and a common foundation crate (`shared/`).

The goal of every app here is to show that **WebAssembly + GPU-rendered UI builds heavy web apps better than the DOM**. Every claim needs a number on screen to back it up.

This file holds the rules for every app. Each app has its own `apps/<app>/CLAUDE.md` (app context and rules) and `apps/<app>/PLAN.md` (milestones, build data, decisions, measurements). Both apply when working inside an app.

**Apps**
- `apps/tycho/`: Tycho, a local-first data workbench (DuckDB-Wasm + virtualized table).

---

## Repo-wide rules

1. **Time to first paint is the deciding metric.** Nothing may delay first paint: not engines, not data, not fonts beyond the one UI face. If a change adds bytes to an app's wasm, record its size effect in the commit/PR message. A change to `shared/` affects every app, so record the effect for each one.
2. **Paint first, load heavy things after.** Engines, workers, and datasets start loading after the first frame appears. The UI stays usable and says what's still loading.
3. **Measure before and after.** Every milestone ends with a measurement using the protocol below. The numbers go in `apps/<app>/perf/results/` and a short note goes in `apps/<app>/docs/LESSONS.md`.
4. **Handle the canvas tradeoffs in the open** (a11y, IME, text selection, Ctrl+F, bundle size). When an app falls short on one, it says so in the UI or README. It never hides the gap.

## Stack and pins

- **UI:** `gpui-kit` (longbridge/gpui-kit), **pinned to an exact version** in the workspace `Cargo.toml` (0.6.4 was current on 2026-09-22). All apps use the same pin. Target `wasm32-unknown-unknown`.
- **JS host:** a thin Vite layer per app (`apps/<app>/web/`), built on `shared-web/`. Keep it thin: new logic goes in Rust unless it must touch a JS-only API.
- **Headers everywhere, dev included:** `Cross-Origin-Opener-Policy: same-origin` and `Cross-Origin-Embedder-Policy: require-corp`. `shared-web/` provides the dev-server config so every app gets them from day one, and cross-origin problems show up early instead of at deploy.
- **Hosting:** Cloudflare Workers (static assets + R2 where needed), one Worker per app in `apps/<app>/worker/`.

### Known GPUI Kit web gotchas (check before debugging)

- **Load fonts before `gpui_kit::init`.** On wasm there are no system fonts. `Theme::change` resolves `.SystemUIFont` during init and panics on an empty font database, and because wasm uses `panic=abort`, the canvas never paints. Call `add_fonts(...)` (bundled UI font) first, then init. See longbridge/gpui-kit#3101 and #3105. `shared/`'s bootstrap handles this; apps shouldn't call init themselves.
- **The Input context-menu "Paste" item is always disabled on web.** Cmd/Ctrl+V still works. See #3187.
- Install `console_error_panic_hook` in debug builds. A panic shows up as `RuntimeError: unreachable` unless the hook is installed.

## Repo layout

```
webgpui/
  Cargo.toml            # workspace; pins gpui-kit
  shared/               # crate `webgpui`: wasm bootstrap, app shell, theme, perf overlay, file helpers
  shared-web/           # reusable JS host bits: bootstrap, COOP/COEP dev-server config
  apps/
    tycho/
      crate/            # Rust (cdylib)
      web/              # Vite host, duckdb.worker.ts, bridge.ts
      worker/           # Cloudflare Worker + wrangler.toml
      data/  perf/  docs/
      CLAUDE.md         # Tycho context and rules
      PLAN.md           # Tycho milestones, datasets, hosting, decisions, measurements
  CLAUDE.md             # this file: repo-wide rules
  justfile              # `just tycho dev`, `just tycho perf`, …
```

## `shared/` and `shared-web/` conventions

- Code goes in `shared/` only if it has no knowledge of any app: no DuckDB, no app types, no app strings. Apps depend on `shared/`, never the reverse.
- The perf overlay lives in `shared/`. It owns the common metrics (TTFP, frame times, wasm memory) and lets apps register their own metrics.
- `shared/` owns the web bootstrap order (panic hook → fonts → `gpui_kit::init` → first frame → `gpui:first-frame` mark → post-paint callback). Apps hook into the post-paint callback to start heavy loads.
- When a GPUI Kit web bug blocks progress, check upstream issues first. Work around it in `shared/` with a comment linking the issue. Don't fork unless there's no other way.
- Code starts in the app. Move it to `shared/` once it's clearly app-agnostic. Don't build abstractions for apps that don't exist yet.

## Commands

Each app has its own justfile, loaded as a `just` module from the root:

```
just <app> <recipe>   # e.g. just tycho dev, just tycho perf
```

Each app's recipes are listed in its CLAUDE.md.

## Measurement protocol

Every "done when" check that includes a number, in every app, uses this protocol.

- **Reference run:** Playwright with Chromium in headless=new mode, a cold cache, 1440×900 at DPR 2, **median of 10 runs**. Save the results with the machine name and date.
- **Throttled run:** same setup with CPU 4× slowdown and "Fast 4G" network. Both runs are recorded, but budgets apply to the reference run.
- **First paint (TTFP):** from `performance.timeOrigin` to the first frame GPUI actually presents. `shared/` calls `performance.mark("gpui:first-frame")` inside the first `requestAnimationFrame` after the first draw. Don't use the browser's FP/FCP metrics, because the canvas makes them meaningless.
- **Cross-browser check:** each milestone also gets a manual check in Firefox and Safari. Note any differences.

## Working agreements for Claude Code

- Work on one app milestone at a time. At the start, restate the "done when" checks. At the end, show the evidence for each check (numbers, trace excerpts, screenshots).
- Keep JS small and typed. Any logic that could live in Rust lives in Rust.
- Before starting an app's next milestone, add an entry to its `docs/LESSONS.md`: what surprised us, the numbers, and the decisions made.
- Update the app's `PLAN.md` as checks pass and decisions land.
