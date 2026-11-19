//! `find`: the term, the current match, and the one find out. A step asks
//! the source (`TallTableDelegate::find`) from where it starts, and once
//! more from the other end if nothing matched (`wrapped`); the answer
//! lands as a jump does, its cell selected with `select`. What changes
//! which cell an index names cancels the find out and forgets the current
//! match; a move or a hide cancels it and keeps the match, by index
//! (`docs/DECISIONS.md`, "Features", 2026-11-18, `find`).

use gpui_kit::*;

#[cfg(feature = "follow")]
use super::follow::Reach;
use super::{TallTableEvent, TallTableState};
use crate::delegate::{CellValue, PageError, TallTableDelegate};
use crate::find::{self, FindOutcome, FindQuery, FoundCell, Gap, Mark};

/// The find a step has out: its request, its query, and whether it's the
/// second ask, from the other end.
pub(super) struct Out<R> {
    pub(super) request: R,
    query: FindQuery,
    wrapped: bool,
}

/// The term, the current match, and the find out (`find`).
pub(super) struct FindState<D: TallTableDelegate> {
    pub(super) term: Option<SharedString>,
    /// The term lowercased (`find::lower`): the match rule's.
    lower: String,
    /// The term folded a character at a time: the ranges'.
    folded: std::rc::Rc<str>,
    pub(super) current: Option<FoundCell>,
    pub(super) out: Option<Out<D::Request>>,
    /// The selection the last landing left (`select`): a selection that's
    /// still it isn't the reader's, so a step doesn't start from it.
    #[cfg(feature = "select")]
    pub(super) landed: Option<crate::TallTableSelection>,
    /// The table, for `close`'s `Cancelled`, which `close` can't emit.
    this: WeakEntity<TallTableState<D>>,
    /// The random test's negative controls (with `sort`).
    #[cfg(all(test, feature = "sort"))]
    pub(crate) control: Control,
}

/// The random test's negative controls (tests only, with `sort`).
#[cfg(all(test, feature = "sort"))]
#[derive(Debug, Clone, Copy, PartialEq, Eq, Default)]
pub(crate) enum Control {
    #[default]
    None,
    /// A sort leaves the find out, so its answer of the old order lands.
    KeepFindOnSort,
}

impl<D: TallTableDelegate> FindState<D> {
    pub(super) fn new(this: WeakEntity<TallTableState<D>>) -> Self {
        Self {
            term: None,
            lower: String::new(),
            folded: "".into(),
            current: None,
            out: None,
            #[cfg(feature = "select")]
            landed: None,
            this,
            #[cfg(all(test, feature = "sort"))]
            control: Control::None,
        }
    }
}

impl<D: TallTableDelegate> TallTableState<D> {
    /// Sets the term (`None` or empty: no find): every drawn cell whose
    /// exact text contains it, both lowercased, is highlighted, and the
    /// next step searches for it. A find out is cancelled
    /// (`TallTableEvent::Found` with `FindOutcome::Cancelled`) and the
    /// current match forgotten, so the next step starts from the reader's
    /// selection (`select`) or the view's top. The same term again changes
    /// nothing.
    pub fn set_find(&mut self, term: Option<SharedString>, cx: &mut Context<Self>) {
        let term = term.filter(|term| !term.is_empty());
        if term == self.find_state.term {
            return;
        }
        self.cancel_find(cx);
        self.find_state.current = None;
        self.find_state.lower = term.as_deref().map(find::lower).unwrap_or_default();
        // The random test's `CaseSensitive`: the term as it was typed.
        #[cfg(test)]
        if find::control() == find::Control::CaseSensitive {
            self.find_state.lower = term.as_deref().unwrap_or_default().to_string();
        }
        self.find_state.folded = term
            .as_deref()
            .map(find::folded_term)
            .unwrap_or_default()
            .into();
        self.find_state.term = term;
        cx.notify();
    }

    /// Steps to the next match, along each row in drawn order then down,
    /// coming round from the top past the last: `TallTableEvent::FindStarted`,
    /// then `TallTableEvent::Found` once the source answers. It starts after
    /// whichever was set last of the current match and, with `select`, the
    /// reader's own selection (its active cell, or a `Rows` range's row
    /// from its start); with neither, from the view's top row. The match
    /// found is the current match: a row out of view lands at the top, as
    /// [`TallTableState::jump_to`] puts it, its column brought into view
    /// unless pinned; with `select` its cell is selected (with cells on;
    /// its row with rows only), and with `follow` following goes as at a
    /// jump. Ignored with no term, with a step out, and on a closed table.
    pub fn find_next(&mut self, cx: &mut Context<Self>) {
        self.find_step(false, cx);
    }

    /// As [`TallTableState::find_next`], up and to the left: from before
    /// the current match (or the reader's cell, or a `Rows` range's row
    /// from its end, or the view's top row), coming round from the end.
    pub fn find_previous(&mut self, cx: &mut Context<Self>) {
        self.find_step(true, cx);
    }

