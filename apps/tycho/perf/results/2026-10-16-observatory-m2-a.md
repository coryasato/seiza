# Observatory M2 part A: Tycho's title bar, `seiza`'s `panel` feature, opt-in Mac input bindings, and the table's settle times as `Paging` fields (2026-10-16)

Shared changes the observatory's GPUI contender needs, measured on Tycho, the one app that builds them (observatory `PLAN.md`, M2 part A).

Measured on Apple M1, Darwin 25.6.0, machine `local`, Chromium headless=new, 1440×900 at DPR 2, median of 10, reference and throttled. Load average 5–7 through most of the session (other work on the machine).

Raw:
- `2026-10-16-observatory-m2-a-placeholder.json`: `just tycho placeholder` on the final build.
- `2026-10-16-observatory-m2-a-placeholder-review.json`: the same after the code review's fixes (the paint-mark guard requires exactly one timed element, the inert check refuses SVG's embedding and linking elements, Tycho imports `PLACEHOLDER_ID`, one `TITLE`, Tycho names `features = ["panel"]`): PASS. The guard's negative controls (no timed element, two, one only in text, `foreignObject`, `use href`, `iframe`, a handler) each fail the build.
- `2026-10-16-observatory-m2-a-ab-shell.json`: `just tycho placeholder --ab` of the final build against HEAD (`a1cc7cc`, built in a worktree with its own `target/` and its own `@seiza/*` packages, its `web/dist` copied to `target/ab-head-dist`), reference + throttled, 10 interleaved runs per side.
- `2026-10-16-observatory-m2-a-table-shell.json`: `just tycho table` on the final build, asteroids, reference + throttled, n=10.
- From the first design (a `shell` feature in `seiza`, dropped; below): `2026-10-16-observatory-m2-a-table.json`, `-ab.json`, `-ab-reference.json`.

## What changed

- **The title bar and the theme toggle are Tycho's** (`crate/src/shell.rs`): the title, the Sun/Moon button and Cmd/Ctrl+Shift+L, the observation panel's button, and the icons (`seiza::Bootstrap::assets`). `shared/`'s window root fills the canvas with the app's view, arms the first-frame mark, and follows the system appearance until the app calls `seiza::stop_following_system_appearance`. The placeholder's title bar markup moved from `shared-web/src/placeholder.ts` to Tycho's `web/vite.config.ts`; `shared-web` draws only what the app passes.
- **`seiza` feature `panel`, on by default:** the perf panel, the frame sampler, and the `seiza::perf` API. Tycho keeps it.
- **The Mac input bindings are opt-in:** `Bootstrap::mac_input_bindings()`, which Tycho calls for its jump input.
- **`Paging::scroll_settle` (250 ms) and `Paging::drag_settle` (80 ms)**, read where the `SCROLL_SETTLE` and `DRAG_SETTLE` constants were. Tycho keeps the defaults.

Why: root `docs/DECISIONS.md`, "Shell and input"; the table's `docs/DECISIONS.md`, "Table and paging".

## Size effect on Tycho

