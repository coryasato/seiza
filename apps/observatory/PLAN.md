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
| M2 | The GPUI contender and the fixtures (parts A–C) | Done 2026-10-17 ([`docs/milestones.md`](docs/milestones.md)) |
| M3 | The TanStack contender (parts A–D) | Active |
| M4 | The numbers: cold runs of both contenders (parts A–B) | Not started |
| M5 | The observatory page, deployed (parts 0, A–C) | Not started |
| M6 | Split mode | Not started |
| M7 | The benchmark button | Not started |

**Parts are sized to one working session.** Each ends with its own checks passing and its evidence written down, so the next session starts from this file, not from the last one's context. A part that grows past a session splits before it's started, not halfway through.

**Closing a milestone:** as for every app (root `CLAUDE.md`, "Working agreements"): every "done when" check passes; the numbers are in `perf/results/` with a note; new decisions are in `docs/DECISIONS.md` (repo-wide ones in the root's); a `docs/LESSONS.md` entry is written; and the milestone's spec and evidence move from here to `docs/milestones.md`, leaving one row above.

**Component and engine changes:** the observatory consumes the tall table and the DuckDB engine; it doesn't reshape them (root `docs/DECISIONS.md`, "Repo structure"). The changes it needs, all listed here (each done, and recorded in `docs/milestones.md`): `Paging` gains the two settle times (M2 part A, the one change to the table's internals, defaults unchanged), the table's fixtures and their native tests (M2 part C, with `shown_text` split out of the render loop for them, and `seiza-duckdb`'s `summary_queries` returning the queries `open_parquet` sends), `@seiza/duckdb` takes its extension directory as an option (done, M0 part A), and `seiza` gains a `panel` feature (on by default) while its title bar and theme toggle move to Tycho, with the Mac input bindings opt-in (M2 part A), and `seiza::targets` (publishing a control's bounds) moves there from Tycho, as do Tycho's first-draw probe and placeholder screenshot match to `shared-web/perf/` (M2 part B), and `cells.json` gains two hand-written `rounding` cases (M3 part A: fixture data only, no code). Each records its effect on Tycho.

---

## Active milestone

### M3: The TanStack contender

React + TanStack Virtual over a DOM grid, on `@seiza/duckdb`. No Wasm of its own, no UI kit: React, TanStack Virtual, its own CSS, and the Arrow library. It builds from M1's design note.

**Part A: the data layer, headless.** Done 2026-10-17 ([`perf/results/2026-10-17-m3-a.md`](perf/results/2026-10-17-m3-a.md)).
- [x] The page SQL, the page cache with the paging's timing (the 250 ms scroll settle and the 80 ms drag settle the paging fixture pins), and float formatting in TS pass M2's three fixtures, and their negative controls fail. *7 paging scenarios (50 steps) on a script clock, 254 drawn cells and 13 rounding cases, the 3 page and 2 summary queries; every control fails, each paging control the same number of scenarios as natively. Two `rounding` cases added, from what the port found: a tie rounds to even in Rust (JS's `toFixed` rounds up), and of two equally near shortest texts Rust's exact text takes the upper (JS's `String` the even); a cross-check against Rust's `fit_float` on 1,999,760 cases: 0 mismatches.*
- [x] The cache counts each page's Arrow IPC bytes (`byteLength`), as the component's `heap_bytes()` does. *A page's `byteLength` is its IPC buffer's; the cache sums them (the file's first page: 87,728 bytes).*
- [x] Arrow loads with the engine, after first paint; a build check fails if Arrow reaches the first-paint chunk. *`contenderBuild` (`contenders/engine.ts`) fails a build with Arrow or DuckDB-Wasm in a first-paint chunk (control: Arrow imported by the entry fails it); the page's JS past its 1.8 KiB entry is requested after its `first-paint` entry.*
- [x] The engine files both contenders load are byte-identical and served from `/observatory/duckdb/`; whether the engine's JS chunk is shared too, recorded. *Both builds' `duckdb/`: the same 6 files, the same SHA-256, each page loading its worker, wasm, and Parquet extension from `/observatory/duckdb/`. The engine's JS chunk isn't shared: ~39 KiB brotli each side, against ~5.7 MiB shared (`docs/DECISIONS.md`, "TanStack contender").*

**Part B: the view.** Done 2026-10-17 ([`perf/results/2026-10-17-m3-b.md`](perf/results/2026-10-17-m3-b.md)). It replaces part A's stub page (`src/main.ts`) and drives part A's data layer, unchanged in its decisions: the scroll model reports the top row (V ÷ row height) to `TablePaging.moveTopTo` and its viewport to `setViewportRows`, and the cells' text comes from `shownText` (never `toFixed` or `String`: the cell fixture pins Rust's ties). The engine and Arrow still load after first paint (`contenderBuild` fails the build otherwise; React and the view may sit in the entry).
- [x] The scroll model per M1's note, TanStack as M1 chose, columns at the pinned widths, placeholder rows, and the theme's CSS variables generated from gpui-kit 0.7.3's default theme (light and dark). *`scroll.ts` is the reference model; TanStack Virtual 3.14.19 over a 4,096-row window. The 11 header widths equal the GPUI contender's `ColumnProbe`s (`tanstack-view --gpui`), the float widths and budgets `cells.json`'s (`test/view.test.ts`). `theme.css` from gpui-kit's resolved default theme by a native generator (`just observatory theme-css`, `--check` in lint). Screenshots against the GPUI contender, light and dark: the same boxes, stripes, header, and text; only the scrollbars differ.*
- [x] It opens the file and reaches the last row in Chromium, Firefox, and WebKit; its row count is `count(*)`. *End shows row 1,567,523 (`count(*)`), spkid 54657680 (the file's last), flush with the viewport's bottom, in all three.*
- [x] It loads in a hidden page too: `afterFirstPaint` waits for a paint entry with no fallback, so a background tab or a hidden frame (the observatory page's) may never start the engine. A `visibilitychange` or timeout fallback, checked in a page opened hidden. *A page that can't paint starts at once: hidden now or before its paint, or with an empty viewport. A `display: none` frame (0 paint entries, a 0×0 viewport) requested the engine at 30–42 ms, opened the file, and filled once shown; an emulated background tab (no frames, no paint timing) at 57–59 ms.*
- [x] A page that answers short draws its missing rows as missing, not `NULL`: `ArrowPage.value` returns `undefined` past its end, and the stub turned that into a NULL. *Empty cells (`cells.ts`, tested). The GPUI side draws them `NULL` (an open question below).*

**Part C: base-level parity**, checked item by item against the component's README. Done 2026-10-18 ([`perf/results/2026-10-18-m3-c.md`](perf/results/2026-10-18-m3-c.md)).
- [x] Keys (↑/↓, Page Up/Down, Space/Shift+Space, Home/End, Cmd+↑/↓), Shift+wheel sideways, a track press, the drag settle (M1's substitute: thumb mode calls `TablePaging.startDrag`, and 80 ms without a scroll event or a `pointerup` calls `endDrag`; the fixture already pins what the paging does with them, so the check is the input reaching those calls), the tooltip (500 ms rest, 300 ms grace, its text `exactText`), the focus ring. *`just observatory tanstack-parity`, in `check`, all three browsers. Keys: the same 12 presses on both contenders, each a screen less a row of its own viewport (Page Down was a whole screen). Shift+wheel sideways by its delta. A track press jumps, its thumb centered on the press within 0.8 px, loading at the release or after an 80–84 ms rest, nothing moving after; the grab after a jump is the browser's (Chromium classic and Firefox follow the pointer, Chromium overlay and WebKit stay at the jump; `docs/DECISIONS.md`). A drag loads only at a rest or the release; with no release it ends 80–85 ms after its last scroll, and at once on a wheel or key. The tooltip at 502–511 ms, at once within the grace, a cut name whole, placed as GPUI's (screenshots match, light and dark); a rounded float's text unit-tested (the file has none). The ring at open on both, kept on a press outside the table.*

**Part D: the contract and the first screen.** Done 2026-10-18 ([`perf/results/2026-10-18-m3-d.md`](perf/results/2026-10-18-m3-d.md)).
- [x] It publishes M1's contract; Element Timing is set on newly created cells, only during measured runs. *`just observatory tanstack-contract`, in `check`. Marks in order: first-pixels at the first screen's Element Timing paint, usable, open, filled. Each filled mark's visible rows have new cells, painted 9.8–15.8 ms after the mark. `state.rows` is `count(*)`, End's `lastCell` is the file's last key, the targets sit in the viewport, and the replay's `jump(0.9)`, `open()`, and `fling()` land where they should. The marks are relayed to a framing parent. Without `?measure`: no state, no targets, and no `elementtiming` (placeholder cells are keyed apart, so a loading row gets new cells either way).*
- [x] Its first screen is prerendered; first usable is the hydration commit, confirmed by the probe. With a prerendered screen the paint entry `afterFirstPaint` waits for is the HTML's, before hydration: decide whether the engine starts there or after the commit, and record it (the GPUI side starts it after its first frame). *The view renders itself into `index.html` at build; hydration keeps the node. Probe: with `?measure`, the first key, taken into React state, marks `contender:input`, 1.1–10.3 ms after the key. Control: a key while the entry JS was held back left no mark. The engine starts after both the paint and the commit, which land within ~11 ms of each other in either order (`docs/DECISIONS.md`, "TanStack contender").*
- [x] Its JS budgets are in `perf/budgets.json` and gated by `just observatory check`: the first-paint JS (entry and its static imports) and the after-paint data layer with Arrow (31.9 KiB brotli in part A), brotli, from `tanstack-build`'s output. `engine-files` already checks what loads before first paint. *`just observatory tanstack-sizes --check`, in `check`: first-paint 72.1 KiB (up 1.6 for this part), data layer with Arrow 34.7 KiB, each at most 10% over `perf/baseline.json`'s.*
- [x] Plain TanStack (a native scroller, no scaling) documented: where it stops, in Chromium and Firefox. *`docs/dom-scroll-model.md`, "Plain TanStack" (`just observatory spike --only plain`). Chromium stops at row 1,118,485 (449,037 rows unreachable) by End, pinned, or `scrollToIndex`; WebKit at 1,118,481. Firefox lays the spacer out at 0 px and reaches only the rows already drawn (row 161 after three tries).*

---

## Next milestones

The "done when" checks are drafts until their milestone becomes active.

### M4: The numbers

**Part A: one metrics module and the scripts.**
- [ ] One TS module computes every metric from the contenders' marks and traces; the Playwright scripts use it, and so will the page's readouts.
- [ ] The GPUI contender publishes the probe key (`contender:input` with `?measure`, as the TanStack contender does: `docs/contender-contract.md`), so first usable is confirmed the same way on both sides.
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
| TanStack contender: first-paint JS (brotli) | ≤ 79.3 KiB (baseline 72.1 + 10%) | `check` | 72.1 KiB | — | [2026-10-18-m3-d-tanstack-sizes](perf/results/2026-10-18-m3-d-tanstack-sizes.json) |
| TanStack contender: data layer and Arrow, after first paint (brotli) | ≤ 38.2 KiB (baseline 34.7 + 10%) | `check` | 34.7 KiB | — | [2026-10-18-m3-d-tanstack-sizes](perf/results/2026-10-18-m3-d-tanstack-sizes.json) |
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

- **A short page's missing cells.** The tall table draws a value past a page's end as `NULL` (`render_body`'s `unwrap_or(CellValue::Null)`); the TanStack contender draws it empty. A static file never answers short, so nothing measured differs; whether the component should draw it empty too is the component's call (Tycho drives it).

- **The pause switch.** The observatory's data never reaches R2, but every data read now runs its Worker (static assets can't serve ranges), so each is a billed request. Whether it honours the switch for them is decided at the deploy (M5), with the WAF rules' widening to seiza.io's paths.
- **The landing page.** The observatory's Worker holds the apex `seiza.io` (everything outside `/observatory/` a 404). The page is basic (a title, a catchy line, a link to the observatory); where its build lives is M5's part 0, and whether it ships before M5 is open.
