//! `replace_rows`: every row index means another row now (a filter, a query
//! run again), and the reset it shares with `sort`. The reset forgets what
//! the table keeps by index (its pages and reads, the hover, the jump's
//! highlight, with `select` a `Rows` or `Cells` range, with `copy` a copy
//! running), puts the view at its target, and plans the reads once the
//! update ends; with `sort`, the sort in effect is told to the source again
//! first (the root's `docs/research/tall-table-features.md`,
//! "`replace_rows`"; `docs/DECISIONS.md`, "Features").

use gpui_kit::Context;

use super::{Direction, TallTableState};
use crate::delegate::TallTableDelegate;

/// Where the view lands after [`TallTableState::replace_rows`].
#[non_exhaustive]
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ViewAt {
    /// Row 0.
    Top,
    /// The view's top at this row, clamped as
    /// [`TallTableState::jump_to`]'s; no highlight, no selection.
    Row(u64),
    /// The last rows, as `follow()` puts them; following stays as it was.
    End,
}

impl<D: TallTableDelegate> TallTableState<D> {
    /// Every row index means another row now: the source holds `rows` rows
    /// (a filter applied, a query run again, a grouped result). Every page
    /// is forgotten and its read cancelled, an answer to one dropped
    /// whatever it holds; the view lands at `at` (the sideways scroll
    /// kept); the new rows' reads start once the update that called this
    /// ends, one plan for every `replace_rows`, `set_columns`, and
    /// `set_sort` in it (and with `live`, `set_rows`; without it,
    /// `set_rows` reads at its call). No event of its own: the host made
    /// the call.
    ///
    /// **Swap the source in the same update,** once its count is known.
    /// Swapped an update earlier, a frame can draw the new source's rows
    /// beside the old ones' pages; swapped in the same update, nothing is
    /// drawn or read between the swap and the call. So a source whose count
    /// arrives later is kept aside until then:
    ///
    /// ```ignore
    /// let filtered = source.filter(predicate);
    /// cx.spawn(async move |this, cx| {
    ///     let rows = filtered.count().await;
    ///     this.update(cx, |this, cx| {
    ///         *this.delegate_mut() = filtered;
    ///         this.replace_rows(rows, ViewAt::Top, cx);
    ///     })
    /// });
    /// ```
    ///
    /// Correcting the count afterwards with [`TallTableState::set_rows`]
    /// works (a source that calls with an estimate), but the scrollbar jumps
    /// when it lands. The old rows stay drawn until the call; saying a
    /// filter is pending is the host's.
    ///
    /// **New columns** (a grouped result): call
    /// [`TallTableState::set_columns`] in the same update, before or after;
    /// either order ends the same.
    ///
    /// What's kept by row goes: the hover and its tooltip, the jump's
    /// highlight, with `live` the invalidations (a `Refreshed` awaited for
    /// one never comes: the new rows' first reads emit none, so a host
    /// timing the replace marks its next `Filled`) and with `custom-cells`
    /// the flashes. With `select`, a `Rows` or `Cells` range is cleared and
    /// a `Columns` range keeps its columns, its rows at row 0 (`Top`), the
    /// named row clamped to the rows (`Row`), or the last row (`End`), as
    /// `set_rows` moves one (`TallTableEvent::Selected`). Unlike `DataTable`'s `refresh`, a
    /// selected row's index isn't kept: it would be another row. With
    /// `copy`, a copy running fails (`CopyFailure::Cancelled`). With
    /// `follow`, `ViewAt::End` leaves following as it was and the other
    /// targets let go unless every row fits (`TallTableEvent::Following`);
    /// the drawn tail is forgotten, so `TailDrawn` is emitted again.
    ///
    /// With `sort`, the sort is kept and the source is told it again
    /// (`TallTableDelegate::sort`) once the update ends, right before the
    /// reads, with the sort in effect then: a call that tells it a sort
    /// after this one in the update (`set_sort`, `set_columns` clearing a
    /// sort whose column is gone) tells it in its place, and a later
    /// `set_sort` puts the view at the top, as any sort does. A refusal
    /// clears the sort (the source told none) with the view where it
    /// landed: `TallTableEvent::Sorted` with no keys, then
    /// `TallTableEvent::SortRefused`. A sort kept by its column's name may
    /// name a same-named column of another result: a host that wants a
    /// clean slate clears it (`set_sort` with no keys) in the same update.
    ///
    /// On a closed table ([`TallTableState::close`]) the count and the view
    /// follow, and nothing is read, cancelled, or told.
    pub fn replace_rows(&mut self, rows: u64, at: ViewAt, cx: &mut Context<Self>) {
        // The count first, as `set_rows` takes it; its pages are all
        // forgotten next, so the cache cuts none here.
        self.scroll.set_rows(rows);
        #[cfg(feature = "sort")]
        self.replaced();
        self.reset_rows(at, cx);
        // A closed table's cache is left as `close` left it, as `set_rows`
        // leaves it.
        if !self.closed {
            for request in self.cache.set_rows(rows) {
                self.delegate.cancel(request, cx);
            }
        }
        self.reset_load(cx);
    }

