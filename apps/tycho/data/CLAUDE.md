# Tycho's data (`data/`)

The sample's build, the test files, and their manifest. Claude Code loads this file when a file under `data/` is read. Tycho's rules and the map of its folders are in `apps/tycho/CLAUDE.md`, the repo's in the root `CLAUDE.md`; both apply here. Paths are relative to `apps/tycho/`.

- **The test files are built from the observatory's asteroid sample,** `apps/observatory/data/raw/asteroids/sbdb.parquet`, which `drop_files.ts` checks against the SHA-256 the observatory's `data/MANIFEST.json` pins before reading it. The observatory owns the sample's fetch and prep (its `data/CLAUDE.md`); a repin there changes these files too. Why a second reader: the observatory's `docs/DECISIONS.md`, "Data", 2026-11-23.
- **The sample, `gcat.parquet`, is built here from GCAT** (`gcat.ts`; what it holds and how: `docs/data.md`; its spec: the root `docs/research/tycho-sample.md`). It's gitignored, and `web/vite.config.ts` refuses a build without it or with bytes `MANIFEST.json` doesn't record, so a change to the build is a rerun of `just tycho data`, whose new entry is committed with it. A code GCAT adds fails the build: give it a word in `gcat-codes.ts` from the GCAT page its table links. A new date form: `gcat-dates.ts`, with a test.

## Files

```
data/             # gcat.ts (the sample's build) with gcat-dates.ts (+ .test.ts) and gcat-codes.ts; drop_files.ts (the test files), fixtures-src/ (tricky_rows.csv, hand-written), MANIFEST.json (committed: each file's rows, bytes, SHA-256, source); gcat.parquet, raw/, fixtures/, and drop/ gitignored
```

## Commands

What each builds, and its flags, are in its script's header (`data/gcat.ts`, `data/drop_files.ts`) and the justfile's comment above its recipe.

```
just tycho data [--refresh]   # the sample, data/gcat.parquet, and its MANIFEST.json entry; GCAT's files are reused from data/raw/gcat/ unless --refresh
just tycho drop-files [names] # the CSV fixture (fixtures/asteroids.csv) and the test files in data/drop/: ~55 GB in all, so pass names; needs `just observatory data --only asteroids` first
just tycho data-deps          # data/'s native DuckDB (its own lockfile; not an npm workspace, so `just setup` skips it)
```
