-- The admin table's countries: the world's regions from CLDR, as countries.ts
-- derives them (each name in its own language and in English, the flag, the
-- capitals from Wikidata, the population as the canvas writes it). prep.ts
-- substitutes the rows below, one `(code, flag, name, english, capital,
-- population)` each, as text; the code isn't written, but breaks the sort's
-- ties. The columns are the canvas's, every one text (the base level's
-- kinds): the population is prep's text, never a number.
--
-- Sorted by the English name, accents and case aside (DuckDB's collation,
-- pinned with the data's lockfile), the code breaking ties. One row group,
-- ZSTD: the file is a few KiB.

CREATE TEMP TABLE countries (code VARCHAR, flag VARCHAR, name VARCHAR, english VARCHAR, capital VARCHAR, population VARCHAR);
INSERT INTO countries VALUES
${values};

COPY (
    SELECT flag AS "flag",
           name AS "name",
           english AS "in English",
           capital AS "capital",
           population AS "population"
    FROM countries
    ORDER BY english COLLATE NOACCENT.NOCASE, code
) TO '${out}' (
    FORMAT parquet,
    COMPRESSION zstd,
    KV_METADATA {
        'observatory.credit': '${credit}',
        'observatory.source': '${source}'
    }
);
