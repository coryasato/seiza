# PLAN.md — Observatory

What's next for the Observatory: milestone status, the active milestone's "done when" checks, long-term goals, and open questions. Only what's still open lives here. The rules are the root `CLAUDE.md`'s, its "Comparison protocol" above all; this app's own are in its [`CLAUDE.md`](CLAUDE.md).

**Goal:** one page, at `seiza.io/observatory`, that runs each component against a DOM equivalent and shows with measured numbers what each costs over a session of use: opening data, scrolling, flinging, jumping. The first comparison is GPUI | TanStack: the tall table ([`components/tall-table/`](../../components/tall-table/), at `seiza.io/observatory/tall-table`) against React + TanStack Virtual, on the same engine and the same file.

**Deciding metrics:** per-use cost, as the root `CLAUDE.md`'s "Comparison protocol" defines it (time to first usable, time to data, input to visible response, behavior under load, reach and correctness, cost). One-time costs (first pixels, bundle size) are footnotes. TTFP still gates each contender's own build (root rule 1).

**Where everything else lives:** the decisions so far are repo-wide, in the root [`docs/DECISIONS.md`](../../docs/DECISIONS.md) ("Comparison protocol", "Hosting", "Repo structure"). This app's own context and rules are in [`CLAUDE.md`](CLAUDE.md), its decisions in [`docs/DECISIONS.md`](docs/DECISIONS.md).

---

## Status

| Milestone | Title | Status |
|---|---|---|
| M0 | Groundwork: the app, its data file, and static hosting (parts A–B) | Done 2026-10-14 ([`docs/milestones.md`](docs/milestones.md)) |
| M1 | Spikes: the DOM scroll model and the input-latency method (parts A–B) | Done 2026-10-15 ([`docs/milestones.md`](docs/milestones.md)) |
| M2 | The GPUI contender and the fixtures (parts A–C) | Active |
| M3 | The TanStack contender (parts A–D) | Not started |
| M4 | The numbers: cold runs of both contenders (parts A–B) | Not started |
| M5 | The observatory page, deployed (parts 0, A–C) | Not started |
| M6 | Split mode | Not started |
| M7 | The benchmark button | Not started |

**Parts are sized to one working session.** Each ends with its own checks passing and its evidence written down, so the next session starts from this file, not from the last one's context. A part that grows past a session splits before it's started, not halfway through.

**Closing a milestone:** as for every app (root `CLAUDE.md`, "Working agreements"): every "done when" check passes; the numbers are in `perf/results/` with a note; new decisions are in `docs/DECISIONS.md` (repo-wide ones in the root's); a `docs/LESSONS.md` entry is written; and the milestone's spec and evidence move from here to `docs/milestones.md`, leaving one row above.

**Component and engine changes:** the observatory consumes the tall table and the DuckDB engine; it doesn't reshape them (root `docs/DECISIONS.md`, "Repo structure"). The changes it needs, all listed here: `Paging` gains the two settle times (M2 part A, the one change to the table's internals, defaults unchanged), the table's fixtures and their native tests (M2 part C), `@seiza/duckdb` takes its extension directory as an option (done, M0 part A), and `seiza` gains a `panel` feature (on by default) while its title bar and theme toggle move to Tycho, with the Mac input bindings opt-in (M2 part A), and `seiza::targets` (publishing a control's bounds) moves there from Tycho, as do Tycho's first-draw probe and placeholder screenshot match to `shared-web/perf/` (M2 part B). Each records its effect on Tycho.

---

## Active milestone

### M2: The GPUI contender and the fixtures

**Part A: the shared changes, measured on Tycho.**
- [x] `seiza` has a `panel` feature, on by default, and no title bar or theme toggle: those are Tycho's; Tycho looks and behaves the same, and its size effect is recorded. *Done 2026-10-16 (reworded from "`shell` and `panel` features; Tycho's wasm is byte-identical": the title bar moved to Tycho instead, and no change to `seiza`'s features leaves Tycho's bytes alone; root `docs/DECISIONS.md`, "Shell and input"):* `just tycho placeholder` passes (the first frame against the placeholder in light and dark, DPR 2 and 1; the theme toggle's button, shortcuts, system changes, and reload); the Mac input bindings are opt-in (`Bootstrap::mac_input_bindings`), measured on a bare host: +991 B raw with the call, none without; clippy clean on wasm32 and native, with and without `panel`. Evidence: Tycho's `perf/results/2026-10-16-observatory-m2-a.md`.
- [x] `Paging` has `scroll_settle` (250 ms) and `drag_settle` (80 ms), read where `SCROLL_SETTLE` and `DRAG_SETTLE` are today; Tycho's table checks pass and its size effect is recorded. *Done 2026-10-16:* `just tycho table` passes on the final build, reference and throttled (jump to 90% 83.3 / 2205.2 ms, fling p95 16.7 / 33.3 ms, none over 50 ms, last row = `count(*)`); the settle fields add 1.2 KB raw after wasm-opt, part A as a whole +2.3 KB (+0.02%). `just tycho check` fails reference TTFP (219.9 vs 214.8 ms, load 5–7): HEAD's own medians in the interleaved A/Bs were 215–221 ms, the throttled A/B resolved +0.3%, and the reference A/B was too noisy to resolve. Accepted as machine load (other work on the machine); M4 measures both contenders under the protocol. Evidence: Tycho's `perf/results/2026-10-16-observatory-m2-a.md`.

