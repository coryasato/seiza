# The checks (`checks/`)

`see.ts`: what the release build shows, in headless Chromium, and what the plan's checks ask to be seen. Claude Code loads this file when a file under `checks/` is read. Kirkwood's rules and the map of its folders are in `apps/kirkwood/CLAUDE.md`, the repo's in the root `CLAUDE.md`; both apply here. Paths are relative to `apps/kirkwood/`.

## Gotchas

- **`just` hands a `;` in an argument to the shell:** `see`'s `--ways "a:;b:x=0"` is run as `node apps/kirkwood/checks/see.ts …` itself.
- **Riding, what holds still in the window is the Sun and the ecliptic's point under Jupiter on its line, not Jupiter:** its orbit isn't a circle (it goes in and out along the line) and is inclined 1.3° (tilted, it sits a few pixels off the plane). A check of the turning frame reads the point under it (`see.ts`, `seeTilt`).
- **A check that clicks the scene and means nothing by it clicks where no dot is** (`see.ts`, `quietPlace`): in the belt nearly every pixel is within a click's reach of one.
- **With time running, a published target beside the date can be a few pixels stale:** the date is a view of its own, and when it alone redraws at a new width the row of actions moves without the interface publishing their bounds again. `see.ts` reads an action's fill from a strip across its middle, never beside an edge (`actionFill`, `actionFills`).
- **A published target is never withdrawn:** its last bounds stay in `__seizaTargets` after its element stops being drawn, so a check of what's drawn reads a fresh page (`PLAN.md`, open questions).
- **A check reads a moving thing's pixels on a held clock:** with time running the marker has moved on by the screenshot (`see.ts`, `marked`). And `ride`'s pressed sequence uses most of the clock's 50 s of reach from the epoch: on a busy machine the clock ends first, and its last step fails; run it again alone.
- **A script reads the table's layout once the panel has stopped sliding** (350 ms): the layout probe is the cells' place in the frame it was drawn.
- **A rule a check shares with the code it checks lives with that code:** `rowsInside` is `group.rs`'s rule written again (`crate/CLAUDE.md`, "A row is in the group by the pixel its place falls in"), the column numbers the `kirkwood(page, …)` closures hold are `table.rs`'s `shown` (`crate/CLAUDE.md`, "A column of the table isn't a column of the files"), and the names' offset is `scene.ts`'s `RIDE_NAMES` (`web/CLAUDE.md`, "The ride's names and triangle"): change each with its code.
- **What a check waits on is said where it's made:** the integrated rows catching up after a jump of the clock (`withBelt`; `crate/CLAUDE.md`, "After a jump of the clock"), a find reaching the scene (`chaseIs`; `web/CLAUDE.md`, "The scene is never called for a find"), and the camera at rest (`stats.gliding`), with `?roll=0` for a level one (`web/CLAUDE.md`, "The opening shot is a pose").

- **Fingers are Chromium's own touch events** (`see.ts`, `seeTouch`: CDP's `Input.dispatchTouchEvent`, after `Emulation.setTouchEmulationEnabled`): a move every 8 ms, and a hold before the release where no glide is wanted. A check of a window that isn't 1440×900 makes its own context (`seePhone`): the harness's `open` is the protocol's.
- **A lost context hands out no extension:** `seeLost` keeps `WEBGL_lose_context` from before the loss to give the context back with.
- **A request's path in `paint` is what follows the app's base** (`load` takes it off after failing on any request outside it); a check that reads `performance`'s entries in the page finds the data's by `document.baseURI`.
- **A check that reads a request's status records the page's `fetch`es in an init script** (`see.ts`, `recordFetches`, for `paused`): a listener on the page is attached after its first requests, and whether `performance` lists a refused one is the browser's choice.

## Commands

From the repo root.

```
just kirkwood see [--only <checks>] [--runs 5] [--browser firefox|webkit] [--worker] [--url <the page>]   # the release build in headless Chromium (`--worker`: behind the app's Worker under `wrangler dev`, every check but `slow`; `--url`: a page served elsewhere, production's, for `paint` or `paused` alone), about 30 minutes for every check; run `build` first. Each check's name and what it covers: see.ts's header (the justfile's comment lists them); `glass`, `rate`, `drag`, `slow`, `cross`, and `paused` (alone) run only when named. Screenshots and seen.json in checks/out/ (gitignored)
```
