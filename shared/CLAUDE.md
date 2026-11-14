# The `seiza` crate (`shared/`)

The foundation every app builds on: the bootstrap, the window root, the perf panel, the page clock and marks. Claude Code loads this file when a file under `shared/` is read. The repo's rules and the map of its folders are in the root `CLAUDE.md`; they apply here. Paths are relative to the repo root.

## Conventions

- **The bootstrap's order is fixed** (panic hook → fonts → `gpui_kit::init` → first frame → `gpui:first-frame` mark → post-paint callback), and apps never call init themselves. Apps start heavy loads from the post-paint callback. `shared-web`'s `boot` takes the app's `wasmUrl` for the waterfall's download step.
- **The crate draws nothing of its own but the panel:** the root fills the canvas with the app's view. A title bar, a theme toggle, and other chrome are the app's (Tycho's `crate/src/shell.rs`). The root follows the system light/dark appearance until the app calls `seiza::stop_following_system_appearance` (a visitor picked a theme). An app's icons come in through `Bootstrap::assets` (`gpui_kit::assets::icon_assets!`). Why: `docs/DECISIONS.md`, "Shell and input".
- **Which missing characters the browser draws** (`CanvasFontFallback`) is emoji unless an app turns on the feature `canvas-font-fallback` and asks (`Bootstrap::canvas_font_fallback`; the observatory's admin table). Its code sits at `bootstrap.rs`'s end, so an app without it builds byte for byte as before.
- **The perf panel** ("Observation panel"; feature `panel`, on by default, with the `seiza::perf` API; a bare host turns it off with `default-features = false`) owns the common metrics: the page-load waterfall up to first frame from the bootstrap's `seiza:wasm-*` marks, TTFP, frame intervals and per-frame work time, memory. Apps add load steps (`set_load_step`, one time axis per section), rows (`set_metric`), rows recomputed at each refresh (`on_refresh`), and how far it keeps from the window's right and bottom edges to leave their controls reachable (`set_clearance`). It refreshes at ~4 Hz, not every frame, as a cached GPUI view (frames it wasn't refreshed in replay its last drawing), and samples nothing while hidden. Cmd/Ctrl+Shift+P toggles it; an app that wants a button draws its own (`seiza::perf::toggle`; Tycho's is in its title bar).
- `shared-web`'s placeholder CSS copies gpui-kit's components (its TitleBar and buttons among them) for any app's placeholder markup to use; the markup is the app's.

## Files

```
shared/src/
  lib.rs           # the crate's surface
  bootstrap.rs     # the web bootstrap and its order; canvas-font-fallback at its end
  shell.rs         # the window's root: arms the first-frame mark, follows the system appearance, draws the panel above the view
  first_frame.rs   # the `gpui:first-frame` mark
  marks.rs         # the page clock and performance marks (root CLAUDE.md, "Marks")
  perf.rs          # the panel's API and its rows
  panel.rs         # the panel's view
  frames.rs        # the panel's live sample: frame intervals, per-frame work, memory
  targets.rs       # named controls' bounds on the canvas, for Playwright (`seiza::targets::publish`)
  url.rs           # the page URL's query parameters (`?perf`, and whatever an app reads)
```
