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
| M8 | A subdomain of its own: `kirkwood.seiza.io` | Active: opened 2026-11-23, in two parts (below); part A done 2026-11-23 |

A milestone's spec, "done when" checks, and parts are written when the milestone before it closes, from what that one found. M8 was specced from an open question when Tycho's rebuild made the move a deadline; what's left after it is the open questions below.

**Closing a milestone:** every "done when" check passes, with its evidence (a screenshot, a recording, or a number) beside it; new decisions are in `docs/DECISIONS.md`; a `docs/LESSONS.md` entry is written; and the milestone's spec and evidence move from here to the end of `docs/milestones.md`, leaving one row above. No results note and no `report`: a showcase has no budgets.

**Waiting on** (features of a component or engine this app needs; only that crate's `PLAN.md` builds them, and the session that closes one flips its row to *Ready*):

| Needs | For | Status |
|---|---|---|
| The tall table reporting a press on a row whether or not its selection changed (`clicks`' `Press`, [its README](../../components/tall-table/README.md), "Presses": a double press's first press is a `Press`, so a second press within 400 ms is a `Double` the app can ignore) | The same row pressed again flies the camera back to it, after a pan let it go (`docs/DECISIONS.md`, "Interface") | *Ready* (2026-11-16, tall-table M16) |

Nothing else. The tall table's `sort`, `select`, `format`, and `density` are built and the app builds them (`live` it doesn't need: a live cell is worked out when it's drawn), and with the rows held in Rust a filter to a drawn group and a sort are both the delegate's work, an index it reads its pages through (`docs/DECISIONS.md`, "Table"). Nothing is asked of `engines/duckdb/`: the app doesn't use it.

---

## Active milestone: M8, a subdomain of its own

Opened 2026-11-23 and planned in two parts, one session each. **It must land before Tycho's rebuild is deployed** (Tycho's PLAN, "Ship the rebuild").

**Why** (root `docs/DECISIONS.md`, "Hosting", 2026-11-23): Tycho is being rebuilt as a public tool with a connection policy and views saved in the browser, and an origin shared with a showcase ties each app's policy, storage, pause switch, and deploys to the other's. Kirkwood moves from `tycho.seiza.io/kirkwood` to **`kirkwood.seiza.io`**, and the 2026-11-10 decision that put it under Tycho is marked *Superseded* when this closes.

