# Finished milestones: specs and evidence

Each milestone's spec, "done when" checks, and evidence, moved here from [`../PLAN.md`](../PLAN.md) when it closed. History: don't edit it, except to fix a broken link. Paths are relative to `apps/kirkwood/`.

## M0: The two canvases: a spike (closed 2026-11-11)

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
- [x] **C1. The rows in memory:** the 1.57 M rows with their text columns held in Rust: bytes in memory, bytes on the wire, and time to the table's first rows, against the same table over DuckDB. Decides the table's source, and with it how a filter to a group's rows is read.
  *Held in Rust as one file's bytes, each cell read where it is ([the table over them](docs/spike/rows.jpg)): 112.8 MB in memory, the file's own size; 23.6 MB on the wire at brotli 11 (40.2 at gzip 9); the table's first rows at 819 ms, against 821 ms over DuckDB (the observatory's GPUI contender on the same file), and at 62.9 s against 13.4 s on Fast 4G as the spike serves its files (about 36 s with both at brotli 11). A group's filter is its indices; a sort by diameter takes 305 ms. The rows are held in Rust and there is no DuckDB. `docs/DECISIONS.md`, "Table".*
- [x] **C2. The stack is decided** in `docs/DECISIONS.md`: the scene's renderer, who owns the clock and the selection, the rows' source, and how the two canvases are laid out.
  *Three.js under a transparent GPUI canvas; the clock, the selection, and the rows are Rust's; the table is a panel on the right behind a handle. `docs/DECISIONS.md`, "Stack".*
- [x] **C3. M1's spec, checks, and parts are written** here, and `CLAUDE.md`'s stack and layout say what M0 decided.
  *M1 is specced in `PLAN.md` in three parts, with the spike kept one milestone more as its viewer (`docs/DECISIONS.md`, "Planning"); `CLAUDE.md`'s "Stack" is the decided one.*

## M1: The orbits' data (closed 2026-11-11)

Every row gets a real place. Positions need all six orbital elements and their epoch; Tycho's asteroid sample has a, e, and i, at the few digits it keeps (a to a thousandth of an au: 9,580 distinct values in 1.57 M rows). The node, the argument of perihelion, the mean anomaly, and the epoch are fetched from JPL's query API, under the pinned-file rules Tycho's samples follow (`apps/tycho/docs/data.md`), with every other column, in one fetch of Kirkwood's own (`docs/DECISIONS.md`, "Data"; what it holds: `docs/data.md`), and the two files the app holds in memory are built from it (`docs/DECISIONS.md`, "Stack": the rows are held in Rust, with no DuckDB): the elements file the scene draws from, and the rows file the table reads.

No app is built here. The files are seen on the spike, which stays as their viewer until M2's scene draws the belt, its seeded angles replaced by the real ones (`docs/DECISIONS.md`, "Planning"). The scripts and the manifest are kept: they go in `data/`, with a `docs/data.md` that says how the files are made.

**Split into parts,** one session each (root `CLAUDE.md`, "Working agreements"):

- **Part A: the fetch, and what it decides.** What JPL serves (the three angles, the epoch, and a, e, and i at full precision), fetched once into `data/raw/` (gitignored). Which rows: the sample's 1,567,523, joined on `spkid`, or a fetch of Kirkwood's own with every column. What the fetch says of the epochs. Closes A1 to A3.
- **Part B: the two files.** The elements file's layout and precision, chosen by its worst error on screen against its bytes; the rows file, from the spike's layout; the manifest; `docs/data.md`. Closes B1 to B3.
- **Part C: seen, and the close.** The spike draws from the real elements, with Jupiter on its own orbit; the resonant groups checked by number and by eye; M2's spec written. Closes C1 to C4.

**Done when:**

