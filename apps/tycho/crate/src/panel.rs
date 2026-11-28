//! The column profile as the left panel draws it (the design canvas's
//! Profile page, Panel 1 to 3): every word the panel shows of a profile,
//! written here from what `crate::profile` has read, so the page only draws
//! it (`web/src/frame/columns.tsx`). Its choices where no board draws one:
//! `docs/DECISIONS.md`, "Scope", 2026-11-27, "The profile in the panel".

use std::collections::{BTreeMap, HashMap};

use seiza_duckdb::sql::ColumnInfo;
use serde::Serialize;

use crate::dataset::format_count;
use crate::filter::Kind;
use crate::profile::{Distinct, Profile, ProfileFacts, Reading, Shape, Stage};

/// The most common values a text column's profile shows, as the Grouping
/// page's sketch of one draws them.
pub const TOP_SHOWN: usize = 6;

/// One column's profile, as the panel draws it.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PanelProfile {
    pub column: String,
    /// What it has read: `none` (Panel 1 with nothing yet), `footer`
    /// (Panel 1), `sample` (Panel 2), `exact` (Panel 3), or `failed`. A
    /// screen reader hears the line when it changes.
    pub stage: &'static str,
    /// Its line, at the head's right: "reading a sample…", "from a 1%
    /// sample · reading every row…", "of the 29,118 rows in view".
    pub line: String,
    /// The line is a fault.
    pub error: bool,
    /// A later stage is still to come.
    pub reading: bool,
    /// A number's or a time's rows in each bin, low to high; none for a
    /// text column, or before any bins are read (the placeholder bars).
    pub bins: Option<Vec<u64>>,
    /// The bars are a sample's, drawn muted.
    pub sampled: bool,
    /// The range under the bars, low and high.
    pub range: Option<(String, String)>,
    /// A text column's most common values, most first.
    pub top: Option<Vec<TopShown>>,
    /// Under them: "the 6 most common of 1,985 values".
    pub top_line: Option<String>,
    /// The figures, in the grid's order: Nulls, Distinct, Median, Mean,
    /// and "Infinite or NaN" where there are any.
    pub figures: Vec<Figure>,
    /// A line under the figures: a sample's every value different.
    pub note: Option<String>,
    /// The filter editor's line under its bars or its checklist: "from
    /// the profile of the 29,118 rows in view", a sample's "from a 0.48%
    /// sample · reading every row…" (one line under the bars), or, with no shape
    /// yet, the stage's line.
    pub preview_line: String,
    /// The filter editor's range under its bars: a timestamp across years
    /// by its years, as Filter 3 draws it.
    pub preview_range: Option<(String, String)>,
    /// Every value of a text column with at most [`crate::profile::TOP`],
    /// most first, once every row in view is read: the filter editor's
    /// checklist (Filter 2). None for a column with more, or before.
    pub values: Option<Vec<TopShown>>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