**What moves.** The page is built at `/`, not `/kirkwood/` (`web/src/base.ts`'s `BASE`, which the build, the Worker, and the checks read). The Worker (`kirkwood`) serves the new hostname as a custom domain, as Tycho's does, with the same bucket and objects: nothing is put again. The hint's fold is a key in `localStorage`, and a new origin starts without it: a visitor who folded the hint sees it once more, which is fine.

**What stays at the old address.** `tycho.seiza.io/kirkwood` and every path under it answer a 301 to the same path on the new host, the query kept (`/kirkwood/?roll=0` to `/?roll=0`), for as long as Tycho's hostname is ours: links to the old address are in the open. Which piece answers it is part A's decision: the `kirkwood` Worker keeping its old route and answering only redirects there, or a redirect rule in the zone with no Worker at all. The lean is the zone's rule, which leaves nothing of Kirkwood's running on Tycho's hostname when Tycho's rebuild deploys.

**Its own switch and guards.** `just kirkwood pause` and `resume` set its Worker's `DATA_PAUSED`, and `just tycho pause` goes back to Tycho's Worker alone. The new hostname gets its own rows in the zone's WAF rules (the path allowlist and the rate limit; their text in the gitignored root `docs/private/zone.md`) before the deploy; Tycho's rule keeps the old paths only as far as the redirect needs them.

**Left out:** any change to what the page shows, and the bucket's name (`kirkwood-data` never named Tycho).

**Split into parts,** one session each:

- **Part A: the code, local.** The redirect's place decided; the base at `/`; the Worker on its custom domain in `wrangler.toml`; its own pause recipe; the Worker's tests, the checks, and the deploy's check (`worker/scripts/check.ts`) for the new host and the redirect. Closes A1 to A4. Nothing deployed.
- **Part B: in the open, and the close.** The WAF's rows, the deploy, the redirect and the guards checked in production, a security look and the rate limit right after, every doc that gives the address, and the close. Closes B1 to B5. *The owner sets the zone's rules and confirms the deploy.* A part that runs `see --worker` whole (about 30 minutes) asks first whether a code review runs before it (root `CLAUDE.md`, "Working agreements").

**Done when:**

- [x] **A1. The redirect's place is decided:** the zone's redirect rule or the Worker's old route, written in `docs/DECISIONS.md`, "Hosting", with what each leaves on Tycho's hostname and what Tycho's rebuild must keep for it. *The zone's rule (`docs/DECISIONS.md`, "Hosting", 2026-11-23): Single Redirects run before the WAF's rules and any Worker, so nothing of Kirkwood's stays on Tycho's hostname; the Worker answers the old paths 404 (its unit tests), and `worker/scripts/check.ts` checks the 301s against production (B3). That the old paths need no row in Tycho's allowlist is confirmed when the rule is set (B1).*
- [x] **A2. The build runs at the root behind the Worker:** `BASE` is `/`; `just kirkwood worker` serves the release build at `http://127.0.0.1:8788/`; `just kirkwood see --worker` passes; nothing under `/kirkwood/` is asked for. The Worker's unit tests cover the new paths (and, if the Worker answers it, the redirect: the path and the query kept, a 301). *2026-11-23, on the reviewed code: `see --worker` whole passed every part from `paint` through `sort`, then stopped in `ride` on the clock's end (`checks/CLAUDE.md`'s busy-machine gotcha, `"ended":true`); `ride` alone passed, and `gap` through `phone` passed. `paint` (base `/`) fails on any request off the origin or under `/kirkwood`, and found none. The local Worker: `/` and `/?roll=0` 200; `/kirkwood`, `/kirkwood/`, `/kirkwood/?roll=0`, `//index.html`, `/data/put.json` 404; POST 405. The Worker answers no redirect (the zone does, A1); its 12 unit tests cover the page at the root and the old paths' 404s.*
- [x] **A3. The switch is Kirkwood's own:** `just kirkwood pause` and `resume` set its Worker's secret alone, and `just tycho pause` Tycho's alone; `see --only paused` passes behind the local Worker. *`just --dry-run`: `kirkwood pause` runs `wrangler secret put DATA_PAUSED` in `apps/kirkwood/worker` alone, `tycho pause` in `apps/tycho/worker` alone (neither run against production). `see --only paused`: first frame 563 ms, told "The data is paused for now: try again later.", 0 bytes held, `elements.bin 503`, `stars.bin 503`, at the Worker's root.*
- [x] **A4. `just kirkwood lint` and `just kirkwood test` pass.** *2026-11-23: lint clean; the crate's 77 tests (the ignored ones included) and the Worker's 12.*
- [ ] **B1. The guards are in place before the deploy:** the new hostname's rows in the zone's WAF rules and its rate limit (`docs/private/zone.md` updated), and the old paths still allowed as far as the redirect needs.
- [ ] **B2. It's deployed:** `kirkwood.seiza.io` opens, and `just kirkwood deployed` passes against it whole (every file the page asks for, COOP and COEP, the encodings and bytes, the WAF's 403s, the pause's 503).
- [ ] **B3. The old address redirects:** `tycho.seiza.io/kirkwood`, `/kirkwood/`, `/kirkwood/?roll=0`, and a path under it each answer a 301 to the same place on the new host; Tycho's own pages are as they were (`just tycho check`, and Tycho's check against production).
- [ ] **B4. The Worker is sound on its new host:** a security review of what changed (`/security-review`), probes in production (paths outside its own, other methods, the old hostname's paths), and the rate limit looked at against a visit's requests; each finding fixed or written down.
- [ ] **B5. The docs give the new address:** every file that names `tycho.seiza.io/kirkwood` or the `/kirkwood/` base (the root `CLAUDE.md` and README, `.claude/rules/`, Kirkwood's `CLAUDE.md` files, README, `docs/`, Tycho's `docs/hosting.md` and justfile), the redirect excepted; history (`docs/milestones.md`, `LESSONS.md`, the decisions' text) left as written. The root decision of 2026-11-10 marked *Superseded*; Tycho's PLAN's "Ship the rebuild" and its open question 3 no longer wait on Kirkwood.

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
