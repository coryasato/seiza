# kirkwood

A GPUI density plot, named for Daniel Kirkwood, who found the gaps in the asteroid belt that it shows on the asteroid sample: two numeric columns, every row, drawn as a grid of counts in one image, for row counts where a mark per row can't be drawn. **Planned, not built:** there is no crate yet. Its design is in [`PLAN.md`](PLAN.md) and the research behind it in [`docs/research/density-plot.md`](../../docs/research/density-plot.md).

**Used by:** nothing yet; [Tycho](../../apps/tycho/) waits on it. **Crate:** `seiza-kirkwood` (to come).

## Features

None built. The base and the features to come, in order, are in [`PLAN.md`](PLAN.md), "Features".

## Limits

None measured on the component. What the research measured of its parts (a held image's frame cost, a landing grid's, a source's bin times on 1.57 M and 25 M rows) is in Tycho's [`perf/results/2026-11-10-plot-research.md`](../../apps/tycho/perf/results/2026-11-10-plot-research.md).

## Canvas tradeoffs

To be written with the base, from what it does. What's known going in: a plot on a canvas has no accessibility tree, and color alone carries the density (the research, "Canvas tradeoffs").

## Docs

| File | What's in it |
|---|---|
| [`CLAUDE.md`](CLAUDE.md) | Rules decided before the build. |
| [`docs/DECISIONS.md`](docs/DECISIONS.md) | Why it's built the way it is, by area. |
| [`PLAN.md`](PLAN.md) | Its milestones and features to come, in order, and the active milestone's checks. |

Budgets are the apps' that build it; each feature's own cost will be in `perf/results/`.
