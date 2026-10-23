# <name>

<!-- For a component (components/<name>/) or an engine (engines/<name>/). Written for someone using the crate or package, not for a visitor. Current state only. -->

<What it is, in two sentences: what it draws or serves, and for what kind of data.>

**Used by:** <the apps that build it, linked>. **Crate:** `seiza-<name>`. <**Package:** `@seiza/<name>`, for an engine with a JS side.>

## Use it

```rust
// The smallest working use: create the state, give it a source, render it.
```

<The delegate trait (a component's data source) or the calls (an engine's API), each with one line on what it's for.>

## Features

| Feature | What it adds | Cost (wasm, brotli) | Measured in |
|---|---|---|---|
| *(base)* | <what the base does> | — | <results note in the app that measured it> |

<A component's capabilities beyond its base are Cargo features, off by default (root `CLAUDE.md`, "Tiers"). An engine's adapters to components are features named for the component.>

## Limits

<What it doesn't handle, and the numbers where it stops (rows, bytes, memory), each linked to the measurement in the app that made it.>

## Canvas tradeoffs

<A component only (root rule 4): accessibility, text input and IME, selection and copy, Ctrl+F. Where it stands, what it does today, what closing the gap would take. An app's README links here for what is the component's.>

## Docs

| File | What's in it |
|---|---|
| [`CLAUDE.md`](CLAUDE.md) | Rules, architecture, gotchas. |
| [`docs/DECISIONS.md`](docs/DECISIONS.md) | Why it's built the way it is, by area. |
| [`PLAN.md`](PLAN.md) | <Once it has a roadmap: its features to come, in order, and the active milestone.> |

<Without a PLAN.md: "Its work is planned in the app that drives it."> Budgets are the apps' that build it; <with a PLAN.md: each feature's own cost is in [`perf/results/`](perf/results/)>.
