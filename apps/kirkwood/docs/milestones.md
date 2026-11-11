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
