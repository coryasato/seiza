# PLAN.md — Kirkwood

What's next for Kirkwood: milestone status, the active milestone's "done when" checks, the milestones after it, long-term goals, and open questions. Only what's still open lives here. Context and rules are in `CLAUDE.md` here and at the repo root.

**Goal:** the asteroid belt as a scene to fly through, drawn from the asteroid table's own rows, with the table of those rows beside it, each moving the other. In a sentence a visitor could repeat: **every dot is a row.**

**No deciding metric:** Kirkwood is a showcase (root `CLAUDE.md`, "Tiers"), exempt from the budgets, the measurement protocol, and the results notes. It still paints something first and loads the scene after. A milestone's checks are things to see on screen; where a check asks for a number, the number is recorded with the decision it settles (`docs/DECISIONS.md`), not gated.

**Success:** someone with no astronomy stays two minutes, does one thing that delights them, and leaves knowing the table was real.

**Where everything else lives:**
- [`../../docs/research/asteroid-belt.md`](../../docs/research/asteroid-belt.md): the research: what the scene shows, what the table does, what's honest to simulate, the data it needs.
- [The storyboard](https://claude.ai/artifact/Vpx3w9Jb6EAW5RFJbLKKoi): seven boards, reviewed 2026-11-10. Boards 1 to 5 were redrawn 2026-11-12 from the app as built (the release build's own scene, the interface over it where the code puts it); boards 6 and 7 are still the first drawing (M7, part D, redraws them); boards 8 to 10, the camera's corner, are built (the controls' list beside the table's handle, not under it), and board 11's preset isn't. Each milestone below names the boards it builds; the canvas's notes say which parts of them are placeholders, and what building changed.
- [`docs/DECISIONS.md`](docs/DECISIONS.md): every decision, by area. Repo-wide ones (the showcase tier, its home): the root [`docs/DECISIONS.md`](../../docs/DECISIONS.md).
- [`docs/data.md`](docs/data.md): the fetch (its source, fields, and frame), the two files built from it, Jupiter's orbit, and what the files' places were checked against.
- [`docs/milestones.md`](docs/milestones.md): the specs, checks, and evidence of finished milestones.
- [`docs/LESSONS.md`](docs/LESSONS.md): what each milestone taught us.

---

## Status

| Milestone | Title | Status |
|---|---|---|
| M0 | The two canvases: a spike | Done 2026-11-11 ([`docs/milestones.md`](docs/milestones.md)) |
| M1 | The orbits' data | Done 2026-11-11 ([`docs/milestones.md`](docs/milestones.md)) |
| M2 | The belt in space | Done 2026-11-11 ([`docs/milestones.md`](docs/milestones.md)) |
| M3 | The reveal: sort by orbit size | Done 2026-11-12 ([`docs/milestones.md`](docs/milestones.md)) |
| M4 | Ride with Jupiter, and a gap picked | Done 2026-11-12 ([`docs/milestones.md`](docs/milestones.md)) |
| M5 | A camera a hand moves | Done 2026-11-12 ([`docs/milestones.md`](docs/milestones.md)) |
| M6 | The scene and the table, each moving the other | Done 2026-11-13 ([`docs/milestones.md`](docs/milestones.md)) |
| M7 | In the open: deployed under Tycho | Active: part A next |

A milestone's spec, "done when" checks, and parts are written when the milestone before it closes, from what that one found. None is planned past M7.

**Closing a milestone:** every "done when" check passes, with its evidence (a screenshot, a recording, or a number) beside it; new decisions are in `docs/DECISIONS.md`; a `docs/LESSONS.md` entry is written; and the milestone's spec and evidence move from here to the end of `docs/milestones.md`, leaving one row above. No results note and no `report`: a showcase has no budgets.

**Waiting on** (features of a component or engine this app needs; only that crate's `PLAN.md` builds them, and the session that closes one flips its row to *Ready*):

| Needs | For | Status |
|---|---|---|
| The tall table reporting a press on a row whether or not its selection changed ([its `PLAN.md`](../../components/tall-table/PLAN.md), "Asked for by Kirkwood": a draft, not yet specced) | The same row pressed again flies the camera back to it, after a pan let it go (`docs/DECISIONS.md`, "Interface") | *Not ready* |

Nothing else. The tall table's `sort`, `select`, `format`, and `density` are built and the app builds them (`live` it doesn't need: a live cell is worked out when it's drawn), and with the rows held in Rust a filter to a drawn group and a sort are both the delegate's work, an index it reads its pages through (`docs/DECISIONS.md`, "Table"). Nothing is asked of `engines/duckdb/`: the app doesn't use it.

---

## Active milestone

### M7: In the open: deployed under Tycho

Kirkwood is built and runs from a checkout. This milestone puts it at `tycho.seiza.io/kirkwood` for anyone to open, and settles what it is on a browser, a machine, or a hand that isn't the one it was built on. Nothing new is added to the picture.

**Where it's served from** (root `docs/DECISIONS.md`, "Hosting", 2026-11-10): a path on Tycho's subdomain, behind Tycho's WAF rules, rate limit, and pause switch. Decided there: one host to watch, a Kirkwood deploy may redeploy Tycho's Worker, each app keeps its storage and anything scoped to its own path. Left to this milestone: whether a second Worker can take `/kirkwood/*` on a hostname Tycho's Worker holds as a custom domain (then each app deploys alone), or Tycho's Worker serves both. Part A finds out and decides.

**The build under a path.** The page is built with `/kirkwood/` as its base. The data's URL is already under the base (`web/src/main.ts`), and the hint's fold is one key in `localStorage`, named for the app. Nothing registers a service worker. What else assumes the origin's root is found by running the checks against a build served at the path.

**The three files.** `elements.bin` (44.25 MB, 34.78 at brotli 11), `rows.bin` (46.27 MB, 11.15), and `stars.bin` (6.23 MB, 5.38): 51.3 MB on the wire, each read whole, never by range, its length from `data/MANIFEST.json`. The two the crate holds are over the 25 MiB a static asset may be, raw; at brotli 11 `rows.bin` and `stars.bin` are under it and `elements.bin` isn't. So they go in R2, as Tycho's samples do, or the two that fit go as static assets: part A decides, with what each costs a request. Either way they're compressed once at deploy, at quality 11, and sent as they are (root `CLAUDE.md`, "Known Cloudflare gotchas": Cloudflare's own compression is weak, and `wrangler dev` can't show what production sends). The app's own files (the wasm, 2.8 MiB at brotli 11; the scene's module; the font) are static assets, precompressed as Tycho's are.

**The guards.** The zone's path allowlist widens to Kirkwood's paths before the deploy (the rules' text: the gitignored root `docs/private/zone.md`). The pause switch stops its data as it stops Tycho's, and the page says so in place of the loading line.

**Tycho is left as it was.** Its checks and budgets gate its own files and must not see Kirkwood's; its Worker's code may grow, its page and wasm don't change. The one change to Tycho's page, a link to Kirkwood, is Tycho's to make in its own plan.

**Other browsers.** The app was built and checked in headless Chromium at DPR 2, with the first frame, the belt, and a wheel read in Firefox and WebKit (`see --only cross`). Every action is tried by hand in Firefox and Safari, the look is judged at DPR 1 (open questions: the stars are much more of the picture there), and what differs is fixed or written down.

**Other machines and hands.** A phone, touch, a GPU slower than an M1, and a lost WebGL context are all open questions today. Each is decided here: built, or said on the page and in the README. The leaning for a phone (2026-11-12): no cut-down build; a recording of the real app, a line saying it's built for a larger screen, and "Open it anyway".

**The README in full** (rule 7; root rule 4): what a canvas-drawn scene and table give up against the DOM, with what Kirkwood does about each, and the bytes it ships.

**What M7 leaves:** a shape drawn in a against e, a pan and a zoom on the axes, a group and a found row kept through the sort and the ride; a second coloring, a search by name, a date picker (long-term goals).

**Split into parts,** one session each:

- **Part A: where it's served from, and the build under a path.** The second Worker tried on a hostname bound as a custom domain; the files' place (R2 or static assets) and their encoding; the base path; the release build run locally at `/kirkwood/` behind the Worker. Closes A1 to A3.
- **Part B: the deploy.** The deploy's script and recipe; the allowlist; the pause switch and the page's line for it; the check against production; Tycho's checks beside it. Closes B1 to B3.
- **Part C: other browsers, machines, and hands.** Firefox and Safari by hand; the look at DPR 1; a lost context; touch; the scene's resolution control; the phone's answer. Closes C1 to C5.
- **Part D: the README, the credits, the owner's looks, and the close.** The canvas tradeoffs in full; the credits on the page; the link from Tycho; every "at the owner's next look" question settled or kept as a knob; the storyboard's boards redrawn from the app. Closes D1 to D4.

**Done when:**

- [ ] **A1. Where it's served from is decided:** a second Worker on `/kirkwood/*` tried against the hostname Tycho's holds, with what Cloudflare answered; the choice and what a deploy of each app then touches, written down.
- [ ] **A2. The build runs under the path:** the release build served at `/kirkwood/` behind the Worker locally, every request under the path but the fonts', `just kirkwood see` passing against it, and nothing of Tycho's storage or scope touched.
- [ ] **A3. The files' place and encoding are decided:** where each of the three is stored, the bytes each puts on the wire, and a slow-link load against that (`see --only slow`).
- [ ] **B1. It's deployed:** `tycho.seiza.io/kirkwood` opens; a check against production asks for every file the page does and finds each answered 200 with COOP and COEP, the app's files and the data as brotli on the wire at their quality-11 sizes, the data's bytes the manifest's, and no script in the page that the build didn't put there.
- [ ] **B2. The guards hold:** a request outside the allowed paths gets the WAF's 403; with the pause on, the data answers 503 and the page says the data is paused.
- [ ] **B3. Tycho is as it was:** `just tycho check` and its check against production pass after Kirkwood's deploy, with its budgets and its files' list unchanged.
- [ ] **C1. Firefox and Safari:** each action tried by hand in both, on a real GPU, with what differs fixed or written in the README; `see --only cross` passing in both; the look at DPR 1 decided by eye.
- [ ] **C2. A lost WebGL context** brings the belt back, or the page says to reload: decided, built, and seen with a context lost on purpose.
- [ ] **C3. Touch** is decided: one finger and two built as a map's, or the page and the README say a pointer is needed.
- [ ] **C4. The scene's resolution** has its control, or the question is closed without one: decided with the scene's frames a second at each step.
- [ ] **C5. A phone** gets what was decided for it, seen on one: what loads before anything is asked for, what "Open it anyway" does, and the page's memory there.
- [ ] **D1. The README's canvas tradeoffs are whole:** accessibility, text selection, find-in-page, the keyboard, and the bytes shipped, each with what the app does about it.
- [ ] **D2. The credits are on the page:** JPL's and ESA's, where a visitor can find them.
- [ ] **D3. Tycho links to it:** a note in Tycho's plan for its link, and Kirkwood's README and the root's apps table saying where it lives.
- [ ] **D4. The owner's looks are taken:** each open question marked "at the owner's next look" is settled or kept as a named knob, and the storyboard's boards 1 and 6 to 10 are the app's own pictures.

---

## Long-term goals

None committed (the research's "Extras"):

- A second coloring: by class, near-Earth, or potentially hazardous.
- Size by diameter.
- Earth's orbit drawn; an asteroid's whole orbit traced on a click.
- A search by name, and a date picker.
- Up close, the few bodies with real shapes (Ceres, Vesta) drawn as themselves; any other close-up rock is invented and labeled as illustration.

## Open questions

- **The marker's name over its own path:** "the marker" sits 16 px right of the marker and 26 up, as board 5 has it, with no fill under it, so where the path runs up and to the right of the marker the white line crosses the white name (seen at 5:2 and 7:3 on the epoch, `docs/seen/gap-5-2.jpg`). Whether the name gets a fill, or moves to the side the path leaves clear. *By eye, at the owner's next look.*
- **The marker's eccentricity and the dim, by the owner's eye:** both were chosen from screenshots (0.25, the board's; 0.6 of what the ride leaves the belt: `docs/DECISIONS.md`, "Scene", "Look"). `?markerE` and `?markerDim` are left to look with. *At the owner's next look.*
- **The furniture's targets outlive it:** a published target (`__seizaTargets`) is never withdrawn, so after the dots fly back the chips', names', line's, and count's bounds still read as they were landed. Only scripts read them, and the checks that ask what's drawn do so on a fresh page. Whether `shared/`'s targets get a way to withdraw one, or the host publishes empty bounds when a piece isn't drawn. *Before a check needs it on a page that has landed.*
- **A found row's distance and its flight's time, by the owner's eye:** the camera ends 2 au from the row after 1.2 s, chosen from screenshots and not looked at moving (`docs/DECISIONS.md`, "Input"). `?found=<au>` is left to look with. *At the owner's next look.*
- **A found row riding with Jupiter, and on the axes:** a find lets both go (`docs/DECISIONS.md`, "Interface"), so a press on a Hilda's row while riding stops the ride, and a press on a row while the dots are landed takes the chart away. Kept through them, the mark and the follow would be drawn in the turning frame's camera and on the row's a and e. *Not placed in a milestone yet; with a shape drawn in a against e.*
- **The glass's sweet spot, and its text over bright dust:** the panel ships as glass at a fill of 0.2 and a blur of 8 px, the owner's eye (`docs/DECISIONS.md`, "Table"), who put the best of it "somewhere around those settings". `?glass` and `?glassBlur` are left to look with. *At the owner's next look.*
- **A control for the scene's resolution:** the scene ships at the display's resolution, 29 frames a second while time runs on an M1, and three quarters draws 41 (`docs/DECISIONS.md`, "Scene"). The visitor gets the trade, as Three.js scenes commonly offer. Decided: the control is GPUI's (one hit test already routes every input; a DOM pane over both canvases would have to be routed around). First a few named steps over what `?scale` turns; then, as a second step, the scene holding a frame rate by stepping its own resolution down, the control its override. To decide when it's built: the steps and their names, where it sits, and whether the choice is kept between visits. Stepping it down while the camera moves was tried and turned down by eye (`docs/DECISIONS.md`, "Scene"), so the second step, the scene holding a frame rate by itself, would have to change resolution without the flicker that had. *M7, part C.*
- **The look at DPR 1:** the look was chosen at DPR 2. At DPR 1 (headless Firefox and WebKit) the stars are much more of the picture: a star 1.1 px across is one whole pixel at the middle of its profile. Whether a star's and a dot's light should follow the pixels they cover, chosen by eye on a display of that kind. *M7, with the check in Firefox and Safari.*
- **A click on a dot, by the owner's hand:** its reach (6 px), its wait for a double click's second press (200 ms, after 400 felt laggy), and that one row grays the whole belt as a drawn group does (`docs/DECISIONS.md`, "Scene", "Interface") were chosen from the checks, not felt. In the belt's dust nearly every click is within reach of some dot, so an idle click flies the camera to one. *At the owner's next look.*
- **The flight in, by the owner's eye:** 1.6 s, the room the group keeps (100 px each side, 170 top and bottom), and its first frame, 117 ms in the check, in which the panel is first laid out and the gray's bytes go to the GPU (`docs/DECISIONS.md`, "Scene"). Whether that frame is seen as a hitch, and if so whether the panel's first layout is made before a group is ever drawn. *At the owner's next look.*
- **The gray, by the owner's eye:** a dot outside a group keeps its lightness, loses its hue, and half its opacity, and the stars dim to a third (`docs/DECISIONS.md`, "Look"): chosen from screenshots. `?gray` is left to look with. *At the owner's next look.*
- **A group through the sort and the ride:** both let the group go. Kept through them, the gray would show where a drawn group lies in a against e, the natural next ask beside a shape drawn there. *Not placed in a milestone yet; with a shape drawn in a against e.*
- **The page's memory:** every row held is most of the wasm's memory (`docs/DECISIONS.md`, "Table"): the two files are 90.5 MB held as they arrive. What a phone makes of it; the diameter and albedo as a list of the rows that have one would take 11 MB out (`docs/DECISIONS.md`, "Data"). *M7, with the phone's answer.*
- **The credits on the page:** the README credits JPL and ESA, and the page names Gaia in a line; ESA's full acknowledgement and JPL's credit aren't on screen. Where they go (an about line, a corner). *M7, before it's in the open.*
- **A lost WebGL context:** the belt's buffers are the scene's own, filled a block at a time from views over the wasm's memory, so a context restored by the browser would come back with no belt. To handle: new buffers, and every block handed over again on the restore (the elements' address holds). *M7, before it's in the open.*
- **The sky as a choice, riding:** the sky leaves the turned frame, and stays out by default: the owner looked at it turning (`?rideSky=1`, and at 0.4) and found it somewhat nauseating (`docs/DECISIONS.md`, "Scene"). A toggle for it may join the scene's own controls (the resolution's, above), bringing it back at 0.4, with the title's sentence about the stars following it. `?rideSky` stays as what the toggle would turn. *M7, part C, with the resolution's control.*
- **A pan and a zoom on the axes:** M5's camera is space's, and a wheel or a drag on the landed layout does nothing. Zooming into a gap there is the natural ask, but the plot's ends would move: every tick, chip, and name of GPUI's would follow the scene's dots frame for frame (the two canvases in step, as nothing yet needs), and the count of rows in view would be counted again as it moves. *Not placed in a milestone yet; with a shape drawn in a against e.*
- **Touch:** one finger pans, two pinch to zoom and drag to tilt, as a map's do. gpui-pre-web hears touches; what it hands the surface isn't looked at yet. *M7, with the phone's answer.*
- **The storyboard's pictures of the opening are the level one's:** the opening is a pose again, rolled 34° (`docs/DECISIONS.md`, "Input", 2026-11-12, after M5 closed), and boards 1, 8, and 10 still draw the level shot of that morning, as do the screenshots M2 to M5's evidence links (history, left as taken; the corner's four were taken again). *The three boards' pictures are taken again when the storyboard is next redrawn, with boards 6 and 7: M7, part D.*
- **A slow turn of the belt until the first input:** an opening for a visitor who touches nothing. Against it: time already runs on load, so the picture already moves; and it is a camera nobody asked for (rule 6 is about tours, and this is near one). *Not planned.*
- **A shape drawn in a against e:** a shape is drawn in space only (the lasso's press there flies the dots back). Picking a gap's edge on the landed layout is the natural next ask. Left at M6's close (`docs/DECISIONS.md`, "Interface"): it shares its work with a pan and a zoom on the axes. *Not placed in a milestone.*
- **The live columns, by the owner's eye:** twice a second, one decimal while time runs and three once it holds still, and Jupiter's distance beside the Sun's, were chosen from the checks' numbers and screenshots (`docs/DECISIONS.md`, "Table"), not looked at moving. `?live=<a second>` and `?liveDecimals=<0 to 3>` are left to look with. *At the owner's next look.*
- **The diameter's arrow is eleven columns across:** the tour starts with a sideways scroll of the table to `diameter`, which nothing on the page points to. Whether the column moves forward (the table's columns are the sample's order with the live ones after the name), the table's `pin` holds the name while the rest scroll, or an action sorts for the visitor. *At the owner's next look.*
- **The biggest bodies aren't the belt's:** sorted by diameter the second and sixth rows orbit past Neptune (Varuna, 15789), and a press flies the camera 40 au out to a dot with nothing round it (`docs/seen/tour-second.jpg`). The catalog is JPL's whole list, and the table says so by holding them. Whether that flight is a delight or a wrong turn. *At the owner's next look.*
- **The columns' names are dim on any ground:** the tall table draws its header's names at 82 of 255, 2.5 to 1 on the opaque panel and 2.3 over the glass's head (`docs/DECISIONS.md`, "Table"). The color is the component's; whether it should be the muted foreground is a question for its own plan. *Not placed.*
- **A Worker of its own on the path:** whether a second Worker can take `/kirkwood/*` on a hostname bound to Tycho's as a custom domain. *M7, part A.*
- **The Milky Way as a band:** at G 10.5 the stars crowd toward it and no more; a band needs a deeper cut (3.1 M stars under G 12, about 25 MB). Whether it's worth its bytes. *Not planned.*
- **A phone:** whether the scene and a summoned table work at phone width, or the app says it's for a larger screen. The leaning (2026-11-12, not decided): no cut-down build. A phone gets a recording of the real app (the checks' own captures, looping, with its first frame as a still), a line saying Kirkwood is built for a larger screen, a way to send the link on (the share sheet, or a copy), and "Open it anyway", said to be slow. Chosen by what the page can ask before anything loads (a coarse pointer alone and a narrow window), in the page's own script, so a phone never asks for the wasm or the files unless it opens it anyway. To settle: whether "anyway" is safe at all with the page's memory (the question above), and the recording's bytes. A scroll through the boards isn't planned. *M7.*
