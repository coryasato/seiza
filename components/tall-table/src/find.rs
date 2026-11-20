//! `find`'s pure half: what a source is asked ([`FindQuery`], the cells it
//! searches and the match rule), what it answers ([`FoundCell`]), where a
//! step starts (a gap in the query's order), and what's drawn of a match
//! (its ranges in a cell's drawn text). The state's half is
//! `state/find.rs`; why each rule is so, `docs/DECISIONS.md`, "Features"
//! (2026-11-18, `find`).

use std::future::Future;
use std::ops::Range;
use std::pin::Pin;

use gpui_kit::SharedString;

use crate::delegate::PageError;

/// A cell, by row and column index (`find`): the index in
/// `TallTableState::columns`, not the place it's drawn at.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
pub struct FoundCell {
    /// Its row, 0-based.
    pub row: u64,
    /// Its column's index.
    pub column: usize,
}

impl FoundCell {
    /// The cell at `row` and column index `column`.
    pub fn new(row: u64, column: usize) -> Self {
        Self { row, column }
    }
}

/// What the table asks a source to find (`find`): the first cell, in
/// `columns`' order along each row, then row by row (backward: the last),
/// strictly after `after` and up to `until` inclusive, whose exact text
/// contains its term ([`FindQuery::term`]), both lowercased ([`FindQuery::matches`]). A NULL never
/// matches.
#[derive(Debug, Clone, PartialEq)]
#[non_exhaustive]
pub struct FindQuery {
    /// The term, as the host set it (never empty): [`FindQuery::term`].
    term: SharedString,
    /// The shown columns, by index, in their drawn order.
    pub columns: Vec<usize>,
    /// None: from the first row's first cell (backward: the last's last).
    pub after: Option<FoundCell>,
    /// None: to the last row (backward: the first).
    pub until: Option<FoundCell>,
    /// Searching up and to the left.
    pub backward: bool,
    /// The term lowercased ([`lower`]) once, as it's built: the match rule
    /// runs once a cell.
    lower: String,
}

impl FindQuery {
    /// A query, as the table builds one: for a source's own tests.
    pub fn new(
        term: impl Into<SharedString>,
        columns: Vec<usize>,
        after: Option<FoundCell>,
        until: Option<FoundCell>,
        backward: bool,
    ) -> Self {
        let term = term.into();
        Self {
            lower: lower(&term),
            term,
            columns,
            after,
            until,
            backward,
        }
    }

    /// The term, as the host set it (never empty): what a SQL source
    /// lowercases and searches for, as [`FindQuery::matches`] does.
    pub fn term(&self) -> &SharedString {
        &self.term
    }

    /// Whether a cell whose exact text is `exact` matches: it contains the
    /// term, both lowercased (`str::to_lowercase`, a final sigma `ς` as
    /// `σ`, as a SQL `lower` writes it). The exact text is
    /// `CellValue`'s `Display` (what the tooltip shows); a NULL's is never
    /// asked, as no NULL matches. The term is lowercased once, when the
    /// query is built, so a source calls it once a cell.
    #[inline]
    pub fn matches(&self, exact: &str) -> bool {
        matches(exact, &self.lower)
    }

    /// The cells it searches over `rows` rows, in its order: the source's
    /// answer is the first of them that [`FindQuery::matches`]. A source
    /// that scans in windows takes them a window at a time.
    pub fn cells(&self, rows: u64) -> impl Iterator<Item = FoundCell> + '_ {
        let width = self.columns.len() as u64;
        let total = rows.saturating_mul(width);
        let at = |cell: FoundCell| self.position(cell);
        // Both ends inclusive, as positions in the order; empty when the
        // start is past the end.
        let (first, last) = if self.backward {
            let first = match self.after {
                Some(cell) => at(cell).and_then(|p| p.checked_sub(1)),
                None => total.checked_sub(1),
            };
            (first, self.until.and_then(at).or(Some(0)))
        } else {
            let first = match self.after {
                Some(cell) => at(cell).map(|p| p + 1),
                None => Some(0),
            };
            (first, self.until.and_then(at).or(total.checked_sub(1)))
        };
        let span: Box<dyn Iterator<Item = u64>> = match (first, last) {
            (Some(first), Some(last)) if total > 0 && self.backward && first >= last => {
                Box::new((last..=first.min(total - 1)).rev())
            }
            (Some(first), Some(last)) if total > 0 && !self.backward && first <= last => {
                Box::new(first..=last.min(total - 1))
            }
            _ => Box::new(std::iter::empty()),
        };
        span.map(move |p| FoundCell::new(p / width, self.columns[(p % width) as usize]))
    }

    /// `cell`'s position in the order: its row times the columns, plus its
    /// column's place among them. None for a column not searched.
    fn position(&self, cell: FoundCell) -> Option<u64> {
        let place = self
            .columns
            .iter()
            .position(|&index| index == cell.column)?;
        Some(cell.row * self.columns.len() as u64 + place as u64)
    }
}

