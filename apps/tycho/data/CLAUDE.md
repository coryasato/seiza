# Tycho's data (`data/`)

The samples, their prep, and the test files. Claude Code loads this file when a file under `data/` is read. Tycho's rules and the map of its folders are in `apps/tycho/CLAUDE.md`, the repo's in the root `CLAUDE.md`; both apply here. Paths are relative to `apps/tycho/`.

## Files

```
data/             # fetch_asteroids.ts, fetch_gaia.ts, prep.sql + prep-gaia.sql + prep.ts (native DuckDB), drop_files.ts (test files), fixtures-src/, MANIFEST.json (committed); raw/, drop/, bench/, + generated data gitignored
```

## Commands

```
just tycho data [--refresh] # fetch the asteroid catalog once (data/raw/), prep.sql → asteroids.parquet + CSV fixture + MANIFEST.json, load it into local R2
just tycho data gaia [flags] # fetch Gaia DR3's G < 15 stars once (~90 GB read from AWS Open Data, ~50 min; data/raw/gaia/, 2.3 GB), prep-gaia.sql → gaia-dr3-bright.parquet (G < 14.5, 25,067,889 rows, 1.5 GB) + MANIFEST.json, load it into local R2 (--cut, --bench 30720,61440: row-group variants in data/bench/, --refresh, --jobs)
just tycho data-deps    # install data/'s native DuckDB (its own lockfile; not an npm workspace, so `just setup` skips it)
just tycho drop-files [names] # test files in data/drop/ (gitignored): asteroids.parquet ×3 (~108 MiB) and ×27 (~970 MiB; also at 122,880- and 1,048,576-row groups), the CSV fixture ×6 (~1 GB); the size ceiling: Parquet ×60/×120/×130/×270 (2–9.6 GB), CSV ×12/×24/×30/×48/×60 (2–10.7 GB), and random-hex.csv (4.6 GB, compresses badly); cell overflow: overflow.parquet (2,000 rows too wide for their columns); ~55 GB in all, so pass names; recorded in MANIFEST.json
```

`just tycho data` needs network once (the JPL API, ~2.5 min; Gaia: AWS Open Data, ~50 min, and the ESA archive's count for the cut); after that it reuses `data/raw/`. `wrangler dev` keeps the local R2 it fills under `worker/.wrangler/state/` (gitignored).
