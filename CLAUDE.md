# seiza (星座)

**seiza** (星座, "constellation") is a monorepo of heavy web apps built with GPUI (via GPUI Kit), compiled to WebAssembly and drawn on a canvas with WebGPU (WebGL2 where WebGPU isn't available). The apps share one Cargo workspace, one `gpui-kit` pin, and a foundation crate (`shared/`). The goal of every app here is to show that **WebAssembly + GPU-rendered UI builds heavy web apps better than the DOM**: the canvas for the GPUI components, the heavy parts; the DOM where text lives (entry, selection, Ctrl+F, screen readers, agents). Every claim needs a number on screen to back it up, and the observatory is where they're measured.

This file holds the rules for every app. Each app's own `apps/<app>/CLAUDE.md` (its context and rules) and `PLAN.md` (what's next) apply when working inside it. Where every other kind of fact lives is in "Docs: one home per fact" below.

**Apps**
- `apps/tycho/`: Tycho, a local-first data workbench (DuckDB-Wasm + the tall table on the canvas, the rest of the page in the DOM), being rebuilt. A utility app, at tycho.seiza.io.
- `apps/observatory/`: the Observatory, the comparison page and both its contenders, at seiza.io/observatory.
- `apps/kirkwood/`: Kirkwood, a showcase: the asteroid belt as a scene whose every dot is a row of the table beside it, at tycho.seiza.io/kirkwood.

The apex site (seiza.io: the observatory's page now, a landing page later) shares one shell, `site/ui/` (`.claude/rules/apex-site.md`).

---

## Repo-wide rules

1. **Time to first paint is the deciding metric.** Nothing may delay first paint: not engines, not data, not fonts beyond the one UI face. A change that adds bytes to an app's wasm records its size effect in that app's `perf/results/` notes, not the commit message; a change to `shared/`, a component, or an engine records it for every app that builds it. Each measured app's `just <app> check` fails on a TTFP or wasm-size regression (Tycho's, on the wasm's size alone: below the rules): its budgets are in `perf/budgets.json`, the baselines `check` compares against in `perf/baseline.json`. This gates every build, the observatory's contenders included; what the observatory's comparison headlines is per-use cost (`.claude/rules/comparison-protocol.md`).
2. **Paint first, load heavy things after.** Engines, workers, and datasets start loading after the first frame appears. The UI stays usable and says what's still loading.
3. **Measure before and after.** Every milestone ends with a measurement under the protocol below. The numbers go in `apps/<app>/perf/results/` (committed; raw Playwright traces in the gitignored `perf/results/raw/`) and a short note in `apps/<app>/docs/LESSONS.md`.
4. **Handle the canvas tradeoffs in the open** (a11y, IME, text selection, Ctrl+F, bundle size). When an app falls short on one, it says so in the UI or in its own `README.md` ("Canvas tradeoffs"). It never hides the gap.

**Tycho is exempt from rules 1 and 3 and the measurement protocol,** as a showcase is: its job is to be useful, and the observatory is where GPUI is measured. Rules 2 and 4 bind it (its smoke check fails a request that starts before first paint), and its `check` gates the wasm's size alone, with no time-to-first-paint gate (`docs/DECISIONS.md`, "Measurement protocol", 2026-11-17).

## Where the detail is

A folder's own `CLAUDE.md` loads when a file in that folder is read ("Repo layout" names each top-level one, and an app's maps its own folders'); a rule in `.claude/rules/` loads when a file its `paths:` match is read. Check the one that covers a change before making it, and give each new fact one home, the file of what it's about. A new app, component, or engine gets its own `CLAUDE.md` and a line in "Repo layout"; a folder whose detail only its own work needs gets one too, named in its app's map; a concern that spans folders gets a rule and a row here.

| Rule | What it is | Loads on |
|---|---|---|
| `.claude/rules/toolchain.md` | Bumping the pins, the nightly, the release profile, `wasm-opt` | `Cargo.toml`, `Cargo.lock`, `rust-toolchain.toml`, a justfile |
| `.claude/rules/gpui-web.md` | GPUI Kit's web gotchas, to check before debugging, and where a workaround goes | any `.rs`, a `Cargo.toml`, `shared-web/src/`, an app's `web/`, a host, the observatory's contenders |
| `.claude/rules/perf-harness.md` | `shared-web/perf/`'s helpers, headless Chromium's DPR traps, and the traps every app's scripts meet (WebKit's clicks, the placeholder's fade, the panel, an A/B's worktree) | any `perf/`, Kirkwood's `checks/` |
| `.claude/rules/cloudflare.md` | The gotchas every Worker meets | a `worker/`, a `wrangler.toml` |
| `.claude/rules/apex-site.md` | seiza.io's pages, its shell, its theme and fonts | `site/`, the observatory's `web/` and `worker/`, Tycho's `web/`, `shared-web/` |
| `.claude/rules/comparison-protocol.md` | How the observatory compares a component with a DOM equivalent | `apps/observatory/`, a component's `fixtures/` |

