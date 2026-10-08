-- Turns the raw Gaia DR3 extracts (fetch_gaia.ts: one Parquet file per HATS
-- partition, stars brighter than its RAW_CUT) into Tycho's big sample,
-- gaia-dr3-bright.parquet (the "Big: 25M Gaia stars" button). prep.ts runs
-- this with native DuckDB from apps/tycho/data/ and substitutes ${cut} (the
-- magnitude cut, PLAN.md's pending decision) and, in the write section, ${out}
-- and ${row_group} (COPY options must be constants). It sets the variable
-- archive_rows: the ESA archive's own count of DR3 sources under the cut.

-- One row per star, PLAN.md's columns in its order. distance_pc is
-- 1000 / parallax, only where the parallax is positive: an approximation
-- (it ignores parallax errors, and is poor where they're large).
-- DISTINCT: two HATS partitions (Norder=3/Npix=29, Norder=4/Npix=115) hold
-- some stars two or three times, identical copies (fetched 2026-10-07).
CREATE TABLE gaia AS
SELECT DISTINCT
    source_id,
    ra,
    dec,
    parallax,
    CASE WHEN parallax > 0 THEN 1000 / parallax END AS distance_pc,
    pmra,
    pmdec,
    phot_g_mean_mag,
    bp_rp,
    radial_velocity,
    teff_gspphot
FROM read_parquet('raw/gaia/*.parquet')
WHERE phot_g_mean_mag < ${cut}
ORDER BY source_id;

-- One row per star (copies that differ would survive DISTINCT), and every
-- star the archive counts under the cut.
SELECT CASE WHEN count(*) <> count(DISTINCT source_id) THEN error('prep: ' || (count(*) - count(DISTINCT source_id)) || ' duplicate source_ids') END FROM gaia;
SELECT CASE WHEN (SELECT count(*) FROM gaia) <> getvariable('archive_rows')
    THEN error('prep: ' || (SELECT count(*) FROM gaia) || ' stars at G < ${cut}, but the ESA archive counts ' || getvariable('archive_rows') || '; fetch again with --refresh')
END;

-- @write
-- Run once per output file.
-- The credit is ESA's required acknowledgement, word for word (PLAN.md);
-- the app adds the final period. It rides in the key/value metadata, like
-- the asteroids' credit, so the app reads it with parquet_kv_metadata.
-- The table is already in source_id order, and a plain scan keeps it
-- (preserve_insertion_order, on by default), so each file isn't sorted again.
COPY gaia TO '${out}' (
    FORMAT parquet,
    COMPRESSION zstd,
    ROW_GROUP_SIZE ${row_group},
    KV_METADATA {
        'tycho.credit': 'This work has made use of data from the European Space Agency (ESA) mission Gaia, processed by the Gaia Data Processing and Analysis Consortium (DPAC)',
        'tycho.source': 'Gaia DR3 gaia_source, HATS Parquet at s3://stpubdata/gaia/gaia_dr3/public/hats/gaia',
        'tycho.cut': 'phot_g_mean_mag < ${cut}'
    }
);
