//! The filter editor's preview (the design canvas's Filter 1 and 3): which
//! of a number's or a time's bars the filter being written keeps, from the
//! profile the panel has read, at once as the visitor types: nothing is
//! queried (`docs/DECISIONS.md`, "Scope", 2026-11-20). The bars and their
//! words are `crate::panel`'s; the bins' range is `Profile::span`.

use seiza_duckdb::sql::ColumnInfo;

use crate::filter::{Kind, Op, Value, iso_time, typed_value};
use crate::profile::BINS;

/// For each of [`BINS`] bins over `span` (positions, as `Profile::span`
/// has them), whether `column` filtered by `op` and `values` (as typed)
/// keeps any of the values it can hold. None for a column with no bars, an
/// operator the column doesn't take, or a value not yet one of its type:
/// the bars are then drawn as the profile's, none marked.
pub fn keeps(
    column: &ColumnInfo,
    op: &str,
    values: &[String],
    span: (f64, f64),
) -> Option<Vec<bool>> {
    let kind = Kind::of(column);
    if !matches!(kind, Kind::Number | Kind::Time) {
        return None;
    }
    let op = Op::read(op)?;
    if !op.takes(kind) {
        return None;
    }
    let at = values
        .iter()
        .map(|value| position(column, kind, value))
        .collect::<Option<Vec<f64>>>()?;
    let whole = whole_numbers(column);
    let all = || bins(span, whole);
    let one = |test: &dyn Fn(Bin, f64) -> bool| -> Option<Vec<bool>> {
        let value = *at.first()?;
        Some(all().map(|bin| test(bin, value)).collect())
    };
    match op {
        Op::Ge => one(&|bin, v| bin.reaches(v)),
        Op::Gt => one(&|bin, v| bin.max > v),
        Op::Le => one(&|bin, v| bin.min <= v),
        Op::Lt => one(&|bin, v| bin.min < v),
        Op::Eq => one(&|bin, v| bin.holds(v)),
        // Every bar but one that can hold nothing but the value left out.
        Op::Ne => one(&|bin, v| bin.holds_any() && !bin.only(v)),
        Op::In if !at.is_empty() => {
            Some(all().map(|bin| at.iter().any(|v| bin.holds(*v))).collect())
        }
        Op::Between => {
            let (from, to) = (*at.first()?, *at.get(1)?);
            // `BETWEEN` with its ends the wrong way round keeps nothing.
            Some(
                all()
                    .map(|bin| bin.min <= to && bin.reaches(from) && from <= to)
                    .collect(),
            )
        }
        // The bars are of values: a null is in none of them.
        Op::IsNull => Some(vec![false; BINS]),
        Op::NotNull => Some(all().map(Bin::holds_any).collect()),
        _ => None,
    }
}

/// The values a bin can hold: `min` up to `max`, `max` itself too unless
/// `open` (every bin but the last, of a column whose values aren't whole).
/// A bin that can hold none has `min` +∞ and `max` -∞, so every test fails.
#[derive(Clone, Copy)]
struct Bin {
    min: f64,
    max: f64,
    open: bool,
}

impl Bin {
    const NONE: Bin = Bin {
        min: f64::INFINITY,
        max: f64::NEG_INFINITY,
        open: false,
    };

    /// Whether it can hold a value at `v` or above.
    fn reaches(self, v: f64) -> bool {
        self.max > v || (!self.open && self.max >= v)
    }

    fn holds(self, v: f64) -> bool {
        self.min <= v && self.reaches(v)
    }

    fn holds_any(self) -> bool {
        self.min < self.max || (self.min == self.max && !self.open)
    }

    /// Whether `v` is the one value it can hold.
    fn only(self, v: f64) -> bool {
        self.min == v && self.max == v && !self.open
    }
}

/// Whether `column`'s values are whole numbers: its bins then hold the
/// whole numbers in their range, so a bin from 7 up to 8 holds 7 alone.
fn whole_numbers(column: &ColumnInfo) -> bool {
    matches!(
        column.data_type.as_str(),
        "TINYINT"
            | "SMALLINT"
            | "INTEGER"
            | "BIGINT"
            | "HUGEINT"
            | "UTINYINT"
            | "USMALLINT"
            | "UINTEGER"
            | "UBIGINT"
            | "UHUGEINT"
    )
}

