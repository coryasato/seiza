# Research: Tycho's sample

Which data Tycho's one sample is, and how its file is built. It came out of the sample session of 2026-11-21: a proposal and a build spec drafted in a planning conversation, then checked here against the source's own files, downloaded that day (data update 2026 Nov 19). The constraints it had to meet are in [`tycho-workbench.md`](tycho-workbench.md), "Samples"; the decision is in Tycho's [`docs/DECISIONS.md`](../../apps/tycho/docs/DECISIONS.md), "Sample data"; the step that builds it is in Tycho's [`PLAN.md`](../../apps/tycho/PLAN.md).

Each item is marked **Decided** (the owner said so), **Proposed** (suggested, not yet confirmed), or **Open**. Every count below was measured on the downloaded files unless it says otherwise; the build's checks measure them again.

---

## The choice

- **Decided:** the sample is **GCAT**, Jonathan McDowell's General Catalog of Artificial Space Objects ([planet4589.org/space/gcat](https://planet4589.org/space/gcat)): every catalogued object that reached Earth orbit since 1957, one row each.
- **Decided:** one sample, one file, `gcat.parquet`. Tycho opens one file at a time until "More than one file, and joins" is built, so the launch, organization, and site tables are folded into the one table as words, and nothing else is served.
- **License:** CC BY 4.0. GCAT's page reads "This data may be freely reproduced as long as you cite it", and gives a short credit, "data from GCAT (J. McDowell, planet4589.org/space/gcat)", and a full citation that carries the release number.

## Why it fits

What a good sample has (the workbench research, "Samples"), against what the files hold:

| Wanted | In GCAT |
|---|---|
| Text | 37,900 distinct names in 71,413 rows; alternate names; thousands of identical debris names for a duplicate check |
| Categories, small and large | 4 object types, 22 status codes, 27 orbit codes, 125 states, 2,066 owners, 404 launch vehicles, 58 launch sites, about two dozen payload purposes |
| Dates and timestamps | A launch date on every row, and a launch time to the minute or the second; an end date on 51% |
| Numbers | Perigee, apogee, inclination (missing on 0.2%); mass and span |
| Nulls that mean something | Mass and size unknown on about 45% of rows, nearly all debris; no end date on what is still up; no purpose on what isn't a payload |
| A story a visitor can find | Below |
| A license that allows re-hosting | CC BY 4.0 |
| Under 25 MiB | The raw object text is 19.7 MB and compresses to 1.6 MB with zstd, so the Parquet is a few MiB at most |

**The stories,** each found with the first release's tools:

- **Starlink by year:** find "Starlink" in the name, group by launch year: 128 in 2019, 890 in 2020, 1,063, 1,826, 2,065, 1,964, 3,171 in 2025, and 2,301 so far in 2026.
- **The space race:** payloads from 1957 to 1969, grouped by country. The United States and the Soviet Union both have payloads in every year from 1958 to 1969.
- **Debris clouds:** debris grouped by launch. The largest are 1999-025 (Fengyun-1C, 3,534 pieces), 1982-092 (1,806), and 1993-036 (1,714). Debris carries its parent's owner, so "debris by country" is one group away.
- **Reentries by year:** status "Reentered", grouped by the end date's year.
- **The Roadster:** find "Roadster": one row, "Tesla Roadster", whose status is that it left for deep space.
- **What satellites are for:** payloads grouped by purpose: communications far ahead (17,443 in the first payload file), then imaging (3,171) and technology (1,664).
- **Launches by hour:** every launch has a time.

**A chart is waiting** (PLAN's wish for the sample): Starlink by year as bars, and perigee against apogee for one debris cloud, which draws the cloud's spread.

**What it doesn't show:**

- **Scale.** 71,413 rows fits in a spreadsheet. The scale claim rests on a visitor's own file (Tycho's `docs/DECISIONS.md`, "Sample data", 2026-11-17).
- **The profile's sampled stage.** A file this small is read whole at once, so the stage that draws a sample's shape never appears on it.
- **Nested values.** Every column is a scalar.

## What the source is

Five files are read, all tab-separated, under `https://planet4589.org/space/gcat/tsv/`:

| File | Rows | What it gives |
|---|---|---|
| `cat/satcat.tsv` | 69,999 | Objects with catalog numbers 1 to 69999; 42 columns |
| `cat/satcat100k.tsv` | 1,414 | Objects numbered 100000 and up, same columns. The 5-digit numbers ran out on 2026-07-11, and every object catalogued since is here. Without it, Starlink's 2026 stops in July |
| `cat/psatcat.tsv`, `cat/psatcat100k.tsv` | 27,940 and 1,217 | One row per payload: its purpose (`Category`) and sector (`Class`). Together they cover all 29,069 payloads |
| `launch/launch.tsv` | 76,035 | One row per launch, by `Launch_Tag`: the vehicle, site, agency, and time. Only 6,996 are launches an object in the catalog came from; the rest are suborbital (missile tests, sounding rockets) |
| `tables/orgs.tsv`, `tables/sites.tsv` | 4,146 and 712 | Names for the owner, state, manufacturer, agency, and site codes. No code repeats in either |

