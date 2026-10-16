# Observatory M2 part B: shared changes, measured on Tycho (2026-10-16)

The observatory's GPUI contender (observatory `PLAN.md`, M2 part B) is the second app on `shared/` and `shared-web/`, so what both need moved out of Tycho. Measured on Apple M1, Darwin 25.6.0 arm64, machine `local`, Chromium 153.0.8010.12 (headless=new), 1440×900 at DPR 2. Load average 4.2–6.7 during the runs (other work on the machine).

Raw: `2026-10-16-observatory-m2-b-placeholder.json` (`just tycho placeholder` on the final build).

## What changed

- `seiza::targets::publish` (a control's bounds to `globalThis.__seizaTargets`) is Tycho's `targets::publish`, moved; Tycho's `targets.rs` re-exports it.
- The workspace's `seiza` entry has its defaults off; Tycho already named `features = ["panel"]`, so its features are the same (`cargo tree -e features -i seiza -p tycho`: `panel`).
- `shared-web`'s placeholder CSS gained `--border`, `--table`, `.sz-text-sm`, and `.sz-frame` (the contender's table frame). Tycho's markup uses none of them.
- From Tycho's perf scripts to `shared-web/perf/`: the first-draw probe (`harness.ts`, `firstDrawProbe`, imported by `perf/perf.ts`) and the placeholder screenshot match (`placeholder-shots.ts`; `shoot` now takes what to hold back, which Tycho's `perf/placeholder.ts` passes: its wasm and the engine chunk).

## Effect

| | Before (the build at HEAD) | After |
|---|---|---|
| App wasm, raw | 10,444,625 B | 10,444,759 B (+134 B) |
| App wasm, brotli (`asset-sizes`) | 2841.5 KiB (part A's final) | 2841.6 KiB |
| `index.html`, raw / brotli | 21,124 / 11,433 B | 21,624 / 11,549 B (+500 / +116 B: the CSS) |

The wasm's difference is within build jitter: part A's note found the same commit built from two directories 1.3 KiB apart raw.

## Checks

- `just tycho check`: lint (fmt, clippy on wasm32 and native, tsc, `report --check`, `check-terms`), the release build, wasm 2841.6 KiB vs the 3247.1 KiB limit, reference TTFP 204.6 ms vs the 214.8 ms limit (+4.7% over the baseline; min–max 199.8–258.2 ms): **PASS**.
- `just tycho placeholder`: the placeholder against the first frame (light and dark, DPR 2 and 1), its steadiness, its characters and bytes, and the theme toggle: **PASS**.

## Reproducing it

```sh
just tycho check
just tycho placeholder --label observatory-m2-b-placeholder
```
