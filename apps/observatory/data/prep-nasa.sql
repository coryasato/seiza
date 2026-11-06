-- Live tail's file: NASA Kennedy Space Center's web server log, July 1995,
-- from the Internet Traffic Archive (docs/DECISIONS.md, "Scenarios", for
-- every rule below). prep.ts checks the source against its pin in
-- MANIFEST.json first, then substitutes raw (its directory), rowGroup (the
-- rows a row group holds), and fetched, each written as a dollar sign and
-- the name in braces (COPY options must be constants).
--
-- A line is `host - - [01/Jul/1995:00:00:01 -0400] "request" status bytes`.
-- In this order:
-- 1. a line that doesn't parse is dropped: the file's truncated last line,
--    and the 11 with bytes outside printable ASCII (8 of them not UTF-8,
--    which the reader skips, the 3 others control bytes);
-- 2. the host is never read;
-- 3. each request's query string is cut (`?` up to the protocol);
-- 4. a request still holding `@` is dropped (e-mail addresses, most of them
--    a visitor's `From:` header run into the request line);
-- 5. a request for a `~` path not served (status 400 or more) is dropped
--    (a home directory named by a visitor).
-- The columns: time (the log's wall time, −0400, as a zoneless TIMESTAMP),
-- request, status (USMALLINT), bytes (UINTEGER, NULL where the log has `-`).
-- The rows keep the log's order, which is its time's. Row groups of 30,720
-- rows (rowGroup): smaller ones grow the file (2,048 doubles it) and slow a
-- page's read (perf/results/2026-11-06-m11-a1.md).

CREATE TEMP TABLE read AS
SELECT line
FROM read_csv('${raw}/NASA_access_log_Jul95.gz', columns = {'line': 'VARCHAR'},
    delim = '\x01', quote = '', escape = '', header = false, auto_detect = false,
    strict_mode = false, ignore_errors = true, store_rejects = true);

-- The only lines the reader may skip are those that aren't UTF-8 (rule 1).
SELECT CASE WHEN (SELECT count(*) FROM reject_errors WHERE error_type <> 'INVALID ENCODING') > 0
    THEN error('prep: the reader skipped a line for another reason than its encoding') END;

-- A table keeps its rows in the order inserted, the log's.
CREATE TEMP TABLE lines AS SELECT rowid AS n, line FROM read;

-- The log's own shape, every byte printable ASCII (so a line with any other
-- byte fails it, as does the truncated last line).
CREATE TEMP TABLE parsed AS
SELECT n,
       regexp_extract(line, '^[!-~]+ - - \[([^\]]+)\] "([ -~]*)" ([0-9]{3}) ([0-9]+|-)$', ['t', 'request', 'status', 'bytes']) AS f
FROM lines;

CREATE TEMP TABLE logged AS
SELECT n,
       f.t AS t,
       regexp_replace(f.request, '\?[^ ]*', '') AS request,
       f.status::USMALLINT AS status,
       CASE WHEN f.bytes = '-' THEN NULL ELSE f.bytes::UINTEGER END AS bytes
FROM parsed
WHERE f.t <> '';

-- Every kept line's zone is the log's: the wall time below drops it.
SELECT CASE WHEN (SELECT count(*) FROM logged WHERE t NOT LIKE '% -0400') > 0
    THEN error('prep: a line outside the log''s zone (-0400)') END;

CREATE TEMP TABLE tail AS
SELECT n,
       strptime(left(t, 20), '%d/%b/%Y:%H:%M:%S') AS "time",
       request AS "request",
       status AS "status",
       bytes AS "bytes"
FROM logged
WHERE request NOT LIKE '%@%'
  AND NOT (request LIKE '%/~%' AND status >= 400);

-- The log is in time order, so the rows' order is the replay's.
SELECT CASE WHEN (SELECT count(*) FROM (SELECT "time" < lag("time") OVER (ORDER BY n) AS back FROM tail) WHERE back) > 0
    THEN error('prep: the log runs backwards') END;

COPY (SELECT "time", "request", "status", "bytes" FROM tail ORDER BY n) TO 'nasa-http-jul95.parquet' (
    FORMAT parquet,
    COMPRESSION zstd,
    ROW_GROUP_SIZE ${rowGroup},
    KV_METADATA {
        'observatory.credit': 'NASA-HTTP: Jim Dumoulin, NASA Kennedy Space Center; contributed by Martin Arlitt and Carey Williamson, University of Saskatchewan',
        'observatory.source': 'https://ita.ee.lbl.gov/traces/NASA_access_log_Jul95.gz',
        'observatory.fetched': '${fetched}'
    }
);
