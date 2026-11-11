# The orbits' data

Where Kirkwood's rows come from, what the fetch holds, the two files built from it that the app holds in memory, Jupiter's orbit, and what the files' places were checked against. Paths are relative to `apps/kirkwood/`. Why each choice was made is in [`DECISIONS.md`](DECISIONS.md), "Data".

## The fetch

- **Source:** the JPL Small-Body Database Query API (`ssd-api.jpl.nasa.gov/sbdb_query.api`), every asteroid (`sb-kind=a`), at full precision (`full-prec=1`: without it the API rounds every number for display, a to a thousandth of an au). `data/fetch.ts` pulls the catalog in pages of 100,000 into `data/raw/asteroids/` (gitignored) as the API's own JSON, one request at a time, and writes `fetch.json` last: the query, the fields returned, the date, and the API's count. A rerun reuses the pages; `--refresh` fetches again. The catalog can change between pages, so the fetch fails if any page reports a different count, if its distinct `spkid`s aren't that count (a row that moved across a page boundary), if a kept page isn't a page of the size asked for, or if its pages were fetched more than 6 hours apart (one date names the dataset); readers keep one row per `spkid`.
- **Fetched 2026-11-11:** 1,580,272 rows in 16 pages (505 MB of JSON), every page reporting the same count, every `spkid` once.
- **Fields:** the 18 columns of Tycho's asteroid sample, in its order (`spkid`, `full_name`, `pdes`, `name`, `neo`, `pha`, `class`, `H`, `diameter`, `albedo`, `a`, `e`, `i`, `q`, `per_y`, `first_obs`, `last_obs`, `n_obs_used`), then `om`, `w`, `ma`, `epoch`, `equinox`, `n`, `tp`, `orbit_id`.
- **Credit:** "Asteroid data: NASA/JPL Small-Body Database, fetched 2026-11-11."

## The elements: units and frame

From the API's own field list (`sbdb_query.api?info=field`) and its documentation (`ssd-api.jpl.nasa.gov/doc/sbdb_query.html`):

| Field | What | Units |
|---|---|---|
| `a` | semi-major axis | au |
| `e` | eccentricity | |
| `i` | inclination, "angle with respect to x-y ecliptic plane" | degrees |
| `om` | longitude of the ascending node | degrees |
| `w` | argument of perihelion | degrees |
| `ma` | mean anomaly | degrees |
| `epoch` | epoch of osculation, a Julian day | TDB |
| `equinox` | "equinox date of the heliocentric IAU76/80 ecliptic reference system" | `J2000` on every row |
| `n` | mean motion | degrees a day |
| `tp` | time of perihelion passage, a Julian day | TDB |

So the elements are heliocentric, in the ecliptic of J2000 (IAU 1976 obliquity), osculating at each row's own epoch. All 1,580,272 rows say `J2000`.

## What the fetch holds