/// A find's answer (`find`): the first matching cell, or none in its range.
pub type FindLoad = Pin<Box<dyn Future<Output = Result<Option<FoundCell>, PageError>>>>;

/// How a step ended (`find`), in `TallTableEvent::Found`.
#[derive(Debug, Clone, PartialEq)]
#[non_exhaustive]
pub enum FindOutcome {
    /// The current match, and whether it came round from the other end.
    Match {
        /// The cell found.
        cell: FoundCell,
        /// Found by the second ask, from the other end.
        wrapped: bool,
    },
    /// No cell matches in any row.
    NoMatch,
    /// The delegate refused (`TallTableDelegate::find` returned `None`).
    Refused,
    /// Its read failed: the message, as a page's.
    Failed(SharedString),
    /// Cancelled before it answered: a new term, a sort, `replace_rows`,
    /// `set_columns`, a shrink, a move, a hide, or `close`.
    Cancelled,
}

/// `text` lowercased as the match rule takes it: `str::to_lowercase`,
/// with the final sigma it writes (`ς`, by context: `ΟΔΟΣ` → `οδος`) as
/// `σ`, so a term's sigma matches a word's wherever it falls, as the
/// ranges' fold ([`fold`]) and a SQL source's `lower` (no context) do.
pub(crate) fn lower(text: &str) -> String {
    let lower = text.to_lowercase();
    if lower.contains('ς') {
        lower.replace('ς', "σ")
    } else {
        lower
    }
}

/// The match rule: `exact`, lowercased ([`lower`]), contains `term`, a
/// term already lowercased so.
#[inline]
pub(crate) fn matches(exact: &str, term: &str) -> bool {
    #[cfg(test)]
    if control() == Control::CaseSensitive {
        return exact.contains(term);
    }
    lower(exact).contains(term)
}

/// The term as the ranges are searched for: folded a character at a time
/// ([`fold`]).
pub(crate) fn folded_term(term: &str) -> String {
    fold(term).0
}

/// `text` lowercased a character at a time, with where each folded byte
/// came from: the source character's byte range. A character may fold to
/// more bytes than it had (`İ`, two, to `i̇`, three), so a match's offsets
/// in the folded text aren't the text's. A final sigma folds as any sigma,
/// so the character-wise fold finds what [`lower`] does.
pub(crate) fn fold(text: &str) -> (String, Vec<Range<usize>>) {
    let mut folded = String::with_capacity(text.len());
    let mut from = Vec::with_capacity(text.len());
    for (start, ch) in text.char_indices() {
        let source = start..start + ch.len_utf8();
        #[cfg(test)]
        let lowered: Vec<char> = if control() == Control::CaseSensitive {
            vec![ch]
        } else {
            ch.to_lowercase().collect()
        };
        #[cfg(not(test))]
        let lowered = ch.to_lowercase();
        for lower in lowered {
            let lower = if lower == 'ς' { 'σ' } else { lower };
            let before = folded.len();
            folded.push(lower);
            from.extend(std::iter::repeat_n(source.clone(), folded.len() - before));
        }
    }
    (folded, from)
}

/// Each occurrence of `term` (folded, [`folded_term`]) in `drawn`, a
/// cell's drawn text, as byte ranges of whole characters of it, in order,
/// none overlapping.
pub(crate) fn ranges(drawn: &str, term: &str) -> Vec<Range<usize>> {
    if term.is_empty() {
        return Vec::new();
    }
    let (folded, from) = fold(drawn);
    let mut found: Vec<Range<usize>> = Vec::new();
    for (at, matched) in folded.match_indices(term) {
        let range = from[at].start..from[at + matched.len() - 1].end;
        // Two matches inside one character's fold are one range.
        match found.last_mut() {
            Some(last) if last.end > range.start => last.end = last.end.max(range.end),
            _ => found.push(range),
        }
    }
    found
}

/// What's drawn of a cell (`find`): a match of the term, or the current
/// match, whose color and edge are its own.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Default)]
pub(crate) enum Mark {
    #[default]
    None,
    Match,
    Current,
}

/// What's tinted of a marked cell (`find`): each occurrence of the term in
/// its drawn text, or, where the drawn text doesn't show it, the cell.
#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) enum Found {
    Ranges(Vec<Range<usize>>),
    Cell,
}