    /// The term set, none for no find.
    pub fn find_term(&self) -> Option<&SharedString> {
        self.find_state.term.as_ref()
    }

    /// The current match: the cell the last step found, by row and column
    /// index, until a new term, a sort, `replace_rows`, `set_columns`, or a
    /// shrink past its row forgets it.
    pub fn current_match(&self) -> Option<FoundCell> {
        self.find_state.current
    }

    fn find_step(&mut self, backward: bool, cx: &mut Context<Self>) {
        if self.closed || self.find_state.out.is_some() {
            return;
        }
        let Some(term) = self.find_state.term.clone() else {
            return;
        };
        cx.emit(TallTableEvent::FindStarted);
        let shown = self.shown_places();
        let columns: Vec<usize> = shown
            .iter()
            .enumerate()
            .filter(|(_, shown)| **shown)
            .map(|(place, _)| self.columns[place].index(place))
            .collect();
        let rows = self.scroll.rows();
        if columns.is_empty() || rows == 0 {
            self.find_ended(FindOutcome::NoMatch, cx);
            return;
        }
        let gap = self.find_gap(&shown, backward);
        let query = find::first_query(term, columns, rows, gap, backward);
        self.ask_find(query, false, cx);
    }

    /// Each place's flag: shown (`hide`), else every place.
    fn shown_places(&self) -> Vec<bool> {
        self.columns
            .iter()
            .map(|_column| {
                #[cfg(feature = "hide")]
                return _column.shown();
                #[cfg(not(feature = "hide"))]
                true
            })
            .collect()
    }

    /// Where a step starts: the reader's selection if it's theirs
    /// (`select`), else the current match, else the view's top row.
    fn find_gap(&self, shown: &[bool], backward: bool) -> Gap {
        let width = shown.iter().filter(|&&shown| shown).count() as u64;
        let last = self.scroll.rows() - 1;
        #[cfg(feature = "select")]
        if let Some(selection) = self
            .selection_state
            .current
            .filter(|selection| Some(*selection) != self.find_state.landed)
        {
            let (row, place) = selection.anchor();
            let row = row.min(last);
            match selection.kind() {
                crate::selection::Kind::Cells => {
                    return find::gap_at(row, place, shown, backward);
                }
                crate::selection::Kind::Rows => {
                    return (if backward { row + 1 } else { row }) * width;
                }
                crate::selection::Kind::Columns => {}
            }
        }
        if let Some(cell) = self.find_state.current
            && let Some(place) = self.place_of(cell.column)
        {
            return find::gap_at(cell.row.min(last), place, shown, backward);
        }
        self.scroll.visible().start.min(last) * width
    }

    /// The place column `index` is drawn at.
    pub(super) fn place_of(&self, index: usize) -> Option<usize> {
        (0..self.columns.len()).find(|&place| self.columns[place].index(place) == index)
    }

    /// Asks the source `query`: the find out, answered on a task; a
    /// refusal ends the step.
    fn ask_find(&mut self, query: FindQuery, wrapped: bool, cx: &mut Context<Self>) {
        let Some((request, load)) = self.delegate.find(&query, cx) else {
            self.find_ended(FindOutcome::Refused, cx);
            return;
        };
        self.find_state.out = Some(Out {
            request,
            query,
            wrapped,
        });
        cx.notify();
        cx.spawn(async move |this, cx| {
            let result = load.await;
            let _ = this.update(cx, |this, cx| this.find_done(request, result, cx));
        })
        .detach();
    }

    /// The source answered `request`: dropped unless it's the find out
    /// (a cancelled one's, or a closed table's).
    fn find_done(
        &mut self,
        request: D::Request,
        result: Result<Option<FoundCell>, PageError>,
        cx: &mut Context<Self>,
    ) {
        if !self
            .find_state
            .out
            .as_ref()
            .is_some_and(|out| out.request == request)
        {
            return;
        }
        let Some(out) = self.find_state.out.take() else {
            return;
        };
        match result {
            Ok(Some(cell)) if cell.row < self.scroll.rows() => self.land(cell, out.wrapped, cx),
            // A row the table doesn't hold yet (a source's tail that grew
            // during its scan, its `set_rows` still to come): nothing
            // before the end, so the wrap still asks from the other end.
            Ok(_) => match find::wrap_query(&out.query).filter(|_| !out.wrapped) {
                Some(query) => self.ask_find(query, true, cx),
                None => self.find_ended(FindOutcome::NoMatch, cx),
            },
            Err(PageError::Cancelled) => self.find_ended(FindOutcome::Cancelled, cx),
            Err(PageError::Failed { message, .. }) => {
                self.find_ended(FindOutcome::Failed(message.into()), cx)
            }
        }
    }

    fn find_ended(&mut self, outcome: FindOutcome, cx: &mut Context<Self>) {
        cx.emit(TallTableEvent::Found(outcome));
        cx.notify();
    }

