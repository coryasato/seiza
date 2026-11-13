# PLAN.md — Kirkwood

What's next for Kirkwood: milestone status, the active milestone's "done when" checks, the milestones after it, long-term goals, and open questions. Only what's still open lives here. Context and rules are in `CLAUDE.md` here and at the repo root.

**Goal:** the asteroid belt as a scene to fly through, drawn from the asteroid table's own rows, with the table of those rows beside it, each moving the other. In a sentence a visitor could repeat: **every dot is a row.**

**No deciding metric:** Kirkwood is a showcase (root `CLAUDE.md`, "Tiers"), exempt from the budgets, the measurement protocol, and the results notes. It still paints something first and loads the scene after. A milestone's checks are things to see on screen; where a check asks for a number, the number is recorded with the decision it settles (`docs/DECISIONS.md`), not gated.

**Success:** someone with no astronomy stays two minutes, does one thing that delights them, and leaves knowing the table was real.

**Where everything else lives:**
- [`../../docs/research/asteroid-belt.md`](../../docs/research/asteroid-belt.md): the research: what the scene shows, what the table does, what's honest to simulate, the data it needs.
- [The storyboard](https://claude.ai/artifact/Vpx3w9Jb6EAW5RFJbLKKoi): seven boards, reviewed 2026-11-10. Boards 1 to 5 were redrawn 2026-11-12 from the app as built (the release build's own scene, the interface over it where the code puts it); boards 6 and 7 are still the first drawing. Each milestone below names the boards it builds; the canvas's notes say which parts of them are placeholders, and what building changed.
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
| M5 | A camera a hand moves | Active: part A done; part B next |
| M6 | The scene and the table, each moving the other | Planned (specced; amended when M5 closes) |
| M7 | In the open: deployed under Tycho | Planned |

A *Planned* row's outline is under "Next milestones". Its spec, "done when" checks, and parts are written when the milestone before it closes, from what that one found.

**Closing a milestone:** every "done when" check passes, with its evidence (a screenshot, a recording, or a number) beside it; new decisions are in `docs/DECISIONS.md`; a `docs/LESSONS.md` entry is written; and the milestone's spec and evidence move from here to the end of `docs/milestones.md`, leaving one row above. No results note and no `report`: a showcase has no budgets.

**Waiting on** (features of a component or engine this app needs; only that crate's `PLAN.md` builds them, and the session that closes one flips its row to *Ready*):

| Needs | For | Status |
|---|---|---|

Nothing. The tall table's `live`, `sort`, and `select` are built, and with the rows held in Rust a filter to a drawn group and a sort are both the delegate's work, an index it reads its pages through: the spike's filter needed nothing new (`docs/DECISIONS.md`, "Table"). Nothing is asked of `engines/duckdb/`: the app doesn't use it.

---

## Active milestone

### M5: A camera a hand moves

The scene gets a map's camera, the one a visitor's hand already knows (Google Maps', gesture for gesture, the owner's call, 2026-11-12: where it and another map differ, Google Maps' is built, read off the live map and not from memory): a drag pans, a wheel zooms toward the pointer, and a second drag tilts and turns. The owner's call, 2026-11-12: a drag moves the camera, since that is what a hand expects, and tilt was the first thing reached for. Tilt is content, not only a way round: seen near edge-on the belt has a thickness, and the high-inclination groups lift out of the plane. It comes before the scene and the table are linked (M6), since both links fly this camera.

**The camera is the scene's own, with a map's four numbers:** what it looks at (a point on the ecliptic), its distance from it, its tilt (from straight down), and its bearing. Not Three.js's `MapControls`: GPUI's canvas takes every DOM event and the scene's has no listeners (`docs/DECISIONS.md`, "Input"), and the camera already has a view offset beside the panel, a ride between two ends, and flights to come. The surface under the interface hands the scene a drag as it hands it a wheel (its start, its moves, its end, with the button and the modifiers), so a press on a control, the panel, or a chip still moves nothing.

**The gestures,** each the map's:

- **A drag pans along the ecliptic,** as a tabletop slides: the plane's point under the pointer at the press stays under it, at any tilt.
- **A wheel zooms toward the pointer:** the plane's point under it holds still, between the limits the wheel has now (0.05 to 60 au). Where the pointer is over the sky (near edge-on its ray never meets the plane), it zooms toward what the camera looks at. A trackpad's pinch is a wheel with Ctrl held and zooms the same way, never the page (gpui-pre-web already takes the wheel's default; whether the modifier reaches the surface is part A's first look).
- **A drag with Google Maps' modifier held tilts and turns** about what the camera looks at: across the window turns, up and down tilts. The modifier is Ctrl as recalled, and Shift in its JS API's docs: part B opens by reading it off the live map, on a Mac and off one, and builds that (both, if the map takes both). No right-drag: that is MapLibre's, and the right button is Google Maps' menu. Tilt is held between straight down and a limit short of edge-on, decided by hand in part B (the opening shot is already 66° from straight down, and edge-on is the view tilt is for, so the limit is nearer 85° than a map's 60°); never under the plane.
- **A glide:** let go moving, the camera carries on and comes to rest. Any press stops it.
- **A double click zooms in, toward the pointer,** as Google Maps' does. A click on a dot is M6's pick, and a double click's first click would pick: how the two live together (the pick waits out a double click's time, or picks and then zooms) is M6's to decide, with the pick.

**What the scene already does, and what changes:**

- **The stars already turn and never slide** (they are at infinity: `docs/DECISIONS.md`, "Look"), and the names, the triangle, and the marker's path are placed by the scene in the frame that draws them, so they stay on their points at any camera; part B checks both from a tilted one.
- **The opening shot has a roll** (34° about its line of sight, so the belt runs corner to corner), and a map's camera has none. Decided by hand in part B: the roll is the opening's alone and eases out on the first tilt or turn (a pan and a zoom keep it), or the shot is composed again without it. The way home gives the opening back as it is.
- **A dot's size and opacity already follow the camera's nearness,** up to three times the size (`docs/DECISIONS.md`, "Look"). Zoomed in by hand, far past where a flight stops, that is looked at again in part A: whether dots part into rows or swell into discs.
- **The scene draws 29 frames a second while time runs** (`docs/DECISIONS.md`, "Scene"), and a hand feels that in a drag as it doesn't in a clock. Part A measures a drag's frames and decides whether the scene steps its resolution down while the camera moves and back at rest; that is the first half of the open question about the scene's resolution. (Decided in part A: it doesn't.)

**Each mode's rules:**

- **Riding with Jupiter,** the camera's moves are in the frame that turns: Jupiter stays where the visitor's bearing left it. They are the ride's own and forgotten once the camera is back, as its wheel is now; on the way there or back an input moves nothing, as now. Tilted, the Trojans' clouds have a thickness too.
- **On the axes** nothing moves, as now (`docs/DECISIONS.md`, "Input"): a against e is flat, and its furniture is GPUI's on a plot of the crate's. A pan and a zoom into a gap there are an open question below, not this milestone's.
- **A flight of the camera's own** (M6's, to a row or a group) is taken over by a drag or a wheel where it is. Written into M6's spec when this closes.

**The way home, and what tells a visitor the controls:**

- **A compass** in a corner shows the bearing and the tilt, and a press on it flies home: the opening shot in space, the ride's own riding. A key does the same.
- **A hint** in a corner, one line ("Drag to move · Scroll to zoom · Ctrl+drag to tilt · ? for more", the modifier as part B found it), shown whole on a first visit and folded after the first move of the camera.
- **A legend** behind `?` (as Gmail, GitHub, and Figma have it) and behind the hint: the mouse's, the trackpad's, and the keys' controls, with the modifier as the visitor's machine names it.
- **The keys,** while the scene has them (the table takes them when its panel opens): the arrows pan, + and − zoom, and one goes home.
- These are GPUI's, over the scene: each needs a fill or the scene's quiet under it, and a board before it is built.

**Reminder: draw the boards at the end of part B,** in that session, and don't start part C without them reviewed. Then the tilted camera is running, so the boards are drawn over the app's own picture, and the owner's review falls between the two sessions instead of stopping part C at its start. The storyboard has none for a camera: the hint whole and folded, and the compass, over the opening shot; the legend; and the belt tilted near edge-on, with whatever names it (a preset, "See it edge-on", is decided on that board: a press of its own, or left to the hand).

**What M5 leaves:** touch (one finger pans, two pinch and tilt), with the phone's answer in M7; Safari's pinch, which isn't a wheel there, with M7's check in Safari; a pan and zoom on the axes; and following a body, which is M6's found row.

**Split into parts,** one session each:

- **Part A: the drag, the wheel, and the glide.** The drag handed from the surface to the scene; the camera's four numbers; the pan along the plane; the zoom toward the pointer, and a pinch; the glide; a drag's frames and the resolution while it moves; the dots up close. Closes A1 to A4.
- **Part B: tilt and turn, and each mode's rules.** Google Maps' modifier read off the live map, and its drag; the double click; the tilt's limit; the opening's roll; riding; the axes; the names and the stars from a tilted camera; and, last, the boards for part C. Closes B1 to B5.
- **Part C: the way home, the hint, the legend, the keys, and the close.** From the boards: the compass, the hint and its fold, the legend, the keys; the README's controls; M6's spec amended. Closes C1 to C5.

**Done when:**

- [x] **A1. A drag pans along the plane:** the ecliptic's point under the pointer at the press is under it at the release, within a pixel, from the opening camera and from one tilted by its knob; a press on a control, the panel, or a chip moves nothing; and a drag that crosses the panel keeps the camera until its release. The camera before and after a scripted drag, as numbers.
  - *Evidence (2026-11-12, `see.ts --only camera`):* a drag from (700, 520) to (560, 610): the point pressed is 0.00 px from the pointer at the release from [the opening camera](docs/seen/camera-panned.jpg) (looking at 0, 0 au, then −1.5554, −0.4797; 13 au, tilt 66°, bearing 200°, roll −34° before and after), from 30° off straight down (then −1.6271, −0.5467), and from 78° (then −0.0625, −2.4002). A drag begun on the time control, on the open panel, on the landed layout (its chips with it), and riding each left all six numbers as they were. Pressed at (420, 520) beside the open panel and let go at (1030, 600), [inside it](docs/seen/camera-across-panel.jpg): 0.00 px, and a move after the release moved nothing. `docs/DECISIONS.md`, "Input".
- [x] **A2. A wheel zooms toward the pointer:** the plane's point under it holds within a pixel, at both limits it stops, and over the sky it zooms toward what the camera looks at. A wheel with Ctrl held zooms the scene, and the page's own zoom is unchanged.
  - *Evidence (2026-11-12):* at (500, 560), 13 au to 7.88 to 4.78 and out to 7.88, the point 0.00 px from the pointer each time ([zoomed](docs/seen/camera-zoomed.jpg)); stops at 0.05 and 60 au, a wheel past either drawing nothing; at 5° above the plane a wheel over the sky took 13 au to 7.88 looking at 0, 0 still; a 20 px wheel zoomed by 1.041 plain and 1.221 with Ctrl, the page's zoom 1 before and after. A real trackpad's pinch isn't a headless browser's to try: by hand. `docs/DECISIONS.md`, "Input".
- [x] **A3. The glide:** let go moving, the camera comes to rest in the time decided by hand; a press stops it; and at rest with time paused the scene draws nothing.
  - *Evidence (2026-11-12):* A 250 px drag in 120 ms let go moving carried the camera 1.45 au on and rested 1.1 s later; let go still it doesn't glide; a press on the scene and one on the handle each stop it; at rest, time paused, 0 frames in 1.5 s. The time constant is 220 ms, chosen by the owner's hand against 120 and 350; a very hard flick carried too far, so its speed is capped at 2,000 px a second (`docs/DECISIONS.md`, "Input").
- [x] **A4. A drag's frames are measured,** with time running, at the display's resolution and stepped down: what the scene does while the camera moves is decided by eye in a real browser and recorded with its numbers. And the dots up close are looked at, kept or changed, with a screenshot at the nearest zoom.
  - *Evidence (2026-11-12):* A scripted drag with time running draws 29.2 frames a second at the display's resolution, 37.3 with the scene at three quarters while the camera moves, 51.7 at half, each step of resolution costing one 100 ms frame (`see.ts --only drag`; `docs/DECISIONS.md`, "Scene"). Decided by the owner's eye in a real browser: the display's resolution throughout. Stepped down, the picture flickered coming back sharp after a fling; the knob is taken out. The dots up close were looked at and kept: [1 au](docs/seen/camera-near-1.jpg), [0.2](docs/seen/camera-near-0-2.jpg), [0.05, the nearest](docs/seen/camera-near-0-05.jpg) (`docs/DECISIONS.md`, "Scene").
- [ ] **B1. A drag with Google Maps' modifier tilts and turns** about what the camera looks at: which modifier, as read off the live map, written down; the bearing and the tilt before and after a scripted drag, the tilt held at both ends of its range, and no context menu from it on a Mac. A double click zooms in toward the pointer.
- [ ] **B5. The boards for part C are drawn** in the storyboard, over the app's own tilted picture, for the owner's review before part C.
- [ ] **B2. The opening's roll is decided,** by hand, and written down; a screenshot of the opening shot and of the camera after a first turn.
- [ ] **B3. Riding, the camera moves in the frame that turns:** with a bearing and a tilt of the visitor's, Jupiter holds its place in the window over one of its orbits, the names, the triangle, and a picked gap's marker and path are on the crate's points within a pixel, and the press back gives the fixed frame's camera as it was left.
- [ ] **B4. Tilted, the picture holds:** the Sun's and Jupiter's names on their discs within a pixel, a star's place unchanged by a pan and moved by a turn, and nothing under the plane. On the axes a drag and a wheel move nothing.
- [ ] **C1. The compass** shows the bearing and the tilt as the camera has them, and its press, and the key, fly home: the first camera, as numbers. A screenshot beside its board.
- [ ] **C2. The hint** is whole on a first visit and folded after the camera's first move, and on the next visit; readable over the scene, its contrast a number. A screenshot beside its board.
- [ ] **C3. The legend** opens on `?` and from the hint, closes the same ways, names the modifier as the machine does (a Mac's, and another's), and takes its presses and its wheel from the scene. A screenshot beside its board.
- [ ] **C4. The keys** pan, zoom, and go home while the scene has them, and the table's keys are the table's with its panel open.
- [ ] **C5. M6's spec is amended** from what this found (a flight taken over, a found row followed), and the README says the controls and what a canvas costs them.

---

## Next milestones

M6 was specced before the camera became a milestone of its own; it is amended when M5 closes. M7 is an outline, specced when M6 closes.

### M6: The scene and the table, each moving the other

Boards 6 and 7, and the links the storyboard didn't draw. Until now nothing ties a dot to its row. Row to scene: a press on a row flies the camera to its dot ("Find Ceres" is that press for the first row). Scene to rows: a shape drawn around a group keeps those dots their color while the rest go gray, the camera flies in, and the table is the group's rows; a click on one dot is the same for one row. And the columns that move as time runs.

**The camera is M5's,** and both links fly it. A flight and a hand don't fight: a drag or a wheel mid-flight takes the camera where it is, and what was found or picked stays so.

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

- [ ] **A1. A flight and a hand don't fight:** a drag or a wheel mid-flight takes the camera where it is, with the found row still marked; a zoom, a tilt, and a turn keep a followed row at the middle, and a pan lets it go. The camera through a scripted flight and drag, as numbers.
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
- **A slow turn of the belt until the first input:** an opening for a visitor who touches nothing. Against it: time already runs on load, so the picture already moves; and it is a camera nobody asked for (rule 6 is about tours, and this is near one). *Not planned; looked at by hand if M5's part B leaves the opening feeling still.*
- **More live columns:** the Sun's distance is live, at 2 a second. Which others join it (the distance from Earth needs Earth's place), and how many decimals a live cell shows. *M6.*
- **The clock's speed with the table open:** at a year a second the Sun's distance moves by up to half an au a second, so its last two decimals are never readable while time runs, at any refresh rate. Whether time slows while the table shows, the column drops decimals while it moves, or it's left as a blur that settles on pause. *M6.*
- **The pick's stall:** placing 1.57 M rows to pick a shape's takes about 0.4 s in one task at the release. How it's taken off the frame: the rows' rotation computed once, a worker, or spread over the frames the outline closes in. *M6.*
- **A shape drawn in a against e:** the spike takes a shape in space only. Picking a gap's edge on the landed layout is the natural next ask. *M6.*
- **A Worker of its own on the path:** whether a second Worker can take `/kirkwood/*` on a hostname bound to Tycho's as a custom domain. *M7.*
- **The Milky Way as a band:** at G 10.5 the stars crowd toward it and no more; a band needs a deeper cut (3.1 M stars under G 12, about 25 MB). Whether it's worth its bytes. *Not planned.*
- **A shape drawn across the panel:** a drag that leaves the scene's surface for the panel stops adding points until it comes back (a release there still closes the shape). Whether the panel should let it through. The spike's fly-in left it as it was: a release over the panel closes the shape, and the group is what the closed shape holds. *M6.*
- **A phone:** whether the scene and a summoned table work at phone width, or the app says it's for a larger screen. The leaning (2026-11-12, not decided): no cut-down build. A phone gets a recording of the real app (the checks' own captures, looping, with its first frame as a still), a line saying Kirkwood is built for a larger screen, a way to send the link on (the share sheet, or a copy), and "Open it anyway", said to be slow. Chosen by what the page can ask before anything loads (a coarse pointer alone and a narrow window), in the page's own script, so a phone never asks for the wasm or the files unless it opens it anyway. To settle: whether "anyway" is safe at all with the page's memory (the question above), and the recording's bytes. A scroll through the boards isn't planned. *M7.*