/// What's tinted of a cell marked `mark` whose drawn text (after a format
/// and the cut) is `drawn`, `folded` the term ([`folded_term`]).
pub(crate) fn found(mark: Mark, drawn: &str, folded: &str) -> Option<Found> {
    if mark == Mark::None {
        return None;
    }
    let ranges = ranges(drawn, folded);
    Some(if ranges.is_empty() {
        Found::Cell
    } else {
        Found::Ranges(ranges)
    })
}

/// A cell's mark: the current match whatever its text, else a match by
/// the rule (`exact`, none for a NULL, against `lower`, the term
/// lowercased).
#[inline]
pub(crate) fn mark(current: bool, exact: Option<&str>, lower: &str) -> Mark {
    if current {
        Mark::Current
    } else if exact.is_some_and(|exact| matches(exact, lower)) {
        Mark::Match
    } else {
        Mark::None
    }
}

/// What's tinted of a cell by the rule, from its exact text (none for a
/// NULL) and its drawn text: `find.json`'s `ranges`, and a probe's.
pub(crate) fn highlight(
    current: bool,
    exact: Option<&str>,
    drawn: &str,
    term: &str,
) -> Option<Found> {
    let mark = mark(current, exact, &lower(term));
    #[cfg(test)]
    let drawn = match (control(), exact) {
        (Control::CutRanges, Some(exact)) => exact,
        _ => drawn,
    };
    found(mark, drawn, &folded_term(term))
}

/// A gap in a query's order: between two cells, `gap` cells from the
/// first row's first. A step forward searches the cells from it, a step
/// backward the cells before it.
pub(crate) type Gap = u64;

/// The gap a step from `cell` (row `row`, drawn place `place`) starts at,
/// over `shown` (each place's flag): forward, just after it; backward,
/// just before it. A hidden cell is taken at the nearest shown cell before
/// it (forward) or after it (backward), both the same gap.
pub(crate) fn gap_at(row: u64, place: usize, shown: &[bool], backward: bool) -> Gap {
    let width = shown.iter().filter(|&&shown| shown).count() as u64;
    let before = shown[..place.min(shown.len())]
        .iter()
        .filter(|&&shown| shown)
        .count() as u64;
    let on = shown.get(place).copied().unwrap_or(false);
    row * width + before + u64::from(on && !backward)
}

/// The query a step asks first, from `gap`: forward, after the cell before
/// the gap; backward, before the cell after it; none at the end it starts
/// from. `columns` are the shown indices in drawn order, `rows` the rows.
pub(crate) fn first_query(
    term: SharedString,
    columns: Vec<usize>,
    rows: u64,
    gap: Gap,
    backward: bool,
) -> FindQuery {
    let width = columns.len() as u64;
    let cell =
        |position: u64| FoundCell::new(position / width, columns[(position % width) as usize]);
    let after = if backward {
        (gap < rows * width).then(|| cell(gap))
    } else {
        gap.checked_sub(1).map(cell)
    };
    FindQuery::new(term, columns, after, None, backward)
}

/// The second ask after `first` found nothing: from the other end up to
/// its start cell, inclusive, so a lone match is found again; none if it
/// started at the end it would come round from, which has searched every
/// row.
pub(crate) fn wrap_query(first: &FindQuery) -> Option<FindQuery> {
    #[cfg(test)]
    if control() == Control::NoWrap {
        return None;
    }
    let start = first.after?;
    Some(FindQuery {
        after: None,
        until: Some(start),
        ..first.clone()
    })
}

/// `find.json`'s negative controls (tests only), set for the thread.
#[cfg(test)]
#[derive(Debug, Clone, Copy, PartialEq, Eq, Default)]
pub(crate) enum Control {
    #[default]
    None,
    /// The test without the fold: the case must agree.
    CaseSensitive,
    /// The ranges from the exact text, not the drawn (the cell's state
    /// passes the exact text where the drawn would go).
    CutRanges,
    /// No second ask: a match before the start isn't found.
    NoWrap,
}

#[cfg(test)]
thread_local! {
    static CONTROL: std::cell::Cell<Control> = const { std::cell::Cell::new(Control::None) };
}

/// The control in effect on this thread (tests only).
#[cfg(test)]
pub(crate) fn control() -> Control {
    CONTROL.with(std::cell::Cell::get)
}

/// Runs `test` under `control`, then puts none back (tests only).
#[cfg(test)]
pub(crate) fn with_control<T>(control: Control, test: impl FnOnce() -> T) -> T {
    CONTROL.with(|cell| cell.set(control));
    let result = std::panic::catch_unwind(std::panic::AssertUnwindSafe(test));
    CONTROL.with(|cell| cell.set(Control::None));
    match result {
        Ok(value) => value,
        Err(panic) => std::panic::resume_unwind(panic),
    }
}

