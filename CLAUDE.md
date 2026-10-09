# seiza (星座)

**seiza** (星座, "constellation") is a monorepo of heavy web apps built with GPUI (via GPUI Kit) compiled to WebAssembly and drawn on a canvas with WebGPU (WebGL2 where WebGPU isn't available). The apps share one Cargo workspace, one `gpui-kit` pin, and a common foundation crate (`shared/`).

The goal of every app here is to show that **WebAssembly + GPU-rendered UI builds heavy web apps better than the DOM**. Every claim needs a number on screen to back it up.

This file holds the rules for every app. Each app has its own `apps/<app>/CLAUDE.md` (app context and rules) and `apps/<app>/PLAN.md` (milestones, build data, decisions, measurements). Both apply when working inside an app.

**Apps**
- `apps/tycho/`: Tycho, a local-first data workbench (DuckDB-Wasm + virtualized table).

---

## Repo-wide rules

1. **Time to first paint is the deciding metric.** Nothing may delay first paint: not engines, not data, not fonts beyond the one UI face. If a change adds bytes to an app's wasm, record its size effect in that app's `perf/results/` notes, not the commit message. A change to `shared/` affects every app, so record the effect for each one. Each app's `just <app> check` enforces its TTFP and wasm-size budgets and fails the build on a regression. Budgets live in that app's `PLAN.md` and `perf/baseline.json`.
2. **Paint first, load heavy things after.** Engines, workers, and datasets start loading after the first frame appears. The UI stays usable and says what's still loading.
3. **Measure before and after.** Every milestone ends with a measurement using the protocol below. The numbers go in `apps/<app>/perf/results/` (committed; large raw Playwright traces go in `perf/results/raw/`, which is gitignored) and a short note goes in `apps/<app>/docs/LESSONS.md`.
4. **Handle the canvas tradeoffs in the open** (a11y, IME, text selection, Ctrl+F, bundle size). When an app falls short on one, it says so in the UI or README. It never hides the gap.

## Stack and pins

- **UI:** `gpui-kit` (longbridge/gpui-kit), **pinned to an exact version** in the workspace `Cargo.toml` (0.7.1 was current on 2026-10-07). All apps use the same pin. Target `wasm32-unknown-unknown`.
- **The pin covers the whole gpui family through `Cargo.lock`.** `=0.7.1` on `gpui-kit` alone lets its caret deps float (`gpui-component`, `gpui-base`, `gpui-pre-*`). `Cargo.lock` is committed and was seeded from gpui-kit 0.7.1's published lock. To bump, copy the new release's `Cargo.lock` from the registry source, then `cargo fetch`. Don't run a bare `cargo update`.
- **Toolchain:** dated nightly in `rust-toolchain.toml`, because `gpui-pre-web` pulls in `wasm_thread`, which needs `#![feature]`. `wasm-bindgen-cli` must match the locked `wasm-bindgen` exactly (`cargo install wasm-bindgen-cli --version <locked> --locked`). Also needed: `just`, `wasm-opt` (binaryen), Node.js.
- **Release profile:** Cargo reads `[profile.release]` only from the workspace root `Cargo.toml`, so its settings apply to every app. If an app needs different settings, use `[profile.release.package.<crate>]` and note why in that app's `PLAN.md`. Per-package overrides can't set `lto`, `panic`, or `rpath`; those stay workspace-wide.
- **JS host:** a thin Vite layer per app (`apps/<app>/web/`), built on `shared-web/`. Keep it thin: new logic goes in Rust unless it must touch a JS-only API.
- **Headers everywhere, dev included:** `Cross-Origin-Opener-Policy: same-origin` and `Cross-Origin-Embedder-Policy: require-corp`. `shared-web/` provides the dev-server config so every app gets them from day one, and cross-origin problems show up early instead of at deploy.
- **Hosting:** Cloudflare Workers (static assets + R2 where needed), one Worker per app in `apps/<app>/worker/`.

### Known GPUI Kit web gotchas (check before debugging)

- **The `gpui-kit` skills track upstream main, which runs ahead of the pin.** Updated 2026-10-07 to main (`1af2d1f`). These APIs it documents aren't in 0.7.1: `TooltipDefaults` and `Button::tooltip_show_delay` (only GPUI's raw elements have `tooltip_show_delay`), the test harness's `find_all` and `ClickOptions`, and `Diff`. Check the pinned crate source before using an API from the skill.

