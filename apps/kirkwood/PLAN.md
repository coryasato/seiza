# PLAN.md — Kirkwood

What's next for Kirkwood: milestone status, the active milestone's "done when" checks, the milestones after it, long-term goals, and open questions. Only what's still open lives here. Context and rules are in `CLAUDE.md` here and at the repo root.

**Goal:** the asteroid belt as a scene to fly through, drawn from the asteroid table's own rows, with the table of those rows beside it, each moving the other. In a sentence a visitor could repeat: **every dot is a row.**

**No deciding metric:** Kirkwood is a showcase (root `CLAUDE.md`, "Tiers"), exempt from the budgets, the measurement protocol, and the results notes. It still paints something first and loads the scene after. A milestone's checks are things to see on screen; where a check asks for a number, the number is recorded with the decision it settles (`docs/DECISIONS.md`), not gated.

**Success:** someone with no astronomy stays two minutes, does one thing that delights them, and leaves knowing the table was real.

**Where everything else lives:**
- [`../../docs/research/asteroid-belt.md`](../../docs/research/asteroid-belt.md): the research: what the scene shows, what the table does, what's honest to simulate, the data it needs.
- [The storyboard](https://claude.ai/artifact/Vpx3w9Jb6EAW5RFJbLKKoi): seven boards, reviewed 2026-11-10. Boards 1 to 5 were redrawn 2026-11-12 from the app as built (the release build's own scene, the interface over it where the code puts it); boards 6 and 7 are still the first drawing; boards 8 to 10, the camera's corner, are built (the controls' list beside the table's handle, not under it), and board 11's preset isn't. Each milestone below names the boards it builds; the canvas's notes say which parts of them are placeholders, and what building changed.
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
| M4 | Ride with Jupiter, and a gap picked | Done 2026-11-12 ([`docs/milestones.md`](docs/milestones.md)) |
| M5 | A camera a hand moves | Done 2026-11-12 ([`docs/milestones.md`](docs/milestones.md)) |
| M6 | The scene and the table, each moving the other | Active: part A next |
| M7 | In the open: deployed under Tycho | Planned |

A *Planned* row's outline is under "Next milestones". Its spec, "done when" checks, and parts are written when the milestone before it closes, from what that one found.

**Closing a milestone:** every "done when" check passes, with its evidence (a screenshot, a recording, or a number) beside it; new decisions are in `docs/DECISIONS.md`; a `docs/LESSONS.md` entry is written; and the milestone's spec and evidence move from here to the end of `docs/milestones.md`, leaving one row above. No results note and no `report`: a showcase has no budgets.

**Waiting on** (features of a component or engine this app needs; only that crate's `PLAN.md` builds them, and the session that closes one flips its row to *Ready*):

| Needs | For | Status |
|---|---|---|

Nothing. The tall table's `live`, `sort`, and `select` are built, and with the rows held in Rust a filter to a drawn group and a sort are both the delegate's work, an index it reads its pages through: the spike's filter needed nothing new (`docs/DECISIONS.md`, "Table"). Nothing is asked of `engines/duckdb/`: the app doesn't use it.

---

## Active milestone

### M6: The scene and the table, each moving the other

Boards 6 and 7, and the links the storyboard didn't draw. Until now nothing ties a dot to its row. Row to scene: a press on a row flies the camera to its dot ("Find Ceres" is that press for the first row). Scene to rows: a shape drawn around a group keeps those dots their color while the rest go gray, the camera flies in, and the table is the group's rows; a click on one dot is the same for one row. And the columns that move as time runs.

**The camera is M5's,** and both links fly it. A flight and a hand don't fight: a drag or a wheel mid-flight takes the camera where it is, and what was found or picked stays so.

**What M5 left it** (amended at M5's close, 2026-11-12):

- **A flight is the hand's own.** The way home is already a flight of the camera's that any press, drag, or wheel ends where it is (`web/src/camera.ts`, `home`). A flight to a row or a group is that flight with another place to go, so it is taken over the same way, the scene says the camera is moving on its own through it, and it doesn't fold the hint (only a hand's move does).
- **The way home lets a followed row go.** The compass's press and H fly to the opening shot; with a row followed, that is the way back: the mark stays on its dot, the camera stops following. Riding, home is the ride's own.
- **The compass follows a flight** for free: it is told the camera's turn and tilt by whatever moved it.
- **The keys are the table's while its panel is open,** and a press on a row is made there: an arrow after it moves the table, not the camera. Whether a found row's press hands the arrows to anything is part A's to decide; as built they stay the table's.
- **The corner needs room beside a longer row.** "Find Ceres" and the lasso's button make the row of actions wider, and the hint is drawn whole only where what the panel leaves has room for both (`host.rs`, `HINT_ROOM`): set again in parts A and B. The group's chip and "Show all rows" keep clear of the bottom right corner in space, as the count of rows in view has it only landed.
- **Drawing a shape is a mode, and the keys' pan isn't a drag:** in the lasso's mode a drag draws, and the arrows, + and −, and H still move the camera, so a shape can be drawn over a view reached by keys. Whether a move mid-shape is allowed is part B's to decide.

**Row to scene.** The table's rows become selectable (the tall table's `select`, rows alone). A press on a row flies the camera to that row's dot and marks it: a white ring and the row's own name, the page's, as the marker is (rule 4: white is what the interface adds). The camera keeps looking at it as time runs: a zoom, a tilt, or a turn goes round the followed row, and a pan or the way back lets it go. "Find Ceres" is the row's third button, as board 1 draws it: the same flight for row 0. A row with no ellipse has no dot to fly to, and the page says so. What the press does with another action pressed (riding, on the axes, a gap picked) joins the rule that one action is pressed at a time, and how is decided in part A.

**Scene to rows: a group drawn** (board 6). Drawing is a mode entered by a button of its own, a lasso, since the bare drag is the camera's. In it time pauses, the drag draws a freehand shape in white, dashed, and its release closes the shape wherever it lands. The group is every row whose dot lies under the shape through the scene's whole depth, placed in Rust through the scene's camera: a set of rows, not a region, so with time running again they stay lit as they drift apart. Those dots keep their color and the rest of the belt goes gray (rule 4), a chip at the shape counts the group's rows (board 6: "143,854 rows"), and the table is filtered to them, the delegate reading its pages through the group's indices (`docs/DECISIONS.md`, "Table"). The pick is some 0.4 s in one task today: how it's taken off the frame is decided in part B, with its number.

**The fly-in** (board 7). With a group picked the camera flies in until the group fills what the panel leaves, and the panel comes in with it, its rows the group's. The group's biggest bodies are named on their dots, from the rows' own names and diameters. "Show all rows" is the way back: every row, every color, the camera where it was. The panel as glass is judged here, with dust and stars under it (open questions), and kept or cut.

**A click on one dot** picks the nearest drawn dot within a few pixels: the table filtered to its one row, with a way back to the whole table at that row.

**The live columns.** The Sun's distance is live at 2 a second. Which others join it, how many decimals a moving cell shows, and what the clock does while the table shows are decided in part D by looking (rule 5). A sort by diameter makes the table's top rows a tour of the biggest: each press a flight.

**What M6 leaves to M7:** the deploy, the README's canvas tradeoffs in full, Firefox and Safari, a phone.

**Split into parts,** one session each:

- **Part A: a row found.** The tall table's `select` turned on; the camera's flight to a row and its mark; "Find Ceres"; the three actions together. Closes A1 to A4.
- **Part B: a group drawn, and its rows.** The lasso's button and its mode; the shape; the pick in Rust and its stall; the group's color and the gray; the count's chip; the table filtered, and the way back. Closes B1 to B4.
- **Part C: the fly-in, the names, and one dot.** The camera's flight to a group with the panel; the biggest bodies' names; a click on one dot; the glass panel judged. Closes C1 to C4.
- **Part D: the live columns, the tour, and the close.** The live columns and the clock's speed with the table open; the sort's stall; a sort by diameter as a tour; the README for what runs; M7's spec. Closes D1 to D4.

**Done when:**

- [ ] **A1. A flight and a hand don't fight:** a drag, a wheel, or a key mid-flight takes the camera where it is, with the found row still marked; a zoom, a tilt, and a turn keep a followed row at the middle, and a pan or the way home lets it go; the compass says the camera's turn and tilt through the flight, and the hint isn't folded by one. The camera through a scripted flight and drag, as numbers.
- [ ] **A2. A row is found.** A press on a row of the open table flies the camera to it: at the flight's end the crate's place for that row, through the scene's camera, is at the middle of what the panel leaves, within a pixel, and still is a second later with time running. For Ceres, a Hilda (an integrated row), and a row far down the file; a row with no ellipse flies nowhere and the page says why.
- [ ] **A3. "Find Ceres"** is the row's third button, as board 1 draws it, with the two states the others have. Pressed with another action pressed, each way round, the picture ends whole with what was decided written down.
- [ ] **A4. The found row's mark is plainly not a dot:** a white ring and the row's own name from the rows file, on the dot within a pixel, in no count; and the way back gives the first camera back.
- [ ] **B1. The lasso is a mode:** its button's two states; in it time pauses, a drag draws the shape in white as board 6 has it, and the release closes it and gives time back; out of it a drag is the camera's. A screenshot beside board 6. What a drag across the panel does is decided.
- [ ] **B2. The pick is right, and off the frame.** The group is the rows whose dots are inside the shape: counted again by the check from the file's own bytes through the scene's camera, with a control that fails. The pick's time, where it runs, and the longest frame it costs, recorded with the decision.
- [ ] **B3. The group reads:** its dots keep their color and the rest are gray, in a screenshot beside board 6 with numbers for both; the chip's count is the set's; and with time running a year on, the same rows are lit.
- [ ] **B4. The table is the group's:** its row count is the chip's, its first and last rows are the group's first and last in the file's order, and a sort there orders the group alone. "Show all rows" gives back every row and every color.
- [ ] **C1. The fly-in:** the camera ends with the group filling what the panel leaves, the panel in with it, as board 7 has it (a screenshot beside the board); the scene's frames a second on the way, recorded.
- [ ] **C2. The biggest bodies are named:** each name and diameter is the rows file's own for that row, each on its dot within a pixel, and how many are named is decided.
- [ ] **C3. A click on one dot** picks the nearest drawn within the reach decided, and nothing past it: the table is that one row, and the way back is the whole table at that row.
- [ ] **C4. The glass panel is judged** with dust and stars under it: kept, at a fill and blur chosen by eye with the rows' contrast as a number, or cut with its knob.
- [ ] **D1. The live columns** are decided and built: each live cell on screen is the crate's own number for that row at the clock's date, refreshed at the rate chosen, with the decimals chosen.
- [ ] **D2. The clock with the table open** is decided (slowed, decimals dropped, or left), by looking, and written down.
- [ ] **D3. A sort by diameter is a tour:** the table's top rows are the biggest bodies, and a press on each flies the camera to it; the sort's stall is measured and taken off the frame as decided.
- [ ] **D4. M7's spec, checks, and parts are written** here, and the README says what runs.

---

## Next milestones

M7 is an outline, specced when M6 closes.

### M7: In the open: deployed under Tycho

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

- **The marker's name over its own path:** "the marker" sits 16 px right of the marker and 26 up, as board 5 has it, with no fill under it, so where the path runs up and to the right of the marker the white line crosses the white name (seen at 5:2 and 7:3 on the epoch, `docs/seen/gap-5-2.jpg`). Whether the name gets a fill, or moves to the side the path leaves clear. *By eye, at the owner's next look.*
- **The marker's eccentricity and the dim, by the owner's eye:** both were chosen from screenshots (0.25, the board's; 0.6 of what the ride leaves the belt: `docs/DECISIONS.md`, "Scene", "Look"). `?markerE` and `?markerDim` are left to look with. *At the owner's next look.*
- **The furniture's targets outlive it:** a published target (`__seizaTargets`) is never withdrawn, so after the dots fly back the chips', names', line's, and count's bounds still read as they were landed. Only scripts read them, and the checks that ask what's drawn do so on a fresh page. Whether `shared/`'s targets get a way to withdraw one, or the host publishes empty bounds when a piece isn't drawn. *Before a check needs it on a page that has landed.*
- **The panel as glass:** built behind `?glass` (`docs/DECISIONS.md`, "Table"): the panel's fill at 0.6 over the scene blurred behind it, for 2.7 frames a second of 30 with time running. From the opening camera only thin sky lies under the panel, so it can't be judged yet. Whether it ships, and at what fill and blur, by eye, once a camera flies in with the panel open and dust and stars are under it: the rows' contrast there is the thing to judge. Until then the knob stays, off unless asked for, and it is the first thing cut if the frame rate needs the room. *M6, with the fly-in.*
- **A control for the scene's resolution:** the scene ships at the display's resolution, 29 frames a second while time runs on an M1, and three quarters draws 41 (`docs/DECISIONS.md`, "Scene"). The visitor gets the trade, as Three.js scenes commonly offer. Decided: the control is GPUI's (one hit test already routes every input; a DOM pane over both canvases would have to be routed around). First a few named steps over what `?scale` turns; then, as a second step, the scene holding a frame rate by stepping its own resolution down, the control its override. To decide when it's built: the steps and their names, where it sits, and whether the choice is kept between visits. Stepping it down while the camera moves was tried and turned down by eye (`docs/DECISIONS.md`, "Scene"), so the second step, the scene holding a frame rate by itself, would have to change resolution without the flicker that had. *The control: not placed yet; before M7.*
- **The look at DPR 1:** the look was chosen at DPR 2. At DPR 1 (headless Firefox and WebKit) the stars are much more of the picture: a star 1.1 px across is one whole pixel at the middle of its profile. Whether a star's and a dot's light should follow the pixels they cover, chosen by eye on a display of that kind. *M7, with the check in Firefox and Safari.*
- **A sort's stall:** ordering every row takes a third to two thirds of a second on one thread (`docs/DECISIONS.md`, "Table"), in one task, as the pick does. Whether it runs in a worker, is spread over frames, or the orders ship in the file. *M6, with the pick's stall.*
- **The page's memory:** every row held is most of the wasm's memory (`docs/DECISIONS.md`, "Table"): the two files are 90.5 MB held as they arrive. What a phone makes of it; the diameter and albedo as a list of the rows that have one would take 11 MB out (`docs/DECISIONS.md`, "Data"). *M7, with the phone's answer.*
- **The credits on the page:** the README credits JPL and ESA, and the page names Gaia in a line; ESA's full acknowledgement and JPL's credit aren't on screen. Where they go (an about line, a corner). *M7, before it's in the open.*
- **A lost WebGL context:** the belt's buffers are the scene's own, filled a block at a time from views over the wasm's memory, so a context restored by the browser would come back with no belt. To handle: new buffers, and every block handed over again on the restore (the elements' address holds). *M7, before it's in the open.*
- **The sky as a choice, riding:** the sky leaves the turned frame, and stays out by default: the owner looked at it turning (`?rideSky=1`, and at 0.4) and found it somewhat nauseating (`docs/DECISIONS.md`, "Scene"). A toggle for it may join the scene's own controls (the resolution's, above), bringing it back at 0.4, with the title's sentence about the stars following it. `?rideSky` stays as what the toggle would turn. *Not placed in a milestone yet; with the resolution's control.*
- **A pan and a zoom on the axes:** M5's camera is space's, and a wheel or a drag on the landed layout does nothing. Zooming into a gap there is the natural ask, but the plot's ends would move: every tick, chip, and name of GPUI's would follow the scene's dots frame for frame (the two canvases in step, as nothing yet needs), and the count of rows in view would be counted again as it moves. *Not placed in a milestone yet; with a shape drawn in a against e.*
- **Touch:** one finger pans, two pinch to zoom and drag to tilt, as a map's do. gpui-pre-web hears touches; what it hands the surface isn't looked at yet. *M7, with the phone's answer.*
- **The storyboard's pictures of the opening are the level one's:** the opening is a pose again, rolled 34° (`docs/DECISIONS.md`, "Input", 2026-11-12, after M5 closed), and boards 1, 8, and 10 still draw the level shot of that morning, as do the screenshots M2 to M5's evidence links (history, left as taken; the corner's four were taken again). *The three boards' pictures are taken again when the storyboard is next redrawn, with boards 6 and 7 in M6.*
- **A slow turn of the belt until the first input:** an opening for a visitor who touches nothing. Against it: time already runs on load, so the picture already moves; and it is a camera nobody asked for (rule 6 is about tours, and this is near one). *Not planned.*
- **More live columns:** the Sun's distance is live, at 2 a second. Which others join it (the distance from Earth needs Earth's place), and how many decimals a live cell shows. *M6.*
- **The clock's speed with the table open:** at a year a second the Sun's distance moves by up to half an au a second, so its last two decimals are never readable while time runs, at any refresh rate. Whether time slows while the table shows, the column drops decimals while it moves, or it's left as a blur that settles on pause. *M6.*
- **The pick's stall:** placing 1.57 M rows to pick a shape's takes about 0.4 s in one task at the release. How it's taken off the frame: the rows' rotation computed once, a worker, or spread over the frames the outline closes in. *M6.*
- **A shape drawn in a against e:** the spike takes a shape in space only. Picking a gap's edge on the landed layout is the natural next ask. *M6.*
- **A Worker of its own on the path:** whether a second Worker can take `/kirkwood/*` on a hostname bound to Tycho's as a custom domain. *M7.*
- **The Milky Way as a band:** at G 10.5 the stars crowd toward it and no more; a band needs a deeper cut (3.1 M stars under G 12, about 25 MB). Whether it's worth its bytes. *Not planned.*
- **A shape drawn across the panel:** a drag that leaves the scene's surface for the panel stops adding points until it comes back (a release there still closes the shape). Whether the panel should let it through. The spike's fly-in left it as it was: a release over the panel closes the shape, and the group is what the closed shape holds. *M6.*
- **A phone:** whether the scene and a summoned table work at phone width, or the app says it's for a larger screen. The leaning (2026-11-12, not decided): no cut-down build. A phone gets a recording of the real app (the checks' own captures, looping, with its first frame as a still), a line saying Kirkwood is built for a larger screen, a way to send the link on (the share sheet, or a copy), and "Open it anyway", said to be slow. Chosen by what the page can ask before anything loads (a coarse pointer alone and a narrow window), in the page's own script, so a phone never asks for the wasm or the files unless it opens it anyway. To settle: whether "anyway" is safe at all with the page's memory (the question above), and the recording's bytes. A scroll through the boards isn't planned. *M7.*
