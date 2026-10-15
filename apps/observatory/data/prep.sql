-- The Observatory's asteroid file: Tycho's asteroids.parquet (prep.ts checks
-- its SHA-256 against Tycho's MANIFEST.json first) with fewer columns, small
-- enough for a Workers static asset (25 MiB per file). Every row is kept, in
-- the same order. prep.ts substitutes ${source} (the source file's path) and
-- ${fetched} (its fetch date; COPY options must be constants).
--
-- The columns: one of each kind the tall table's base level draws (integer:
-- spkid; text: full_name, class; boolean: neo, pha; float: H through e; date:
-- first_obs), the readable name rather than the designations (pdes, name),
-- and the two mostly-NULL floats (diameter, albedo), so both sides draw
-- empty cells. Dropped for size: pdes, name, i, q, per_y, last_obs,
-- n_obs_used.
--
-- The writer settings are Tycho's: ZSTD and 30,720-row groups, so a page
-- costs the same reads as Tycho's file (its docs/DECISIONS.md, "Table").

CREATE TEMP VIEW source AS
SELECT spkid, full_name, class, neo, pha, H, diameter, albedo, a, e, first_obs
FROM read_parquet('${source}');

COPY (SELECT * FROM source ORDER BY spkid) TO 'asteroids.parquet' (
    FORMAT parquet,
    COMPRESSION zstd,
    ROW_GROUP_SIZE 30720,
    KV_METADATA {
        'observatory.credit': 'Asteroid data: NASA/JPL Small-Body Database',
        'observatory.source': 'https://ssd-api.jpl.nasa.gov/sbdb_query.api',
        'observatory.fetched': '${fetched}'
    }
);

-- Every kept value survives, row for row, and nothing else is there.
SELECT CASE WHEN (SELECT count(*) FROM (
    (SELECT * FROM source EXCEPT ALL SELECT * FROM read_parquet('asteroids.parquet'))
    UNION ALL
    (SELECT * FROM read_parquet('asteroids.parquet') EXCEPT ALL SELECT * FROM source)
)) > 0 THEN error('prep: asteroids.parquet differs from its source in the kept columns') END;
