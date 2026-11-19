//! `hide`: a column hidden by its host keeps its place and its index, laid
//! out at no width (`layout_columns`), so nothing of it is drawn
//! (`visible_columns`, `Pin::visible`) or hit. Its flag is the column's
//! (`TallTableColumn::hidden`), held by index, so it follows its column
//! through `reorder`'s moves; these setters change it later, and cancel
//! what a hide or a show would leave pointing at the old geometry
//! (`docs/DECISIONS.md`, "Features").

use gpui_kit::*;

use super::{TallTableEvent, TallTableState};
use crate::delegate::TallTableDelegate;

/// The random test's negative controls (tests only, with `reorder`).
#[cfg(all(test, feature = "reorder"))]
#[derive(Debug, Clone, Copy, PartialEq, Eq, Default)]
pub(crate) enum Control {
    #[default]
    None,
    /// The flags kept by place, not index: a move leaves each flag where
    /// it was drawn, on whichever column moves there.
    FlagByPlace,
}

impl<D: TallTableDelegate> TallTableState<D> {
    /// Hides or shows column `index` (by index, as
    /// [`TallTableState::columns`], wherever it's drawn): laid out at no
    /// width, drawn and hit nowhere, its place, width, sort, and group
    /// kept. [`TallTableEvent::ColumnsHidden`] if it changed. An index past
    /// the last (a host's menu built before `set_columns` shortened the
    /// list) changes nothing, quietly, as `set_hidden`'s stale list.
    ///
    /// A change cancels a held `reorder` drag, ends a held `resize` drag as
    /// its release would (`ColumnWidthsChanged` if its width changed), and
    /// forgets `sort`'s pressed and hovered arrow on a column now hidden.
    /// With `pin`, `Pinned` if the run in effect changed. With `select`, a
    /// `Columns` or `Cells` selection left with no shown column clears
    /// (`Selected(None)`, after `ColumnsHidden`); a show doesn't bring it
    /// back. Nothing is read: the pages hold every column.
    pub fn set_column_hidden(&mut self, index: usize, hidden: bool, cx: &mut Context<Self>) {
        let Some(column) = self.column_info.get_mut(index) else {
            return;
        };
        if column.hidden == hidden {
            return;
        }
        column.hidden = hidden;
        self.hidden_changed(cx);
    }

    /// Every column's flag, by index (a saved view given back, in
    /// [`TallTableEvent::ColumnsHidden`]'s shape): one `ColumnsHidden` if
    /// any changed, and what [`TallTableState::set_column_hidden`] ends and
    /// clears.
    /// A list of another length (a view saved before `set_columns` changed
    /// the count) changes nothing, quietly: no event, no debug assertion.
    pub fn set_hidden(&mut self, hidden: Vec<bool>, cx: &mut Context<Self>) {
        if hidden.len() != self.column_info.len() {
            return;
        }
        let mut changed = false;
        for (column, hidden) in self.column_info.iter_mut().zip(hidden) {
            changed |= column.hidden != hidden;
            column.hidden = hidden;
        }
        if changed {
            self.hidden_changed(cx);
        }
    }

    /// The random test's `FlagByPlace` control, after a move from the
    /// order `before`: each place's flag left where it was drawn.
    #[cfg(all(test, feature = "reorder"))]
    pub(super) fn keep_flags_by_place(&mut self, before: &[usize]) {
        if self.hide_control != Control::FlagByPlace {
            return;
        }
        let flags: Vec<bool> = before
            .iter()
            .map(|&index| self.column_info[index].hidden)
            .collect();
        for (place, &index) in self.order.iter().enumerate() {
            self.column_info[index].hidden = flags[place];
        }
    }

    /// Whether the column at `place` is shown: what the keys step to, a
    /// copy writes, and a clamped hit lands on (what's drawn goes by its
    /// width, 0 when it's hidden).
    #[cfg(any(feature = "select", feature = "clicks"))]
    #[inline]
    pub(super) fn place_shown(&self, place: usize) -> bool {
        self.columns.get(place).is_some_and(|column| column.shown())
    }

    /// Whether any column is shown: with none, nothing is selectable
    /// (`select`).
    #[cfg(feature = "select")]
    pub(super) fn any_shown(&self) -> bool {
        self.columns.iter().any(|column| column.shown())
    }

    /// Every column's flag, by index: what `ColumnsHidden` reports.
    pub(super) fn hidden_flags(&self) -> Vec<bool> {
        self.column_info
            .iter()
            .map(|column| column.hidden)
            .collect()
    }

    /// A flag changed: the drags held over the old geometry ended, the
    /// columns laid out again once (the sideways scroll clamped, the run
    /// re-summed), the flags reported, and a selection left nothing shown
    /// cleared.
    fn hidden_changed(&mut self, cx: &mut Context<Self>) {
        // Its places' geometry changed under it (`reorder`).
        #[cfg(feature = "reorder")]
        self.cancel_drag(cx);
        // Any held drag, not only one on the column hidden, ended as its
        // release would, its width reported after the one layout below:
        // `repin` waits while one is held, and its `pin_limit` was summed
        // at the press over the old widths (`resize`). As a second band
        // press ends one, never reverted: a host may have heard its width.
        #[cfg(feature = "resize")]
        let resized = self.take_resized().unwrap_or(false);
        // An arrow on a column now hidden can't be released on (`sort`).
        #[cfg(feature = "sort")]
        self.forget_hidden_arrows();
        self.lay_out(cx);
        #[cfg(feature = "resize")]
        if resized {
            cx.emit(TallTableEvent::ColumnWidthsChanged(self.set_widths()));
        }
        cx.emit(TallTableEvent::ColumnsHidden(self.hidden_flags()));
        // Nothing of it shown: no longer a selection (`select`).
        #[cfg(feature = "select")]
        self.clear_hidden_selection(cx);
        cx.notify();
    }
}
