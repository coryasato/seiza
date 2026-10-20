# Observatory

> *Where the instruments are compared.*

**Being built.** The page and both contenders run locally (`just observatory preview` after `gpui-build`, `tanstack-build`, and `build`); it will live at `seiza.io/observatory`.

The Observatory is seiza's comparison page. For each component in the repo, it runs the component, drawn by GPUI on a canvas from WebAssembly, against a DOM equivalent, and measures what each costs over a session of use. The first comparison is **GPUI | TanStack**: [the tall table](../../components/tall-table/) against React + TanStack Virtual, over all 1.57 M known asteroids.

- **What it measures: use, not page load.** A data component is judged over a session: how soon it's usable, how long data takes to appear, how fast a scroll or a jump shows up, what a fling looks like, whether the last row is reachable, and what it costs in memory, CPU, and bytes. First pixels and bundle size are footnotes.
- **Only the UI differs:** both sides read the same file through the same engine (DuckDB-Wasm), with the same queries and the same paging numbers. Everything else is what each stack does best; the DOM side scrolls natively.
- **The same scope:** a comparison level is two builds with identical features; neither carries code the other lacks.
- **One at a time:** contenders run one at a time, each in its own frame, since two in one tab share a main thread and a GPU. The published numbers come from cold Playwright runs; what your browser measures is labelled warm.
- **Where TanStack wins, too:** each of the page's cards says which side is lower, as this README does below. Under the cold numbers the page shows what your tab reads of the side you're using (its marks, its frames while you scroll, its memory), labelled live and, for a side loaded second or from the cache, warm.

## Numbers

The first comparison, the tall table, cold, median of 10, each value **GPUI / TanStack**. The rows are the per-use metrics, then the footnotes. How each is read: [`docs/contender-contract.md`](docs/contender-contract.md), "Reading the metrics"; the runs and what they showed: [`perf/results/2026-10-18-m4-b.md`](perf/results/2026-10-18-m4-b.md).

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
| Footnote: bundle, brotli (GPUI's wasm / TanStack's first-paint JS and data layer) | — | 2695.7 / 106.9 KiB |
| Footnote: first pixels, reference | — | 37.8 / 42 ms |
| Footnote: first pixels, throttled, CPU 4× and Fast 4G | — | 244.5 / 390.7 ms |

"Now" is each metric's newest local measurement: [2026-10-19-m4-b-usable](perf/results/2026-10-19-m4-b-usable.json), [2026-10-18-m4-b-data](perf/results/2026-10-18-m4-b-data.json), [2026-10-18-m4-b-response](perf/results/2026-10-18-m4-b-response.json), [2026-10-19-m4-b-fling](perf/results/2026-10-19-m4-b-fling.json), [2026-10-18-m4-b-reach](perf/results/2026-10-18-m4-b-reach.json), [2026-10-19-m4-b-cost](perf/results/2026-10-19-m4-b-cost.json), [2026-10-20-m5-d1-memory](perf/results/2026-10-20-m5-d1-memory.json), [2026-10-18-m4-b-sizes](perf/results/2026-10-18-m4-b-sizes.json), [2026-10-18-m4-b-tanstack-sizes](perf/results/2026-10-18-m4-b-tanstack-sizes.json). Generated by `just observatory report` from [`perf/budgets.json`](perf/budgets.json).
<!-- report:readme:end -->

## Canvas tradeoffs

Where the GPUI side falls short of a DOM table, said here and in the page's description below the window:

- **On touch, a swipe scrolls one axis.** GPUI's touch recognizer locks a pan to the axis it starts on and never unlocks it, so a diagonal swipe moves only one way, and when it picks the other axis the table feels stuck. TanStack's native scroller pans diagonally. It's in gpui core, not the table. Vertical and horizontal swipes and flings work.
- **DevTools' device mode draws it zoomed.** Chromium's emulation reports the canvas's device-pixel size at 1× under an emulated DPR, and gpui-pre-web trusts it, so the table draws a third the size at 3× zoom and touches outside that third do nothing. A real phone draws it normally (checked on an iPhone 13, Chrome and Safari). It's in gpui-pre-web, not the table.

The diagnosis: [`perf/results/2026-10-19-m5-a1-phone.md`](perf/results/2026-10-19-m5-a1-phone.md).

The rules are the root [`CLAUDE.md`](../../CLAUDE.md)'s "Comparison protocol", and the decisions behind them are in the root [`docs/DECISIONS.md`](../../docs/DECISIONS.md). What's next is in [`PLAN.md`](PLAN.md).
