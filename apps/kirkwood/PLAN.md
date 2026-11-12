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
| M3 | The reveal: sort by orbit size | Done 2026-11-12 ([`docs/milestones.md`](docs/milestones.md)) |
| M4 | Ride with Jupiter, and a gap picked | Active: part A next |
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

### M4: Ride with Jupiter, and a gap picked

Boards 2 and 5. "Ride with Jupiter" turns the frame with Jupiter, so Jupiter holds still and the belt's resonant groups show their shapes: the Hildas' triangle, the Trojans' two clouds. Those two groups move for real, integrated under the Sun and Jupiter. And a gap picked from the landed layout drops a marker there, whose path in the turning frame closes into a loop, with the card that says why.

**The action.** "Ride with Jupiter", the row's second button, with the states "Sort by orbit size" has. Pressed, the camera flies to straight above and the frame starts to turn with Jupiter; pressed again, the frame stops turning and the camera goes back where it was. Time keeps running (board 2's control reads "1 year a second"). The two actions don't hold together: a press on one while the other is pressed lets the other go first, and how that looks (the dots flying back before the frame turns, or both at once) is decided by eye in part A.

**The frame** is the scene's: every dot, the Sun, Jupiter's orbit, and the sky turned about the ecliptic's pole by Jupiter's own longitude, which the crate gives each frame with Jupiter's place (`orbit.rs`). One angle; no buffer is rewritten. Jupiter's orbit isn't a circle (e 0.048), so held still it moves in and out along its line by a quarter of an au each way over its 11.86 years: decided in part A whether the page says so or the frame's scale breathes to hide it. Whether the sky turns with the frame or leaves the picture, as it does for the sort, is decided there too.

**Board 2's furniture** is the page's: "Jupiter, held still" beside Jupiter, "Trojans, 60° ahead of Jupiter" and "Trojans, 60° behind" beside the two clouds, "Hildas: a triangle that turns with Jupiter" at its far corner, and the dashed white triangle through the points 60° ahead of Jupiter, 60° behind, and opposite, at Jupiter's own orbit size. Each is placed through the scene's camera from the crate's numbers, never typed.

