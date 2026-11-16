# PLAN.md — Kirkwood

What's next for Kirkwood: milestone status, the active milestone's "done when" checks, the milestones after it, long-term goals, and open questions. Only what's still open lives here. Context and rules are in `CLAUDE.md` here and at the repo root.

**Goal:** the asteroid belt as a scene to fly through, drawn from the asteroid table's own rows, with the table of those rows beside it, each moving the other. In a sentence a visitor could repeat: **every dot is a row.**

**No deciding metric:** Kirkwood is a showcase (root `CLAUDE.md`, "Tiers"), exempt from the budgets, the measurement protocol, and the results notes. It still paints something first and loads the scene after. A milestone's checks are things to see on screen; where a check asks for a number, the number is recorded with the decision it settles (`docs/DECISIONS.md`), not gated.

**Success:** someone with no astronomy stays two minutes, does one thing that delights them, and leaves knowing the table was real.

**Where everything else lives:**
- [`../../docs/research/asteroid-belt.md`](../../docs/research/asteroid-belt.md): the research: what the scene shows, what the table does, what's honest to simulate, the data it needs.
- [The storyboard](https://claude.ai/artifact/Vpx3w9Jb6EAW5RFJbLKKoi): eleven boards, the first seven reviewed 2026-11-10. Boards 2 to 5 were redrawn 2026-11-12 from the app as built (the release build's own scene, the interface over it where the code puts it), and still show the row of two actions; boards 1 and 6 to 10 are the release build's own window, taken 2026-11-15; board 11's preset isn't built, and it is still a drawing. Each milestone below names the boards it builds; the canvas's notes say which parts of them are placeholders, and what building changed.
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
| M7 | In the open: deployed under Tycho | Done 2026-11-15 ([`docs/milestones.md`](docs/milestones.md)) |

A milestone's spec, "done when" checks, and parts are written when the milestone before it closes, from what that one found. None is planned past M7: the app is in the open, and what's left is the open questions below.

**Closing a milestone:** every "done when" check passes, with its evidence (a screenshot, a recording, or a number) beside it; new decisions are in `docs/DECISIONS.md`; a `docs/LESSONS.md` entry is written; and the milestone's spec and evidence move from here to the end of `docs/milestones.md`, leaving one row above. No results note and no `report`: a showcase has no budgets.

**Waiting on** (features of a component or engine this app needs; only that crate's `PLAN.md` builds them, and the session that closes one flips its row to *Ready*):

| Needs | For | Status |
|---|---|---|
| The tall table reporting a press on a row whether or not its selection changed (`clicks`' `Press`, [its README](../../components/tall-table/README.md), "Presses": a double press's first press is a `Press`, so a second press within 400 ms is a `Double` the app can ignore) | The same row pressed again flies the camera back to it, after a pan let it go (`docs/DECISIONS.md`, "Interface") | *Ready* (2026-11-16, tall-table M16) |

Nothing else. The tall table's `sort`, `select`, `format`, and `density` are built and the app builds them (`live` it doesn't need: a live cell is worked out when it's drawn), and with the rows held in Rust a filter to a drawn group and a sort are both the delegate's work, an index it reads its pages through (`docs/DECISIONS.md`, "Table"). Nothing is asked of `engines/duckdb/`: the app doesn't use it.

---

## Active milestone

None. M7 closed 2026-11-15; the next milestone's spec, checks, and parts are written when it's chosen (the open questions below are where it would come from).

---

## Long-term goals

None committed (the research's "Extras"):

- A second coloring: by class, near-Earth, or potentially hazardous.
- Size by diameter.
- Earth's orbit drawn; an asteroid's whole orbit traced on a click.
- A search by name, and a date picker.
- Up close, the few bodies with real shapes (Ceres, Vesta) drawn as themselves; any other close-up rock is invented and labeled as illustration.

Rules from the `CLAUDE.md` files that a check could hold instead of a sentence (code, so each goes through review):

- **The page's background is the look's floor** (`web/CLAUDE.md`): a test that `index.html`'s `background` is `scene.ts`'s `PAGE`.
- **The checks' copies of the code's numbers** (`checks/CLAUDE.md`): `see.ts` importing `RIDE_NAMES` from `scene.ts`, and the table's column numbers (`DIAMETER`, `LIVE`) read from the crate through a hook, rather than holding copies.
- **Never type a tint, a group's bound, an axis's end, or a gap's place in `scene.ts` or `host.rs`** (`web/CLAUDE.md`, `crate/CLAUDE.md`): a lint over those files for literal au and e bounds and color literals.

## Open questions

- **The furniture's targets outlive it:** a published target (`__seizaTargets`) is never withdrawn, so after the dots fly back the chips', names', line's, and count's bounds still read as they were landed. Only scripts read them, and the checks that ask what's drawn do so on a fresh page. Whether `shared/`'s targets get a way to withdraw one, or the host publishes empty bounds when a piece isn't drawn. *Before a check needs it on a page that has landed.*
- **A found row riding with Jupiter, and on the axes:** a find lets both go (`docs/DECISIONS.md`, "Interface"), so a press on a Hilda's row while riding stops the ride, and a press on a row while the dots are landed takes the chart away. Kept through them, the mark and the follow would be drawn in the turning frame's camera and on the row's a and e. *Not placed in a milestone yet; with a shape drawn in a against e.*
- **The page's text arrives in pieces:** on a first load the lines at the top stagger in and grow as each part's state comes (the count as the belt fills, the stars' sentence with the sky, the legend), seen by the owner in Firefox and Safari (2026-11-15). Either each line eases in, or the lines hold their room from the first frame and what isn't known yet waits and comes in together: whichever costs the first paint nothing and moves nothing under it. *A session of its own, before or with part D.*
- **A group through the sort and the ride:** both let the group go. Kept through them, the gray would show where a drawn group lies in a against e, the natural next ask beside a shape drawn there. *Not placed in a milestone yet; with a shape drawn in a against e.*
- **The app at a phone's width, opened anyway:** it loads and runs on the owner's phone (Safari, 2026-11-15), but it is laid out for a wide window: upright, the row of actions runs under the compass and the ? button and the controls' list overlaps the bottom row ([seen](docs/seen/phone-anyway.jpg)); held sideways, the text panels cover buttons. What each piece does in a narrow or a short window (wrap, scroll, fold, or leave). *A session of its own.*
- **The phone's page wants a design:** it is text, five stills, and two buttons, built without a board ([seen](docs/seen/phone.jpg)); whether it shows stills or a recording is part of it (a video every phone plays wants an H.264 encoder, which the machine lacks, and would be more bytes: `docs/DECISIONS.md`, "Interface"). *A design session first, then a session to build it.*
- **A finger's reach on a dot:** a tap picks the dot within 6 px, the click's own reach, and a fingertip is several times that. Whether a touch gets a wider one. *Not placed: the owner's phone raised nothing about it.*
- **A pan and a zoom on the axes:** M5's camera is space's, and a wheel or a drag on the landed layout does nothing. Zooming into a gap there is the natural ask, but the plot's ends would move: every tick, chip, and name of GPUI's would follow the scene's dots frame for frame (the two canvases in step, as nothing yet needs), and the count of rows in view would be counted again as it moves. *Not placed in a milestone yet; with a shape drawn in a against e.*
- **A slow turn of the belt until the first input:** an opening for a visitor who touches nothing. Against it: time already runs on load, so the picture already moves; and it is a camera nobody asked for (rule 6 is about tours, and this is near one). *Not planned.*
- **A shape drawn in a against e:** a shape is drawn in space only (the lasso's press there flies the dots back). Picking a gap's edge on the landed layout is the natural next ask. Left at M6's close (`docs/DECISIONS.md`, "Interface"): it shares its work with a pan and a zoom on the axes. *Not placed in a milestone.*
- **The columns' names are dim on any ground:** the tall table draws its header's names at 82 of 255, 2.5 to 1 on the opaque panel and 2.3 over the glass's head (`docs/DECISIONS.md`, "Table"). The color is the component's; whether it should be the muted foreground is a question for its own plan. *Not placed.*
- **The Milky Way as a band:** at G 10.5 the stars crowd toward it and no more; a band needs a deeper cut (3.1 M stars under G 12, about 25 MB). Whether it's worth its bytes. *Not planned.*
