# Kirkwood

Kirkwood is a showcase: the asteroid belt as a scene to fly through, drawn from the asteroid table's own rows, with the table of those rows beside it, each moving the other. Named for Daniel Kirkwood, who found the gaps in the belt in a catalog of orbits, not through a telescope.

**The app stands without its scene.** `crate/` and `web/` are the app: GPUI's first frame (the title, the time control, the table's handle), then the two files, each written into the wasm's memory as it arrives, and the table over every row in a panel behind the handle. The scene isn't built: nothing is drawn under the interface yet. The throwaway spike (`spike/`: a Three.js scene under a transparent GPUI canvas with the tall table) decided the stack (below); it's never deployed, none of its code is carried forward, and it stays, as the viewer of the orbits' data (it draws from the real elements file, `data/elements.bin`), until the app's own scene draws the belt (`docs/DECISIONS.md`, "Planning").

---

This is Kirkwood's context. What's next is in `PLAN.md`; why things are built this way, in `docs/DECISIONS.md`; finished milestones, in `docs/milestones.md`; the rows' source, in `docs/data.md`; the research behind it, in the root's `docs/research/asteroid-belt.md` (the root `CLAUDE.md`, "Docs: one home per fact", says what goes where). The repo-wide rules in the root `CLAUDE.md` apply here except where "Tiers" exempts a showcase. Paths below are relative to `apps/kirkwood/`.

Current state only: say what to do and point to the decision behind it (`docs/DECISIONS.md`, "<area>"); don't retell its reasons.

## Kirkwood rules

These replace the measuring rules a showcase is exempt from (root `CLAUDE.md`, "Tiers": no budgets, no results notes, no measurement protocol) and add to the rest.

