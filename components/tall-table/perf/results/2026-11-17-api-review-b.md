# API review part B: the break, as one change (2026-11-17)

Measured on Apple M1 (8 cores), macOS 26.6.2 arm64, machine `local`: the bare host's raw wasm (cargo's release output, before wasm-bindgen and wasm-opt), native `cargo test` and `cargo clippy` runs; no frame work or TTFP; then, after the code review and its fixes, the shipped sizes (`just tall-table size --against bed1b85`, 15 min 19 s).

Raw: `2026-11-17-api-review-b-size.json` (the base and each feature's build, the base against `bed1b85`).

## What changed

The six rows the owner confirmed (`PLAN.md`, "Active milestone"; `docs/DECISIONS.md`, "Component API" and "Features"), against part A's tree:

- **`#[non_exhaustive]`** on `TallTableEvent` and its `ColumnsMoved`; on `TallTableClick`, `CopyProgress`, `ActivityStats`, `CellPaint`, `Domain`, and `Density` (with `Density::new`); on `ClickKind`, `CellValue`, `PageError`, and `Sign`. No code.
- **`sort`'s list of keys:** the delegate's `sort(&[Sort], cx)`, `sort() -> &[Sort]`, `set_sort(Vec<Sort>, cx)`, `Sorted(Vec<Sort>)`, `SortRefused(Vec<Sort>, SortRefused)`, the probe's `sort: Vec<Sort>`; `set_sort` refuses more than one key. Code in `sort` builds: a `Vec` where an `Option` was, and the refusal.
- **`select` → `set_selection`, `copying` → `copy_progress`.** No code.
- **A right press and a long press stopped at the root during a drag** (`clicks`). Code in `clicks` builds.

In the consumers: the bridge's `ClickKind` match (`unknown` for a kind it wasn't built with) and its `sort` (the first key, as before, so no script changed); the observatory's contender's two `Density::new` and its wall's `PageError` arm; the bare host's `Density::new`, its delegate's `sort`, its two `set_sort` callers; Kirkwood's delegate's `sort`, its two `set_sort` callers, its `sort()` reader, and two `set_selection`. Tycho and the DuckDB engine: nothing.

## The bytes (raw, before the code review)

The bare host's raw wasm, release:

| Build | Before (part A) | After | Change |
|---|---|---|---|
| No feature | 13,643,890 | 13,643,889 | −1 (a panic's line number) |
| `sort` | 13,741,053 | 13,741,742 | +689 |
| `clicks` | 13,658,866 | 13,658,927 | +61 |
| Every feature | 13,956,322 | 13,957,017 | +695 |

The base has no code of the break's. `sort`'s 689 raw bytes are the events' and the probe's `Vec`s and the refusal; `clicks`' 61 the two stops. Kirkwood builds `sort` (a showcase: no budget); Tycho and the observatory's levels build neither `sort` nor `clicks`, so their wasm changes only where a source line moved.

## The bytes (shipped, after the code review)

`just tall-table size --against bed1b85`, each build against the sizes recorded at `bed1b85` (`2026-11-17-hardening-2-c-size.json`):

| Build | After wasm-opt, before | After | Change | Brotli, before | After |
|---|---|---|---|---|---|
| The base | 9,836.6 KiB | 9,836.6 KiB | 0 | 2,760.7 KiB | 2,761.2 KiB |
| `sort` | 9,920.9 KiB | 9,921.6 KiB | +0.7 KiB | 2,781.3 KiB | 2,780.1 KiB |
| `clicks` | 9,848.3 KiB | 9,848.4 KiB | +0.1 KiB | 2,762.8 KiB | 2,764.3 KiB |
| Each other feature's (11 builds) | | | 0.0 KiB | | −1.9 to +1.8 KiB |

The base is the same after wasm-opt in a worktree at `bed1b85` and in this tree (the script's gate: 0.1 KiB), and no feature's symbols are in it. Brotli moves by up to 2 KiB either way in builds whose wasm-opt size didn't change at all: its swing, not a cost (the script records it and gates nothing on it). So the break costs 0.7 KiB after wasm-opt in a `sort` build and 0.1 KiB in a `clicks` build, and nothing anywhere else.

**For each app:** Tycho and the observatory's five levels build neither `sort` nor `clicks`, so none of their wasm holds the code that changed, and no budget is touched. Kirkwood builds `sort` (+0.7 KiB after wasm-opt in the bare host); it's a showcase, with no budget and no results of its own.

## The checks

- `just tall-table lint`: passes.
- `just tall-table test`: all 18 runs pass (412 tests with every feature on; one new, `set_sort` refusing two keys, in `the_tables_own_refusals`).
- `just tall-table pairs`: passes, 89 builds' clippy, the tests on the pairs with code gated on both, and the 89 sets' rustdoc, 24 min 12 s (15 min 12 s before the rustdoc part).
- `just tall-table soak`: passes, 4 `SEED`s × 500 cases, 8 min 16 s.
- **Row 6's control:** with `state/click.rs` as it was, the four during-a-drag window tests (`a_context_press_during_a_scrollbar_drag_reports_nothing`, `select::a_context_press_during_a_drag_does_nothing`, `a_context_press_during_a_resize_does_nothing`, `a_context_press_during_a_move_does_nothing`) each fail at "nothing reached the host"; with the stop, all 33 `click` tests pass.
- **The consumers,** each built on its own for wasm32: the bridge and the bare host (every feature), the DuckDB engine (every feature), Tycho, Kirkwood, and the observatory's contender at its five levels. `just kirkwood lint` and `just kirkwood test` pass; `just tycho lint` passes; the observatory's contender's clippy passes at every level (wasm32 and native) and its native tests pass.
- `just observatory fixtures`: passes, after `gpui-build` and `gpui-build wide` (no paging number, cell text, or page SQL changed).
- `just observatory lint`: passes, once the TanStack contender's three generated theme files were written again (`just observatory theme-css`: each one's header named gpui-kit 0.9.1, stale since the 0.10.0 bump; the one line each is the whole difference). Not this change's cause, but in its tree.

## After the code review

- **A source refuses a list it can't sort by whole:** Kirkwood's and the bare host's delegates took the first key and dropped the rest, which the trait's contract (ties by the next key) forbids once two keys can be sent. Each refuses more than one now, the bare host's with a test.
- **`set_sort` with two keys returns its refusal with no debug assertion:** a list is the API's shape, so two keys is a well-formed argument a host may try and fall back from; a debug build would have panicked.
- **A click's sort borrows its keys** (`sort_by`), so it no longer copies them to pass them by value.
- **Stale names** in the README, `set_columns`' and `Selected`'s docs, and `Cargo.toml`'s comment (`select`, `copying`) are the new ones; `pairs`' header and the justfile say ~24 minutes, and that the whole run is one to ask about.
- **Left as it is:** the probe's `sort` is a `Vec` built each probed frame while a sort is on (one small allocation, beside the strings the probe already builds; the observatory, which probes every frame, builds no `sort`).

After these fixes: `just tall-table lint`, `test` (all 18 runs), `pairs --only clippy` (100 s) and `--only doc` (170 s), `just kirkwood lint` and `test`, and `just observatory lint` pass; then the size run above.

## Reproducing it

```sh
cargo build -p tall-table-host --target wasm32-unknown-unknown --release [--features sort|clicks | --all-features]
just tall-table lint && just tall-table test && just tall-table pairs && just tall-table soak
just tall-table size --against bed1b85 --label api-review-b-size
just kirkwood lint && just kirkwood test && just tycho lint
just observatory gpui-build && just observatory gpui-build wide && just observatory fixtures
```
