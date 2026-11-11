# The orbits' data

Where Kirkwood's rows come from and what the fetch holds. Paths are relative to `apps/kirkwood/`. Why each choice was made is in [`DECISIONS.md`](DECISIONS.md), "Data". The two files the app holds in memory, and their manifest, aren't built yet (`PLAN.md`).

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

## Commands

From the repo root:

```
node apps/kirkwood/data/fetch.ts [--refresh] [--page-size 100000]   # the catalog into data/raw/asteroids/ (~3 min, once)
node --max-old-space-size=12000 apps/kirkwood/data/survey.ts [<tycho's data/raw/asteroids>]   # the numbers above as JSON; with Tycho's raw pages, the sample against the fetch
```
