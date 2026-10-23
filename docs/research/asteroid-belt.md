# Research: the asteroid belt, a showcase

A showcase for people to enjoy, not a tool and not a comparison: the asteroid belt drawn from the asteroid table's own rows, moving under gravity, zoomable, and linked to the table. Drafted 2026-10-23 in a planning discussion; nothing here is built or measured. Its home (which app, which URL) is open.

**Why it isn't in the observatory:** the observatory compares a component with a DOM equivalent. A DOM table can't draw 1.57 M moving points without WebGL, which takes the DOM out of it, and with both sides on the same GPU shader the result would come out even. What it shows instead is a heavy app the DOM can't build on its own: a million-point view linked to a table, the way astronomers work in desktop tools such as TOPCAT.

**Why it isn't Tycho itself:** Tycho is a utility app, a tool; this is a guided experience around one dataset. It builds on what Tycho builds: the density plot (Tycho's `PLAN.md`, "A density plot linked to the table"), the tall table, and the DuckDB engine.

---

## What it shows

- **The Kirkwood gaps:** semi-major axis (a) against eccentricity (e) for every asteroid; the empty bands at Jupiter's resonances (3:1, 5:2, 7:3, 2:1) appear without any simulation. Wolfram's version: [Analyze Kirkwood gaps in the asteroid belt](https://wolfram.com/language/12/astronomy-and-space-science-entities/analyze-kirkwood-gaps-in-the-asteroid-belt.html?product=language).
- **The belt moving:** each asteroid on its Kepler orbit, a time slider speeding years into seconds.
- **The frame rotating with Jupiter:** the Hildas trace a triangle and the Trojans sit in two clouds ahead of and behind Jupiter. Wolfram reaches it by N-body integration ([Perform N-body simulations of asteroids](https://wolfram.com/language/12/astronomy-and-space-science-entities/perform-n-body-simulations-of-asteroids.html?product=language)); Kepler orbits and a rotating camera reproduce the picture, accurate enough for decades either side of the elements' epoch. N-body is for long-term effects (how resonances hold the groups), which the view doesn't need.
- **Linked to the table:** select a region (a box on the a–e plot, a ring, or a lasso over frozen points) and the table shows those rows; click an asteroid and the table jumps to it.

**Extras, once it moves:** color by class, NEO, or potentially hazardous (columns the file has); size by diameter; Earth's and Jupiter's orbits drawn; click an asteroid to trace its whole orbit; search a name ("Ceres") and fly to it; a histogram of a with the resonances labelled; a date picker ("where was it on your birthday").

---

## Phases, each with an exit

1. **The density plot, in Tycho** (Tycho's long-term goal): DuckDB bins, drawn as an image in GPUI, zoom, box selection into the table, click to jump. It already shows the Kirkwood gaps, statically. Low risk, useful for any file. The showcase can stop here and still be worth having.
2. **Spike: a custom GPU surface beside GPUI.** GPUI draws quads, paths, and glyphs, with no public API for a custom shader (check the pinned source; this is from memory). The likely route is a second WebGPU canvas driven from Rust (wgpu), stacked under or over GPUI's in the DOM, at bounds GPUI publishes (as it publishes Playwright targets). Answer: how input reaches the right canvas, whether the two stay in step frame to frame, and what a second GPU stack adds to first paint and the wasm's size.
3. **The moving belt:** the orbital elements, a Kepler shader evaluating every asteroid's position each frame (1.5 M points at 60 fps is within an ordinary GPU's reach), the time slider, the rotating frame, picking.

**Why a shader, not Rust:** solving Kepler's equation for 1.57 M asteroids per frame on one thread is likely 50–100 ms, too slow; threads (the pages are cross-origin isolated) might bring it near a frame, but marginally.

---

## Data

Positions need all six orbital elements and their epoch: a, e, i (in Tycho's asteroid file) plus the ascending node (om), the argument of perihelion (w), the mean anomaly (ma), and the epoch (not in it). JPL's query API serves them, so it's a refetch, with the same pinned-file rules as Tycho's samples (`apps/tycho/docs/data.md`).

Size (estimates, to measure):
- Four more doubles for 1.57 M rows: ~50 MB raw, and floats compress poorly.
- Six elements as 32-bit floats, plenty for drawing: ~37 MB.
- Quantized to 16 bits: ~19 MB.

So the orbit view likely gets its own compact binary file, apart from the table's Parquet, served the way its home serves large files (Tycho's R2, for one).

---

## Open questions

- **Its home:** a path on Tycho's subdomain (`tycho.seiza.io/<name>`, sharing its Worker, R2, and engine), a subdomain of its own, or a path on the apex. And whether it's an app directory of its own, which would make it the first of a new tier (a showcase: built on components and engines like a utility app, held to TTFP and its own budgets, but an experience around one dataset, not a tool) and change the root `CLAUDE.md`'s "Tiers".
- **Lasso selection:** picking moving points means freezing time, picking on the GPU, reading row ids back, and handing them to DuckDB as a temporary table. Whether it's worth it beside region selection, which is a `WHERE` clause.
- **The epoch's spread:** whether JPL's elements share one epoch for most objects, or each needs propagating from its own.