- [x] **A1. The elements are fetched and pinned:** the node, the argument of perihelion, the mean anomaly, and the epoch for every row, in `data/raw/`, with the fetch's date, the API's count, and the fields it returned recorded. The frame and the units are written down (heliocentric ecliptic J2000 is expected; checked against JPL's documentation, not assumed).
  - *2026-11-11: 1,580,272 rows in `data/raw/asteroids/` at full precision, `fetch.json` beside them (the query, the 26 fields, the date, the count, the same on all 16 pages). The node, the argument of perihelion, and the epoch are on every row; one row has no mean anomaly (a circle, which takes 0). The frame is as expected, in JPL's words: "heliocentric IAU76/80 ecliptic", equinox `J2000` on every row, epochs in TDB. [`docs/data.md`](docs/data.md).*
- [x] **A2. The rows are decided:** whether Kirkwood's rows are Tycho's pinned sample (joined on `spkid`: how many of its rows the fetch no longer has, how many of their a, e, or i moved since 2026-09-24, and by how much) or a fetch of its own with every column. With it, which a, e, and i the scene draws from and which the table shows, so that a row's cells and its dot can't disagree by more than a cell shows.
  - *2026-11-11: a fetch of its own. The fetch still has every row of the sample and 12,749 more; 220 of the sample's rows have an a, e, or i that moved (a by up to 160 au). The scene and the table both read the elements file's a, e, and i. [`docs/DECISIONS.md`](docs/DECISIONS.md), "Data".*
- [x] **A3. The epoch's spread is known:** how many rows share the commonest epoch, the range of the rest, and the rule that brings every row to one epoch at prep (each row's mean anomaly moved on by its own mean motion is expected to do). A number for each.
  - *2026-11-11: 1,483,888 rows (93.9%) at JD 2461200.5 (2026-06-09); the other 96,384 from 1927-06-20 to 2026-11-11, half more than 6.6 years back. The expected rule does: the mean anomaly moved on by the row's mean motion, at most 49 turns, on rows seen for a median of 6 days. [`docs/DECISIONS.md`](docs/DECISIONS.md), "Data".*
- [x] **B1. The elements file:** its layout, its bytes raw and at brotli 11, and its worst error: the farthest any row's place is from its place in 64-bit floats, over 50 years either side of the epoch, in au and in pixels from the opening camera. Decides 32-bit floats against 16-bit quantities (the spike's a, e, and i compress to under half, `docs/DECISIONS.md`, "Table"; the angles won't). H rides in it (`docs/DECISIONS.md`, "Look").
  - *2026-11-11: seven columns of 32-bit floats (a, e, i, the node, the argument of perihelion, the mean anomaly from -180 to 180, H): 44.2 MB raw, 34.6 at brotli 11. Its worst row is 0.0012 au from its 64-bit place, 0.04 px from the opening camera (the median, 0.0000067 au). Floats over 16 bits: all six in 16 bits put half the belt a pixel off within 50 years, and e or the mean anomaly in 16 put 63 rows more than a pixel off, one by 16 au; the three rotations alone in 16 bits stay under a pixel and save 7.6 MB, turned down for the cells' digits. [`docs/DECISIONS.md`](docs/DECISIONS.md), "Data"; the layout, [`docs/data.md`](docs/data.md).*
