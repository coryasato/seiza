# Observatory

> *Where the instruments are compared.*

**Live at [seiza.io/observatory](https://seiza.io/observatory/).** It also runs locally: `just observatory preview` after `gpui-build`, `tanstack-build`, and `build`.

The Observatory is seiza's comparison page. For each component in the repo, it runs the component, drawn by GPUI on a canvas from WebAssembly, against a DOM equivalent, and measures what each costs over a session of use. The first comparison is **GPUI | TanStack**: [the tall table](../../components/tall-table/) against React + TanStack Virtual, in three scenarios: **Big file**, all 1.57 M known asteroids; **Wide sheet**, a spreadsheet's shape, 10,632 weather stations by 365 days of daily highs as heat, at four densities; and **Market watch**, a trading screen, 50 made-up instruments whose prices a seeded feed updates in place, 100 to 5k times a second, each change flashing.

- **What it measures: use, not page load.** A data component is judged over a session: how soon it's usable, how long data takes to appear, how fast a scroll or a jump shows up, what a fling looks like, whether the last row is reachable, and what it costs in memory, CPU, and bytes. First pixels and bundle size are footnotes.
- **Only the UI differs:** both sides read the same file through the same engine (DuckDB-Wasm), with the same queries and the same paging numbers. Everything else is what each stack does best; the DOM side scrolls natively.
- **The same scope:** a comparison level is two builds with identical features; neither carries code the other lacks.
- **One at a time:** contenders run one at a time, each in its own frame, since two in one tab share a main thread and a GPU. The published numbers come from cold Playwright runs; what your browser measures is labelled warm.
- **Where TanStack wins, too:** the page's Compare panel shows the cold numbers for both devices, each card with its verdict, and says which side is lower, as this README does below.
- **What your tab reads, and what that costs:** the contender's window has a status bar (Ready in, Rows in, Smooth, Memory; on market watch, Shown in in place of Rows in) and a meter over its corner (frame time over 10 s, memory over a minute; open, a pill, or hidden). They show what your tab reads of the side you're using, labelled warm for a side loaded second or from the cache. They share the contender's main thread, so they're held to a budget: with the meter open, a fling's late frames and dropped or GPU frames stay within noise of the meter hidden, the page spends 0.3–0.4 ms per refresh on a fast machine and under 1.5 ms on a slow one, and it re-renders nothing in React mid-fling ([`perf/results/2026-10-21-m5-d4.md`](perf/results/2026-10-21-m5-d4.md)). The pill drops more compositor frames under throttling than the open meter does.

## Numbers

### Big file

The first comparison, the tall table over the asteroids, cold, median of 10, each value **GPUI / TanStack**. The rows are the per-use metrics, then the footnotes. How each is read: [`docs/contender-contract.md`](docs/contender-contract.md), "Reading the metrics"; the runs and what they showed: [`perf/results/2026-10-18-m4-b.md`](perf/results/2026-10-18-m4-b.md).

- **Where TanStack wins:** first usable, by far: its prerendered first screen hydrates from a small script, while GPUI's canvas waits for its wasm. Its memory, its page's bytes, and its bundle are a fraction of GPUI's. A wheel scroll reaches the screen sooner, because the browser's compositor moves the content before the main thread hears of it, though the rows it lands on are real later. End reaches the last row a little sooner. Under throttling a key reaches the screen a little sooner, and it spends less main-thread CPU over the session, because most of its fling frames do almost no main-thread work.
- **Where GPUI wins:** keeping the rows up under load. In a throttled fling a large share of TanStack's main-thread frames are late, against almost none of GPUI's, and its rows trail the input further. The DOM's scroll itself keeps moving on the compositor; what runs late is the rows' update. GPUI's per-frame work (p95) is lower at both profiles. A track press and a wheel land on real rows sooner, and at reference it spends less main-thread CPU. Its HTML placeholder shell paints first pixels sooner under throttling; at reference the two are within their runs' spread.
- **Even:** time to data (the same engine, file, and queries), and every row reachable on both sides (the row count is `count(*)`, End shows the file's last row).

<!-- report:readme:start -->
| Metric | Budget | Now |
|---|---|---|
| Time to first usable (probe-confirmed), reference | — | 140.8 / 41.7 ms |
| Time to first usable (probe-confirmed), throttled, CPU 4× and Fast 4G | — | 3482.3 / 488.3 ms |
| Time to data: engine ready → every visible row painted, reference | — | 223.8 / 224.5 ms |
| Time to data: engine ready → every visible row painted, throttled, CPU 4× and Fast 4G | — | 3743 / 3772 ms |
| Key (Page Down/Up) → first frame at the new position, reference | — | 19 / 23.9 ms |
| Key (Page Down/Up) → first frame at the new position, throttled, CPU 4× and Fast 4G | — | 29.1 / 26.5 ms |
| Scrollbar track press → first frame at the new position, reference | — | 17.9 / 20.8 ms |
| Scrollbar track press → first frame at the new position, throttled, CPU 4× and Fast 4G | — | 26.1 / 26.5 ms |
| Scrollbar track press → its rows real, reference | — | 18.8 / 30.8 ms |
| Scrollbar track press → its rows real, throttled, CPU 4× and Fast 4G | — | 27 / 44.6 ms |
| Wheel → first frame at the new position, reference | — | 34.1 / 16.1 ms |
| Wheel → first frame at the new position, throttled, CPU 4× and Fast 4G | — | 38.7 / 15.8 ms |
| Wheel → its rows real, reference | — | 34.1 / 43.5 ms |
| Wheel → its rows real, throttled, CPU 4× and Fast 4G | — | 38.7 / 45.8 ms |
| Fling to the last row: late main-thread frames (a DOM scroll keeps moving on the compositor), reference | — | 0 / 0 % |
| Fling to the last row: late main-thread frames (a DOM scroll keeps moving on the compositor), throttled, CPU 4× and Fast 4G | — | 0.3 / 27.6 % |
| Fling: frames showing placeholder rows, reference | — | 98.4 / 97.8 % |
| Fling: frames showing placeholder rows, throttled, CPU 4× and Fast 4G | — | 99 / 98.7 % |
| Fling: how far the rows trail the input, p95, reference | — | 2 / 3 steps |
| Fling: how far the rows trail the input, p95, throttled, CPU 4× and Fast 4G | — | 2 / 5 steps |
| Fling: per-frame work, p95, reference | — | 4.3 / 7.8 ms |
| Fling: per-frame work, p95, throttled, CPU 4× and Fast 4G | — | 14.9 / 24.4 ms |
| End → the last row (= count(*)) painted, reference | — | 32.2 / 26.1 ms |
| End → the last row (= count(*)) painted, throttled, CPU 4× and Fast 4G | — | 512.1 / 466.5 ms |
| Main-thread CPU, load + fling, reference | — | 953.3 / 1560.2 ms |
| Main-thread CPU, load + fling, throttled, CPU 4× and Fast 4G | — | 3319 / 2206.5 ms |
| Page memory after the fling (the engine's workers apart), reference | — | 42.3 / 9.2 MiB |
| Page memory after the fling (the engine's workers apart), throttled, CPU 4× and Fast 4G | — | 55.8 / 4.8 MiB |
| Page memory at equal work (the same pages read on both devices; the canvas's backing store and the engine's workers apart), reference | — | 25.8 / 16.1 MiB |
| Page memory at equal work (the same pages read on both devices; the canvas's backing store and the engine's workers apart), throttled, CPU 4× and Fast 4G | — | 25.8 / 16.2 MiB |
| Footnote: page bytes over the wire (engine and data apart), reference | — | 2798.7 / 180 KiB |
| Footnote: bundle, brotli (GPUI's wasm / TanStack's first-paint JS and data layer) | — | 2770.2 / 108.1 KiB |
| Footnote: first pixels, reference | — | 37.8 / 42 ms |
| Footnote: first pixels, throttled, CPU 4× and Fast 4G | — | 244.5 / 390.7 ms |

"Now" is each metric's newest local measurement: [2026-10-19-m4-b-usable](perf/results/2026-10-19-m4-b-usable.json), [2026-10-18-m4-b-data](perf/results/2026-10-18-m4-b-data.json), [2026-10-18-m4-b-response](perf/results/2026-10-18-m4-b-response.json), [2026-10-19-m4-b-fling](perf/results/2026-10-19-m4-b-fling.json), [2026-10-18-m4-b-reach](perf/results/2026-10-18-m4-b-reach.json), [2026-10-19-m4-b-cost](perf/results/2026-10-19-m4-b-cost.json), [2026-10-20-m5-d1-memory](perf/results/2026-10-20-m5-d1-memory.json), [2026-11-05-m10-b3-sizes](perf/results/2026-11-05-m10-b3-sizes.json), [2026-11-03-m9-c-tanstack-sizes](perf/results/2026-11-03-m9-c-tanstack-sizes.json). Generated by `just observatory report` from [`perf/budgets.json`](perf/budgets.json).
<!-- report:readme:end -->

### Wide sheet

The tall table at its wide level (custom cells, the key columns pinned, density) on both sides, over GHCN-Daily's 2025 highs: Station and Place pinned, a day per column, each cell's heat on one diverging ramp. A dial sets how many cells are on screen (about 380, 570, 710, or 940: the row height, the text size, and the days' width, the same on both sides). Each value is **GPUI / TanStack**, cold, median of 10, on Chromium's gesture scroll. A side **keeps up** at a stop when at least 90% of the display's frames draw new cells in both the steady scroll down and the sideways one. How it's read: [`docs/contender-contract.md`](docs/contender-contract.md), "Reading the metrics"; the runs: [`perf/results/2026-11-03-m9-d.md`](perf/results/2026-11-03-m9-d.md). They were measured with the heat's first, two-stop ramp; the diverging ramp mixes one color per cell, as it did, and a spot check read the same ([`perf/results/2026-11-04-m9-e3b.md`](perf/results/2026-11-04-m9-e3b.md)).

- **Where GPUI wins:** it keeps up at every stop on a fast device, to ~940 cells, where TanStack keeps up to ~380 only; in a fast fling it draws new cells in nearly every frame at every stop, where TanStack draws about every other one; its work per frame is lower in the scroll down and the fast fling at every stop past the first, and in all three at every stop on a slow device. A key moves it sooner, and a scrollbar press or a wheel lands on filled rows sooner.
- **Where TanStack wins:** it's usable far sooner (its prerendered first screen hydrates while GPUI's wasm downloads), holds less memory (by far once open; after the file is read whole and a long sideways session, the gap narrows, and GPUI's wasm memory never shrinks), downloads a small fraction of GPUI's bytes, and spends less main-thread CPU over the session. Its work per frame in the sideways scroll is a little lower on a fast device past the first stop. A scrollbar press or a wheel moves its view sooner, a wheel on the compositor.
- **Even:** time to data and End to the last row (the same engine, file, and queries), and first pixels on a fast device (GPUI's placeholder shell paints sooner on a slow one).
- **Neither, on a slow device:** at CPU 4×, neither side keeps up at any stop.

At each stop:

<!-- report:readme:wide-sheet-stops:start -->
| Metric | Budget | Now |
|---|---|---|
| Wide sheet at ~380 cells: frames that drew new cells, the steady scroll down, reference | — | 100 / 99.2 % |
| Wide sheet at ~380 cells: frames that drew new cells, the steady scroll down, throttled | — | 55.5 / 26.5 % |
| Wide sheet at ~380 cells: frames that drew new cells, the steady scroll sideways, reference | — | 100 / 97.9 % |
| Wide sheet at ~380 cells: frames that drew new cells, the steady scroll sideways, throttled | — | 62 / 43.8 % |
| Wide sheet at ~380 cells: frames that drew new cells, the fast fling, reference | — | 100 / 54.3 % |
| Wide sheet at ~380 cells: frames that drew new cells, the fast fling, throttled | — | 55.7 / 32.6 % |
| Wide sheet at ~380 cells: work per drawn frame (p95), the steady scroll down, reference | — | 7.8 / 7.9 ms |
| Wide sheet at ~380 cells: work per drawn frame (p95), the steady scroll down, throttled | — | 30.8 / 58.5 ms |
| Wide sheet at ~380 cells: work per drawn frame (p95), the steady scroll sideways, reference | — | 8.2 / 8.4 ms |
| Wide sheet at ~380 cells: work per drawn frame (p95), the steady scroll sideways, throttled | — | 28.1 / 34.7 ms |
| Wide sheet at ~380 cells: work per drawn frame (p95), the fast fling, reference | — | 8.9 / 14.7 ms |
| Wide sheet at ~380 cells: work per drawn frame (p95), the fast fling, throttled | — | 31.1 / 52.5 ms |
| Wide sheet at ~570 cells: frames that drew new cells, the steady scroll down, reference | — | 100 / 63.2 % |
| Wide sheet at ~570 cells: frames that drew new cells, the steady scroll down, throttled | — | 40.4 / 23.1 % |
| Wide sheet at ~570 cells: frames that drew new cells, the steady scroll sideways, reference | — | 100 / 93.3 % |
| Wide sheet at ~570 cells: frames that drew new cells, the steady scroll sideways, throttled | — | 45 / 33.3 % |
| Wide sheet at ~570 cells: frames that drew new cells, the fast fling, reference | — | 100 / 55.7 % |
| Wide sheet at ~570 cells: frames that drew new cells, the fast fling, throttled | — | 41.5 / 26.6 % |
| Wide sheet at ~570 cells: work per drawn frame (p95), the steady scroll down, reference | — | 10.4 / 14.4 ms |
| Wide sheet at ~570 cells: work per drawn frame (p95), the steady scroll down, throttled | — | 45.4 / 77.2 ms |
| Wide sheet at ~570 cells: work per drawn frame (p95), the steady scroll sideways, reference | — | 10.9 / 9.9 ms |
| Wide sheet at ~570 cells: work per drawn frame (p95), the steady scroll sideways, throttled | — | 39.9 / 43.9 ms |
| Wide sheet at ~570 cells: work per drawn frame (p95), the fast fling, reference | — | 11.2 / 19.6 ms |
| Wide sheet at ~570 cells: work per drawn frame (p95), the fast fling, throttled | — | 43.5 / 70.2 ms |
| Wide sheet at ~710 cells: frames that drew new cells, the steady scroll down, reference | — | 100 / 50.4 % |
| Wide sheet at ~710 cells: frames that drew new cells, the steady scroll down, throttled | — | 33.7 / 20.5 % |
| Wide sheet at ~710 cells: frames that drew new cells, the steady scroll sideways, reference | — | 100 / 86.3 % |
| Wide sheet at ~710 cells: frames that drew new cells, the steady scroll sideways, throttled | — | 36.3 / 27.5 % |
| Wide sheet at ~710 cells: frames that drew new cells, the fast fling, reference | — | 100 / 53.1 % |
| Wide sheet at ~710 cells: frames that drew new cells, the fast fling, throttled | — | 34.4 / 23.1 % |
| Wide sheet at ~710 cells: work per drawn frame (p95), the steady scroll down, reference | — | 12.5 / 18 ms |
| Wide sheet at ~710 cells: work per drawn frame (p95), the steady scroll down, throttled | — | 52.4 / 86.4 ms |
| Wide sheet at ~710 cells: work per drawn frame (p95), the steady scroll sideways, reference | — | 12.8 / 11.6 ms |
| Wide sheet at ~710 cells: work per drawn frame (p95), the steady scroll sideways, throttled | — | 48.7 / 52.2 ms |
| Wide sheet at ~710 cells: work per drawn frame (p95), the fast fling, reference | — | 13.1 / 21.5 ms |
| Wide sheet at ~710 cells: work per drawn frame (p95), the fast fling, throttled | — | 50.9 / 79.4 ms |
| Wide sheet at ~940 cells: frames that drew new cells, the steady scroll down, reference | — | 100 / 48.6 % |
| Wide sheet at ~940 cells: frames that drew new cells, the steady scroll down, throttled | — | 26.4 / 17.5 % |
| Wide sheet at ~940 cells: frames that drew new cells, the steady scroll sideways, reference | — | 99.2 / 52.3 % |
| Wide sheet at ~940 cells: frames that drew new cells, the steady scroll sideways, throttled | — | 27.6 / 21.8 % |
| Wide sheet at ~940 cells: frames that drew new cells, the fast fling, reference | — | 99.2 / 49.4 % |
| Wide sheet at ~940 cells: frames that drew new cells, the fast fling, throttled | — | 27 / 18.6 % |
| Wide sheet at ~940 cells: work per drawn frame (p95), the steady scroll down, reference | — | 15.2 / 23.4 ms |
| Wide sheet at ~940 cells: work per drawn frame (p95), the steady scroll down, throttled | — | 69.2 / 100.8 ms |
| Wide sheet at ~940 cells: work per drawn frame (p95), the steady scroll sideways, reference | — | 15.4 / 14.4 ms |
| Wide sheet at ~940 cells: work per drawn frame (p95), the steady scroll sideways, throttled | — | 64.7 / 69 ms |
| Wide sheet at ~940 cells: work per drawn frame (p95), the fast fling, reference | — | 15.8 / 26.4 ms |
| Wide sheet at ~940 cells: work per drawn frame (p95), the fast fling, throttled | — | 65.7 / 105.3 ms |

"Now" is each metric's newest local measurement: [2026-11-03-m9-d-scroll-wide-sheet-rows-26](perf/results/2026-11-03-m9-d-scroll-wide-sheet-rows-26.json), [2026-11-03-m9-d-scroll-wide-sheet-rows-22](perf/results/2026-11-03-m9-d-scroll-wide-sheet-rows-22.json), [2026-11-03-m9-d-scroll-wide-sheet-rows-20](perf/results/2026-11-03-m9-d-scroll-wide-sheet-rows-20.json), [2026-11-03-m9-d-scroll-wide-sheet-rows-18](perf/results/2026-11-03-m9-d-scroll-wide-sheet-rows-18.json). Generated by `just observatory report` from [`perf/budgets.json`](perf/budgets.json).
<!-- report:readme:wide-sheet-stops:end -->

Once, at the default stop (~710 cells):

<!-- report:readme:wide-sheet:start -->
| Metric | Budget | Now |
|---|---|---|
| Wide sheet: time to first usable (~710 cells), reference | — | 152.8 / 44.8 ms |
| Wide sheet: time to first usable (~710 cells), throttled | — | 3583.2 / 493.1 ms |
| Wide sheet: first pixels (~710 cells), reference | — | 42.5 / 42.6 ms |
| Wide sheet: first pixels (~710 cells), throttled | — | 248.8 / 392.4 ms |
| Wide sheet: time to data (~710 cells), reference | — | 399.2 / 433.3 ms |
| Wide sheet: time to data (~710 cells), throttled | — | 4324.3 / 4415.2 ms |
| Wide sheet: key press → table moves (~710 cells), reference | — | 16.9 / 40 ms |
| Wide sheet: key press → table moves (~710 cells), throttled | — | 55.8 / 81.3 ms |
| Wide sheet: scrollbar press → table moves (~710 cells), reference | — | 33.8 / 25.8 ms |
| Wide sheet: scrollbar press → table moves (~710 cells), throttled | — | 54.2 / 26.9 ms |
| Wide sheet: scrollbar press → rows filled (~710 cells), reference | — | 33.8 / 56.4 ms |
| Wide sheet: scrollbar press → rows filled (~710 cells), throttled | — | 54.2 / 83.5 ms |
| Wide sheet: wheel → table moves (~710 cells), reference | — | 37.6 / 12.4 ms |
| Wide sheet: wheel → table moves (~710 cells), throttled | — | 56 / 11.1 ms |
| Wide sheet: wheel → rows filled (~710 cells), reference | — | 37.6 / 57.8 ms |
| Wide sheet: wheel → rows filled (~710 cells), throttled | — | 56 / 73.9 ms |
| Wide sheet: End → the last row filled (~710 cells), reference | — | 303.7 / 311.2 ms |
| Wide sheet: End → the last row filled (~710 cells), throttled | — | 4588.8 / 4658.9 ms |
| Wide sheet: main-thread CPU, load and use (~710 cells), reference | — | 2926.9 / 2327 ms |
| Wide sheet: main-thread CPU, load and use (~710 cells), throttled | — | 4512.7 / 3876.4 ms |
| Wide sheet: page bytes (~710 cells), reference | — | 2877.8 / 184.9 KiB |
| Wide sheet: memory once open, after GC (~710 cells), reference | — | 51.4 / 13.7 MiB |
| Wide sheet: memory once open, after GC (~710 cells), throttled | — | 51.5 / 13.7 MiB |
| Wide sheet: memory after the file read whole and a long sideways session (JavaScript, after GC) (~710 cells), reference | — | 53.6 / 37.9 MiB |
| Wide sheet: memory after the file read whole and a long sideways session (JavaScript, after GC) (~710 cells), throttled | — | 53.7 / 37.9 MiB |

"Now" is each metric's newest local measurement: [2026-11-03-m9-d-usable-wide-sheet-rows-20](perf/results/2026-11-03-m9-d-usable-wide-sheet-rows-20.json), [2026-11-03-m9-d-data-wide-sheet-rows-20](perf/results/2026-11-03-m9-d-data-wide-sheet-rows-20.json), [2026-11-03-m9-d-response-wide-sheet-rows-20](perf/results/2026-11-03-m9-d-response-wide-sheet-rows-20.json), [2026-11-03-m9-d-reach-wide-sheet-rows-20](perf/results/2026-11-03-m9-d-reach-wide-sheet-rows-20.json), [2026-11-03-m9-d-cost-wide-sheet-rows-20](perf/results/2026-11-03-m9-d-cost-wide-sheet-rows-20.json), [2026-11-03-m9-d-memory-wide-sheet-rows-20](perf/results/2026-11-03-m9-d-memory-wide-sheet-rows-20.json). Generated by `just observatory report` from [`perf/budgets.json`](perf/budgets.json).
<!-- report:readme:wide-sheet:end -->

### Market watch

The tall table at its market level (custom cells, live re-reads, and number formats) on both sides, over 50 fictional instruments in twelve columns. The feed is synthetic: one seeded generator, run in a worker in each side's frame, sends every tick as the same bytes to either side, and each side folds every tick into its own store (JS objects, or Rust's plain buffers) before the table re-reads the rows that changed and draws once a frame; a changed Last, Bid, or Ask flashes. A dial sets the feed's rate: 100, 500, 1k, or 5k updates a second. Each value is **GPUI / TanStack**, cold, median of 10, with no input. A side **keeps up** at a stop when at least 90% of the batches with a visible tick are drawn in a frame of their own. **Update shown in** is a tick's send time in the worker to the first presented frame that draws it. How it's read: [`docs/contender-contract.md`](docs/contender-contract.md), "Reading the metrics"; the runs: [`perf/results/2026-11-06-m10-d2.md`](perf/results/2026-11-06-m10-d2.md).

- **Where GPUI wins:** under load and in garbage. Both keep up at every stop on a fast device, but on a slow one TanStack falls behind at 5k, half its frames late, while GPUI keeps up with none late. GPUI pauses for garbage collection less often at every stop on both devices, and its count doesn't grow with the rate, where TanStack's does. An update shows sooner on GPUI at 100, 1k, and 5k on a fast device and at 5k on a slow one. Its work per frame grows little with the rate, and is lower than TanStack's at 5k on a fast device and from 500 up on a slow one. Its HTML placeholder shell paints first pixels sooner.
- **Where TanStack wins:** it's usable far sooner (its prerendered first screen hydrates while GPUI's wasm downloads), holds a fraction of GPUI's memory (most of GPUI's is its canvas's backing store and its wasm), and downloads a fraction of its bytes. Its work per frame is lower below 5k on a fast device and at 100 on a slow one.
- **Even:** smoothness wherever both keep up (no late frames on either side), time to data (the same engine and file; within a few percent), and an update's time to show at 500 on a fast device and through 1k on a slow one, where the two sides' runs overlap: a side is called faster only by more than 5% with no overlap of its runs and the other's ([`docs/DECISIONS.md`](docs/DECISIONS.md), "Measurement").

At each stop:

<!-- report:readme:market-watch-stops:start -->
| Metric | Budget | Now |
|---|---|---|
| Market watch at 100 updates/s: batches shown in a frame of their own (keeps up), reference | — | 99.4 / 100 % |
| Market watch at 100 updates/s: batches shown in a frame of their own (keeps up), throttled | — | 99.5 / 99.5 % |
| Market watch at 100 updates/s: late frames under the feed, reference | — | 0 / 0 % |
| Market watch at 100 updates/s: late frames under the feed, throttled | — | 0 / 0 % |
| Market watch at 100 updates/s: update shown in (p50), reference | — | 13.2 / 28 ms |
| Market watch at 100 updates/s: update shown in (p50), throttled | — | 20.3 / 25.6 ms |
| Market watch at 100 updates/s: collection pauses in 10 s, reference | — | 4 / 11 pauses |
| Market watch at 100 updates/s: collection pauses in 10 s, throttled | — | 5 / 13 pauses |
| Market watch at 100 updates/s: work per frame (p95) under the feed, reference | — | 4.8 / 4.6 ms |
| Market watch at 100 updates/s: work per frame (p95) under the feed, throttled | — | 7.7 / 6.9 ms |
| Market watch at 500 updates/s: batches shown in a frame of their own (keeps up), reference | — | 99.8 / 99.8 % |
| Market watch at 500 updates/s: batches shown in a frame of their own (keeps up), throttled | — | 99.2 / 99.3 % |
| Market watch at 500 updates/s: late frames under the feed, reference | — | 0 / 0 % |
| Market watch at 500 updates/s: late frames under the feed, throttled | — | 0 / 0 % |
| Market watch at 500 updates/s: update shown in (p50), reference | — | 13.8 / 15 ms |
| Market watch at 500 updates/s: update shown in (p50), throttled | — | 25 / 24.1 ms |
| Market watch at 500 updates/s: collection pauses in 10 s, reference | — | 4 / 21 pauses |
| Market watch at 500 updates/s: collection pauses in 10 s, throttled | — | 5 / 21.5 pauses |
| Market watch at 500 updates/s: work per frame (p95) under the feed, reference | — | 5 / 3.3 ms |
| Market watch at 500 updates/s: work per frame (p95) under the feed, throttled | — | 8.5 / 11.4 ms |
| Market watch at 1k updates/s: batches shown in a frame of their own (keeps up), reference | — | 99.8 / 99.8 % |
| Market watch at 1k updates/s: batches shown in a frame of their own (keeps up), throttled | — | 99.4 / 98.8 % |
| Market watch at 1k updates/s: late frames under the feed, reference | — | 0 / 0 % |
| Market watch at 1k updates/s: late frames under the feed, throttled | — | 0 / 0 % |
| Market watch at 1k updates/s: update shown in (p50), reference | — | 13.7 / 15.5 ms |
| Market watch at 1k updates/s: update shown in (p50), throttled | — | 24.7 / 25.7 ms |
| Market watch at 1k updates/s: collection pauses in 10 s, reference | — | 4 / 29 pauses |
| Market watch at 1k updates/s: collection pauses in 10 s, throttled | — | 5 / 27.5 pauses |
| Market watch at 1k updates/s: work per frame (p95) under the feed, reference | — | 5.1 / 4.1 ms |
| Market watch at 1k updates/s: work per frame (p95) under the feed, throttled | — | 8.9 / 14.8 ms |
| Market watch at 5k updates/s: batches shown in a frame of their own (keeps up), reference | — | 99.6 / 99.7 % |
| Market watch at 5k updates/s: batches shown in a frame of their own (keeps up), throttled | — | 99.3 / 81 % |
| Market watch at 5k updates/s: late frames under the feed, reference | — | 0 / 0 % |
| Market watch at 5k updates/s: late frames under the feed, throttled | — | 0 / 51 % |
| Market watch at 5k updates/s: update shown in (p50), reference | — | 14.5 / 18 ms |
| Market watch at 5k updates/s: update shown in (p50), throttled | — | 24.3 / 41 ms |
| Market watch at 5k updates/s: collection pauses in 10 s, reference | — | 4 / 54 pauses |
| Market watch at 5k updates/s: collection pauses in 10 s, throttled | — | 5 / 38.9 pauses |
| Market watch at 5k updates/s: work per frame (p95) under the feed, reference | — | 5.5 / 6.7 ms |
| Market watch at 5k updates/s: work per frame (p95) under the feed, throttled | — | 10.1 / 27.6 ms |

"Now" is each metric's newest local measurement: [2026-11-06-m10-d2-feed-market-watch-100](perf/results/2026-11-06-m10-d2-feed-market-watch-100.json), [2026-11-06-m10-d2-feed-market-watch-500](perf/results/2026-11-06-m10-d2-feed-market-watch-500.json), [2026-11-06-m10-d2-feed-market-watch-1k](perf/results/2026-11-06-m10-d2-feed-market-watch-1k.json), [2026-11-06-m10-d2-feed-market-watch-5k](perf/results/2026-11-06-m10-d2-feed-market-watch-5k.json). Generated by `just observatory report` from [`perf/budgets.json`](perf/budgets.json).
<!-- report:readme:market-watch-stops:end -->

Each run settles into its own frame scheduling, so a side's runs can differ more than their median suggests: GPUI's on a slow device drew a fast state in some runs and a slow one in the rest. The range of each side's runs, its fastest and slowest run's median update shown in, at each stop:

<!-- report:readme:market-watch-shown-range:start -->
| Metric | Budget | Now |
|---|---|---|
| Market watch at 100 updates/s: update shown in (p50), the fastest run, reference | — | 12.6 / 27.4 ms |
| Market watch at 100 updates/s: update shown in (p50), the fastest run, throttled | — | 15.3 / 23.8 ms |
| Market watch at 100 updates/s: update shown in (p50), the slowest run, reference | — | 14.2 / 28.5 ms |
| Market watch at 100 updates/s: update shown in (p50), the slowest run, throttled | — | 25.8 / 27.1 ms |
| Market watch at 500 updates/s: update shown in (p50), the fastest run, reference | — | 13.1 / 14.3 ms |
| Market watch at 500 updates/s: update shown in (p50), the fastest run, throttled | — | 15.1 / 23 ms |
| Market watch at 500 updates/s: update shown in (p50), the slowest run, reference | — | 14.5 / 15.7 ms |
| Market watch at 500 updates/s: update shown in (p50), the slowest run, throttled | — | 25.5 / 25.4 ms |
| Market watch at 1k updates/s: update shown in (p50), the fastest run, reference | — | 12.5 / 15.2 ms |
| Market watch at 1k updates/s: update shown in (p50), the fastest run, throttled | — | 15.6 / 24.8 ms |
| Market watch at 1k updates/s: update shown in (p50), the slowest run, reference | — | 14.2 / 16.1 ms |
| Market watch at 1k updates/s: update shown in (p50), the slowest run, throttled | — | 25.4 / 26.7 ms |
| Market watch at 5k updates/s: update shown in (p50), the fastest run, reference | — | 14.4 / 17.6 ms |
| Market watch at 5k updates/s: update shown in (p50), the fastest run, throttled | — | 21.5 / 39.1 ms |
| Market watch at 5k updates/s: update shown in (p50), the slowest run, reference | — | 14.7 / 18.5 ms |
| Market watch at 5k updates/s: update shown in (p50), the slowest run, throttled | — | 25.4 / 42.2 ms |

"Now" is each metric's newest local measurement: [2026-11-06-m10-d2-feed-market-watch-100](perf/results/2026-11-06-m10-d2-feed-market-watch-100.json), [2026-11-06-m10-d2-feed-market-watch-500](perf/results/2026-11-06-m10-d2-feed-market-watch-500.json), [2026-11-06-m10-d2-feed-market-watch-1k](perf/results/2026-11-06-m10-d2-feed-market-watch-1k.json), [2026-11-06-m10-d2-feed-market-watch-5k](perf/results/2026-11-06-m10-d2-feed-market-watch-5k.json). Generated by `just observatory report` from [`perf/budgets.json`](perf/budgets.json).
<!-- report:readme:market-watch-shown-range:end -->

Once, at the default stop (500 updates a second):

<!-- report:readme:market-watch:start -->
| Metric | Budget | Now |
|---|---|---|
| Market watch: time to first usable (500 updates/s), reference | — | 148.5 / 43.7 ms |
| Market watch: time to first usable (500 updates/s), throttled | — | 3592.1 / 499.4 ms |
| Market watch: first pixels (500 updates/s), reference | — | 36.1 / 45 ms |
| Market watch: first pixels (500 updates/s), throttled | — | 245.9 / 397.4 ms |
| Market watch: time to data (500 updates/s), reference | — | 184.2 / 197.3 ms |
| Market watch: time to data (500 updates/s), throttled | — | 1276.4 / 1314 ms |
| Market watch: memory once open, after GC (500 updates/s), reference | — | 32 / 3.8 MiB |
| Market watch: memory once open, after GC (500 updates/s), throttled | — | 31.4 / 3.6 MiB |
| Market watch: memory once the feed’s 10,000 ticks are drawn (JavaScript, after GC) (500 updates/s), reference | — | 12.6 / 4.7 MiB |
| Market watch: memory once the feed’s 10,000 ticks are drawn (JavaScript, after GC) (500 updates/s), throttled | — | 12.6 / 4.7 MiB |

"Now" is each metric's newest local measurement: [2026-11-06-m10-d2-usable-market-watch-500](perf/results/2026-11-06-m10-d2-usable-market-watch-500.json), [2026-11-06-m10-d2-data-market-watch-500](perf/results/2026-11-06-m10-d2-data-market-watch-500.json), [2026-11-06-m10-d2-memory-market-watch-500](perf/results/2026-11-06-m10-d2-memory-market-watch-500.json). Generated by `just observatory report` from [`perf/budgets.json`](perf/budgets.json).
<!-- report:readme:market-watch:end -->

## Canvas tradeoffs

Where the GPUI side falls short of a DOM table, said here and in the page's description below the window:

- **On touch, a swipe scrolls one axis.** GPUI's touch recognizer locks a pan to the axis it starts on and never unlocks it, so a diagonal swipe moves only one way, and when it picks the other axis the table feels stuck. TanStack's native scroller pans diagonally. It's in gpui core, not the table. Vertical and horizontal swipes and flings work.
- **DevTools' device mode draws it zoomed.** Chromium's emulation reports the canvas's device-pixel size at 1× under an emulated DPR, and gpui-pre-web trusts it, so the table draws a third the size at 3× zoom and touches outside that third do nothing. A real phone draws it normally (checked on an iPhone 13, Chrome and Safari). It's in gpui-pre-web, not the table.

The diagnosis: [`perf/results/2026-10-19-m5-a1-phone.md`](perf/results/2026-10-19-m5-a1-phone.md).

## Data credits

The tables' data are re-hosted copies of public data, rewritten as Parquet, and one file of the observatory's own ([`data/MANIFEST.json`](data/MANIFEST.json) pins each, with its source's terms as found):

- **Asteroids (Big file):** NASA/JPL Small-Body Database (JPL Solar System Dynamics), courtesy NASA/JPL-Caltech.
- **Daily highs (Wide sheet):** NOAA National Centers for Environmental Information, GHCN-Daily, version 3.35-upd-2026103117, under CC0 1.0. The file is cut from NOAA's data (the daily highs of 2025 with no quality flag, at stations with at least 300 such days), not NOAA's unaltered data, and NOAA endorses nothing here. Cite it as: Menne, M.J., I. Durre, B. Korzeniewski, S. McNeill, K. Thomas, X. Yin, S. Anthony, R. Ray, R.S. Vose, B.E. Gleason, and T.G. Houston, 2012: Global Historical Climatology Network - Daily (GHCN-Daily), Version 3.35. NOAA National Climatic Data Center. doi:10.7289/V5D21VHZ, accessed 2026-11-02.
- **Instruments (Market watch):** the observatory's own, fictional and synthetic: 50 made-up companies, their names, symbols, and price levels invented for the scenario (no symbol is listed on a US exchange; the build checks), dedicated to the public domain under CC0 1.0. The prices that move are a seeded feed's, not a market's.

The rules are the root [`CLAUDE.md`](../../CLAUDE.md)'s "Comparison protocol", and the decisions behind them are in the root [`docs/DECISIONS.md`](../../docs/DECISIONS.md). What's next is in [`PLAN.md`](PLAN.md).
