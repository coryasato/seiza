-- Market watch's instruments: the feed's 50 fictional instruments
-- (contenders/market/feed.ts's INSTRUMENTS, their one home), as the table's
-- 12 columns draw them at the open: each price its reference, no change,
-- sizes and volume 0. The feed then moves them, and each side's store starts
-- from the same values. A row's place is its instrument's index in the
-- feed's ticks, so the rows keep INSTRUMENTS' order. prep.ts substitutes
-- the rows below, one `(index, symbol, name, price)` each, the price as
-- text, parsed by DuckDB to the nearest double.
--
-- One row group, ZSTD: the file is a few KiB.

CREATE TEMP TABLE instruments (i INTEGER, symbol VARCHAR, name VARCHAR, price DOUBLE);
INSERT INTO instruments VALUES
${values};

COPY (
    SELECT symbol AS "Symbol",
           name AS "Name",
           price AS "Last",
           0::DOUBLE AS "Change",
           0::DOUBLE AS "Change %",
           price AS "Bid",
           price AS "Ask",
           0::INTEGER AS "Bid size",
           0::INTEGER AS "Ask size",
           0::BIGINT AS "Volume",
           price AS "High",
           price AS "Low"
    FROM instruments
    ORDER BY i
) TO 'market-instruments.parquet' (
    FORMAT parquet,
    COMPRESSION zstd,
    KV_METADATA {
        'observatory.credit': 'Fictional instruments, the observatory''s own: synthetic',
        'observatory.source': 'apps/observatory/contenders/market/feed.ts'
    }
);