- [x] **B2. The rows file:** the table's other columns as the app will hold them, from the spike's layout (its bytes: `docs/DECISIONS.md`, "Table"), with what it gives up for fewer bytes written down (the text's offsets are a sixth of it; `pdes` repeats most of `full_name`). Its bytes raw and at brotli 11, and whether it's one file or the first rows apart from the rest (open question, "The rows on a slow link").
  - *2026-11-11: 46.3 MB raw, 11.2 at brotli 11 (the spike's: 112.8 and 23.6). `full_name` and `pdes` aren't stored: each is rebuilt from the row's number, its name, and its designation packed into 32 bits, and prep fails on a row that doesn't rebuild. q and the period are computed from a and e; H is the elements file's. One file, the first rows not sent apart (37 KB would do it, but the table can't open before the elements are in). [`docs/DECISIONS.md`](docs/DECISIONS.md), "Data".*
- [x] **B3. The files are reproducible:** `data/MANIFEST.json` (committed) holds each file's rows, bytes, SHA-256, source, and fetch date; a second run of prep from `data/raw/` writes the same bytes; `docs/data.md` says how, and gives the credit line.
  - *2026-11-11: the manifest holds them, and each file's layout; `prep.ts --check` built both again to the same SHA-256 (`c804184f…` and `f93722de…`), and every run reads all 1,580,272 rows back out of the built bytes against the fetch. [`docs/data.md`](docs/data.md), "The two files".*
- [x] **C1. The Trojans sit ahead of and behind Jupiter, with no placement by hand:** for the rows of class TJN, their longitude from Jupiter's at one date as a histogram, its two peaks near 60° ahead and behind, and a screenshot.
  - *2026-11-11: the 16,472 rows of class TJN at the epoch (2026-06-09), each placed from its own six elements in the built file, by longitude from Jupiter's place (`data/places.ts`): 10,473 ahead, their median 62.6° from it, and 5,999 behind, at 61.2°; 16,048 (97.4%) within 30° of the two points. [The two clouds on the 60° lines](docs/spike/seen-trojans.jpg), and [in the whole belt](docs/spike/seen-belt.jpg) (`spike/run.ts --only seen`). `docs/DECISIONS.md`, "Scene".*

    | Longitude from Jupiter's | Rows | | Longitude from Jupiter's | Rows |
    |---|---|---|---|---|
    | -180° to -160° | 5 | | 0° to 20° | 14 |
    | -160° to -140° | 4 | | 20° to 40° | 330 |
    | -140° to -120° | 4 | | 40° to 60° | 4,108 |
    | -120° to -100° | 28 | | 60° to 80° | 4,974 |
    | -100° to -80° | 545 | | 80° to 100° | 1,001 |
    | -80° to -60° | 2,616 | | 100° to 120° | 43 |
    | -60° to -40° | 2,583 | | 120° to 140° | 2 |
    | -40° to -20° | 211 | | 140° to 160° | 0 |
    | -20° to 0° | 3 | | 160° to 180° | 1 |
- [x] **C2. The Hildas form their triangle,** in a screenshot from above at one date, its corners where Jupiter's place says they should be. Which rows count as Hildas is written down (the sample has no class for them: by a, 3.7 to 4.2 au, is expected).
  - *2026-11-11: the rows on an ellipse with a from 3.7 to 4.2 au, 8,400 of them; the resonance's own angle is within 90° of zero on 8,045, so the rule picks the right rows (the narrower one, with e under 0.3 and i under 20°, turns away 807 of those). [The triangle from above at the epoch](docs/spike/seen-hildas.jpg), its dots brightened sixfold to be seen. Its corners point 60.3°, 180.3°, and 300.3° from Jupiter's mean longitude, and 5° short of that from Jupiter's place, which was 5.3° ahead of its mean that day. `docs/DECISIONS.md`, "Scene".*
- [x] **C3. A known body is where JPL says:** Ceres, Vesta, and one Trojan against JPL Horizons at two dates a decade apart, each within a distance written down beside the check.
  - *2026-11-11: at the epoch, within 0.000001 au (150 km): Ceres 0.0000001, Vesta 0.0000002, Hektor 0.0000002 (and Patroclus and 153 Hilda, under 0.0000009). A decade on (2036-06-09), within 0.1 au: Ceres 0.041, Vesta 0.003, Hektor 0.020 (Patroclus 0.07, Hilda 0.09). The reference places are pinned in `data/horizons.json`, at eight dates; 50 years out Ceres is 0.2 au off and Hektor up to 2.7. `docs/DECISIONS.md`, "Scene"; `docs/data.md`, "Checked against Horizons".*
- [x] **C4. M2's spec, checks, and parts are written** here, and `CLAUDE.md`'s layout has `data/`.
  - *2026-11-11: M2 is specced in `PLAN.md` in four parts; `CLAUDE.md`'s layout lists `data/`'s scripts, with Jupiter's orbit and the check against Horizons.*
