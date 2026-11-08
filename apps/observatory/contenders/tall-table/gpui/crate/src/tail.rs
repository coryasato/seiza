//! Live tail's replay over its file (`docs/DECISIONS.md`, "Scenarios"): the
//! page SQL over the looping rows, and the time's text. Row *i* of the
//! replay is the file's row *i* mod *n*, its time moved on by ⌊*i* / *n*⌋
//! spans, so the log never runs backwards; each side formats the
//! `TIMESTAMP` it reads. Both are pinned by the tall table's fixtures
//! (`sql.json`'s `live-tail`, `cells.json`'s `timestamp_text`), which the
//! TanStack contender's `src/data/tail.ts` runs too.

use std::fmt::Write as _;
use std::ops::Range;

use seiza_duckdb::sql::string_literal;
use seiza_duckdb::tall_table::PageQuery;

/// The name the file fetched whole is registered under (the TS side's
/// `contenders/tail/data.ts`, `WHOLE_FILE`).
pub const WHOLE_FILE: &str = "nasa-http-jul95.whole.parquet";
/// The file's rows (`FILE_ROWS`).
pub const FILE_ROWS: u64 = 1_890_983;
/// The file's first row's time to its last's, s (`SPAN_S`).
pub const SPAN_S: u64 = 2_381_544;

/// The replay's pages: one SELECT per lap a page crosses, joined in row
/// order.
#[derive(Debug, Clone, PartialEq)]
pub struct TailQuery {
    file: String,
    file_rows: u64,
    span_s: u64,
}

impl TailQuery {
    pub fn new(file: impl Into<String>, file_rows: u64, span_s: u64) -> Self {
        Self {
            file: file.into(),
            file_rows,
            span_s,
        }
    }
}

impl Default for TailQuery {
    fn default() -> Self {
        Self::new(WHOLE_FILE, FILE_ROWS, SPAN_S)
    }
}

impl PageQuery for TailQuery {
    fn page_sql(&self, rows: Range<u64>) -> String {
        let n = self.file_rows;
        let file = string_literal(&self.file);
        let parts: Vec<String> = (rows.start / n..=(rows.end.max(rows.start + 1) - 1) / n)
            .map(|lap| {
                let base = lap * n;
                let lo = rows.start.max(base) - base;
                let hi = rows.end.min(base + n) - base;
                format!(
                    "SELECT \"time\" + to_seconds({shift}) AS \"time\", request, status, bytes, \
                     file_row_number + {base} AS r FROM read_parquet({file}, file_row_number = true) \
                     WHERE file_row_number >= {lo} AND file_row_number < {hi}",
                    shift = lap * self.span_s,
                )
            })
            .collect();
        format!(
            "SELECT \"time\", request, status, bytes FROM ({}) ORDER BY r",
            parts.join(" UNION ALL ")
        )
    }
}

const MONTHS: [&str; 12] = [
    "Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec",
];

/// A zoneless `TIMESTAMP` (µs from the epoch) as the log wrote it, its wall
/// time as it stands: `13/Jul/1995 03:14:02`, always 20 characters for a
/// four-digit year; the fraction of a second is dropped.
pub fn time_text(micros: i64) -> String {
    let seconds = micros.div_euclid(1_000_000);
    let (days, of_day) = (seconds.div_euclid(86_400), seconds.rem_euclid(86_400));
    let (year, month, day) = civil_from_days(days);
    let mut text = String::with_capacity(20);
    let _ = write!(
        text,
        "{day:02}/{}/{year:04} {:02}:{:02}:{:02}",
        MONTHS[month as usize - 1],
        of_day / 3600,
        of_day / 60 % 60,
        of_day % 60
    );
    text
}

/// Days from 1970-01-01 → (year, month 1–12, day 1–31), proleptic
/// Gregorian (Howard Hinnant's `civil_from_days`).
fn civil_from_days(days: i64) -> (i64, u32, u32) {
    let z = days + 719_468;
    let era = z.div_euclid(146_097);
    let doe = z.rem_euclid(146_097);
    let yoe = (doe - doe / 1460 + doe / 36_524 - doe / 146_096) / 365;
    let doy = doe - (365 * yoe + yoe / 4 - yoe / 100);
    let mp = (5 * doy + 2) / 153;
    let day = (doy - (153 * mp + 2) / 5 + 1) as u32;
    let month = if mp < 10 { mp + 3 } else { mp - 9 } as u32;
    let year = yoe + era * 400 + i64::from(month <= 2);
    (year, month, day)
}

#[cfg(test)]
mod tests {
    //! The tall table's fixtures for live tail, as the TanStack contender's
    //! `test/tail.test.ts` runs them: the loop's page SQL and the time's
    //! text, each with its controls.

    use super::*;
    use serde_json::Value;

    const SQL_FIXTURE: &str =
        include_str!("../../../../../../../components/tall-table/fixtures/sql.json");
    const CELLS_FIXTURE: &str =
        include_str!("../../../../../../../components/tall-table/fixtures/cells.json");

