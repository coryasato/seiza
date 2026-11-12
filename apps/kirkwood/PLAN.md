# PLAN.md — Kirkwood

What's next for Kirkwood: milestone status, the active milestone's "done when" checks, the milestones after it, long-term goals, and open questions. Only what's still open lives here. Context and rules are in `CLAUDE.md` here and at the repo root.

**Goal:** the asteroid belt as a scene to fly through, drawn from the asteroid table's own rows, with the table of those rows beside it, each moving the other. In a sentence a visitor could repeat: **every dot is a row.**

**No deciding metric:** Kirkwood is a showcase (root `CLAUDE.md`, "Tiers"), exempt from the budgets, the measurement protocol, and the results notes. It still paints something first and loads the scene after. A milestone's checks are things to see on screen; where a check asks for a number, the number is recorded with the decision it settles (`docs/DECISIONS.md`), not gated.

**Success:** someone with no astronomy stays two minutes, does one thing that delights them, and leaves knowing the table was real.

**Where everything else lives:**
- [`../../docs/research/asteroid-belt.md`](../../docs/research/asteroid-belt.md): the research: what the scene shows, what the table does, what's honest to simulate, the data it needs.
- [The storyboard](https://claude.ai/artifact/Vpx3w9Jb6EAW5RFJbLKKoi): seven boards, reviewed 2026-11-10. Each milestone below names the boards it builds; the canvas's notes say which parts of them are placeholders.
- [`docs/DECISIONS.md`](docs/DECISIONS.md): every decision, by area. Repo-wide ones (the showcase tier, its home): the root [`docs/DECISIONS.md`](../../docs/DECISIONS.md).
- [`docs/data.md`](docs/data.md): the fetch (its source, fields, and frame), the two files built from it, Jupiter's orbit, and what the files' places were checked against.
- [`docs/milestones.md`](docs/milestones.md): the specs, checks, and evidence of finished milestones.
- [`docs/LESSONS.md`](docs/LESSONS.md): what each milestone taught us.

---

## Status

| Milestone | Title | Status |
|---|---|---|
| M0 | The two canvases: a spike | Done 2026-11-11 ([`docs/milestones.md`](docs/milestones.md)) |
| M1 | The orbits' data | Done 2026-11-11 ([`docs/milestones.md`](docs/milestones.md)) |
| M2 | The belt in space | Done 2026-11-11 ([`docs/milestones.md`](docs/milestones.md)) |
| M3 | The reveal: sort by orbit size | Active: part A next |
| M4 | Ride with Jupiter, and a gap picked | Planned |
| M5 | The scene and the table, each moving the other | Planned |
| M6 | In the open: deployed under Tycho | Planned |

A *Planned* row's outline is under "Next milestones". Its spec, "done when" checks, and parts are written when the milestone before it closes, from what that one found.

**Closing a milestone:** every "done when" check passes, with its evidence (a screenshot, a recording, or a number) beside it; new decisions are in `docs/DECISIONS.md`; a `docs/LESSONS.md` entry is written; and the milestone's spec and evidence move from here to the end of `docs/milestones.md`, leaving one row above. No results note and no `report`: a showcase has no budgets.

**Waiting on** (features of a component or engine this app needs; only that crate's `PLAN.md` builds them, and the session that closes one flips its row to *Ready*):

| Needs | For | Status |
|---|---|---|

Nothing. The tall table's `live`, `sort`, and `select` are built, and with the rows held in Rust a filter to a drawn group and a sort are both the delegate's work, an index it reads its pages through: the spike's filter needed nothing new (`docs/DECISIONS.md`, "Table"). Nothing is asked of `engines/duckdb/`: the app doesn't use it.

---

## Active milestone

### M3: The reveal: sort by orbit size

Boards 3 and 4, as drawn. "Sort by orbit size" flies every dot from its place in space into a against e, the gaps open as they land, and the layout has its furniture. And the way back to space.

**The action.** One button beside the time control, "Sort by orbit size", as board 1 draws the row; pressed, it takes the board's pressed fill (board 4), and pressed again it flies the dots back. The row's other two actions arrive with their milestones (M4, M5): until then the row is this one button.

**The flight** is the decided one (`docs/DECISIONS.md`, "Scene", the sort flight), built anew: the crate holds its progress (0 in space, 1 landed, 3 s end to end), the scene asks for it each frame, and the vertex shader places each dot between its place in space and its place on the axes, the inner belt leaving first, so the columns build from the left (board 3). No buffer is rewritten. Landed, the scene draws nothing until something changes.

**The axes** are board 4's: a from 1.5 to 5.5 au across and e from 0 to 0.6 up, in a 1440×900 window from 80 px to 1360 across and from 771 px up to 96, inset the same from the edges of what the panel leaves at any size. A row outside them (its a or its e) has no place on the layout: it fades out on the way and back in on the return, and the page counts what's left, bottom right, as board 4 does: "<n> of 1,580,272 rows in view", counted by the crate from the elements.

**The furniture** is GPUI's, as board 4 draws it: the two axis lines with a tick and its number every 0.5 au and every 0.1; "a, the orbit's size (au)" under the plot and "e, how stretched the orbit is" at its top left; a chip over each gap (3:1, 5:2, 7:3, 2:1), each with its faint white line down into the dots; "Hildas, 3:2" and "Trojans, 1:1" beside their groups; and the line over the chips. It is at 0.45 of its opacity while the dots fly (board 3) and whole once they land. A gap's place is computed from Jupiter's own a (`orbit.rs`), by Kepler's third law, never typed.

**What M3 leaves to M4:** picking a gap. Board 4's chips are buttons and its line ends "Pick a gap."; in M3 the chips are labels that take no press, and the line reads "Orbits in step with Jupiter are missing." M4 makes them buttons and adds the sentence.

**What leaves the picture on the way:** the sky, the Sun, Jupiter, its orbit's line, their names, and the page's line about the stars fade out as the dots leave space and return with them. The line about dot sizes stays: it's still true.

**To decide in part A, by eye:** a landed dot's size, brightness, and haze (in space they follow H and the two distances; on the axes there is no distance, and the gaps must stay dark); and what the press does to time: boards 3 and 4 draw the time control paused, and the spike let the clock run on unseen.

**Split into parts,** one session each:

- **Part A: the flight and the landing.** The crate's progress and the layout's place for a row; the shader's flight, tested as its place in space is (`shader.rs`); the landed look; what leaves and returns; time, decided. Closes A1 to A4.
- **Part B: the furniture, the count, and the close.** The action, the axes and their words, the chips, the count of rows in view, the panel open; M4's spec. Closes B1 to B4.

**Done when:**

- [ ] **A1. The flight:** a press flies every dot to the axes in 3 s, the inner belt first, and a second press flies them back. Screenshots mid-flight and landed, beside boards 3 and 4; the frames a second during the flight, recorded; landed, the scene draws nothing.
- [ ] **A2. A dot lands on its own a and e.** Three rows drawn alone (Ceres, Vesta, Hektor) are each within a pixel of where the crate puts their a and e on the axes, with a control that fails; and the shader's flight, run in 32-bit floats for every row in view, lands no row a pixel off.
- [ ] **A3. The gaps are open.** From the landed screenshot, the dust at 2.50, 2.82, 2.96, and 3.28 au is darker than a tenth of an au either side, as numbers; and each is where Jupiter's a puts its resonance.
- [ ] **A4. What isn't a row leaves and returns:** the sky, the Sun, Jupiter, its orbit, their names, and the stars' line are gone when the dots land and back when they return, in screenshots. What the press does to time is decided, and the time control says it.
- [ ] **B1. The furniture is board 4's:** the axes, ticks, and numbers, the two labels, the four chips with their lines, the Hildas' and Trojans' names, and the line over the chips, each where the board has it at 1440×900 (a screenshot beside the board), dimmed mid-flight as board 3 has it. The chips take no press.
- [ ] **B2. The count in view is counted:** "<n> of 1,580,272 rows in view" from the elements, checked against a count from the file's own bytes.
- [ ] **B3. The action and the panel:** the button's two states as the boards draw them; with the panel open the axes sit in what it leaves, and a dot still lands on its a and e there; a wheel over the landed layout does what's decided (nothing, or the way back).
- [ ] **B4. M4's spec, checks, and parts are written** here.

---

## Next milestones

Outlines, each specced when the one before it closes.

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

- **The panel as glass:** built behind `?glass` (`docs/DECISIONS.md`, "Table"): the panel's fill at 0.6 over the scene blurred behind it, for 2.7 frames a second of 30 with time running. From the opening camera only thin sky lies under the panel, so it can't be judged yet. Whether it ships, and at what fill and blur, by eye, once a camera flies in with the panel open and dust and stars are under it: the rows' contrast there is the thing to judge. Until then the knob stays, off unless asked for, and it is the first thing cut if the frame rate needs the room. *M5, with the fly-in.*
- **A control for the scene's resolution:** the scene ships at the display's resolution, 29 frames a second while time runs on an M1, and three quarters draws 41 (`docs/DECISIONS.md`, "Scene"). The visitor gets the trade, as Three.js scenes commonly offer. Decided: the control is GPUI's (one hit test already routes every input; a DOM pane over both canvases would have to be routed around). First a few named steps over what `?scale` turns; then, as a second step, the scene holding a frame rate by stepping its own resolution down, the control its override. To decide when it's built: the steps and their names, where it sits, and whether the choice is kept between visits. *Not placed in a milestone yet; before M6.*
- **The look at DPR 1:** the look was chosen at DPR 2. At DPR 1 (headless Firefox and WebKit) the stars are much more of the picture: a star 1.1 px across is one whole pixel at the middle of its profile. Whether a star's and a dot's light should follow the pixels they cover, chosen by eye on a display of that kind. *M6, with the check in Firefox and Safari.*
- **A sort's stall:** ordering every row takes a third to two thirds of a second on one thread (`docs/DECISIONS.md`, "Table"), in one task, as the pick does. Whether it runs in a worker, is spread over frames, or the orders ship in the file. *M5, with the pick's stall.*
- **The page's memory:** every row held is most of the wasm's memory (`docs/DECISIONS.md`, "Table"): the two files are 90.5 MB held as they arrive. What a phone makes of it; the diameter and albedo as a list of the rows that have one would take 11 MB out (`docs/DECISIONS.md`, "Data"). *M6, with the phone's answer.*
- **The clock's reach once the resonant groups are integrated:** it stops at 1976 and 2076 because Kepler orbits lose the Trojans' clouds past that (`docs/DECISIONS.md`, "Scene"). Whether the integration lets it go further, and whether the time control should run backward as well as on. *M4.*
- **The credits on the page:** the README credits JPL and ESA, and the page names Gaia in a line; ESA's full acknowledgement and JPL's credit aren't on screen. Where they go (an about line, a corner). *M6, before it's in the open.*
- **A lost WebGL context:** the belt's buffers are the scene's own, filled a block at a time from views over the wasm's memory, so a context restored by the browser would come back with no belt. To handle: new buffers, and every block handed over again on the restore (the elements' address holds). *M6, before it's in the open.*
- **The Hildas and the Trojans are faint:** 8,400 and 16,472 dots of 1.58 M. The spike's shots brightened them sixfold and twofold to show their shapes, and the storyboard's board 2 no longer brightens them. What the frame that turns with Jupiter does so the triangle reads: gray the rest (as a picked group does), brighten the two groups, or both. *M4.*
- **Which Hildas librate:** the rows from 3.7 to 4.2 au, 8,400, of which the resonance's angle holds 8,045 at the epoch (`docs/DECISIONS.md`, "Scene"). Whether the integration moves all 8,400 or only those it finds swinging. *M4.*
- **More live columns:** the Sun's distance is live, at 2 a second. Which others join it (the distance from Earth needs Earth's place), and how many decimals a live cell shows. *M5.*
- **The clock's speed with the table open:** at a year a second the Sun's distance moves by up to half an au a second, so its last two decimals are never readable while time runs, at any refresh rate. Whether time slows while the table shows, the column drops decimals while it moves, or it's left as a blur that settles on pause. *M5.*
- **The pick's stall:** placing 1.57 M rows to pick a shape's takes about 0.4 s in one task at the release. How it's taken off the frame: the rows' rotation computed once, a worker, or spread over the frames the outline closes in. *M5.*
- **A shape drawn in a against e:** the spike takes a shape in space only. Picking a gap's edge on the landed layout is the natural next ask. *M5.*
- **A Worker of its own on the path:** whether a second Worker can take `/kirkwood/*` on a hostname bound to Tycho's as a custom domain. *M6.*
- **The Milky Way as a band:** at G 10.5 the stars crowd toward it and no more; a band needs a deeper cut (3.1 M stars under G 12, about 25 MB). Whether it's worth its bytes. *Not planned.*
- **A shape drawn across the panel:** a drag that leaves the scene's surface for the panel stops adding points until it comes back (a release there still closes the shape). Whether the panel should let it through. The spike's fly-in left it as it was: a release over the panel closes the shape, and the group is what the closed shape holds. *M5.*
- **A phone:** whether the scene and a summoned table work at phone width, or the app says it's for a larger screen. *M6.*
