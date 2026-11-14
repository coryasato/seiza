# The metrics module (`metrics/`)

What every number is computed by. Claude Code loads this file when a file under `metrics/` is read. The observatory's rules and the map of its folders are in `apps/observatory/CLAUDE.md`, the repo's in the root `CLAUDE.md`; both apply here. Paths are relative to `apps/observatory/`.

## Metrics

**Metrics:** `metrics/metrics.ts`, one module that computes every metric from what the contenders publish and from Chromium's trace (`docs/contender-contract.md`, "Reading the metrics"), and owns the protocol's constants (the probe key, the fling profile, two frames for the probe, a scenario's scrolls and the "keeps up" share: `SCROLLS`, `KEEPS_UP_SHARE`, `drewShare`, `keepsUp`, `domDrawn`, `WALL_TICKS_A_TABLE`: the wall's memory session, which its Memory card says; `WIDE_DRAG`: the wide sheet's drags, which `metric-drag.ts` makes and "While dragging" says); the trace's frame math (`Trace`, `frameWork`, `lateFrames`, `compositorFrames`: Chromium's frame reporter per vsync, whole, in part, or dropped) is `shared-web/perf/trace.ts`'s, which it re-exports, so the observatory still reads every metric through it. Pure: no Playwright, Node, or DOM access at import, so the scripts and the page's readouts both use it. The scripts that drive it are in `perf/CLAUDE.md`.
