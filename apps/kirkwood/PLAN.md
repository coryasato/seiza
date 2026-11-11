# PLAN.md — Kirkwood

What's next for Kirkwood: milestone status, the active milestone's "done when" checks, the milestones after it, long-term goals, and open questions. Only what's still open lives here. Context and rules are in `CLAUDE.md` here and at the repo root.

**Goal:** the asteroid belt as a scene to fly through, drawn from the asteroid table's own rows, with the table of those rows beside it, each moving the other. In a sentence a visitor could repeat: **every dot is a row.**

**No deciding metric:** Kirkwood is a showcase (root `CLAUDE.md`, "Tiers"), exempt from the budgets, the measurement protocol, and the results notes. It still paints something first and loads the scene after. A milestone's checks are things to see on screen; where a check asks for a number, the number is recorded with the decision it settles (`docs/DECISIONS.md`), not gated.

**Success:** someone with no astronomy stays two minutes, does one thing that delights them, and leaves knowing the table was real.

**Where everything else lives:**
- [`../../docs/research/asteroid-belt.md`](../../docs/research/asteroid-belt.md): the research: what the scene shows, what the table does, what's honest to simulate, the data it needs.
- [The storyboard](https://claude.ai/artifact/Vpx3w9Jb6EAW5RFJbLKKoi): seven boards, reviewed 2026-11-10. Each milestone below names the boards it builds; the canvas's notes say which parts of them are placeholders.
- [`docs/DECISIONS.md`](docs/DECISIONS.md): every decision, by area. Repo-wide ones (the showcase tier, its home): the root [`docs/DECISIONS.md`](../../docs/DECISIONS.md).
- [`docs/data.md`](docs/data.md): the fetch: its source, fields, frame, and what it holds.
- [`docs/milestones.md`](docs/milestones.md): the specs, checks, and evidence of finished milestones.
- [`docs/LESSONS.md`](docs/LESSONS.md): what each milestone taught us.

---

## Status

| Milestone | Title | Status |
|---|---|---|
| M0 | The two canvases: a spike | Done 2026-11-11 ([`docs/milestones.md`](docs/milestones.md)) |
| M1 | The orbits' data | Active: part B next |
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

Nothing. The tall table's `live`, `sort`, and `select` are built, and with the rows held in Rust a filter to a drawn group and a sort are both the delegate's work, an index it reads its pages through: the spike's filter needed nothing new (`docs/DECISIONS.md`, "Table"). Nothing is asked of `engines/duckdb/`: the app doesn't use it.

---

## Active milestone

### M1: The orbits' data

Every row gets a real place. Positions need all six orbital elements and their epoch; Tycho's asteroid sample has a, e, and i, at the few digits it keeps (a to a thousandth of an au: 9,580 distinct values in 1.57 M rows). The node, the argument of perihelion, the mean anomaly, and the epoch are fetched from JPL's query API, under the pinned-file rules Tycho's samples follow (`apps/tycho/docs/data.md`), with every other column, in one fetch of Kirkwood's own (`docs/DECISIONS.md`, "Data"; what it holds: `docs/data.md`), and the two files the app holds in memory are built from it (`docs/DECISIONS.md`, "Stack": the rows are held in Rust, with no DuckDB): the elements file the scene draws from, and the rows file the table reads.

No app is built here. The files are seen on the spike, which stays as their viewer until M2's scene draws the belt, its seeded angles replaced by the real ones (`docs/DECISIONS.md`, "Planning"). The scripts and the manifest are kept: they go in `data/`, with a `docs/data.md` that says how the files are made.

**Split into parts,** one session each (root `CLAUDE.md`, "Working agreements"):

- **Part A (done 2026-11-11): the fetch, and what it decides.** What JPL serves (the three angles, the epoch, and a, e, and i at full precision), fetched once into `data/raw/` (gitignored). Which rows: the sample's 1,567,523, joined on `spkid`, or a fetch of Kirkwood's own with every column. What the fetch says of the epochs. Closes A1 to A3.
- **Part B: the two files.** The elements file's layout and precision, chosen by its worst error on screen against its bytes; the rows file, from the spike's layout; the manifest; `docs/data.md`. Closes B1 to B3.
- **Part C: seen, and the close.** The spike draws from the real elements, with Jupiter on its own orbit; the resonant groups checked by number and by eye; M2's spec written. Closes C1 to C4.

**Done when:**

- [x] **A1. The elements are fetched and pinned:** the node, the argument of perihelion, the mean anomaly, and the epoch for every row, in `data/raw/`, with the fetch's date, the API's count, and the fields it returned recorded. The frame and the units are written down (heliocentric ecliptic J2000 is expected; checked against JPL's documentation, not assumed).
  - *2026-11-11: 1,580,272 rows in `data/raw/asteroids/` at full precision, `fetch.json` beside them (the query, the 26 fields, the date, the count, the same on all 16 pages). The node, the argument of perihelion, and the epoch are on every row; one row has no mean anomaly (a circle, which takes 0). The frame is as expected, in JPL's words: "heliocentric IAU76/80 ecliptic", equinox `J2000` on every row, epochs in TDB. [`docs/data.md`](docs/data.md).*
- [x] **A2. The rows are decided:** whether Kirkwood's rows are Tycho's pinned sample (joined on `spkid`: how many of its rows the fetch no longer has, how many of their a, e, or i moved since 2026-09-24, and by how much) or a fetch of its own with every column. With it, which a, e, and i the scene draws from and which the table shows, so that a row's cells and its dot can't disagree by more than a cell shows.
  - *2026-11-11: a fetch of its own. The fetch still has every row of the sample and 12,749 more; 220 of the sample's rows have an a, e, or i that moved (a by up to 160 au). The scene and the table both read the elements file's a, e, and i. [`docs/DECISIONS.md`](docs/DECISIONS.md), "Data".*
- [x] **A3. The epoch's spread is known:** how many rows share the commonest epoch, the range of the rest, and the rule that brings every row to one epoch at prep (each row's mean anomaly moved on by its own mean motion is expected to do). A number for each.
  - *2026-11-11: 1,483,888 rows (93.9%) at JD 2461200.5 (2026-06-09); the other 96,384 from 1927-06-20 to 2026-11-11, half more than 6.6 years back. The expected rule does: the mean anomaly moved on by the row's mean motion, at most 49 turns, on rows seen for a median of 6 days. [`docs/DECISIONS.md`](docs/DECISIONS.md), "Data".*
- [ ] **B1. The elements file:** its layout, its bytes raw and at brotli 11, and its worst error: the farthest any row's place is from its place in 64-bit floats, over 50 years either side of the epoch, in au and in pixels from the opening camera. Decides 32-bit floats against 16-bit quantities (the spike's a, e, and i compress to under half, `docs/DECISIONS.md`, "Table"; the angles won't). H rides in it (`docs/DECISIONS.md`, "Look").
- [ ] **B2. The rows file:** the table's other columns as the app will hold them, from the spike's layout (its bytes: `docs/DECISIONS.md`, "Table"), with what it gives up for fewer bytes written down (the text's offsets are a sixth of it; `pdes` repeats most of `full_name`). Its bytes raw and at brotli 11, and whether it's one file or the first rows apart from the rest (open question, "The rows on a slow link").
- [ ] **B3. The files are reproducible:** `data/MANIFEST.json` (committed) holds each file's rows, bytes, SHA-256, source, and fetch date; a second run of prep from `data/raw/` writes the same bytes; `docs/data.md` says how, and gives the credit line.
- [ ] **C1. The Trojans sit ahead of and behind Jupiter, with no placement by hand:** for the rows of class TJN, their longitude from Jupiter's at one date as a histogram, its two peaks near 60° ahead and behind, and a screenshot.
- [ ] **C2. The Hildas form their triangle,** in a screenshot from above at one date, its corners where Jupiter's place says they should be. Which rows count as Hildas is written down (the sample has no class for them: by a, 3.7 to 4.2 au, is expected).
- [ ] **C3. A known body is where JPL says:** Ceres, Vesta, and one Trojan against JPL Horizons at two dates a decade apart, each within a distance written down beside the check.
- [ ] **C4. M2's spec, checks, and parts are written** here, and `CLAUDE.md`'s layout has `data/`.

---

## Next milestones

Outlines only. Each is specced when the one before it closes.

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

- **The rows on a slow link:** held in memory, nothing of the table shows until its whole file is in, about half a minute on Fast 4G (`docs/DECISIONS.md`, "Table"). Whether the first rows travel apart from the rest (a page is under 0.1 MB), the text columns come after the numbers, or the handle just says the rows are loading. And the order: the elements first, so the belt never waits on the table. *M1, B2, for the files; M2 for what the handle says.*
- **A sort's stall:** ordering every row takes a third to two thirds of a second on one thread (`docs/DECISIONS.md`, "Table"), in one task, as the pick does. Whether it runs in a worker, is spread over frames, or the orders ship in the file. *M5, with the pick's stall.*
- **The page's memory:** every row held is most of the wasm's memory (`docs/DECISIONS.md`, "Table"). What a phone makes of it. *M6, with the phone's answer.*
- **More live columns:** the Sun's distance is live, at 2 a second. Which others join it (the distance from Earth needs Earth's place), and how many decimals a live cell shows. *M5.*
- **The clock's speed with the table open:** at a year a second the Sun's distance moves by up to half an au a second, so its last two decimals are never readable while time runs, at any refresh rate. Whether time slows while the table shows, the column drops decimals while it moves, or it's left as a blur that settles on pause. *M5.*
- **The pick's stall:** placing 1.57 M rows to pick a shape's takes about 0.4 s in one task at the release. How it's taken off the frame: the rows' rotation computed once, a worker, or spread over the frames the outline closes in. *M5.*
- **A shape drawn in a against e:** the spike takes a shape in space only. Picking a gap's edge on the landed layout is the natural next ask. *M5.*
- **The a against e furniture:** how much of board 4 is kept as drawn (liked on review, not yet specced). *M3.*
- **A Worker of its own on the path:** whether a second Worker can take `/kirkwood/*` on a hostname bound to Tycho's as a custom domain. *M6.*
- **The scene's resolution:** all 1.57 M points at the display's full resolution ran past a frame on an M1 in headless Chromium; half resolution held 60. Which resolution ships, chosen by eye in a real browser. In screenshots at the display's pixels the two read as the same dust up close, the half-resolution grain and the Sun's edge softer; at half, every move holds 60 but the fly-in with the table arriving (10% of its frames late). With the look on, half resolution is turned down by eye (`docs/DECISIONS.md`, "Look"), so what's left to choose is between the display's and three quarters of it. *M2 decides.*
- **The look:** tried on the spike and written down part by part (`docs/DECISIONS.md`, "Look"). The full look is kept, the whole Gaia sky with it, at the display's resolution. Still open: the page's text over a starry corner; the color scheme, which the look left alone; whether a deeper cut is worth its bytes for the Milky Way as a band; and the frame rate, below. *M2.*
- **The look's frame rate:** about 29 frames a second while time runs at the display's resolution (headless Chromium, an M1), and half resolution is turned down by eye. What gets it back without halving: three quarters of the resolution (unmeasured), a smaller bloom, the belt's own draw (the cost before the look was points times pixels), or a slower default clock. *M2.*
- **A shape drawn across the panel:** a drag that leaves the scene's surface for the panel stops adding points until it comes back (a release there still closes the shape). Whether the panel should let it through. The spike's fly-in left it as it was: a release over the panel closes the shape, and the group is what the closed shape holds. *M5.*
- **Rows with no ellipse:** 7 rows of the fetch have e past 1 and aren't drawn (the sample had 5). What the scene and the row count say about them. *M2.*
- **A phone:** whether the scene and a summoned table work at phone width, or the app says it's for a larger screen. *M6.*
