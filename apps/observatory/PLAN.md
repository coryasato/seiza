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
| M1 | Spikes: the DOM scroll model and the input-latency method (parts A–B) | Next |
| M2 | The GPUI contender and the fixtures (parts A–C) | Not started |
| M3 | The TanStack contender (parts A–D) | Not started |
| M4 | The numbers: cold runs of both contenders (parts A–B) | Not started |
| M5 | The observatory page, deployed (parts 0, A–C) | Not started |
| M6 | Split mode | Not started |
| M7 | The benchmark button | Not started |

**Parts are sized to one working session.** Each ends with its own checks passing and its evidence written down, so the next session starts from this file, not from the last one's context. A part that grows past a session splits before it's started, not halfway through.

**Closing a milestone:** as for every app (root `CLAUDE.md`, "Working agreements"): every "done when" check passes; the numbers are in `perf/results/` with a note; new decisions are in `docs/DECISIONS.md` (repo-wide ones in the root's); a `docs/LESSONS.md` entry is written; and the milestone's spec and evidence move from here to `docs/milestones.md`, leaving one row above.

**Component and engine changes:** the observatory consumes the tall table and the DuckDB engine; it doesn't reshape them (root `docs/DECISIONS.md`, "Repo structure"). The changes it needs, all listed here: `Paging` gains the two settle times (M2 part A, the one change to the table's internals, defaults unchanged), the table's fixtures and their native tests (M2 part C), `@seiza/duckdb` takes its extension directory as an option (done, M0 part A), and `seiza` gains `shell` and `panel` features (M2 part A, on by default). Each records its effect on Tycho.

---

## Active milestone

**Carried from M0, done 2026-10-14: the zone's WAF covers seiza.io.**
- [x] A path rule for seiza.io, so requests outside the observatory's paths never reach the Worker.
- [x] The rate limit covers both hosts, as decided (root `docs/DECISIONS.md`, "Hosting").
- [x] `just observatory worker-check --behind-waf` passes, and Tycho's production check still does; the rules' text is in the gitignored root `docs/private/zone.md`.
  *Evidence (2026-10-14):* `worker-check --behind-waf` against https://seiza.io: every range check PASS, `/wp-login.php` 403, a POST to the data 403. `node apps/tycho/worker/scripts/check.ts --url https://tycho.seiza.io`: its data endpoint and WAF checks pass (a probe 403); its only failures are four build files, because production still runs the build from before the table component's rename and `extensionDir` (`index.html`, `index-*.js`, `engine-*.js`, `tycho_bg-*.wasm` differ from today's web/dist), which Tycho's next deploy settles.

### M1: Spikes: the DOM scroll model and the input-latency method

The two unknowns that shape both contenders. One throwaway page serves both parts: fake rows, no DuckDB, nothing kept.