    /// The reset: every index means another row. What's kept by index
    /// cleared, every page forgotten and its read cancelled (one decision),
    /// the view at `at`, and following kept at the end or let go. The
    /// caller plans the reads (`reset_load`) after the events it emits.
    pub(super) fn reset_rows(&mut self, at: ViewAt, cx: &mut Context<Self>) {
        self.reset_kept_by_row(at, cx);
        #[cfg(feature = "follow")]
        self.reset_following(at == ViewAt::End, cx);
    }

    /// The reset but for following (`set_columns` clearing a sort decides
    /// it at the update's end).
    pub(super) fn reset_kept_by_row(&mut self, at: ViewAt, cx: &mut Context<Self>) {
        #[cfg(feature = "copy")]
        self.cancel_copy(cx);
        // Forgotten on a closed table too, so a last frame draws none of
        // them under indices that mean other rows; a page with a read out
        // is left as `close` left it (its read cancelled, its place held).
        if self.closed {
            self.cache.forget_all(true);
        } else {
            for request in self.cache.forget_all(false) {
                self.delegate.cancel(request, cx);
            }
        }
        #[cfg(all(feature = "live", feature = "custom-cells"))]
        self.flashes.clear();
        self.hover = None;
        self.marked = None;
        // A find out and the current match name rows of the old order
        // (`find`).
        #[cfg(feature = "find")]
        self.reset_find(cx);
        // Its row means another (`popover`).
        #[cfg(feature = "popover")]
        self.reset_popover(cx);
        #[cfg(feature = "select")]
        {
            let last = self.scroll.rows().saturating_sub(1);
            self.reset_selection(
                match at {
                    ViewAt::Top => 0,
                    ViewAt::Row(row) => row.min(last),
                    ViewAt::End => last,
                },
                cx,
            );
        }
        self.scroll.set_top(match at {
            ViewAt::Top => 0.0,
            ViewAt::Row(row) => row as f64,
            ViewAt::End => self.scroll.max_top(),
        });
        // Not a scroll: prefetch doesn't lean.
        self.direction = Direction::Still;
        self.scroll_settle = None;
        cx.notify();
    }

    /// Plans the reads once the update ends, once for every reset in it,
    /// after the events emitted before it reach their subscribers: with
    /// `sort`, after the source is told its sort (a refusal's events
    /// heard first, then planned); during a scrollbar drag, once its
    /// pointer rests.
    pub(super) fn reset_load(&mut self, cx: &mut Context<Self>) {
        if std::mem::replace(&mut self.reset_deferred, true) {
            return;
        }
        let this = cx.weak_entity();
        cx.defer(move |cx| {
            let _ = this.update(cx, |this, cx| {
                #[cfg(feature = "sort")]
                let refused = this.sort_after_update(cx);
                this.reset_deferred = false;
                #[cfg(feature = "sort")]
                if refused {
                    this.reset_load(cx);
                    return;
                }
                this.load_or_settle(cx);
            });
        });
    }
}
