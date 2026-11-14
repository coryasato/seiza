# seiza (星座)

**seiza** (星座, "constellation") is a monorepo of heavy web apps built with GPUI (via GPUI Kit) compiled to WebAssembly and drawn on a canvas with WebGPU (WebGL2 where WebGPU isn't available). The apps share one Cargo workspace, one `gpui-kit` pin, and a common foundation crate (`shared/`). There are four kinds of thing here ("Tiers" below): utility apps people use, the observatory that compares their components with DOM equivalents, and the components and engines they're built from.

The goal of every app here is to show that **WebAssembly + GPU-rendered UI builds heavy web apps better than the DOM**. Every claim needs a number on screen to back it up.

This file holds the rules for every app. Each app has its own `apps/<app>/CLAUDE.md` (app context and rules) and `apps/<app>/PLAN.md` (what's next); both apply when working inside an app. Where every other kind of fact lives is under "Docs: one home per fact" below.

**Apps**
- `apps/tycho/`: Tycho, a local-first data workbench (DuckDB-Wasm + virtualized table). A utility app, at tycho.seiza.io.
- `apps/observatory/`: the Observatory, the comparison page (seiza.io/observatory). The page (the contender's window, its numbers, and its meter) and both contenders, live at seiza.io/observatory.
- `apps/kirkwood/`: Kirkwood, a showcase: the asteroid belt as a scene whose every dot is a row of the table beside it. Being built (the belt on its orbits with its look, its color, and its sky, the flight of its dots into orbit size against eccentricity and back, the frame that turns with Jupiter, a gap picked with its marker's path, a camera a hand pans, zooms, tilts, and turns, with a compass home and its controls listed, the table over every row, and a row of it found in the scene, its dot marked and flown to, a group drawn around in the scene, the table then its rows and the camera flown in to it, a dot clicked for its one row, and two columns of the table that move with the clock), for tycho.seiza.io/kirkwood.

The apex site (seiza.io: the observatory's page now, a landing page later) shares one shell, `site/ui/` (`.claude/rules/apex-site.md`).

---

## Repo-wide rules

1. **Time to first paint is the deciding metric.** Nothing may delay first paint: not engines, not data, not fonts beyond the one UI face. If a change adds bytes to an app's wasm, record its size effect in that app's `perf/results/` notes, not the commit message. A change to `shared/`, a component, or an engine affects every app that builds it, so record the effect for each one. Each app's `just <app> check` enforces its TTFP and wasm-size budgets and fails the build on a regression. Budgets live in that app's `perf/budgets.json` (every budget) and `perf/baseline.json` (the TTFP and wasm baselines `check` compares against). This rule gates every build, the observatory's contenders included; what the observatory's comparison headlines is per-use cost (`.claude/rules/comparison-protocol.md`).
2. **Paint first, load heavy things after.** Engines, workers, and datasets start loading after the first frame appears. The UI stays usable and says what's still loading.
3. **Measure before and after.** Every milestone ends with a measurement using the protocol below. The numbers go in `apps/<app>/perf/results/` (committed; large raw Playwright traces go in `perf/results/raw/`, which is gitignored) and a short note goes in `apps/<app>/docs/LESSONS.md`.
4. **Handle the canvas tradeoffs in the open** (a11y, IME, text selection, Ctrl+F, bundle size). When an app falls short on one, it says so in the UI or in its own `README.md` ("Canvas tradeoffs"). It never hides the gap.

## Where the detail is

The detail below the repo-wide rules sits beside the work it governs. A folder that only its own work needs has a `CLAUDE.md` of its own (Claude Code reads it in once any file under that folder is opened); a concern spanning several folders is a rule in `.claude/rules/`, read in once a file its `paths:` globs match is opened. Check the one that covers a change before making it, and give each new fact a single home, the file of what it is about.

| Folder or rule | What it is | Its file (loads on) |
|---|---|---|
| `shared/` | The `seiza` crate: the bootstrap and its order, the window root, the perf panel | `shared/CLAUDE.md` |
| `site/ui/` | The apex site's shell | `site/ui/CLAUDE.md` |
| `components/tall-table/` | The tall table, its bridge, its bare host | `components/tall-table/CLAUDE.md` |
| `engines/duckdb/` | The DuckDB-Wasm engine, crate and web | `engines/duckdb/CLAUDE.md` |
| `apps/<app>/` | Each app's context and rules, and its folders' files below it | `apps/<app>/CLAUDE.md` |
| The toolchain | Bumping the pins, the nightly, the release profile, `wasm-opt` | `.claude/rules/toolchain.md` (`Cargo.toml`, `Cargo.lock`, `rust-toolchain.toml`, a justfile) |
| GPUI Kit on the web | The gotchas to check before debugging, and where a workaround goes | `.claude/rules/gpui-web.md` (any `.rs`, a `Cargo.toml`, `shared-web/src/`, an app's `web/`, a host, the observatory's contenders) |
| The perf harness | `shared-web/perf/`'s helpers, and headless Chromium's DPR traps | `.claude/rules/perf-harness.md` (any `perf/`, Kirkwood's `checks/`) |
| Cloudflare | The gotchas every Worker meets | `.claude/rules/cloudflare.md` (a `worker/`, a `wrangler.toml`) |
| The apex site | seiza.io's pages, its shell, its theme and fonts | `.claude/rules/apex-site.md` (`site/`, the observatory's `web/` and `worker/`, Tycho's `web/`, `shared-web/`) |
| The comparison protocol | How the observatory compares a component with a DOM equivalent | `.claude/rules/comparison-protocol.md` (`apps/observatory/`, a component's `fixtures/`) |

A new app, component, or engine gets its own `CLAUDE.md` and a row here; so does a folder whose detail only its own work needs.

## When something outside a folder changes it

These rules are triggered by a change in one place but apply in another, which no nested file or rule would load in time:

- **An app's heavy load, its panel rows, its chrome, or its theme** goes through `seiza`'s API (the post-paint callback, `seiza::perf`, `Bootstrap`): read `shared/CLAUDE.md` before using it.
- **A change to a component's paging numbers or cell text, or to an engine's page SQL,** changes what both of the observatory's contenders must match: read `.claude/rules/comparison-protocol.md` first, and run `just observatory fixtures` after.
- **A bump of gpui-kit, React, TanStack Virtual, Arrow, DuckDB-Wasm, or Chromium** re-measures the observatory's scenarios it touches or labels their numbers with the versions they came from, decided per bump (`.claude/rules/comparison-protocol.md`).

## Tiers

The decisions behind these are in `docs/DECISIONS.md`, "Repo structure".

- **Components** (`components/<name>/`): generic UI libraries in the style of GPUI Kit's components: a view, a state entity, and a delegate trait for the data. Plain names (`tall-table`). A minimal base; every further capability (sorting, filtering, …) is a Cargo feature, off by default. A component knows no app and doesn't depend on `seiza`, so it stays publishable: it reports through events, and the host turns them into panel rows and marks.
- **Engines** (`engines/<name>/`, with `crate/` and/or `web/`): non-UI data layers that GPUI and DOM consumers share. An adapter between an engine and a component lives in the engine, behind an optional feature named for the component.
- **Utility apps** (`apps/<star>/`): tools people use, star-named, each on its own subdomain. They turn on component features as they need them, and usually get a feature first.
- **The observatory** (`apps/observatory/`): compares each component's base level, in a minimal GPUI host, with a 1:1 DOM equivalent, under the comparison protocol (`.claude/rules/comparison-protocol.md`). It only consumes components and engines: it may ask one to expose what its metrics need, but never to change how a utility app behaves, and a change to a component's internals for it stays small, defaults unchanged.
- **Dependencies run one way:** `shared/` ← components, engines ← apps. Code starts in an app and moves out once a second consumer needs it: foundation to `shared/`, UI to a component, a data layer to an engine. The first engine is `engines/duckdb/` and the first component `components/tall-table/`, both from Tycho.
- **A showcase** (`apps/kirkwood/`, being built: the belt on its orbits with its look and the table over its rows): an app for fun around the tall table, not a tool and not a comparison. The first is Kirkwood, the asteroid belt as a scene whose every dot is a row of the table beside it (its `PLAN.md`; the research, `docs/research/asteroid-belt.md`). It lives at a path on Tycho's subdomain (`docs/DECISIONS.md`, "Hosting"). A showcase is exempt from rule 1's budgets, rule 3, and the measurement protocol; it still paints something first and loads its heavy parts after (rule 2). Its scene may be JS (Three.js) with Rust as its engine. The decision: `docs/DECISIONS.md`, "Repo structure".
- **Build each wasm on its own** (`cargo build -p <crate>`). Cargo unifies features across the packages in one build, so a workspace-wide build would compile one app's features into another's. Clippy and tests may run workspace-wide.

## Stack and pins

- **UI:** `gpui-kit` (longbridge/gpui-kit), **pinned to an exact version** in the workspace `Cargo.toml` (0.9.1 was current on 2026-11-10). All apps use the same pin. Target `wasm32-unknown-unknown`.
- **JS host:** a thin Vite layer per app (`apps/<app>/web/`), built on `shared-web/`. Keep it thin: new logic goes in Rust unless it must touch a JS-only API. The exception, on purpose: the observatory's page and its DOM contenders are JS throughout (`docs/DECISIONS.md`, "Comparison protocol").
- **Headers everywhere, dev included:** `Cross-Origin-Opener-Policy: same-origin` and `Cross-Origin-Embedder-Policy: require-corp`. `shared-web/` provides the dev-server config so every app gets them from day one, and cross-origin problems show up early instead of at deploy.
- **Hosting:** Cloudflare Workers (static assets + R2 where needed), one Worker per app in `apps/<app>/worker/`. The observatory's data is a static asset, never R2. Each utility app has its own subdomain of seiza.io (a custom domain); the observatory lives at `seiza.io/observatory`, and the root is kept for a static landing page. The apex origin is shared, so nothing registers a service worker scoped to `/` (scope each to its own path). Every Worker that serves data sits behind the zone's WAF rules (dashboard settings; their text is in the gitignored `docs/private/zone.md`, kept out of the public repo) and honours the same pause switch; it widens those rules rather than adding its own. Decisions: `docs/DECISIONS.md`, "Hosting".
- **Never commit or print the account's default Workers hostname:** it names the account's owner. Apps run on a custom domain with `workers_dev = false` and `preview_urls = false`.

## `shared/` and `shared-web/` conventions

- Code goes in `shared/` only if it has no knowledge of any app: no DuckDB, no app types, no app strings. Apps depend on `shared/`, never the reverse.
- The page clock and `performance.mark`s go through `seiza::marks` (`now`, `mark`, `mark_at`, `mark_time`, `mark_after_current_task`); no crate that can depend on `seiza` keeps its own copy. A component or engine can't, so it reads the clock and its own JS side's marks itself and never sets a mark from Rust: the host marks from its events (`docs/DECISIONS.md`, "Repo structure"). A mark may be set more than once (a retry); readers take the **last** entry.
- Code starts in the app. Move it to `shared/` once it's clearly app-agnostic foundation; UI and data layers become a component or an engine instead ("Tiers"). Don't build abstractions for apps that don't exist yet.

## Repo layout

```
seiza/
  Cargo.toml            # workspace; pins gpui-kit; release profile
  Cargo.lock            # committed; pins the whole gpui family
  rust-toolchain.toml   # dated nightly + wasm32 target
  package.json          # npm workspaces: shared-web, site/*, engines/*/web, apps/*/web, the contenders' hosts, workers
  tsconfig.base.json    # strict TS settings every host extends
  .gitignore            # target/, node_modules/, .wrangler/, pkg/, dist/, per-app data/raw, generated data, perf/results/raw
  .claude/rules/        # the rules that span folders ("Where the detail is")
  shared/               # crate `seiza` (shared/CLAUDE.md)
  shared-web/           # reusable JS host bits: bootstrap.ts, vite.ts (COOP/COEP, preview brotli, serveDirs: a directory at a fixed path, serveFonts), font.ts (the fonts' fixed path, `/fonts/`), placeholder.ts (static shell before the wasm), prerender.ts (a page's first screen into its HTML at build), fonts/ (UI face + placeholder subset), scripts/ (asset-sizes.ts; report.ts and results.ts, its resolver of perf/budgets.json against perf/results/, which a page can import at build time), perf/ (the perf harness every app's scripts share)
  site/ui/              # `@seiza/site-ui`, the apex site's shell (site/ui/CLAUDE.md)
  components/tall-table/ # `seiza-tall-table` (components/tall-table/CLAUDE.md)
  engines/duckdb/       # DuckDB-Wasm, crate/ and web/ (engines/duckdb/CLAUDE.md)
  apps/observatory/     # the comparison page (apps/observatory/CLAUDE.md)
  apps/kirkwood/        # the showcase (apps/kirkwood/CLAUDE.md)
  apps/tycho/           # the data workbench (apps/tycho/CLAUDE.md)
  docs/
    DECISIONS.md        # repo-wide decisions, by area
    templates/app/      # the docs skeleton a new app starts from
    templates/component/ # the docs skeleton a new component or engine starts from
  CLAUDE.md             # this file: repo-wide rules
  justfile              # `just tycho dev`, `just tycho perf`, `just tall-table perf`, …
```

## Commands

Each app has its own justfile, loaded as a `just` module from the root, and so does a component with a host of its own:

```
just <app> <recipe>        # e.g. just tycho dev, just tycho perf
just tall-table <recipe>   # the tall table's bare host: build, size, perf (its CLAUDE.md)
just kirkwood <recipe>     # the showcase: dev, build, test, see, lint (no check, perf, or report)
```

Each app's recipes are listed in its CLAUDE.md. Every app but a showcase has `just <app> report`, which regenerates the numbers in its README, its PLAN.md, and the root README's apps table from `perf/budgets.json` and `perf/results/`.

## Measurement protocol

Every "done when" check that includes a number, in every app, uses this protocol.

- **Reference run:** Playwright with Chromium in headless=new mode, a cold cache, 1440×900 at DPR 2, **median of 10 runs**. Save the results with the date, the hardware (CPU model, OS), and a machine label. The repo is public, so never record hostnames, usernames, or home-directory paths; `perf.ts` uses the `SEIZA_MACHINE` label (default `local`).
- **Throttled run:** same setup with CPU 4× slowdown and "Fast 4G" network. Both runs are recorded, but budgets apply to the reference run.
- **First paint (TTFP):** from `performance.timeOrigin` to the first frame GPUI actually presents. `shared/` sets `performance.mark("gpui:first-frame")` in a microtask queued by the first render with a real viewport, so it lands right after the callback that draws and presents that frame. Tycho's `perf/perf.ts` checks this independently on every run: it hooks WebGL2 draw calls and WebGPU submits, and fails if the mark isn't right after a task that did GPU work. Don't use the browser's FP/FCP metrics, because the canvas makes them meaningless. If an app paints an HTML placeholder before the wasm arrives, TTFP still means GPUI's first frame; record the placeholder paint as its own metric.
- **Frame cost:** record per-frame work time (main-thread time spent in our frame: layout, drawing, GPUI present) next to rAF intervals. Intervals pin at the display's refresh period and can't show headroom.
- **Cross-browser check:** each milestone also gets a manual check in Firefox and Safari. Note any differences.
- **Budgets apply to the local release build only** (decided deploying Tycho). Runs against production (`--url`) record their numbers next to the local ones and never fail on a budget: the network, the CDN, and the edge cache upstream vary too much. Optimizing production is a goal for its own session, not a gate on a milestone.

## Docs: one home per fact

Each kind of fact has one home. Everywhere else links to it rather than repeating it: a number or a reason copied into a second file goes stale there.

| Kind of fact | Home | Rules |
|---|---|---|
| The app for a visitor | `apps/<app>/README.md` | Current state only. Numbers between `<!-- report:… -->` markers are generated; don't type them. Canvas tradeoffs and limits live here (rule 4). |
| A component or engine for its user | `components/<name>/README.md`, `engines/<name>/README.md` | Current state only: API, features, limits, canvas tradeoffs. Its rules and gotchas are in its `CLAUDE.md`, its decisions in its `docs/DECISIONS.md`. It has no budgets: each app gates its own builds. Once it has a roadmap of its own (the tall table does), it has the planning files below too, and a `perf/results/` for what it measures of itself (each feature's added bytes and frame work, in a bare host); until then its work is planned and measured in the app that drives it. |
| Rules, architecture, gotchas, commands | `CLAUDE.md` (root and app), a folder's own `CLAUDE.md` for what only work in that folder needs, and a rule in `.claude/rules/` (with `paths:`) for a concern that spans folders | Current state, no history. Say what to do and point to the decision behind it; don't retell the measurement. Claude Code loads a folder's `CLAUDE.md` only when a file in it is read, so a large app keeps its own file to its rules, a map of its folders, the rules whose cause lies outside any one folder, and a line per command, and each folder's architecture, gotchas, and commands go down into that folder's file (the observatory's are the model; the `split-claude-md` skill does the split and its audit). A fact lives in one of them, the folder it's about. |
| What's next | `apps/<app>/PLAN.md`, and a component's or engine's `PLAN.md` once it has a roadmap | Status table, the active milestone's "done when" checks, long-term goals, open questions. Nothing finished. A component's PLAN is the one list of its features: their order, specs, and checks. **Only the component's PLAN builds a feature,** whichever app asks for it. An app that needs one keeps a note in its PLAN's "Waiting on" table (the feature, what in the app waits on it, *Not ready* or *Ready*); the component's PLAN lists who waits on each feature ("Who's waiting"), and the session that closes the feature's milestone flips each waiting app's note to *Ready*. The app then adopts it (turns it on, wires it in, measures it against its budgets) in a milestone of its own that links to the spec and never restates it. |
| Why it's built this way | `docs/DECISIONS.md` (repo-wide) and `apps/<app>/docs/DECISIONS.md` | One bullet per decision under its area, oldest first: what, the numbers, *[source]*. Replaced decisions are marked *Superseded*, never deleted. A decision binding every app (toolchain, `shared/`, `shared-web/`, protocol) goes in the root file. |
| What surprised us | `apps/<app>/docs/LESSONS.md` (and a component's or engine's, with its PLAN) | One entry per milestone part (per milestone if it has one part): surprises only, plus a link to its results note. The numbers and the decisions have their own homes. |
| Finished milestones | `apps/<app>/docs/milestones.md` (and a component's or engine's, with its PLAN) | A milestone's spec, checks, and evidence move here when it closes. History: never edited. |
| Reference (data, hosting, …) | `apps/<app>/docs/<topic>.md` | How it works now; what every app shares in `docs/<topic>.md` (security-sensitive ones, like the zone's WAF rules, in the gitignored `docs/private/`). Research for a long-term goal goes in `docs/research/<goal>.md`. |
| Budgets | `apps/<app>/perf/budgets.json` | Every budget and recorded metric: its limit, whether `check` or the suite gates it, and which results file holds its current value. |
| Measurements | `apps/<app>/perf/results/` (and a component's, for its features' own costs) | Dated and append-only: a JSON per run (scripts write it), a note per milestone or experiment (`docs/templates/app/perf/results-note.md`). A metric's history is these files; no doc keeps a running "latest" list. |

Milestone IDs (`M<n>`, `part <X>`) belong only in `PLAN.md`, `milestones.md`, `LESSONS.md`, the *[source]* tags of `DECISIONS.md`, `perf/results/`, and commit messages. Code, `CLAUDE.md`, READMEs, and justfiles describe the current state without them: name the thing ("the fling budget"), not the milestone that built it. `shared-web/scripts/check-terms.ts`, run by `just <app> lint`, enforces it.

A new app starts from `docs/templates/app/`; a new component or engine, from `docs/templates/component/`. A directory is documented in the change that creates it, not before.

## Working agreements for Claude Code

- Work on one milestone at a time. A component's or engine's work is a milestone in its own `PLAN.md` when it has one, else in the app that drives it. A component measures what's its own (each feature's added wasm and frame work, in a bare host) in its own `perf/results/`; each app measures a feature against its own budgets when it adopts it, in its own `perf/`. Outside its own files, a component's milestone is named with the component ("tall-table M<n>"), and its commits start with its name (`tall-table: … (M<n>)`). At the start, restate the "done when" checks. At the end, show the evidence for each check (numbers, trace excerpts, screenshots).
- **Plan a milestone in parts, one session each.** When a milestone's spec and "done when" checks are written (after its research, if it has one), split the work into Part A, Part B, … in order, each one session's worth: what it builds and the checks it closes (A1, B1, …), with the research and spec as Part A when the milestone opens with research. Each part ends with its results note (if it measured) and a `docs/LESSONS.md` entry; the milestone closes after the last. A part that a measurement shows is needed (a fix, a path a check asked for) is specced and inserted before the close. The tall table's `docs/milestones.md` has worked examples.
- Keep JS small and typed. Any logic that could live in Rust lives in Rust (except in the observatory's page and DOM contenders, above).
- Before starting an app's next milestone, close the last one: its results note in `perf/results/`, new decisions in `docs/DECISIONS.md`, a `docs/LESSONS.md` entry (surprises), `just <app> report`, and its spec and evidence moved from `PLAN.md` to `docs/milestones.md`.
- Tick `PLAN.md`'s checks as they pass, with their evidence; log each decision in `docs/DECISIONS.md` as it lands.
- **Before any run expected to take over 20 minutes** (a perf suite, a measurement matrix, a size run with `--against`), stop and ask whether a code review will run first, **only if the session has changed code the review hasn't seen.** The user reviews every coding session's changes (`/code-review`), and a fix after the review would make the long run's numbers stale. A session that opens on reviewed code (a part that measures what an earlier part built) runs its long runs without asking, and asks only once it changes code. Tests, lint, and smoke checks don't need the question.