## When something outside a folder changes it

These rules are triggered by a change in one place but apply in another, which no nested file or rule would load in time:

- **An app's heavy load, its panel rows, its chrome, or its theme** goes through `seiza`'s API (the post-paint callback, `seiza::perf`, `Bootstrap`): read `shared/CLAUDE.md` before using it.
- **A change to a component's paging numbers or cell text, or to an engine's page SQL,** changes what both of the observatory's contenders must match: read `.claude/rules/comparison-protocol.md` first, and run `just observatory fixtures` after.
- **A bump of gpui-kit, React, TanStack Virtual, Arrow, DuckDB-Wasm, or Chromium** re-measures the observatory's scenarios it touches or labels their numbers with the versions they came from, decided per bump (`.claude/rules/comparison-protocol.md`).
- **A change to how the tall table paints with `tokens.background`** (`components/tall-table/src/paint.rs`, `text_over`) is read against Kirkwood's transparent background (`apps/kirkwood/crate/CLAUDE.md`, "The transparent `tokens.background`").

## Tiers

The decisions behind these are in `docs/DECISIONS.md`, "Repo structure".

- **Components** (`components/<name>/`): generic UI libraries in the style of GPUI Kit's components: a view, a state entity, and a delegate trait for the data. Plain names (`tall-table`). A minimal base; every further capability (sorting, filtering, …) is a Cargo feature, off by default. A component knows no app and doesn't depend on `seiza`, so it stays publishable: it reports through events, and the host turns them into panel rows and marks.
- **Engines** (`engines/<name>/`, with `crate/` and/or `web/`): non-UI data layers that GPUI and DOM consumers share. An adapter between an engine and a component lives in the engine, behind an optional feature named for the component.
- **Utility apps** (`apps/<star>/`): tools people use, star-named, each on its own subdomain. They turn on component features as they need them, and usually get a feature first.
- **The observatory** (`apps/observatory/`): compares each component's base level, in a minimal GPUI host, with a 1:1 DOM equivalent (`.claude/rules/comparison-protocol.md`). It only consumes components and engines: it may ask one to expose what its metrics need, but never to change how a utility app behaves, and a change to a component's internals for it stays small, defaults unchanged.
- **A showcase** (`apps/kirkwood/`): an app for fun around the tall table, not a tool and not a comparison, at a path on Tycho's subdomain (`docs/DECISIONS.md`, "Hosting"); the first is Kirkwood (its `PLAN.md`; the research, `docs/research/asteroid-belt.md`). It's exempt from rule 1's budgets, rule 3, and the measurement protocol; it still paints something first and loads its heavy parts after (rule 2). Its scene may be JS (Three.js) with Rust as its engine.
- **Dependencies run one way:** `shared/` ← components, engines ← apps. Code starts in an app and moves out once a second consumer needs it: foundation to `shared/`, UI to a component, a data layer to an engine. Don't build abstractions for apps that don't exist yet. Code goes in `shared/` only if it knows no app: no DuckDB, no app types, no app strings.
- **Build each wasm on its own** (`cargo build -p <crate>`). Cargo unifies features across the packages in one build, so a workspace-wide build would compile one app's features into another's. Clippy and tests may run workspace-wide.

## Stack and pins

- **UI:** `gpui-kit` (longbridge/gpui-kit), **pinned to an exact version** in the workspace `Cargo.toml`, one pin for every app (bumping it: `.claude/rules/toolchain.md`). Target `wasm32-unknown-unknown`.
- **JS host:** a thin, typed Vite layer per app (`apps/<app>/web/`), built on `shared-web/`. New logic goes in Rust unless it must touch a JS-only API. The exception, on purpose: the observatory's page and its DOM contenders are JS throughout (`docs/DECISIONS.md`, "Comparison protocol").
- **Headers everywhere, dev included:** `Cross-Origin-Opener-Policy: same-origin` and `Cross-Origin-Embedder-Policy: require-corp`. `shared-web/`'s dev-server config gives every app them from day one, so cross-origin problems show up early instead of at deploy.
- **Hosting:** Cloudflare Workers (static assets + R2 where needed), one Worker per app in `apps/<app>/worker/`. The observatory's data is a static asset, never R2. Each utility app has its own subdomain of seiza.io; the observatory lives at `seiza.io/observatory`, and the root is kept for a landing page. The apex origin is shared, so nothing registers a service worker scoped to `/` (scope each to its own path). Every Worker that serves data sits behind the zone's WAF rules (their text in the gitignored `docs/private/zone.md`) and honors the same pause switch; it widens those rules rather than adding its own. Decisions: `docs/DECISIONS.md`, "Hosting".
- **Never commit or print the account's default Workers hostname:** it names the account's owner. Apps run on a custom domain with `workers_dev = false` and `preview_urls = false`.