`data/survey.ts` prints these (and, given the raw pages of Tycho's sample, how the two differ: `DECISIONS.md`, "Data").

- **Gaps:** a, e, i, the node, the argument of perihelion, the epoch, `n`, and `tp` are on every row. One row has no mean anomaly: (2002 PD153), 5 observations over two days, fitted as a circle (e exactly 0) with its perihelion at its epoch, so its mean anomaly there is 0. 509 rows have no H.
- **No ellipse:** 7 rows have e past 1 and a below 0 (class HYA, 'Oumuamua among them).
- **Epochs:** 1,483,888 rows (93.9%) are at JD 2461200.5 (2026-06-09). The other 96,384 are spread over 6,376 epochs from 1927-06-20 to 2026-11-11, half of them more than 6.6 years before the commonest (21,235 at 2025-11-21, the commonest before it). They are the rows seen briefly: a median of 14 observations over 6 days, against 112 over 6,748 days for the rest, and 73,896 of them have their epoch within 60 days of their last observation.
- **The two-body relations hold in JPL's own numbers:** `n` is the Gaussian constant over a^1.5 to 2.7 parts in 10^8 at the 99th percentile (worst, 3.2 in 10^4: a far object with a kept to few digits), and `ma` is `n` times the days from `tp` to the epoch within 10^-7 of a degree on every row. `q` is a(1 − e) to 1.5 parts in 10^8 at the 99th percentile (worst, 1 in 10^7), and `per_y` is the period that mean motion gives, in years of 365.25 days, to 2.7 in 10^8 (the same worst row as `n`).
- **How the API rounds without `full-prec`** (Tycho's sample, found by trying rules against this fetch): a to 4 significant digits with trailing zeros dropped, e to 4 decimals, i and H to 2, q, the diameter, and the albedo to 3, the period to 3 significant digits.

## The two files

`data/prep.ts` builds them from the fetch: `data/elements.bin`, what the scene draws from, and `data/rows.bin`, the table's other columns. Both are gitignored; `data/MANIFEST.json` (committed) holds each one's rows, bytes, SHA-256, source, fetch date, and layout (every section's name, type, offset, and bytes), so the manifest is the layout's exact statement and this is its explanation.

- **Reproducible:** prep writes the same bytes from the same `data/raw/` every time; `prep.ts --check` builds them again and fails unless they are the manifest's and the disk's. A refresh of the fetch is a new dataset: new files, a new manifest, a new date in the credit.
- **Checked as written:** every run reads each row back out of the built bytes, the way the app will, and fails unless it is the fetch's row: the text exactly, the numbers as below.
- **Both files** are little-endian, a column at a time, every section starting on a 4-byte boundary, so a reader holds the file's bytes as they arrive and views each column where it is.
- **The rows' order** is the same in both: the numbered asteroids by number (row r is asteroid r + 1, so the table opens on Ceres), then the rest by designation, in the order designations were given out (the three with a survey's designation last). It's the catalog's own order made exact; the API doesn't promise one.

### `elements.bin`

A 16-byte header (`KWE1`, the row count as a u32, the epoch as an f64: JD 2461200.5 TDB), then seven columns of 32-bit floats, a row count long each:

| Column | What | Units |
|---|---|---|
| `a` | semi-major axis | au |
| `e` | eccentricity | |
| `i` | inclination | degrees |
| `om` | longitude of the ascending node | degrees |
| `w` | argument of perihelion | degrees |
| `ma` | mean anomaly at the header's epoch, from -180 to 180 | degrees |
| `H` | absolute magnitude; NaN on the 509 rows with none | |

- **One epoch.** A row fetched at another epoch (96,384 of them) has its mean anomaly moved to this one by its own mean motion; the other five elements are as fetched (`DECISIONS.md`, "Data").
- **The mean motion** is the Gaussian constant over a^1.5: 0.01720209895 / a^1.5 radians a day. A clock that counts a 1 au orbit as one year counts years of 365.2569 days.
- **The mean anomaly is the turn nearest zero,** not JPL's 0 to 360: a float is finest near zero, which is perihelion, where a place is most sensitive to it.
- **A place:** solve E − e sin E = M; in the orbit's plane x = a(cos E − e), y = a√(1 − e²) sin E; turn by `w`, tilt by `i`, turn by `om` (`data/catalog.ts`'s `place`, in 64-bit floats). The frame is the fetch's: heliocentric, the ecliptic of J2000.
- **Rows with no ellipse:** the 7 with e past 1 keep their a (below 0) and e, and their mean anomaly is a hyperbola's, moved by the mean motion of |a| and not wrapped. A reader that draws ellipses skips a row whose e isn't below 1.
- **(2002 PD153)** has no mean anomaly in the fetch (a fitted circle); it takes 0 at its own epoch, moved like the rest.
- **The stored floats are the cells:** the table shows a, e, i, and H from here, each written in the fewest digits that read back as the float. H has at most 4 decimals in the fetch, so its cell is JPL's number exactly.

### `rows.bin`

A header (`KWR1`, then four u32s: the rows, the numbered rows, the named rows, the classes; then each class as a length byte and its text), then:

| Section | Type | What |
|---|---|---|
| `spkid` | u32 | JPL's key; 20,000,000 + the number on a numbered row |
| `designation` | u32 | the provisional designation, packed (below) |
| `first_obs`, `last_obs` | i32 | days from 1970-01-01; -2147483648 for none, and that plus a year for a date JPL has only the year of (`1998-??-??`, 6,819 first observations) |
| `diameter`, `albedo` | f32 | km, and a share; NaN for none (9 rows in 10) |
| `n_obs_used` | u16 | |
| `neo`, `pha` | u8 | 0 no, 1 yes, 2 none |
| `class` | u8 | an index into the header's classes |
| `name rows` | u32 | the rows that have a name, in order (1 in 60) |
| `name offsets` | u32 | each name's start in the text, and one past the last |
| `name text` | bytes | the names, end to end (ASCII in this fetch; read as UTF-8) |

What the file leaves out, and where each cell comes from instead:

- **`full_name` and `pdes` are rebuilt.** A full name is the number (on a numbered row), the name (if any), and the designation in parentheses: `1 Ceres (A801 AA)`, `8748 (1998 FV113)`, `(2002 PD153)`. `pdes` is the number, or on an unnumbered row the designation without its `A/`. Prep fails on a row that doesn't rebuild.
- **A designation is 32 bits** (`data/catalog.ts`, `packDesignation`): a year from 1800 (8 bits), the half-month's letter (5), the number after the letters (12), the second letter (5, or none), and one bit for the prefix `A/` (29 asteroids on comets' orbits); a year before 1925 is written the old way (`A801` for 1801). The four surveys' (`4109 P-L`, `T-1`, `T-2`, `T-3`) set the top bit. Packed values sort in the order designations were given out (within a half-month AA, AB, … AZ, then AA1, AB1, …), the surveys' after every other, out of their dates' order.
- **A name is found by its row,** a binary search of `name rows`.
- **`q` and `per_y` are computed** from the elements file's a and e: q = a(1 − e), and the period a^1.5 × 365.2569 / 365.25 years (none where e isn't below 1). Against JPL's own columns they're off by at most 1.8 parts in 10^4 and 3.2 in 10^4.
- **`H`, `a`, `e`, and `i`** are the elements file's.
- **Not kept from the fetch:** each row's own epoch, `n`, `tp`, `orbit_id`, and `equinox` (J2000 on every row).