**Gotchas the build must handle,** each found by counting:

- **Each file starts with `#` lines:** the header row, then an "Updated" line.
- **Null is written three ways:** `-`, a blank, and, for mass, dry mass, length, diameter, and span, `0`. The zeros are about 45% of those columns (27,991 of the 28,031 debris rows have mass 0). A 0 in perigee, apogee, or inclination can be real (49 rows have inclination 0) and stays.
- **A trailing `?` marks a code or a date as uncertain** (`CALT?`, `R?`, `1962 Jun 14?`). It's stripped before a decode and kept as a flag where the spec asks for one.
- **Owners, manufacturers, and agencies can be two codes joined by a slash** (`NRO/CIA`): 1,989 owners, 1,098 manufacturers, 297 launch agencies.
- **A row is one phase of an object's life, and the status is how that phase ended.** Most objects have one phase, but 477 rows end "Docked", 337 "Renamed", 78 "Exploded": what happened to the object afterwards isn't in the row. So `end_date` is when the object left this catalog's phase, not always a reentry. The Roadster's is the day after launch, when it crossed into deep space.
- **`Primary` is "Earth" on every row.** An object's later orbit of the Sun or the Moon is in other files (`deepcat`), which are out.
- **The dates use few of GCAT's Vague Date forms:** a year, a month, a day (single-digit days padded with two spaces), a time to the minute, or a time to the second, each with an optional `?`.
- **Launch tags before 1963 are written the old way** (`1957 ALP`), and IDs from S100000 up are seven characters.
- **Three rows have a blank type and no launch tag, 28 are type `Z` (spurious), and 24 have status `ERR`: 32 rows in all, since most `ERR` rows are type `Z`.** No row has type `X` (deleted).
- **The names are GCAT's.** A site's English long name is often missing (Kennedy's short name is "Kennedy"), and the Soviet Union's names are "SSSR" and "Union of Soviet Socialist Republics".

**Not used,** and why:

| Source | Why it's out |
|---|---|
| `auxcat` | Attached and omitted objects: it would blur "one row per thing in orbit" |
| `ftocat` | 1,845 objects from failed launches, same columns. Out for the same reason. If it ever comes in, a launch outcome column becomes worth having |
| `deepcat` and the other deep-space and event files | A different shape (phases beyond Earth), overlapping the same objects |
| `lcat`, `rcat` | Suborbital |
| The temporary and analyst catalogs | Unconfirmed entries |
| The derived launch log | One row per payload only; the launch list covers every object |
| Launch pads, vehicle families, platforms, worlds | The site's and the vehicle's names are enough |
| Dry mass, length, diameter, the orbit's epoch, the payload name, the flags other than mass's | Left out to keep the table readable |
| A launch outcome | "Success" for all but about 80 of the 6,996 launches, since a failed launch rarely leaves a catalogued object |
| The central body | A constant |

## The table

**Decided,** as one row per object, sorted by `launch_date` then `jcat`. The decodes marked † are read from GCAT's column pages by the build, which fails on a code it has no word for.

| Column | Type | From | Null when |
|---|---|---|---|
| `jcat` | VARCHAR | `JCAT` | never; unique |
| `satcat_no` | INTEGER | `Satcat` | it isn't a number |
| `cospar` | VARCHAR | `Piece` | never |
| `launch_tag` | VARCHAR | `Launch_Tag` | never |
| `name` | VARCHAR | `Name` | never |
| `object_type` | VARCHAR | `Type`, first letter: Payload, Rocket stage, Component, Debris | never |
| `object_detail` † | VARCHAR | `Type`, fourth letter (collision debris, weapons test debris, fairing, …) | the letter is blank (about a quarter of rows) |
| `crewed` † | BOOLEAN | `Type` | never |
| `megaconstellation` † | BOOLEAN | `Type` (about 15,000 rows) | never |
| `purpose` † | VARCHAR | the payload files' `Category`, its first value, in words (Communications, Imaging, Navigation, …) | not a payload |
| `sector` | VARCHAR | the payload files' `Class`: Amateur or academic, Business, Civil, Defense | not a payload |
| `launch_date` | DATE | `LDate` | never |
| `launch_time` | TIMESTAMP | the launch list's `Launch_Date` (UTC) | never |
| `launch_time_precision` | VARCHAR | the same: `second` or `minute` | never |
| `vehicle` | VARCHAR | the launch list's `LV_Type` | never |
| `launch_site` | VARCHAR | the launch list's site, through `sites` | never |
| `launch_agency` | VARCHAR | the launch list's agency, through `orgs` | never |
| `owner` | VARCHAR | `Owner`, through `orgs` | never (debris carries its parent's) |
| `country` | VARCHAR | `State`, through `orgs` | never |
| `manufacturer` | VARCHAR | `Manufacturer`, through `orgs` | unknown (33%) |
| `status` † | VARCHAR | `Status`: In orbit, Reentered, Deorbited, Landed, Docked, Left for deep space (`DSO`, `DSA`), … | never |
| `end_date` | DATE | `DDate` | the phase hasn't ended (49%) |
| `end_date_precision` | VARCHAR | `DDate`: `day`, `month`, `year` | with `end_date` |
| `end_date_uncertain` | BOOLEAN | `DDate`'s `?` | with `end_date` |
| `days_in_orbit` | INTEGER | `end_date` − `launch_date` | the object didn't come back to Earth: filled only for reentered, deorbited, landed, and their attached forms |
| `orbit` † | VARCHAR | `OpOrbit`, coarse: Low Earth, Medium Earth, Geostationary, … | unknown (0.2%) |
| `orbit_class` † | VARCHAR | `OpOrbit`, in full | unknown (0.2%) |
| `perigee_km`, `apogee_km` | DOUBLE | `Perigee`, `Apogee` | unknown (0.2%) |
| `inclination_deg` | DOUBLE | `Inc` | unknown (0.2%) |
| `mass_kg` | DOUBLE | `Mass` | unknown or 0 (45%) |
| `mass_estimated` | BOOLEAN | `MassFlag`'s `?` | with `mass_kg` |
| `span_m` | DOUBLE | `Span` | unknown or 0 (45%) |
| `bus` | VARCHAR | `Bus` | unknown (45%) |
| `shape` | VARCHAR | `Shape` | unknown (45%) |
| `alt_names` | VARCHAR | `AltNames` | none (94%) |

## The build

**Decided** (reviewed by the owner and built 2026-11-23, as `apps/tycho/data/gcat.ts`; what the data asked for beyond this spec, the table's differences included, is in Tycho's `docs/DECISIONS.md`, "Sample data", 2026-11-23, and the file as built in its `docs/data.md`). It follows the asteroid sample's pattern in `apps/tycho/data/`: TypeScript run by Node, native DuckDB through `@duckdb/node-api`, a fetch that keeps its raw files so prep reruns without the network, and an entry in `MANIFEST.json`.

1. **Fetch** the seven files above into `data/raw/gcat/` (gitignored), with each one's bytes and SHA-256, the fetch date, and the release and data-update line from GCAT's index page. A rerun reuses them; `--refresh` fetches again.
2. **Parse** every column as text, then cast, so one bad value can't shift a column. `-` and blank become NULL; 0 becomes NULL in mass and span only, and the script prints how many it nulled.
3. **Dates:** a parser for the five forms above and the `?`, returning the value, its precision, and whether it's uncertain. It fails on any other form, and is unit-tested on each form, the two-space day included.
4. **Decode tables** for status, orbit, the type letters, purpose, and sector: constants in the script, each with a link to its GCAT page. A code in the data that a table doesn't cover fails the script and prints it.
5. **Joins:** objects to launches on the launch tag; sites and orgs on their codes, a plain join since no code repeats. A slash-joined pair is decoded half by half and written with a slash. Country and site names are GCAT's, except for a short table of our own holding the names a visitor expects ("Soviet Union", "United States", "Kennedy Space Center"). The script prints each join's unmatched count and fails above a threshold the build sets.
6. **Drop** the rows with type `Z`, a blank type, or status `ERR`, printing their IDs.
7. **Write** `gcat.parquet` with ZSTD, with the license, the short credit, the full citation, the data-update date, the fetch date, and the source URLs in its key/value metadata, as the asteroid file carries its credit.
8. **Checks,** each failing the script:
   - `jcat` is unique, there are more than 70,000 rows, and the file is under 25 MiB.
   - "Roadster" finds one row, and its status is "Left for deep space".
   - Starlink payloads number over 800 in every year from 2020 on, the current year included (which proves the second catalog file is in).
   - The United States and the Soviet Union each have a payload in every year from 1958 to 1969.
   - The launch with the most debris is 1999-025.
9. **Print** each column's null share, the row count, and the file's size, for Tycho's `docs/data.md`, and write the `MANIFEST.json` entry: rows, bytes, SHA-256, the source's release and data update, each input's SHA-256, and the fetch date.

A newer GCAT is a rerun of the fetch and prep and a deploy. Nothing refreshes it on a schedule: the file is a static asset, and its hash is committed.

## Open

- **Where the credit shows.** *Decided 2026-11-21:* with the file's facts, in the menu under its name, and on the first screen's sample row (Tycho's `docs/DECISIONS.md`, "Scope"). Until that page is built, the old header strip shows it from the file's metadata.
- **How the file reaches the build.** *Decided 2026-11-23:* `just tycho data` builds it, gitignored, and the web build refuses a missing file or one `MANIFEST.json` doesn't record (Tycho's `docs/DECISIONS.md`, "Sample data").
- **Later, with "More than one file, and joins":** whether the launches, organizations, and sites are served as tables of their own to join. A launches table would hold the orbital launches only, not the 76,035-row list.
