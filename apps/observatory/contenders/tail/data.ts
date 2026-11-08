/**
 * Live tail's file and the replay's constants, one home for the TS side
 * (`docs/DECISIONS.md`, "Scenarios"). The GPUI contender's copies
 * (`contenders/tall-table/gpui/crate/src/tail.rs`) are checked against the
 * same fixture (`components/tall-table/fixtures/sql.json`, `live-tail`), and
 * prep (`data/prep.ts`) fails unless the file it builds has these rows and
 * this span. Nothing here touches the browser.
 */

/** The data file, served by range at `DATA` (`contenders/paths.ts`). */
export const DATA_FILE = 'nasa-http-jul95.parquet';
/** The name the file fetched whole is registered under (`registerFile`):
 *  every page of the feed reads it, never the ranged copy. */
export const WHOLE_FILE = 'nasa-http-jul95.whole.parquet';
/** The file's rows: row i of the replay is the file's row i mod this. */
export const FILE_ROWS = 1_890_983;
/** The file's first row's time to its last's, s: a lap moves the time on by it. */
export const SPAN_S = 2_381_544;
