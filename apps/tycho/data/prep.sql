-- Turns the raw SBDB pages (fetch_asteroids.ts) into Tycho's asteroid sample:
-- asteroids.parquet (the "Try sample" button) and fixtures/asteroids.csv (the
-- M6 fixture). prep.ts runs this with native DuckDB (@duckdb/node-api, 1.4.x
-- like the wasm engine) from apps/tycho/data/. From raw/asteroids/fetch.json
-- it sets the variable api_count (rows the API reported) and substitutes
-- ${fetched} (the fetch date, YYYY-MM-DD; COPY options must be constants).
-- The writer settings: ZSTD, and 30,720-row groups, chosen in M4 by measured
-- page latency and bytes (perf/results/2026-09-25-m4.md): the table reads one
-- page with a file_row_number filter, which DuckDB answers from one group.

-- One row per raw API row. Each page is {fields, data: [[...], ...], count}.
CREATE TEMP TABLE raw AS
SELECT unnest(data) AS r, filename AS page
FROM read_json('raw/asteroids/page-*.json', columns = {data: 'JSON[]'}, filename = true, maximum_object_size = 200000000);

-- Typed columns, in PLAN.md's order, spkid first (the key and the sort).
-- The API sends numbers as strings; every non-null value must cast (checked
-- below). full_name comes left-padded to align numbers; trimmed here.
-- first_obs is sometimes year-only ('2015-??-??'); those become NULL and are
-- counted in MANIFEST.json.
CREATE TEMP TABLE typed AS
SELECT
    (r->>0)::BIGINT AS spkid,
    trim(r->>1) AS full_name,
    r->>2 AS pdes,
    r->>3 AS name,
    CASE (r->>4) WHEN 'Y' THEN true WHEN 'N' THEN false END AS neo,
    CASE (r->>5) WHEN 'Y' THEN true WHEN 'N' THEN false END AS pha,
    r->>6 AS class,
    TRY_CAST(r->>7 AS DOUBLE) AS H,
    TRY_CAST(r->>8 AS DOUBLE) AS diameter,
    TRY_CAST(r->>9 AS DOUBLE) AS albedo,
    TRY_CAST(r->>10 AS DOUBLE) AS a,
    TRY_CAST(r->>11 AS DOUBLE) AS e,
    TRY_CAST(r->>12 AS DOUBLE) AS i,
    TRY_CAST(r->>13 AS DOUBLE) AS q,
    TRY_CAST(r->>14 AS DOUBLE) AS per_y,
    TRY_CAST(r->>15 AS DATE) AS first_obs,
    TRY_CAST(r->>16 AS DATE) AS last_obs,
    TRY_CAST(r->>17 AS INTEGER) AS n_obs_used,
    r,
    page
FROM raw;

-- Fail on any value a cast dropped, except the known year-only first_obs.
SELECT CASE WHEN count(*) > 0 THEN error('prep: ' || count(*) || ' values failed to cast, e.g. ' || any_value(r::VARCHAR)) END
FROM typed
WHERE ((r->>4) IS NOT NULL AND neo IS NULL)
   OR ((r->>5) IS NOT NULL AND pha IS NULL)
   OR ((r->>7) IS NOT NULL AND H IS NULL)
   OR ((r->>8) IS NOT NULL AND diameter IS NULL)
   OR ((r->>9) IS NOT NULL AND albedo IS NULL)
   OR ((r->>10) IS NOT NULL AND a IS NULL)
   OR ((r->>11) IS NOT NULL AND e IS NULL)
   OR ((r->>12) IS NOT NULL AND i IS NULL)
   OR ((r->>13) IS NOT NULL AND q IS NULL)
   OR ((r->>14) IS NOT NULL AND per_y IS NULL)
   OR ((r->>15) IS NOT NULL AND first_obs IS NULL AND NOT regexp_full_match(r->>15, '\d{4}-\?\?-\?\?'))
   OR ((r->>16) IS NOT NULL AND last_obs IS NULL)
   OR ((r->>17) IS NOT NULL AND n_obs_used IS NULL);

-- The catalog can change between pages: keep one row per spkid, from the
-- latest page.
CREATE TABLE asteroids AS
SELECT * EXCLUDE (r, page)
FROM typed
QUALIFY row_number() OVER (PARTITION BY spkid ORDER BY page DESC) = 1
ORDER BY spkid;

SELECT CASE WHEN (SELECT count(*) FROM asteroids) <> getvariable('api_count')
    THEN error('prep: ' || (SELECT count(*) FROM asteroids) || ' unique rows, but the API reported ' || getvariable('api_count') || '; fetch again with --refresh')
END;

-- Row 1 is (1) Ceres, as the sample promises.
SELECT CASE WHEN (SELECT full_name FROM asteroids ORDER BY spkid LIMIT 1) <> '1 Ceres (A801 AA)'
    THEN error('prep: the first row isn''t Ceres')
END;

-- The Parquet file. The fetch date and credit ride along as key/value
-- metadata, so the app reads them with parquet_kv_metadata, no extra file.
COPY (SELECT * FROM asteroids ORDER BY spkid) TO 'asteroids.parquet' (
    FORMAT parquet,
    COMPRESSION zstd,
    ROW_GROUP_SIZE 30720,
    KV_METADATA {
        'tycho.credit': 'Asteroid data: NASA/JPL Small-Body Database',
        'tycho.source': 'https://ssd-api.jpl.nasa.gov/sbdb_query.api',
        'tycho.fetched': '${fetched}'
    }
);

-- The M6 fixture: the same rows as CSV, then the hand-written tricky rows
-- (quoted commas, newlines, and quotes in names). INSERT casts their text
-- to the table's types.
CREATE TEMP TABLE fixture AS SELECT *, 0 AS part FROM asteroids;
INSERT INTO fixture BY NAME
SELECT *, 1 AS part FROM read_csv('fixtures-src/tricky_rows.csv', header = true, all_varchar = true);

SELECT CASE WHEN count(*) <> count(DISTINCT spkid) THEN error('prep: a tricky row reuses an spkid') END FROM fixture;

COPY (SELECT * EXCLUDE (part) FROM fixture ORDER BY part, spkid) TO 'fixtures/asteroids.csv' (FORMAT csv, HEADER true);
