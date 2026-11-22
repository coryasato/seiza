# The table's scripts (`perf/`)

The checks and measurements run against the bare host's release build, and the scripts that write the fixtures read from it. Claude Code loads this file when a file under `perf/` is read. The table's rules and the map of its folders are in `components/tall-table/CLAUDE.md`, the repo's in the root `CLAUDE.md`; both apply here. So does `.claude/rules/perf-harness.md` (the shared helpers and headless Chromium's DPR traps), which this file doesn't repeat. Paths are relative to `components/tall-table/`.

## Measuring a feature

**The component measures only itself:** each feature's own cost, the wasm it adds (brotli 11, and after wasm-opt) and the work per frame it adds while scrolling and in its own interaction, each against the base, in the bare host. Recorded in `results/` (dated JSON and a note, as an app's are) and in the README's Features table ("Cost", "Measured in"). There's no `budgets.json` and nothing gates on these: the numbers tell a host what turning a feature on costs.

**What protects the apps is the component's tests,** not a measurement in each app. Every feature is off by default, so an app's build doesn't change until it turns one on: each feature's milestone checks that the base build is unchanged with the feature off (`size`), and that the native tests and the fixtures pass with it off and on. An app measures a feature against its own budgets when it adopts it, in its own milestone; a cost it can't carry is an optimization milestone in the table's `PLAN.md`.

