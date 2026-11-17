# The bare host (`host/`)

The bare host of the table, crate and page. Claude Code loads this file when a file under `host/` is read. The table's rules and the map of its folders are in `components/tall-table/CLAUDE.md`, the repo's in the root `CLAUDE.md`; both apply here. Paths are relative to `components/tall-table/`.

## Architecture

`host/crate/` (package `tall-table-host`) and `host/web/` (`@seiza/tall-table-host`): where each feature's own cost is measured (`perf/CLAUDE.md`, "Measuring a feature"). Never deployed. The table alone over rows answered from memory (`rows.rs`: each value a function of its row and column, a page materialized when its read resolves, none for a read canceled before then, as the DuckDB source's Arrow pages are), on `seiza` without the panel, no engine. One Cargo feature per table feature, each switched on at run time by the URL; what each one reads from the URL and publishes is in `host/crate/src/lib.rs`'s doc comment, and each global's and hook's name is a constant in `host.rs` (most read by `perf/harness.ts`; grep `perf/` for one before renaming it). `host/web/src/main.ts` defines `__seizaFrameSample`. `just tall-table build <features>` records what it was built with, and the tree, in `host/web/dist/build.json`, which the scripts read.

## Rules

- **Nothing a perf run measures calls into JS more than the base does:** the drawn cells are published only with `?perf&probe-cells` (the smoke check's, never a perf run's, whose frames it would slow), and the source's read counts go on a global only for the features whose scripts read them (`follow`, `copy`), never with `sort` alone.
- **A hook or URL value is checked before it's sent:** the table's refusals are debug assertions, so the host sends only what the table accepts (`host/crate/src/lib.rs`).

## Gotchas

- **wasm-bindgen answers a closure's `None` as `undefined`,** not `null`: a hook that means `null` returns a `JsValue` (`__tallTableExact` does), or a script's NULL tests never match.

## Files

```
  host/             # the bare host: crate/ (tall-table-host: lib.rs, host.rs, rows.rs), web/ (Vite: index.html, src/main.ts, vite.config.ts; pkg/ and dist/ gitignored)
```

## Commands

```
just tall-table dev [features]   # the bare host: debug wasm + Vite dev server with COOP/COEP (its URL's switches: the justfile's comment)
just tall-table build [features] # its release build: wasm alone (-p) + wasm-opt, Vite build, asset sizes; the base without features
just tall-table preview      # serve that build (brotli)
```
