# The `seiza` crate (`shared/`)

The foundation every app builds on: the bootstrap, the window root, the perf panel, the page clock and marks. Claude Code loads this file when a file under `shared/` is read. The repo's rules and the map of its folders are in the root `CLAUDE.md`; they apply here. Paths are relative to the repo root.

## Conventions

- The perf panel ("Observation panel", `shared/src/perf.rs` + `panel.rs` + `frames.rs`) lives in `shared/`. It owns the common metrics (the page-load waterfall up to first frame from the bootstrap's `seiza:wasm-*` marks, TTFP, frame intervals and per-frame work time, memory) and lets apps add load steps (`set_load_step`, one time axis per section), rows (`set_metric`), rows recomputed at each refresh (`on_refresh`), and how far it keeps from the window's right and bottom edges, to leave their controls reachable (`set_clearance`). It refreshes at ~4 Hz, not every frame, and is a cached GPUI view: frames it wasn't refreshed in replay its last drawing. It samples nothing while hidden. Cmd/Ctrl+Shift+P toggles it; an app that wants a button draws its own (`seiza::perf::toggle`; Tycho's is in its title bar).
- The `seiza` crate draws nothing of its own but the panel: the bootstrap opens the window with a root that fills the canvas with the app's view. A title bar, a theme toggle, and other chrome are the app's (Tycho's `crate/src/shell.rs`). The root follows the system light/dark appearance until the app calls `seiza::stop_following_system_appearance` (a visitor picked a theme). An app's icons come in through `Bootstrap::assets` (`gpui_kit::assets::icon_assets!`). Which missing characters the browser draws (`CanvasFontFallback`) is emoji unless an app turns on the feature `canvas-font-fallback` and asks (`Bootstrap::canvas_font_fallback`; the observatory's admin table): its code sits at `bootstrap.rs`'s end, so an app without it builds byte for byte as before (`docs/DECISIONS.md`, "Shell and input"). Feature `panel` (on by default) is the perf panel and the `seiza::perf` API; a bare host turns it off with `default-features = false`. `shared-web`'s placeholder CSS still copies gpui-kit's components (its TitleBar and buttons among them) for any app's placeholder markup to use; the markup is the app's. Why: `docs/DECISIONS.md`, "Shell and input".
- `shared/` owns the web bootstrap order (panic hook → fonts → `gpui_kit::init` → first frame → `gpui:first-frame` mark → post-paint callback). Apps hook into the post-paint callback to start heavy loads. `shared-web`'s `boot` takes the app's `wasmUrl` for the waterfall's download step.

## Files

```
shared/               # crate `seiza`: wasm bootstrap, the window root (first-frame mark, system theme), perf panel (`panel`), page clock and marks, script targets
```
