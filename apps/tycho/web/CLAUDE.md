# Tycho's JS host (`web/`)

The Vite host the wasm boots in. Claude Code loads this file when a file under `web/` is read. Tycho's rules and the map of its folders are in `apps/tycho/CLAUDE.md`, the repo's in the root `CLAUDE.md`; both apply here. Paths are relative to `apps/tycho/`.

## Architecture

- **JS host:** `web/` (Vite, built on `shared-web/` and `@seiza/duckdb`) holds `index.html`, `src/main.ts` (creates the bridge, imports the sample as a hashed asset, and boots the wasm with its URL), and `vite.config.ts` (the engine's `duckdb()` plugin, the placeholder, and the check that refuses a build or dev server without `data/gcat.parquet`, or with a file whose SHA-256 isn't `data/MANIFEST.json`'s). What goes in JS at all: the root `CLAUDE.md`, "Stack and pins".
- **Static placeholder shell:** `web/vite.config.ts` passes `shared-web`'s placeholder Tycho's first screen: its title bar (`titleBar`) and its empty state (`emptyState`): the heading, description, and "Engine loading…" as text, and the "Open a file…" and sample buttons as gpui-kit skeletons with GPUI's widths (99 and 350 px, read from `__seizaTargets` with `?bench`). The skeleton exists because GPUI draws glyphs differently from the browser and labels visibly jumped at the swap; don't turn it back into text. Change it with the GPUI side it matches, `render_empty` and the title bar (`crate/CLAUDE.md`), and compare the two by eye at DPR 2 and 1: no check compares them (`docs/DECISIONS.md`, "Perf tooling and budgets", 2026-11-23).

## Files

```
web/              # Vite host on @seiza/duckdb: index.html, src/main.ts, vite.config.ts; public/duckdb-ext/ is downloaded (gitignored)
```

## Commands

```
just tycho extensions   # download the DuckDB extensions the engine pins (engines/duckdb/web/duckdb-extensions.json) into web/public/duckdb-ext/; dev and build run it
```
