# kirkwood

A GPUI density plot (named for Daniel Kirkwood, who found the gaps in the asteroid belt that it shows): two numeric columns as a grid of counts, drawn as one image, with zoom, pan, a click, and (as a feature) a box. A component (root `CLAUDE.md`, "Tiers"), crate `seiza-kirkwood`. **Planned, not built:** this directory holds its docs only.

---

This is the plot's context. Why it's built this way is in `docs/DECISIONS.md`; what it offers its users, in `README.md`. Its work is a milestone in its own `PLAN.md` (the one list of its features). Each feature's own cost (added wasm, frame work) is measured in a bare host and recorded in `perf/results/`; budgets are the apps' that build it (Tycho). The repo-wide rules in the root `CLAUDE.md` apply here too. Paths below are relative to this directory.

Current state only: say what to do and point to the decision behind it (`docs/DECISIONS.md`); don't retell its measurements.

## Rules

These add to the repo-wide rules. They were decided before the build (`docs/DECISIONS.md`, "Drawing" and "Component API"); the build keeps this list current.

1. **No app knowledge and no `seiza` dependency,** and no engine or table either: the crate depends on `gpui-kit`, and on `image` for its buffer type alone (no codecs). Report what happened through events; the host turns them into panel rows, marks, and a table's jump or filter.
2. **A frame never waits on bins.** The held image is painted where its extent falls in the view; nothing in render awaits the delegate.
3. **The grid is one image.** Never a quad or an element per bin.
4. **Bins are read when the view rests, one read in flight.** A source's read can take a second of its engine's one thread, and can't be stopped once started.
5. **A replaced image is released** (`Window::drop_image`): the atlas keeps a tile until its image is dropped.
6. **Events that mark a frame are emitted in render,** as the tall table's are (its `CLAUDE.md`, rule 4).

## Architecture

None yet. The shape to build (a state entity, a view, a delegate that answers bins) is `PLAN.md`'s first milestone.

## Layout

```
components/kirkwood/
  docs/             # DECISIONS.md, LESSONS.md, milestones.md
  README.md         # for the crate's user
  CLAUDE.md         # this file
  PLAN.md           # its milestones and features to come
```
