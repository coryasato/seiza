-- The wide sheet's file: GHCN-Daily's 2025 daily highs, a station a row and
-- a day a column (docs/DECISIONS.md, "Scenarios"). prep.ts checks the three
-- sources against their pins in MANIFEST.json first, then substitutes raw
-- (their directory), doys and days (the pivot's "0" … "364" and the 365 day
-- columns named "Jan 1" … "Dec 31"), fetched, and version, each written as
-- a dollar sign and the name in braces (COPY options must be constants).
--
-- The rows: every station with a quality-clean high (TMAX, no QFLAG) on at
-- least 300 days of 2025, sorted north to south (ties by its ID). The
-- columns: Station (its name), Place (state and country in the US and
-- Canada, else the country), Latitude, then each day's high in °C (the
-- file's tenths over 10, as DOUBLE), NULL where the day has no clean value.
-- DuckDB's smallest row groups (2,048 rows): the first page waits for 1.6 MB,
-- not the whole file.

CREATE TEMP TABLE obs AS
SELECT id, dayofyear(strptime(date, '%Y%m%d')) - 1 AS doy, value::SMALLINT AS v
FROM read_csv('${raw}/2025.csv.gz', header = false,
    columns = {'id': 'VARCHAR', 'date': 'VARCHAR', 'element': 'VARCHAR', 'value': 'INTEGER',
               'mflag': 'VARCHAR', 'qflag': 'VARCHAR', 'sflag': 'VARCHAR', 'obstime': 'VARCHAR'})
WHERE element = 'TMAX' AND qflag IS NULL;

-- One clean high a station a day, or the pivot below would pick one.
SELECT CASE WHEN (SELECT count(*) FROM (SELECT id, doy FROM obs GROUP BY ALL HAVING count(*) > 1)) > 0
    THEN error('prep: a station has two clean highs on one day') END;

CREATE TEMP TABLE kept AS
SELECT id FROM obs GROUP BY id HAVING count(*) >= 300;

-- ghcnd-stations.txt and ghcnd-countries.txt are fixed-width (NOAA's readme).
CREATE TEMP TABLE stations AS
SELECT trim(substr(line, 1, 11)) AS id,
       substr(line, 13, 8)::DOUBLE AS lat,
       trim(substr(line, 39, 2)) AS state,
       trim(substr(line, 42, 30)) AS name
FROM (SELECT unnest(string_split(content, chr(10))) AS line FROM read_text('${raw}/ghcnd-stations.txt'))
WHERE length(line) > 0;

CREATE TEMP TABLE countries AS
SELECT substr(line, 1, 2) AS cc, trim(substr(line, 4)) AS country
FROM (SELECT unnest(string_split(content, chr(10))) AS line FROM read_text('${raw}/ghcnd-countries.txt'))
WHERE length(line) > 0;

CREATE TEMP TABLE days AS
PIVOT (SELECT * FROM obs WHERE id IN (SELECT id FROM kept))
ON doy IN (${doys}) USING first(v) GROUP BY id;

CREATE TEMP TABLE sheet AS
SELECT s.name AS "Station",
       CASE WHEN substr(d.id, 1, 2) IN ('US', 'CA') AND s.state <> '' THEN s.state || ', ' || c.country ELSE c.country END AS "Place",
       s.lat AS "Latitude",
       ${days}
FROM days d JOIN stations s USING (id) JOIN countries c ON c.cc = substr(d.id, 1, 2)
ORDER BY s.lat DESC, d.id;

-- Every kept station found its name and country.
SELECT CASE WHEN (SELECT count(*) FROM sheet) <> (SELECT count(*) FROM kept)
    THEN error('prep: a kept station has no row in ghcnd-stations.txt or no country') END;

COPY sheet TO 'ghcn-2025-tmax.parquet' (
    FORMAT parquet,
    COMPRESSION zstd,
    ROW_GROUP_SIZE 2048,
    KV_METADATA {
        'observatory.credit': 'Daily highs: NOAA NCEI GHCN-Daily, Version ${version}',
        'observatory.source': 'https://noaa-ghcn-pds.s3.amazonaws.com/csv.gz/by_year/2025.csv.gz',
        'observatory.fetched': '${fetched}'
    }
);
