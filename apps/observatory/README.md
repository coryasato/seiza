# Observatory

> *Where the instruments are compared.*

**Live at [seiza.io/observatory](https://seiza.io/observatory/).** It also runs locally: `just observatory preview` after `gpui-build`, `tanstack-build`, and `build`.

The Observatory is seiza's comparison page. For each component in the repo, it runs the component, drawn by GPUI on a canvas from WebAssembly, against a DOM equivalent, and measures what each costs over a session of use. The first comparison is **GPUI | TanStack**: [the tall table](../../components/tall-table/) against React + TanStack Virtual, in four scenarios: **Big file**, all 1.57 M known asteroids; **Wide sheet**, a spreadsheet's shape, 10,632 weather stations by 365 days of daily highs as heat, at four densities; and **Market watch**, a trading screen, 50 made-up instruments whose prices a seeded feed updates in place, 100 to 5k times a second, each change flashing; and **Live tail**, a log tool's live view, NASA's web server log of July 1995 replayed into the table at 1k to 100k rows a second while the view follows the newest.

- **What it measures: use, not page load.** A data component is judged over a session: how soon it's usable, how long data takes to appear, how fast a scroll or a jump shows up, what a fling looks like, whether the last row is reachable, and what it costs in memory, CPU, and bytes. First pixels and bundle size are footnotes.
- **Only the UI differs:** both sides read the same file through the same engine (DuckDB-Wasm), with the same queries and the same paging numbers. Everything else is what each stack does best; the DOM side scrolls natively.
- **The same scope:** a comparison level is two builds with identical features; neither carries code the other lacks.
- **One at a time:** contenders run one at a time, each in its own frame, since two in one tab share a main thread and a GPU. The published numbers come from cold Playwright runs; what your browser measures is labelled warm.
- **Where TanStack wins, too:** the page's Compare panel shows the cold numbers for both devices, each card with its verdict, and says which side is lower, as this README does below.
- **What your tab reads, and what that costs:** the contender's window has a status bar (Ready in, Rows in, Smooth, Memory; on market watch and live tail, Shown in in place of Rows in; on live tail, a Pause / Follow button beside the dial) and a meter over its corner (frame time over 10 s, memory over a minute; open, a pill, or hidden). They show what your tab reads of the side you're using, labelled warm for a side loaded second or from the cache. They share the contender's main thread, so they're held to a budget: with the meter open, a fling's late frames and dropped or GPU frames stay within noise of the meter hidden, the page spends 0.3–0.4 ms per refresh on a fast machine and under 1.5 ms on a slow one, and it re-renders nothing in React mid-fling ([`perf/results/2026-10-21-m5-d4.md`](perf/results/2026-10-21-m5-d4.md)). The pill drops more compositor frames under throttling than the open meter does.

## Numbers

### Big file

The first comparison, the tall table over the asteroids, cold, median of 10, each value **GPUI / TanStack**. The rows are the per-use metrics, then the footnotes. How each is read: [`docs/contender-contract.md`](docs/contender-contract.md), "Reading the metrics"; the runs and what they showed: [`perf/results/2026-10-18-m4-b.md`](perf/results/2026-10-18-m4-b.md). They predate the TanStack contender's ARIA table semantics (its table, rows, header cells, and cells named by role, each row's place in the table), which weren't re-measured ([`docs/DECISIONS.md`](docs/DECISIONS.md), "TanStack contender").

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
| Footnote: bundle, brotli (GPUI's wasm / TanStack's first-paint JS and data layer) | — | 2770.2 / 108.6 KiB |
| Footnote: first pixels, reference | — | 37.8 / 42 ms |
| Footnote: first pixels, throttled, CPU 4× and Fast 4G | — | 244.5 / 390.7 ms |

