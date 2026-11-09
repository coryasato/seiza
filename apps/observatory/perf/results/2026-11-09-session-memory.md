# The tab's memory over a session (2026-11-09)

The tab's memory over a session (an open question in PLAN.md until this note). Measured on Apple M1, macOS, machine `local`, Chromium 153 headless=new, 1440×900 at DPR 2: the page's local release build with both contenders' builds, one scripted session per run (`perf/session-memory.ts`). A memory reading needs no quiet machine (the timing gate's spread is for marks), so the two before-runs ran side by side.

Raw: `2026-11-09-session-memory.json` (before the fix, a forced collection only where a step says so), `2026-11-09-session-memory-gc.json` (before the fix, a forced collection before every reading), `2026-11-09-session-memory-fixed.json` (after the fix, as the first, on the reviewed script).

## The session

The Overview, the component's page, then each scenario's route (Big file, the wide sheet, market watch, live tail) at every stop: GPUI, a flip to TanStack, a flip back, 5 s on each filled frame (39 frames, 26 of them destroyed within their route). Then back to the Overview, idle for 10 min, a reading every 30 s, and a last one after a forced collection. Each reading: `measureUserAgentSpecificMemory`'s breakdown; each destroyed frame's document, wasm memories, and workers, alive or collected (weak references); and the private footprint of the renderers and the GPU process. Chrome's tab hover card ("Memory usage") shows the renderer's footprint, which leaves out the GPU process. The before-runs took the largest renderer as the tab's. Their recorded processes show that was the tab's own process (one PID through every navigation) from the component's page on, but not at the first reading: the fresh Overview's tab read 52.5 MiB (51.4 with collections), not the 59.1 MiB a spare renderer had. The script now finds the tab's renderer by its CPU time while the page spins.

## What it found

**The page held the frame it last replaced, until the next switch.** On every route, one destroyed frame's document stayed alive after a forced collection, always the one destroyed just before the current one, along with its worker objects. Before it, each destroyed frame (documents, wasm memories, workers) was collected. `live.ts` keeps each side's last `Tracked` (its readings: warm or cold, the status bar), and that object still reached the old frame's realm: `detach` and `startFeed` close over the frame's `window`, and on the feed levels `ring.samples` is the frame realm's `Float64Array`. The fix keeps everything that reaches a frame (its element, those closures, the ring) in one `link` that `release` drops whole when the frame is replaced, apart from the readings `sides` keeps, so a field added later can't bring the leak back unnoticed. After it, no destroyed frame is alive at any reading, collected or not. The cost was bounded (one frame's realm: its window, document, and a GPUI frame's wasm memory until a collection), not a buildup.

**Nothing outlives a route.** Back on the Overview, the measured memory is the Overview's own (3.0 to 3.1 MiB against 2.7 MiB at the start), with no frame and no worker left.

**The renderer's footprint grows within a route and is returned when the route is left.** The measured memory stays flat across a route's switches, but the renderer's footprint climbs with each frame created, with or without a forced collection before each reading:

| Route | Measured (JS, canvas, workers), MiB | Renderer footprint, MiB: first frame → peak (before) | Same, a collection before each reading |
|---|---|---|---|
| Big file | 65–97 | 331 → 359 | 317 → 347 |
| Wide sheet | 142–179 | 430 → 550 | 408 → 533 |
| Market watch | 67–87 | 307 → 470 | 294 → 412 |
| Live tail | 67–118 | 364 → 663 | 332 → 575 |

The gap is memory outside the JS heap: each frame's DuckDB worker (57 to 140 MiB measured, while it lives), GPUI's wasm memory, and the allocator's pages, which the process returns to the OS lazily. A collection reaches only the JS heap, so it moves the footprint by 10 to 90 MiB, not the climb. The GPU process peaked at 307 MiB (315 with collections), out of the hover card's number.

**It settles within 30 s of leaving, in the same process.** The tab's renderer kept its PID across the navigation, so the drop is that process giving pages back, not an old process going away. The renderer at the Overview right after the session: 343 MiB (210 with collections), 30 s later 148 MiB (146), after 10 min 151 MiB (144), and after a last forced collection 131 MiB. The fresh Overview was ~52 MiB, so ~90 to 100 MiB stays with the process (allocator pages and caches the measured memory doesn't see: 3 MiB measured).

**Against the 900 MB → ~223 MB in a real tab.** The same shape: a peak in the hundreds while frames come and go on a route, and a settled tab around 2 to 4 times a fresh one. A headed Chrome with scrolling (each frame's cache up to 64 MiB, the logs' file fetched whole) and slower switches runs higher than this 5 s dwell. Nothing here points at a leak past the one frame now fixed.

## After the fix

The same session on the reviewed fix and script (`2026-11-09-session-memory-fixed.json`; a forced collection only on leaving each route and at the end; the tab's renderer found by its CPU time, one PID throughout): all 67 readings taken, no problems (no page or console error, failed request, failed frame, or missing reading), and no destroyed frame's document, wasm memory, or worker alive at any reading, collected or not. The rest is unchanged within run-to-run noise. The renderer climbed per route as before (Big file 330 → 357 MiB, the wide sheet 433 → 517, market watch 302 → 457, live tail 351 → 602) with the measured memory flat (66–87, 143–198, 67–88, 68–118 MiB). The GPU process peaked at 306 MiB. The fresh Overview read 52 MiB; back on it after the session, 292 MiB at once, 147 after 30 s, 150 after 10 min, and 130 after a forced collection.

The fix doesn't move the footprint's peak, since the frame it frees is one of ~13 on a route and its realm is small beside the workers' memory. What it removes is a destroyed frame's window, document, and GPUI wasm memory staying alive until the next switch.

## Reproducing it

```sh
just observatory builds
just observatory session-memory                 # forced collection only on leaving each route and at the end
just observatory session-memory --gc            # before every reading
```
