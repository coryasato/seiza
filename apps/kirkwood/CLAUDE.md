# Kirkwood

Kirkwood is a showcase: the asteroid belt as a scene to fly through, drawn from the asteroid table's own rows, with the table of those rows beside it, each moving the other. Named for Daniel Kirkwood, who found the gaps in the belt in a catalog of orbits, not through a telescope.

**The app draws the belt, with its look.** `crate/` and `web/` are the app: GPUI's first frame (the title, the time control, the action beside it, the table's handle), then the scene's module and the two files, each file written into the wasm's memory as it arrives; the elements come in blocks of rows, so the belt fills in as it arrives, the page counting the dots so far and time waiting for the last; the scene draws every row with an ellipse on its own orbit from the elements where they lie, its color its orbit size and its brightness from its H, through the look's passes, with the Sun, Jupiter on its orbit, and their names, and behind them the sky's stars, fetched last; the title's lines say what's counted, what's exaggerated, and whose the stars are, over the legend; the clock runs a year a second from 1976 to 2076; "Sort by orbit size" flies every dot from space into a against e, where the gaps open, and back, with what isn't a row leaving the picture on the way, the axes drawn under the dots as they land (a chip over each gap, the Hildas' and Trojans' names, and the count of rows in view); "Ride with Jupiter" flies the camera to straight above and turns the frame with Jupiter, which holds still to the Sun's right, with the Hildas and the Trojans lit, their names, and a dashed triangle through the three points in step with Jupiter; those two groups are moved for real, integrated under the Sun and Jupiter, so they keep their shapes across the clock's reach; a gap's chip on the landed layout is a button, and a press rides with Jupiter with a marker at that gap (white, in a ring, not a row), its path in the turning frame a closed white line, the belt dimmed under it, and a card under the title with the four gaps as chips, why the orbit empties, and three numbers from Jupiter's own orbit; the camera is a map's, a hand's to move in space (a drag pans along the ecliptic, a wheel zooms toward the pointer, a drag let go moving glides to rest, a drag with Shift held tilts and turns, and a double click zooms in; riding with Jupiter the hand has a camera of the ride's own, in the frame that turns), with a corner of its own, bottom right: a compass that shows its turn and tilt and flies it home when pressed, a hint of the controls that folds to a `?` button after the camera's first move, and behind the button the controls' list; the arrows pan, + and − zoom, H goes home, and `?` opens the list, while the table's panel is shut; the table is over every row in a panel behind the handle; and a row of it is found in the scene: its rows are selectable, and the selected row is marked on its dot (a white ring and the row's name) and flown to, the camera then following it as time runs, with "Find Ceres", the third action, the same for the first row; and a group is drawn in the scene: "Draw a group", the fourth action, is the lasso's mode, where time pauses and a drag draws a freehand shape in white, and its release closes it around every row whose dot lies under it: those dots keep their color and the rest go gray, a chip at the shape counts them, and the table is the group's rows, which a press on a number column's arrow sorts, until the action is pressed back or "Show all rows" in the panel is; the camera flies in until the group fills what the panel leaves, the panel coming in with its rows and a line of them by class, the group's four biggest bodies named on their dots, and "The whole belt" under the title (as "Show all rows") the way back, the camera flying to where it was; and a click on one dot makes the table that one row, found and flown to, every other dot gray; and two of the table's columns are live, a row's distance from the Sun and from Jupiter on the clock's date, worked out again twice a second, to one decimal while time runs and three once it holds still; a press on the diameter's arrow makes the table's top rows the biggest bodies, each press on one a flight. A throwaway spike decided the stack (below); it's deleted, none of its code carried forward, and its screenshots are the record (`docs/spike/`; `docs/DECISIONS.md`, "Planning").

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

Decided by a spike, since deleted (`docs/DECISIONS.md`, "Stack", which points to each part's own decision). Built so far: the rows, the clock, the interface, the scene with its look, its color, and its sky, the sort flight, the frame that turns with Jupiter, the integration of the Hildas and the Trojans, a gap picked, a row found, a group drawn and flown in to, a dot clicked, and the live columns.

- **The interface:** GPUI through `shared/` (crate `seiza`), its canvas over the scene's and transparent wherever it drew nothing, with `components/tall-table/` in a panel on the right behind a handle. GPUI's hit test decides which canvas an input is for.

The scene is in `web/CLAUDE.md`; the engine and the rows, in `crate/CLAUDE.md`.

## Where the detail is

Each folder's architecture, gotchas, and commands are in its own `CLAUDE.md`, which Claude Code loads when a file in that folder is read. Read the folder's file before changing anything in it, and put a new fact in the file of the folder it's about: a fact stated in two of them drifts. A gotcha that spans the crate and the scene lives where the change that it guards is made.

| Folder | What it is | Its file |
|---|---|---|
| `crate/` | The engine and the interface: the rows, the clock, the flight, the ride, the integration, a gap, a find, a group, the table, the live columns, `host.rs`, and what passes to and from the scene | `crate/CLAUDE.md` |
| `web/` | The host and the scene: the files' arrival, Three.js, the camera, the look, the sky, the query knobs | `web/CLAUDE.md` |
| `checks/` | `see.ts`, what the release build shows, and the gotchas of writing a check | `checks/CLAUDE.md` |
| `data/` | The fetch, the three files and their manifest, the places against Horizons | `data/CLAUDE.md` |

## When something outside a folder changes it

Rules whose cause is elsewhere, so no folder's file would be read in time:

- **The elements file's layout is in two places that must agree:** `crate/src/elements.rs` and `data/elements.ts`. A change to either is a new magic, a new manifest, and `just kirkwood test`.
- **A gpui-kit bump** can break GPUI's transparent canvas and its grayscale text (`crate/CLAUDE.md`, "GPUI's canvas is transparent"): run `just kirkwood see --only belt` and look at `checks/out/belt.jpg`, and look at the title and the axes' numbers in a real browser.

## Layout

```
apps/kirkwood/
  crate/            # `kirkwood` (cdylib): the engine and the interface (crate/CLAUDE.md)
  web/              # the Vite host and the scene (web/CLAUDE.md)
  checks/           # see.ts; out/ gitignored (checks/CLAUDE.md)
  data/             # the data's scripts, MANIFEST.json, fixture.json, horizons.json (data/CLAUDE.md)
  docs/             # DECISIONS.md, LESSONS.md, milestones.md, data.md (the fetch: source, fields, frame; the two files: layout, how to read them, sizes; the fixture; Jupiter's orbit; the check against Horizons); spike/ (the spike's screenshots), seen/ (the app's, cited by the plan's checks)
  README.md         # for visitors
  CLAUDE.md         # this file
  PLAN.md           # what's next
  justfile          # loaded from the root as the `kirkwood` module
```

No `perf/`: a showcase has no budgets and no results. What its checks ask to be seen comes from `checks/see.ts` (`docs/DECISIONS.md`, "Planning").

## Commands

From the repo root. One line each; a recipe's flags and what a check covers are in its folder's `CLAUDE.md` (in brackets) and in the justfile's comment above it.

```
just kirkwood dev | build | preview   # debug dev server, release build, serve that build (web)
just kirkwood test                    # native tests, the real files' among them (crate)
just kirkwood see [flags]             # what the release build shows, in headless Chromium; run `build` first (checks)
just kirkwood lint     # check-terms, fmt, clippy (wasm32 and native), tsc (the host, the checks, the data's scripts)
node apps/kirkwood/data/<script>.ts   # fetch, prep, stars, places (data)
```