/// The bins over `span` as the profile's SQL cuts them (`bin_sql`): a bin
/// from `lo + i·w` up to `lo + (i+1)·w`, the last its top too; a range of
/// one value all in the first. `whole`: the values are whole numbers, each
/// in the bin the SQL's own sum puts it in.
fn bins((lo, hi): (f64, f64), whole: bool) -> impl Iterator<Item = Bin> {
    let width = (hi - lo) / BINS as f64;
    // `bin_sql`'s sum, in the same order of operations: an edge `lo + i·w`
    // can round either side of a whole number (0 to 332: 15·16.6 is
    // 249.00000000000003, yet 249 is bin 15's).
    let bin_of = move |v: f64| {
        ((v - lo) / (hi - lo) * BINS as f64)
            .floor()
            .min((BINS - 1) as f64)
    };
    let (least, most) = (lo.ceil(), hi.floor());
    // The least whole number from `least` whose bin is `i` or past it,
    // found from the edge a step or two either way (past 2^53 a step is
    // no step, so a few at most).
    let first_of = move |i: usize| -> f64 {
        let i = i as f64;
        let mut v = (lo + i * width).ceil().max(least);
        for _ in 0..4 {
            if v > least && bin_of(v - 1.0) >= i {
                v -= 1.0;
            }
        }
        for _ in 0..4 {
            if bin_of(v) < i {
                v += 1.0;
            }
        }
        v
    };
    (0..BINS).map(move |i| {
        if hi == lo {
            // The one value is the first bin's; the rest hold none.
            return if i == 0 {
                Bin {
                    min: lo,
                    max: lo,
                    open: false,
                }
            } else {
                Bin::NONE
            };
        }
        let last = i + 1 == BINS;
        let from = lo + i as f64 * width;
        let to = if last {
            hi
        } else {
            lo + (i + 1) as f64 * width
        };
        if !whole {
            return Bin {
                min: from,
                max: to,
                open: !last,
            };
        }
        // The whole numbers the SQL bins here: from this bin's first up to
        // the next's (the top too in the last).
        let min = if i == 0 { least } else { first_of(i) };
        let max = if last { most } else { first_of(i + 1) - 1.0 };
        if min > max {
            Bin::NONE
        } else {
            Bin {
                min,
                max,
                open: false,
            }
        }
    })
}

/// `text` as a position: a number as itself, a date or a timestamp as its
/// seconds since the epoch, as the profile's `epoch(v)` has it (a zone's
/// offset aside: the bars are a preview).
fn position(column: &ColumnInfo, kind: Kind, text: &str) -> Option<f64> {
    match kind {
        Kind::Number => match typed_value(column, text) {
            Value::Number(number) => number.as_f64().filter(|value| value.is_finite()),
            _ => None,
        },
        Kind::Time => epoch_seconds(&iso_time(text, column.data_type.starts_with("TIMESTAMP"))?),
        _ => None,
    }
}

/// A time's position (seconds since 1970-01-01, UTC) as its date,
/// `1957-10-04` (`0044-03-15 (BC)` before year 1): the bars' ends.
pub fn date_of(seconds: f64) -> String {
    let days = (seconds / 86_400.0).floor() as i64;
    // The civil date from days (Howard Hinnant's algorithm).
    let z = days + 719_468;
    let era = z.div_euclid(146_097);
    let doe = z - era * 146_097;
    let yoe = (doe - doe / 1460 + doe / 36_524 - doe / 146_096) / 365;
    let doy = doe - (365 * yoe + yoe / 4 - yoe / 100);
    let mp = (5 * doy + 2) / 153;
    let day = doy - (153 * mp + 2) / 5 + 1;
    let month = if mp < 10 { mp + 3 } else { mp - 9 };
    let year = yoe + era * 400 + i64::from(month <= 2);
    // As DuckDB writes it: year 0 is 1 BC.
    if year <= 0 {
        format!("{:04}-{month:02}-{day:02} (BC)", 1 - year)
    } else {
        format!("{year:04}-{month:02}-{day:02}")
    }
}

