# The late frames in the throttled wide fling (2026-11-17)

Measured on Apple M1, Darwin 25.6.0 arm64, machine `local`, Chromium headless=new, 1440×900 at DPR 2, cold, throttled (CPU 4×, Fast 4G), the wide shape, 20 runs a build, the builds run in turn with the order reversed every round (root CLAUDE.md, "Measurement protocol"). Load average 3.08 → 2.43. The table at `ab3a880`, unchanged.

Raw: `2026-11-17-late-frames.json` (`just tall-table late`: every run's late intervals with their parts, every main frame's work, the timer tasks, and the summary).

## The question

`PLAN.md`'s open question since M4 part D: a build with a feature read more late frames than the base in the throttled wide fling (`follow` ~8% against ~3.5%, `resize` 5.1 against 2.0, `select` 4.1 against 2.75; `pin` didn't), with the same work per frame, busy time, and placeholders, and nothing in either feature's code on that path to explain it. It asked for a trace comparison of the two builds' slow frames.

## What changed

- **The measurement:** `perf/late.ts` (`just tall-table late`). Kept builds are served side by side and run in turn, each run as `perf.ts` runs its fling (the steady scroll, Home, then the fling traced on its own, `workRecorder` and `frameRecorder` installed). Each late rAF interval (over 25 ms) is read against the trace: the main frame that ran in the rAF before it, the tasks outside any frame in the interval, and what's left. Its cause is the first that holds: `long` (the frame worked longer than a refresh), `outside` (it fit a refresh, and with the tasks outside it didn't), `idle` (neither). The timer tasks outside frames (GPUI's spawned tasks: a page's read and landing) are counted and timed. `--cpu` samples the CPU (CDP's profiler, 250 µs) and names the functions inside them.
- **No change to the table or the host.** No wasm changed.

## The three builds

| | Base | `follow` | `resize` |
|---|---|---|---|
| Late frames, median (IQR; range) | 4.1% (2.5–5.7; 0–7.9) | 5.2% (4.1–6.7; 0–10.9) | 5.2% (3.7–6.8; 0–9.1) |
| Late intervals, 20 runs | 150 | 204 | 194 |
| … a frame that fit, with tasks outside it | 116 (77%) | 151 (74%) | 158 (81%) |
| … a frame longer than a refresh | 20 (13%) | 38 (19%) | 27 (14%) |
| … idle | 14 (9%) | 15 (7%) | 9 (5%) |
| Work a frame, p50 / p95 | 12.8 / 18.9 ms | 12.8 / 19.0 | 13.5 / 19.6 |
| Timer tasks outside frames a run | 176 | 152.5 | 167 |
| … each, p50 / p95 | 4.29 / 8.98 ms | 5.63 / 10.52 | 4.31 / 8.84 |
| … each run's p50, range | 4.14–4.52 | 5.41–5.80 | 4.13–4.46 |
| … in all, a run | 822 ms | 899 | 774 |
| Runs that drew on half their frames | 4 | 3 | 3 |

Every run reached the last row, filled; no failures.

**What a late frame is.** In every build, three in four late intervals follow a frame that fit the refresh: ~14.3 ms of work (14.2–14.8 across the builds) with ~12.6 ms of tasks outside any frame in the same interval (12.4–13.1), together past 16.7 ms. Of those tasks' time in the late intervals, 98–99% is timer tasks (`TimerBase::run`); GC is under 0.2%. All but 8 of the 548 late intervals are one missed refresh (33.3 ms).

**What the timer tasks are** (`--cpu`, a build with names kept, two runs a build): 96% of their time is `<tall_table_host::rows::MemoryRows as TallTableDelegate>::load_page`'s task, the bare host's source building a 1,024-row page of 500 floats, on the main thread. The table's landing (`update_entity` on `TallTableState`: the cache's insert and evict, the drop of the page it pushes out) is 3% (22.5 ms a run in the base, 23.0 in `follow`).

**The long frames** (13–19% of the late intervals) work ~19 ms, 95% of it in the rAF callback (GPUI's draw); half to two-thirds of them show a placeholder row.

**`follow`'s build differs in one number, and it's the host's.** Its timer tasks take 5.63 ms at p50 against 4.29, in every run (the two ranges don't meet). The profile puts all of it in the host's `load_page` task (814 ms a run against 662; the table's landing the same): with `live` built, which `follow` turns on, the host's source keys every row by its version (`rows.rs`, `versioned`, a `Vec` of keys a page). A longer task beside a frame pushes more frames past the refresh. `resize`'s tasks are the base's; its frames work ~0.7 ms more at p50 throttled (the bands), on a frame ~2.3 ms under the refresh with a task beside it.

**Two kinds of run.** About one run in six, in every build (10 of 60), draws on half its frames (work p50 ~1 ms, ~2.4 s busy against ~2.7) and reads 0–2% late; the rest read 1.5–10.9%. A median of 10 moves by points with how many of those it holds. Why a run falls in one or the other wasn't looked into: it's the same in every build.

## The answer

- **It isn't either feature's code in the table, and it isn't the slow frames.** Late frames in the bare host's throttled wide fling are the host's own page reads on the main thread landing beside a frame that fit. The table's share of those tasks is 3%, the same with `follow` built.
- **The builds differ by about a point** (4.1% against 5.2%), inside each other's spread at 20 runs each (a `follow` or `resize` run reads higher than a base run 65% of the time). The earlier gaps (8 against 3.5; 5.1 against 2.0) were medians of 10 over runs of two kinds; what's left of them is `follow`'s slower page in the host's source, and `resize`'s ~0.7 ms.
- **A host that reads its pages off the main thread doesn't have these tasks.** An app adopting `follow` measures its own fling; nothing here stands against it. The question is closed.

## Experiments and controls

- **Trial runs while the script was written** (1–2 a build, load 2.2–5.4, not counted): the same causes, 3–12% late in both the base and `follow`.
- **The profiler slows the page:** the two `--cpu` runs a build attribute the work and aren't in the table above (late 7.3–7.8% base, 4.5–8.5% `follow`; the timer tasks' p50 as without it, 4.4 and 5.8 ms).
- **A named wasm under the shipped page fails:** the release profile strips names, and a build that keeps them (`CARGO_PROFILE_RELEASE_STRIP=false`, wasm-opt `-g`) has other closure names in its bindings, so it's bundled whole (`late.ts`'s header).
- **Not looked into:** the narrow shape and the reference profile (neither showed the difference), `select` (its gap was the smallest), and what puts a run in the half-drawn kind.

## Reproducing it

```sh
# Each build kept aside (gitignored):
just tall-table build          && cp -R components/tall-table/host/web/dist components/tall-table/perf/results/raw/late-builds/base
just tall-table build follow   && cp -R components/tall-table/host/web/dist components/tall-table/perf/results/raw/late-builds/follow
just tall-table build resize   && cp -R components/tall-table/host/web/dist components/tall-table/perf/results/raw/late-builds/resize
just tall-table late --builds base,follow,resize --runs 20 --label late-frames
```