    /// The match found: the current match, selected (`select`), its row
    /// brought into view as a jump's and its column sideways.
    fn land(&mut self, cell: FoundCell, wrapped: bool, cx: &mut Context<Self>) {
        self.find_state.current = Some(cell);
        let place = self.place_of(cell.column);
        #[cfg(feature = "select")]
        self.select_found(cell.row, place, cx);
        let (top, rows) = (self.scroll.top(), self.scroll.viewport_rows());
        let row = cell.row as f64;
        let in_view = row >= top && row + 1.0 <= top + rows;
        // Decided before the move, as a jump's (`follow`).
        #[cfg(feature = "follow")]
        self.reader_moved(Reach::Land, if in_view { top } else { row }, cx);
        if !in_view {
            self.move_top_to(row, cx);
        }
        if let Some(place) = place {
            self.column_into_view(place, cx);
        }
        self.find_ended(FindOutcome::Match { cell, wrapped }, cx);
    }

    /// The found cell selected (`select`): the cell with cells on, else its
    /// row with rows on; a `Columns`-only selection is left. What's
    /// selected after is the landing's, not the reader's.
    #[cfg(feature = "select")]
    fn select_found(&mut self, row: u64, place: Option<usize>, cx: &mut Context<Self>) {
        use crate::selection::Kind;
        let selectable = self.selection_state.selectable;
        let kind = [Kind::Cells, Kind::Rows]
            .into_iter()
            .find(|kind| selectable.allows(*kind));
        if let (Some(kind), Some(place)) = (kind, place) {
            let cell = (row, place);
            self.replace_selection(Some(crate::TallTableSelection::new(kind, cell, cell)), cx);
        }
        self.find_state.landed = self.selection_state.current;
    }

    /// Cancels the find out, if one is: its request through the delegate's
    /// `cancel`, `Found(Cancelled)`; its answer, if it comes, is dropped.
    pub(super) fn cancel_find(&mut self, cx: &mut Context<Self>) {
        if let Some(out) = self.find_state.out.take() {
            self.delegate.cancel(out.request, cx);
            self.find_ended(FindOutcome::Cancelled, cx);
        }
    }

    /// Every index means another row or column (`replace_rows`, a sort,
    /// `set_columns`): the find out cancelled, the current match forgotten.
    pub(super) fn reset_find(&mut self, cx: &mut Context<Self>) {
        self.cancel_find(cx);
        self.find_state.current = None;
    }

    /// The random test's `KeepFindOnSort`, around a sort's reset: the
    /// find out taken before it (`None` without the control) and put back
    /// after, so its answer of the old order lands.
    #[cfg(all(test, feature = "sort"))]
    pub(super) fn keep_find_on_sort(&mut self) -> Option<Out<D::Request>> {
        if self.find_state.control != Control::KeepFindOnSort {
            return None;
        }
        self.find_state.out.take()
    }

    /// The rows shrank to `rows` (`set_rows`): a find out cancelled (its
    /// range was of the old count), a current match past the end
    /// forgotten. A grow keeps both.
    pub(super) fn cut_find(&mut self, rows: u64, shrunk: bool, cx: &mut Context<Self>) {
        if !shrunk {
            return;
        }
        if !self.closed {
            self.cancel_find(cx);
        }
        if self.find_state.current.is_some_and(|cell| cell.row >= rows) {
            self.find_state.current = None;
        }
    }

    /// `close`: the find out cancelled, `Found(Cancelled)` once the
    /// update ends (`close` can't emit).
    pub(super) fn close_find(&mut self, cx: &mut App) {
        let Some(out) = self.find_state.out.take() else {
            return;
        };
        self.delegate.cancel(out.request, cx);
        let this = self.find_state.this.clone();
        cx.defer(move |cx| {
            let _ = this.update(cx, |_, cx| {
                cx.emit(TallTableEvent::Found(FindOutcome::Cancelled));
            });
        });
    }

    /// What's drawn of the find on the cell at `row` and column `index`
    /// holding `value`: the current match whatever it holds, a match of
    /// the term, or nothing.
    #[inline]
    pub(super) fn find_mark(&self, row: u64, index: usize, value: &CellValue<'_>) -> Mark {
        if self.find_state.term.is_none() {
            return Mark::None;
        }
        let current = self.find_state.current == Some(FoundCell::new(row, index));
        let exact = (!current && *value != CellValue::Null).then(|| value.to_string());
        find::mark(current, exact.as_deref(), &self.find_state.lower)
    }

    /// The colors and term the cells' text draws the find with, while a
    /// term is set.
    pub(super) fn find_paint(&self, cx: &App) -> Option<crate::cells_text::FindPaint> {
        use gpui_kit::component::ActiveTheme as _;
        self.find_state.term.as_ref()?;
        let theme = cx.theme();
        Some(crate::cells_text::FindPaint::new(
            self.find_state.folded.clone(),
            theme.selection,
            theme.ring,
        ))
    }

    /// The probe's `find`.
    pub(super) fn find_probe(&self) -> crate::FindProbe {
        crate::FindProbe {
            term: self.find_state.term.as_ref().map(ToString::to_string),
            current: self.find_state.current,
            out: self.find_state.out.is_some(),
        }
    }
}