/// An ISO date or timestamp (`iso_time`'s normal form) as seconds since
/// 1970-01-01, read as UTC.
fn epoch_seconds(iso: &str) -> Option<f64> {
    let (date, time) = iso.split_once(['T', ' ']).unwrap_or((iso, ""));
    let mut parts = date.splitn(3, '-');
    let year: i64 = parts.next()?.parse().ok()?;
    let month: i64 = parts.next()?.parse().ok()?;
    let day: i64 = parts.next()?.parse().ok()?;
    // Days from the civil date (Howard Hinnant's algorithm).
    let y = if month <= 2 { year - 1 } else { year };
    let era = y.div_euclid(400);
    let yoe = y - era * 400;
    let doy = (153 * ((month + 9) % 12) + 2) / 5 + day - 1;
    let doe = yoe * 365 + yoe / 4 - yoe / 100 + doy;
    let days = era * 146_097 + doe - 719_468;
    let mut seconds = 0.0;
    if !time.is_empty() {
        let (clock, fraction) = time.split_once('.').unwrap_or((time, ""));
        let mut fields = clock.split(':');
        let hours: f64 = fields.next()?.parse().ok()?;
        let minutes: f64 = fields.next()?.parse().ok()?;
        let whole: f64 = fields.next().map_or(Some(0.0), |s| s.parse().ok())?;
        let fraction: f64 = if fraction.is_empty() {
            0.0
        } else {
            format!("0.{fraction}").parse().ok()?
        };
        seconds = hours * 3600.0 + minutes * 60.0 + whole + fraction;
    }
    Some(days as f64 * 86_400.0 + seconds)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn kept(keeps: &[bool]) -> Vec<usize> {
        keeps
            .iter()
            .enumerate()
            .filter(|(_, on)| **on)
            .map(|(i, _)| i)
            .collect()
    }

    fn of(column: &ColumnInfo, op: &str, values: &[&str], span: (f64, f64)) -> Option<Vec<usize>> {
        let values: Vec<String> = values.iter().map(|value| (*value).to_owned()).collect();
        keeps(column, op, &values, span).map(|keeps| kept(&keeps))
    }

    #[test]
    fn a_numbers_bars_kept_follow_its_operator() {
        let inclination = ColumnInfo::new("inclination_deg", "DOUBLE");
        // 0 to 200 in 20 bins of 10: bin 9 is 90 up to 100.
        let span = (0.0, 200.0);
        assert_eq!(
            of(&inclination, ">=", &["90"], span),
            Some((9..20).collect())
        );
        // 90 itself is bin 9's, not bin 8's.
        assert_eq!(of(&inclination, "<", &["90"], span), Some((0..9).collect()));
        assert_eq!(
            of(&inclination, "<=", &["90"], span),
            Some((0..10).collect())
        );
        assert_eq!(
            of(&inclination, ">", &["95"], span),
            Some((9..20).collect())
        );
        assert_eq!(of(&inclination, "=", &["200"], span), Some(vec![19]));
        assert_eq!(of(&inclination, "in", &["5", "55"], span), Some(vec![0, 5]));
        assert_eq!(
            of(&inclination, "between", &["15", "35"], span),
            Some(vec![1, 2, 3])
        );
        assert_eq!(
            of(&inclination, "between", &["35", "15"], span),
            Some(vec![])
        );
        assert_eq!(
            of(&inclination, "!=", &["5"], span),
            Some((0..20).collect())
        );
        assert_eq!(of(&inclination, "is null", &[], span), Some(vec![]));
        assert_eq!(
            of(&inclination, "not null", &[], span),
            Some((0..20).collect())
        );
        // Past the range: nothing kept, or everything.
        assert_eq!(of(&inclination, ">=", &["500"], span), Some(vec![]));
        assert_eq!(
            of(&inclination, ">=", &["-5"], span),
            Some((0..20).collect())
        );
    }

    #[test]
    fn nothing_is_marked_until_a_value_is_one() {
        let inclination = ColumnInfo::new("inclination_deg", "DOUBLE");
        let span = (0.0, 200.0);
        assert_eq!(of(&inclination, ">=", &[], span), None);
        assert_eq!(of(&inclination, ">=", &["9x"], span), None);
        assert_eq!(of(&inclination, "between", &["1"], span), None);
        assert_eq!(of(&inclination, "contains", &["1"], span), None);
        assert_eq!(
            of(&ColumnInfo::new("orbit", "VARCHAR"), "in", &["a"], span),
            None
        );
    }

    #[test]
    fn a_range_of_one_value_is_the_first_bar() {
        let n = ColumnInfo::new("n", "BIGINT");
        assert_eq!(of(&n, "=", &["7"], (7.0, 7.0)), Some(vec![0]));
        assert_eq!(of(&n, ">", &["7"], (7.0, 7.0)), Some(vec![]));
        assert_eq!(of(&n, ">=", &["7"], (7.0, 7.0)), Some(vec![0]));
        // The empty bars are kept by nothing.
        assert_eq!(of(&n, "<=", &["9"], (7.0, 7.0)), Some(vec![0]));
        assert_eq!(of(&n, "<", &["9"], (7.0, 7.0)), Some(vec![0]));
        assert_eq!(of(&n, "not null", &[], (7.0, 7.0)), Some(vec![0]));
        // Its one value left out keeps nothing.
        assert_eq!(of(&n, "!=", &["7"], (7.0, 7.0)), Some(vec![]));
        let x = ColumnInfo::new("x", "DOUBLE");
        assert_eq!(of(&x, "!=", &["7"], (7.0, 7.0)), Some(vec![]));
        assert_eq!(of(&x, "!=", &["8"], (7.0, 7.0)), Some(vec![0]));
    }

    #[test]
    fn a_whole_numbers_bins_hold_whole_numbers() {
        // 0 to 20 in bins of one: bin 7 holds 7 alone.
        let n = ColumnInfo::new("n", "INTEGER");
        let span = (0.0, 20.0);
        assert_eq!(of(&n, ">", &["7"], span), Some((8..20).collect()));
        assert_eq!(of(&n, ">=", &["7"], span), Some((7..20).collect()));
        assert_eq!(of(&n, "<", &["7"], span), Some((0..7).collect()));
        // 7 left out: bin 7 keeps nothing; the last bin holds 19 and 20.
        assert_eq!(
            of(&n, "!=", &["7"], span),
            Some((0..20).filter(|bin| *bin != 7).collect())
        );
        assert_eq!(of(&n, "!=", &["20"], span), Some((0..20).collect()));
        assert_eq!(of(&n, "=", &["7.5"], span), Some(vec![]));
        // 0 to 10 in bins of a half: every other bin holds no whole number,
        // and the last holds 10.
        let mut holding: Vec<usize> = (0..20).step_by(2).collect();
        holding.push(19);
        assert_eq!(of(&n, "not null", &[], (0.0, 10.0)), Some(holding));
    }

    #[test]
    fn a_whole_number_is_in_the_bin_the_sql_puts_it_in() {
        // 0 to 332: bin 15's edge, 15 × 16.6, is 249.00000000000003, but
        // `floor(249 / 332 * 20)` is 15, so 249 is bin 15's, not 14's.
        let n = ColumnInfo::new("n", "INTEGER");
        let span = (0.0, 332.0);
        assert_eq!(of(&n, "=", &["249"], span), Some(vec![15]));
        assert_eq!(of(&n, "<", &["249"], span), Some((0..15).collect()));
        // Every whole number in its SQL bin, over ranges where edges round.
        for hi in [332.0, 644.0, 1_288.0, 1_328.0, 999.0, 37.0] {
            let bins: Vec<Bin> = bins((0.0, hi), true).collect();
            for v in 0..=(hi as i64) {
                let v = v as f64;
                let sql = ((v / hi) * BINS as f64).floor().min((BINS - 1) as f64) as usize;
                assert!(bins[sql].holds(v), "{v} over 0 to {hi}: bin {sql}");
                let others = (0..BINS).filter(|i| *i != sql && bins[*i].holds(v)).count();
                assert_eq!(others, 0, "{v} over 0 to {hi} in another bin");
            }
        }
    }

    #[test]
    fn a_time_is_placed_by_its_seconds() {
        assert_eq!(epoch_seconds("1970-01-01"), Some(0.0));
        assert_eq!(epoch_seconds("2000-03-01"), Some(951_868_800.0));
        assert_eq!(epoch_seconds("1957-10-04 19:28:34"), Some(-386_310_686.0));
        assert_eq!(
            epoch_seconds("2020-01-01T00:00:01.5"),
            Some(1_577_836_801.5)
        );
        assert_eq!(date_of(-386_310_686.0), "1957-10-04");
        assert_eq!(date_of(951_868_800.0), "2000-03-01");
        assert_eq!(date_of(1_795_305_600.0), "2026-11-22");
        // Before year 1 as DuckDB writes it (its epochs): year 0 is 1 BC.
        assert_eq!(date_of(-62_167_219_200.0), "0001-01-01 (BC)");
        assert_eq!(date_of(-63_517_824_000.0), "0044-03-15 (BC)");
        let launch = ColumnInfo::new("launch_date", "TIMESTAMP");
        // 2000 to 2020 in bins of a year: 2019-06 is the last.
        let span = (
            epoch_seconds("2000-01-01").unwrap(),
            epoch_seconds("2020-01-01").unwrap(),
        );
        let keeps = of(&launch, ">=", &["2019-06-01"], span).unwrap();
        assert_eq!(keeps, vec![19]);
        let date = ColumnInfo::new("day", "DATE");
        assert_eq!(of(&date, ">=", &["2019-06-01 10:00"], span), None);
        assert_eq!(of(&launch, ">=", &["June"], span), None);
    }
}