| Build | After wasm-opt, raw | Brotli q11 (CLI) | `asset-sizes` brotli |
|---|---|---|---|
| HEAD (this tree) | 10,442,325 B | 2,910,569 B | — |
| HEAD (worktree, the A/B's) | 10,440,991 B | 2,912,644 B | 2841.5 KiB |
| Final | 10,444,674 B | 2,911,472 B | 2841.5 KiB |

+2.3 KB raw (+0.02%) against HEAD built here, of which the settle fields are 1.2 KB (measured on their own in the first design); brotli within its own jitter. The same commit built from two directories came out 1.3 KiB apart raw (a path crate's `-C metadata` hash includes its location), so differences this small aren't attributable to the code.

## Why not "byte-identical"

The first check asked for Tycho's wasm to be byte-identical. No change to `seiza`'s features can give that:

1. Declaring features changes the crate's hash. HEAD's source with only a `[features]` table added (no code change) moved `seiza`'s `-C metadata` from `54621028c7eda340` to `f7cd4242868dd0fc`, and Tycho's wasm with it. Symbol and `TypeId` hashes follow.
2. Line numbers are in the binary. gpui's `#[track_caller]` calls store file, line, and column; one comment line added at the top of `shared/src/shell.rs` changed the wasm (same size).

The check became behavior and size: the placeholder match below and the size effect above.

## The Mac input bindings, opt-in

A scratch bare host (an empty view on `seiza` without `panel`, this workspace's `Cargo.lock` and release profile), built twice:

| Bare host | After wasm-opt, raw | Brotli q11 |
|---|---|---|
| Without `.mac_input_bindings()` | 9,298,594 B | 2,622,690 B |
| With it | 9,299,585 B (+991 B) | 2,623,043 B (+353 B) |

The call stores the bind functions as function pointers, so without it they aren't referenced and don't link. The bare host's 2.50 MiB brotli is the floor of any GPUI host on this pin (gpui-kit, its renderer, and the font stack); Tycho is 2.78 MiB.

## Against the budgets

`just tycho check`: lint passed (fmt, clippy on wasm32 and native, tsc, `report --check`, `check-terms`), wasm 2841.5 KiB vs the 3247.1 KiB limit (pass), **reference TTFP 219.9 ms vs the 214.8 ms limit: FAIL** at load 5.4–7.3 (min–max 208.4–279.2 ms). The first design's `check` failed the same way (217.3 ms, load 6.3), and in its A/B HEAD measured 216.8 ms itself.

A/B against HEAD (final build):

| | HEAD | Final | Spread (HEAD / final) | Resolved? |
|---|---|---|---|---|
| Reference TTFP | 215.1 ms | 209.0 ms | 25.3% / 44.1% | no (limit 6%; load 11.5 at the start) |
| Throttled TTFP | 3780.3 ms | 3790.0 ms | 1.6% / 1.7% | yes: +0.3%, within noise |

HEAD's reference medians in this session's A/Bs (215.1, 216.8, 221.1 ms) all sit over the 214.8 ms limit too: the `check` failure is the machine's. The reference A/B needs a quieter machine to pass its noise gate.

Placeholder (`just tycho placeholder`): **PASS**. The placeholder against GPUI's first frame, light and dark, DPR 2 and 1: every box edge within limits, surfaces 0.0000% differing. The theme toggle, starting light and starting dark: the button and both shortcuts switch, a system change after a press is ignored, a system change before any press is followed, and a reload follows the system.

Table checks (`just tycho table`, final build):

**PASS**, reference and throttled.

| Check | Budget | Reference | Throttled |
|---|---|---|---|
| File → first rows | 500 ms (reference) | 211.5 ms | 3478.3 ms |
| Scrollbar jump to 90% | 400 ms (reference) | 83.3 ms | 2205.2 ms |
| Fling p95 / max | 20 / 50 ms | 16.7 / 16.7 ms | 33.3 / 33.3 ms |
| Fling frames over 50 ms | 0 | 0 | 0 |
| Fling work per frame p50 / p95 | recorded | 6.3 / 8.0 ms | 26.8 / 34.1 ms |
| Fling placeholder share | recorded | 84.5% | 84.6% |
| Last row = `count(*)` | yes | yes | yes |

The jump drags the thumb, so it runs through the drag settle: the throttled 2.2 s is the figure the 80 ms settle was chosen on (`components/tall-table/docs/DECISIONS.md`). The fling's placeholder share (~84%) depends on the scroll settle and is unchanged. The extra view between the root and the workbench (Tycho's `Shell`) left work per frame where it was (6.3 / 8.3 ms p50 / p95 in the first design's run).

## Experiments, dropped

- **A `shell` feature in `seiza`** for the title bar, with `panel`. Making the panel's button optional inside the title bar's builder chain changed Tycho's code even with the defaults: `let` bindings in the chain (52 bytes smaller before wasm-opt), and an `#[inline(always)]` extension method. Only `shell` implying `panel` kept it, which was confirmed under `-Zlocation-detail=none` (byte-identical to the control: HEAD plus the `[features]` table). Dropped because the title bar is Tycho's, not the foundation's. Its table run passed (jump to 90% 83.0 / 2184.7 ms, fling p95 16.7 / 33.3 ms). Its throttled A/B resolved −0.5% (3769.0 vs 3787.1 ms), and its reference A/B was too noisy twice.

## Not run

`--browsers` (Firefox, WebKit), the manual Firefox and Safari pass, and Tycho's `panel`, `jump`, and `cells` suites. The jump input's Mac keys are bound as before (the same functions, same order around init), not re-checked in a Mac browser.

## Reproducing it

```sh
just tycho check
just tycho placeholder --label observatory-m2-a-placeholder
just tycho table --label observatory-m2-a-table-shell
# HEAD in a worktree with its own target/ and its own node_modules/@seiza links, then:
node apps/tycho/perf/placeholder.ts --ab target/ab-head-dist --label observatory-m2-a-ab-shell
cargo clippy -p seiza --no-default-features [--target wasm32-unknown-unknown] -- -D warnings
```
