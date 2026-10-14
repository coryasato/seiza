# PLAN.md — Observatory

What's next for the Observatory: milestone status, the active milestone's "done when" checks, long-term goals, and open questions. Only what's still open lives here. The rules are the root `CLAUDE.md`'s, its "Comparison protocol" above all; this app's own are in its [`CLAUDE.md`](CLAUDE.md).

**Goal:** one page, at `seiza.io/observatory`, that runs each component against a DOM equivalent and shows with measured numbers what each costs over a session of use: opening data, scrolling, flinging, jumping. The first comparison is GPUI | TanStack: the tall table ([`components/tall-table/`](../../components/tall-table/), at `seiza.io/observatory/tall-table`) against React + TanStack Virtual, on the same engine and the same file.

**Deciding metrics:** per-use cost, as the root `CLAUDE.md`'s "Comparison protocol" defines it (time to first usable, time to data, input to visible response, behavior under load, reach and correctness, cost). One-time costs (first pixels, bundle size) are footnotes. TTFP still gates each contender's own build (root rule 1).

**Where everything else lives:** the decisions so far are repo-wide, in the root [`docs/DECISIONS.md`](../../docs/DECISIONS.md) ("Comparison protocol", "Hosting", "Repo structure"). This app's own context and rules are in [`CLAUDE.md`](CLAUDE.md), its decisions in [`docs/DECISIONS.md`](docs/DECISIONS.md).

---

## Status

| Milestone | Title | Status |
|---|---|---|
| M0 | Groundwork: the app, its data file, and static hosting (parts A–B) | In progress: part A done |
| M1 | Spikes: the DOM scroll model and the input-latency method (parts A–B) | Not started |
| M2 | The GPUI contender and the fixtures (parts A–C) | Not started |
| M3 | The TanStack contender (parts A–D) | Not started |
| M4 | The numbers: cold runs of both contenders (parts A–B) | Not started |
| M5 | The observatory page, deployed (parts A–C) | Not started |
| M6 | Split mode | Not started |
| M7 | The benchmark button | Not started |

**Parts are sized to one working session.** Each ends with its own checks passing and its evidence written down, so the next session starts from this file, not from the last one's context. A part that grows past a session splits before it's started, not halfway through.

**Closing a milestone:** as for every app (root `CLAUDE.md`, "Working agreements"): every "done when" check passes; the numbers are in `perf/results/` with a note; new decisions are in `docs/DECISIONS.md` (repo-wide ones in the root's); a `docs/LESSONS.md` entry is written; and the milestone's spec and evidence move from here to `docs/milestones.md`, leaving one row above.

**Component and engine changes:** the observatory consumes the tall table and the DuckDB engine; it doesn't reshape them (root `docs/DECISIONS.md`, "Repo structure"). The changes it needs, all listed here: `Paging` gains the two settle times (M2 part A, the one change to the table's internals, defaults unchanged), the table's fixtures and their native tests (M2 part C), `@seiza/duckdb` takes its extension path as an option (M0 part A), and `seiza` gains `shell` and `panel` features (M2 part A, on by default). Each records its effect on Tycho.

---

## Active milestone

### M0: Groundwork: the app, its data file, and static hosting

The app's skeleton, and the two assumptions everything after it stands on: that a slimmed asteroid file fits Workers static assets, and that static assets answer DuckDB's byte-range reads.

**Part A: the app skeleton and the engine's path.**
- `apps/observatory/` from [`docs/templates/app/`](../../docs/templates/app/): `CLAUDE.md`, `docs/` (`DECISIONS.md`, `LESSONS.md`, `milestones.md`), `perf/budgets.json`; a justfile module (`just observatory lint`, with `check-terms`); an npm workspace for its web hosts on `shared-web` (COOP/COEP in dev). Layout: `contenders/tall-table/gpui/` and `contenders/tall-table/tanstack/` for the bare pages, `web/` for the page, `worker/`, `data/`, `perf/`.
- `@seiza/duckdb` takes its extension repository as an option (today `EXTENSION_REPOSITORY = '/duckdb-ext'`, `engines/duckdb/web/src/extensions.ts`), so the observatory can serve the engine from `/observatory/duckdb/`. Tycho keeps the default.

