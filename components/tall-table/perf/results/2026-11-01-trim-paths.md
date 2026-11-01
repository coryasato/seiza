# `trim-paths` in the bare host (2026-11-01)

The repo-wide change of `docs/research/build-paths.md`, measured in the bare host. Apple M1, Darwin 25.6.0 arm64, machine `local`; exact bytes of one build each.

Raw: `2026-11-01-trim-paths-wasm.json` (the base before and after, with its home paths counted), `2026-11-01-trim-paths-size.json` (`size`: every feature's build, each checked for home paths, and the control).

## What changed

- The root release profile remaps build paths in the compiled output (`trim-paths = "object"`; root `docs/DECISIONS.md`, "Toolchain and build").
- `size` fails if any build it makes holds the builder's `$HOME`, `/Users/`, or `/home/`, with the base built without the setting as its control (`shared-web/perf/home-paths.ts`).

| The base | Before | After | Change |
|---|---|---|---|
| Raw (cargo's output) | 13,093.8 KiB | 13,055.9 KiB | −37.9 KiB |
| After wasm-bindgen and wasm-opt | 9,681.5 KiB | 9,640.5 KiB | −41.0 KiB |
| Brotli 11 | 2,689.2 KiB | 2,687.8 KiB | −1.4 KiB |
| Home-directory paths | 979 | 0 | |

Every feature's build holds no home path either (`size`, which passed: symbols, linking, and the control as before). Each feature's added bytes after wasm-opt are within 0.3 KiB of the last run's (`2026-10-29-m9-d-size.json`: `sort` 84.3 → 84.0 KiB, `copy` 56.2 → 55.9, the rest within 0.2), so earlier results stay comparable; brotli's moved by up to 2.3 KiB (`sort` 19.3 → 21.6, `custom-cells` 5.0 → 3.4), the swing a few shifted bytes make (`docs/DECISIONS.md`, "Features", 2026-10-24). A size run `--against` a commit from before the change fails by the paths' bytes.

## Reproducible across checkouts

The base built in the repo and in a git worktree at another path, from the same tree: cargo's output and the wasm after wasm-opt are byte-identical (`cmp`). Before the change the same comparison differed by 1.4 KiB before brotli (`docs/DECISIONS.md`, "Features", 2026-10-24). `--against` still gates after wasm-opt, not brotli: two commits differ in their panic sites' line numbers, which shift brotli by up to ~2 KiB whatever the path.

## Controls

- The base built without the setting (`CARGO_PROFILE_RELEASE_TRIM_PATHS=none`, in `target/untrimmed/`, then wasm-bindgen and wasm-opt as shipped) holds 987 home paths, which the check fails.
