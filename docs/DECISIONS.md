# Decisions: repo-wide

Decisions that bind every app: the toolchain and pins, `shared/`, `shared-web/`, and the measurement protocol. An app's own decisions are in `apps/<app>/docs/DECISIONS.md`.

One bullet per decision, under its area, oldest first: what was chosen, the numbers that chose it, and *[where they came from]*. A decision that replaces another marks the old one *Superseded* rather than deleting it. Every entry so far came out of Tycho, so sources name Tycho's milestones; its results are in `apps/tycho/perf/results/`.

## Toolchain and build

- **2026-09-23** · Rust toolchain: dated nightly (`nightly-2026-09-20`), because `gpui-pre-web`'s default `multithreaded` feature pulls in `wasm_thread` (`#![feature]`). *[M0 build failure on stable]*
- **2026-09-23** · `Cargo.lock` seeded from gpui-kit 0.6.4's published lock, so the whole gpui family is what 0.6.4 shipped with (gpui-pre 0.3.5, wasm-bindgen 0.2.121). *Superseded 2026-10-07: re-seeded from 0.7.1's lock, then 0.7.3's (below).* *[caret deps floated to 0.6.6 / 0.3.6]*
- **2026-09-23** · `opt-level = "z"`: "s" is 8.6% bigger (2842 vs 2618 KiB br) and slower (291.5 vs 284.6 ms ref, 3963 vs 3741 ms throttled). *[M1 `m1-opt-*`]*
- **2026-09-23** · Release logging stays on: 0.8 KiB br, no measurable TTFP, and it reports backend fallbacks and graphics failures. *[M1 `m1-no-release-logging`]*
- **2026-10-07** · gpui-kit 0.6.4 → **0.7.1**, `Cargo.lock` re-seeded from its published lock (gpui-pre 0.3.8, wasm-bindgen still 0.2.121). `shared/` uses `gpui_kit::open_window`; 0.7's `Root` hosts the overlay layers. +31.2 KiB brotli, TTFP unchanged (interleaved A/B). *Superseded 2026-10-12: 0.7.3 (below).* *[`apps/tycho/perf/results/2026-10-07-gpui-kit-0.7.1.md`]*
- **2026-10-12** · gpui-kit 0.7.1 → **0.7.3** (0.7.2 was yanked), `Cargo.lock` re-seeded from its published lock (gpui-pre 0.3.9, wasm-bindgen still 0.2.121). No code changes. +12.9 KiB brotli, TTFP unchanged (interleaved A/B: 194.0 vs 195.3 ms reference). *[`apps/tycho/perf/results/2026-10-12-gpui-kit-0.7.3.md`]*

## Rendering and first paint

- **2026-09-23** · Web platform: single-threaded, WebGL2 forced (not the WebGPU-first `Auto`), `CanvasFontFallback::Emoji`. *Superseded the same day by `Auto` (next entry).* *[M0; M1 measures `Auto` vs `WebGl`]*
- **2026-09-23** · UI font: IBM Plex Sans Regular (what `gpui-pre-web` maps `.SystemUIFont` to), fetched by the JS host in parallel with the wasm, not `include_bytes!`. *[M0]*
- **2026-09-23** · Graphics backend: GPUI `Auto` (WebGPU, WebGL2 fallback), replacing forced WebGL2. Chromium 173.5 vs 291.0 ms ref (−40%), 3460 vs 3765 ms throttled; WebKit 296 vs 412 ms; Firefox falls back at no cost. *[M1 `m1-backend-*`]*
- **2026-09-23** · Preload the wasm and UI font from the HTML (`as=fetch crossorigin`): −10 ms ref, −188 ms throttled. *[M1 `m1-no-preload`]*
- **2026-09-23** · UI font stays the full face: a Latin subset saves 42 KiB br and 21 ms throttled (0.6%) but drops Greek and Cyrillic, which dropped files may contain. *[M1 `m1-font-subset`]*
- **2026-09-23** · First-frame mark: a microtask queued by the first render with a non-zero viewport (was: a rAF requested from the first render, a frame late on WebGPU). Verified every run by a GPU-call probe. *[M1]*
- **2026-09-23** · `AppShell` renders gpui-kit 0.6.4's overlay layers (`Root::render_*_layer`): without it, dialogs and notifications update state but never draw. +26.4 KiB brotli. *Superseded 2026-10-07: 0.7's `gpui_kit::open_window` wraps the content in `Root`, which hosts them.* *[Tycho M0]*

