# Finished milestones: specs and evidence

Each milestone's spec, "done when" checks, and evidence, moved here from [`../PLAN.md`](../PLAN.md) when it closed. History: don't edit it, except to fix a broken link. Paths are relative to `components/tall-table/`.

## M1: the bare host and the base's baseline (closed 2026-10-23)

**Results:** [`perf/results/2026-10-23-m1.md`](../perf/results/2026-10-23-m1.md)

The host every feature's cost is read in, and the base's numbers each feature is measured against. It builds no feature. The host's design is under "Measuring a feature" (`PLAN.md`).

**Done when:**
- [x] **The host builds on its own,** the way the GPUI contender does: `cargo build -p tall-table-host --release --target wasm32-unknown-unknown`, `wasm-bindgen --target web` into `host/web/pkg/`, `wasm-opt -Oz --enable-threads` with the contender's flags, the Vite build, and brotli 11. `just tall-table build` does it all, and `just tall-table dev` serves the page with COOP/COEP. The root `package.json`'s workspaces include `host/web` (`components/*/host/web`). It depends on `seiza-tall-table` and `seiza` (no panel), and on no engine: `cargo tree -p tall-table-host` shows no `seiza-duckdb`.
  *Evidence:* `just tall-table build` (wasm alone, bindgen, wasm-opt, Vite, asset sizes: 2,677 KiB brotli wasm); `just tall-table dev` serves through `seizaViteConfig` (COOP/COEP); workspaces include `components/*/host/web`; `just tall-table size` checks `cargo tree` links no `seiza-duckdb` and not the panel, with its control (built with Tycho, both link).
- [x] **Its delegate answers from memory,** deterministic values from (row, column), in both shapes ("Measuring a feature", above), chosen by URL, with an optional page delay. The table's native tests still pass (`cargo test -p seiza-tall-table`).
  *Evidence:* `host/crate/src/rows.rs` (`?shape=narrow|wide`, `?delay=<ms>`), its 5 native tests (a cancelled read makes no page among them); `cargo test -p seiza-tall-table` passes (33).
- [x] **It publishes what the scripts need,** for `shared-web/perf/`'s harness to read: `gpui:first-frame` (through `seiza`), a mark the host sets from the table's `Filled` event (`mark_after_current_task`; the table sets no marks), the scrollbar's targets from its `Scrollbar` event, and `__seizaFrameSample`.
  *Evidence:* `gpui:first-frame`, `tall-table:filled` (bridge), `table-scroll-track`/`-thumb`, `__seizaFrameSample` (`host/web/src/main.ts`), and with `?perf` `__tallTable`/`__tallTableLayout`; `just tall-table smoke` and `perf` read each.
