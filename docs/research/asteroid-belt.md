# Research: Kirkwood, the asteroid belt as a showcase

Kirkwood is a showcase (root `CLAUDE.md`, "Tiers"): an app for fun, not a tool and not a comparison. The asteroid belt as a scene to fly through, drawn from the asteroid table's own rows, with the table of those rows beside it, each moving the other. Drafted 2026-10-23 in a planning discussion and re-scoped 2026-11-10 (root [`docs/DECISIONS.md`](../DECISIONS.md), "Repo structure"). **Nothing here is built or measured**: every number below is an estimate until a spike says otherwise. Its plan is [`apps/kirkwood/PLAN.md`](../../apps/kirkwood/PLAN.md).

**The goal, in a sentence a visitor could repeat: every dot is a row.** 1.57 million asteroids in a scene and the same 1.57 million in a table, and touching one moves the other. Picture a space map summoned in a film: zoom to a region, draw around some of what's there, and the data comes back, here as the table's rows.

**What success looks like:** someone with no astronomy stays two minutes, does one thing that delights them, and leaves knowing the table was real. That counts for more than completeness.

**Named for Daniel Kirkwood,** a mathematician who found the gaps in the asteroid belt in the 1860s in a catalog of orbits, not through a telescope: certain orbit sizes were missing from the table. The app's best moment re-enacts it.

---

## Why it's its own app

- **Not the observatory:** that page compares a component with a DOM equivalent, and it's where GPUI is evaluated. A DOM table can't draw 1.57 M moving points without WebGL, which takes the DOM out of it.
- **Not Tycho:** Tycho is a utility app, a tool for any file. Kirkwood is one dataset and an experience around it. The two share the tall table and nothing else decided so far: the density plot once planned for both is withdrawn ([`density-plot.md`](density-plot.md), kept as a record).
- **No measuring rules:** time to first paint and the measurement protocol aren't its point. It still paints something first and loads the scene after, so nobody watches a blank page while the data arrives.

---

## What the table does

The table is the scene's instrument panel. Four links, all decided as goals 2026-11-10:

- **Row to scene:** click a row (Ceres) and the camera flies to it; sort by diameter and the top rows are a tour of the biggest.
- **Scene to rows:** click a dot or draw around a group, and the table filters to those rows. Filtering, not jumping: a group's rows are scattered through the file, so a jump shows one of them and a filter shows all. A click on one dot filters to its row, with a way back to the whole table at that row. A drawn group keeps its color while the rest of the belt goes gray, and the camera then flies in until the group fills the scene, where its biggest bodies get names (chosen 2026-11-10 from three storyboard alternatives). To try: the table coming in with that zoom. Time pauses while a shape is drawn, and the shape is freehand, as the storyboard draws it (decided 2026-11-10).
- **Live cells:** as time runs, columns computed from the orbit (distance from the Sun, from Earth) change for every row. The table's `live`, `sort`, and `select` features at a scale a DOM table struggles with.
- **The reveal:** "sort by orbit size" flies the dots from their places in space into semi-major axis (a) against eccentricity (e), and the gaps open as they land.

A selection is a set of rows, not a region: the asteroids drawn around stay lit as time runs and they drift apart, and the table keeps showing them. A shape drawn on the screen picks everything under it through the scene's whole depth: natural from above the belt, looser with the camera tilted, and accepted over selecting a volume.

---

## What the scene shows