**The bare host** (`host/`, its file `host/CLAUDE.md`) renders the table and nothing else, built as the apps are (`cargo build -p` on its own, `wasm-bindgen --target web`, `wasm-opt -Oz --enable-threads` with the apps' flags, brotli 11), and is never deployed. Why: `docs/DECISIONS.md`, "Features", "The bare host's shape".
- **Its own crate, not an app:** a cost read in an app mixes in the app's code, and the observatory's GPUI contender can't carry code for a feature its DOM side lacks (`.claude/rules/comparison-protocol.md`, "The same scope").
- **It uses each feature, not only compiles it:** one Cargo feature per table feature, each turning on the table's code and the host's run-time switch (a resizable column, a selection mode, a sorted read). A feature compiled but never switched on can be stripped by the optimizer and read as free.
- **Its data is synthetic,** pages answered from memory, no DuckDB, so the bytes and frame work are the table's alone. A feature that reaches the delegate (`sort`, `copy`) gets the calls it needs, answered in memory; its data cost (SQL, bytes read) is the source's (the DuckDB engine's `tall-table` source).
- **The measurement:** bytes are the base build against each feature's build. Frame work is a scripted scroll and the feature's own interaction (a resize drag, a selection drag), recorded with `shared-web/perf/`'s harness (`workRecorder`, `wheel`), under the root's measurement protocol (reference and throttled).

**Two shapes,** since every feature's numbers are read against them, at the protocol's 1440×900, DPR 2:
- **Narrow:** the observatory's 11 columns' kinds, 1.57 M rows.
- **Wide:** 500 `ColumnKind::Float` columns (120 px each, the kind's width), 1.57 M rows, so the paging differs from the narrow shape only by the columns.

## How the scripts run

They serve the host's release build themselves (`vite preview` of `host/web/dist` on port 4350, through `serveApp`) and read what it was built with from `dist/build.json`. Each segment is traced on its own (a trace of every segment at once runs to hundreds of MB). Late frames come from `frameRecorder`'s rAFs: Chromium's compositor frame reporter doesn't see GPUI's canvas frames. The table-specific helpers (the host's globals and marks, each feature's waits and hooks, a real paste, `restedWhere`) are in `harness.ts`; look there before writing one. A few scripts read a global directly (`copy.ts` the heap hook, `perf.ts`, `follow.ts`, `sort.ts`, and `find.ts` `__seizaFrameSample`; `find.ts` times the bridge's `__tallTableFound` through a setter), so grep `perf/` for a global before renaming it.

## Perf script gotchas

- **A hook's `None` reaches a script as `undefined`,** not `null`: `host/CLAUDE.md`'s gotcha.
- **GPUI delivers a frame's events after its draw and present,** in the same task: a probe read at a frame's GPU calls reads the frame before's. Read it with `presentedRecorder`, which wraps the GPU calls, so install it only for the window that reads it and stop it before a timed or traced one (`follow.ts`). And `follow`'s tail pin can move the view after the last frame and before an input, so `follow.ts` finds a wheel's frame by the following flag, not by its top.
- **A page's own rAF loop slows `live`'s latency** (~20 ms against ~7 with `frameRecorder` installed), so `live.ts` measures latency with nothing on the page, then traces frame work in a second window.
- **A scripted drag moves the pointer every 8 ms, not once a frame,** as the sideways fling sends its wheels: under the throttled profile moves sent a frame apart left half the traced frames empty, and the trace's p50 read their idle time (`docs/DECISIONS.md`, "Features").
- **A drag-select moves a row a move:** the table redraws only when the selection changes, so moves within a cell draw nothing and the p50 reads idle frames (`docs/DECISIONS.md`, "Features"). Between `perf`'s segments the select-all is cleared before Home and pressed again after: Home moves the active cell, which the select-all left at row 0, so it scrolls nothing.
- **Playwright resolves a wheel before the page handles it:** at a throttled dense table's ~90 ms frames, queued wheels kept the view scrolling for seconds, so a filled frame mid-scroll passed for a rest and a Home pressed then was undone. A rest waits for the view filled and no frame presented for 300 ms (`restedWhere`, with `workRecorder` installed), and `perf.ts` ends each reading 300 ms after the last presented frame, so the quiet spell isn't counted.
- **A throttled wide fling's late frames are the bare host's page reads, not a feature's cost:** its source builds each page on the main thread, in a task of its own (~4 ms throttled, ~10 at p95), and a ~14 ms frame with one beside it misses the refresh; three in four late frames are that, in every build, and a run's share swings 0–11% with how the tasks fall. Read a feature by its frame work; a late share that differs from the base's by a few points is this (`late.ts` splits a late frame into its parts; `results/2026-11-17-late-frames.md`). A build with `live` (so `follow`) reads a page ~1.3 ms slower in the host's own source, which keys each row by its version.
- **A copy that outlasts a scroll doesn't belong in the scroll's window:** `copy.ts` ends the traced window at the scroll's rest and reads the copy's end afterwards from its mark.
- **A move to the page's corner never reaches the canvas:** gpui-pre-web's key textarea sits at (1, 1), over it, so GPUI's hover stays where it was. Move the pointer "away" into the body.
- **A second press within 5 px of the last is a double-click unless 400 ms passed when gpui-pre-web handled it** (`register_click`, timed with `Date.now()` at handling, not the event's time), so a script's wait can come up short on a busy machine. A script that selects a header and then drags it presses 8 px apart (`SELECT_OFFSET_PX`).
- **A real long press or pan can be sent only in Chromium; a script-made one in every browser.** CDP's `Input.dispatchTouchEvent` (a `touchStart`, a hold past gpui-pre's 500 ms, a `touchEnd`) reaches gpui-pre-web as touch pointer events with no emulation switched on; Playwright gives Firefox and WebKit no touch but a tap (`touchscreen.tap`, a context with `hasTouch`). `PointerEvent`s of type `touch` made by the page's script and dispatched on the canvas drive a tap, a hold, and a pan in all three: they check the table's handling, not the browser's delivery. A touch step waits out the last pan's momentum: a touch that lands on a running fling catches it and is never a tap or a long press. A second button pressed while the left is held never reaches GPUI as a press (the browser sends a `pointermove`), so a script can't press "during" a drag with another button and expect a press.
- **With `header-icon` built, the start of every header is its icon's:** a left press within the raised look's reach of the badge is the icon's, selecting and dragging nothing. A script that presses a header goes through `headerAt` or `moveGripAt`, which clear it (`ICON_CLEAR_PX` past `iconEnd`, in a narrow column too, short of its right end); one that works out its own x does the same. A script that counts the icon's presses reads the host's count again after each step (`iconPressCount`), never its own.
- **A wheel clears the hover:** the cells move under a still pointer, so the table drops its hovered cell until the pointer moves again, and with it the tooltip and `popover`'s cue. A script that wants a cue through a scroll gets `select`'s active cell's while it's in view; one that wants a cue on every frame moves the pointer (`perf.ts`'s `cue-hover`, a row a move).
- **The narrow shape's columns run past the 1440 px view,** and none stretch, so there's no blank past the last column at open: the smoke check's clicks run widens the view for one (the wide shape has none).
- **The wheel is the body's:** over the header a wheel scrolls nothing, so a script that wheels during a resize drag moves the pointer straight down into the body first (the width follows the pointer's x alone).
- **Firefox's screenshot can show the frame before the probe's** (~100 ms behind): the smoke check's tint samples poll up to 1 s for what they expect (`settled`), so a redraw that never came still fails.
- **The clipboard is read through a real paste** (`harness.ts`'s `paste`), never `navigator.clipboard.readText`, which Firefox and WebKit don't grant a script. Chromium's context is granted `clipboard-read` and `clipboard-write` (headless refuses every async write without it); WebKit on macOS writes the system pasteboard, so a run overwrites what was copied there. With reads held (`?delay`), prefetch's two reads go out only once the visible page lands, so the smoke check waits out the prefetch before timing a held copy.
- **A build from another commit is labeled with this tree's gpui-kit:** the scripts record versions from the lockfile (`machineInfo().versions`), not from the build. An A/B against another gpui-kit (a worktree's build copied into `host/web/dist`) corrects the version in its results files and names the commit beside it (`protocol.servedBuild`).

## Files

```
  perf/             # harness.ts (the host's names, waits, and hooks), size.ts, perf.ts, build-info.ts (dist/build.json), live.ts, follow.ts, copy.ts, sort.ts, find.ts, late.ts (what a fling's late frames are made of, kept builds side by side), smoke.ts, paint-fixture.ts, density-fixture.ts, format-fixture.ts, pairs.ts (every feature alone and in pairs, compiled and tested: no build of the host's, no browser); results/: each feature's own cost, dated (no budgets)
```

## Commands

What each covers and its flags are in its script's header and the justfile's comment above its recipe. Each needs `just tall-table build [features]` first, with the feature it measures (`pairs`, the component's `CLAUDE.md`'s, builds its own and needs none).

```
just tall-table size [flags]   # the wasm of the base and each feature's build; fails on an engine or the panel linked, a feature's symbols in the base, or a home-directory path
just tall-table perf [flags]   # frame work per shape and each feature's segments, reference + throttled, cold, median of 10
just tall-table live | follow | copy | sort | find [flags]   # each feature's own latency and frame work, cold, median of 10
just tall-table late --builds <name>,<name> [flags]   # a fling's late frames by cause, kept builds run in turn; --cpu names the functions
just tall-table smoke [flags]  # the release build in Chromium, Firefox, and WebKit: loads, fills, scrolls, and each feature built checked against the source
just tall-table smoke --screens save|<commit>   # the reference screens alone: saved under this tree, or compared pixel for pixel with a commit's
just tall-table paint-fixture | density-fixture | format-fixture [--check]   # write (or compare) the fixtures' values read from Chromium
```
