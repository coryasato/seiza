# Kirkwood

Kirkwood is a showcase: the asteroid belt as a scene to fly through, drawn from the asteroid table's own rows, with the table of those rows beside it, each moving the other. Named for Daniel Kirkwood, who found the gaps in the belt in a catalog of orbits, not through a telescope.

**The app isn't built yet.** This directory holds its plan, its decisions, and a throwaway spike (`spike/`: a Three.js scene under a transparent GPUI canvas with the tall table), which is never deployed and whose code isn't carried forward. It has decided the stack (below) and stays, as the viewer of the orbits' data, until the app's own scene draws the belt (`docs/DECISIONS.md`, "Planning").

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

Decided by the spike (`docs/DECISIONS.md`, "Stack", which points to each part's own decision). Nothing of it is built as an app yet.

- **The scene:** Three.js on a canvas of its own, under GPUI's, loaded after GPUI's first frame. A deliberate exception to "logic in Rust, JS thin" (root `docs/DECISIONS.md`, "Repo structure", the showcase tier). It draws only when the clock, the camera, or the window changed, at a resolution of its own, and every orbit is solved in its vertex shader. The sky's stars are its own (JS): they aren't rows.
- **The engine:** Rust owns the orbital elements and their buffers (the scene's vertex buffer is a view over them), the clock, the sort flight's progress, and the selection (a set of row indices, picked through the scene's camera). The scene asks Rust each frame it draws; Rust calls the scene to move its camera or hand it a group.
- **The interface:** GPUI through `shared/` (crate `seiza`), its canvas over the scene's and transparent wherever it drew nothing, with `components/tall-table/` in a panel on the right behind a handle. GPUI's hit test decides which canvas an input is for.
- **The rows:** held in Rust, as the bytes of one file read in place; the table's delegate answers every page from them, and a filter to a group is the group's indices. No DuckDB, and no `engines/duckdb/`.

## Layout

```
apps/kirkwood/
  data/             # fetch.ts (the asteroid catalog from JPL, every column at full precision, into raw/), survey.ts (what the fetch holds, and Tycho's sample against it), catalog.ts (the fetch as its readers take it: the rows in the files' order, every row at the one epoch, a designation packed, a place from six elements), prep.ts (the two files the app holds, elements.bin and rows.bin, and MANIFEST.json, which pins them), precision.ts (the elements' precision weighed: error against bytes); raw/ and the two files are gitignored, the manifest committed; plain Node, no dependencies
  docs/             # DECISIONS.md, LESSONS.md, milestones.md, data.md (the fetch: source, fields, frame; the two files: layout, how to read them, sizes); spike/ (the spike's screenshots)
  spike/            # throwaway: crate/ (`kirkwood-spike`: the elements, the clock, the sort flight's progress, the scene's input surface, a drawn group's pick, the panel and its table with its filter and live column, the sample's other columns held as their file's bytes), src/ (main.ts; alpha.ts, GPUI's canvas composited by its alpha; scene.ts, the belt in Three.js: the flight between space and a against e, the group's colors and outline, the camera's fly-in; look.ts, the look's knobs and its pipeline: the half-float buffer, haze, bloom, tone mapping, the floor; stars.ts, the Gaia sky; colors.ts, the color mappings), data.ts (the elements, H, and the rows file from the asteroid sample, the bright stars from the Gaia sample), sizing.ts (the rows file on the wire, and native DuckDB on the same reads), run.ts (screenshots, input checks, the moves' checks, frame times, bytes, the rows in memory), lookdev.ts (the look: before and after from three cameras, each part's frame cost, first paint); not an npm workspace
  README.md         # for visitors
  CLAUDE.md         # this file
  PLAN.md           # what's next
```

No `perf/`: a showcase has no budgets and no results. `crate/`, `web/`, and a `just` module arrive with the first milestone that builds the app.

## Commands

The data's and the spike's (no `just` module until there's an app), from the repo root. The data's are in `docs/data.md`:

```
node apps/kirkwood/data/fetch.ts [--refresh]             # the asteroid catalog from JPL into data/raw/asteroids/ (~3 min, once; a rerun reuses it, and the fetch date is part of the dataset, so don't refresh without a reason)
node --max-old-space-size=12000 apps/kirkwood/data/prep.ts [--check] [--sizes]   # data/elements.bin and data/rows.bin from the fetch, and data/MANIFEST.json; --check builds again and fails unless the bytes are the manifest's (a refresh, or a change to prep, is a new manifest: commit it with the change)
npm install --prefix apps/kirkwood/spike                 # its own deps (Three.js, DuckDB's Node client for data.ts and sizing.ts; the page uses no DuckDB)
node apps/kirkwood/spike/data.ts <asteroids.parquet> [<gaia-dr3-bright.parquet>] [--cut 10.5]   # public/ (gitignored): elements.bin (each row's a, e, i from Tycho's sample), h.bin (its H), rows.bin (its other 15 columns, a column at a time, and rows.json, its layout), and with the Gaia sample, stars.bin (its stars brighter than the cut)
node apps/kirkwood/spike/sizing.ts <asteroids.parquet> [--only wire,duckdb]   # the rows file raw, gzip 9, and brotli 11, by section (and public/rows.bin.gz, which `?rows=gz` fetches); native DuckDB on a page of every row, of a group's rows, and of a sort, from the file and from a table in memory (out/sizing-*.json)
node apps/kirkwood/spike/run.ts [flags]                  # builds the wasm and the page, then: the scene through GPUI's canvas (screenshots in out/), input routing, frame times with both canvases drawing, the build's bytes, the three moves (the sort flight, a drawn group's fly-in with the table arriving, the live column), and frame times during each; `rows`, the rows in memory against the elements alone: the table's first rows, the wasm's memory, a sort, reference and throttled (--only shots,input,frames,bytes,moves,moveframes,rows; --browser firefox|webkit; --params scale=0.5; --segments; --profiles reference,throttled; --runs; --no-build; `rows` needs sizing.ts's rows.bin.gz)
node apps/kirkwood/spike/run.ts --serve                  # builds, then serves the page to look at (?arrive=after, ?slide=<ms>, ?live=<refreshes a second>, ?decimals=<n>, ?scale=<0..1>; ?rows or ?rows=gz for the table over the sample's own columns, ?open for the panel in from the load; ?look for the look, below)
node apps/kirkwood/spike/lookdev.ts [flags]              # the look (needs h.bin and stars.bin): the scene as it was and with the look from three cameras (out/look-*.png, and out/look.html beside any out/ref-*.png), each part's frame cost, first paint (--only shots,cost,paint; --cameras opening,top,group; --sides before,after; --tag; --params tone=agx; --configs; --runs; --no-build)
```

The look's knobs, on the page's query: `?look` turns all of it on with its opening camera; each part alone is `?hdr`, `?mag`, `?bloom`, `?haze`, `?floor`, `?sun` (`=0` turns one off under `?look`), and `?stars=<G cut>`. The camera: `?az`, `?elev`, `?roll`, `?dist`. Tuning: `?tone=neutral|agx|aces|none`, `?exposure`, `?alpha`, `?hazeGain`, `?bloomGain`, `?bloomScale`, `?starGain`, `?grain`, and the rest in `spike/src/look.ts`, `stars.ts`, and `scene.ts`. With none of them the scene draws as it did before the look (`docs/DECISIONS.md`, "Look").

## Spike gotchas

- **GPUI's canvas is transparent only because of two things on the host's side:** `spike/src/alpha.ts` (the WebGPU context's alpha mode, set before the wasm starts) and the theme's `tokens.background` set transparent after `Theme::change`. `?opaque` turns the first off; in a browser on WebGL2 (headless Firefox) it changes nothing, so `run.ts`'s control fails there. Why: `docs/DECISIONS.md`, "Table".
- **An element over the scene must `occlude()`,** or a press on it also starts a shape on the surface under it (`docs/DECISIONS.md`, "Input").
- **The clock is moved by whoever reads it** (`advance_clock`: the scene each frame it draws, the date and the live column at their own rates), never by the scene's frames alone: landed in a against e the scene draws nothing, and time still runs (`docs/DECISIONS.md`, "Scene").
- **The scene never calls into GPUI from a call Rust made.** Rust calls the scene inside a GPUI update (the pick's camera, the group's bytes, the outline, the fly-in), so what the scene reads back there are plain cells (`scene_years`, `scene_flight`, `scene_inset`); `fly_done`, which updates the host, is called only from the scene's own frame.
- **What Rust hands the scene is a view over the wasm's memory:** copied or uploaded before the call returns (`setPicked`, `setOutline`, `setElements`), since the memory growing detaches it.
- **H alone is the wrong brightness:** it's a body's brightness at 1 au, so the far, large bodies outshine the belt. The look divides by the squares of the distance from the Sun and from the eye (`docs/DECISIONS.md`, "Look").
- **The look's haze is taken before the bodies are drawn** (the Sun, Jupiter, the lines), so only rows and stars glow; keep that order.
- **A dot's size and opacity follow the camera's nearness** (`docs/DECISIONS.md`, "Look"); change one without the other and a flown-to group fades out or burns white.