## Marks

The page clock and `performance.mark`s go through `seiza::marks` (`now`, `mark`, `mark_at`, `mark_time`, `mark_after_current_task`); no crate that can depend on `seiza` keeps its own copy. A component or engine can't, so it reads the clock and its own JS side's marks itself and never sets a mark from Rust: the host marks from its events (`docs/DECISIONS.md`, "Repo structure"). A mark may be set more than once (a retry); readers take the **last** entry.

## Repo layout

```
seiza/
  Cargo.toml            # workspace; pins gpui-kit; release profile
  Cargo.lock            # committed; pins the whole gpui family
  rust-toolchain.toml   # dated nightly + wasm32 target
  package.json          # npm workspaces: shared-web, site/*, engines/*/web, apps/*/web, the contenders' hosts, workers
  tsconfig.base.json    # strict TS settings every host extends
  .claude/rules/        # the rules that span folders ("Where the detail is")
  .claude/skills/       # milestone (open, plan in parts, close), split-claude-md
  shared/               # crate `seiza`: bootstrap, window root, perf panel, marks (shared/CLAUDE.md)
  shared-web/           # the JS hosts' shared half: bootstrap, Vite config (COOP/COEP, the fonts at `/fonts/`), the placeholder shell, prerender, fonts/, scripts/ (asset sizes, the report, check-terms), perf/ (the harness)
  site/ui/              # `@seiza/site-ui`, the apex site's shell (site/ui/CLAUDE.md)
  components/tall-table/ # `seiza-tall-table` (components/tall-table/CLAUDE.md)
  engines/duckdb/       # DuckDB-Wasm, crate/ and web/ (engines/duckdb/CLAUDE.md)
  apps/observatory/     # the comparison page (apps/observatory/CLAUDE.md)
  apps/kirkwood/        # the showcase (apps/kirkwood/CLAUDE.md)
  apps/tycho/           # the data workbench (apps/tycho/CLAUDE.md)
  docs/                 # DECISIONS.md (repo-wide, by area), templates/app/ and templates/component/ (the docs a new one starts from), research/, private/ (gitignored)
  justfile              # loads each app's and component's justfile as a module
```

## Commands

```
just <app> <recipe>        # e.g. just tycho dev, just observatory check; each app's recipes are in its CLAUDE.md
just tall-table <recipe>   # the tall table's bare host: build, size, perf (its CLAUDE.md)
just kirkwood <recipe>     # the showcase: dev, build, worker, deploy, deployed, test, see, lint (no check, perf, or report)
just <app> report          # every app but a showcase and Tycho: the numbers in its README, its PLAN.md, and the root README's headlines, from perf/budgets.json and perf/results/
```

## Measurement protocol

Every "done when" check that includes a number, in every app, uses this protocol.

