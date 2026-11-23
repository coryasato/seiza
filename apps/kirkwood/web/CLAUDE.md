# The host and the scene (`web/`)

The Vite host on `shared-web/` and the scene it loads after the first frame: Three.js, its camera, its look, and its sky. Claude Code loads this file when a file under `web/` is read. Kirkwood's rules and the map of its folders are in `apps/kirkwood/CLAUDE.md`, the repo's in the root `CLAUDE.md`; both apply here. Paths are relative to `apps/kirkwood/`.

## Architecture

- **The scene:** Three.js on a canvas of its own, under GPUI's, loaded after GPUI's first frame: a deliberate exception to "logic in Rust, JS thin" (root `docs/DECISIONS.md`, "Repo structure", the showcase tier). This canvas hears no input: the interface hands it each wheel, drag, and key (`docs/DECISIONS.md`, "Input"), and the page a second finger (`touch.ts`), and its camera is a map's (what it looks at on the ecliptic, its distance, its tilt, its bearing), moved through `camera.ts`. It draws only when the clock, the sort flight, the camera, the panel's width, or the window changed, at a resolution of its own.
- **Every orbit is solved in the vertex shader,** as is each dot's flight to a against e; the crate's tests run that arithmetic in 32-bit floats against its own 64-bit place for every row (`crate/src/shader.rs`: change the shader's `PLACE` or `FLIGHT` and it together). The ride with Jupiter is the camera's alone: one angle, Jupiter's longitude, no buffer rewritten.
- **Names are the page's text,** between the two canvases, placed by the scene in the frame that draws them: the Sun's and Jupiter's, the ride's names and dashed triangle, a picked gap's marker, its name, and its path (an SVG line: 1.5 CSS px isn't WebGL's to draw).
- **The look:** the scene draws in linear light into a half-float buffer and reaches the canvas through the look's passes (`look.ts`: the haze, the bodies, the bloom, then one pass that quiets the picture under the page's text, tone maps, and adds the floor). The sky's stars are the page's own (`sky.ts`, from `data/stars.bin`): they aren't rows. Why: `docs/DECISIONS.md`, "Scene" and "Look".
- **The page's query knobs** (`knobs.ts`), for the checks and for looking, are listed in `docs/query.md`. A new knob gets its line there.

## Gotchas

### Loading, and the wasm's memory