- **Load fonts before `gpui_kit::init`.** On wasm there are no system fonts. `Theme::change` resolves `.SystemUIFont` during init and panics on an empty font database, and because wasm uses `panic=abort`, the canvas never paints. Call `add_fonts(...)` (bundled UI font) first, then init. See longbridge/gpui-kit#3101 and #3105. `shared/`'s bootstrap handles this; apps shouldn't call init themselves.
- **Input paste on web (0.7.1, checked in Tycho M7 part C):** Cmd/Ctrl+V goes through the browser's paste event and needs no permission. The context menu (drawn by gpui-kit on the canvas: Cut, Copy, Paste, Select All) pastes through the async clipboard read (#3244), which needs `clipboard-read`: with it granted the paste lands, without it nothing is pasted and nothing is said (headless Chromium; the prompt a real browser shows is a manual check).
- **gpui-kit's Input binds its Mac shortcuts only under `cfg(target_os = "macos")`,** never true on wasm, so in a Mac browser Cmd+A/C/X/Z did nothing and Opt+Shift+← selected one character. `shared/`'s bootstrap binds them in Mac browsers only (`navigator.platform`; elsewhere Alt+←/→ is Back/Forward). Cmd+A/C/X go before `gpui_kit::init`, so the right-click menu keeps its Ctrl labels (the latest binding labels an action, and wasm spells Cmd "Win"); the rest go after, to outrank the wasm build's own. Cmd+V stays unbound, so it reaches the browser's permission-free paste event.
- **Don't use gpui-kit's `Input` (`gpui_kit::component::input::Input`) for a single-line field.** The element renders any of its single-line, textarea, and code-editor states, so all three engines link: +194 KiB brotli in 0.7.1. gpui-base's unstyled `gpui_kit::base::input::Input` renders only the single-line state (+88 KiB, the engine itself). Style it yourself, and attach the right-click menu with `InputState::on_context_menu` (gpui-kit's `NativeMenu::show`, +2 KiB). Tycho's `workbench.rs` does this (M7 part C).
- Install `console_error_panic_hook` in debug builds. A panic shows up as `RuntimeError: unreachable` unless the hook is installed.
- **`wasm-opt` needs `--enable-threads`.** `wasm_thread`'s atomics land in the binary even on the single-threaded platform, and wasm-opt refuses to validate without the flag.
- **Headless DPR emulation breaks GPUI's canvas sizing.** gpui-pre-web sizes the backing store from `ResizeObserver`'s device-pixel-content-box, which headless Chromium misreports under `deviceScaleFactor`. Real HiDPI browsers are fine. Measurements at DPR 2 hide `ResizeObserverEntry.prototype.devicePixelContentBoxSize` in an init script, which sends gpui-pre-web down its Safari path (`contentRect × devicePixelRatio`) and gives a true 2× backing store. Tycho's `perf/perf.ts` does this; reuse it.
- **Headless DPR emulation also halves scripted wheel deltas.** Under Playwright's `deviceScaleFactor: 2`, Chromium delivers `mouse.wheel(0, 1000)` to the page as `deltaY` 500. A scripted fling or scroll then covers half the distance it claims. Scale deltas by `devicePixelRatio`; Tycho's `perf/harness.ts` `wheel()` does this, so reuse it.
- **Since 0.7.0, `gpui_kit::open_window` wraps the content in `Root`, and `Root` hosts dialogs, sheets, and notifications.** Don't wrap in `Root` yourself or render overlay layers by hand (the 0.6 `Root::render_*_layer` APIs are gone). Anything a view draws sits under `Root`'s overlays, including the perf overlay. `shared/`'s `Bootstrap` opens the window.
- **GPUI doesn't deliver browser file drops.** gpui-pre-web (0.3.5 through 0.3.8) `preventDefault`s `dragover`/`drop` on its canvas (so the tab doesn't navigate to the file) and drops them: a browser gives `File` objects, not the paths `ExternalPaths` wants. Listen on `window` yourself and enter GPUI through its foreground executor; Tycho's `crate/src/files.rs` does this. A GPUI click handler runs inside the DOM's pointer event, so it can open a file dialog (`input.click()`).
- **The web platform maps `.SystemUIFont` to IBM Plex Sans.** That's the family `shared-web/fonts/` bundles, so no theme font override is needed.
- **`shared/` uses GPUI's `Auto` backend:** WebGPU when the browser has a usable adapter, WebGL2 otherwise. It beat forced WebGL2 on cold-start TTFP by 40% in Chromium and 28% in WebKit (Tycho M1). Check both paths when debugging rendering: headless Firefox falls back to WebGL2.
- **GPUI's first real draw isn't in a `requestAnimationFrame`.** The window starts at 0×0. The first draw with a real size happens in gpui-pre-web's `ResizeObserver` callback, which renders and presents synchronously. With WebGPU it can be GPUI's rAF instead. Don't time anything off rAF ordering. See `shared/src/first_frame.rs`.