1. **Every dot is a row.** Nothing is drawn as an asteroid that isn't a row of the table, and a count on screen is counted from the rows. What the scene adds that isn't a row (the Sun, Jupiter, an orbit line, a marker) is plainly not a dot.
2. **Paint first, load the scene after.** Nobody watches a blank page while the data arrives (root rule 2).
3. **Say what's exaggerated or invented, on screen.** Dot sizes are exaggerated and the page says so; a marker asteroid is called a marker; a close-up body with no shape on file is labeled as illustration. No dense rock field: the belt is empty at true scale (the research, "What's honest to simulate").
4. **Color is data.** A dot's color is its orbit size; a dot without color (gray) isn't in the picked group; white is for what the interface adds (a drawn shape's outline, a marker and its path). Don't spend a hue on decoration (`docs/DECISIONS.md`, "Look").
5. **For a person to read.** Nothing on screen changes faster than someone can follow: a live cell refreshes at a rate chosen by looking at it, not as fast as the clock runs.
6. **No tour on load.** A visitor opts in through one-press actions, taken in any order or not at all.
7. **Handle the canvas tradeoffs in the open** (root rule 4), in `README.md`, once there's an app to have them.

## Stack

Decided by the spike (`docs/DECISIONS.md`, "Stack", which points to each part's own decision). Built so far: the rows, the clock, and the interface without the scene under it.

- **The scene:** Three.js on a canvas of its own, under GPUI's, loaded after GPUI's first frame. A deliberate exception to "logic in Rust, JS thin" (root `docs/DECISIONS.md`, "Repo structure", the showcase tier). It draws only when the clock, the camera, or the window changed, at a resolution of its own, and every orbit is solved in its vertex shader. The sky's stars are its own (JS): they aren't rows.
- **The engine:** Rust owns the orbital elements and their buffers (the scene's vertex buffer is a view over them), the clock, the sort flight's progress, and the selection (a set of row indices, picked through the scene's camera). The scene asks Rust each frame it draws; Rust calls the scene to move its camera or hand it a group.
- **The interface:** GPUI through `shared/` (crate `seiza`), its canvas over the scene's and transparent wherever it drew nothing, with `components/tall-table/` in a panel on the right behind a handle. GPUI's hit test decides which canvas an input is for.
- **The rows:** held in Rust, as the bytes of the two files, each written into the wasm's memory as its response arrives and read where it lies (`crate/src/bytes.rs`: 32-bit words, so no `unsafe` and no copy); the table's delegate answers every page from them, and a filter to a group is the group's indices. No DuckDB, and no `engines/duckdb/`. Why: `docs/DECISIONS.md`, "Data" and "Table".

## Layout

```
apps/kirkwood/
  crate/            # `kirkwood` (cdylib): bytes.rs (a file's bytes as 32-bit words, read where they lie), elements.rs (the elements file: seven columns of floats, the epoch, the clock's year), rows.rs (the rows file: its sections, a designation unpacked, a name found by its row, dates), catalog.rs (the two as the sample's 18 columns: a cell's value, the columns' kinds, q and the period; its tests read data/fixture.json against the real files), table.rs (the tall table's source: a page is a range of rows), clock.rs (years since the epoch, moved by whoever reads it, held until the files are in), host.rs (the view: the title, the time control, the handle, the panel and its slide), web.rs (wasm only: `start`, and the files' arrival, `file_begin`, `file_progress`, `file_end`, `file_failed`)
  web/              # the Vite host on shared-web/ (`@seiza/kirkwood-web`): index.html, src/main.ts (boot; after the first frame, each file's response stream into the crate's memory, its length from data/MANIFEST.json), vite.config.ts (the two files served at /data/ from data/, in dev and preview)
  checks/           # see.ts (what the release build shows: the first frame before either file is asked for, the table over the rows file, the wasm's memory against the files' bytes; out/ gitignored)
  data/             # fetch.ts (the asteroid catalog from JPL, every column at full precision, into raw/), survey.ts (what the fetch holds, and Tycho's sample against it), catalog.ts (the fetch as its readers take it: the rows in the files' order, every row at the one epoch, a designation packed, a place from six elements), prep.ts (the two files the app holds, elements.bin and rows.bin, MANIFEST.json, which pins them, and fixture.json, a row for each of the files' rules with the fetch's cells, which the crate's readers are tested against), precision.ts (the elements' precision weighed: error against bytes), orbit.ts (the epoch, the clock's year, and a place from six elements) and jupiter.ts (Jupiter's orbit: its elements at the epoch and its own mean motion), both free of Node so a page can import them, horizons.ts (JPL Horizons' places for five known asteroids and Jupiter, into horizons.json), places.ts (the built files' places against Horizons', and the Trojans and the Hildas against Jupiter); raw/ and the two files are gitignored, the manifest, the fixture, and horizons.json committed; plain Node, no dependencies
  docs/             # DECISIONS.md, LESSONS.md, milestones.md, data.md (the fetch: source, fields, frame; the two files: layout, how to read them, sizes; the fixture; Jupiter's orbit; the check against Horizons); spike/ (the spike's screenshots), seen/ (the app's, cited by the plan's checks)
  spike/            # throwaway: crate/ (`kirkwood-spike`: the elements, read from `data/elements.bin`, the clock, counted from the elements' epoch, the sort flight's progress, the scene's input surface, a drawn group's pick, the panel and its table with its filter and live column, the sample's other columns held as their file's bytes), src/ (main.ts; alpha.ts, GPUI's canvas composited by its alpha; scene.ts, the belt in Three.js, with Jupiter on its own orbit (`data/jupiter.ts`): the flight between space and a against e, the group's colors and outline, the camera's fly-in; look.ts, the look's knobs and its pipeline: the half-float buffer, haze, bloom, tone mapping, the floor; stars.ts, the Gaia sky; colors.ts, the color mappings), data.ts (the bright stars from the Gaia sample; and for `?sample` and `?rows`, the spike as it first was: the sample's a, e, and i, its H, and its rows file), sizing.ts (the rows file on the wire, and native DuckDB on the same reads), run.ts (screenshots, input checks, the moves' checks, frame times, bytes, the rows in memory), lookdev.ts (the look: before and after from three cameras, each part's frame cost, first paint); not an npm workspace
  README.md         # for visitors
  CLAUDE.md         # this file
  PLAN.md           # what's next
```

No `perf/`: a showcase has no budgets and no results. What its checks ask to be seen comes from `checks/see.ts` (`docs/DECISIONS.md`, "Planning").

## Commands

From the repo root. The app's:

```
just kirkwood dev      # debug wasm + the Vite dev server with COOP/COEP; the two files from data/ (?date=YYYY-MM-DD for where the clock starts, ?paused to hold it; ?perf for the table's probes, with ?probe-cells its drawn cells)
just kirkwood build    # release wasm alone (-p) + wasm-opt, Vite build, asset sizes
just kirkwood preview  # serve that build, and the two files
just kirkwood test     # native tests: the clock and the files' rules, and the readers against data/fixture.json on the real files (`#[ignore]`d in a plain `cargo test`; here they run, and fail without data/elements.bin and data/rows.bin)
just kirkwood see [--only paint,table,memory] [--runs 5]   # the release build in headless Chromium: the first frame before either file is asked for, the table's rows, columns, first and last row, the wasm's memory against the files' bytes; screenshots and seen.json in checks/out/; run `build` first
just kirkwood lint     # check-terms, fmt, clippy (wasm32 and native), tsc (the host, the checks, the data's scripts)
```

The data's (also in `docs/data.md`) and the spike's:

```
node apps/kirkwood/data/fetch.ts [--refresh]             # the asteroid catalog from JPL into data/raw/asteroids/ (~3 min, once; a rerun reuses it, and the fetch date is part of the dataset, so don't refresh without a reason)
node --max-old-space-size=12000 apps/kirkwood/data/prep.ts [--check] [--sizes]   # data/elements.bin and data/rows.bin from the fetch, and data/MANIFEST.json; --check builds again and fails unless the bytes are the manifest's (a refresh, or a change to prep, is a new manifest: commit it with the change)
node apps/kirkwood/data/places.ts [--date 2026-06-09] [--only bodies,jupiter,trojans,hildas]   # the built files' places against JPL Horizons' (data/horizons.json; horizons.ts fetches it), and the Trojans and Hildas against Jupiter
npm install --prefix apps/kirkwood/spike                 # its own deps (Three.js, DuckDB's Node client for data.ts and sizing.ts; the page uses no DuckDB)
node apps/kirkwood/spike/data.ts <asteroids.parquet> [<gaia-dr3-bright.parquet>] [--cut 10.5]   # public/ (gitignored), for `?sample` and `?rows`: elements.bin (each row's a, e, i from Tycho's sample), h.bin (its H), rows.bin (its other 15 columns, a column at a time, and rows.json, its layout), and with the Gaia sample, stars.bin (its stars brighter than the cut)
node apps/kirkwood/spike/sizing.ts <asteroids.parquet> [--only wire,duckdb]   # the rows file raw, gzip 9, and brotli 11, by section (and public/rows.bin.gz, which `?rows=gz` fetches); native DuckDB on a page of every row, of a group's rows, and of a sort, from the file and from a table in memory (out/sizing-*.json)
node apps/kirkwood/spike/run.ts [flags]                  # builds the wasm and the page, then: the scene through GPUI's canvas (screenshots in out/), input routing, frame times with both canvases drawing, the build's bytes, the three moves (the sort flight, a drawn group's fly-in with the table arriving, the live column), and frame times during each; `rows`, the rows in memory against the elements alone: the table's first rows, the wasm's memory, a sort, reference and throttled; `seen`, the belt from straight above at the epoch, time held, with the lines from the Sun toward Jupiter and the points 60° either side of it and opposite: all of it, the Trojans' orbit sizes alone in color, and the Hildas' (--only shots,input,frames,bytes,moves,moveframes,rows,seen; --browser firefox|webkit; --params scale=0.5; --segments; --profiles reference,throttled; --runs; --no-build; `rows` needs sizing.ts's rows.bin.gz)
node apps/kirkwood/spike/run.ts --serve                  # builds, then serves the page to look at (?arrive=after, ?slide=<ms>, ?live=<refreshes a second>, ?decimals=<n>, ?scale=<0..1>; ?rows or ?rows=gz for the table over the sample's own columns, ?open for the panel in from the load; ?look for the look, below; ?date=YYYY-MM-DD for where the clock starts and ?paused to hold it there; ?band=<au>,<au> for the orbit sizes that keep their color, with ?bandDim and ?bandGain; ?marks for the lines from the Sun toward Jupiter and its 60° points; ?sample for the sample's a, e, and i with seeded angles, as the spike first was)
node apps/kirkwood/spike/lookdev.ts [flags]              # the look (needs public/stars.bin): the scene as it was and with the look from three cameras (out/look-*.png, and out/look.html beside any out/ref-*.png), each part's frame cost, first paint (--only shots,cost,paint; --cameras opening,top,group; --sides before,after; --tag; --params tone=agx; --configs; --runs; --no-build)
```

The look's knobs, on the page's query: `?look` turns all of it on with its opening camera; each part alone is `?hdr`, `?mag`, `?bloom`, `?haze`, `?floor`, `?sun` (`=0` turns one off under `?look`), and `?stars=<G cut>`. The camera: `?az`, `?elev`, `?roll`, `?dist`. Tuning: `?tone=neutral|agx|aces|none`, `?exposure`, `?alpha`, `?hazeGain`, `?bloomGain`, `?bloomScale`, `?starGain`, `?grain`, and the rest in `spike/src/look.ts`, `stars.ts`, and `scene.ts`. With none of them the scene draws as it did before the look (`docs/DECISIONS.md`, "Look").

## App gotchas

- **A file's address holds from `file_begin` to `file_end`, and a view over it doesn't:** the page makes a new `Uint8Array` over the wasm's memory for each piece of the response, since the memory growing detaches the last one.
- **The page's `fetch` for a file starts in `__kirkwood.firstFrame`,** which the crate calls after the first frame is presented. Never preload a file or start one earlier: `just kirkwood see` fails on any request before the mark but the page's own.
- **A published target is placed from its parent's corner** (`host.rs`'s `target`: `top_0`, `left_0`): an absolute child left at its static place starts inside the parent's padding, and its bounds come out shifted.
- **A script reads the table's layout once the panel has stopped sliding** (350 ms): the layout probe is the cells' place in the frame it was drawn.
- **The data's URL is under the app's base** (`import.meta.env.BASE_URL` in `main.ts`, the same base in `vite.config.ts`'s plugin): never write `/data/…` from the origin's root, which on the shared hostname is Tycho's.
- **The table has the keys from the moment its panel opens** (the host focuses it); a press elsewhere takes them away, as in any GPUI view.
- **The window is filled with the page's own color** (`web.rs`'s `PAGE`, `index.html`'s background) until the scene's canvas is under it; the spike's transparent canvas (below) is what replaces it.

## Spike gotchas

- **GPUI's canvas is transparent only because of two things on the host's side:** `spike/src/alpha.ts` (the WebGPU context's alpha mode, set before the wasm starts) and the theme's `tokens.background` set transparent after `Theme::change`. `?opaque` turns the first off; in a browser on WebGL2 (headless Firefox) it changes nothing, so `run.ts`'s control fails there. Why: `docs/DECISIONS.md`, "Table".
- **An element over the scene must `occlude()`,** or a press on it also starts a shape on the surface under it (`docs/DECISIONS.md`, "Input").
- **The clock counts years from the elements' epoch** (2026-06-09), a year being one turn of a 1 au orbit (365.2569 days), so a row's mean anomaly needs no offset and its period is a^1.5; the date shown is the epoch plus those days.
- **The clock is moved by whoever reads it** (`advance_clock`: the scene each frame it draws, the date and the live column at their own rates), never by the scene's frames alone: landed in a against e the scene draws nothing, and time still runs (`docs/DECISIONS.md`, "Scene").
- **The scene never calls into GPUI from a call Rust made.** Rust calls the scene inside a GPUI update (the pick's camera, the group's bytes, the outline, the fly-in), so what the scene reads back there are plain cells (`scene_years`, `scene_flight`, `scene_inset`); `fly_done`, which updates the host, is called only from the scene's own frame.
- **What Rust hands the scene is a view over the wasm's memory:** copied or uploaded before the call returns (`setPicked`, `setOutline`, `setElements`), since the memory growing detaches it.
- **H alone is the wrong brightness:** it's a body's brightness at 1 au, so the far, large bodies outshine the belt. The look divides by the squares of the distance from the Sun and from the eye (`docs/DECISIONS.md`, "Look").
- **The look's haze is taken before the bodies are drawn** (the Sun, Jupiter, the lines), so only rows and stars glow; keep that order.
- **A dot's size and opacity follow the camera's nearness** (`docs/DECISIONS.md`, "Look"); change one without the other and a flown-to group fades out or burns white.
