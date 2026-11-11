# Kirkwood

Kirkwood is a showcase: the asteroid belt as a scene to fly through, drawn from the asteroid table's own rows, with the table of those rows beside it, each moving the other. Named for Daniel Kirkwood, who found the gaps in the belt in a catalog of orbits, not through a telescope.

**The app isn't built yet.** This directory holds its plan, its decisions, and a throwaway spike (`spike/`: a Three.js scene under a transparent GPUI canvas with the tall table), which is never deployed and whose code isn't carried forward (`PLAN.md`, the active milestone).

---

This is Kirkwood's context. What's next is in `PLAN.md`; why things are built this way, in `docs/DECISIONS.md`; finished milestones, in `docs/milestones.md`; the research behind it, in the root's `docs/research/asteroid-belt.md` (the root `CLAUDE.md`, "Docs: one home per fact", says what goes where). The repo-wide rules in the root `CLAUDE.md` apply here except where "Tiers" exempts a showcase. Paths below are relative to `apps/kirkwood/`.

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

Leaning, not decided; the spike decides (`PLAN.md`), and this section is rewritten when it closes.

- **The scene:** Three.js on a canvas of its own. A deliberate exception to "logic in Rust, JS thin" (root `docs/DECISIONS.md`, "Repo structure", the showcase tier).
- **The engine:** Rust owns the orbital elements and their buffers, the clock and reference frame, the selection, and the link to the table.
- **The interface:** GPUI through `shared/` (crate `seiza`), with `components/tall-table/` as its center.
- **The rows:** probably held in memory; DuckDB only if the spike says so.

## Layout

```
apps/kirkwood/
  docs/             # DECISIONS.md, LESSONS.md, milestones.md; spike/ (the spike's screenshots)
  spike/            # throwaway: crate/ (`kirkwood-spike`: the elements, the clock, the scene's input surface, the panel and its table), src/ (main.ts; alpha.ts, GPUI's canvas composited by its alpha; scene.ts, the belt in Three.js), data.ts (the elements file from the asteroid sample), run.ts (screenshots, input checks, frame times, bytes); not an npm workspace
  README.md         # for visitors
  CLAUDE.md         # this file
  PLAN.md           # what's next
```

No `perf/`: a showcase has no budgets and no results. `crate/`, `web/`, and a `just` module arrive with the first milestone that builds the app.

## Commands

The spike's only (no `just` module until there's an app), from the repo root:

```
npm install --prefix apps/kirkwood/spike                 # its own deps (Three.js, DuckDB's Node client)
node apps/kirkwood/spike/data.ts <asteroids.parquet>     # public/elements.bin (gitignored): each row's a, e, i from Tycho's sample
node apps/kirkwood/spike/run.ts [flags]                  # builds the wasm and the page, then: the scene through GPUI's canvas (screenshots in out/), input routing, frame times with both canvases drawing, the build's bytes (--only shots,input,frames,bytes; --browser firefox|webkit; --params scale=0.5; --segments; --runs; --no-build)
```

## Spike gotchas

- **GPUI's canvas is transparent only because of two things on the host's side:** `spike/src/alpha.ts` (the WebGPU context's alpha mode, set before the wasm starts) and the theme's `tokens.background` set transparent after `Theme::change`. `?opaque` turns the first off; in a browser on WebGL2 (headless Firefox) it changes nothing, so `run.ts`'s control fails there. Why: `docs/DECISIONS.md`, "Table".
- **An element over the scene must `occlude()`,** or a press on it also starts a shape on the surface under it (`docs/DECISIONS.md`, "Input").
