# API review part A: the audit and the non-breaking fixes (2026-11-17)

Measured on Apple M1 (8 cores), macOS 26.6.2 arm64, machine `local`: the bare host's raw wasm (cargo's release output, before wasm-bindgen and wasm-opt), native `cargo test`, `cargo clippy`, and `cargo doc` runs; no frame work or TTFP.

## What changed

Against part A's parent (`bed1b85`), nothing a host's code can see:

- **A doc comment on each of 111 public items** that had none, and `#![warn(missing_docs)]`.
- **65 `pub` items in private modules made `pub(crate)`** (`cargo fix`, visibility only: `pages.rs`, `scroll.rs`, `activity.rs`, `format.rs`; 63 in a build with every feature, two test-only), and `#![warn(unreachable_pub)]`; 24 fields of crate-private structs with them, by hand (the lint doesn't read them).
- **`Sorted`'s doc** says the same sort again emits it, and `set_columns` clearing one; **fifteen doc links** to items a build may not have (fourteen there before, one in a new comment) are code spans, and one link to a private type is gone.
- **Rustdoc is built with `-D warnings`:** by `lint` with no feature and with every one, and by `pairs` at each feature alone and each pair (`--only doc`).
- **After the code review:** six of the fourteen links (those between two features' docs), the 24 fields, the rustdoc check, and nine doc comments made exact (`Sorted`, `CellProbe::shown`, `Refreshed`'s rows, `TooLarge`'s bytes, `cells_width`, the builders' links to their fields, and the probes' docs that described several fields at once).

## The bytes

The bare host's raw wasm, release, before and after:

| Build | Before | After |
|---|---|---|
| No feature | 13,643,890 | 13,643,890 |
| Every feature | 13,956,322 | 13,956,322 |

The same size to the byte in both; the files differ (a panic's line number moves with the comments above it). No app's wasm grows, so no app's notes record it (root `CLAUDE.md`, rule 1). Not run: `just tall-table size --against`, whose shipped sizes follow from the raw ones for a change with no code in it.

## The checks

On the tree after the code review's fixes:

- `just tall-table lint`: passes (check-terms, fmt, clippy with `-D warnings` on wasm32 with no feature and with every one and natively with every one and the tests, rustdoc with `-D warnings` with no feature and with every one, tsc). Before the fixes the two lints gave 174 warnings with every feature on: 111 `missing_docs`, 63 `unreachable_pub`.
- `just tall-table test`: all 18 runs pass (412 tests with every feature on).
- `just tall-table pairs --only clippy`: 89 builds (13 features alone, 78 pairs, two of them a feature alone), all clean, 109 s.
- `just tall-table pairs --only doc`: the same 89 sets' rustdoc, all clean, 123 s. Its first run failed 22 sets on six links (`density`'s builds on two, `reorder`'s on four).
- `just tall-table soak`: passes, 4 `SEED`s × 500 cases, 8 min 25 s. `pages.rs` changed by visibility alone; the rule has no exemption (`CLAUDE.md`, rule 5), and the first review ran before it.

## Reproducing it

```sh
cargo build -p tall-table-host --target wasm32-unknown-unknown --release [--all-features]   # the raw wasm's size
cargo doc -p seiza-tall-table --no-deps [--all-features]
just tall-table lint && just tall-table test && just tall-table pairs --only clippy && just tall-table pairs --only doc && just tall-table soak
```
