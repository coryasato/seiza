# Kirkwood

Kirkwood is a showcase: the asteroid belt as a scene to fly through, drawn from the asteroid table's own rows, with the table of those rows beside it, each moving the other. Named for Daniel Kirkwood, who found the gaps in the belt in a catalog of orbits, not through a telescope.

GPUI paints first (the title, the time control, the actions, the table's handle); then the scene's module and the two files arrive, and the belt fills in as its rows do. What a visitor can do with it (the clock, the sort into a against e, the ride with Jupiter, a gap picked, the camera and its corner, a row found, a group drawn, a dot clicked, the live columns) is `README.md`'s. A throwaway spike decided the stack; it's deleted and none of its code carried forward (`docs/spike/`; `docs/DECISIONS.md`, "Planning" and "Stack").

---

This is Kirkwood's context. What's next is in `PLAN.md`; why things are built this way, in `docs/DECISIONS.md`; finished milestones, in `docs/milestones.md`; the rows' source, in `docs/data.md`; the page's query flags and knobs, in `docs/query.md`; the research behind it, in the root's `docs/research/asteroid-belt.md` (the root `CLAUDE.md`, "Docs: one home per fact", says what goes where). The repo-wide rules in the root `CLAUDE.md` apply here except where "Tiers" exempts a showcase. Paths below are relative to `apps/kirkwood/`.

Current state only: say what to do and point to the decision behind it (`docs/DECISIONS.md`, "<area>"); don't retell its reasons.

## Kirkwood rules

These replace the measuring rules a showcase is exempt from (root `CLAUDE.md`, "Tiers": no budgets, no results notes, no measurement protocol) and add to the rest.

1. **Every dot is a row.** Nothing is drawn as an asteroid that isn't a row of the table, and a count on screen is counted from the rows. What the scene adds that isn't a row (the Sun, Jupiter, an orbit line, a marker) is plainly not a dot.
2. **Paint first, load the scene after.** Nobody watches a blank page while the data arrives (root rule 2).
3. **Say what's exaggerated or invented, on screen.** Dot sizes are exaggerated and the page says so; a marker asteroid is called a marker; a close-up body with no shape on file is labeled as illustration. No dense rock field: the belt is empty at true scale (the research, "What's honest to simulate").
4. **Color is data.** A dot's color is its orbit size; a dot without color (gray) isn't in the picked group; white is for what the interface adds (a drawn shape's outline, a marker and its path). Don't spend a hue on decoration (`docs/DECISIONS.md`, "Look").
5. **For a person to read.** Nothing on screen changes faster than someone can follow: a live cell refreshes at a rate chosen by looking at it, not as fast as the clock runs.
6. **No tour on load.** A visitor opts in through one-press actions, taken in any order or not at all.
7. **Handle the canvas tradeoffs in the open** (root rule 4), in `README.md`'s "Canvas tradeoffs".

## The two canvases

GPUI, through `shared/` (crate `seiza`), draws the interface on a canvas over the scene's, transparent wherever it drew nothing, with `components/tall-table/` in a panel on the right behind a handle. GPUI's hit test decides which canvas an input is for. The scene is Three.js on its own canvas, under GPUI's (`web/CLAUDE.md`); the rows, the clock, and everything the scene asks each frame are the crate's (`crate/CLAUDE.md`).

## Where the detail is

Each folder's architecture, gotchas, and commands are in its own `CLAUDE.md`, which Claude Code loads when a file in that folder is read. Read the folder's file before changing anything in it, and put a new fact in the file of the folder it's about: a fact stated in two of them drifts. A gotcha that spans the crate and the scene lives where the change that it guards is made.

| Folder | What it is | Its file |
|---|---|---|
| `crate/` | The engine and the interface (`host.rs`), and what passes to and from the scene | `crate/CLAUDE.md` |
| `web/` | The host and the scene: the files' arrival, Three.js, the camera, the look, the sky | `web/CLAUDE.md` |
| `checks/` | `see.ts`, what the release build shows, and the gotchas of writing a check | `checks/CLAUDE.md` |
| `data/` | The fetch, the three files and their manifest, the places against Horizons | `data/CLAUDE.md` |
| `worker/` | The Worker under `/kirkwood/` on Tycho's hostname, its bucket, and the build behind it locally | `worker/CLAUDE.md` |

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
  worker/           # the Cloudflare Worker, its staging and local-dev scripts, its tests (worker/CLAUDE.md)
  docs/             # DECISIONS.md, LESSONS.md, milestones.md, data.md (the fetch and the files), query.md (the page's query); spike/ (the spike's screenshots), seen/ (the app's, cited by the plan's checks)
  README.md         # for visitors
  CLAUDE.md         # this file
  PLAN.md           # what's next
  justfile          # loaded from the root as the `kirkwood` module
```

No `perf/`: a showcase has no budgets and no results. What its checks ask to be seen comes from `checks/see.ts` (`docs/DECISIONS.md`, "Planning").

## Commands

From the repo root. One line each; a recipe's flags and what a check covers are in its folder's `CLAUDE.md` (in brackets) and in the justfile's comment above it.

```
just kirkwood dev | build | preview   # debug dev server, release build, serve that build, each at /kirkwood/ (web)
just kirkwood worker                  # that build behind the Worker under `wrangler dev` (worker)
just kirkwood deploy | deployed       # deploy to tycho.seiza.io/kirkwood and check it; the check alone (worker)
just kirkwood test                    # native tests, the real files' among them (crate), then the Worker's (worker)
just kirkwood see [flags]             # what the release build shows, in headless Chromium; run `build` first (checks)
just kirkwood lint     # check-terms, fmt, clippy (wasm32 and native), tsc (the host, the checks, the data's scripts, the Worker)
node apps/kirkwood/data/<script>.ts   # fetch, prep, stars, places (data; every command in docs/data.md)
```
