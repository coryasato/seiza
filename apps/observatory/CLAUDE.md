# Observatory

The Observatory is seiza's comparison page, at `seiza.io/observatory`: it runs each component against a DOM equivalent, one at a time, on the same engine and data, and measures what each costs over a session of use. The first comparison is GPUI | TanStack: the tall table (`components/tall-table/`) against React + TanStack Virtual.

---

This is the Observatory's context. What's next is in `PLAN.md`; why things are built this way, in `docs/DECISIONS.md` (repo-wide decisions, the comparison protocol's above all, in the root `docs/DECISIONS.md`); finished milestones, in `docs/milestones.md`; budgets, in `perf/budgets.json` (the root `CLAUDE.md`, "Docs: one home per fact", says what goes where). The repo-wide rules in the root `CLAUDE.md` apply here too, its "Comparison protocol" first. Paths below are relative to `apps/observatory/`.

Current state only: say what to do and point to the decision behind it; don't retell its measurements.

## Observatory rules

These add to the repo-wide rules.

1. **Consume, don't reshape.** The observatory uses components and engines as they are. It may ask one to expose what its metrics need, or to take an option a host sets; it never changes how a utility app behaves, and every such change records its effect on each app that builds it (root `CLAUDE.md`, "Tiers").
2. **Everything lives under `/observatory/`.** The apex origin is shared with the landing page and future pages: the page, the contenders, the engine (`/observatory/duckdb/`: `@seiza/duckdb`'s `extensionDir` set to `duckdb` under the base), and the data are served under it, and nothing registers a service worker outside it.
3. **The page is JS; the contenders are what they compare.** The page and the DOM contenders are JS throughout, on purpose (root `CLAUDE.md`, "Stack and pins"). The GPUI contender is a minimal Rust host of the component.

## Stack

- **JS host:** `web/` (Vite on `shared-web/`: COOP/COEP in dev and preview, `base: '/observatory/'`). Today a static page saying the Observatory is coming.

## Layout

```
apps/observatory/
  web/              # Vite host for the page, served under /observatory/
  perf/             # budgets.json
  docs/             # DECISIONS.md, LESSONS.md, milestones.md
  README.md         # for visitors
  CLAUDE.md         # this file
  PLAN.md           # what's next
  justfile          # loaded from the root as the `observatory` module
```

## Commands

```
just observatory dev      # the page's Vite dev server, with COOP/COEP
just observatory report   # regenerate the docs' numbers from perf/budgets.json and perf/results/
just observatory lint     # check-terms, `report --check`, tsc
```