## Shell and input (`shared/`)

- **2026-09-23** · The theme follows live light/dark changes (`observe_window_appearance` → `Theme::sync_system_appearance`); gpui-pre-web fires the observer on `prefers-color-scheme`. Since 2026-10-09 a press of the theme button stops following until a reload (above). *[Tycho M0]*
- **2026-10-08** · `shared/` binds gpui-base's macOS input shortcuts in Mac browsers (`navigator.platform`), where its `cfg(target_os = "macos")` never holds on wasm: Cmd+A/C/X/Z, Cmd+arrows with and without Shift, Opt+arrows with and without Shift, Cmd/Opt+Backspace and Delete. Not elsewhere: Alt+←/→ is Back/Forward. Not Cmd+V: unbound, it reaches the browser's permission-free paste event. Cmd+A/C/X are bound before `gpui_kit::init`, so the menu keeps labelling the Ctrl keys (the latest binding labels an action; wasm spells Cmd "Win"); the rest after, to outrank the wasm build's Shift+Alt+←/→. *[M7 part C, code review]*
- **2026-10-09** · **Theme toggle: a Sun/Moon icon button in `shared/`'s title bar, and Cmd/Ctrl+Shift+L.** The icon shows the theme a press switches to. The icons are embedded with gpui-kit-assets' `icon_assets!(Icons, [Sun, Moon])` (in the 0.7.1 pin), not the default `Assets`, which fetches each icon from a CDN on first use on the web: +11.6 KiB brotli against a text label (accepted). A press stops following the system until a reload (`ThemeChoice`, in memory). Keyboard: the shortcut only; gpui-kit 0.7.1 binds nothing to Tab, and binding focus-next app-wide would change the table and jump input. *[M7 part G, review]*
- **2026-10-09** · Buttons take the web's pointer cursor (`cursor_pointer`), only while they can be pressed; gpui-kit gives buttons the desktop arrow. *[M7 part G, review]*

## Observation panel and marks (`shared/`)

- **2026-09-24** · "Sample → schema" is timed to the presented frame: `shared/`'s after-present mark is now public (`seiza::mark_after_current_task(name)`). *[M3]*
- **2026-09-25** · The overlay's common rows (`shared/`): "Frame time (2 s)" (p50/p95/max of rAF intervals) and "Memory" (app wasm, JS heap), sampled only while the overlay is visible, starting after first paint. *[M4]*
- **2026-10-07** · The perf panel is a cached GPUI view refreshed at 4 Hz: fling frames replay its drawing. Work per frame is timed from the shell's render to a microtask queued there, which runs after GPUI's draw-and-present callback; the sparkline is drawn with quads, not paths (paths would link lyon into every app). *[M7 part A]*
- **2026-10-08** · The open panel publishes its bounds (`__seizaPerfOverlayRect`) so scripts can check a target is clear of it. *[M7 part C]*
- **2026-10-08** · The observation panel keeps clear of edge controls an app names (`seiza::perf::set_clearance`; Tycho: its padding, border, scrollbar, and a gap) rather than moving or docking. *[M7 part D]*
- **2026-10-08** · **One copy of the clock and marks: `seiza::marks`** (`now`, `mark`, `mark_at`, `mark_time`, `mark_after_current_task`). Readers take the last entry, since a retry sets marks again. +0.6 KiB brotli after the review (one `performance.mark` call, `startTime` off the returned entry). *[M7 part E]*
- **2026-10-09** · The panel's "Placeholder" row is filled at a later refresh when the paint mark arrives after the first frame: Element Timing entries reach their observer asynchronously, and one run of 20 in the baseline attempt missed the row (+1.0 KiB). A baseline recorded at load 2–4 (210.3 ms) was discarded: the user's open apps keep the machine there, so it measured them, not the code. *[M7 part G]*

