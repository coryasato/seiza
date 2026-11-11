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
| M2 | The belt in space | Active: part A next |
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

### M2: The belt in space

Board 1, as an app. The crate, the web host, and a page that paints first and loads the scene after; every row on its own Kepler orbit from the elements file, with Jupiter on its; a time control; color by orbit size with its legend; the line that says dot sizes are exaggerated; and the table behind its handle, opening as a panel over every row of the rows file. The stack is the spike's (`docs/DECISIONS.md`, "Stack") and the look is the one tried on it ("Look"), built to keep this time: nothing of the spike's code is carried over, and it's deleted when this scene draws the belt ("Planning").

Not here: the three actions board 1 draws beside the time control (each arrives with its own milestone: M3, M4, M5), a drawn shape and its fly-in, a click on a dot or a row, and the live column (M5), and the deploy (M6): the dev server serves the files from `data/`.

**Split into parts,** one session each (root `CLAUDE.md`, "Working agreements"):

- **Part A: the app stands, and the table is the rows file.** `crate/` (the cdylib), `web/` (a Vite host on `shared-web/`, an npm workspace), and a `just kirkwood` module (dev, build, test, lint; no check, perf, or report: a showcase has no budgets). GPUI's first frame: the title, the time control, and the handle, saying its rows are loading. After it the two files, the elements first, each held as it arrives and read where it lies, and the table over every row and all 18 columns. Closes A1 to A3.
- **Part B: the belt on its orbits.** The scene's module (Three.js, loaded after the first frame) on its own canvas under GPUI's, its attributes views over the elements' columns; the clock and the time control; the Sun, and Jupiter on its orbit; the rows with no ellipse; a wheel on each canvas. Closes B1 to B4.
- **Part C: the look, the legend, and the sky.** The look as it was decided, part by part; color by orbit size and its legend; the sky's file, built in `data/` and pinned. Closes C1 to C3.
- **Part D: what's left to choose, and the close.** The scene's resolution and frame rate, by eye; the slow link; the other browsers; the spike deleted; M3's spec. Closes D1 to D5.

**Done when:**

- [ ] **A1. It paints first.** On a cold load, GPUI's first frame (the title, the time control, the handle) is on screen before the scene's module or either file is asked for: the order of one load's requests and marks, and a screenshot of that frame. The time to it is recorded, not gated.
- [ ] **A2. The table is the rows file.** Behind its handle, a panel over all 1,580,272 rows and the 18 columns of Tycho's sample, in its order; the count on the handle is counted from the file, and the first row is Ceres. A native test reads cells through the crate's own readers and compares them with the fetch's, for rows prep picks to cover each of the file's rules (written by `data/` as a fixture): a numbered and named row, a numbered one with no name, an unnumbered one, a designation with `A/`, a survey's, a first observation with only its year, a row with no H, one with no diameter, the circle with no mean anomaly, and a row with no ellipse. The cells of a, e, i, and H are the elements file's floats at their shortest; q and the period are computed (`docs/data.md`).
- [ ] **A3. Each file is held once.** The wasm's memory with both files in, against the files' own 90.5 MB: no second copy of either (the spike parsed the elements into a second buffer). A number.
- [ ] **B1. Every row with an ellipse is a dot on its own orbit,** drawn from the columns where they lie: the scene's attributes are views over the wasm's memory, and the upload to the GPU is the only copy. From straight above at the epoch, the Trojans sit on the 60° lines and the Hildas' triangle shows, beside the spike's shots (`docs/spike/seen-*.jpg`); and three rows drawn alone (Ceres, Vesta, Hektor) are each where the crate's own 64-bit place puts them, to a pixel, at the epoch and a decade on.
- [ ] **B2. The time control:** run and pause, the date, and the speed it says (board 1: "1 year a second"). How far the date goes each way is decided, from what a two-body orbit is worth that far out (`docs/DECISIONS.md`, "Scene") and from the shader's 32-bit clock: the worst row's error at the range's ends, in pixels from the opening camera, is written down, with what was done about it (open questions, "How far the time control goes", "The clock's arithmetic"). The clock is Rust's, and runs whether or not the scene draws.
- [ ] **B3. The Sun and Jupiter are plainly not dots,** labeled as board 1 labels them. Jupiter is on its own orbit (a native test: within 0.01 au of `data/horizons.json` at each of its eight dates), and the orbit is drawn as a line.
- [ ] **B4. The rows with no ellipse are accounted for on screen:** drawn on their real paths or counted apart, decided. Either way a count the page shows is counted from the rows, and says what it counts.
- [ ] **C1. The look is the decided one** (`docs/DECISIONS.md`, "Look"): linear light and one tone map, a dot's brightness and size from its H as the eye would see it, the haze, the bloom, the floor, the Sun's glow, a dot growing with the camera's nearness, and the opening camera. Screenshots from the spike's three cameras, beside the spike's own.
- [ ] **C2. Color is orbit size, with its legend** as board 1 draws it (1.6 to 5.2 au); the ramp is the storyboard's color note, or what replaces it, decided; and the line that says dot sizes are exaggerated is on screen.
- [ ] **C3. The sky is one of `data/`'s files:** Gaia's stars brighter than G 10.5, built by a script in `data/` from the Gaia sample and pinned in the manifest, with its credit; loaded after the belt and never waited on; and the page's text reads over it (a scrim, or a quieter corner).
- [ ] **D1. The scene's resolution is chosen,** the display's or three quarters of it, by eye in a real browser with the look on; the frame rate while time runs is recorded, with what was given up to reach it (the bloom's size, the belt's own draw, the default speed). At rest the scene draws nothing.
- [ ] **D2. A slow link shows something the whole way.** On Fast 4G, what the page says and draws from its first frame to the belt (34.6 MB) and on to the table (11.2 MB more). Whether either file is cut into blocks of rows, drawn and paged as they arrive, is decided, with the times to the first dots and to the whole belt.
- [ ] **D3. It runs in Firefox and WebKit** (headless: the first frame, the belt, the panel, a wheel over each canvas), with the differences noted.
- [ ] **D4. The spike is deleted,** its screenshots kept in `docs/spike/` as the record; `CLAUDE.md`, `README.md`, the root's layout, and `docs/data.md` say what's built.
- [ ] **D5. M3's spec, checks, and parts are written** here.