pub struct TopShown {
    pub value: String,
    pub count: u64,
    /// `count` as the panel writes it.
    pub words: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
pub struct Figure {
    pub label: &'static str,
    pub value: String,
}

/// What isn't known yet, in a figure's place.
const UNKNOWN: &str = "…";

impl PanelProfile {
    /// `facts` of `column` as the panel draws them; `footer_nulls`, the
    /// footer's null counts (only an unfiltered view has any), which a
    /// sample's figures take their nulls from.
    pub fn of(
        facts: &ProfileFacts,
        column: &ColumnInfo,
        footer_nulls: &HashMap<String, (u64, u64)>,
    ) -> Self {
        let kind = Kind::of(column);
        let numeric = matches!(kind, Kind::Number | Kind::Time);
        let time = kind == Kind::Time;
        let profile = facts.profile.as_ref();
        let stage = match (&facts.failed, profile.map(|profile| profile.stage)) {
            (Some(_), _) => "failed",
            (None, None) => "none",
            (None, Some(Stage::Footer)) => "footer",
            (None, Some(Stage::Sample(_))) => "sample",
            (None, Some(Stage::Exact)) => "exact",
        };
        let (line, error) = match &facts.failed {
            Some(why) => (format!("couldn't be read: {why}"), true),
            None => (stage_line(facts, profile), false),
        };
        let mut view = Self {
            column: facts.column.clone(),
            stage,
            line,
            error,
            reading: facts.reading,
            bins: None,
            sampled: false,
            range: None,
            top: None,
            top_line: None,
            figures: Vec::new(),
            note: None,
            preview_line: String::new(),
            preview_range: None,
            values: None,
        };
        let sampled = profile.is_some_and(|profile| matches!(profile.stage, Stage::Sample(_)));
        match profile.and_then(|profile| profile.shape.as_ref()) {
            Some(Shape::Bins(bins)) => {
                view.bins = Some(bins.clone());
                view.sampled = matches!(
                    profile.and_then(|profile| profile.shape_stage),
                    Some(Stage::Sample(_))
                );
            }
            Some(Shape::Top(values)) => {
                let shown: Vec<TopShown> = values
                    .iter()
                    .take(TOP_SHOWN)
                    .map(|(value, count)| TopShown {
                        value: value.clone(),
                        count: *count,
                        words: format_count(*count),
                    })
                    .collect();
                view.sampled = sampled;
                view.top_line = profile.and_then(|profile| top_line(shown.len(), profile));
                view.top = Some(shown);
            }
            None => {}
        }
        if numeric {
            // The range under the bars is the one they were cut over: the
            // figures' own ends as DuckDB wrote them (exact, a BIGINT's
            // every digit), unless a sample's bars stay beside every row's
            // figures, whose ends aren't theirs: then the bins' range.
            view.range = profile.and_then(|profile| match profile.span {
                Some(span) if profile.shape_stage != Some(profile.stage) => {
                    Some(span_ends(span, time))
                }
                _ => Some((
                    end(column, profile.lo.as_deref()?),
                    end(column, profile.hi.as_deref()?),
                )),
            });
            // The filter editor's: a time across years by its years, as
            // Filter 3 draws it; a number as Filter 1 writes it, `0`.
            view.preview_range = view.range.clone().map(|(lo, hi)| {
                let year = |at: &str| at.get(..4).map(str::to_owned);
                match (time, year(&lo), year(&hi)) {
                    (true, Some(from), Some(to)) if from != to => (from, to),
                    (true, ..) => (lo, hi),
                    (false, ..) => (number_figure(&lo, false), number_figure(&hi, false)),
                }
            });
        }
        view.preview_line = preview_line(facts, profile, &view.line);
        if kind == Kind::Text
            && let Some(Profile {
                stage: Stage::Exact,
                shape_stage: Some(Stage::Exact),
                distinct: Some(Distinct::Exact(n)),
                shape: Some(Shape::Top(values)),
                ..
            }) = profile
            && *n as usize == values.len()
            && values.len() <= crate::profile::TOP
        {
            view.values = Some(
                values
                    .iter()
                    .map(|(value, count)| TopShown {
                        value: value.clone(),
                        count: *count,
                        words: format_count(*count),
                    })
                    .collect(),
            );
        }
        let footer = footer_nulls.get(&column.name).map(|(nulls, _)| *nulls);
        view.figures.push(Figure {
            label: "Nulls",
            value: nulls(profile, footer),
        });
        view.figures.push(Figure {
            label: "Distinct",
            value: match profile.and_then(|profile| profile.distinct) {
                Some(Distinct::Exact(n)) => format_count(n),
                Some(Distinct::AtLeast(n)) => format!("at least {}", format_count(n)),
                Some(Distinct::AllUnique(n)) => {
                    view.note = Some(format!(
                        "All unique in a sample of {} (likely an ID).",
                        format_count(n)
                    ));
                    "all unique".into()
                }
                None => UNKNOWN.into(),
            },
        });
        if numeric {
            view.figures.push(Figure {
                label: "Median",
                value: profile
                    .and_then(|profile| profile.median.as_deref())
                    .map_or_else(
                        || UNKNOWN.into(),
                        |median| {
                            if time {
                                time_figure(median, sampled)
                            } else {
                                number_figure(median, sampled)
                            }
                        },
                    ),
            });
            // A time has no mean.
            if !time {
                view.figures.push(Figure {
                    label: "Mean",
                    value: profile
                        .and_then(|profile| profile.mean.as_deref())
                        .map_or_else(|| UNKNOWN.into(), |mean| number_figure(mean, sampled)),
                });
            }
            if let Some(profile) = profile.filter(|profile| profile.nonfinite > 0) {
                view.figures.push(Figure {
                    label: "Infinite or NaN",
                    value: if sampled {
                        format!("at least {}", format_count(profile.nonfinite))
                    } else {
                        format_count(profile.nonfinite)
                    },
                });
            }
        }
        view
    }
}

/// The line at the head's right: where the figures came from, then what
/// reads next or what it waits for.
fn stage_line(facts: &ProfileFacts, profile: Option<&Profile>) -> String {
    let source = profile.and_then(|profile| match profile.stage {
        // The footer is the file's own: the line says what reads next.
        Stage::Footer => None,
        Stage::Sample(percent) => Some(format!("from a {} sample", share(percent))),
        Stage::Exact => Some(format!(
            "of the {} row{} in view",
            format_count(profile.rows),
            if profile.rows == 1 { "" } else { "s" }
        )),
    });
    let next = facts
        .waiting
        .map(|waiting| waiting.words().to_owned())
        .or_else(|| {
            facts.reading.then(|| {
                match facts.next {
                    Some(Reading::Sample) => "reading a sample…",
                    Some(Reading::Rows) => "reading every row…",
                    Some(Reading::Shape) => "reading its shape…",
                    None => "reading…",
                }
                .to_owned()
            })
        });
    match (source, next) {
        (Some(source), Some(next)) => format!("{source} · {next}"),
        (Some(line), None) | (None, Some(line)) => line,
        (None, None) => String::new(),
    }
}

/// The filter editor's line: where its bars or its values came from, and
/// what reads next; with no shape yet, the panel's `line`.
fn preview_line(facts: &ProfileFacts, profile: Option<&Profile>, line: &str) -> String {
    if facts.failed.is_some() {
        return line.to_owned();
    }
    let Some(profile) = profile.filter(|profile| profile.shape.is_some()) else {
        return line.to_owned();
    };
    match profile.shape_stage {
        Some(Stage::Sample(percent)) => {
            let next = facts
                .waiting
                .map(|waiting| waiting.words().to_owned())
                .or_else(|| facts.reading.then(|| "reading every row…".to_owned()));
            let source = format!("from a {} sample", share(percent));
            match next {
                Some(next) => format!("{source} · {next}"),
                None => source,
            }
        }
        _ => format!(
            "from the profile of the {} row{} in view",
            format_count(profile.rows),
            if profile.rows == 1 { "" } else { "s" }
        ),
    }
}

/// A sample's share of the source: `1%`, `0.47%`.
fn share(percent: f64) -> String {
    let text = if percent >= 10.0 {
        format!("{percent:.0}")
    } else {
        format!("{percent:.2}")
    };
    let text = if text.contains('.') {
        text.trim_end_matches('0').trim_end_matches('.')
    } else {
        &text
    };
    format!("{text}%")
}

/// "the 6 most common of 1,985 values", or "all 3 values" when every
/// value is shown.
fn top_line(shown: usize, profile: &Profile) -> Option<String> {
    let shown = shown as u64;
    if shown == 0 {
        return Some("no values".into());
    }
    Some(match profile.distinct? {
        Distinct::Exact(n) if n <= shown => match n {
            1 => "its one value".into(),
            n => format!("all {n} values"),
        },
        Distinct::Exact(n) => format!("the {shown} most common of {} values", format_count(n)),
        Distinct::AtLeast(n) => format!(
            "the {shown} most common of at least {} values",
            format_count(n)
        ),
        Distinct::AllUnique(_) => format!("{shown} of a sample whose values all differ"),
    })
}

/// The nulls: an exact count from every row or the footer; a sample's as
/// a floor, unless the footer has the column's.
fn nulls(profile: Option<&Profile>, footer: Option<u64>) -> String {
    match profile {
        Some(Profile {
            stage: Stage::Sample(_),
            nulls,
            ..
        }) => match (footer, nulls) {
            (Some(n), _) => format_count(n),
            (None, Some(0)) => "none in the sample".into(),
            (None, Some(n)) => format!("at least {}", format_count(*n)),
            (None, None) => UNKNOWN.into(),
        },
        Some(Profile { nulls: Some(n), .. }) => format_count(*n),
        _ => footer.map_or_else(|| UNKNOWN.into(), format_count),
    }
}

/// The bins' range (`Profile::span`, positions) as the line under the
/// bars writes it while a sample's bars stay beside every row's figures: a
/// time's dates, a number as Rust writes it (a figure written whole by
/// the editor's `number_figure`).
fn span_ends((lo, hi): (f64, f64), time: bool) -> (String, String) {
    if time {
        (crate::preview::date_of(lo), crate::preview::date_of(hi))
    } else {
        (format!("{lo}"), format!("{hi}"))
    }
}

/// A range's end as the line under the bars writes it: a timestamp's
/// date, a number as DuckDB wrote it.
fn end(column: &ColumnInfo, value: &str) -> String {
    if column.data_type.starts_with("TIMESTAMP") {
        value.split([' ', 'T']).next().unwrap_or(value).to_owned()
    } else {
        value.to_owned()
    }
}

/// A number's median or mean: every row's to two decimals (three
/// significant figures under 1), with thousands marks; a sample's
/// "about", to two significant figures.
fn number_figure(text: &str, sampled: bool) -> String {
    // A whole number of every row as DuckDB wrote it, grouped: through a
    // float, a BIGINT past 2^53 would lose its last digits.
    let digits = text.strip_prefix('-').unwrap_or(text);
    if !sampled && !digits.is_empty() && digits.bytes().all(|b| b.is_ascii_digit()) {
        let sign = if digits.len() < text.len() && digits.bytes().any(|b| b != b'0') {
            "-"
        } else {
            ""
        };
        return format!(
            "{sign}{}",
            group_digits(digits.trim_start_matches('0').max("0"))
        );
    }
    let Ok(value) = text.parse::<f64>() else {
        return text.to_owned();
    };
    if !value.is_finite() {
        return text.to_owned();
    }
    if value == 0.0 {
        return if sampled {
            "about 0".into()
        } else {
            "0".into()
        };
    }
    let magnitude = value.abs().log10().floor() as i32;
    if sampled {
        let rounded = round_significant(value, 2);
        return format!("about {}", grouped(rounded, (1 - magnitude).max(0)));
    }
    // Two decimals, or three significant figures under 1.
    let decimals = if value.abs() < 1.0 { 2 - magnitude } else { 2 };
    grouped(value, decimals)
}

/// A time's median: its date, a sample's "about" its month.
fn time_figure(text: &str, sampled: bool) -> String {
    let date = text.split([' ', 'T']).next().unwrap_or(text);
    if sampled {
        format!("about {}", date.get(..7).unwrap_or(date))
    } else {
        date.to_owned()
    }
}

fn round_significant(value: f64, figures: i32) -> f64 {
    if value == 0.0 {
        return 0.0;
    }
    let scale = 10f64.powi(figures - 1 - value.abs().log10().floor() as i32);
    (value * scale).round() / scale
}

/// `value` to `decimals` places, with thousands marks and no trailing
/// zeros: `1,234.5`; a value that rounds to zero has no sign.
fn grouped(value: f64, decimals: i32) -> String {
    let text = format!("{:.*}", decimals.clamp(0, 20) as usize, value.abs());
    let (whole, fraction) = text.split_once('.').unwrap_or((&text, ""));
    let fraction = fraction.trim_end_matches('0');
    let zero = whole.bytes().all(|b| b == b'0') && fraction.is_empty();
    let sign = if value < 0.0 && !zero { "-" } else { "" };
    let whole = group_digits(whole);
    if fraction.is_empty() {
        format!("{sign}{whole}")
    } else {
        format!("{sign}{whole}.{fraction}")
    }
}

/// A run of digits with thousands marks, however long.
fn group_digits(digits: &str) -> String {
    let mut out = String::with_capacity(digits.len() + digits.len() / 3);
    for (index, digit) in digits.chars().enumerate() {
        if index > 0 && (digits.len() - index).is_multiple_of(3) {
            out.push(',');
        }
        out.push(digit);
    }
    out
}

/// Each column's null share, as its row in the list says it ("0.3%
/// null"), where it has any and the share is known of every row in view
/// (`Profiling::null_counts`).
pub fn null_shares(counts: &HashMap<String, (u64, u64)>) -> BTreeMap<String, String> {
    counts
        .iter()
        .filter(|(_, (nulls, rows))| *nulls > 0 && *rows > 0)
        .map(|(name, (nulls, rows))| {
            (
                name.clone(),
                format!("{} null", crate::catalog::percent(*nulls, *rows)),
            )
        })
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::profile::Waiting;

    fn number() -> ColumnInfo {
        ColumnInfo::new("inclination_deg", "DOUBLE")
    }

    fn facts(profile: Option<Profile>, next: Option<Reading>) -> ProfileFacts {
        ProfileFacts {
            column: "inclination_deg".into(),
            reading: next.is_some(),
            profile,
            next,
            waiting: None,
            failed: None,
        }
    }

    fn figures(rows: u64, stage: Stage) -> Profile {
        Profile {
            stage,
            rows,
            nulls: Some(1),
            nonfinite: 0,
            lo: Some("0.0".into()),
            hi: Some("150.97".into()),
            mean: Some("62.87341234".into()),
            median: Some("53.22".into()),
            distinct: Some(Distinct::Exact(2369)),
            shape: Some(Shape::Bins(vec![1; 20])),
            shape_stage: Some(stage),
            span: None,
        }
    }

    fn value<'a>(view: &'a PanelProfile, label: &str) -> &'a str {
        &view
            .figures
            .iter()
            .find(|figure| figure.label == label)
            .unwrap_or_else(|| panic!("no {label}"))
            .value
    }

    #[test]
    fn nothing_read_yet_is_panel_one() {
        let view = PanelProfile::of(
            &facts(None, Some(Reading::Sample)),
            &number(),
            &HashMap::new(),
        );
        assert_eq!(view.stage, "none");
        assert_eq!(view.line, "reading a sample…");
        assert_eq!(view.bins, None);
        assert_eq!(value(&view, "Nulls"), "…");
        assert_eq!(value(&view, "Distinct"), "…");
        assert_eq!(value(&view, "Median"), "…");
        assert_eq!(value(&view, "Mean"), "…");
    }

    #[test]
    fn the_footer_gives_the_range_and_nulls() {
        let footer = Profile {
            stage: Stage::Footer,
            rows: 29_118,
            nulls: Some(1),
            nonfinite: 0,
            lo: Some("0.0".into()),
            hi: Some("150.97".into()),
            mean: None,
            median: None,
            distinct: None,
            shape: None,
            shape_stage: None,
            span: None,
        };
        let view = PanelProfile::of(
            &facts(Some(footer), Some(Reading::Rows)),
            &number(),
            &HashMap::new(),
        );
        assert_eq!(view.stage, "footer");
        assert_eq!(view.line, "reading every row…");
        assert_eq!(view.range, Some(("0.0".into(), "150.97".into())));
        assert_eq!(value(&view, "Nulls"), "1");
        assert_eq!(value(&view, "Median"), "…");
    }

    #[test]
    fn a_sample_is_said_and_rounded() {
        let mut sample = figures(200_000, Stage::Sample(0.47));
        sample.distinct = Some(Distinct::AtLeast(2249));
        sample.nulls = Some(0);
        let view = PanelProfile::of(
            &facts(Some(sample.clone()), Some(Reading::Rows)),
            &number(),
            &HashMap::new(),
        );
        assert_eq!(view.line, "from a 0.47% sample · reading every row…");
        assert!(view.sampled);
        assert_eq!(value(&view, "Distinct"), "at least 2,249");
        assert_eq!(value(&view, "Median"), "about 53");
        assert_eq!(value(&view, "Mean"), "about 63");
        assert_eq!(value(&view, "Nulls"), "none in the sample");
        // The footer's count, where the view is unfiltered.
        let footer = HashMap::from([("inclination_deg".to_owned(), (3, 29_118))]);
        let view = PanelProfile::of(
            &facts(Some(sample), Some(Reading::Rows)),
            &number(),
            &footer,
        );
        assert_eq!(value(&view, "Nulls"), "3");
    }

    #[test]
    fn every_row_is_exact_and_names_its_rows() {
        let mut exact = figures(29_118, Stage::Exact);
        exact.nonfinite = 51;
        let view = PanelProfile::of(&facts(Some(exact), None), &number(), &HashMap::new());
        assert_eq!(view.stage, "exact");
        assert_eq!(view.line, "of the 29,118 rows in view");
        assert!(!view.sampled);
        assert_eq!(value(&view, "Distinct"), "2,369");
        assert_eq!(value(&view, "Median"), "53.22");
        assert_eq!(value(&view, "Mean"), "62.87");
        assert_eq!(value(&view, "Infinite or NaN"), "51");
    }

    #[test]
    fn the_shape_still_read_keeps_the_samples_bars() {
        let mut exact = figures(29_118, Stage::Exact);
        exact.shape_stage = Some(Stage::Sample(0.47));
        let view = PanelProfile::of(
            &facts(Some(exact), Some(Reading::Shape)),
            &number(),
            &HashMap::new(),
        );
        assert_eq!(view.line, "of the 29,118 rows in view · reading its shape…");
        assert!(view.sampled);
    }

    #[test]
    fn a_wait_is_said_in_place_of_the_read() {
        let mut waiting = facts(None, Some(Reading::Sample));
        waiting.waiting = Some(Waiting::Scrolling);
        let view = PanelProfile::of(&waiting, &number(), &HashMap::new());
        assert_eq!(view.line, "waiting for scrolling to settle");
        let mut waiting = facts(
            Some(figures(200_000, Stage::Sample(1.0))),
            Some(Reading::Rows),
        );
        waiting.waiting = Some(Waiting::Find);
        let view = PanelProfile::of(&waiting, &number(), &HashMap::new());
        assert_eq!(view.line, "from a 1% sample · waiting for find to finish");
    }

    #[test]
    fn a_failure_is_said() {
        let mut failed = facts(None, None);
        failed.failed = Some("there's no column x".into());
        let view = PanelProfile::of(&failed, &number(), &HashMap::new());
        assert_eq!(view.stage, "failed");
        assert!(view.error);
        assert_eq!(view.line, "couldn't be read: there's no column x");
    }

    #[test]
    fn a_text_column_shows_its_common_values() {
        let text = ColumnInfo::new("orbit", "VARCHAR");
        let values = vec![
            ("Low Earth".to_owned(), 62_823),
            ("Highly elliptical".to_owned(), 3_000),
        ];
        let profile = Profile {
            stage: Stage::Exact,
            rows: 71_431,
            nulls: Some(86),
            nonfinite: 0,
            lo: None,
            hi: None,
            mean: None,
            median: None,
            distinct: Some(Distinct::Exact(9)),
            shape: Some(Shape::Top(values)),
            shape_stage: Some(Stage::Exact),
            span: None,
        };
        let mut facts = facts(Some(profile.clone()), None);
        facts.column = "orbit".into();
        let view = PanelProfile::of(&facts, &text, &HashMap::new());
        assert_eq!(
            view.top_line.as_deref(),
            Some("the 2 most common of 9 values")
        );
        assert_eq!(
            view.top.as_ref().map(|top| top[0].words.as_str()),
            Some("62,823")
        );
        assert_eq!(view.figures.len(), 2);
        assert_eq!(value(&view, "Nulls"), "86");
        let mut few = profile;
        few.distinct = Some(Distinct::Exact(2));
        assert_eq!(top_line(2, &few).as_deref(), Some("all 2 values"));
    }

    #[test]
    fn a_sample_of_unique_values_says_so() {
        let text = ColumnInfo::new("cospar", "VARCHAR");
        let profile = Profile {
            stage: Stage::Sample(0.5),
            rows: 200_000,
            nulls: Some(0),
            nonfinite: 0,
            lo: None,
            hi: None,
            mean: None,
            median: None,
            distinct: Some(Distinct::AllUnique(200_000)),
            shape: Some(Shape::Top(vec![("a".into(), 1)])),
            shape_stage: Some(Stage::Sample(0.5)),
            span: None,
        };
        let view = PanelProfile::of(
            &facts(Some(profile), Some(Reading::Rows)),
            &text,
            &HashMap::new(),
        );
        assert_eq!(value(&view, "Distinct"), "all unique");
        assert_eq!(
            view.note.as_deref(),
            Some("All unique in a sample of 200,000 (likely an ID).")
        );
    }

    #[test]
    fn a_time_has_a_median_date_and_no_mean() {
        let time = ColumnInfo::new("launch_date", "TIMESTAMP");
        let profile = Profile {
            lo: Some("1957-10-04 19:28:34".into()),
            hi: Some("2026-11-22 00:00:00".into()),
            median: Some("2019-05-24 02:30:00".into()),
            mean: None,
            ..figures(71_431, Stage::Exact)
        };
        let view = PanelProfile::of(&facts(Some(profile), None), &time, &HashMap::new());
        assert_eq!(view.range, Some(("1957-10-04".into(), "2026-11-22".into())));
        assert_eq!(value(&view, "Median"), "2019-05-24");
        assert!(view.figures.iter().all(|figure| figure.label != "Mean"));
    }

    #[test]
    fn figures_round_and_group() {
        assert_eq!(number_figure("1234.5678", false), "1,234.57");
        assert_eq!(number_figure("0.0012345", false), "0.00123");
        assert_eq!(number_figure("-3.0", false), "-3");
        assert_eq!(number_figure("2.28", true), "about 2.3");
        assert_eq!(number_figure("0.11", true), "about 0.11");
        assert_eq!(number_figure("12345", true), "about 12,000");
        assert_eq!(number_figure("0.00000012", false), "0.00000012");
        assert_eq!(number_figure("-0.00000001", false), "-0.00000001");
        assert_eq!(number_figure("-0.001", true), "about -0.001");
        assert_eq!(
            number_figure("9007199254740993", false),
            "9,007,199,254,740,993"
        );
        assert_eq!(number_figure("-0", false), "0");
        assert_eq!(number_figure("53.22", false), "53.22");
        assert_eq!(number_figure("150.0", false), "150");
        assert_eq!(grouped(-0.004, 2), "0");
        assert_eq!(share(0.47), "0.47%");
        assert_eq!(share(1.0), "1%");
        assert_eq!(share(12.0), "12%");
    }

    #[test]
    fn the_filter_editors_line_says_where_its_bars_came_from() {
        let exact = PanelProfile::of(
            &facts(Some(figures(29_118, Stage::Exact)), None),
            &number(),
            &HashMap::new(),
        );
        assert_eq!(
            exact.preview_line,
            "from the profile of the 29,118 rows in view"
        );
        assert_eq!(exact.preview_range, Some(("0".into(), "150.97".into())));
        let sample = PanelProfile::of(
            &facts(
                Some(figures(200_000, Stage::Sample(0.48))),
                Some(Reading::Rows),
            ),
            &number(),
            &HashMap::new(),
        );
        assert_eq!(
            sample.preview_line,
            "from a 0.48% sample · reading every row…"
        );
        // No bars yet: the stage's line.
        let none = PanelProfile::of(
            &facts(None, Some(Reading::Sample)),
            &number(),
            &HashMap::new(),
        );
        assert_eq!(none.preview_line, "reading a sample…");
        // A timestamp across years, by its years (Filter 3).
        let time = ColumnInfo::new("launch_date", "TIMESTAMP");
        let profile = Profile {
            lo: Some("1957-10-04 19:28:34".into()),
            hi: Some("2026-11-22 00:00:00".into()),
            ..figures(71_431, Stage::Exact)
        };
        let view = PanelProfile::of(&facts(Some(profile), None), &time, &HashMap::new());
        assert_eq!(view.preview_range, Some(("1957".into(), "2026".into())));
        assert_eq!(view.range, Some(("1957-10-04".into(), "2026-11-22".into())));
    }

    #[test]
    fn the_range_under_the_bars_is_the_one_they_were_cut_over() {
        // Every row's figures in, the sample's bars kept: their range.
        let mut exact = figures(42_323_121, Stage::Exact);
        exact.lo = Some("-1.26".into());
        exact.hi = Some("34.06".into());
        exact.shape_stage = Some(Stage::Sample(0.48));
        exact.span = Some((2.13, 32.66));
        let view = PanelProfile::of(
            &facts(Some(exact), Some(Reading::Shape)),
            &number(),
            &HashMap::new(),
        );
        assert_eq!(view.range, Some(("2.13".into(), "32.66".into())));
        assert_eq!(view.preview_range, Some(("2.13".into(), "32.66".into())));
        // The bars are every row's: DuckDB's own ends, every digit kept
        // (through a float, a BIGINT past 2^53 would lose its last ones).
        let id = ColumnInfo::new("id", "BIGINT");
        let mut ids = figures(1_000, Stage::Exact);
        ids.lo = Some("1400000000000000001".into());
        ids.hi = Some("1400000000000000999".into());
        ids.span = Some((1.4e18, 1.4e18));
        let view = PanelProfile::of(&facts(Some(ids), None), &id, &HashMap::new());
        assert_eq!(
            view.range,
            Some(("1400000000000000001".into(), "1400000000000000999".into()))
        );
        assert_eq!(
            view.preview_range,
            Some((
                "1,400,000,000,000,000,001".into(),
                "1,400,000,000,000,000,999".into()
            ))
        );
        // A time's, by its dates; the editor's by its years.
        let time = ColumnInfo::new("launch_date", "TIMESTAMP");
        let mut profile = figures(71_431, Stage::Exact);
        profile.shape_stage = Some(Stage::Sample(1.0));
        profile.span = Some((-386_310_686.0, 1_795_305_600.0));
        let view = PanelProfile::of(&facts(Some(profile), None), &time, &HashMap::new());
        assert_eq!(view.range, Some(("1957-10-04".into(), "2026-11-22".into())));
        assert_eq!(view.preview_range, Some(("1957".into(), "2026".into())));
    }

    #[test]
    fn a_text_column_with_few_values_has_them_all_for_the_checklist() {
        let text = ColumnInfo::new("orbit", "VARCHAR");
        let values: Vec<(String, u64)> = (0..9).map(|i| (format!("v{i}"), 100 - i)).collect();
        let profile = |stage: Stage, distinct: Distinct, values: Vec<(String, u64)>| Profile {
            stage,
            rows: 29_118,
            nulls: Some(0),
            nonfinite: 0,
            lo: None,
            hi: None,
            mean: None,
            median: None,
            distinct: Some(distinct),
            shape: Some(Shape::Top(values)),
            shape_stage: Some(stage),
            span: None,
        };
        let of = |profile: Profile| {
            let mut facts = facts(Some(profile), None);
            facts.column = "orbit".into();
            PanelProfile::of(&facts, &text, &HashMap::new())
        };
        let few = of(profile(Stage::Exact, Distinct::Exact(9), values.clone()));
        assert_eq!(few.values.as_ref().map(Vec::len), Some(9));
        assert_eq!(few.values.as_ref().unwrap()[0].words, "100");
        assert_eq!(
            few.preview_line,
            "from the profile of the 29,118 rows in view"
        );
        // More values than the profile lists: the typed list.
        assert_eq!(
            of(profile(
                Stage::Exact,
                Distinct::Exact(1_985),
                values.clone()
            ))
            .values,
            None
        );
        // A sample can miss a rare value: the typed list until every row.
        assert_eq!(
            of(profile(Stage::Sample(0.5), Distinct::AtLeast(9), values)).values,
            None
        );
    }

    #[test]
    fn null_shares_only_where_there_are_nulls() {
        let counts = HashMap::from([
            ("orbit".to_owned(), (214, 71_431)),
            ("name".to_owned(), (0, 71_431)),
        ]);
        let shares = null_shares(&counts);
        assert_eq!(shares.get("orbit").map(String::as_str), Some("0.3% null"));
        assert!(!shares.contains_key("name"));
    }
}