## Static placeholder shell (`shared-web/`)

Whether an app has one is the app's decision (Tycho: yes, M7 part E); how it's built is shared.

- **2026-10-09** · **Placeholder font: an inlined, renamed Plex subset.** A subset of IBM Plex Sans Regular to printable ASCII plus `…`, made once with fonttools, renamed ("Seiza Placeholder"; the OFL reserves "Plex" and counts a subset as a modified version), committed as WOFF2 in `shared-web/fonts/`, and inlined as a base64 `@font-face` placed after the wasm and font preloads. A check fails if a placeholder uses a character outside that set. Set `font-synthesis: none` and match the weights GPUI actually draws (only Regular is loaded; `EmptyTitle` asks for `font_medium`). The screenshot check allows a tolerance, since GPUI rasterizes its own glyphs. Rejected: system fonts (a visible swap); sharing GPUI's font bytes through `FontFace` (the text waits for the 196 KiB face, giving back most of the throttled win); a subset of the exact placeholder text made at build time (needs fonttools in the build, and every copy edit regenerates it); a separate preloaded subset file (an extra request on a cold cache). *[M7 part G, design discussion]*
- **2026-10-09** · **The placeholder stays hidden until its font has loaded** (`document.fonts.load`, then `sz-ready`): Chrome sometimes painted it once laid out in the fallback font's metrics, text invisible (`font-display: block`), then re-laid it out, so the buttons and title bar jumped. No `-webkit-font-smoothing`/`text-rendering` overrides: they drew it thinner than GPUI on macOS. *[M7 part G, review]*
- **2026-10-09** · **The placeholder hands over by a 120 ms fade, not a cut.** `shared/` adds `sz-leaving` in the `gpui:first-frame` microtask (first frame already presented, so still no blank frame); the placeholder removes itself after. GPUI and the browser rasterize the same font differently (GPUI's text crisper, up to ~2 px lower at DPR 1) and round half-pixels in opposite directions, so a cut always jumped somewhere. Rejected: tuning offsets with a hard cut (residual 1–2 px text jumps at DPR 1, worse at some window sizes); a title-bar-only placeholder. *[M7 part G, review]*
- **2026-10-09** · **The placeholder copies GPUI's layout rounding:** line heights rounded to whole device pixels, half down, set per DPR by its inline script; the centered column nudged −0.03 px so exact x.5 positions round down as GPUI's do. Found by sampling GPUI's published button bounds across window sizes. Box edges then match exactly at DPR 1 and within one device px at DPR 2 (GPUI measures glyphs at the device scale). *[M7 part G, review]*

## Measurement protocol

- **2026-09-23** · Reference run at a true DPR 2: the perf suite hides `devicePixelContentBoxSize` so gpui-pre-web uses its Safari sizing path. *[M1]*
- **2026-09-23** · Perf and check runs serve `web/dist` brotli-compressed (quality 11, cached) through `vite preview`. *[M1]*
- **2026-09-23** · `just <app> check` is the budget gate: lint, release build, and a 10-run reference pass against `perf/baseline.json`. It fails when TTFP regresses more than 10% or the wasm (brotli) grows more than 15%, unless a row in `perf/budget-notes.md` accepts the size; `--write-baseline` retires older acceptances. *[Tycho M1]*
- **2026-10-10** · **Budgets apply to the local build only; production is recorded** (user's decision, repo-wide: root CLAUDE.md, measurement protocol). Production TTFP is split at wasm ready (`perf.ts --vs-local`, interleaved with the local build): before it is the network (connection, HTML, the 2.9 MB wasm over the link), zero for local preview, so "TTFP within 15% of local" couldn't hold on any remote host (15% of 195 ms is ~one TLS handshake); after it is the app's work, which matched local (+2.7% ref, +0.1% throttled). The table's load budgets (first rows, jump) likewise: a first page in production is ~8 sequential round trips, and a Gaia page 5.6 MB over the link. Optimizing production gets its own session, as a goal. *[M8]*