"Now" is each metric's newest local measurement: [2026-10-19-m4-b-usable](perf/results/2026-10-19-m4-b-usable.json), [2026-10-18-m4-b-data](perf/results/2026-10-18-m4-b-data.json), [2026-10-18-m4-b-response](perf/results/2026-10-18-m4-b-response.json), [2026-10-19-m4-b-fling](perf/results/2026-10-19-m4-b-fling.json), [2026-10-18-m4-b-reach](perf/results/2026-10-18-m4-b-reach.json), [2026-10-19-m4-b-cost](perf/results/2026-10-19-m4-b-cost.json), [2026-10-20-m5-d1-memory](perf/results/2026-10-20-m5-d1-memory.json), [2026-11-05-m10-b3-sizes](perf/results/2026-11-05-m10-b3-sizes.json), [2026-11-09-m12-b1-tanstack-sizes](perf/results/2026-11-09-m12-b1-tanstack-sizes.json). Generated by `just observatory report` from [`perf/budgets.json`](perf/budgets.json).
<!-- report:readme:end -->

### Wide sheet

The tall table at its wide level (custom cells, the key columns pinned, density) on both sides, over GHCN-Daily's 2025 highs: Station and Place pinned, a day per column, each cell's heat on one diverging ramp. A dial sets how many cells are on screen (about 380, 570, 710, or 940: the row height, the text size, and the days' width, the same on both sides). Each value is **GPUI / TanStack**, cold, median of 10, on Chromium's gesture scroll. A side **keeps up** at a stop when at least 90% of the display's frames draw new cells in both the steady scroll down and the sideways one. How it's read: [`docs/contender-contract.md`](docs/contender-contract.md), "Reading the metrics"; the runs: [`perf/results/2026-11-03-m9-d.md`](perf/results/2026-11-03-m9-d.md). They were measured with the heat's first, two-stop ramp; the diverging ramp mixes one color per cell, as it did, and a spot check read the same ([`perf/results/2026-11-04-m9-e3b.md`](perf/results/2026-11-04-m9-e3b.md)). They predate the TanStack contender's ARIA table semantics (its table, rows, header cells, and cells named by role, each row's place in the table), which weren't re-measured ([`docs/DECISIONS.md`](docs/DECISIONS.md), "TanStack contender").

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

The tall table at its market level (custom cells, live re-reads, and number formats) on both sides, over 50 fictional instruments in twelve columns. The feed is synthetic: one seeded generator, run in a worker in each side's frame, sends every tick as the same bytes to either side, and each side folds every tick into its own store (JS objects, or Rust's plain buffers) before the table re-reads the rows that changed and draws once a frame; a changed Last, Bid, or Ask flashes. A dial sets the feed's rate: 100, 500, 1k, or 5k updates a second. Each value is **GPUI / TanStack**, cold, median of 10, with no input. A side **keeps up** at a stop when at least 90% of the batches with a visible tick are drawn in a frame of their own. **Update shown in** is a tick's send time in the worker to the first presented frame that draws it. How it's read: [`docs/contender-contract.md`](docs/contender-contract.md), "Reading the metrics"; the runs: [`perf/results/2026-11-06-m10-d2.md`](perf/results/2026-11-06-m10-d2.md). They predate the TanStack contender's ARIA table semantics (its table, rows, header cells, and cells named by role, each row's place in the table), which weren't re-measured ([`docs/DECISIONS.md`](docs/DECISIONS.md), "TanStack contender").

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

### Live tail

The tall table at its tail level (following the tail with live re-reads, custom cells, number formats, and the canvas's column widths) on both sides, over NASA's Kennedy Space Center web server log of July 1995: 1.89 M requests, each its time, request line, status, and bytes (the visitor's host dropped). The feed is a replay: one clock, run in a worker in each side's frame, posts the count of rows due about every 16 ms, and each side grows its table to the latest count once a frame while the view follows the newest row, every page read from the file through the same engine and SQL. Past the file's end the rows loop, each lap's times moved on by the file's span, so a 10-minute soak at 100k never runs out. A dial sets the rate: 1k, 10k, 50k, or 100k rows a second. Each value is **GPUI / TanStack**, cold, median of 10, with no input. **Row shown in** is a count's post in the worker to the first presented frame whose newest row reaches it; a side **keeps up** at a stop when its 95th percentile is at most 100 ms. **A scroll back** is a 300 px gesture up under the replay, the event to the first frame that moves (GPUI's read by a probe, TanStack's by Chromium's `EventLatency`); it lets go of the tail, and End, or scrolling back to the bottom, follows it again. How it's read: [`docs/contender-contract.md`](docs/contender-contract.md), "Reading the metrics"; the runs: [`perf/results/2026-11-08-m11-d2.md`](perf/results/2026-11-08-m11-d2.md). They predate the TanStack contender's ARIA table semantics (its table, rows, header cells, and cells named by role, each row's place in the table), which weren't re-measured ([`docs/DECISIONS.md`](docs/DECISIONS.md), "TanStack contender").

- **Where GPUI wins:** keeping up on a slow device, and in garbage. Both keep up at every stop on a fast device; on a slow one both keep up through 10k, and at 50k GPUI keeps up while TanStack misses by a little (its median 95th percentile just over the line, 3 of its 10 runs under it). A new row shows sooner on GPUI at 1k and 100k on a fast device and at 1k through 50k on a slow one. It spends a fraction of TanStack's time paused for garbage collection at every stop on both devices. Its HTML placeholder shell paints first pixels sooner.
- **Where TanStack wins:** a scroll back reaches the screen first at most stops, because the browser's compositor moves the content before the main thread hears of it. It's usable far sooner (its prerendered first screen hydrates while GPUI's wasm downloads), holds less memory (at 100,000 rows and after 10 minutes at 100k), downloads a fraction of GPUI's bytes, and on a slow device draws the clock's first count sooner.
- **Even:** work per frame at every stop on both devices; smoothness (no late frames on a fast device, under 1% on a slow one); the first count drawn on a fast device; and a new row's time to show at 10k and 50k on a fast device, where the two sides' runs overlap.
- **Neither, at 100k on a slow device:** in the replay's first seconds both trail the tail by over half a second. Over 10 minutes the lag shrinks (the soak's last window) but neither keeps up even then.

At each stop:

<!-- report:readme:live-tail-stops:start -->
| Metric | Budget | Now |
|---|---|---|
| Live tail at 1k rows/s: row shown in (p95; keeps up at ≤ 100 ms), reference | — | 26.1 / 27.7 ms |
| Live tail at 1k rows/s: row shown in (p95; keeps up at ≤ 100 ms), throttled | — | 47.2 / 57.9 ms |
| Live tail at 1k rows/s: row shown in (p50), reference | — | 17.6 / 19.5 ms |
| Live tail at 1k rows/s: row shown in (p50), throttled | — | 33.5 / 37.2 ms |
| Live tail at 1k rows/s: late frames under the replay, reference | — | 0 / 0 % |
| Live tail at 1k rows/s: late frames under the replay, throttled | — | 0 / 0 % |
| Live tail at 1k rows/s: work per frame (p95) under the replay, reference | — | 3.4 / 3.4 ms |
| Live tail at 1k rows/s: work per frame (p95) under the replay, throttled | — | 12.6 / 13 ms |
| Live tail at 1k rows/s: time paused in collections in 10 s, reference | — | 7.3 / 27 ms |
| Live tail at 1k rows/s: time paused in collections in 10 s, throttled | — | 26.9 / 101 ms |
| Live tail at 1k rows/s: a scroll back's first frame under the replay, reference | — | 16.4 / 7.4 ms |
| Live tail at 1k rows/s: a scroll back's first frame under the replay, throttled | — | 21.1 / 8.9 ms |
| Live tail at 10k rows/s: row shown in (p95; keeps up at ≤ 100 ms), reference | — | 31.2 / 33.1 ms |
| Live tail at 10k rows/s: row shown in (p95; keeps up at ≤ 100 ms), throttled | — | 59.3 / 75.4 ms |
| Live tail at 10k rows/s: row shown in (p50), reference | — | 20.8 / 21.6 ms |
| Live tail at 10k rows/s: row shown in (p50), throttled | — | 40.8 / 45.1 ms |
| Live tail at 10k rows/s: late frames under the replay, reference | — | 0 / 0 % |
| Live tail at 10k rows/s: late frames under the replay, throttled | — | 0.2 / 0 % |
| Live tail at 10k rows/s: work per frame (p95) under the replay, reference | — | 3.9 / 3.8 ms |
| Live tail at 10k rows/s: work per frame (p95) under the replay, throttled | — | 13.8 / 14.4 ms |
| Live tail at 10k rows/s: time paused in collections in 10 s, reference | — | 7.1 / 35.7 ms |
| Live tail at 10k rows/s: time paused in collections in 10 s, throttled | — | 35.6 / 125.1 ms |
| Live tail at 10k rows/s: a scroll back's first frame under the replay, reference | — | 17.3 / 11.5 ms |
| Live tail at 10k rows/s: a scroll back's first frame under the replay, throttled | — | 21 / 7.5 ms |
| Live tail at 50k rows/s: row shown in (p95; keeps up at ≤ 100 ms), reference | — | 33.8 / 38.7 ms |
| Live tail at 50k rows/s: row shown in (p95; keeps up at ≤ 100 ms), throttled | — | 79.8 / 101.7 ms |
| Live tail at 50k rows/s: row shown in (p50), reference | — | 25.3 / 26.3 ms |
| Live tail at 50k rows/s: row shown in (p50), throttled | — | 52.5 / 61.3 ms |
| Live tail at 50k rows/s: late frames under the replay, reference | — | 0 / 0 % |
| Live tail at 50k rows/s: late frames under the replay, throttled | — | 0 / 0.2 % |
| Live tail at 50k rows/s: work per frame (p95) under the replay, reference | — | 3.7 / 3.9 ms |
| Live tail at 50k rows/s: work per frame (p95) under the replay, throttled | — | 14.2 / 14.7 ms |
| Live tail at 50k rows/s: time paused in collections in 10 s, reference | — | 8.9 / 41 ms |
| Live tail at 50k rows/s: time paused in collections in 10 s, throttled | — | 43.6 / 126.3 ms |
| Live tail at 50k rows/s: a scroll back's first frame under the replay, reference | — | 17.8 / 11.6 ms |
| Live tail at 50k rows/s: a scroll back's first frame under the replay, throttled | — | 22.9 / 6.8 ms |
| Live tail at 100k rows/s: row shown in (p95; keeps up at ≤ 100 ms), reference | — | 44.8 / 49.2 ms |
| Live tail at 100k rows/s: row shown in (p95; keeps up at ≤ 100 ms), throttled | — | 815.9 / 843.3 ms |
| Live tail at 100k rows/s: row shown in (p50), reference | — | 31.6 / 33.2 ms |
| Live tail at 100k rows/s: row shown in (p50), throttled | — | 699.2 / 756.7 ms |
| Live tail at 100k rows/s: late frames under the replay, reference | — | 0 / 0 % |
| Live tail at 100k rows/s: late frames under the replay, throttled | — | 0 / 0.6 % |
| Live tail at 100k rows/s: work per frame (p95) under the replay, reference | — | 3.5 / 3.7 ms |
| Live tail at 100k rows/s: work per frame (p95) under the replay, throttled | — | 14.5 / 14.8 ms |
| Live tail at 100k rows/s: time paused in collections in 10 s, reference | — | 10.1 / 44.5 ms |
| Live tail at 100k rows/s: time paused in collections in 10 s, throttled | — | 49 / 128.6 ms |
| Live tail at 100k rows/s: a scroll back's first frame under the replay, reference | — | 18.5 / 11.8 ms |
| Live tail at 100k rows/s: a scroll back's first frame under the replay, throttled | — | 22.2 / 14.6 ms |

"Now" is each metric's newest local measurement: [2026-11-08-m11-d2-tail-live-tail-1k](perf/results/2026-11-08-m11-d2-tail-live-tail-1k.json), [2026-11-08-m11-d2-tail-live-tail-10k](perf/results/2026-11-08-m11-d2-tail-live-tail-10k.json), [2026-11-08-m11-d2-tail-live-tail-50k](perf/results/2026-11-08-m11-d2-tail-live-tail-50k.json), [2026-11-08-m11-d2-tail-live-tail-100k](perf/results/2026-11-08-m11-d2-tail-live-tail-100k.json). Generated by `just observatory report` from [`perf/budgets.json`](perf/budgets.json).
<!-- report:readme:live-tail-stops:end -->

A side is called faster only where its runs and the other's don't overlap. The range of each side's runs, its fastest and slowest run's median row shown in and scroll back, at each stop:

<!-- report:readme:live-tail-ranges:start -->
| Metric | Budget | Now |
|---|---|---|
| Live tail at 1k rows/s: row shown in (p50), the fastest run, reference | — | 14.8 / 19 ms |
| Live tail at 1k rows/s: row shown in (p50), the fastest run, throttled | — | 32.7 / 35.3 ms |
| Live tail at 1k rows/s: row shown in (p50), the slowest run, reference | — | 18.4 / 20 ms |
| Live tail at 1k rows/s: row shown in (p50), the slowest run, throttled | — | 34.7 / 37.9 ms |
| Live tail at 1k rows/s: a scroll back's first frame, the fastest run, reference | — | 12.8 / 1.1 ms |
| Live tail at 1k rows/s: a scroll back's first frame, the fastest run, throttled | — | 19.4 / 3.4 ms |
| Live tail at 1k rows/s: a scroll back's first frame, the slowest run, reference | — | 19.5 / 12.3 ms |
| Live tail at 1k rows/s: a scroll back's first frame, the slowest run, throttled | — | 24.9 / 15.8 ms |
| Live tail at 10k rows/s: row shown in (p50), the fastest run, reference | — | 18.9 / 20.7 ms |
| Live tail at 10k rows/s: row shown in (p50), the fastest run, throttled | — | 34.6 / 44.4 ms |
| Live tail at 10k rows/s: row shown in (p50), the slowest run, reference | — | 21.1 / 22.2 ms |
| Live tail at 10k rows/s: row shown in (p50), the slowest run, throttled | — | 43.1 / 45.9 ms |
| Live tail at 10k rows/s: a scroll back's first frame, the fastest run, reference | — | 15.8 / 1.7 ms |
| Live tail at 10k rows/s: a scroll back's first frame, the fastest run, throttled | — | 18 / 1.5 ms |
| Live tail at 10k rows/s: a scroll back's first frame, the slowest run, reference | — | 23.7 / 13.3 ms |
| Live tail at 10k rows/s: a scroll back's first frame, the slowest run, throttled | — | 24.2 / 14.6 ms |
| Live tail at 50k rows/s: row shown in (p50), the fastest run, reference | — | 24.4 / 25.7 ms |
| Live tail at 50k rows/s: row shown in (p50), the fastest run, throttled | — | 49.4 / 58.9 ms |
| Live tail at 50k rows/s: row shown in (p50), the slowest run, reference | — | 26.2 / 27.4 ms |
| Live tail at 50k rows/s: row shown in (p50), the slowest run, throttled | — | 54.8 / 63.3 ms |
| Live tail at 50k rows/s: a scroll back's first frame, the fastest run, reference | — | 16.1 / 3.6 ms |
| Live tail at 50k rows/s: a scroll back's first frame, the fastest run, throttled | — | 19.9 / 4 ms |
| Live tail at 50k rows/s: a scroll back's first frame, the slowest run, reference | — | 22.2 / 16.6 ms |
| Live tail at 50k rows/s: a scroll back's first frame, the slowest run, throttled | — | 33.8 / 17 ms |
| Live tail at 100k rows/s: row shown in (p50), the fastest run, reference | — | 30.6 / 33 ms |
| Live tail at 100k rows/s: row shown in (p50), the fastest run, throttled | — | 486.6 / 651.2 ms |
| Live tail at 100k rows/s: row shown in (p50), the slowest run, reference | — | 31.7 / 33.9 ms |
| Live tail at 100k rows/s: row shown in (p50), the slowest run, throttled | — | 884.6 / 928 ms |
| Live tail at 100k rows/s: a scroll back's first frame, the fastest run, reference | — | 14.3 / 4.1 ms |
| Live tail at 100k rows/s: a scroll back's first frame, the fastest run, throttled | — | 15.9 / 3.1 ms |
| Live tail at 100k rows/s: a scroll back's first frame, the slowest run, reference | — | 22.8 / 14 ms |
| Live tail at 100k rows/s: a scroll back's first frame, the slowest run, throttled | — | 35 / 17.3 ms |

"Now" is each metric's newest local measurement: [2026-11-08-m11-d2-tail-live-tail-1k](perf/results/2026-11-08-m11-d2-tail-live-tail-1k.json), [2026-11-08-m11-d2-tail-live-tail-10k](perf/results/2026-11-08-m11-d2-tail-live-tail-10k.json), [2026-11-08-m11-d2-tail-live-tail-50k](perf/results/2026-11-08-m11-d2-tail-live-tail-50k.json), [2026-11-08-m11-d2-tail-live-tail-100k](perf/results/2026-11-08-m11-d2-tail-live-tail-100k.json). Generated by `just observatory report` from [`perf/budgets.json`](perf/budgets.json).
<!-- report:readme:live-tail-ranges:end -->

Once, at the default stop (10k rows a second), and the soak (10 minutes at 100k, median of 3). Time to data here is the clock's first count to the frame that draws it; the log downloads whole before the clock starts (about 160 ms on a fast device, 11.3 s on Fast 4G, the same file on both sides):

<!-- report:readme:live-tail:start -->
| Metric | Budget | Now |
|---|---|---|
| Live tail: time to first usable (10k rows/s), reference | — | 144.8 / 43.6 ms |
| Live tail: time to first usable (10k rows/s), throttled | — | 3596 / 499.9 ms |
| Live tail: first pixels (10k rows/s), reference | — | 34.6 / 40.1 ms |
| Live tail: first pixels (10k rows/s), throttled | — | 249.2 / 391.7 ms |
| Live tail: memory once open, after GC (10k rows/s), reference | — | 28.9 / 3.1 MiB |
| Live tail: memory once open, after GC (10k rows/s), throttled | — | 29 / 3.1 MiB |
| Live tail: memory once 100,000 rows are drawn (JavaScript, after GC) (10k rows/s), reference | — | 19.2 / 10.9 MiB |
| Live tail: memory once 100,000 rows are drawn (JavaScript, after GC) (10k rows/s), throttled | — | 19.2 / 10.9 MiB |
| Live tail: the clock's first count to its frame (10k rows/s), reference | — | 59 / 54.5 ms |
| Live tail: the clock's first count to its frame (10k rows/s), throttled | — | 121.5 / 73.6 ms |
| Live tail: memory after 10 minutes at 100k rows/s (JavaScript, less the canvas), reference | — | 99.7 / 82.1 MiB |
| Live tail: memory after 10 minutes at 100k rows/s (JavaScript, less the canvas), throttled | — | 97 / 79.5 MiB |
| Live tail: row shown in (p95) in the soak's first window at 100k rows/s, reference | — | 43.1 / 51.5 ms |
| Live tail: row shown in (p95) in the soak's first window at 100k rows/s, throttled | — | 719 / 852.3 ms |
| Live tail: row shown in (p95) after 10 minutes at 100k rows/s, reference | — | 44.9 / 51.1 ms |
| Live tail: row shown in (p95) after 10 minutes at 100k rows/s, throttled | — | 141.6 / 192 ms |

"Now" is each metric's newest local measurement: [2026-11-09-m11-d2-usable-live-tail-10k](perf/results/2026-11-09-m11-d2-usable-live-tail-10k.json), [2026-11-09-m11-d2-memory-live-tail-10k](perf/results/2026-11-09-m11-d2-memory-live-tail-10k.json), [2026-11-09-m11-d2-data-live-tail-10k](perf/results/2026-11-09-m11-d2-data-live-tail-10k.json), [2026-11-08-m11-d2-soak-live-tail-100k](perf/results/2026-11-08-m11-d2-soak-live-tail-100k.json). Generated by `just observatory report` from [`perf/budgets.json`](perf/budgets.json).
<!-- report:readme:live-tail:end -->

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
- **Web server logs (Live tail):** NASA-HTTP, the Kennedy Space Center's web server log of July 1995, collected by Jim Dumoulin of NASA's Kennedy Space Center and contributed by Martin Arlitt and Carey Williamson of the University of Saskatchewan, from the Internet Traffic Archive, whose terms say "The traces may be freely redistributed." The archive asks that nothing be analyzed beyond general traffic patterns: the file keeps each request's time, request line, status, and bytes, drops the visitor's host, cuts every query string, and drops a request holding `@` (mostly e-mail addresses) or for a `~` path the server didn't serve ([`docs/DECISIONS.md`](docs/DECISIONS.md), "Scenarios"). The feed is a replay of the log, looped past its end.
- **Countries (Admin table):** the region names (each in its region's likely language and in English) and the populations from the Unicode Common Locale Data Repository (CLDR) 49, under the Unicode License v3, its notice below; the capitals from Wikidata, under CC0 1.0. The flags are drawn from each region's code; the populations are rounded to the table's text.

<details>
<summary>CLDR's copyright and permission notice (the Unicode License v3), as it ships with the data</summary>

```
COPYRIGHT AND PERMISSION NOTICE

Copyright © 2001–2026 Unicode, Inc.

Unicode Technical Standard #35, Unicode Locale Data Markup Language
(LDML) made available in this repository is protected by copyright, and
permission must be obtained from Unicode, Inc. prior to any
reproduction, modification, or other use not permitted by the Unicode
Terms of Use <https://www.unicode.org/copyright.html>. Specifically, you
may make copies of this publication and may annotate and translate it
solely for personal or internal business purposes and not for public
distribution, provided that any such permitted copies and modifications
fully reproduce all copyright and other legal notices contained in the
original. You may not make copies of or modifications to this
publication for public distribution, or incorporate it in whole or in
part into any product or publication without the express written
permission of Unicode. Notwithstanding the foregoing, you may within
this repository provide comments and propose changes to this standard
and may make copies/forks solely for such purposes provided that you
reproduce this copyright notice and these terms of use in any such
copy/fork.

All other content in this repo is released under UNICODE LICENSE V3

NOTICE TO USER: Carefully read the following legal agreement. BY
DOWNLOADING, INSTALLING, COPYING OR OTHERWISE USING DATA FILES, AND/OR
SOFTWARE, YOU UNEQUIVOCALLY ACCEPT, AND AGREE TO BE BOUND BY, ALL OF THE
TERMS AND CONDITIONS OF THIS AGREEMENT. IF YOU DO NOT AGREE, DO NOT
DOWNLOAD, INSTALL, COPY, DISTRIBUTE OR USE THE DATA FILES OR SOFTWARE.

Permission is hereby granted, free of charge, to any person obtaining a
copy of data files and any associated documentation (the "Data Files") or
software and any associated documentation (the "Software") to deal in the
Data Files or Software without restriction, including without limitation
the rights to use, copy, modify, merge, publish, distribute, and/or sell
copies of the Data Files or Software, and to permit persons to whom the
Data Files or Software are furnished to do so, provided that either (a)
this copyright and permission notice appear with all copies of the Data
Files or Software, or (b) this copyright and permission notice appear in
associated Documentation.

THE DATA FILES AND SOFTWARE ARE PROVIDED "AS IS", WITHOUT WARRANTY OF ANY
KIND, EXPRESS OR IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF
MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT OF
THIRD PARTY RIGHTS.

IN NO EVENT SHALL THE COPYRIGHT HOLDER OR HOLDERS INCLUDED IN THIS NOTICE
BE LIABLE FOR ANY CLAIM, OR ANY SPECIAL INDIRECT OR CONSEQUENTIAL DAMAGES,
OR ANY DAMAGES WHATSOEVER RESULTING FROM LOSS OF USE, DATA OR PROFITS,
WHETHER IN AN ACTION OF CONTRACT, NEGLIGENCE OR OTHER TORTIOUS ACTION,
ARISING OUT OF OR IN CONNECTION WITH THE USE OR PERFORMANCE OF THE DATA
FILES OR SOFTWARE.

Except as contained in this notice, the name of a copyright holder shall
not be used in advertising or otherwise to promote the sale, use or other
dealings in these Data Files or Software without prior written
authorization of the copyright holder.

SPDX-License-Identifier: Unicode-3.0
```

</details>

The rules are the root [`CLAUDE.md`](../../CLAUDE.md)'s "Comparison protocol", and the decisions behind them are in the root [`docs/DECISIONS.md`](../../docs/DECISIONS.md). What's next is in [`PLAN.md`](PLAN.md).
