# Tycho's data (`data/`)

The samples, their prep, and the test files. Claude Code loads this file when a file under `data/` is read. Tycho's rules and the map of its folders are in `apps/tycho/CLAUDE.md`, the repo's in the root `CLAUDE.md`; both apply here. Paths are relative to `apps/tycho/`.

## Files

```
data/             # fetch_asteroids.ts, fetch_gaia.ts, prep.sql + prep-gaia.sql + prep.ts (native DuckDB), drop_files.ts (test files), fixtures-src/, MANIFEST.json (committed); raw/, drop/, bench/, + generated data gitignored
```

## Commands

What each builds, and its flags, are in its script's header (`data/prep.ts`, `data/drop_files.ts`) and the justfile's comment above its recipe.

```
just tycho data [--refresh]   # the asteroid catalog → asteroids.parquet, the CSV fixture, MANIFEST.json, into local R2
just tycho data gaia [flags]  # Gaia DR3's bright stars → gaia-dr3-bright.parquet + MANIFEST.json, into local R2 (--cut, --bench)
just tycho data-deps          # data/'s native DuckDB (its own lockfile; not an npm workspace, so `just setup` skips it)
just tycho drop-files [names] # the test files in data/drop/ (gitignored): ~55 GB in all, so pass names
```

`just tycho data` needs network once (the JPL API; Gaia: AWS Open Data, whose cost is in `docs/data.md`, and the ESA archive's count for the cut); after that it reuses `data/raw/`. `wrangler dev` keeps the local R2 it fills under `worker/.wrangler/state/` (gitignored).
