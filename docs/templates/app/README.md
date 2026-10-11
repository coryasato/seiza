# <App>

> *<One line in the voice of the app's namesake.>*

**Live at [<app>.seiza.io](https://<app>.seiza.io).**

<What it is in two sentences: what a visitor does with it, what runs where, what never leaves the tab.>

- **<Feature>:** <what it does, in one line>.

## Numbers

<!-- A dated snapshot from production may go here as a hand-written table, if it says when and how it was measured and links its results note. -->

### Local budgets

Budgets gate the local release build only. `just <app> check` enforces TTFP and wasm size on every build; the scripts named in [`PLAN.md`](PLAN.md#measurements) check the rest.

<!-- report:readme:start -->
<!-- report:readme:end -->

## How it works

<Five bullets at most: what loads before first paint and what after, the boundaries, the data path. Link `docs/DECISIONS.md` for the why.>

## Canvas tradeoffs

<Repo rule 4. For each of accessibility, text input and IME, selection and copy, Ctrl+F, and bundle size: where the app stands, what it does today, and what closing the gap would take.>

## Run it locally

Install the prerequisites in the [root README](../../README.md#getting-started) first. Then, from the repo root:

```sh
just <app> dev          # debug build + Vite with COOP/COEP
just <app> build        # release build; prints asset sizes
just <app> check        # lint, release build, TTFP and wasm-size budgets
```

`just --list <app>` lists every recipe; [`CLAUDE.md`](CLAUDE.md) describes each one.

## Docs

| File | What's in it |
|---|---|
| [`CLAUDE.md`](CLAUDE.md) | Rules, architecture, gotchas, every command. |
| [`PLAN.md`](PLAN.md) | What's next, and the measurements table. |
| [`docs/DECISIONS.md`](docs/DECISIONS.md) | Why it's built the way it is, by area. |
| [`docs/LESSONS.md`](docs/LESSONS.md) | What surprised us, milestone by milestone. |
| [`docs/milestones.md`](docs/milestones.md) | Finished milestones' specs and evidence. |
| [`perf/budgets.json`](perf/budgets.json), [`perf/results/`](perf/results/) | Every budget, and every measurement. |