---

## Next milestones

Outlines only. Each is specced when the one before it closes.

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

- **The belt and the rows on a slow link:** each file travels whole, the elements first (`docs/DECISIONS.md`, "Data"). On Fast 4G that is 34 s to the belt (34.6 MB at brotli 11: real angles at full precision don't compress, where the spike's rounded a, e, and i were 8.7) and 11 s more to the table. What the page shows meanwhile and what the handle says; and whether either file is cut into blocks of rows, so the belt fills in and the table pages as they arrive (the numbered asteroids, the brightest, come first). The fallback that only shrinks the wait: the three rotations in 16 bits, 7.6 MB less. *M2.*
- **A sort's stall:** ordering every row takes a third to two thirds of a second on one thread (`docs/DECISIONS.md`, "Table"), in one task, as the pick does. Whether it runs in a worker, is spread over frames, or the orders ship in the file. *M5, with the pick's stall.*
- **The page's memory:** every row held is most of the wasm's memory (`docs/DECISIONS.md`, "Table"): the two files are 90.5 MB held as they arrive. What a phone makes of it; the diameter and albedo as a list of the rows that have one would take 11 MB out (`docs/DECISIONS.md`, "Data"). *M6, with the phone's answer.*
- **The clock's arithmetic far from the epoch:** the shader's 32-bit clock, not the file, is what limits a place: an estimated 0.17 au at worst 50 years out, on an orbit with e near 1 (`docs/DECISIONS.md`, "Data"). Whether the scene's clock needs more care than the spike's (the turns taken off in Rust before the shader adds the rest), or 50 years is farther than the time control goes. *M2.*
- **How far the time control goes:** a row's place is its 2026 ellipse, within 0.13 au of JPL's a decade either side and a few degrees along its orbit half a century out; the Trojans' clouds leak on Kepler orbits (a quarter of them out of their 30° in 50 years), until they're integrated (`docs/DECISIONS.md`, "Scene"). Whether the date is held to a range, and what the page says of a date far from 2026. *M2 (B2).*
- **The Hildas and the Trojans are faint:** 8,400 and 16,472 dots of 1.58 M. The spike's shots brightened them sixfold and twofold to show their shapes, and the storyboard's board 2 no longer brightens them. What the frame that turns with Jupiter does so the triangle reads: gray the rest (as a picked group does), brighten the two groups, or both. *M4.*
- **Which Hildas librate:** the rows from 3.7 to 4.2 au, 8,400, of which the resonance's angle holds 8,045 at the epoch (`docs/DECISIONS.md`, "Scene"). Whether the integration moves all 8,400 or only those it finds swinging. *M4.*
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
- **Rows with no ellipse:** 7 rows of the fetch have e past 1 and aren't drawn (the sample had 5). What the scene and the row count say about them. The elements file keeps their a, e, and a hyperbola's mean anomaly, so they could be drawn on their real paths. *M2.*
- **A phone:** whether the scene and a summoned table work at phone width, or the app says it's for a larger screen. *M6.*