- **The belt in space:** every asteroid on its orbit, a time control speeding years into seconds.
- **The frame rotating with Jupiter:** the Hildas trace a triangle and the Trojans sit in two clouds ahead of and behind Jupiter. Wolfram's version integrates them under the Sun and Jupiter alone ([Perform N-body simulations of asteroids](https://wolfram.com/language/12/astronomy-and-space-science-entities/perform-n-body-simulations-of-asteroids.html?product=language)).
- **The Kirkwood gaps:** not visible in space. They're gaps in semi-major axis, and eccentricity smears each orbit across its neighbors, so the belt from above is a filled ring. They appear only in the a–e layout (the empty bands at Jupiter's resonances: 3:1, 5:2, 7:3, 2:1; Wolfram's: [Analyze Kirkwood gaps in the asteroid belt](https://wolfram.com/language/12/astronomy-and-space-science-entities/analyze-kirkwood-gaps-in-the-asteroid-belt.html?product=language)), which is why the transition between the two layouts is the show: one set of points, two arrangements.
- **A gap, explained by playing:** pick a gap ("3:1 with Jupiter") and a marker asteroid is dropped there; in the rotating frame its path closes into a loop, because it meets Jupiter at the same places every time.
- **Color is orbit size** (decided 2026-11-10, from the storyboard): every dot is tinted by its own a, rose at the inner edge through pale gold and blue to violet at the Hildas and green at the Trojans, with dense dust washing toward white. In space it reads as rings, warm inside and blue outside, since a dot's distance stays near its a; landed in a–e, the same colors stand in order, and the Hildas and Trojans tell apart without extra brightness. The exact ramp is the canvas's (its color note, in oklch), a stand-in until the scene is built. With it: white for what the interface adds (a drawn shape's outline, the marker and its loop; kept on review).

**Scene first:** the scene fills the window on load and the table is summoned, with a handle that says it's there (its row count). The app lives at a path under Tycho's subdomain (`tycho.seiza.io/kirkwood`), with Tycho the landing utility: it shows what Tycho's table can be used for (decided 2026-11-10; root [`docs/DECISIONS.md`](../DECISIONS.md), "Hosting").

**No tour on load.** A visitor opts in. The suggestion on screen is a few one-press actions ("Sort by orbit size", "Ride with Jupiter", "Find Ceres"), each one beat of a tour, taken in any order or not at all. They sit as a row of buttons beside the time control, as the storyboard draws them (settled 2026-11-10).

**Extras, once it moves** (none committed): a second coloring by class, NEO, or potentially hazardous; size by diameter; Earth's and Jupiter's orbits drawn; an asteroid's whole orbit traced on a click; a search by name; a date picker.

---

## What's honest to simulate

- **Not the gaps forming:** that takes millions of years, and N-body over 1.57 M bodies isn't feasible in a tab.
- **Kepler orbits for the whole belt:** each position computed from its elements every frame. Over decades either side of the elements' epoch it looks the same as an integration.
- **A real integration for the resonant groups only:** the Hildas and Trojans, thousands of massless particles under the Sun and Jupiter, as Wolfram does it. Small enough to run in Rust, and they're the groups where Jupiter's pull is the story.
- **The belt is empty.** At true scale an asteroid is an invisible speck millions of km from the next; a film's dense rock field is fiction. The honest look is glowing dust at the belt's scale, sizes exaggerated and said so. Up close, a few bodies (Ceres, Vesta) can be real; the rest have no shapes on file, so any close-up rock is invented and labeled as illustration.

---

## How it might be built

Leaning, not decided; the plan's spike decides.

- **The scene: Three.js on its own canvas,** beside GPUI's. GPUI has no custom-shader API on the web (checked for the density plot: `paint_surface` is macOS and iOS only), and Three.js brings the cinematic layer ready-made: bloom, a glowing Sun, a textured Jupiter, trails, depth of field, camera moves. The belt is one draw: 1.57 M points whose shader solves each orbit on the GPU. Weighed: Bevy (the look, but megabytes of wasm) and raw wgpu (all Rust, and the cinematic layer written by hand).
- **The engine: Rust.** It owns the orbital elements and their buffers (the scene reads them through a view over wasm memory, no copy), the clock and reference frame, the integration of the resonant groups, the selection (which rows a drawn shape holds), and the link to the table.
- **The interface: GPUI,** with the tall table as its center. Where its canvas sits against the scene's, and whether its menus and tooltips can draw over the scene, is the spike's first question.
- **The rows, probably in memory.** One fixed dataset, not any file: holding it in Rust would make a selection's rows, a sort, and live cells immediate, and might mean no DuckDB at all. Its size with the text columns isn't known yet.

**Why the orbit math is the GPU's:** solving Kepler's equation for 1.57 M asteroids per frame on one thread is likely 50–100 ms. A selection needs the positions once, not per frame, so Rust can afford it there.

---

## Data

Positions need all six orbital elements and their epoch: a, e, i (in Tycho's asteroid file) plus the ascending node (om), the argument of perihelion (w), the mean anomaly (ma), and the epoch (not in it). JPL's query API serves them, so it's a refetch, with the same pinned-file rules as Tycho's samples (`apps/tycho/docs/data.md`).

Size (estimates, to measure):
- Four more doubles for 1.57 M rows: ~50 MB raw, and floats compress poorly.
- Six elements as 32-bit floats, plenty for drawing: ~37 MB.
- Quantized to 16 bits: ~19 MB.

So the scene likely gets its own compact binary file, apart from the table's Parquet.

**Not Gaia.** A second map of the 25 M stars was weighed 2026-11-10 and decided against: 16 times the points, a table that can't live in memory (so the engine and the sparse-selection problem come back), and nothing that moves to play with. The app is the asteroid belt.

---

## What came of it

The plan is [`apps/kirkwood/PLAN.md`](../../apps/kirkwood/PLAN.md), written 2026-11-10: the spike and the sizing of the rows are its first milestone, and the open questions moved there. The decisions made here and at the storyboard's review are in [`apps/kirkwood/docs/DECISIONS.md`](../../apps/kirkwood/docs/DECISIONS.md), and its home in the root [`docs/DECISIONS.md`](../DECISIONS.md), "Hosting".

**The storyboard** is [a design canvas](https://claude.ai/artifact/Vpx3w9Jb6EAW5RFJbLKKoi) of seven boards, drawn and reviewed 2026-11-10: the space view on load, the frame rotating with Jupiter, mid-transition, the gaps landed, a gap picked, a group drawn around, and the fly-in with the table open. Its dots are the sample's real a, e, and i; its notes say which parts are placeholders (the angles, so every position in space, and the look, a flat render). The withdrawn plot's boards were removed from the canvas the same day.