### Sizes

`prep.ts --sizes`, brotli at quality 11 with a 16 MiB window:

| | Raw | Brotli 11 |
|---|---|---|
| `elements.bin` | 44.25 MB | 34.56 MB |
| `rows.bin` | 46.27 MB | 11.15 MB |

Held in memory they cost their raw size, 90.5 MB together. The elements' six orbit columns are 5.0 to 5.7 MB each at brotli 11 (their digits are noise to a compressor) and H is 2.0. Of the rows file: `spkid` 2.4 MB, `designation` 2.1, the dates 2.2 and 1.9, `n_obs_used` 1.7, and everything else 1.0.

## Jupiter

Jupiter isn't a row, so it isn't in the files. `data/jupiter.ts` holds its six osculating elements at the files' epoch and its mean motion, from JPL Horizons (body 599 about the Sun's center, the ecliptic of J2000; the same numbers are in `data/horizons.json`), and places it as a row is placed (`data/orbit.ts`'s `place`), with one difference: its mean motion is its own, 0.0830846 degrees a day, which counts its mass (`DECISIONS.md`, "Scene"). Both modules are free of Node, so a page can import them.

## Checked against Horizons

`data/horizons.json` (committed: 5 KB) pins what the files' places were compared with: JPL Horizons' own places for five numbered asteroids (Ceres, Vesta, 153 Hilda, and the largest Trojan of each cloud, 624 Hektor and 617 Patroclus) and for Jupiter, at eight dates from 50 years before the epoch to 50 after, with Jupiter's elements at the epoch. Every place is geometric (no light time), from the Sun's center, in the ecliptic of J2000, in au, at 0h TDB. `data/horizons.ts` fetches it, one request at a time; each body's orbit solution is recorded beside its places.

`data/places.ts` reads the two built files as the app will (the manifest's bytes, each column where it lies) and prints what they give: each body's distance from Horizons' place at each date; Jupiter's place three ways against Horizons'; the rows of class TJN by their longitude from Jupiter's; and the rows from 3.7 to 4.2 au (the Hildas), by where the corners of their triangle point and by the resonance's own angle. What it found: `DECISIONS.md`, "Scene".

- **Credit:** "Jupiter's orbit and the reference places: NASA/JPL Horizons, fetched 2026-11-11."

## Commands

From the repo root:

```
node apps/kirkwood/data/fetch.ts [--refresh] [--page-size 100000]   # the catalog into data/raw/asteroids/ (~3 min, once)
node --max-old-space-size=12000 apps/kirkwood/data/survey.ts [<tycho's data/raw/asteroids>]   # the numbers above as JSON; with Tycho's raw pages, the sample against the fetch
node --max-old-space-size=12000 apps/kirkwood/data/prep.ts [--check] [--sizes]   # data/elements.bin, data/rows.bin, data/MANIFEST.json (~1.5 min); --check: builds again, fails unless the bytes are the manifest's, writes nothing; --sizes: each file and section raw and at brotli 11 (~2 min more)
node --max-old-space-size=12000 apps/kirkwood/data/precision.ts [--only error,bytes]   # the elements file's precision, weighed: each way of storing the elements, its error against 64-bit floats and its bytes (~7 min; DECISIONS.md, "Data")
node apps/kirkwood/data/horizons.ts   # data/horizons.json again from JPL Horizons (7 requests; a refetch changes the pinned reference, so not without a reason)
node apps/kirkwood/data/places.ts [--date 2026-06-09] [--only bodies,jupiter,trojans,hildas]   # the built files' places against Horizons', and the Trojans and Hildas against Jupiter (a few seconds; DECISIONS.md, "Scene")
```
