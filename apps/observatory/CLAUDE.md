# Observatory

The Observatory is seiza's comparison page, at `seiza.io/observatory`: it runs each component against a DOM equivalent, one at a time, on the same engine and data, and measures what each costs over a session of use. The first comparison is GPUI | TanStack: the tall table (`components/tall-table/`) against React + TanStack Virtual.

---

This is the Observatory's context. What's next is in `PLAN.md`; why things are built this way, in `docs/DECISIONS.md` (repo-wide decisions, the comparison protocol's above all, in the root `docs/DECISIONS.md`); finished milestones, in `docs/milestones.md`; budgets, in `perf/budgets.json` (the root `CLAUDE.md`, "Docs: one home per fact", says what goes where). The repo-wide rules in the root `CLAUDE.md` apply here too, its "Comparison protocol" first. Paths below are relative to `apps/observatory/`.

Current state only: say what to do and point to the decision behind it; don't retell its measurements.

## Observatory rules

These add to the repo-wide rules.

1. **Consume, don't reshape.** The observatory uses components and engines as they are. It may ask one to expose what its metrics need, or to take an option a host sets; it never changes how a utility app behaves, and every such change records its effect on each app that builds it (root `CLAUDE.md`, "Tiers").
2. **Everything lives under `/observatory/`** (`contenders/paths.ts`, the one list of paths). The apex origin is shared with the landing page and future pages: the page (`/observatory/`, `/observatory/<component>/`), the contenders (`/observatory/contenders/<component>/<stack>/`, each its build's base), the engine (`/observatory/duckdb/`, outside the contenders' bases: `@seiza/duckdb`'s `extensionDir` `duckdb` under `extensionBase` `/observatory/`), and the data (`/observatory/data/`) are served under it, and nothing registers a service worker outside it. The one exception is the site's: the font at `/fonts/` (root `CLAUDE.md`, "The apex site").
3. **The page is JS; the contenders are what they compare.** The page and the DOM contenders are JS throughout, on purpose (root `CLAUDE.md`, "Stack and pins"). The GPUI contender is a minimal Rust host of the component.

## Where the detail is

Each folder's architecture, gotchas, and commands are in its own `CLAUDE.md`, which Claude Code loads when a file in that folder is read. Read the folder's file before changing anything in it, and put a new fact in the file of the folder it's about: a fact stated in two of them drifts.

| Folder | What it is | Its file |
|---|---|---|
| `web/` | The page: the routes, the dashboard, the contender's window and its status bar, the panel, the meter, the cold numbers' virtual modules | `web/CLAUDE.md` |
| `contenders/` | What both contenders share: the scenarios (`scenarios.ts`, the one list), the levels, the paths, the contract, the feeds, the fonts, the engine's and the data's serving | `contenders/CLAUDE.md` |
| `contenders/tall-table/gpui/` | The GPUI contender: the bare Rust host of the tall table, a build per level | `contenders/tall-table/gpui/CLAUDE.md` |
| `contenders/tall-table/tanstack/` | The TanStack contender: React and TanStack Virtual, a build per level, the table's logic ported | `contenders/tall-table/tanstack/CLAUDE.md` |
| `metrics/` | The one module that computes every metric | `metrics/CLAUDE.md` |
| `perf/` | Every check and measurement script, the perf gotchas, a line per check (what each covers: its header and the justfile) | `perf/CLAUDE.md` |
| `data/` | The six data files, their prep and pins | `data/CLAUDE.md` |
| `worker/` | Hosting: the Worker on seiza.io, staging, the deploy | `worker/CLAUDE.md` |

A second component's contenders go in `contenders/<component>/<stack>/`, each with its own `CLAUDE.md`, and get a row here.

## When something outside a folder changes it

Rules whose cause is elsewhere, so no folder's file would be read in time:

- **A gpui-kit bump** regenerates the TanStack contender's theme (`just observatory theme-css`; `contenders/tall-table/tanstack/CLAUDE.md`), and whether it re-measures the scenarios is decided per bump (root `CLAUDE.md`, "Comparison protocol").
- **A change to the UI font (`shared-web/fonts/`) or the tall table's cell text** regenerates `cells.json`'s drawn cells (`just observatory cell-fixture`), then `cargo test -p seiza-tall-table`. A data file's change says so in `data/CLAUDE.md`.
- **A new path outside `/observatory/` and `/fonts/`** goes into the seiza.io WAF rule before it deploys (its text in the gitignored root `docs/private/zone.md`).
- **A number on the page or in a doc** is never typed: the page's are resolved at build time (`web/CLAUDE.md`, `cold.ts`), the docs' by `just observatory report`.

## Layout

```
apps/observatory/
  web/              # the page (web/CLAUDE.md)
  metrics/          # metrics.ts (metrics/CLAUDE.md)
  contenders/       # shared by the contenders; tall-table/gpui/ and tall-table/tanstack/, each with its CLAUDE.md
  worker/           # the Cloudflare Worker (worker/CLAUDE.md)
  data/             # the data files' prep, MANIFEST.json (data/CLAUDE.md)
  perf/             # checks and measurements, budgets.json, baseline.json, results/ (perf/CLAUDE.md)
  docs/             # DECISIONS.md, LESSONS.md, milestones.md, dom-scroll-model.md (the TanStack contender's scroll model), contender-contract.md (what each contender publishes, how each metric is read), research/ (scenarios.md: the research the scenarios were built from)
  README.md         # for visitors
  CLAUDE.md         # this file
  PLAN.md           # what's next
  justfile          # loaded from the root as the `observatory` module; each recipe's comment says what it does
```

## Commands

One line each; a recipe's flags and what a check covers are in its folder's `CLAUDE.md` (in brackets) and in the justfile's comment above it.

```
just observatory dev | build | preview         # the page: dev server, release build, serve the build as deployed (web)
just observatory gpui-dev | gpui-build | gpui-preview [level]          # the GPUI contender at a level (gpui)
just observatory tanstack-dev | tanstack-build | tanstack-preview [level] # the TanStack contender at a level (tanstack)
just observatory theme-css [--check]           # the TanStack contender's theme from gpui-kit's (tanstack)
just observatory script-fonts                  # the admin table's Noto faces, by their pins (contenders)
just observatory fixtures                      # the tall table's and the feeds' fixtures on both sides (contenders)
just observatory data [flags]                  # the six data files and MANIFEST.json (data)
just observatory deploy | worker-check [flags] # build, stage, deploy seiza.io; production against the staged build (worker)
just observatory page | cold | placeholder | sizes | gpui-parts | engine-files | reach [flags]       # the page's and the contenders' load, size, and contract checks (perf)
just observatory tanstack-view | tanstack-parity | tanstack-contract | tanstack-sizes [flags]       # the TanStack contender's checks (perf)
just observatory wide | market | tail | wall | admin [flags]          # each level's checks, both sides (perf)
just observatory metric <name> | ab | cell-fixture | readout-cost | burst | session-memory | data-read [flags] # measurements (perf)
just observatory builds        # every contender build, each level each side builds (`contenders/scenarios.ts`'s `BUILT`, by `contenders/built.ts`), then the page's
just observatory check         # lint + builds + sizes --check (the panel and home paths, each level's wasm and its Cargo features, the table's and the bridge's exactly `LEVEL_FEATURES`) + tanstack-sizes --check (each TanStack level's) + cold --level <level> --check for each GPUI level (reference TTFP and wasm against perf/baseline.json, each level's own) + wide + market + tail + wall + admin + placeholder (each GPUI level) + reach + engine-files --controls + tanstack-view --gpui + tanstack-contract + tanstack-parity + page --check (the page's budgets and hosting) + fixtures
just observatory report        # regenerate the docs' numbers from perf/budgets.json and perf/results/
just observatory lint          # check-terms, `report --check`, fmt, `theme-css --check`, clippy (the GPUI contender, wasm32 and native), the site's grays (`web/scripts/grays.ts`), tsc (site/ui, web, both contenders' hosts and the TanStack contender's tests, worker, perf, data)
```
