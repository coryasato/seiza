# <name>

<What it is, in two sentences. Component or engine (root `CLAUDE.md`, "Tiers").>

---

This is <name>'s context. Why it's built this way is in `docs/DECISIONS.md`; what it offers its users, in `README.md`. Its work is a milestone in its `PLAN.md` once it has a roadmap of its own (else in the app that drives it), its features' own costs measured in its `perf/results/`, and each app's budgets in that app. The repo-wide rules in the root `CLAUDE.md` apply here too. Paths below are relative to this directory.

Current state only: say what to do and point to the decision behind it (`docs/DECISIONS.md`, "<area>"); don't retell its measurements.

## Rules

These add to the repo-wide rules.

1. **No app knowledge and no `seiza` dependency.** Report what happened through events; the host turns them into panel rows and marks.
2. <Rule.>

## Architecture

<The modules and what each owns. The public API's shape: state entity, view, delegate trait (component); calls and their boundary (engine).>

## <Library> gotchas (check before debugging)

## Layout

```
<components|engines>/<name>/
  src/  Cargo.toml  # a component: the crate at this root
  crate/  web/      # an engine: the Rust client and/or the npm package
  docs/             # DECISIONS.md
  README.md         # for the crate's user
  CLAUDE.md         # this file
```

## Tests

```
cargo test -p seiza-<name>   # native tests
```