**Part B: the data file and the static-asset check.**
- The observatory's own asteroid file: the asteroids with fewer columns, small enough for a Workers static asset (25 MiB per file), all 1,567,523 rows, built by a recipe from Tycho's `asteroids.parquet` and listed in a manifest.
- A production check of static assets at an unlinked path (a deploy: the user's go first).

**Done when:**
- [x] *(A)* `apps/observatory/` has its `CLAUDE.md`, `docs/`, and `perf/budgets.json` from the template, `just observatory lint` passes, and its web workspace serves COOP/COEP in dev.
  *Evidence (2026-10-14):* `just observatory lint`: check-terms clean (and its pattern run by hand over the new, untracked files), "generated numbers are current", `tsc` clean. `budgets.json` has no limits or metrics yet; the root README's headlines list the Observatory as "not measured yet". `just observatory dev` at `/observatory/`: `200`, `Cross-Origin-Opener-Policy: same-origin`, `Cross-Origin-Embedder-Policy: require-corp`; the build's `_headers` scope both, with CORP, to `/observatory/*`. Layout: only `web/` exists so far; `contenders/`, `worker/`, and `data/` come with the code that fills them.
- [x] *(A)* `@seiza/duckdb`'s extension repository is an option with today's path as the default; Tycho's build is unchanged (its wasm and JS sizes recorded) and `just tycho engine` passes.
  *Evidence (2026-10-14):* `extensionDir` (one directory name under the Vite base, `duckdb-ext` by default) on `createBridge`, `duckdb()`, and `scripts/extensions.ts` alike; a name with a slash throws in all three (`/observatory/duckdb`, `duckdb/`, `a/b`, `..` rejected). In preview under `base: '/observatory/'` with `extensionDir: 'duckdb'`: the pinned extension 200, `json` 404, a malformed escape 404; Tycho's `/duckdb-ext/…` the same. `previewBrotli` now strips the base too: `/observatory/assets/*` comes back `br`. Tycho's release build before and after: `tycho_bg.wasm` byte-identical (SHA-256 `b416df90…`, 2842.1 KiB br), DuckDB's bundles and workers identical; `engine-*.js` 198,383 → 198,589 B (39,752 → 39,939 B br, after first paint: the name check); `index-*.js` 116,381 B both, identical but for the engine chunk's hashed name. `just tycho engine`: PASS, Chromium ×10 (engine ready median 653.9 ms), Firefox, WebKit ([`2026-10-14-observatory-m0-a-engine-review.json`](../tycho/perf/results/2026-10-14-observatory-m0-a-engine-review.json); the first draft's run is [`…-engine.json`](../tycho/perf/results/2026-10-14-observatory-m0-a-engine.json)). `just tycho lint` passes.
- [ ] *(B)* The data file: under 25 MiB, `count(*)` = 1,567,523, at least one column of each kind the base level draws (integer, text, boolean, float, date), its row-group size recorded, in the manifest with SHA-256.
- [ ] *(B)* Served as a Workers static asset in production: a ranged `HEAD` and a `bytes=0-0` GET answer 206 with `Content-Range`; closed ranges come back byte-exact; the Parquet isn't recompressed; COOP/COEP/CORP are present; DuckDB-Wasm, loaded from that origin, opens the file and reads a page. If any of these fails, the fallback is chosen and recorded before M1.
- [ ] *(B)* The first page read from the static asset, in production, recorded next to Tycho's R2 path for the same rows.

---

## Next milestones

The "done when" checks are drafts until their milestone becomes active.

### M1: Spikes: the DOM scroll model and the input-latency method

The two unknowns that shape both contenders. One throwaway page serves both parts: fake rows, no DuckDB, nothing kept.

**Part A: the DOM scroll model, sized.** A scaled native scroller over 1,567,523 fake 30 px rows: the spacer held under the browser's element-height cap, the content moving 1:1 with the input within a page and re-anchored at page boundaries.
- [ ] It reaches the last row in Chromium, Firefox, and WebKit; per browser, the stretch (spacer to content) and what the re-anchor looks like.
- [ ] Whether a native scrollbar drag can be told apart from a wheel or key scroll, per browser (the 80 ms drag settle depends on it); if it can't, what the DOM side does instead.
- [ ] TanStack Virtual (pinned exactly) over the full count, through a custom `observeElementOffset`, against a moving window: its memory, the time to build its measurements, and frame work in a fling. The choice recorded.
- [ ] A design note for the TanStack contender's scroll model, with a rough size of the build.

**Part B: the input-latency method.** On Tycho's canvas (WebGPU and WebGL2) and on the throwaway page.
- [ ] For a key press and a track press: Event Timing's duration, checked against a presented-frame probe on both.
- [ ] For the wheel (which Event Timing doesn't report): whether Chromium's trace (`EventLatency`) reports input to presentation for wheel events whose default is prevented (GPUI) and for native scrolls (DOM). The method chosen.
- [ ] Per-frame work read from the trace, the same way on both sides, agrees with `workRecorder` on Tycho within the run's spread.
- [ ] The contender contract written down: the marks, targets, and replay hooks each contender publishes.

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

**Part A: the shell.**
- [ ] A collapsible nav listing components (one entry), `/observatory/tall-table`, one slot with the GPUI | TanStack toggle (disabled until the GPUI contender paints its first rows), a same-origin iframe per contender that a flip destroys and replaces, contenders reporting marks by `postMessage`, a URL parameter choosing which side loads first.

**Part B: the readouts.**
- [ ] Passive readouts from M4's metrics module at ~4 Hz, the second contender's labelled warm, beside M4's cold numbers.

**Part C: the deploy.**
- [ ] The Worker serves the page, the contenders, the engine, and the data file as static assets (precompressed brotli, COOP/COEP/CORP) at `seiza.io/observatory`; the zone's WAF rules cover its paths; a production check passes.

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

- **The pause switch.** The observatory's data never reaches R2, so the switch has nothing to stop there. Whether its Worker honours it anyway, for the Worker requests it does serve, is decided at the deploy (M5).
- **The landing page.** Whether the observatory's Worker also serves the apex root's landing page (root `docs/DECISIONS.md`, "Hosting"), decided at the deploy.