**Part A: the DOM scroll model, sized.** A scaled native scroller over 1,567,523 fake 30 px rows: the spacer held under the browser's element-height cap, the content moving 1:1 with the input within a page and re-anchored at page boundaries. The page is `spike/` (`just observatory spike`); results [`perf/results/2026-10-15-m1-a.md`](perf/results/2026-10-15-m1-a.md); the design [`docs/dom-scroll-model.md`](docs/dom-scroll-model.md).
- [x] It reaches the last row in Chromium, Firefox, and WebKit; per browser, the stretch (spacer to content) and what the re-anchor looks like.
  *Evidence (2026-10-15):* caps: Chromium and WebKit clamp an element at 33,554,428 px; Firefox lays out anything over 17,895,696 px at 0 px. One spacer for all, 2^24 px: stretch 2.80 overall (3.06 between the 1:1 end zones of 2^20 px). Last row (1,567,522, bottom flush, gap 0 px) reached in all three by End, Ctrl+End, and 50 wheel events from 40,000 px above the end; in Chromium and WebKit also by a thumb drag and by a steady fling of 180 equal events (233–263 re-anchors, every frame's top row matching the model: 0 of 373–388 off, and 0 of 253–259 through the top band; negative control without the forced render: 336 of 374 off). Re-anchor (`scrollBy` past 1,800 px of drift): 200 × 120 px of wheel from the middle moved 24,000–24,001 px in all three, no frame backward, none off the model, exact at rest, the same as the never-re-anchoring control; the thumb moves back ≤ ~0.1 px. Exceptions, all mid-animation or mid-fling: `scrollTop =` lost Page Down input in Firefox (19,884 of 26,040 px) and fling distance in WebKit (the steady fling 260,503 px short), so `scrollBy`; with it, WebKit showed one frame 137 px back during a smooth Page Down (n = 1). Firefox can't be flung top to bottom by script: one page per wheel event.
- [x] Whether a native scrollbar drag can be told apart from a wheel or key scroll, per browser (the 80 ms drag settle depends on it); if it can't, what the DOM side does instead.
  *Evidence (2026-10-15):* Chromium and WebKit, scrollbars shown: a press on the scrollbar sends `pointerdown`/`pointerup` to the scroller, no `pointermove` during a drag; the model put the drag's scrolls down to the thumb (Chromium 10 of 10, WebKit 8 of 9, the ninth a sub-screen step after `pointerup`), every track press, wheel, and key scroll to its own source. It doesn't need the events: a step bigger than a screen with no wheel, key, or touch behind it is the thumb (a thumb pixel is ~19,000 px of scroller), and the settle is 80 ms without a scroll event. Firefox, headed (headless draws no scrollbar with width), `ui.useOverlayScrollbars: 0`: the same `pointerdown`/`pointerup`, 20 of 20 drag scrolls to the thumb, a track press a page 1:1, and a drag to the bottom reaching the last row; released 40 px below the window, Firefox reset `scrollTop` to 0 itself (likely its thumb snap-back for a synthetic pointer off the window; not confirmed with a real mouse).
- [x] TanStack Virtual (pinned exactly) over the full count, through a custom `observeElementOffset`, against a moving window: its memory, the time to build its measurements, and frame work in a fling. The choice recorded.
  *Evidence (2026-10-15):* `@tanstack/react-virtual` 3.14.19 (`virtual-core` 3.19.4), Chromium at DPR 2, median of 10 cold runs, alternating. Full count against a 4,096-row window: heap + ArrayBuffers after mount 32.33 against 2.51 MiB; measurements held 29.91 MiB against 83.9 KiB, built in 28.4 against 0.37 ms; mount to rows 20.7 against 8.3 ms; steady fling 4.22 against 4.20 ms of main thread per frame (trace), frame p95 16.7 ms and none over 50 ms in both. **Chosen: the window** (`docs/DECISIONS.md`, "Scroll model").
- [x] A design note for the TanStack contender's scroll model, with a rough size of the build.
  *Evidence (2026-10-15):* [`docs/dom-scroll-model.md`](docs/dom-scroll-model.md). Size: React + ReactDOM alone 58.0 KB brotli; with TanStack Virtual, the model, the keys, and the rows 68.1 KB (+10.1 KB brotli, +37.6 KB raw), before the data layer and theme.

**Part B: the input-latency method.** On Tycho's canvas (WebGPU and WebGL2) and on the throwaway page.
- [ ] For a key press and a track press: Event Timing's duration, checked against a presented-frame probe on both.
- [ ] For the wheel (which Event Timing doesn't report): whether Chromium's trace (`EventLatency`) reports input to presentation for wheel events whose default is prevented (GPUI) and for native scrolls (DOM). The method chosen.
- [ ] Per-frame work read from the trace, the same way on both sides, agrees with `workRecorder` on Tycho within the run's spread.
- [ ] The contender contract written down: the marks, targets, and replay hooks each contender publishes.

---

## Next milestones

The "done when" checks are drafts until their milestone becomes active.

### M2: The GPUI contender and the fixtures

**Part A: the shared changes, measured on Tycho.**
- [ ] `seiza` has `shell` and `panel` features, on by default; Tycho's wasm is byte-identical.
- [ ] `Paging` has `scroll_settle` (250 ms) and `drag_settle` (80 ms), read where `SCROLL_SETTLE` and `DRAG_SETTLE` are today; Tycho's table checks pass and its size effect is recorded.

**Part B: the bare page.** A minimal host of `seiza-tall-table` with `seiza-duckdb`'s `tall-table` adapter, `seiza` without `shell` and `panel`, the engine from `/observatory/duckdb/`, the data file from its static path.
- [ ] It opens the file and reaches the last row, which equals `count(*)`, and publishes M1's contract.
- [ ] Built alone (`-p`); its wasm with and without `shell` and `panel` recorded; a size check fails if a feature leaks in through Cargo's unification.
- [ ] Its placeholder shell matches its first frame; `perf/budgets.json` and `perf/baseline.json` hold its TTFP and wasm budgets, and `just observatory check` passes.

**Part C: the fixtures**, in `components/tall-table/fixtures/`, each with a negative control, run by native tests inside the crate.
- [ ] Paging: scroll, jump, rest, and drag steps → the page requests in order, the settle times included.
- [ ] Cells: values from each float column of the data file and each column's budget, pinned from the GPUI contender's `ColumnProbe` → the shown text.
- [ ] Page SQL and the summary queries.

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
