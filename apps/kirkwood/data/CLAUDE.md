# The data (`data/`)

The scripts that fetch the asteroid catalog and build the three files the app holds, and the checks of their places against JPL Horizons. Claude Code loads this file when a file under `data/` is read. Kirkwood's rules and the map of its folders are in `apps/kirkwood/CLAUDE.md`, the repo's in the root `CLAUDE.md`; both apply here. Paths are relative to `apps/kirkwood/`.

## Files

```
  data/             # fetch.ts (the asteroid catalog from JPL, every column at full precision, into raw/), survey.ts (what the fetch holds, and Tycho's sample against it), catalog.ts (the fetch as its readers take it: the rows in the files' order, every row at the one epoch, a designation packed, a place from six elements), elements.ts (the elements file's layout: its header, its blocks written and read back; free of Node; every script that reads the built file reads with it, the checks too), prep.ts (the two files the app holds, elements.bin and rows.bin, MANIFEST.json, which pins them, and fixture.json, a row for each of the files' rules with the fetch's cells, which the crate's readers are tested against), stars.ts (the sky's file, stars.bin, from Tycho's Gaia sample, and its entry in the manifest; needs native DuckDB, package.json's one dependency, installed apart), precision.ts (the elements' precision weighed: error against bytes), orbit.ts (the epoch, the clock's year, and a place from six elements) and jupiter.ts (Jupiter's orbit: its elements at the epoch and its own mean motion), both free of Node so a page can import them, horizons.ts (JPL Horizons' places for five known asteroids and Jupiter, into horizons.json), places.ts (the built files' places against Horizons', and the Trojans and the Hildas against Jupiter); raw/ and the three files are gitignored, the manifest, the fixture, and horizons.json committed; plain Node with no dependencies, but stars.ts
```

## Commands

The data's (also in `docs/data.md`):

```
node apps/kirkwood/data/fetch.ts [--refresh]             # the asteroid catalog from JPL into data/raw/asteroids/ (~3 min, once; a rerun reuses it, and the fetch date is part of the dataset, so don't refresh without a reason)
node --max-old-space-size=12000 apps/kirkwood/data/prep.ts [--check] [--sizes]   # data/elements.bin and data/rows.bin from the fetch, and data/MANIFEST.json; --check builds again and fails unless the bytes are the manifest's (a refresh, or a change to prep, is a new manifest: commit it with the change)
npm install --prefix apps/kirkwood/data                  # native DuckDB, for stars.ts alone (its own lockfile)
node apps/kirkwood/data/stars.ts <gaia-dr3-bright.parquet> [--check]   # data/stars.bin, the sky, from Tycho's Gaia sample (`just tycho data gaia` builds it; it must be the file Tycho's manifest pins), and its entry in data/MANIFEST.json; --check builds again and fails unless the bytes are the manifest's
node apps/kirkwood/data/places.ts [--date 2026-06-09] [--only bodies,jupiter,trojans,hildas]   # the built files' places against JPL Horizons' (data/horizons.json; horizons.ts fetches it), and the Trojans and Hildas against Jupiter
```
