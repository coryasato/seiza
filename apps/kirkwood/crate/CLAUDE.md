# The crate (`crate/`)

The `kirkwood` crate: the engine (the rows, the clock, the flight, the ride, the integration, a gap, a find, a group, the table, the live columns) and the interface (`host.rs`), with what passes to and from the scene (`scene.rs`, `web.rs`). Claude Code loads this file when a file under `crate/` is read. Kirkwood's rules and the map of its folders are in `apps/kirkwood/CLAUDE.md`, the repo's in the root `CLAUDE.md`; both apply here. Paths are relative to `apps/kirkwood/`.

## Architecture

- **The engine:** Rust owns the orbital elements and their bytes (the scene's attributes are GL buffers of its own, filled from views over each block of rows as it arrives), the clock, Jupiter's orbit (it isn't a row), the color ramp (`ramp.rs`: the shader's table and the legend's, one), the sort flight and its axes, the ride and the two groups that hold in it, their integration, a picked gap's marker, the row found, and a drawn group (picked through the scene's camera a frame's worth at a time).
- **Who calls whom:** the scene asks Rust each frame (the clock, the flight, the ride, a picked gap, the panel's width, where the page's text lies, Jupiter's place). Rust calls the scene only to hand it input (a wheel, a press, a drag, a double click, an arrow or a zoom key, the way home, each for the camera of a frame, and a shape's points as they're drawn), and asks it for its camera at a shape's release and for the row drawn nearest a click. A found row and a group the scene asks for each frame; Rust never calls it with them.
- **The rows:** held in Rust as the bytes of the two files, each written into the wasm's memory as it arrives and read where it lies (`bytes.rs`: 32-bit words, so no `unsafe` and no copy); the table's delegate answers every page from them, through an index of file rows when the table is a drawn group's or sorted (`table.rs`, `View`). Two of the table's 20 columns are worked out when a cell is drawn (`live.rs`). No DuckDB, and no `engines/duckdb/`. Why: `docs/DECISIONS.md`, "Data" and "Table".

## Gotchas

### Moved by whoever reads it

- **The clock is moved by whoever reads it** (the scene every frame, the date four times a second), and the scene draws when the years it's given are new, so it draws nothing while time is paused, held, or stopped at its last day.
- **The sort flight is moved the same way** (`flight.rs`: the scene every frame, the interface while the dots fly), and it is one number the shader places each dot by: nothing uploaded, no buffer rewritten. Landed, the scene draws nothing, whatever the clock does.
- **The ride moves the same way** (`ride.rs`, both over `tween.rs`). A reading more than half a second after the last is a stall, and moves it a tenth of a second.

### The four actions, one pressed at a time

- **One action is pressed at a time** (`host.rs`, `toggle_sort`, `toggle_ride`): a press on one lets the other go in the same call, and both move at once. A new action joins the same rule, with the exceptions below. A picked gap isn't one: it's part of the ride (`pick_gap`), and "Ride with Jupiter" reads pressed with it.
- **A find** (`find`) lets the sort and the ride go, and the lasso's mode, but keeps a held group (the row found is one of its rows); a row with no dot lets nothing go. Each of the sort, the ride, and a gap lets the found row go. "Find Ceres" reads pressed while the first row is the row marked, whatever found it.
- **A group** (`toggle_lasso`, `drop_group`): "Draw a group" reads pressed in the lasso's mode, while a release waits for its rows, and while a drawn group is held, and pressed then it lets all of that go (with a dot clicked held instead, its row is let go and the mode begins). Its press lets the sort, the ride, and a found row go; the sort, the ride, and a gap's chip let the group and the mode go; "Find Ceres" lets go of a group Ceres isn't in. Anything new that changes the group calls `refilter`.
- **The sort's press pauses time, and the press back gives it back** only if the time control wasn't pressed between (`clock.rs`, `pause_for_sort`, `resume_after_sort`). **Time is paused from the lasso's press until the group is let go** (`pause_for_group`): the release gives nothing back; Run pressed in the mode leaves it, and pressed with a group held it runs, the group still lit (`docs/DECISIONS.md`, "Scene").

### A gap

- **A gap is picked only in the frame that turns** (`gap.rs`, `advance`): any reading with the ride at rest in the fixed frame lets it go, so the ride's press back and the sort's press say nothing to it, and the marker leaves with the ride's own light (`gap::lit`). While riding, two presses let it go (`let_go`, 0.4 s): the card's picked chip (`pick_gap` with `in_card`; never the landed layout's chip, still under the pointer as it fades), and "Ride with Jupiter" pressed again before the camera is back (`toggle_ride`).
- **The marker's orbit turns Jupiter's own mean motion times the ratio, never 1 / a^1.5** (`gap.rs`, `orbit_with`): a part in 2,000 off and its path never closes. The card's periods are from the same number; only the orbit's size is from Jupiter's a.
- **With a gap picked the ride's own additions leave** (the two groups' names, the triangle, their light: `scene.ts`'s `groups`, the shader's `uMarked`), and the title's sentence changes with them (`host.rs`, `GAP_LINE`): change one with the others. Never both at once: the ride's additions are gone by half of `gap::shown` (`groups_gone`), and the marker, its dim, and its card come in over the other half (`lit`), as the title's two sentences do (`host.rs`, `shows`).
- **The card starts under the title's lines, as the e axis does** (`host.rs`, `render_card`, `CARD_UNDER_TITLE`): text added to the title moves both. `see.ts` holds the card to 20 px under.
- **The sky leaves by a number of its own** (`scene_sky`: the flight's `space` times the ride's `sky`), and the title's sentence about the stars with it; riding, that sentence's place says what the turned frame brightens (`host.rs`, `RIDE_LINE`). Change the groups' light (`scene.ts`, `RIDE_LIGHT`) and it together.

### The integration

- **A row's integrated place is the same however the clock came to it:** steps on a grid from the epoch, only ever taken away from it (a clock that moves toward the epoch starts the rows over from there), and between two steps the two-body orbit from the last. Nothing may step by a frame's own time, and no step is undone to save a few (a close pass of Jupiter doesn't undo to the same float). `place_of` integrates one row alone from the epoch, and `see.ts` holds the scene's rows to it; it answers by the row's group, whatever the scene draws (`ellipse_of` is where a row is drawn with `?integrate=0`, or while the rows catch up).
- **After a jump of the clock the two groups are on their ellipses for some frames** (`web.rs`, `INTEGRATE_MS` of steps a frame; `stats.catchingUp`). Landed on the axes the rows are stepped and no place is worked out.
- **The two long studies in `integrate.rs` run only with `KIRKWOOD_STUDY` set:** `KIRKWOOD_STUDY=1 cargo test -p kirkwood --release <name> -- --include-ignored --nocapture`.

### The camera and the corner

- **The camera is a hand's only in space, at rest in one of two frames,** and the interface decides which from the crate's own state, never the scene from its last frame (`host.rs`, `hands_frame`; `scene::Frame`, handed over with every wheel, drag, and double click). On the way between the two, and with the dots out of space, an input moves nothing. The crate can be a frame ahead of the scene's picture, so the scene takes an input only if the camera it last drew is at rest in that frame (`scene.ts`, `handOf`). Any button's release ends a drag.
- **A wheel is the scene's only in space** (`host.rs`), and the way back from a sort is never turned down, whatever failed since the press.
- **A drag is the scene's from its press on the surface to its release, wherever that is** (`scene.rs`, `DRAG`; `host.rs`, `drag_listeners`, the window's own, registered every frame). A new element over the scene needs nothing for it: occluding, it takes its own press, and a drag begun on the scene crosses it.
- **A double click is two plain presses the surface itself took, in one frame, and its second starts no drag** (`host.rs`; `scene.rs`, `surface_press`): the click count alone also counts a first click on a chip that then leaves from under the pointer, or one made while the camera flew.
- **The compass is a view of its own** (`host.rs`, `Compass`), as the date is: a turn redraws it alone, and the interface is drawn again only for its first showing and the hint's fold.
- **The corner is drawn only in space, once the scene is up** (`host.rs`, `corner_shown`): landed, its place is the count of rows in view's, and the keys do nothing. It fades with `flight::space`, takes no input from the sort's press on (`in_space`), and that press shuts an open list. Something new at the bottom right of the landed layout shares that place.
- **The hint folds for good on the camera's first move by a hand, or when the controls' list first opens** (`host.rs`, `fold_hint`; `localStorage` key `kirkwood:hint`); the flight home and the scene's own flights don't fold it. Where what the panel leaves is narrower than `HINT_ROOM` it is drawn as its button without being folded: a longer row of actions needs a wider `HINT_ROOM` (1215 with four actions).
- **The controls' list keeps clear of the table's handle** (`host.rs`, `handle_left`): it is as tall as the handle is high up. A row added makes it taller; it must still fit under the title in a window 900 px high.
- **The keys are the interface's root's, by its focus handle** (`host.rs`, `key`): it takes the focus whenever nothing has it and the panel is shut, and hands it back when the panel shuts. With the panel open every key is left alone, so the table's reach the table (the host focuses it as the panel opens; a press elsewhere takes them away). A key with Ctrl, Alt, or the platform's key held is the browser's.

### A row found, a group, a dot clicked

- **A found row is the table's selected row, and nothing else's** (`host.rs`, `selected`, `find`, `lose`): found at each `Selected` of one row (a range finds nothing new), let go by clearing the table's selection. Anything new that finds a row selects it in the table (`jump_to`); anything that lets one go calls `lose`.
- **A found row with no ellipse has no dot** (`find::marked` is nothing): no mark, no flight, the sort and the ride left as they were, and the panel says why (`host.rs`, `no_dot_line`).
- **The pick is the crate's, a few milliseconds a frame, and the scene's tick drives it** (`web.rs`, `scene_pick`, `PICK_MS`; `group.rs`, `step`): every row is placed from the mode's press on, and a closed shape's rows are tested once they're all in. It leans on time being paused: `step` begins again if the clock's years moved. The places are 19 MB, held only in the mode. Don't call `scene_pick` from a call the crate made: a group picked updates the interface.
- **A row is in the group by the pixel its place falls in** (`group.rs`, `Mask`, `Camera::window`): its place in 32-bit floats, through the scene's own matrix, only in front of the camera and between its planes, into a pixel whose center is inside the shape by the even-odd rule. `see.ts`'s `rowsInside` is that rule written again: change them together. A Hilda or a Trojan is where the integration has it (`scene_pick`'s `apart`).
- **A shape is drawn only through the fixed frame's camera at rest, and the camera holds still under it** (`host.rs`): from its press until its rows are in, a wheel and the keys move nothing. Its points are kept to what the panel leaves (`in_scene`).
- **The way back flies only when the crate says it was the way back** (`scene.rs`, `back`, `backs`: `host.rs`'s `show_all`). A group let go by another action (`drop_group`, `let_group_go`) leaves the camera where it is. Anything new that lets a group go picks one of the two.
- **The named bodies are the interface's to choose and the scene's to draw** (`host.rs`, `describe_group`; `group::name`; `scene.ts`, `body`), set inside `scene_pick`'s call, before the scene asks. Their labels sit before the group's chip and the found row's name in `scene.labels()`, which checks read from the end.
- **A dot clicked is a group with no shape** (`group::pick_one`, `group::clicked`, `group::drawn`): the gray and the table's one row are a group's, the mark and the flight a found row's (selected with `jump_to`). `host.rs` asks `drawn()` wherever a shape is meant, and `held()` wherever any group is.
- **The click's wait is in the scene's gotcha** (`web/CLAUDE.md`, "A click's row is read off a pass of the scene's own"): `CLICK_WAITS` and `undo_click` stand against the platform's own double click.

### The table and the live columns

- **A row of the table isn't a row of the file** once the table is a group's or sorted: the interface asks the view (`table.rs`, `View::file_row`, `View::at`) at every `Selected` and before every `jump_to`. A filter is `set_rows` and then the table's own sort set again, which forgets every page (`host.rs`, `refilter`; the tall table's `live` isn't built here).
- **A column of the table isn't a column of the files** (`table.rs`, `shown`): the live columns stand after the full name, so every column after it is two on from its place in `catalog::column`. Anything handed a column by the table (a sort, a cell, the checks' hooks) asks `shown`; `see.ts`'s `kirkwood(page, …)` closures can't, so they hold the numbers themselves (`DIAMETER`, `LIVE`).
- **Only the files' number columns sort** (`table.rs`, `SORTABLE`, `sortable`, which the delegate and the checks' hook both ask): the order is a radix sort of the rows that have a number, made in the delegate's `sort`, in the task of the press (`docs/DECISIONS.md`, "Table"). Its keys order as integers the way the floats do; a row with none never gets a key.
- **Every live cell of a frame is of one instant, and only the interface moves it** (`live.rs`, `show`; `host.rs`, `refresh_live`, twice a second while the panel is in sight, and at its opening): a cell is worked out from that instant, never from the clock now, so a scroll or a hover between refreshes changes no number. A new live column is a case in `live::Live` and its number in `live::distance`; no page is read again. Rule 5 is the rate's and the decimals' (`docs/DECISIONS.md`, "Table").
- **A live cell of a Hilda or a Trojan is its integrated place's,** kept for the instant shown (`live.rs`, `PLACES`), whatever the scene draws: with `?integrate=0`, or while the rows catch up, the cell and the dot differ.
- **The live columns have set widths** (`table.rs`, `live_width`; the table's `density` is on for that alone): both must end inside the panel as it opens, which `see.ts` holds. A third live column, or wider first columns, is weighed against that.

### The axes

- **The axes are the crate's** (`layout.rs`): the shader is handed their ends and where they are in the window, already in clip space (`Plot::clip`, which the crate's test of the flight takes too), and anything drawn on them asks the same `Plot`. Never type an axis's end or a gap's place in `scene.ts` or `host.rs`. A row is in view by a comparison in 32-bit floats, the shader's own, so the rows counted are the rows landed.
- **The axes' furniture is GPUI's, on the crate's plot** (`host.rs`, `render_furniture`), with the panel's width in it. It takes no input and doesn't occlude, so a press or a wheel reaches the surface under it; but the chips, which are buttons and occlude. `Plot::chips` keeps them apart and inside the plot, and gives none in a plot too narrow for four in a row (the line over them and their drops go with them). Its opacity is the flight's (`flight::axes`, `flight::landed`; `docs/DECISIONS.md`, "Interface").
- **The e axis starts under the title's lines** where they end below the plot's top (`host.rs` reads the bounds the title measured for the scene's quiet), and the title asks for one more frame when those bounds move while the axes show. `see.ts` holds it to 8 px under the title.
- **What's said of the landed dots needs a belt:** the chips, the names, the line over the chips, and the count are drawn only once the scene has drawn rows; the axes alone stand without.

### Drawing over the scene

- **An element over the scene must `occlude()`,** or a wheel on it also zooms the scene (`docs/DECISIONS.md`, "Input").
- **The scene quiets its picture where the title's lines lie** (`host.rs` measures them, `scene_scrim`). Text added over the scene elsewhere has no quiet under it: give it a fill, or widen what's measured.
- **The panel is glass in two places that must agree on when** (`host.rs`, `GLASS`: the panel's fill, and through `web.rs` the table's clear fills; `scene.ts`, `glass`: the element that blurs the scene behind it): both are on unless `?glass=1`. Text in the panel sits over a blurred scene at a fifth of the fill: give it the foreground or the muted color, never dimmer, and a fill of its own if it needs one. The table's head has one (`web.rs`, `GLASS_HEAD`): the table draws its columns' names dimmer than its cells.
- **A published target is placed from its parent's corner** (`host.rs`'s `target`: `top_0`, `left_0`): left at its static place it starts inside the parent's padding. **And beside a bordered box, not in it:** an absolute child fills the box inside its border, a pixel short all round (a gap's chip, the card).
- **A fading run of text is a highlight's `fade_out`,** not a clear color: a highlight's color is blended over the text's own (`host.rs`, the line about the stars).

### GPUI made clear

- **GPUI's canvas is transparent because of two things:** `web/src/alpha.ts` (the WebGPU context's alpha mode, set before the wasm starts) and the theme's `tokens.background` set transparent after `Theme::change` (`web.rs`). It leans on GPUI clearing to transparent and blending source-over, which it doesn't promise.
- **GPUI's text is set to grayscale at the start** (`web.rs`): subpixel text, which a real GPU draws and headless Chromium can't, leaves the canvas's alpha at 0 over the clear window and is composited away. No check sees it: after a change to how the window is made clear, look at the title and the axes' numbers in a real browser (`docs/DECISIONS.md`, "Table").
- **The transparent `tokens.background` is read by more than the window's fill.** The tall table takes it as the text color over a cell's fill (`components/tall-table/src/paint.rs`, `text_over`), and gpui-kit components that paint with it (inputs, tooltips, outline buttons) would be see-through over the scene. Nothing here uses either yet: before the table gets a cell fill or a ramp, or such a component is added, give it a color of its own.

## Files

```
  crate/            # `kirkwood` (cdylib)
    bytes.rs        #   a file's bytes as 32-bit words, read where they lie
    elements.rs     #   the elements file, read a block at a time as it arrives; counts, the two groups' rows, the epoch
    rows.rs         #   the rows file: its sections, designations, names, dates
    catalog.rs      #   the two files as the sample's 18 columns; tested against data/fixture.json
    table.rs        #   the tall table's source: the index of file rows, the shown columns, the sort
    live.rs         #   the live columns: the instant shown, a cell's number, the decimals
    clock.rs        #   years since the epoch, 1976-06-09 to 2076-06-09
    orbit.rs        #   two-body orbits in 64-bit floats, Jupiter's; tested against data/horizons.json
    integrate.rs    #   the Hildas and the Trojans under the Sun and Jupiter; tested against data/horizons.json
    flight.rs       #   the sort flight: its progress, what's left in space, the axes' opacity
    ride.rs         #   the ride with Jupiter: the frame's turn, the three points, the two groups' bounds
    tween.rs        #   a pressed action's 0-to-1 progress, under flight.rs and ride.rs
    gap.rs          #   a picked gap: the marker's orbit and path, the card's numbers
    find.rs         #   the row found: its name, whether it has a dot
    group.rs        #   a drawn group: the lasso's mode, the shape, the pick, a dot clicked
    layout.rs       #   a against e: the axes, a row's place on them, the gaps, the furniture's places
    shader.rs       #   tests only: the scene's vertex shader's `PLACE` and `FLIGHT` in 32-bit floats against orbit.rs (every row) and layout.rs (every row in view)
    ramp.rs         #   color is orbit size: the stops in oklch, the table the shader takes
    scene.rs        #   what passes between the interface and the scene
    host.rs         #   the view: the title, the actions, the panel, the axes' furniture, the card, the corner, the keys, the surface
    web.rs          #   wasm only: `start`, the files' arrival, what the scene asks, the checks' readings and hooks (`table_jump`, `table_sort`)
```

## Commands

From the repo root.

```
just kirkwood test     # native tests, and the ones `#[ignore]`d in a plain `cargo test`, on the real files (about two minutes; fail without data/elements.bin and data/rows.bin); what they cover: the justfile's comment
```
