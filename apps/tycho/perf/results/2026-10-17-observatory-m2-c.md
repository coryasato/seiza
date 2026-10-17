# Observatory M2 part C: the tall table's fixtures, measured on Tycho (2026-10-17)

The observatory's part C (observatory `PLAN.md`, M2) adds the tall table's fixtures and their native tests. Tycho builds the component, so its effect is recorded here. Apple M1, Darwin 25.6.0 arm64, machine `local`. No timing was measured: nothing Tycho runs changed but one function's boundary.

## What changed

- `components/tall-table/src/state.rs`: what a loaded cell shows (`NULL`, or `cell_text`) is `shown_text` now, out of `render_body`'s loop, so the cell fixture tests the function the table draws with. Same text, same color. As a plain function it added 219 B raw to Tycho's wasm (375 B brotli); `#[inline(always)]` puts it back in the loop.
- The fixtures' tests themselves (`src/state/fixtures.rs`, `#[cfg(test)]`) and the component's new dev-dependencies (gpui-kit's `test-support`, `futures`, `serde_json`; and `serde_json` for `seiza-duckdb`'s tests) never reach a build. `Cargo.lock` gained 29 packages for `test-support` and moved none.

## Effect

Tycho's release wasm after wasm-opt (`cargo build -p tycho --release`, wasm-bindgen, `wasm-opt -Oz` as `just tycho wasm release` runs them), built with HEAD's `state.rs` and with this one, the rest of the tree the same:

| | Before (HEAD's `state.rs`) | After |
|---|---|---|
| App wasm, raw | 10,444,759 B | 10,444,723 B (−36 B) |
| App wasm, brotli (quality 11) | 2,910,835 B | 2,910,855 B (+20 B) |

Within build jitter (part A's note found the same commit built from two directories 1.3 KiB apart raw).

**After the code review:** `seiza-duckdb`'s `summary_queries` returns the queries `open_parquet` sends (a `Vec`: two, or three with metadata keys), and `open_parquet`, which Tycho's `dataset.rs` calls, sends exactly those, so the SQL fixture tests what goes out. Tycho's wasm: 10,445,182 B raw, 2,912,130 B brotli, +423 B raw and +1,295 B brotli on HEAD (+0.004% / +0.04%). Collecting the sent queries' futures into a `Vec` instead cost +729 B raw. Tycho sends the keyed query, so its queries are unchanged.

## Checks

- `cargo clippy -p tycho -p seiza -p seiza-duckdb -p seiza-tall-table`, on wasm32 and natively with all features and targets, `-D warnings`: clean.
- `cargo test -p seiza-tall-table`: 33 passed, the fixtures' four among them; `cargo test -p seiza-duckdb --all-features`: 20 passed.

## Reproducing it

```sh
cargo build -p tycho --target wasm32-unknown-unknown --release
wasm-bindgen target/wasm32-unknown-unknown/release/tycho.wasm --out-dir <dir> --target web
wasm-opt -Oz --enable-bulk-memory --enable-nontrapping-float-to-int --enable-sign-ext --enable-mutable-globals --enable-reference-types --enable-multivalue --enable-threads <dir>/tycho_bg.wasm -o <dir>/opt.wasm
brotli -q 11 -c <dir>/opt.wasm | wc -c
```
