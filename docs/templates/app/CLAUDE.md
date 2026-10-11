# <App>

<What it is, in two sentences.>

---

This is <App>'s context. What's next is in `PLAN.md`; why things are built this way, in `docs/DECISIONS.md`; finished milestones, in `docs/milestones.md`; budgets, in `perf/budgets.json` (the root `CLAUDE.md`, "Docs: one home per fact", says what goes where). The repo-wide rules in the root `CLAUDE.md` apply here too. Paths below are relative to `apps/<app>/`.

Current state only: say what to do and point to the decision behind it (`docs/DECISIONS.md`, "<area>"); don't retell its measurements.

## <App> rules

These add to the repo-wide rules.

1. <Rule.>

## Stack

- **UI:** `shared/` (crate `seiza`) on the workspace's pinned `gpui-kit`.

## <Engine/library> gotchas (check before debugging)

## Perf script gotchas

## Layout

```
apps/<app>/
  crate/            # Rust (cdylib)
  web/              # Vite host
  worker/           # Cloudflare Worker + wrangler.toml
  perf/             # Playwright scripts, budgets.json, baseline.json, budget-notes.md, results/
  docs/             # DECISIONS.md, LESSONS.md, milestones.md, reference docs; private/ is gitignored
  README.md         # for visitors
  CLAUDE.md         # this file
  PLAN.md           # what's next
  justfile          # loaded from the root as the `<app>` module
```

## Commands

```
just <app> dev
just <app> build
just <app> check        # lint + release build + perf budgets
just <app> report       # regenerate the docs' numbers from perf/budgets.json and perf/results/
just <app> lint         # fmt, clippy, tsc, and `report --check`
```