**The integration.** The Trojans (the rows of class TJN, 16,472) and the Hildas (the rows from 3.7 to 4.2 au, 8,400) are moved by an integration in Rust under the Sun and Jupiter, Jupiter on its own Kepler orbit, each row massless; the rest of the belt stays on its 2026 ellipse (`docs/DECISIONS.md`, "Scene"). To decide in part B, each with its number: the integrator and its step, from Hektor's place against JPL Horizons' at the eight dates of `data/horizons.json` (the two-body orbit leaves it 30° from its place in 1976); how the places reach the scene (a buffer of their own, uploaded each frame, the belt's draw skipping those rows); what a jump of the clock costs (the page opened on another date, the clock starting over), and where that work runs; whether all 8,400 Hildas are integrated or the 8,045 whose resonant angle holds; and whether the clock may now go past 1976 and 2076, or run backward. Every integrated dot is still a row, and is where its ellipse puts it on the epoch.

**How the two groups read.** They are 24,872 dots of 1.58 M. What the turning frame does so the triangle and the clouds show (the rest of the belt gray, the two groups brighter, or both) is decided by eye in part A, on the Kepler orbits, and looked at again once they're integrated.

**A gap picked.** On the landed layout the chips become buttons and the line over them ends "Pick a gap." A press on one lets the sort go and rides with Jupiter, with board 5's additions: a marker at that gap's orbit size (a white dot in a ring, named "the marker"), its path in the turning frame drawn in white over one of Jupiter's orbits, closing into a loop; the belt dimmed under it; and a card at the top left with the four gaps as chips (the picked one outlined in white, a press on another moving the marker there), the gap's name ("3:1 with Jupiter"), the sentence that says why the orbit empties, and three numbers: the orbit's size, one orbit, and Jupiter's orbit, each computed from Jupiter's a (`orbit.rs`), never typed. The marker isn't a row: it's white, the page calls it a marker, and no count includes it (rules 1, 3, and 4). Its eccentricity, which shapes the loop, is chosen in part C. The card's place waits on the title's height (open questions): board 5 puts it at 104 px down, under a title that ends at 84, and the app's ends at 152.

**What M4 leaves to M5:** everything that links a dot to its row, and "Find Ceres". The row has two buttons until then.

**Split into parts,** one session each:

- **Part A: the frame that turns with Jupiter.** The action and its two states; the frame's turn and the camera's flight to straight above and back; the two actions together; board 2's names and the dashed triangle; how the two groups read, and what the sky does, by eye. On the Kepler orbits. Closes A1 to A4.
- **Part B: the Hildas and Trojans, integrated.** The integrator in Rust and its tests against Horizons; the places' way to the scene; the cost a frame and at a jump of the clock; which Hildas; the clock's reach. Closes B1 to B4.
- **Part C: a gap picked, and the close.** The chips as buttons; the marker, its loop, the dim, and the card; the title's height; M5's spec. Closes C1 to C4.

**Done when:**

- [ ] **A1. Jupiter holds still.** With the action pressed and time running, Jupiter stays on one line from the Sun over one of its orbits (its place read through the scene's camera each second: how far it leaves the line, in pixels, and how far it moves along it), and the camera is straight above. A second press gives the fixed frame and the first camera back. Screenshots beside board 2.
- [ ] **A2. Board 2's names and its triangle** are where the crate's numbers put them: "Jupiter, held still", the Trojans' two names at the points 60° either side, the Hildas' at the corner opposite Jupiter, and the dashed triangle through the three points. A screenshot beside the board; the check reads each against the scene's camera.
- [ ] **A3. The two actions together:** sort pressed while riding, and riding pressed while sorted, each end in one pressed action and a picture that's whole, with what was decided written down. What isn't a row is right in each (the sort's axes gone in the turning frame, Jupiter's name back).
- [ ] **A4. The groups read:** the Hildas' triangle and the Trojans' clouds are plain in the turning frame from straight above, by what was decided (gray, brighter, or both), in a screenshot; the open question is closed.
- [ ] **B1. The integration is right where it can be checked.** Hektor's place at each of Horizons' eight dates: the error in au and in degrees as the Sun sees it, against the two-body orbit's, with a control that fails. On the epoch every integrated row is where its ellipse puts it.
- [ ] **B2. The clouds and the triangle hold for the clock's whole reach.** The Trojans within 30° of their points in 1976, 2026, and 2076, against the Kepler orbits' 12,011 of 16,048 after fifty years; the Hildas' triangle at both ends, in screenshots from the turning frame. The clock's reach, and whether it runs backward, decided from it.
- [ ] **B3. What it costs:** the scene's frames a second with time running, riding and not, against today's; the time a jump of the clock takes and where it runs; the wasm's memory with the integration's state held. Recorded with the decisions.
- [ ] **B4. Every dot is still a row:** the page's counts are unchanged, an integrated row drawn alone is within a pixel of the crate's own integrated place a decade from the epoch, and which Hildas are integrated is decided and counted.
- [ ] **C1. A gap is picked from the landed layout:** a press on a chip ends in the turning frame with the marker at that gap, its loop, the belt dimmed, and the card; a press on another chip in the card moves the marker. A screenshot for each gap, the 3:1 beside board 5.
- [ ] **C2. The loop closes, and the card's numbers are computed.** For each gap, the marker's path over one of Jupiter's orbits ends where it began, within a pixel (a native test, and the screenshot); and the card reads that gap's orbit size, period, and Jupiter's period from Jupiter's a: 2.50 au, 3.95 years, and 11.86 years for the 3:1.
- [ ] **C3. The marker is plainly not a row:** white, named "the marker", in no count; and the title's height against the card's place is decided, with the e axis's start looked at again.
- [ ] **C4. M5's spec, checks, and parts are written** here.

---

## Next milestones

Outlines, each specced when the one before it closes.

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

- **The title's lines are taller than the boards':** the boards' title is two lines and its legend, ending 84 px down; the app's says more (each on its own orbit, the rows with no dot, whose the stars are) in a narrower column, and ends at 152. On the sort's axes the e axis starts under it, at 160 px for the board's 96, and the tick at 0.6 isn't drawn (`docs/DECISIONS.md`, "Interface"); board 5's card, drawn 104 px down, would lie under it. Whether the title says less while an action is pressed, its column widens to the boards' 760 px, or the boards' places move down. *M4, part C, with the card.*
- **The gaps' chips in a narrow plot:** a chip moves aside for the next (`docs/DECISIONS.md`, "Interface"), which holds down to the open panel in a 1440 px window. Around 1100 px wide with the panel open the plot is some 380 px, the four gaps span 74, and four chips need 117: the outer chips are pushed off their lines, may still touch, and can leave the plot. What a plot too narrow for them does: a cap on how far a chip moves, smaller chips, or none drawn. *M4, part C, when the chips become buttons.*
- **The furniture's targets outlive it:** a published target (`__seizaTargets`) is never withdrawn, so after the dots fly back the chips', names', line's, and count's bounds still read as they were landed. Only scripts read them, and the checks that ask what's drawn do so on a fresh page. Whether `shared/`'s targets get a way to withdraw one, or the host publishes empty bounds when a piece isn't drawn. *Before a check needs it on a page that has landed.*
- **The panel as glass:** built behind `?glass` (`docs/DECISIONS.md`, "Table"): the panel's fill at 0.6 over the scene blurred behind it, for 2.7 frames a second of 30 with time running. From the opening camera only thin sky lies under the panel, so it can't be judged yet. Whether it ships, and at what fill and blur, by eye, once a camera flies in with the panel open and dust and stars are under it: the rows' contrast there is the thing to judge. Until then the knob stays, off unless asked for, and it is the first thing cut if the frame rate needs the room. *M5, with the fly-in.*
- **A control for the scene's resolution:** the scene ships at the display's resolution, 29 frames a second while time runs on an M1, and three quarters draws 41 (`docs/DECISIONS.md`, "Scene"). The visitor gets the trade, as Three.js scenes commonly offer. Decided: the control is GPUI's (one hit test already routes every input; a DOM pane over both canvases would have to be routed around). First a few named steps over what `?scale` turns; then, as a second step, the scene holding a frame rate by stepping its own resolution down, the control its override. To decide when it's built: the steps and their names, where it sits, and whether the choice is kept between visits. *Not placed in a milestone yet; before M6.*
- **The look at DPR 1:** the look was chosen at DPR 2. At DPR 1 (headless Firefox and WebKit) the stars are much more of the picture: a star 1.1 px across is one whole pixel at the middle of its profile. Whether a star's and a dot's light should follow the pixels they cover, chosen by eye on a display of that kind. *M6, with the check in Firefox and Safari.*
- **A sort's stall:** ordering every row takes a third to two thirds of a second on one thread (`docs/DECISIONS.md`, "Table"), in one task, as the pick does. Whether it runs in a worker, is spread over frames, or the orders ship in the file. *M5, with the pick's stall.*
- **The page's memory:** every row held is most of the wasm's memory (`docs/DECISIONS.md`, "Table"): the two files are 90.5 MB held as they arrive. What a phone makes of it; the diameter and albedo as a list of the rows that have one would take 11 MB out (`docs/DECISIONS.md`, "Data"). *M6, with the phone's answer.*
- **The clock's reach once the resonant groups are integrated:** it stops at 1976 and 2076 because Kepler orbits lose the Trojans' clouds past that (`docs/DECISIONS.md`, "Scene"). Whether the integration lets it go further, and whether the time control should run backward as well as on. *M4, part B.*
- **The credits on the page:** the README credits JPL and ESA, and the page names Gaia in a line; ESA's full acknowledgement and JPL's credit aren't on screen. Where they go (an about line, a corner). *M6, before it's in the open.*
- **A lost WebGL context:** the belt's buffers are the scene's own, filled a block at a time from views over the wasm's memory, so a context restored by the browser would come back with no belt. To handle: new buffers, and every block handed over again on the restore (the elements' address holds). *M6, before it's in the open.*
- **The Hildas and the Trojans are faint:** 8,400 and 16,472 dots of 1.58 M. The spike's shots brightened them sixfold and twofold to show their shapes, and the storyboard's board 2 no longer brightens them. What the frame that turns with Jupiter does so the triangle reads: gray the rest (as a picked group does), brighten the two groups, or both. *M4, part A.*
- **Which Hildas librate:** the rows from 3.7 to 4.2 au, 8,400, of which the resonance's angle holds 8,045 at the epoch (`docs/DECISIONS.md`, "Scene"). Whether the integration moves all 8,400 or only those it finds swinging. *M4, part B.*
- **More live columns:** the Sun's distance is live, at 2 a second. Which others join it (the distance from Earth needs Earth's place), and how many decimals a live cell shows. *M5.*
- **The clock's speed with the table open:** at a year a second the Sun's distance moves by up to half an au a second, so its last two decimals are never readable while time runs, at any refresh rate. Whether time slows while the table shows, the column drops decimals while it moves, or it's left as a blur that settles on pause. *M5.*
- **The pick's stall:** placing 1.57 M rows to pick a shape's takes about 0.4 s in one task at the release. How it's taken off the frame: the rows' rotation computed once, a worker, or spread over the frames the outline closes in. *M5.*
- **A shape drawn in a against e:** the spike takes a shape in space only. Picking a gap's edge on the landed layout is the natural next ask. *M5.*
- **A Worker of its own on the path:** whether a second Worker can take `/kirkwood/*` on a hostname bound to Tycho's as a custom domain. *M6.*
- **The Milky Way as a band:** at G 10.5 the stars crowd toward it and no more; a band needs a deeper cut (3.1 M stars under G 12, about 25 MB). Whether it's worth its bytes. *Not planned.*
- **A shape drawn across the panel:** a drag that leaves the scene's surface for the panel stops adding points until it comes back (a release there still closes the shape). Whether the panel should let it through. The spike's fly-in left it as it was: a release over the panel closes the shape, and the group is what the closed shape holds. *M5.*
- **A phone:** whether the scene and a summoned table work at phone width, or the app says it's for a larger screen. *M6.*