- **The page's `fetch` for a file, and its import of the scene's module, start in `__kirkwood.firstFrame`,** which the crate calls after the first frame is presented. Never preload either or start one earlier: `just kirkwood see` fails on any request before the mark but the page's own.
- **A file's address holds from `file_begin` to `file_end`, and a view over it doesn't:** the page makes a new `Uint8Array` over the wasm's memory for each piece of the response, since the memory growing detaches the last one.
- **What the scene is handed is views over the wasm's memory, good until that memory next grows.** `addRows` asks the crate everything its frame needs first, then makes the views (the blocks' addresses before the first view) and writes them into its buffers with no call into the wasm between; the scene never reads them again. Keep that order. **The integrated places' address holds the same way:** `scene_integrated` is asked with the frame's other questions, and the view is made in `render`, at the upload, with no call between.
- **The belt's buffers are the scene's own GL buffers, not Three.js's** (`GLBufferAttribute`, `scene.ts`'s `setBelt`): one a column, as long as the file's rows, written a block at a time. The belt is one draw, its range as far as the rows are in. A new per-row attribute is one more such buffer.
- **The scene is handed rows at most four times a second while the belt fills** (`main.ts`, `FILL_EVERY_MS`; the first block and the last at once; `docs/DECISIONS.md`, "Scene").
- **A count on the page while the belt fills is of the rows the scene has drawn** (`belt_drawn(rows)`, called after each hand-over), never of the rows that have arrived. The clock is let go by the last hand-over alone, which waits for `file_end`.
- **The scene never calls into GPUI from a call Rust made.** What it reads each frame are plain cells (`scene_years`, `scene_flight`, `scene_space`, `scene_inset`, `scene_scrim_changes`, and when that has moved `scene_scrim`, `jupiter_place`, `scene_plot`); `belt_drawn`, `sky_drawn`, `scene_failed`, and `flight_hold`, which update the host, are called from the page's own tasks.
- **The sky's file is the page's, not the crate's:** fetched whole after the rows file and the belt, never waited on, and a failure is the console's alone. The page's line about the stars shows only once they're drawn (`sky_drawn`).
- **The app's base is `/kirkwood/` in dev, preview, and production** (`src/base.ts`; `docs/DECISIONS.md`, "Hosting"), and the origin's root is Tycho's: every URL the page asks for is under the base (the data's is `import.meta.env.BASE_URL` in `main.ts`; never write `/data/…` or `/assets/…` from the root), and what it keeps on the origin is a key named `kirkwood:`, never a cookie or a service worker. `see --only paint` fails on any of them.
- **Until the scene draws, what shows under the interface is the page's own background** (`index.html`), the color the look's floor tints the scene with (`scene.ts`'s `PAGE`): keep the two the same.
- **A lost WebGL context takes the belt's buffers, which are the scene's own, and the scene gets them back by being handed every row again** (`scene.ts`, the canvas's `webglcontextlost` and `webglcontextrestored`; `main.ts`, `contextRestored`). The belt's room is dropped at the loss, while a delete is nothing (after the return each would be another context's object, and a warning); Three.js makes its own buffers, targets, and programs again by itself. A new GL buffer of the scene's own joins `dropBelt` and is filled again from `addRows` (a held group's bytes are: `gray`). With the context gone `render` draws nothing, `fillBelt` hands nothing over, and the names leave by the layer's opacity.
- **A phone is sent none of the app unasked** (`phone.ts`; `docs/DECISIONS.md`, "Interface"): `main.ts` shows its page in place of `boot`, and the HTML's preloads carry `NOT_PHONE` as their `media` (`vite.config.ts`). Anything new that the page asks for before the first frame goes behind `open()` in `main.ts`, and a new preload gets the media by the plugin. Its pictures are the app's (`public/phone/`, by `see --only stills`): take them again when what one shows changes.

### The ride, the groups, a gap

- **The ride is the camera's and nothing else's** (`scene.ts`, `place`): the fixed frame's camera and the one straight above, turned to Jupiter's longitude, joined by `scene_ride`. Anything drawn through the scene's camera turns with the frame for free; anything placed in the window apart from it (GPUI's furniture) must ask the camera (`viewProjection`).
- **The camera's flight to the ride is between two ends that hold still** (`scene.ts`, `anchor`, `since`): the camera above is taken at Jupiter's longitude in the last frame drawn at rest, and Jupiter's turn since is summed a frame at a time and added on. Never fly toward the camera above as it is now: the shortest way to a moving end changes sides, and the camera jumps.
- **The ride's camera is a map's numbers in the frame that turns** (`scene.ts`, `rideView`, `rideHand`; `stats.riding`): x along Jupiter's line from the Sun, its ground turned back by Jupiter's longitude as placed (`anchor`). It opens as board 2 has it and is forgotten once the camera is back in the fixed frame (`rideOpens`); the fixed frame's is the visitor's, as it was left (`stats.camera`; `stats.distance` is whichever is now). Its distance is `rideZoom` times what the ride opens at, which follows the panel.
- **The two groups are told apart by a and e, in the file's floats, and their bounds are `ride.rs`'s alone** (`ride::bounds`, the shader's `uGroups`; `ride::group`, `Elements::grouped`): never type a bound in `scene.ts`. The crate's test reads the Trojans against every row's class.
- **The Hildas and the Trojans are drawn apart, from places the crate integrates** (`integrate.rs`; `scene.ts`'s `integrate`, `uIntegrated`): the belt's shader turns their rows away. Everything but a dot's place is the belt's shader and uniforms, so a change to how a dot is drawn reaches both.
- **The ride's names and triangle are placed on the crate's three points** (`ride::points`), asked for when the years move while the frame is turned. A name's offset from its point is `scene.ts`'s (`RIDE_NAMES`), and `see.ts` holds a copy.
- **The groups' light and the page's sentence about it come in together,** over the second half of the camera's flight and only in space (`scene.ts`'s `uRide`, `host.rs`'s `shows`): change one with the other.
- **The marker's path is the crate's, in the frame that turns, asked for once a gap** (`gap_path`); the scene turns it by Jupiter's longitude and writes the SVG line only when the camera, the window, the panel, or the gap moved (`scene.ts`, `mark`, `pathFor`). On the camera's way there or back it isn't drawn: it waits for the ride to be at 1 and fades in on its own (`scene.marker()`'s path is empty until then); the marker and its name don't wait. It closes after as many of Jupiter's orbits as the ratio counts (`gap::closes_in`).
- **A path projected by hand breaks where it passes behind the eye** (`scene.ts`, `mark`): a place with no place on screen is a NaN in `pathDrawn`, and the line is drawn in runs. Anything else projected through the camera's matrix needs the same test (`onScreen` has it).

### The camera

- **The camera's numbers are `camera.ts`'s `View`, and `scene.ts`'s `place` is the only reader that makes a camera of them.** A pan and a zoom lean on the ray through a window position meeting the ecliptic where `ground` says through the camera as placed now: change how the camera is placed (the view offset beside the panel, the roll) and both hold, but move the camera anywhere else and they don't.
- **The opening shot is a pose: rolled 34°, and a hand gives the camera no roll** (`scene.ts`, `OPENING`; `docs/DECISIONS.md`, "Input"). A pan, a zoom, and the keys keep it; the first drag with Shift eases it to a level horizon (`camera.ts`, `POSE`, `level`); the way home gives it back, and the compass's needle leans with it. An arrow key goes across the window, not along the rolled plane (`nudge`). The ride's camera has none. A check that wants a level camera says `?roll=0`.
- **`stats.gliding` is true while the camera moves on its own** (the glide, a zoom's way, the arrow keys, the flight home, the roll's ease): a check waits on it.
- **Shift is the key that tilts and turns; Ctrl is a pinch's, on a wheel alone** (`camera.ts`): a drag with Ctrl held pans.
- **One finger is the left button, and two are the page's own** (`touch.ts`; `crate/CLAUDE.md`, "A finger on the surface"): GPUI follows one touch at a time, so the page counts fingers on the window, before the canvas hears them, and hands the scene two that are both left of the panel. From `twoStart` the first finger's pan waits (`twoDown`), and its release is no click (`twoSince`). The gesture is a zoom and a turn, or a tilt, never both: decided by which its first moves are more of (`camera.ts`, `FINGERS`).
- **An arrow key is a glide, a zoom key the double click's tween, and home a flight of the hand's own** (`camera.ts`, `nudge`, `zoomStep`, `home`): any press ends each. The way home, the flight to a found row, and a flight in to a group and back are one flight (`fly`), so a hand takes any of them over the same way.
- **A glide's speed is read from the page clock when the crate hands each move over,** not from the events' own times, which GPUI doesn't pass on: moves bunched after a long frame read as faster than the hand was.
- **Near the horizon a pixel is tens of au:** a pointer holds a point of the ecliptic only within `REACH` camera distances along the plane. Past it a drag holds the point at the reach, and a wheel zooms toward what the camera looks at, as over the sky. What the camera looks at stays within `AT_MOST` of the Sun.
- **The compass is told, never asked:** the scene calls `camera_seen` at the end of a frame it drew, when the camera's turn or tilt moved (by a tenth of a degree while it moves on its own, exactly once it rests) or a hand first moved a camera (`scene.ts`, `tell`). Only from its own frames: a call the crate made (a wheel, a drag) marks the frame to draw and returns. Its needle is the camera's bearing less the one it opened with, so home is up; riding, the ride's own.

### A row found, a group, a click

- **The scene is never called for a find: it asks** (`scene_found`, `scene_finds`, each frame; `found_place` when the row or the clock moved, or the two groups went on or off their integrated places: it answers where the scene draws the dot, never `place_of`; `found_name` when the row did). The camera flies when the count of finds moves, so a row found on the axes, or riding, waits (`scene.ts`, `chase`: `waiting`) until the camera is the fixed frame's at rest. `stats.chase` is a frame behind the crate: a check waits on `stats.finds` too (`see.ts`, `chaseIs`).
- **The flight to a row is the hand's own `fly`, and following begins only where it lands** (`camera.ts`, `fly`'s `landed`; `scene.ts`, `chased`, `follow`): a hand that takes the flight leaves the camera where it is, not following. Following sets what the camera looks at every tick, after the hand's step and before the draw, so a wheel and a drag with Shift go round the row; a pan's first move, an arrow, and the way home end it (`dragMove`, `nudge`, `home`), and the row stays marked.
- **A row is off the ecliptic and the camera looks at a point on it** (`camera.ts`, `aimedAt`): where the line of sight through the row meets the plane. The camera's distance is from that point, not the row (`under` apart): following holds it past `under`, or the row would be behind the eye.
- **The found row's mark is in the names' layer** (`scene.ts`, `found`), so it leaves with space by `leave`'s one number; its name is the last of `scene.labels()`, and a group's chip the one before it.
- **The scene is never called for a group: it asks** (`scene_pick`'s return each frame; when that moved, the shape, the years, the chip's text, and last the bytes' address: `scene.ts`, `regroup`). The bytes' address holds while the group does; let go, the scene's buffer keeps the old bytes while the gray goes out.
- **The outline and the chip are in the names' layer, and the outline is written with no frame drawn** (`scene.ts`, `outline`, from `drawStart`, `drawMove`, `drawEnd`): setting the scene dirty for each point draws every dot again. Round a group the outline is on the ecliptic (each point where its ray met it at the release) and shows only on the years it was drawn on, in the fixed frame, in space.
- **The gray is the belt's shader's and the integrated rows' too** (`uGroup`, the attribute `picked`): the belt's is a byte buffer of the scene's own, the integrated rows' a copy picked out of it by row (`regroup`).
- **A group's flight in is the hand's own `fly`, toward the crate's box** (`group.rs`, `Group::fit`; `scene.ts`, `regroup`, `flown`): through the camera kept at the shape's release (`shape.seen`), to the distance at which the box fills what the panel will leave (`scene_inset_to`, not the inset as it slides), found by halving with the camera placed and put back. Its time is the crate's (`host.rs`, `FLY_IN_MS`, the panel's slide too). **A group's flights run before a found row's in the tick** (`flown`, then `chased`): a row found in the same frame has the camera.
- **A click's row is read off a pass of the scene's own** (`scene.ts`, `click`, `pickVertex`): the belt's buffers and the last frame's uniforms through another material, 13 px square, a row's depth its row. It shares the belt's and the integrated rows' geometries: an attribute or a rule that decides whether a row is drawn (no ellipse, drawn apart) changes there too. `host.rs` asks it at the release and takes it 200 ms later if no press, wheel, or key followed (`clicked`, `CLICK_WAITS`; `scene.rs`, `inputs`). The platform's own double click is two presses under 400 ms apart, so a slow one's second press can come after the pick, and takes it back (`undo_click`). With a drawn group held a click finds a row of the group and nothing else (`pick_row`).

### The look

- **What isn't a row leaves the picture by one number** (`flight::space`, the scene's `leave`): the sky, the Sun, Jupiter, its orbit, the names, the haze, and the page's line about the stars. Anything else the scene adds to space joins `leave`, or it stays over the axes.
- **The haze is off on the axes** (`look.ts`, `setHaze`): it lights the gaps (`docs/DECISIONS.md`, "Look").
- **Every shader writes linear light into the look's buffer; only the look's last pass writes the display's values** (its tone map, then `#include <colorspace_fragment>`). A shader that drew to the canvas itself would need both.
- **The look's haze is taken before the bodies are drawn** (the Sun, Jupiter, the lines), so only rows and stars glow; keep that order (`look.ts`).
- **The Sun, Jupiter, and its orbit's line are drawn in that order by `renderOrder`:** all three are transparent, which Three.js sorts far to near, so without it the line crosses Jupiter's disc on the far half of its orbit.
- **A dot's size and its opacity both follow the camera's nearness** (`scene.ts`, `render`); change one without the other and a near view fades out or burns white.
- **H alone is the wrong brightness, and a row with none is NaN:** the shader divides a row's flux by the squares of its distance from the Sun and from the eye, and finds a NaN by the float's bits, never by a comparison (`docs/DECISIONS.md`, "Look").
- **The Sun's glow is a square that faces the camera, not a point:** a point is dropped whole when its center leaves the window, and is only as big as the GPU allows (`scene.ts`, `SUN_VERTEX`). Anything else drawn wide goes the same way.
- **The ramp is the crate's** (`ramp.rs`): never type a tint in `scene.ts`.
- **A name's size is measured when it's made and when a font arrives, never in a frame** (`scene.ts`, `measure`): a read of `offsetWidth` in the draw is a layout every frame.
- **Rows drawn alone (`?only`) skip the haze, the bloom, the sky, and the bodies,** so a disc found in a screenshot is the disc: `see.ts`'s place check leans on it.
- **The scene's resolution is the visitor's, a cell of the crate's asked each tick** (`scene::scale`, the controls' list's three steps; `scene.ts`, `tick`): when it has moved, `resize` makes every buffer again. `?scale` holds another, whatever was chosen: every check that names a resolution uses it. Anything sized in the scene's pixels reads `pixelRatio` in the frame, never at its making.
- **A GPU that can't draw into a half-float buffer gets 8 bits and no bloom** (`look.ts`): every dot is still drawn, nothing brighter than white. Not seen on a real device; no check covers it.

### Halves in the crate

Four of the crate's gotchas have a half here (`crate/CLAUDE.md`): `RIDE_LIGHT` changes with `host.rs`'s `RIDE_LINE` ("The sky leaves by a number of its own"); `scene_pick` is never called from a call the crate made ("The pick is the crate's"); `alpha.ts` is one of the two things that make GPUI's canvas transparent ("GPUI's canvas is transparent"); and `scene.ts`'s `glass` agrees with `host.rs`'s `GLASS` ("The panel is glass in two places").

## Files

```
  web/              # the Vite host on shared-web/ (`@seiza/kirkwood-web`)
    index.html      #   the scene's canvas, the names' layer, the blur behind the glass panel, GPUI's canvas over all
    src/main.ts     #   boot; after the first frame, the scene's module, the files streamed into the crate's memory, the belt handed over, the sky last
    src/scene.ts    #   the scene: the belt and its shader, the bodies, the ride, a gap, a find, a group, a click's pass
    src/camera.ts   #   the camera a hand moves, and its flights; no Three.js
    src/look.ts     #   the look's passes
    src/sky.ts      #   the stars' shader and the file's reader
    src/knobs.ts    #   the page's query knobs (docs/query.md)
    src/touch.ts    #   two fingers on the scene, counted on the window
    src/phone.ts    #   a phone's page, and whether the window is one's
    public/phone/   #   that page's pictures of the app (`see --only stills`)
    src/alpha.ts    #   GPUI's canvas composited by its alpha
    src/base.ts     #   the app's base path, read by the Vite config, the Worker, and the checks
    vite.config.ts  #   the base; the manifest the page imports, cut to the served files' bytes; the preloads' media, a phone's page asking for neither; the three files served at data/ under it from data/, in dev and preview; at brotli 11 when `KIRKWOOD_DATA=br` (the slow-link check)
```

## Commands

From the repo root.

```
just kirkwood dev      # debug wasm + the Vite dev server with COOP/COEP, at /kirkwood/; the three files from data/; the query's flags and knobs: docs/query.md
just kirkwood build    # release wasm alone (-p) + wasm-opt, Vite build, asset sizes
just kirkwood preview  # serve that build, and the three files
```
