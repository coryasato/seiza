# Tycho's data (`data/`)

The test files and their manifest. Claude Code loads this file when a file under `data/` is read. Tycho's rules and the map of its folders are in `apps/tycho/CLAUDE.md`, the repo's in the root `CLAUDE.md`; both apply here. Paths are relative to `apps/tycho/`.

- **The test files are built from the observatory's asteroid sample,** `apps/observatory/data/raw/asteroids/sbdb.parquet`, which `drop_files.ts` checks against the SHA-256 the observatory's `data/MANIFEST.json` pins before reading it. The observatory owns the sample's fetch and prep (its `data/CLAUDE.md`); a repin there changes these files too. Why a second reader: the observatory's `docs/DECISIONS.md`, "Data", 2026-11-23.
- Tycho serves no sample while it's rebuilt: production keeps the deployed one until the rebuild ships (`docs/DECISIONS.md`, "Hosting", 2026-11-23).

## Files

```
data/             # drop_files.ts (the test files), fixtures-src/ (tricky_rows.csv, hand-written), MANIFEST.json (committed: each test file's rows, bytes, SHA-256, source); fixtures/ and drop/ gitignored
```

## Commands

What each builds, and its flags, are in `data/drop_files.ts`'s header and the justfile's comment above its recipe.

```
just tycho drop-files [names] # the CSV fixture (fixtures/asteroids.csv) and the test files in data/drop/: ~55 GB in all, so pass names; needs `just observatory data --only asteroids` first
just tycho data-deps          # data/'s native DuckDB (its own lockfile; not an npm workspace, so `just setup` skips it)
```
