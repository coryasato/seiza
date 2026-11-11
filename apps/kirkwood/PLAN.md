# PLAN.md — Kirkwood

What's next for Kirkwood: milestone status, the active milestone's "done when" checks, the milestones after it, long-term goals, and open questions. Only what's still open lives here. Context and rules are in `CLAUDE.md` here and at the repo root.

**Goal:** the asteroid belt as a scene to fly through, drawn from the asteroid table's own rows, with the table of those rows beside it, each moving the other. In a sentence a visitor could repeat: **every dot is a row.**

**No deciding metric:** Kirkwood is a showcase (root `CLAUDE.md`, "Tiers"), exempt from the budgets, the measurement protocol, and the results notes. It still paints something first and loads the scene after. A milestone's checks are things to see on screen; where a check asks for a number, the number is recorded with the decision it settles (`docs/DECISIONS.md`), not gated.

**Success:** someone with no astronomy stays two minutes, does one thing that delights them, and leaves knowing the table was real.

**Where everything else lives:**
- [`../../docs/research/asteroid-belt.md`](../../docs/research/asteroid-belt.md): the research: what the scene shows, what the table does, what's honest to simulate, the data it needs.
- [The storyboard](https://claude.ai/artifact/Vpx3w9Jb6EAW5RFJbLKKoi): seven boards, reviewed 2026-11-10. Each milestone below names the boards it builds; the canvas's notes say which parts of them are placeholders.
- [`docs/DECISIONS.md`](docs/DECISIONS.md): every decision, by area. Repo-wide ones (the showcase tier, its home): the root [`docs/DECISIONS.md`](../../docs/DECISIONS.md).
- [`docs/milestones.md`](docs/milestones.md): the specs, checks, and evidence of finished milestones.
- [`docs/LESSONS.md`](docs/LESSONS.md): what each milestone taught us.

---

## Status

| Milestone | Title | Status |
|---|---|---|
| M0 | The two canvases: a spike | In progress: parts A and B done, part C next |
| M1 | The orbits' data | Planned |
| M2 | The belt in space | Planned |
| M3 | The reveal: sort by orbit size | Planned |
| M4 | Ride with Jupiter, and a gap picked | Planned |
| M5 | The scene and the table, each moving the other | Planned |
| M6 | In the open: deployed under Tycho | Planned |

A *Planned* row's outline is under "Next milestones". Its spec, "done when" checks, and parts are written when the milestone before it closes, from what that one found.

**Closing a milestone:** every "done when" check passes, with its evidence (a screenshot, a recording, or a number) beside it; new decisions are in `docs/DECISIONS.md`; a `docs/LESSONS.md` entry is written; and the milestone's spec and evidence move from here to the end of `docs/milestones.md`, leaving one row above. No results note and no `report`: a showcase has no budgets.

**Waiting on** (features of a component or engine this app needs; only that crate's `PLAN.md` builds them, and the session that closes one flips its row to *Ready*):

| Needs | For | Status |
|---|---|---|

Nothing yet. The tall table's `live`, `sort`, and `select` are built, and a filter to a drawn group's rows is the delegate's work if the rows are in memory: the spike's filter needed nothing new (`docs/DECISIONS.md`, "Table"). M0's part C says whether the rows' source changes that.

---

## Active milestone

### M0: The two canvases: a spike

Throwaway code that answers what the storyboard assumes, before anything is built to keep. The belt in a Three.js canvas, fed from a Rust-owned buffer of orbital elements, with a GPUI canvas holding the tall table over the same rows. The elements are the asteroid sample's real a, e, and i with seeded random angles, as the storyboard's were: real positions are M1's.

The spike lives in `spike/` and is never deployed. What it proves is written down as decisions; its code is not carried forward.

**Split into parts,** one session each (root `CLAUDE.md`, "Working agreements"):

- **Part A: the two canvases standing.** The scene (1.57 M points, each orbit solved in the shader, colored by a) and a GPUI canvas with the table over rows held in Rust. Closes A1 to A4.
- **Part B: the moves.** The three things a still board can't show, tried on the spike: the sort transition, the fly-in with the table coming in, and a live column. Closes B1 to B3.
- **Part C: the rows' source, and the close.** The rows sized in memory against a table over DuckDB; the stack decided; M1's spec written. Closes C1 to C3.

**Done when:**

- [x] **A1. GPUI over the scene.** Whether GPUI's canvas can sit over the Three.js canvas with the scene showing through around a panel (boards 1 and 7: the handle tab on the right edge, the table panel on the right), and whether the table's menus and tooltips draw over the scene. Shown in a screenshot. If it can't, the layout that replaces it is decided (weighed already: the table as a layer under the scene that toggles front and back).
  *It can, with the canvas's alpha mode set on the page and the window's background token transparent: [on load](docs/spike/on-load.jpg), [the panel and a menu](docs/spike/menu.jpg), [a tooltip](docs/spike/tooltip.jpg), and the control, [the canvas as GPUI configures it](docs/spike/opaque.jpg). Chromium, WebKit, and Firefox, headless. `docs/DECISIONS.md`, "Table".*
- [x] **A2. Input reaches the right canvas.** A drag on the scene draws a freehand shape; a wheel over the scene zooms it and a wheel over the table scrolls it; the table's hover, selection, and scrollbar work with the scene behind. How it's routed is written down.
  *GPUI's hit test routes it; all ten input checks pass in the three browsers (`spike/run.ts --only input`), and [the shape](docs/spike/shape.jpg). `docs/DECISIONS.md`, "Input".*
- [x] **A3. Frame time with both drawing,** recorded at rest, with time running, and while the table flings. A number for each, in `docs/DECISIONS.md`.
  *At rest 16.7 ms a frame, none late; time running, 32% of frames late (the GPU: about 45 frames a second, the main thread idle); the table flinging over a still scene, none late; both, 37%. Half the scene's resolution, or three quarters of its rows, holds 60. `docs/DECISIONS.md`, "Scene".*
- [x] **A4. What Three.js adds in bytes** (brotli), as the spike imports it, recorded with the decision to keep or replace it.
  *104.3 KiB (523.1 raw), after first paint; kept for now. `docs/DECISIONS.md`, "Scene".*
- [x] **B1. The sort transition moves:** 1.57 M points fly from space to a against e and back, with the frame time during the flight recorded.
  *It moves, in the shader, on one number from Rust: [mid-flight](docs/spike/sort-mid.jpg), [landed, the gaps open](docs/spike/sort-landed.jpg), and back. 24% of the flight's frames late out and 17% back at the display's resolution (the GPU, as with time running), none at half the scene's; main-thread work 0.8 ms a frame. Chromium, Firefox, and WebKit (`spike/run.ts --only moves`). `docs/DECISIONS.md`, "Scene".*
- [x] **B2. The fly-in:** after a shape closes, the camera flies in to the group while the table comes in beside it, filtered to the group's rows. Decides whether the table arrives with the zoom or after it.
  *Built both ways and measured: [mid-flight](docs/spike/fly-mid.jpg), [flown in](docs/spike/fly-in.jpg). A shape's 150,500 rows are picked in 0.36 to 0.42 s, the rest go gray, the outline stays around the group, the table is over its rows, and time stays paused. The table arrives with the zoom: chosen on the board, the numbers (4.1 ms of main-thread work a frame against 0.8; at half resolution 10% of frames late against 3%), and the owner's look at both in a browser. `docs/DECISIONS.md`, "Scene", "Table".*
- [x] **B3. A live column a person can read:** the distance from the Sun, recomputed as time runs, at a refresh rate chosen by looking at it. Decides which columns are live and how often they refresh; the cells never change faster than someone can follow.
  *`sun_au`, a redraw of the table at the column's rate; no rate costs a frame. 2 a second, picked by the owner looking at 1, 2, 4, 10, and as fast as a timer goes (the panel's "Live" button). It's the one live column until M5. `docs/DECISIONS.md`, "Table".*
- [ ] **C1. The rows in memory:** the 1.57 M rows with their text columns held in Rust: bytes in memory, bytes on the wire, and time to the table's first rows, against the same table over DuckDB. Decides the table's source, and with it how a filter to a group's rows is read.
- [ ] **C2. The stack is decided** in `docs/DECISIONS.md`: the scene's renderer, who owns the clock and the selection, the rows' source, and how the two canvases are laid out.
- [ ] **C3. M1's spec, checks, and parts are written** here, and `CLAUDE.md`'s stack and layout say what M0 decided.

---

## Next milestones

Outlines only. Each is specced when the one before it closes.

### M1: The orbits' data

Positions need all six orbital elements and their epoch; Tycho's asteroid file has a, e, and i. Refetch the node, the argument of perihelion, the mean anomaly, and the epoch from JPL, under the pinned-file rules Tycho's samples follow (`apps/tycho/docs/data.md`), and build the scene's compact binary file beside the table's rows. Answers the epoch's spread and the file's size (the research estimates 19 to 50 MB by precision). Its plainest check: with real elements and no placement by hand, the Hildas form their triangle and the Trojans sit ahead of and behind Jupiter, which the storyboard had to fake.

### M2: The belt in space

Board 1, as an app: the crate, the web host, and a page that paints first and loads the scene after. Every asteroid on its Kepler orbit, a time control (run, pause, the date, the speed), color by orbit size with its legend, the Sun and Jupiter, the line that says dot sizes are exaggerated, and the table behind its handle, opening as a panel over every row.

### M3: The reveal: sort by orbit size

Boards 3 and 4: "Sort by orbit size" flies every dot from its place in space into a against e, the gaps open as they land, and the layout has its furniture (axes in plain words, a chip on each gap, the count of rows in view). And the way back to space.

### M4: Ride with Jupiter, and a gap picked

Boards 2 and 5: the frame that turns with Jupiter, the Hildas and Trojans integrated for real under the Sun and Jupiter (in Rust; the rest of the belt stays on Kepler orbits), and a gap picked: a marker dropped there, its path closing into a loop, and the card that says why.

### M5: The scene and the table, each moving the other

Boards 6 and 7, and the links the storyboard didn't draw. Scene to rows: a freehand shape drawn with time paused, its dots keeping their color while the rest go gray, the fly-in, the biggest bodies named, the table filtered to the group, and the way back to every row; a click on one dot. Row to scene: a click on a row flies the camera to it ("Find Ceres"); a sort by diameter is a tour of the biggest. And the live columns.

### M6: In the open: deployed under Tycho

At `tycho.seiza.io/kirkwood`, served by Tycho's Worker (root `docs/DECISIONS.md`, "Hosting"): whether a Worker of its own can take the path, the data's place in R2, and a link from Tycho. The canvas tradeoffs said in the README (rule 4), a check in Firefox and Safari, and the answer for a phone.

---

## Long-term goals

None committed (the research's "Extras"):

- A second coloring: by class, near-Earth, or potentially hazardous.
- Size by diameter.
- Earth's orbit drawn; an asteroid's whole orbit traced on a click.
- A search by name, and a date picker.
- Up close, the few bodies with real shapes (Ceres, Vesta) drawn as themselves; any other close-up rock is invented and labeled as illustration.

## Open questions

- **The table's source:** in memory or DuckDB, and with it how a filter to a group's rows is read. *M0, C1.*
- **More live columns:** the Sun's distance is live, at 2 a second. Which others join it (the distance from Earth needs Earth's place), and how many decimals a live cell shows. *M5.*
- **The clock's speed with the table open:** at a year a second the Sun's distance moves by up to half an au a second, so its last two decimals are never readable while time runs, at any refresh rate. Whether time slows while the table shows, the column drops decimals while it moves, or it's left as a blur that settles on pause. *M5.*
- **The pick's stall:** placing 1.57 M rows to pick a shape's takes about 0.4 s in one task at the release. How it's taken off the frame: the rows' rotation computed once, a worker, or spread over the frames the outline closes in. *M5.*
- **A shape drawn in a against e:** the spike takes a shape in space only. Picking a gap's edge on the landed layout is the natural next ask. *M5.*
- **The epoch's spread:** whether JPL's elements share one epoch for most objects, or each needs propagating from its own. *M1.*
- **The a against e furniture:** how much of board 4 is kept as drawn (liked on review, not yet specced). *M3.*
- **A Worker of its own on the path:** whether a second Worker can take `/kirkwood/*` on a hostname bound to Tycho's as a custom domain. *M6.*
- **The scene's resolution:** all 1.57 M points at the display's full resolution ran past a frame on an M1 in headless Chromium; half resolution held 60. Which resolution ships, chosen by eye in a real browser. In screenshots at the display's pixels the two read as the same dust up close, the half-resolution grain and the Sun's edge softer; at half, every move holds 60 but the fly-in with the table arriving (10% of its frames late). *M2 decides.*
- **A shape drawn across the panel:** a drag that leaves the scene's surface for the panel stops adding points until it comes back (a release there still closes the shape). Whether the panel should let it through. The spike's fly-in left it as it was: a release over the panel closes the shape, and the group is what the closed shape holds. *M5.*
- **Rows with no ellipse:** 5 rows have e at or past 1 and aren't drawn. What the scene and the row count say about them. *M2.*
- **A phone:** whether the scene and a summoned table work at phone width, or the app says it's for a larger screen. *M6; M0 can show whether they fit.*
