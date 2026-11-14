# The table's scripts (`perf/`)

The checks and measurements run against the bare host's release build, and the scripts that write the fixtures read from it. Claude Code loads this file when a file under `perf/` is read. The table's rules and the map of its folders are in `components/tall-table/CLAUDE.md`, the repo's in the root `CLAUDE.md`; both apply here. So does `.claude/rules/perf-harness.md` (the shared helpers and headless Chromium's DPR traps), which this file doesn't repeat. Paths are relative to `components/tall-table/`.

## How the scripts run

They serve the host's release build themselves (`vite preview` of `host/web/dist` on port 4350, through `serveApp`) and read what it was built with from `dist/build.json`. Each segment is traced on its own (a trace of every segment at once runs to hundreds of MB). Late frames come from `frameRecorder`'s rAFs: Chromium's compositor frame reporter doesn't see GPUI's canvas frames. The table-specific helpers (the host's globals and marks, each feature's waits and hooks, a real paste, `restedWhere`) are in `harness.ts`; look there before writing one. A few scripts read a global directly (`copy.ts` the heap hook, `perf.ts`, `follow.ts`, and `sort.ts` `__seizaFrameSample`), so grep `perf/` for a global before renaming it.

## Perf script gotchas

- **A hook's `None` reaches a script as `undefined`,** not `null`: `host/CLAUDE.md`'s gotcha.
- **GPUI delivers a frame's events after its draw and present,** in the same task: a probe read at a frame's GPU calls reads the frame before's. Read it with `presentedRecorder`, which wraps the GPU calls, so install it only for the window that reads it and stop it before a timed or traced one (`follow.ts`). And `follow`'s tail pin can move the view after the last frame and before an input, so `follow.ts` finds a wheel's frame by the following flag, not by its top.
- **A page's own rAF loop slows `live`'s latency** (~20 ms against ~7 with `frameRecorder` installed), so `live.ts` measures latency with nothing on the page, then traces frame work in a second window.
- **A scripted drag moves the pointer every 8 ms, not once a frame,** as the sideways fling sends its wheels: under the throttled profile moves sent a frame apart left half the traced frames empty, and the trace's p50 read their idle time (`docs/DECISIONS.md`, "Features").
- **A drag-select moves a row a move:** the table redraws only when the selection changes, so moves within a cell draw nothing and the p50 reads idle frames (`docs/DECISIONS.md`, "Features"). Between `perf`'s segments the select-all is cleared before Home and pressed again after: Home moves the active cell, which the select-all left at row 0, so it scrolls nothing.
- **Playwright resolves a wheel before the page handles it:** at a throttled dense table's ~90 ms frames, queued wheels kept the view scrolling for seconds, so a filled frame mid-scroll passed for a rest and a Home pressed then was undone. A rest waits for the view filled and no frame presented for 300 ms (`restedWhere`, with `workRecorder` installed), and `perf.ts` ends each reading 300 ms after the last presented frame, so the quiet spell isn't counted.
- **A copy that outlasts a scroll doesn't belong in the scroll's window:** `copy.ts` ends the traced window at the scroll's rest and reads the copy's end afterwards from its mark.
- **A move to the page's corner never reaches the canvas:** gpui-pre-web's key textarea sits at (1, 1), over it, so GPUI's hover stays where it was. Move the pointer "away" into the body.
- **A second press within 5 px of the last is a double-click unless 400 ms passed when gpui-pre-web handled it** (`register_click`, timed with `Date.now()` at handling, not the event's time), so a script's wait can come up short on a busy machine. A script that selects a header and then drags it presses 8 px apart (`SELECT_OFFSET_PX`).
- **The wheel is the body's:** over the header a wheel scrolls nothing, so a script that wheels during a resize drag moves the pointer straight down into the body first (the width follows the pointer's x alone).
- **Firefox's screenshot can show the frame before the probe's** (~100 ms behind): the smoke check's tint samples poll up to 1 s for what they expect (`settled`), so a redraw that never came still fails.
- **The clipboard is read through a real paste** (`harness.ts`'s `paste`), never `navigator.clipboard.readText`, which Firefox and WebKit don't grant a script. Chromium's context is granted `clipboard-read` and `clipboard-write` (headless refuses every async write without it); WebKit on macOS writes the system pasteboard, so a run overwrites what was copied there. With reads held (`?delay`), prefetch's two reads go out only once the visible page lands, so the smoke check waits out the prefetch before timing a held copy.
- **A build from another commit is labeled with this tree's gpui-kit:** the scripts record versions from the lockfile (`machineInfo().versions`), not from the build. An A/B against another gpui-kit (a worktree's build copied into `host/web/dist`) corrects the version in its results files and names the commit beside it (`protocol.servedBuild`).

## Files

```
  perf/             # harness.ts (the host's names, waits, and hooks), size.ts, perf.ts, build-info.ts (dist/build.json), live.ts, follow.ts, copy.ts, sort.ts, smoke.ts, paint-fixture.ts, density-fixture.ts, format-fixture.ts; results/: each feature's own cost, dated (no budgets)
```

## Commands

What each covers and its flags are in its script's header and the justfile's comment above its recipe. Each needs `just tall-table build [features]` first, with the feature it measures.

```
just tall-table size [flags]   # the wasm of the base and each feature's build; fails on an engine or the panel linked, a feature's symbols in the base, or a home-directory path
just tall-table perf [flags]   # frame work per shape and each feature's segments, reference + throttled, cold, median of 10
just tall-table live | follow | copy | sort [flags]   # each feature's own latency and frame work, cold, median of 10
just tall-table smoke [flags]  # the release build in Chromium, Firefox, and WebKit: loads, fills, scrolls, and each feature built checked against the source
just tall-table smoke --screens save|<commit>   # the reference screens alone: saved under this tree, or compared pixel for pixel with a commit's
just tall-table paint-fixture | density-fixture | format-fixture [--check]   # write (or compare) the fixtures' values read from Chromium
```