**Part B: the bare page.** A minimal host of `seiza-tall-table` with `seiza-duckdb`'s `tall-table` adapter, `seiza` without `panel`, the engine from `/observatory/duckdb/`, the data file from its static path. To turn `seiza`'s defaults off, the workspace's `seiza` entry needs `default-features = false` (Cargo ignores a member's opt-out when the workspace entry keeps defaults on), and Tycho then names `features = ["panel"]`. A bare host's floor, measured: 2.50 MiB brotli (an empty view on `seiza` without `panel`; Tycho's results note).
- [x] It opens the file and reaches the last row, which equals `count(*)`, and publishes M1's contract. *Done 2026-10-16:* `just observatory reach`: native DuckDB's `count(*)` 1,567,523 = `state.rows`; End shows rows 1,567,495–1,567,523, all loaded, `lastCell` 54657680, the file's last spkid; first-pixels ≤ usable ≤ open < filled, each filled mark right after a presented frame; state and targets only with `?measure`; `jump(0.9)`, `open()`, and `fling()` resolve where they should; the marks reach a framing page by `postMessage`. Evidence: `perf/results/2026-10-16-m2-b.md`.
- [x] Built alone (`-p`); its wasm with and without `panel` recorded; a size check fails if a feature leaks in through Cargo's unification. *Done 2026-10-16:* 2,695.4 KiB brotli without the panel, 2,706.1 with it; `just observatory sizes` fails if Cargo enables `panel` for the contender alone or the shipped wasm holds the panel's global, each with a control that does (built with Tycho; built with `seiza/panel`). Evidence: `perf/results/2026-10-16-m2-b-sizes.json`.
- [x] Its placeholder shell matches its first frame; `perf/budgets.json` and `perf/baseline.json` hold its TTFP and wasm budgets, and `just observatory check` passes. *Done 2026-10-16:* the match passes light and dark at DPR 2 and 1, and its seven negative controls fail it; baseline reference TTFP 170.5 ms (throttled 3,502.5), wasm 2,695.4 KiB; `just observatory check` passes (TTFP 164.3 ms vs the 187.6 ms limit, load 4–11; after the code review's fixes, 180.8 ms, load 3–5). The shared changes leave Tycho's wasm within build jitter, and `just tycho check` and `just tycho placeholder` pass (Tycho's `perf/results/2026-10-16-observatory-m2-b.md`). Evidence: `perf/results/2026-10-16-m2-b.md`.

**Part C: the fixtures**, in `components/tall-table/fixtures/`, each with a negative control, run by native tests inside the crate.
- [ ] Paging: scroll, jump, rest, and drag steps → the page requests in order, the settle times included.
- [ ] Cells: values from each float column of the data file and each column's budget, pinned from the GPUI contender's `ColumnProbe` → the shown text.
- [ ] Page SQL and the summary queries.

---

## Next milestones

The "done when" checks are drafts until their milestone becomes active.

### M3: The TanStack contender

React + TanStack Virtual over a DOM grid, on `@seiza/duckdb`. No Wasm of its own, no UI kit: React, TanStack Virtual, its own CSS, and the Arrow library. It builds from M1's design note.

**Part A: the data layer, headless.**
- [ ] The page SQL, the page cache, and float formatting in TS pass M2's three fixtures, and their negative controls fail.
- [ ] The cache counts each page's Arrow IPC bytes (`byteLength`), as the component's `heap_bytes()` does.
- [ ] Arrow loads with the engine, after first paint; a build check fails if Arrow reaches the first-paint chunk.
- [ ] The engine files both contenders load are byte-identical and served from `/observatory/duckdb/`; whether the engine's JS chunk is shared too, recorded.

**Part B: the view.**
- [ ] The scroll model per M1's note, TanStack as M1 chose, columns at the pinned widths, placeholder rows, and the theme's CSS variables generated from gpui-kit 0.7.3's default theme (light and dark).
- [ ] It opens the file and reaches the last row in Chromium, Firefox, and WebKit.

**Part C: base-level parity**, checked item by item against the component's README:
- [ ] Keys (↑/↓, Page Up/Down, Space/Shift+Space, Home/End, Cmd+↑/↓), Shift+wheel sideways, a track press, the drag settle (or M1's substitute), the tooltip (500 ms rest, 300 ms grace), the focus ring.

**Part D: the contract and the first screen.**
- [ ] It publishes M1's contract; Element Timing is set on newly created cells, only during measured runs.
- [ ] Its first screen is prerendered; first usable is the hydration commit, confirmed by the probe.
- [ ] Its JS budgets are in `perf/budgets.json` and gated by `just observatory check`.
- [ ] Plain TanStack (a native scroller, no scaling) documented: where it stops, in Chromium and Firefox.

### M4: The numbers

**Part A: one metrics module and the scripts.**
- [ ] One TS module computes every metric from the contenders' marks and traces; the Playwright scripts use it, and so will the page's readouts.
- [ ] A script per metric runs against either bare contender page.

**Part B: the runs.**
- [ ] Reference and throttled, median of 10, cold, both contenders, their order alternated: the per-use metrics, and first pixels and bundle size as footnotes.
- [ ] The results note in `perf/results/`, and the README's numbers generated by `just observatory report`, including where TanStack wins.

### M5: The observatory page, deployed

React with shadcn on Base UI and Tailwind v4, every dependency pinned exactly.

**Part 0: how the web builds sit in the repo, explored before part A.** The apex will hold more than the observatory: a landing page at `/` now (deliberately basic: a title, a catchy line, and a link to the observatory; maybe Astro or another zero-JS build later), and other sections later. Options to weigh, each against first paint, caching, and the comparison protocol: one site app for the apex (a Vite multi-page build, base `/`, shared styles and components); the observatory's `web/` on its own with the landing page as a separate static build (simple, cached hard, no shared bundle); or a site directory of its own that the observatory's page joins. Fixed either way: the contenders are separate bare builds, never in any site bundle (root `CLAUDE.md`, "Comparison protocol"), and one Worker serves the apex. The choice is recorded in root `docs/DECISIONS.md` ("Repo structure") before part A, with what it changes: `web/`'s base, the observatory's rule 2, and `/` in the seiza.io WAF rule (`docs/private/zone.md`).
- [ ] The options compared and one chosen, with the landing page's first paint and bytes estimated for each.

**Part A: the shell.**
- [ ] A collapsible nav listing components (one entry), `/observatory/tall-table`, one slot with the GPUI | TanStack toggle (disabled until the GPUI contender paints its first rows), a same-origin iframe per contender that a flip destroys and replaces, contenders reporting marks by `postMessage`, a URL parameter choosing which side loads first.

**Part B: the readouts.**
- [ ] Passive readouts from M4's metrics module at ~4 Hz, the second contender's labelled warm, beside M4's cold numbers.

**Part C: the deploy.**
- [ ] The Worker serves the page, the contenders, and the engine as static assets (precompressed brotli, COOP/COEP/CORP), and the data file by range through the edge cache (as it does today), at `seiza.io/observatory`; the zone's WAF rules cover its paths; a production check passes.

### M6: Split mode

- [ ] A toggle mounts both contenders side by side with a draggable divider, labelled "not measured: both running"; each half scrolls sideways inside itself; memory with both running recorded.

### M7: The benchmark button

- [ ] "Run benchmark" plays load, fling, and jump to 90% on each side in turn, alternating which goes first between runs, driving each through its own input path (script-made wheel events reach GPUI's listeners but never scroll a native scroller, so the DOM side is driven through its scroll position), and shows the results labelled warm beside the cold ones.

---

## Measurements

Generated by `just observatory report` from [`perf/budgets.json`](perf/budgets.json) and the newest matching file in `perf/results/`; don't edit between the markers. A metric's history is its dated results files.

<!-- report:plan:start -->
| Metric | Budget | Gate | Local | Production | From |
|---|---|---|---|---|---|
| GPUI contender: time to first paint | ≤ 187.6 ms (baseline 170.5 + 10%) | `check` | 170.5 ms | — | [2026-10-16-m2-b-gpui-cold](perf/results/2026-10-16-m2-b-gpui-cold.json) |
| GPUI contender: time to first paint, throttled | — | recorded | 3502.5 ms | — | [2026-10-16-m2-b-gpui-cold](perf/results/2026-10-16-m2-b-gpui-cold.json) |
| GPUI contender: wasm (brotli) | ≤ 3099.7 KiB (baseline 2695.4 + 15%) | `check` | 2695.4 KiB | — | [2026-10-16-m2-b-gpui-cold](perf/results/2026-10-16-m2-b-gpui-cold.json) |
<!-- report:plan:end -->

---

## Long-term goals

Not milestones. Each starts with research.

- **A third contender: Glide Data Grid** (GPUI | TanStack / Glide): a DOM-hosted canvas grid, which would separate "canvas vs DOM" from "Wasm vs JS". Another contender app against the same GPUI side, under the same protocol. It may never happen.
- **A dataset easier to read at a glance** than a sea of floats, within the static-asset budget.
- **Feature levels:** when a table feature (sorting, …) exists in the component and is worth comparing, a level adds it on both sides (root `CLAUDE.md`, "Comparison protocol"), each feature's cost measured against the base.
- **Dropping your own file:** out of the base level. It would widen the cell fixtures to every column kind (decimals, timestamps, 128-bit integers).

---

## Open questions

- **The pause switch.** The observatory's data never reaches R2, but every data read now runs its Worker (static assets can't serve ranges), so each is a billed request. Whether it honours the switch for them is decided at the deploy (M5), with the WAF rules' widening to seiza.io's paths.
- **The landing page.** The observatory's Worker holds the apex `seiza.io` (everything outside `/observatory/` a 404). The page is basic (a title, a catchy line, a link to the observatory); where its build lives is M5's part 0, and whether it ships before M5 is open.
