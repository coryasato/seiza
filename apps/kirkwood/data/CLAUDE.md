# The data (`data/`)

The scripts that fetch the asteroid catalog and the Gaia sample and build the three files the app holds, and the checks of their places against JPL Horizons. Claude Code loads this file when a file under `data/` is read. Kirkwood's rules and the map of its folders are in `apps/kirkwood/CLAUDE.md`, the repo's in the root `CLAUDE.md`; both apply here. Paths are relative to `apps/kirkwood/`. How the fetch and the files work, and every script's command: `docs/data.md`.

## Rules

- **The fetch date is part of the dataset:** don't `fetch.ts --refresh` without a reason. A refresh, or a change to `prep.ts`, is a new `MANIFEST.json`: commit it with the change (`prep.ts --check` fails unless the bytes are the manifest's).
- **`elements.ts` is the elements file's layout for every script,** the checks too, and is free of Node; so are `orbit.ts` and `jupiter.ts`, so a page can import them.
- **The Gaia sample is pinned like the files:** `gaia.ts` builds `gaia-dr3-bright.parquet` from the extracts in `raw/gaia/`, and `stars.ts` fails unless the sample is the file the manifest pins. Don't `gaia.ts --refresh` (~90 GB read) or move its cut, columns, or row groups, or `gaia.sql`'s metadata keys, without a reason: each is a new sample and a new `stars.bin` entry. `gaia.ts --check` rebuilds it from the extracts and fails unless the bytes are the same.
- **`gaia.ts` and `stars.ts` need native DuckDB,** `package.json`'s one dependency, installed apart (`npm install --prefix apps/kirkwood/data`; `just kirkwood gaia` does). Every other script is plain Node with no dependencies.
- **`horizons.json` pins what the places were compared with:** a refetch (`horizons.ts`) changes the reference, so not without a reason.

## Files

```
  data/             # raw/, the Gaia sample, and the three built files gitignored; MANIFEST.json, fixture.json, horizons.json committed
    fetch.ts        #   the catalog from JPL, at full precision, into raw/
    survey.ts       #   what the fetch holds
    catalog.ts      #   the fetch as its readers take it
    elements.ts     #   the elements file's layout: its header, its blocks written and read back
    prep.ts         #   elements.bin, rows.bin, MANIFEST.json, fixture.json (the crate's readers are tested against it)
    gaia.ts, gaia.sql   # the Gaia sample, gaia-dr3-bright.parquet, from AWS Open Data through raw/gaia/, and its manifest entry
    stars.ts        #   stars.bin, the sky, from the Gaia sample, and its manifest entry
    precision.ts    #   the elements' precision weighed: error against bytes
    orbit.ts, jupiter.ts   # the epoch, the clock's year, a place from six elements; Jupiter's orbit
    horizons.ts     #   Horizons' places for five asteroids and Jupiter, into horizons.json
    places.ts       #   the built files' places against Horizons', and the Trojans and Hildas against Jupiter
```

## Commands

From the repo root: `node apps/kirkwood/data/<script>.ts`, each with its flags in `docs/data.md`, "Commands". The usual order: `fetch.ts` (once, ~3 min), `prep.ts` (with `--max-old-space-size=12000`), then `just kirkwood gaia` (the Gaia sample, then the sky).