#[cfg(test)]
mod tests {
    use super::{
        FindQuery, FoundCell, first_query, fold, gap_at, lower, matches, ranges, wrap_query,
    };

    fn query(
        columns: Vec<usize>,
        after: Option<(u64, usize)>,
        until: Option<(u64, usize)>,
        backward: bool,
    ) -> FindQuery {
        FindQuery::new(
            "x",
            columns,
            after.map(|(row, column)| FoundCell::new(row, column)),
            until.map(|(row, column)| FoundCell::new(row, column)),
            backward,
        )
    }

    fn cells(query: &FindQuery, rows: u64) -> Vec<(u64, usize)> {
        query
            .cells(rows)
            .map(|cell| (cell.row, cell.column))
            .collect()
    }

    #[test]
    fn cells_run_along_each_row_in_drawn_order() {
        let forward = query(vec![2, 0], None, None, false);
        assert_eq!(cells(&forward, 2), [(0, 2), (0, 0), (1, 2), (1, 0)]);
        let backward = query(vec![2, 0], None, None, true);
        assert_eq!(cells(&backward, 2), [(1, 0), (1, 2), (0, 0), (0, 2)]);
        let after = query(vec![2, 0], Some((0, 0)), Some((1, 2)), false);
        assert_eq!(cells(&after, 2), [(1, 2)]);
        let before = query(vec![2, 0], Some((1, 2)), Some((0, 0)), true);
        assert_eq!(cells(&before, 2), [(0, 0)]);
        // From the last cell forward, or the first backward: nothing.
        assert!(cells(&query(vec![1], Some((1, 1)), None, false), 2).is_empty());
        assert!(cells(&query(vec![1], Some((0, 1)), None, true), 2).is_empty());
        assert!(cells(&query(vec![], None, None, false), 2).is_empty());
        assert!(cells(&query(vec![0], None, None, false), 0).is_empty());
    }

    #[test]
    fn a_match_is_the_exact_text_folded() {
        assert!(matches("Ceres", "ceres"));
        assert!(matches("CERES", "ere"));
        assert!(!matches("Ceres", "vesta"));
        assert!(matches("ΟΔΟΣ", &lower("οδος")));
        assert!(matches("ΟΔΟΣΑ", &lower("ΟΔΟΣ")));
    }

    #[test]
    #[expect(
        clippy::single_range_in_vec_init,
        reason = "one range, as `ranges` answers"
    )]
    fn the_fold_keeps_where_each_byte_came_from() {
        let (folded, from) = fold("İa");
        assert_eq!(folded, "i\u{307}a");
        assert_eq!(from.len(), folded.len());
        assert_eq!(from[0], 0..2);
        assert_eq!(from[2], 0..2);
        assert_eq!(from[3], 2..3);
        // A match starting inside a character's fold takes it whole.
        assert_eq!(ranges("İstanbul", "i"), [0..2]);
        assert_eq!(ranges("İstanbul", "stan"), [2..6]);
        assert_eq!(ranges("abcabc", "bc"), [1..3, 4..6]);
        // Two matches meeting inside one character's fold are one range.
        assert_eq!(ranges("İİİ", "\u{307}i"), [0..6]);
        assert!(ranges("abc", "").is_empty());
    }

    #[test]
    fn a_step_starts_at_a_gap() {
        let shown = [true, false, true];
        // Row 1's place 2, the second shown: after it forward, before it
        // backward.
        assert_eq!(gap_at(1, 2, &shown, false), 4);
        assert_eq!(gap_at(1, 2, &shown, true), 3);
        // A hidden place: before the next shown either way.
        assert_eq!(gap_at(1, 1, &shown, false), 3);
        assert_eq!(gap_at(1, 1, &shown, true), 3);
        let first = first_query("x".into(), vec![0, 2], 3, 4, false);
        assert_eq!(first.after, Some(FoundCell::new(1, 2)));
        let wrap = wrap_query(&first).expect("a wrap");
        assert_eq!((wrap.after, wrap.until), (None, Some(FoundCell::new(1, 2))));
        // From the start forward, or the end backward: no wrap.
        assert!(wrap_query(&first_query("x".into(), vec![0, 2], 3, 0, false)).is_none());
        assert!(wrap_query(&first_query("x".into(), vec![0, 2], 3, 6, true)).is_none());
        let back = first_query("x".into(), vec![0, 2], 3, 3, true);
        assert_eq!(back.after, Some(FoundCell::new(1, 2)));
    }
}
