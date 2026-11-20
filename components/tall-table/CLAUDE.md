# tall-table

A GPUI table that reads rows a page at a time from a delegate and draws only where the viewport is, at row counts past what f32 pixels can scroll. A component (root `CLAUDE.md`, "Tiers"), crate `seiza-tall-table`.

---

This is the table's context; the root `CLAUDE.md`'s rules apply too. Why it's built this way is in `docs/DECISIONS.md` ("Table and paging", "Component API", "Features"); what it offers its users, in `README.md`; its features, in order, and the active milestone, in `PLAN.md`. Each feature's own cost (added wasm, frame work) is measured in the bare host and recorded in `perf/results/`, without budgets: those are the apps' that build it (Tycho, which adopts every feature; the observatory, which adds a feature level once both its sides are built). Paths below are relative to this directory.

## Rules

These add to the repo-wide rules.

1. **No app knowledge and no `seiza` dependency.** The crate depends on `gpui-kit` alone; the bridge and the bare host (`bridge/`, `host/`) are host-side crates, never its dependencies. Report what happened through `TallTableEvent`s; the host turns them into panel rows, marks, and published probes. What only a host knows comes in as settings: `Paging`, `ActivityOptions` (its clock, its window, and when to record), `probe_frames`, `probe_cells`.
2. **A frame never waits on data.** Rows whose page isn't loaded draw as placeholders; nothing in render awaits the delegate.
3. **Don't swap in gpui-kit's `DataTable`** without re-reading `docs/DECISIONS.md`, "Table and paging": its `uniform_list` places rows in f32 pixels and loses precision past ~16 M px.
4. **Events that mark a frame are emitted in render.** `Filled` (and `live`'s `Refreshed`, `follow`'s `TailDrawn`) is emitted while the frame renders, which GPUI delivers in the task that presents it (`App::update` flushes effects after the draw and present), so a host's `mark_after_current_task` lands right after the frame. Don't move it to a deferred or spawned emit. Tycho's `just tycho table --browsers` checks the marks land in the presenting task (`shared-web/perf/`'s `presentedMark`).
5. **A change to the paging is soaked before its code review.** A change to `pages.rs`, the state's paging (`load_wanted`, `page_done`, `set_rows`, `close`, the scroll and drag settles, `follow`'s tail pin (`pin_to_tail`; not `pin`, the columns' feature)), or `copy`'s reads runs `just tall-table soak` (minutes, not a run to ask about) before `/code-review`, and again if the review's fixes touch the paging. A failure is handled as the random test's are (`src/state/CLAUDE.md`). Why: `docs/DECISIONS.md`, "Fixtures".

**Features** (`Cargo.toml`, each off by default): code behind one is `#[cfg(feature = "…")]`, and the base build must not change with it off (`just tall-table size` checks its symbols are absent; how a site is written once for both builds: `src/CLAUDE.md`). A change that adds or moves a `cfg` naming two features runs `just tall-table pairs` before its code review: `test` and `lint` build a feature alone, none, and all, never a pair. The bridge and the host forward each one (`tall-table-host/custom-cells` turns on the table's and the bridge's). A theme color a feature draws comes in as a `Stop` (`fn(&Theme) -> Hsla`), resolved each frame, never stored in a page.

## Where the detail is

Each folder's architecture, gotchas, and commands are in its own `CLAUDE.md`, which Claude Code loads when a file in that folder is read (a nested folder's parents load with it). Read the folder's file before changing anything in it, and put a new fact in the file of the folder it's about.

| Folder | What it is | Its file |
|---|---|---|
| `src/` | The crate: the state entity, the element, the delegate, the page cache, the cells, and each feature's pure half; the crate's GPUI gotchas | `src/CLAUDE.md` |
| `src/state/` | Each feature's half of the state, and the random test of the paging | `src/state/CLAUDE.md` |
| `src/state/fixtures/` | The fixtures' window tests, a file a feature | `src/state/fixtures/CLAUDE.md` |
| `fixtures/` | What a DOM contender must match, and where each fixture comes from | `fixtures/CLAUDE.md` |
| `bridge/` | `tall-table-bridge`: the events → a seiza host's marks, globals, and clipboard | `bridge/CLAUDE.md` |
| `host/` | The bare host: the table over rows from memory, each feature's run-time switch and hooks | `host/CLAUDE.md` |
| `perf/` | Every check and measurement on the bare host, the fixture writers, the perf gotchas | `perf/CLAUDE.md` |

A new feature's state child goes in `src/state/`, its window test in `src/state/fixtures/`, each a line in that folder's file.

## When something outside a folder changes it

Rules whose cause is elsewhere, so no folder's file would be read in time:

- **A change to the table's paging, cell text, or page SQL** (in `src/`; the page SQL's side is `engines/duckdb/CLAUDE.md`'s) fails the fixtures (`fixtures/CLAUDE.md`): update the fixture in the same change (and so every DOM contender's tests). The root `CLAUDE.md` says what to run after.

## Layout

```
components/tall-table/
  src/              # the crate (src/CLAUDE.md); state/ (src/state/CLAUDE.md), state/fixtures/ (src/state/fixtures/CLAUDE.md)
  fixtures/         # the fixtures and their formats (fixtures/CLAUDE.md)
  Cargo.toml        # seiza-tall-table: gpui-kit only (dev: gpui-kit's test-support, futures, serde_json, cosmic-text); features, each off by default
  bridge/           # tall-table-bridge (bridge/CLAUDE.md)
  host/             # the bare host (host/CLAUDE.md)
  perf/             # checks, measurements, fixture writers; results/ (perf/CLAUDE.md)
  docs/             # DECISIONS.md, milestones.md, LESSONS.md
  PLAN.md           # its features to come, in order; the active milestone
  README.md         # for the crate's user
  CLAUDE.md         # this file
  justfile          # loaded from the root as the `tall-table` module
```

## Commands

One line each; a recipe's flags and what a check covers are in the justfile's comment above it and its script's header (its folder in brackets).

```
just tall-table dev | build | preview [features]   # the bare host: dev server, release build, serve the build (host)
just tall-table size | perf | live | copy | follow | sort | find [flags]   # each feature's cost in the bare host (perf)
just tall-table late --builds <name>,<name> [flags]   # a fling's late frames by cause, kept builds side by side (perf)
just tall-table smoke [flags] | smoke --screens save|<commit>       # the release build in three browsers; the reference screens (perf)
just tall-table paint-fixture | density-fixture | format-fixture [--check]   # the fixtures read from Chromium (perf)
just tall-table soak [seeds] [cases]               # the random test soaked (src/state)
just tall-table pairs [--list] [--only clippy|test|doc] [--from <n>]   # every feature alone and every pair: clippy for the table, the bridge, and the host, the tests on the pairs with code gated on both, and the table's rustdoc, its links checked (perf/pairs.ts)
cargo test -p seiza-tall-table   # the native tests at the features given (the fixtures and the random test among them)
just tall-table test         # those with every feature off, each on, then all on, and the host's rows and feed (the bridge's JS is wasm-only; Tycho's checks and the cell fixture read its fields)
just tall-table lint         # check-terms, fmt, clippy (the table, the bridge, the host; wasm32 and native, with no feature and with every one: `pairs` builds what's between), the table's rustdoc with none and every one, tsc (the host's page, perf/)
```

The view also runs in Tycho's checks (`just tycho table`, `jump`, `cells`, `errors`, and the suite's table and jump parts).
