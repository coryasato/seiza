# Sample data

Tycho's one sample, where it comes from, and how `just tycho data` builds it; and the test files beside it. Paths are relative to `apps/tycho/`. Why GCAT, its columns, and the build's spec are in [the sample's research](../../../docs/research/tycho-sample.md); the decisions in [`DECISIONS.md`](DECISIONS.md), "Sample data".

## The sample: GCAT, every object launched to orbit

- **What:** Jonathan McDowell's General Catalog of Artificial Space Objects ([planet4589.org/space/gcat](https://planet4589.org/space/gcat)), one row per catalogued object that reached Earth orbit since 1957: payloads, rocket stages, components, and debris. CC BY 4.0.
- **The file:** `data/gcat.parquet`, 71,431 rows and 36 columns, 1.70 MiB (GCAT 1.8.9, data update 2026-11-23, fetched 2026-11-24). ZSTD, 30,720-row groups (3), sorted by `launch_date` then `jcat`. `data/MANIFEST.json` holds its rows, bytes, SHA-256, each input's SHA-256, the release, and the 29 dropped IDs.
- **Credit:** in the file's key/value metadata (`tycho.credit`, `tycho.fetched`, and `tycho.license`, `tycho.citation`, `tycho.release`, `tycho.data_update`, `tycho.source`), which the header strip reads: "Data from GCAT (J. McDowell, planet4589.org/space/gcat) · CC BY 4.0, fetched <date>." Where the rebuilt page shows it: `DECISIONS.md`, "Scope", 2026-11-21.
- **How the app gets it:** the host imports the file as a hashed asset (`web/src/main.ts`, `/assets/gcat-<hash>.parquet`, immutable) and passes its URL to the wasm. The sample button downloads it whole after the click and opens it from memory, as a dropped file opens (`crate/src/files.rs`, `download`); nothing reads it by range. `web/vite.config.ts` refuses to build or serve without the file, or with one whose SHA-256 isn't `MANIFEST.json`'s.

**The columns and their nulls,** as the build printed them (each column's source and meaning: the research's "The table"):

| Column | Type | Null | Column | Type | Null |
|---|---|---|---|---|---|
| `jcat` | VARCHAR | 0 | `owner` | VARCHAR | 0 |
| `satcat_no` | INTEGER | 0.9% | `country` | VARCHAR | 0 |
| `cospar` | VARCHAR | 0 | `manufacturer` | VARCHAR | 33.1% |
| `launch_tag` | VARCHAR | 0 | `status` | VARCHAR | 0 |
| `name` | VARCHAR | 0 | `end_date` | DATE | 48.6% |
| `object_type` | VARCHAR | 0 | `end_date_precision` | VARCHAR | 48.6% |
| `object_detail` | VARCHAR | 47.6% | `end_date_uncertain` | BOOLEAN | 48.6% |
| `crewed` | BOOLEAN | 0 | `days_in_orbit` | INTEGER | 51.1% |
| `megaconstellation` | BOOLEAN | 0 | `orbit`, `orbit_class` | VARCHAR | 0.1% |
| `purpose`, `sector` | VARCHAR | 59.2% | `perigee_km`, `apogee_km`, `inclination_deg` | DOUBLE | 0.0% |
| `launch_date` | DATE | 0 | `mass_kg`, `mass_estimated` | DOUBLE, BOOLEAN | 45.0% |
| `launch_time` | TIMESTAMP | 0 | `span_m` | DOUBLE | 45.0% |
| `launch_time_precision` | VARCHAR | 0 | `bus` | VARCHAR | 44.5% |
| `vehicle`, `launch_site`, `launch_agency` | VARCHAR | 0 | `shape` | VARCHAR | 45.0% |
| | | | `alt_names` | VARCHAR | 93.7% |

Where the file differs from the research's table, decided when it was built (`DECISIONS.md`, "Sample data", 2026-11-23): `launch_date` is the date of the launch list's `launch_time`, not the object's own `LDate`; `end_date_precision` also takes `quarter` and `decade`; `days_in_orbit` is filled only for a return dated to the day and not before the launch.

## How `just tycho data` builds it

`data/gcat.ts` (its header says each step), on native DuckDB (`@duckdb/node-api`, in `data/`'s own lockfile):

1. **Fetch** seven TSV files and GCAT's index page (release and data update) into `data/raw/gcat/` (gitignored), with `fetch.json` written last; a rerun reuses them after checking their hashes, and `--refresh` fetches again.
2. **Read** every column as text, then cast. `-` and blank are null; 0 is null in mass and span only (32,157 and 32,118 rows).
3. **Decode:** dates through `data/gcat-dates.ts` (GCAT's Vague Dates, unit-tested by `just tycho lint`), codes through `data/gcat-codes.ts` (each table linked to its GCAT page), names through GCAT's orgs and sites tables, with a short table of our own ("United States", "Soviet Union", "United Kingdom", "Kennedy Space Center", "Cape Canaveral"). An uncovered date form, code, or org, a repeated key, an object with no launch or a launch with no date, or a catalog number that is neither a number nor `NNA` (none assigned, null) fails the build and is printed.
4. **Drop** type Z (spurious), a blank type, and status ERR: 29 rows, their IDs printed and in `MANIFEST.json`.
5. **Write and check:** more than 70,000 rows, `jcat` unique, under 25 MiB, the never-null columns full, "Roadster" one row that left for deep space, Starlink over 800 payloads a year from 2020 (the current year held to its share), a United States and a Soviet Union payload every year from 1958 to 1969, and 1999-025 the launch with the most debris. The checks run on a temporary file, which replaces `gcat.parquet` only once they pass: a failed rebuild leaves the last good one.

The build is reproducible: a rerun on the same raw files writes the same bytes. A newer GCAT is `just tycho data --refresh`, then a build; nothing refreshes it on a schedule.

## The test files

Files a visitor could drop, built by `just tycho drop-files` from the observatory's asteroid sample (`data/CLAUDE.md`): the CSV fixture (`data/fixtures/asteroids.csv`, with the hand-written `data/fixtures-src/tricky_rows.csv` appended), and Parquet and CSV files of about 100 MB to 10 GB in `data/drop/`. All gitignored; `MANIFEST.json` records each one.

## Why served from our origin

- Under `COEP: require-corp`, a cross-origin fetch needs CORS or CORP headers we don't control; same-origin avoids the problem.
- Rebuilding the file lets us pick its columns, words, sort, and row groups.
- A pinned file makes what the app shows reproducible.
