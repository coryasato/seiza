# seiza (星座)

**seiza** (星座, "constellation") is a monorepo of heavy web apps built with GPUI (via GPUI Kit) compiled to WebAssembly and drawn on a canvas with WebGPU (WebGL2 where WebGPU isn't available). The apps share one Cargo workspace, one `gpui-kit` pin, and a common foundation crate (`shared/`). There are four kinds of thing here ("Tiers" below): utility apps people use, the observatory that compares their components with React, and the components and engines they're built from.

The goal of every app here is to show that **WebAssembly + GPU-rendered UI builds heavy web apps better than the DOM**. Every claim needs a number on screen to back it up.

This file holds the rules for every app. Each app has its own `apps/<app>/CLAUDE.md` (app context and rules) and `apps/<app>/PLAN.md` (what's next); both apply when working inside an app. Where every other kind of fact lives is under "Docs: one home per fact" below.

**Apps**
- `apps/tycho/`: Tycho, a local-first data workbench (DuckDB-Wasm + virtualized table). A utility app, at tycho.seiza.io.
- `apps/observatory/`: the Observatory, the comparison site (seiza.io/observatory). Planned: only its `PLAN.md` and `README.md` exist.

---

## Repo-wide rules

1. **Time to first paint is the deciding metric.** Nothing may delay first paint: not engines, not data, not fonts beyond the one UI face. If a change adds bytes to an app's wasm, record its size effect in that app's `perf/results/` notes, not the commit message. A change to `shared/`, a component, or an engine affects every app that builds it, so record the effect for each one. Each app's `just <app> check` enforces its TTFP and wasm-size budgets and fails the build on a regression. Budgets live in that app's `perf/budgets.json` (every budget) and `perf/baseline.json` (the TTFP and wasm baselines `check` compares against).
2. **Paint first, load heavy things after.** Engines, workers, and datasets start loading after the first frame appears. The UI stays usable and says what's still loading.
3. **Measure before and after.** Every milestone ends with a measurement using the protocol below. The numbers go in `apps/<app>/perf/results/` (committed; large raw Playwright traces go in `perf/results/raw/`, which is gitignored) and a short note goes in `apps/<app>/docs/LESSONS.md`.
4. **Handle the canvas tradeoffs in the open** (a11y, IME, text selection, Ctrl+F, bundle size). When an app falls short on one, it says so in the UI or in its own `README.md` ("Canvas tradeoffs"). It never hides the gap.

## Tiers

The decisions behind these are in `docs/DECISIONS.md`, "Repo structure".

- **Components** (`components/<name>/`): generic UI libraries in the style of GPUI Kit's components: a view, a state entity, and a delegate trait for the data. Plain names (`table`). A minimal base; every further capability (sorting, filtering, …) is a Cargo feature, off by default. A component knows no app and doesn't depend on `seiza`, so it stays publishable: it reports through events, and the host turns them into panel rows and marks.
- **Engines** (`engines/<name>/`, with `crate/` and/or `web/`): non-UI data layers that GPUI and React consumers share. An adapter between an engine and a component lives in the engine, behind an optional feature named for the component.
- **Utility apps** (`apps/<star>/`): tools people use, star-named, each on its own subdomain. They turn on component features as they need them, and usually get a feature first.
- **The observatory** (`apps/observatory/`): compares each component's base level, in a minimal GPUI host, with a 1:1 React equivalent, under the comparison protocol below.
- **Dependencies run one way:** `shared/` ← components, engines ← apps. Code starts in an app and moves out once a second consumer needs it: foundation to `shared/`, UI to a component, a data layer to an engine. The first engine is `engines/duckdb/` and the first component `components/table/`, both from Tycho.
- **Build each wasm on its own** (`cargo build -p <crate>`). Cargo unifies features across the packages in one build, so a workspace-wide build would compile one app's features into another's. Clippy and tests may run workspace-wide.

## Stack and pins

- **UI:** `gpui-kit` (longbridge/gpui-kit), **pinned to an exact version** in the workspace `Cargo.toml` (0.7.3 was current on 2026-10-12). All apps use the same pin. Target `wasm32-unknown-unknown`.
- **The pin covers the whole gpui family through `Cargo.lock`.** `=0.7.3` on `gpui-kit` alone lets its caret deps float (`gpui-component`, `gpui-base`, `gpui-pre-*`). `Cargo.lock` is committed and was seeded from gpui-kit 0.7.3's published lock. To bump, copy the new release's `Cargo.lock` from the registry source, then `cargo fetch`. Don't run a bare `cargo update`.
- **Toolchain:** dated nightly in `rust-toolchain.toml`, because `gpui-pre-web` pulls in `wasm_thread`, which needs `#![feature]`. `wasm-bindgen-cli` must match the locked `wasm-bindgen` exactly (`cargo install wasm-bindgen-cli --version <locked> --locked`). Also needed: `just`, `wasm-opt` (binaryen), Node.js.
- **Release profile:** Cargo reads `[profile.release]` only from the workspace root `Cargo.toml`, so its settings apply to every app. If an app needs different settings, use `[profile.release.package.<crate>]` and note why in that app's `docs/DECISIONS.md`. Per-package overrides can't set `lto`, `panic`, or `rpath`; those stay workspace-wide.
- **JS host:** a thin Vite layer per app (`apps/<app>/web/`), built on `shared-web/`. Keep it thin: new logic goes in Rust unless it must touch a JS-only API.
- **Headers everywhere, dev included:** `Cross-Origin-Opener-Policy: same-origin` and `Cross-Origin-Embedder-Policy: require-corp`. `shared-web/` provides the dev-server config so every app gets them from day one, and cross-origin problems show up early instead of at deploy.
- **Hosting:** Cloudflare Workers (static assets + R2 where needed), one Worker per app in `apps/<app>/worker/`. Each utility app has its own subdomain of seiza.io (a custom domain); the observatory lives at `seiza.io/observatory`, and the root is kept for a static landing page. The apex origin is shared, so nothing registers a service worker scoped to `/` (scope each to its own path). Every Worker that serves data sits behind the zone's WAF rules (one rate-limiting rule, the free plan's only one, and one path allowlist) and honours the same pause switch; it widens those rules rather than adding its own. Decisions: `docs/DECISIONS.md`, "Hosting".

### Known GPUI Kit web gotchas (check before debugging)

- **The `gpui-kit` skills track upstream main, which runs ahead of the pin.** Updated 2026-10-07 to main (`1af2d1f`). These APIs it documents aren't in 0.7.3: the test harness's `find_all` and `ClickOptions`. Check the pinned crate source before using an API from the skill.

- **Load fonts before `gpui_kit::init`.** On wasm there are no system fonts. `Theme::change` resolves `.SystemUIFont` during init and panics on an empty font database, and because wasm uses `panic=abort`, the canvas never paints. Call `add_fonts(...)` (bundled UI font) first, then init. See longbridge/gpui-kit#3101 and #3105. `shared/`'s bootstrap handles this; apps shouldn't call init themselves.
- **Input paste on web (0.7.3, checked in Tycho):** Cmd/Ctrl+V goes through the browser's paste event and needs no permission. The context menu (drawn by gpui-kit on the canvas: Cut, Copy, Paste, Select All) pastes through the async clipboard read (#3244), which needs `clipboard-read`: with it granted the paste lands, without it nothing is pasted and nothing is said (headless Chromium; the prompt a real browser shows is a manual check).
- **gpui-kit's Input binds its Mac shortcuts only under `cfg(target_os = "macos")`,** never true on wasm, so in a Mac browser Cmd+A/C/X/Z did nothing and Opt+Shift+← selected one character. `shared/`'s bootstrap binds them in Mac browsers only (`navigator.platform`; elsewhere Alt+←/→ is Back/Forward). Cmd+A/C/X go before `gpui_kit::init`, so the right-click menu keeps its Ctrl labels (the latest binding labels an action, and wasm spells Cmd "Win"); the rest go after, to outrank the wasm build's own. Cmd+V stays unbound, so it reaches the browser's permission-free paste event.
- **Don't use gpui-kit's `Input` (`gpui_kit::component::input::Input`) for a single-line field.** The element renders any of its single-line, textarea, and code-editor states, so all three engines link: +194 KiB brotli, measured in 0.7.1. gpui-base's unstyled `gpui_kit::base::input::Input` renders only the single-line state (+88 KiB, the engine itself). Style it yourself, and attach the right-click menu with `InputState::on_context_menu` (gpui-kit's `NativeMenu::show`, +2 KiB). Tycho's `workbench.rs` does this.
- Install `console_error_panic_hook` in debug builds. A panic shows up as `RuntimeError: unreachable` unless the hook is installed.
- **`wasm-opt` needs `--enable-threads`.** `wasm_thread`'s atomics land in the binary even on the single-threaded platform, and wasm-opt refuses to validate without the flag.
- **Headless DPR emulation breaks GPUI's canvas sizing.** gpui-pre-web sizes the backing store from `ResizeObserver`'s device-pixel-content-box, which headless Chromium misreports under `deviceScaleFactor`. Real HiDPI browsers are fine. Measurements at DPR 2 hide `ResizeObserverEntry.prototype.devicePixelContentBoxSize` in an init script, which sends gpui-pre-web down its Safari path (`contentRect × devicePixelRatio`) and gives a true 2× backing store. `shared-web/perf/`'s `open` does this (`hideDevicePixelContentBox`); reuse it.
- **Headless DPR emulation also halves scripted wheel deltas.** Under Playwright's `deviceScaleFactor: 2`, Chromium delivers `mouse.wheel(0, 1000)` to the page as `deltaY` 500. A scripted fling or scroll then covers half the distance it claims. Scale deltas by `devicePixelRatio`; `shared-web/perf/`'s `wheel()` does this, so reuse it.
- **Since 0.7.0, `gpui_kit::open_window` wraps the content in `Root`, and `Root` hosts dialogs, sheets, and notifications.** Don't wrap in `Root` yourself or render overlay layers by hand (the 0.6 `Root::render_*_layer` APIs are gone). Anything a view draws sits under `Root`'s overlays, including the perf overlay. `shared/`'s `Bootstrap` opens the window.
- **GPUI doesn't deliver browser file drops.** gpui-pre-web (0.3.5 through 0.3.9) `preventDefault`s `dragover`/`drop` on its canvas (so the tab doesn't navigate to the file) and drops them: a browser gives `File` objects, not the paths `ExternalPaths` wants. Listen on `window` yourself and enter GPUI through its foreground executor; Tycho's `crate/src/files.rs` does this. A GPUI click handler runs inside the DOM's pointer event, so it can open a file dialog (`input.click()`).
- **The web platform maps `.SystemUIFont` to IBM Plex Sans.** That's the family `shared-web/fonts/` bundles, so no theme font override is needed.
- **`shared/` uses GPUI's `Auto` backend:** WebGPU when the browser has a usable adapter, WebGL2 otherwise. It beat forced WebGL2 on cold-start TTFP by 40% in Chromium and 28% in WebKit (Tycho). Check both paths when debugging rendering: headless Firefox falls back to WebGL2.
- **GPUI lays out in whole device pixels and draws its own glyphs.** Line heights are rounded to device pixels and positions of exactly x.5 round down (the browser rounds up); its text is measured with its own advances (a 14 px label ran ~1 px narrower than Chrome's) and rasterized by gpui-pre-web, crisper and up to ~2 px lower at DPR 1. An HTML copy of a GPUI view can match its boxes exactly but not its text. `shared-web/src/placeholder.ts` copies the rounding; read it before building another HTML twin of a GPUI screen.
- **The static placeholder shell (`shared-web/src/placeholder.ts`) is opt-in per app** (`seizaViteConfig`'s `placeholder`). `shared/` releases it in the microtask that sets `gpui:first-frame`; it fades out over that frame. It must stay inert, in the placeholder font's characters (printable ASCII and "…"; the build fails otherwise), and match the app's first frame; each app's check compares them.
- **GPUI's first real draw isn't in a `requestAnimationFrame`.** The window starts at 0×0. The first draw with a real size happens in gpui-pre-web's `ResizeObserver` callback, which renders and presents synchronously. With WebGPU it can be GPUI's rAF instead. Don't time anything off rAF ordering. See `shared/src/first_frame.rs`.

### Known Cloudflare gotchas (found deploying Tycho)

- **Cloudflare's own compression is weak.** It compresses on the fly at a low level and prefers zstd when the browser offers it: Tycho's app wasm went out as 3.7 MiB (3.6 as br) against 2.8 MiB at brotli quality 11, the size the budgets measure, ~1 s more before first paint on Fast 4G. Workers static assets can't serve precompressed files, so Tycho's Worker runs first (`run_worker_first`) for the page and build files and returns a quality-11 `.br` (written at deploy) with `Content-Encoding: br` and `encodeBody: 'manual'`; browsers without br fall through to Cloudflare's compression.
- **Cloudflare Web Analytics injects a script into HTML** (`static.cloudflareinsights.com/beacon.min.js`, then `/cdn-cgi/rum`), before first paint, when the zone has it on. Serving the page with `Cache-Control: no-transform` stops it. Tycho's check fails if the page holds an injected script.
- **Never commit or print the account's default Workers hostname:** it names the account's owner. Apps run on a custom domain with `workers_dev = false` and `preview_urls = false`.
- **A ranged or encoded response loses `Content-Length` on HEAD** through Cloudflare's edge; count wire bytes from a raw GET (Tycho's `worker/scripts/check.ts`, `wireBytes`).
- **A new version takes seconds to reach the edge.** Checks right after `wrangler deploy` read the old version; retry before failing.
- **Static assets: 25 MiB per file.** Bigger files (DuckDB-Wasm's bundles) go in R2 and are served by the Worker; `.assetsignore` keeps them out of the upload.

## Repo layout

```
seiza/
  Cargo.toml            # workspace; pins gpui-kit; release profile
  Cargo.lock            # committed; pins the whole gpui family
  rust-toolchain.toml   # dated nightly + wasm32 target
  package.json          # npm workspaces: shared-web, apps/*/web
  tsconfig.base.json    # strict TS settings every host extends
  .gitignore            # target/, node_modules/, .wrangler/, pkg/, dist/, per-app data/raw, generated data, perf/results/raw
  shared/               # crate `seiza`: wasm bootstrap, app shell (title bar, theme toggle), perf overlay, file helpers
  shared-web/           # reusable JS host bits: bootstrap.ts, vite.ts (COOP/COEP), placeholder.ts (static shell before the wasm), fonts/ (UI face + placeholder subset), scripts/asset-sizes.ts, perf/ (the perf harness every app's scripts share)
  components/
    table/              # `seiza-table`: the paged f64-row table (state entity, element, delegate); README.md, CLAUDE.md, docs/
  engines/
    duckdb/             # DuckDB-Wasm: crate/ (`seiza-duckdb`: engine client, Arrow reader, SQL helpers; `table` feature: the table's DuckDB source), web/ (`@seiza/duckdb`: bridge, worker, Vite plugin, pinned extensions); README.md, CLAUDE.md, docs/
  apps/
    observatory/        # the comparison site (planned): PLAN.md and README.md so far
    tycho/
      crate/            # Rust (cdylib)
      web/              # Vite host on @seiza/duckdb: main.ts, vite.config.ts
      worker/           # Cloudflare Worker + wrangler.toml
      data/  perf/  docs/
      README.md         # the app for visitors: numbers, canvas tradeoffs, limits, how to run it
      CLAUDE.md         # Tycho context and rules
      PLAN.md           # what's next: status, the active milestone, long-term goals, open questions
  docs/
    DECISIONS.md        # repo-wide decisions, by area
    templates/app/      # the docs skeleton a new app starts from
    templates/component/ # the docs skeleton a new component or engine starts from
  CLAUDE.md             # this file: repo-wide rules
  justfile              # `just tycho dev`, `just tycho perf`, …
```

## `shared/` and `shared-web/` conventions

- Code goes in `shared/` only if it has no knowledge of any app: no DuckDB, no app types, no app strings. Apps depend on `shared/`, never the reverse.
- The perf panel ("Observation panel", `shared/src/perf.rs` + `panel.rs` + `frames.rs`) lives in `shared/`. It owns the common metrics (the page-load waterfall up to first frame from the bootstrap's `seiza:wasm-*` marks, TTFP, frame intervals and per-frame work time, memory) and lets apps add load steps (`set_load_step`, one time axis per section), rows (`set_metric`), rows recomputed at each refresh (`on_refresh`), and how far it keeps from the window's right and bottom edges, to leave their controls reachable (`set_clearance`). It refreshes at ~4 Hz, not every frame, and is a cached GPUI view: frames it wasn't refreshed in replay its last drawing. It samples nothing while hidden. Its toggle is in the shell's title bar.
- `shared/` owns the web bootstrap order (panic hook → fonts → `gpui_kit::init` → first frame → `gpui:first-frame` mark → post-paint callback). Apps hook into the post-paint callback to start heavy loads. `shared-web`'s `boot` takes the app's `wasmUrl` for the waterfall's download step.
- The page clock and `performance.mark`s go through `seiza::marks` (`now`, `mark`, `mark_at`, `mark_time`, `mark_after_current_task`); no crate that can depend on `seiza` keeps its own copy. A component or engine can't, so it reads the clock and its own JS side's marks itself and never sets a mark from Rust: the host marks from its events (`docs/DECISIONS.md`, "Repo structure"). A mark may be set more than once (a retry); readers take the **last** entry.
- `shared-web/perf/` is the perf harness's app-agnostic half: `protocol.ts` (throttle profiles, the DPR shim, `budgetLimits` over an app's `budgets.json`, run summaries, machine labels), `harness.ts` (opening a page per the protocol, the perf panel's rows, target clicks, `wheel`, `waitMark`, the frame and work recorders, `presentingTaskRecorder` and `presentedMark` for marks set right after a presented frame, `fling`), and `serve.ts` (`serveApp`, the counting proxy). An app's `perf/` keeps only what knows the app, and never redefines a helper from here. Canvas controls are clicked through the bounds the app publishes to `globalThis.__seizaTargets[id] = [x, y, width, height]` (CSS pixels); `frameRecorder` records whatever an app's `globalThis.__seizaFrameSample()` returns with each rAF.
- When a GPUI Kit web bug blocks progress, check upstream issues first. Work around it in `shared/` with a comment linking the issue. Don't fork unless there's no other way.
- Code starts in the app. Move it to `shared/` once it's clearly app-agnostic foundation; UI and data layers become a component or an engine instead ("Tiers"). Don't build abstractions for apps that don't exist yet.

## Commands

Each app has its own justfile, loaded as a `just` module from the root:

```
just <app> <recipe>   # e.g. just tycho dev, just tycho perf
```

Each app's recipes are listed in its CLAUDE.md. Every app has `just <app> report`, which regenerates the numbers in its README, its PLAN.md, and the root README's apps table from `perf/budgets.json` and `perf/results/`.

## Measurement protocol

Every "done when" check that includes a number, in every app, uses this protocol.

- **Reference run:** Playwright with Chromium in headless=new mode, a cold cache, 1440×900 at DPR 2, **median of 10 runs**. Save the results with the date, the hardware (CPU model, OS), and a machine label. The repo is public, so never record hostnames, usernames, or home-directory paths; `perf.ts` uses the `SEIZA_MACHINE` label (default `local`).
- **Throttled run:** same setup with CPU 4× slowdown and "Fast 4G" network. Both runs are recorded, but budgets apply to the reference run.
- **First paint (TTFP):** from `performance.timeOrigin` to the first frame GPUI actually presents. `shared/` sets `performance.mark("gpui:first-frame")` in a microtask queued by the first render with a real viewport, so it lands right after the callback that draws and presents that frame. Tycho's `perf/perf.ts` checks this independently on every run: it hooks WebGL2 draw calls and WebGPU submits, and fails if the mark isn't right after a task that did GPU work. Don't use the browser's FP/FCP metrics, because the canvas makes them meaningless. If an app paints an HTML placeholder before the wasm arrives, TTFP still means GPUI's first frame; record the placeholder paint as its own metric.
- **Frame cost:** record per-frame work time (main-thread time spent in our frame: layout, drawing, GPUI present) next to rAF intervals. Intervals pin at the display's refresh period and can't show headroom.
- **Cross-browser check:** each milestone also gets a manual check in Firefox and Safari. Note any differences.
- **Budgets apply to the local release build only** (decided deploying Tycho). Runs against production (`--url`) record their numbers next to the local ones and never fail on a budget: the network, the CDN, and the edge cache upstream vary too much. Optimizing production is a goal for its own session, not a gate on a milestone.

## Comparison protocol

How the observatory compares a component with React. It adds to the measurement protocol; the reasons are in `docs/DECISIONS.md`, "Comparison protocol".

- **Base level against a 1:1 React equivalent.** The GPUI side is the component in a minimal host, never a utility app. A feature level (base + sorting, …) is a GPUI build and a React build with identical features, and neither bundle carries code for a feature it doesn't have. The GPUI contender builds `seiza` without its title bar and observation panel.
- **Only the UI differs.** Same engine, same SQL. The component's paging numbers are the controlled variable, the same on both sides; everything else is idiomatic to each stack. Each side decodes results in its own language, and that counts as UI cost. A shared scenario fixture (scroll and jump steps → the page requests they should make) runs against both sides' caches, which must request the same pages in the same order.
- **Placeholders on both sides, each idiomatic:** the GPUI side's HTML placeholder shell, React's prerendered first screen.
- **Three metrics, defined by meaning:** first pixels, first usable UI, first rows painted. The GPUI side's marks are checked against its GPU calls, as TTFP's is; the DOM side's with Element Timing on the first real cell plus a presented-frame check.
- **Contender pages are bare** (no site chrome) and publish the same marks, targets, and replay hooks (load, fling, jump to 90%). The observatory runs one contender at a time (two in one tab share a main thread and a GPU) and draws the results itself. Playwright's runs are cold; a replay in a visitor's browser is labelled warm.
- **Show where React wins.** First pixels and bundle size are likely React's, and the page says so.

## Docs: one home per fact

Each kind of fact has one home. Everywhere else links to it rather than repeating it: a number or a reason copied into a second file goes stale there.

| Kind of fact | Home | Rules |
|---|---|---|
| The app for a visitor | `apps/<app>/README.md` | Current state only. Numbers between `<!-- report:… -->` markers are generated; don't type them. Canvas tradeoffs and limits live here (rule 4). |
| A component or engine for its user | `components/<name>/README.md`, `engines/<name>/README.md` | Current state only: API, features, limits, canvas tradeoffs. Its rules and gotchas are in its `CLAUDE.md`, its decisions in its `docs/DECISIONS.md`. It has no `PLAN.md`, `LESSONS.md`, or `perf/`: its work is a milestone in the app that drives it, measured there. |
| Rules, architecture, gotchas, commands | `CLAUDE.md` (root and app) | Current state, no history. Say what to do and point to the decision behind it; don't retell the measurement. |
| What's next | `apps/<app>/PLAN.md` | Status table, the active milestone's "done when" checks, long-term goals, open questions. Nothing finished. |
| Why it's built this way | `docs/DECISIONS.md` (repo-wide) and `apps/<app>/docs/DECISIONS.md` | One bullet per decision under its area, oldest first: what, the numbers, *[source]*. Replaced decisions are marked *Superseded*, never deleted. A decision binding every app (toolchain, `shared/`, `shared-web/`, protocol) goes in the root file. |
| What surprised us | `apps/<app>/docs/LESSONS.md` | One entry per milestone: surprises only, plus a link to its results note. The numbers and the decisions have their own homes. |
| Finished milestones | `apps/<app>/docs/milestones.md` | A milestone's spec, checks, and evidence move here when it closes. History: never edited. |
| Reference (data, hosting, …) | `apps/<app>/docs/<topic>.md` | How it works now. Research for a long-term goal goes in `docs/research/<goal>.md`. |
| Budgets | `apps/<app>/perf/budgets.json` | Every budget and recorded metric: its limit, whether `check` or the suite gates it, and which results file holds its current value. |
| Measurements | `apps/<app>/perf/results/` | Dated and append-only: a JSON per run (scripts write it), a note per milestone or experiment (`docs/templates/app/perf/results-note.md`). A metric's history is these files; no doc keeps a running "latest" list. |

Milestone IDs (`M<n>`, `part <X>`) belong only in `PLAN.md`, `milestones.md`, `LESSONS.md`, the *[source]* tags of `DECISIONS.md`, `perf/results/`, and commit messages. Code, `CLAUDE.md`, READMEs, and justfiles describe the current state without them: name the thing ("the fling budget"), not the milestone that built it. `shared-web/scripts/check-terms.ts`, run by `just <app> lint`, enforces it.

A new app starts from `docs/templates/app/`; a new component or engine, from `docs/templates/component/`. A directory is documented in the change that creates it, not before.

## Working agreements for Claude Code

- Work on one app milestone at a time. Work on a component or engine is a milestone of the app that drives it. At the start, restate the "done when" checks. At the end, show the evidence for each check (numbers, trace excerpts, screenshots).
- Keep JS small and typed. Any logic that could live in Rust lives in Rust.
- Before starting an app's next milestone, close the last one: its results note in `perf/results/`, new decisions in `docs/DECISIONS.md`, a `docs/LESSONS.md` entry (surprises), `just <app> report`, and its spec and evidence moved from `PLAN.md` to `docs/milestones.md`.
- Tick `PLAN.md`'s checks as they pass, with their evidence; log each decision in `docs/DECISIONS.md` as it lands.
