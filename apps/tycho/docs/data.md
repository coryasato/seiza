# Sample data

Tycho's two samples, where they come from, and how `just tycho data` builds them. Paths are relative to `apps/tycho/`. Why each choice was made is in [`DECISIONS.md`](DECISIONS.md), "Sample data".

**Decided 2026-09-22.** Both datasets are space-themed: asteroids are the default, and Gaia stars are the big one. Both are re-hosted on our origin.

## Default: every known asteroid (NASA/JPL Small-Body Database)

- **Rows:** about 1.5 million: every asteroid with a known orbit. Confirm the count with `just tycho data`, since Rubin discoveries grow it every day.
- **Source:** the JPL SBDB Query API (`ssd-api.jpl.nasa.gov/sbdb_query.api`), which returns JSON (`fields` + `data` arrays). `data/fetch_asteroids.ts` (run by Node directly, like the `perf/` scripts) pulls the full catalog in pages (`limit` / `limit-from`) and writes raw JSON. `prep.sql` then turns that into Parquet. Record the fetch date. The catalog can change between pages, so dedupe on `spkid`.
- **Columns:** `full_name`, `pdes`, `name`, `neo`, `pha`, `class`, `H`, `diameter`, `albedo`, `a`, `e`, `i`, `q`, `per_y`, `first_obs`, `last_obs`, `n_obs_used`, plus `spkid` as the key. Many physical fields are null, which is realistic and a good test of how the table renders nulls.
- **Sort:** by `spkid`, so row 1 is **(1) Ceres**, then Pallas, Juno, Vesta… Scrolling top to bottom goes from the oldest discoveries to last week's.
- **Credit in the UI:** "Asteroid data: NASA/JPL Small-Body Database, fetched <date>."

## Big: Gaia DR3 stars (ESA)

- **Rows:** a slice of Gaia DR3's ~1.8 billion sources. Target **~25 million rows**, then tune after M7 measures the ceiling. Pick the cut by brightness (`phot_g_mean_mag < X`) and choose X in `prep.sql` to hit the target. *M7 part B:* **G < 14.5, 25,067,889 stars** (the ESA archive's count, which prep checks); `prep.ts`'s `--cut` moves it without a refetch, down from G < 15 (36.9 M).
- **Source:** Gaia DR3 as HATS-partitioned Parquet on AWS Open Data (`s3://stpubdata/gaia/`, us-east-1, no AWS account needed). Read it with native DuckDB (`@duckdb/node-api`, `httpfs`, anonymous S3) and push the filter down. *M7 part B:* the pushdown can't skip data. The 2,016 partitions are sorted by `source_id`, so every row group holds every magnitude, and the fetch reads the ten columns of all 1.8 billion rows (~90 GB, ~50 min at 8 jobs). `fetch_gaia.ts` keeps one extract per partition (G < 15, 2.3 GB) in `data/raw/gaia/`, so a rerun or a new cut reads nothing. Two partitions hold 17,842 identical duplicate rows at G < 14.5; prep drops them.
- **Columns:** `source_id`, `ra`, `dec`, `parallax`, `distance_pc` (1000/parallax where parallax > 0; label it approximate), `pmra`, `pmdec`, `phot_g_mean_mag`, `bp_rp`, `radial_velocity`, `teff_gspphot`.
- **Sort:** by `source_id`. That ID encodes a HEALPix sky position, so scrolling sweeps across the sky, and neighboring rows compress well.
- **Role:** this is the scale test. It gives the M4 paging and the M7 ceiling real work, and it sets up v1.1 charts (a GPU star map).
- **Credit in the UI (required):** "This work has made use of data from the European Space Agency (ESA) mission Gaia, processed by the Gaia Data Processing and Analysis Consortium (DPAC)."

## `just tycho data` produces

The data scripts are TypeScript run by Node, like `perf/`. `prep.sql` stays plain SQL, run by a small TS runner on `@duckdb/node-api` (pinned, in its own npm workspace at `data/` so its native binary stays out of the web host's install).

- `data/raw/`: raw API/S3 fetches (asteroid JSON pages, Gaia extracts). Gitignored.
- `asteroids.parquet`: default button. ZSTD compression, `ROW_GROUP_SIZE` 30,720 (M4; was 122,880).
- `gaia-dr3-bright.parquet`: "big" button. ZSTD, **`ROW_GROUP_SIZE` 61,440** (M7: same bytes per page as 30,720, half the per-group cost; see the decisions log), 1.57 GB, 409 row groups. `just tycho data gaia` builds it; `--bench` writes row-group variants to `data/bench/`.
- `data/fixtures/asteroids.csv`: the asteroid table as CSV, with the rows from `data/fixtures-src/tricky_rows.csv` appended by prep. `tricky_rows.csv` is hand-written and committed, and holds rows with quoted commas and newlines in the name field. The generated `asteroids.csv` is gitignored. This is the M6 fixture. It also gives the "drop a CSV" demo a matching file people can download and try.
- `data/MANIFEST.json`: for each file, the row count, byte size, SHA-256, source, fetch date, and the Gaia magnitude cut used. **Committed**, so every benchmark names the exact files it ran against.
- All other generated files are gitignored. Upload them to R2 with the S3-compatible API (rclone or `aws s3 cp` with the R2 endpoint), because Gaia is too big for `wrangler r2 object put`.

## Why re-host instead of linking the sources

- Under `COEP: require-corp`, every cross-origin fetch needs CORS or CORP headers that we don't control. Serving from the same origin avoids the problem.
- Rewriting the files lets us **control row-group size and sort order**, and the M4 paging strategy depends on both.
- Pinned files make every benchmark reproducible.