## Repo layout

```
seiza/
  Cargo.toml            # workspace; pins gpui-kit; release profile
  Cargo.lock            # committed; pins the whole gpui family
  rust-toolchain.toml   # dated nightly + wasm32 target
  package.json          # npm workspaces: shared-web, apps/*/web
  tsconfig.base.json    # strict TS settings every host extends
  .gitignore            # target/, node_modules/, .wrangler/, pkg/, dist/, per-app data/raw, generated data, perf/results/raw
  shared/               # crate `seiza`: wasm bootstrap, app shell, theme, perf overlay, file helpers
  shared-web/           # reusable JS host bits: bootstrap.ts, vite.ts (COOP/COEP), fonts/, scripts/asset-sizes.ts
  apps/
    tycho/
      crate/            # Rust (cdylib)
      web/              # Vite host, bridge.ts, engine.ts (DuckDB-Wasm)
      worker/           # Cloudflare Worker + wrangler.toml
      data/  perf/  docs/
      CLAUDE.md         # Tycho context and rules
      PLAN.md           # Tycho milestones, datasets, hosting, decisions, measurements
  CLAUDE.md             # this file: repo-wide rules
  justfile              # `just tycho dev`, `just tycho perf`, …
```

## `shared/` and `shared-web/` conventions

- Code goes in `shared/` only if it has no knowledge of any app: no DuckDB, no app types, no app strings. Apps depend on `shared/`, never the reverse.
- The perf panel ("Observation panel", `shared/src/perf.rs` + `panel.rs` + `frames.rs`) lives in `shared/`. It owns the common metrics (the page-load waterfall up to first frame from the bootstrap's `seiza:wasm-*` marks, TTFP, frame intervals and per-frame work time, memory) and lets apps add load steps (`set_load_step`, one time axis per section), rows (`set_metric`), rows recomputed at each refresh (`on_refresh`), and how far it keeps from the window's right and bottom edges, to leave their controls reachable (`set_clearance`). It refreshes at ~4 Hz, not every frame, and is a cached GPUI view: frames it wasn't refreshed in replay its last drawing. It samples nothing while hidden. Its toggle is in the shell's title bar.
- `shared/` owns the web bootstrap order (panic hook → fonts → `gpui_kit::init` → first frame → `gpui:first-frame` mark → post-paint callback). Apps hook into the post-paint callback to start heavy loads. `shared-web`'s `boot` takes the app's `wasmUrl` for the waterfall's download step.
- The page clock and `performance.mark`s go through `seiza::marks` (`now`, `mark`, `mark_at`, `mark_time`, `mark_after_current_task`); no crate keeps its own copy. A mark may be set more than once (a retry); readers take the **last** entry.
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

- **Reference run:** Playwright with Chromium in headless=new mode, a cold cache, 1440×900 at DPR 2, **median of 10 runs**. Save the results with the date, the hardware (CPU model, OS), and a machine label. The repo is public, so never record hostnames, usernames, or home-directory paths; `perf.ts` uses the `SEIZA_MACHINE` label (default `local`).
- **Throttled run:** same setup with CPU 4× slowdown and "Fast 4G" network. Both runs are recorded, but budgets apply to the reference run.
- **First paint (TTFP):** from `performance.timeOrigin` to the first frame GPUI actually presents. `shared/` sets `performance.mark("gpui:first-frame")` in a microtask queued by the first render with a real viewport, so it lands right after the callback that draws and presents that frame. Tycho's `perf/perf.ts` checks this independently on every run: it hooks WebGL2 draw calls and WebGPU submits, and fails if the mark isn't right after a task that did GPU work. Don't use the browser's FP/FCP metrics, because the canvas makes them meaningless. If an app paints an HTML placeholder before the wasm arrives, TTFP still means GPUI's first frame; record the placeholder paint as its own metric.
- **Frame cost:** record per-frame work time (main-thread time spent in our frame: layout, drawing, GPUI present) next to rAF intervals. Intervals pin at the display's refresh period and can't show headroom.
- **Cross-browser check:** each milestone also gets a manual check in Firefox and Safari. Note any differences.

## Working agreements for Claude Code

- Work on one app milestone at a time. At the start, restate the "done when" checks. At the end, show the evidence for each check (numbers, trace excerpts, screenshots).
- Keep JS small and typed. Any logic that could live in Rust lives in Rust.
- Before starting an app's next milestone, add an entry to its `docs/LESSONS.md`: what surprised us, the numbers, and the decisions made.
- Update the app's `PLAN.md` as checks pass and decisions land.
