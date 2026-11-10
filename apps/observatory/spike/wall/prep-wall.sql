-- Draft (throwaway): the monitoring wall's instruments as its
-- tables draw them at the open: each price its reference, no change, volume
-- 0. A row's place is its instrument's index in the feed's ticks; a desk is
-- 50 rows in a run, so a table reads its desk's rows by range.
CREATE TEMP TABLE instruments (i INTEGER, desk VARCHAR, symbol VARCHAR, price DOUBLE);
INSERT INTO instruments VALUES
${values};

COPY (
    SELECT desk AS "Desk",
           symbol AS "Symbol",
           price AS "Last",
           0::DOUBLE AS "Change %",
           0::BIGINT AS "Volume"
    FROM instruments
    ORDER BY i
) TO '${out}' (
    FORMAT parquet,
    COMPRESSION zstd,
    KV_METADATA {
        'observatory.credit': 'Fictional instruments, the observatory''s own: synthetic'
    }
);