- [x] **The event bridge is written once.** Tycho (`crate/src/table.rs`) and the GPUI contender (`contract.rs`) each turn `TallTableEvent`s into marks and targets; the host would be the third copy. It moves out instead, and all three use it. Where it can live is the milestone's first decision: not `seiza` (it would know the table) and not the component (no `seiza`), so likely a small host-side crate next to the host, or `seiza` helpers that take plain bounds while each host keeps its few-line `match`. Each app's checks still pass after the move (`just tycho table`, `just observatory reach`), and the wasm change for each is recorded in its `perf/results/`.
  *Evidence:* decided: a host-side crate, `bridge/` (`docs/DECISIONS.md`, "Hosts"; root `docs/DECISIONS.md`, "Repo structure"). `just tycho table --runs 2 --reference-only` PASS, `just observatory reach` PASS, `just observatory cell-fixture --check` matches. Wasm: Tycho +0.6 KiB, the contender −0.6 KiB brotli (each app's `perf/results/2026-10-23-tall-table-bridge.md`).
- [x] **The base's bytes:** `just tall-table size` records the host's wasm (raw, after wasm-opt, brotli 11) in a dated `perf/results/` JSON. The difference from the observatory's GPUI contender is noted (its engine client and Arrow reader), as a cross-check that the host carries nothing more than the table.
  *Evidence:* 13,052.8 KiB raw (cargo's), 9,646.7 after wasm-bindgen and wasm-opt, 2,677.1 KiB brotli (`perf/results/2026-10-23-m1-size.json`); the contender carries 20.3 KiB brotli more. [`perf/results/2026-10-23-m1.md`](../perf/results/2026-10-23-m1.md).
- [x] **The base's frame work:** `just tall-table perf` runs, per shape, a vertical scroll, a vertical fling, and (in the wide shape) a horizontal fling, under the measurement protocol (reference and throttled, cold, median of 10): per-frame work from the browser's trace, cross-checked by `workRecorder`; late frames; frame intervals. The numbers are in a results note, with the machine label.
  *Evidence:* `perf/results/2026-10-23-m1-frames.json`, 10 cold runs per shape and profile, no failures: reference work p50 4.1–7.1 ms, 0% late in every segment. [`perf/results/2026-10-23-m1.md`](../perf/results/2026-10-23-m1.md).
- [x] **The wide shape holds up at the base:** its visible cells per frame and its fling's per-frame work are in the note. If the base itself can't keep up at 500 columns, that's recorded and the wide sheet's plan in the observatory hears of it before M2.
  *Evidence:* 308–336 cells a frame; wide fling work p50 4.22 / p95 8.73 ms, hfling 6.56 / 7.42 ms, 0% late (reference). Told the observatory (its `PLAN.md`): ~310–340 cells, not 1–2 k, and a throttled steady scroll is late in both shapes. [`perf/results/2026-10-23-m1.md`](../perf/results/2026-10-23-m1.md).
- [x] **Manual check in Firefox and Safari:** the host loads and scrolls in both shapes (WebGL2 in Firefox).
  *Evidence:* checked by hand 2026-10-23 in Firefox and Safari, with and without `?shape=wide`: both load and scroll. `just tall-table smoke` loads, fills, and scrolls both shapes headless in Chromium (WebGPU), Firefox (WebGL2), and WebKit (WebGPU).
- [x] **Docs:** `CLAUDE.md`'s layout and commands, the README's Docs table, and the root `CLAUDE.md`'s repo layout name `host/`, `perf/`, and the justfile; the root `justfile` loads the module. `just tall-table lint` (the terms check, fmt, the host's clippy on wasm32 and native) passes.
  *Evidence:* `CLAUDE.md` (host-side crates, layout, commands, perf gotchas), README (Features' base row, Docs table), root `CLAUDE.md` (layout, `trace.ts`, commands), root `justfile` (`mod tall-table`); `just tall-table lint` passes.

## M2: `custom-cells`, a cell's fill, bar, and text color (closed 2026-10-24)

**Results:** [`perf/results/2026-10-24-m2-spike.md`](../perf/results/2026-10-24-m2-spike.md) (part A), [`perf/results/2026-10-24-m2.md`](../perf/results/2026-10-24-m2.md) (part B)

The spec as written before the build. As built, `Stop` takes `&Theme` and `Ramp::new` a slice (`docs/DECISIONS.md`, "Features", "The API as built"); the README has the API as it is.

**What it adds** (behind the `custom-cells` feature, off by default): a page can answer a **paint** for each cell next to its value, and the table draws it. The paint is declarative (`docs/DECISIONS.md`, "Features"): data the table draws in its own cell, not a subtree a host builds per cell, so a DOM contender matches it from numbers a fixture can pin.

```rust
// The page (delegate.rs), behind `custom-cells`.
trait TallTablePage {
    fn value(&self, row: usize, column: usize) -> Option<CellValue<'_>>;
    #[cfg(feature = "custom-cells")]
    fn paint(&self, row: usize, column: usize) -> CellPaint { CellPaint::default() }
}

/// Each field 0..=1 (clamped). `None`, NaN, or a field whose column has no
/// ramp or bar draws nothing (the last a debug assertion: a host's mistake).
#[derive(Debug, Default, Clone, Copy, PartialEq)]
pub struct CellPaint {
    pub fill: Option<f32>, // through the column's fill ramp: the whole cell
    pub bar: Option<f32>,  // the bar's end across the cell's inner width, drawn from the column's zero
    pub text: Option<f32>, // through the column's text ramp: the value's color
}

// The column (column.rs), behind `custom-cells`: what turns them into pixels.
impl TallTableColumn {
    pub fn fill(self, ramp: Ramp) -> Self;
    pub fn bar(self, bar: Bar) -> Self;
    pub fn text_ramp(self, ramp: Ramp) -> Self;
}
/// A theme token, resolved each frame (a fixed color is `|_| hsla(…)`).
pub type Stop = fn(&ThemeColor) -> Hsla;
/// Two or more stops, evenly spaced over 0..=1, mixed in Oklab.
pub struct Ramp { /* stops */ }
/// `zero`: where the bar starts, 0..=1 of the inner width (0, the left edge, by default).
pub struct Bar { pub zero: f32, pub color: Stop }
```

- **What it covers:** the wide sheet's heat-map and data-bar cells, and the color of market watch's flash (a three-stop ramp: down, none, up). The flash's fade over time is `live`'s: `custom-cells` draws what a page answers, and redraws when a page changes.
- **What stays the table's:** the value's text, its rounding and cutting, and the tooltip (the exact value), unchanged; a placeholder or failed row paints nothing (only a loaded row asks its page); a theme switch recolors every paint on its frame, with no page read again.
- **What's the host's:** each column's ramps and bar, and the 0..1 values (a host maps each value through its column's range, read from its source, as the observatory would from SQL).
- **How it's drawn** (decided, `docs/DECISIONS.md`, "Features"): a fill and a bar both as quads, collected in the row loop and painted by one `canvas`, the cells layer's first child: each cell's fill, then its bar over it, all under the text. The research and the spike: root [`docs/research/tall-table-features.md`](../../../docs/research/tall-table-features.md), "`custom-cells`"; [`perf/results/2026-10-24-m2-spike.md`](../perf/results/2026-10-24-m2-spike.md).

**Split into parts (2026-10-24),** one session each, in order. The open points decided the trait's shape and how it's drawn, and settling the third needed both drawings built and compared; so part A settled them with a throwaway spike, and the API is reviewed before part B builds on it. Each part ends with its notes in `perf/results/` and `docs/LESSONS.md`. The milestone closes after part B.

- **A. Research and spike** (no shipped code). *Done 2026-10-24:* the three open points settled (a value and a ramp per column; a bar from a zero point; a fill and a bar both as quads, after the code review), the research in the root's `docs/research/tall-table-features.md`, two decisions in `docs/DECISIONS.md`, "Features", the A/B in `perf/results/2026-10-24-m2-spike.md`, a `docs/LESSONS.md` entry, the API above, the checks below. The spike's code is gone.
- **B. Build, pin, measure, close.** The feature in the table as above; `CellProbe`'s paint; the host's `custom-cells` feature with `?cells=text|heat|bars`; `perf.ts`'s cell styles; `fixtures/paint.json` and its native test and controls; the recipes the checks run: `test` with the feature off and on (`--features custom-cells`), `size` building the base and the feature's build, `smoke` at each cell style. Then the checks below, and the close-out ("Closing a milestone", above). A TS test of the fixture against the TanStack contender isn't part of it: the contender draws no paints until the observatory adopts the feature.

**Done when** (part B), with the evidence:
- [x] **The feature is off by default** and the base's build is unchanged: the host's base wasm, built at the milestone's parent commit and at its head with the feature off, is the same size within 0.1 KiB brotli (not to the byte: panic sites keep their line numbers in the release build, and `cfg` code above one shifts them), and an unstripped build of it holds none of the feature's functions (a symbol check). `just tall-table test` passes with the feature off and on; `just tall-table lint` passes (its clippy runs with every feature).
  *Evidence:* read after wasm-opt instead of after brotli (a decision: brotli moved 0.5 KiB between two builds of one commit): the base at `c3da129` and at the head, each built in one worktree, are both 9,645.3 KiB, the same 22,236 functions and data size; brotli 2,676.9 against 2,679.1 KiB. No `seiza_tall_table5paint` symbol in the unstripped base, 23 in the feature's build (`just tall-table size --against c3da129`, `perf/results/2026-10-24-m2-size.json`). `just tall-table test` passes off (33 table, 5 host) and on (40, 6); `just tall-table lint` passes (clippy on wasm32 with no features and with all, native with all).
- [x] **The host uses it:** its `custom-cells` feature turns on the table's and maps each float column through its range at run time (`?cells=heat` fills, `?cells=bars` bars from zero, `?cells=text` neither), so the optimizer can't strip it. `just tall-table smoke` loads, fills, and scrolls with heat and with bars in Chromium, Firefox (WebGL2), and WebKit.
  *Evidence:* `host/crate/src/rows.rs` (`Cells`, `Shape::range`, `MemoryPage::paint`; a native test that every painted value is 0..1 and only float columns paint), plus `?cells=color` (a text ramp). `just tall-table smoke` passes both shapes at heat, bars, and color in all three browsers; at heat a fill sampled on screen matched the probe's color exactly in each.
- [x] **Its cost, in the host:** the added wasm (brotli 11) of the feature's build against the base's (`just tall-table size`); the wide shape's per-frame work in the steady scroll, the fling, and the sideways fling at `text`, `heat`, and `bars`, reference and throttled, cold, median of 10, on the final build, with the feature's build at `text` against the base (paint compiled in but unused costs nothing per frame, within spread). In `perf/results/` and the README's Features table.
  *Evidence:* +2.9 KiB brotli, +7.8 KiB after wasm-opt. Reference work p50 (scroll / sideways / fling): base 7.00 / 6.49 / 4.05 ms, `text` 7.00 / 6.50 / 4.06, `heat` 7.63 / 7.29 / 4.24, `bars` 7.73 / 7.27 / 4.06; spreads 0.7–6.1%, no late frames. Throttled in the note. [`perf/results/2026-10-24-m2.md`](../perf/results/2026-10-24-m2.md); the README's Features row.
- [x] **A theme switch recolors without a read:** a native test switches the theme and the drawn cells' paint changes to the other theme's colors with no `load_page` call.
  *Evidence:* `paint_fixture` (`src/state/fixtures/paint.rs`): drawn in light, then `Theme::change` to dark; the paint changes to the fixture's dark colors and the delegate's load count doesn't move.
- [x] **Scripts can read it:** with `probe_cells`, `CellProbe` carries each drawn cell's paint as drawn: the fill and text colors (8-bit RGBA) and the bar's left edge and width (CSS px, from the cell's left).
  *Evidence:* `PaintProbe` (`src/probe.rs`), published by the bridge's `js::cells` as `fill`, `text`, and `bar` with `custom-cells`; read by the native fixture test and the smoke check (`?probe-cells`).
- [x] **A fixture pins it** for a DOM contender, `fixtures/paint.json` (its format in `fixtures/README.md`): ramps as their stops' resolved colors in light and dark, bars as a zero and a cell width, and cases from each paint value to the colors and the bar's pixels drawn. A native test checks the table against it, allowing one 8-bit step per channel and one device pixel in a bar's edges (GPUI rounds x.5 down, the browser up); its controls must fail it: a color two steps off, a bar 2 device pixels off, and the same ramp mixed in sRGB instead of Oklab.
  *Evidence:* 18 color cases (light and dark), 9 bars, 2 NaN cases; colors written from Chromium's `color-mix(in oklab, …)` (`just tall-table paint-fixture`, `--check`), stops checked against the theme. The table matched 34 of 36 colors exactly, 2 within one step. `paint_controls_fail`: every color two steps off (away from the drawn value) fails, every bar 2 device pixels off fails, the sRGB mix fails.
- [x] **The jump highlight in a filled cell:** the spec puts it under a fill, which hides it there. Settled with a screenshot of a jump onto heat cells: kept under, or drawn over the cells; a change to the base's drawing logs a decision.
  *Evidence:* drawn over filled cells as the tint with a 1 px top and bottom edge, only by `custom-cells` (the base's drawing is unchanged); the tint alone vanished on the blue ramp. `perf/results/2026-10-24-m2-jump.png`; `docs/DECISIONS.md`, "Features".
- [x] **Canvas tradeoffs:** a heat or bar cell carries meaning in color alone, which a screen reader can't see either; the README says so.
  *Evidence:* README, "Canvas tradeoffs", "Color alone".
- [x] **Waiting apps told:** the observatory's "Waiting on" row and Tycho's note flip to *Ready* (the date and M2).
  *Evidence:* `apps/observatory/PLAN.md` and `apps/tycho/PLAN.md`, "Waiting on".

**Manual check:** looked at by hand 2026-10-24 in Firefox and Safari (`just tall-table dev custom-cells`, `?shape=wide&cells=heat` and `bars`): both draw correctly. The host's values are hashed noise, so its heat map shows no pattern; it measures cost, not meaning.