- **Reference run:** Playwright with Chromium in headless=new mode, a cold cache, 1440×900 at DPR 2, **median of 10 runs**. Save the results with the date, the hardware (CPU model, OS), and a machine label. The repo is public, so never record hostnames, usernames, or home-directory paths; results carry the `SEIZA_MACHINE` label (default `local`).
- **Throttled run:** same setup with CPU 4× slowdown and "Fast 4G" network. Both runs are recorded, but budgets apply to the reference run.
- **First paint (TTFP):** from `performance.timeOrigin` to the first frame GPUI actually presents, which `shared/` marks `gpui:first-frame` in a microtask queued by the first render with a real viewport, right after the callback that draws and presents it. Every script that times TTFP checks the mark against the GPU calls (`shared-web/perf/`'s `firstDrawProbe`) and fails if it isn't right after a task that did GPU work. Don't use the browser's FP/FCP: the canvas makes them meaningless. An HTML placeholder before the wasm doesn't change what TTFP means; record its paint as its own metric.
- **Frame cost:** record per-frame work time (main-thread time spent in our frame: layout, drawing, GPUI present) next to rAF intervals. Intervals pin at the display's refresh period and can't show headroom.
- **Cross-browser check:** each milestone also gets a manual check in Firefox and Safari. Note any differences.
- **Budgets apply to the local release build only.** Runs against production (`--url`) record their numbers next to the local ones and never fail on a budget: the network, the CDN, and the edge cache vary too much. Optimizing production is a goal for its own session, not a gate on a milestone.

## Docs: one home per fact

Each kind of fact has one home. Everywhere else links to it rather than repeating it: a number or a reason copied into a second file goes stale there.

| Kind of fact | Home | Rules |
|---|---|---|
| The app for a visitor | `apps/<app>/README.md` | Current state only. Numbers between `<!-- report:… -->` markers are generated; don't type them. Canvas tradeoffs and limits live here (rule 4). |
| A component or engine for its user | `components/<name>/README.md`, `engines/<name>/README.md` | Current state only: API, features, limits, canvas tradeoffs. No budgets: each app gates its own builds. Once it has a roadmap of its own (the tall table does), it has the planning files below and a `perf/results/` for what it measures of itself (each feature's added bytes and frame work, in a bare host); until then its work is planned and measured in the app that drives it. |
| Rules, architecture, gotchas, commands | the root's and each app's `CLAUDE.md`, a folder's own `CLAUDE.md`, and `.claude/rules/` ("Where the detail is") | Current state, no history. Say what to do and point to the decision behind it; don't retell the measurement. A fact lives in the one file whose folder or `paths:` it's about. A file that has outgrown its load is split and condensed with the `split-claude-md` skill (the observatory's files are the model). |
| What's next | `apps/<app>/PLAN.md`, and a component's or engine's `PLAN.md` once it has a roadmap | Status table, the active milestone's "done when" checks, long-term goals, open questions. Nothing finished. A component's PLAN is the one list of its features: their order, specs, and checks. **Only the component's PLAN builds a feature,** whichever app asks for it: an app that needs one keeps a row in its PLAN's "Waiting on" table (*Not ready* or *Ready*), the component's PLAN lists who's waiting, and the app adopts the feature in a milestone of its own that links to the spec and never restates it. |
| Why it's built this way | `docs/DECISIONS.md` (repo-wide) and `apps/<app>/docs/DECISIONS.md` | One bullet per decision under its area, oldest first: what, the numbers, *[source]*. Replaced decisions are marked *Superseded*, never deleted. A decision binding every app (toolchain, `shared/`, `shared-web/`, protocol) goes in the root file. |
| What surprised us | `apps/<app>/docs/LESSONS.md` (and a component's or engine's, with its PLAN) | One entry per milestone part (per milestone if it has one part): surprises only, plus a link to its results note. |
| Finished milestones | `apps/<app>/docs/milestones.md` (and a component's or engine's, with its PLAN) | A milestone's spec, checks, and evidence move here when it closes. History: never edited. |
| Reference (data, hosting, …) | `apps/<app>/docs/<topic>.md` | How it works now; what every app shares in `docs/<topic>.md` (security-sensitive ones, like the zone's WAF rules, in the gitignored `docs/private/`). Research for a long-term goal goes in `docs/research/<goal>.md`. |
| Budgets | `apps/<app>/perf/budgets.json` | Every budget and recorded metric: its limit, whether `check` or the suite gates it, and which results file holds its current value. |
| Measurements | `apps/<app>/perf/results/` (and a component's, for its features' own costs) | Dated and append-only: a JSON per run (scripts write it), a note per milestone or experiment (`docs/templates/app/perf/results-note.md`). A metric's history is these files; no doc keeps a running "latest" list. |

Milestone IDs (`M<n>`, `part <X>`) belong only in `PLAN.md`, `milestones.md`, `LESSONS.md`, the *[source]* tags of `DECISIONS.md`, `perf/results/`, and commit messages. Everywhere else names the thing ("the fling budget"), not the milestone that built it; `shared-web/scripts/check-terms.ts` (`just <app> lint`) enforces it.

A new app starts from `docs/templates/app/`; a new component or engine, from `docs/templates/component/`. A directory is documented in the change that creates it, not before.

## Working agreements for Claude Code

- **One milestone at a time.** At its start, restate its "done when" checks; at its end, show the evidence for each (numbers, trace excerpts, screenshots). Planning it in parts (one session each), naming a component's milestones and commits, and closing it before the next one starts: the `milestone` skill.
- Tick `PLAN.md`'s checks as they pass, with their evidence; log each decision in `docs/DECISIONS.md` as it lands.
- **Before any run expected to take over 20 minutes** (a perf suite, a measurement matrix, a size run with `--against`), stop and ask whether a code review will run first, **only if the session has changed code the review hasn't seen.** The user reviews every coding session's changes (`/code-review`), and a fix after the review would make the long run's numbers stale. A session that opens on reviewed code (a part that measures what an earlier part built) runs its long runs without asking, and asks only once it changes code. Tests, lint, and smoke checks don't need the question.
