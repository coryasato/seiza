-- The monitoring wall's instruments: its 400 fictional instruments in 8
-- desks of 50 (contenders/wall/instruments.ts, their one home), as its
-- tables draw them at the open: each price its reference, no change, volume
-- 0. The feed then moves them, and each side's store starts from the same
-- values. A row's place is its instrument's index in the feed's ticks, and
-- a desk is 50 rows in a run, so a table reads its desk's rows by range.
-- prep.ts substitutes the rows below, one `(index, desk, symbol, price)`
-- each, the price as text, parsed by DuckDB to the nearest double.
--
-- One row group, ZSTD: the file is a few KiB.

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
) TO 'wall-instruments.parquet' (
    FORMAT parquet,
    COMPRESSION zstd,
    KV_METADATA {
        'observatory.credit': 'Fictional instruments, the observatory''s own: synthetic',
        'observatory.source': 'apps/observatory/contenders/wall/instruments.ts'
    }
);