    fn section() -> Value {
        let fixture: Value = serde_json::from_str(SQL_FIXTURE).unwrap();
        fixture["scenarios"]["live-tail"].clone()
    }

    /// The fixture's pages that `page_sql` doesn't write.
    fn sql_mismatches(page_sql: impl Fn(Range<u64>) -> String) -> Vec<String> {
        let section = section();
        assert_eq!(section["query"], "loop");
        let mut mismatches = Vec::new();
        for page in section["pages"].as_array().unwrap() {
            let rows = page["rows"][0].as_u64().unwrap()..page["rows"][1].as_u64().unwrap();
            let sql = page_sql(rows.clone());
            if sql != page["sql"] {
                mismatches.push(format!("{rows:?}: {sql}"));
            }
        }
        mismatches
    }

    #[test]
    fn the_constants_are_the_fixtures() {
        let section = section();
        assert_eq!(section["loop_file"], WHOLE_FILE);
        assert_eq!(section["file_rows"], FILE_ROWS);
        assert_eq!(section["span_s"], SPAN_S);
    }

    #[test]
    fn tail_sql_fixture() {
        let query = TailQuery::default();
        let mismatches = sql_mismatches(|rows| query.page_sql(rows));
        assert!(mismatches.is_empty(), "{mismatches:#?}");
        // It reaches past a lap and across a seam.
        let pages = section()["pages"].as_array().unwrap().clone();
        let laps = |page: &Value| {
            let rows = page["rows"].as_array().unwrap();
            (
                rows[0].as_u64().unwrap() / FILE_ROWS,
                (rows[1].as_u64().unwrap() - 1) / FILE_ROWS,
            )
        };
        assert!(
            pages.iter().any(|page| laps(page).0 != laps(page).1),
            "a page across a seam"
        );
        assert!(
            pages.iter().any(|page| laps(page).0 >= 2),
            "a page past several laps"
        );
    }

    #[test]
    fn tail_sql_controls_fail() {
        let no_shift = TailQuery::new(WHOLE_FILE, FILE_ROWS, 0);
        assert!(
            !sql_mismatches(|rows| no_shift.page_sql(rows)).is_empty(),
            "no shift"
        );
        // A page across a seam read as one SELECT of the first lap's file
        // rows, past its end: the next lap's rows are never read.
        let one_select = |rows: Range<u64>| {
            let base = rows.start / FILE_ROWS * FILE_ROWS;
            let lap_end = base + FILE_ROWS;
            let sql = TailQuery::default().page_sql(rows.start..rows.end.min(lap_end));
            if rows.end <= lap_end {
                return sql;
            }
            let past = sql.replace(
                &format!("file_row_number < {FILE_ROWS})"),
                &format!("file_row_number < {})", rows.end - base),
            );
            assert_ne!(past, sql, "the control reads past the lap's end");
            past
        };
        assert!(
            !sql_mismatches(one_select).is_empty(),
            "the seam read as one SELECT"
        );
        let lap_off = TailQuery::new(WHOLE_FILE, FILE_ROWS + 1, SPAN_S);
        assert!(
            !sql_mismatches(|rows| lap_off.page_sql(rows)).is_empty(),
            "a lap off by one"
        );
    }

    /// The cases whose text `text` doesn't write.
    fn text_mismatches(text: impl Fn(i64) -> String) -> Vec<String> {
        let fixture: Value = serde_json::from_str(CELLS_FIXTURE).unwrap();
        let cases = fixture["timestamp_text"]["cases"].as_array().unwrap();
        assert!(cases.len() >= 6);
        cases
            .iter()
            .filter_map(|case| {
                let micros = case["micros"].as_i64().unwrap();
                let shown = text(micros);
                (shown != case["text"]).then(|| format!("{micros}: {shown}"))
            })
            .collect()
    }

    #[test]
    fn timestamp_text_fixture() {
        let mismatches = text_mismatches(time_text);
        assert!(mismatches.is_empty(), "{mismatches:#?}");
    }

    #[test]
    fn timestamp_text_controls_fail() {
        let unpadded = |micros| {
            let text = time_text(micros);
            text.strip_prefix('0').map(str::to_owned).unwrap_or(text)
        };
        assert!(!text_mismatches(unpadded).is_empty(), "an unpadded day");
        let numeric = |micros| {
            let text = time_text(micros);
            let month = MONTHS.iter().position(|m| text[3..6] == **m).unwrap() + 1;
            format!("{}{month:02}{}", &text[..3], &text[6..])
        };
        assert!(!text_mismatches(numeric).is_empty(), "a numeric month");
        // The value read as a UTC instant and shown in the log's own zone
        // (−0400 in July), as a local-time conversion in New York would.
        let local = |micros| time_text(micros - 4 * 3_600_000_000);
        assert!(
            !text_mismatches(local).is_empty(),
            "a local-time conversion"
        );
    }
}
