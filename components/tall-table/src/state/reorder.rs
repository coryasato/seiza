//! `reorder`: the order the columns are drawn in, kept by the table, and a
//! move of a block of them. A column's place is where it's drawn; its index
//! is its place in `set_columns`' list, which a page reads it by, so a move
//! reads nothing. What follows a move: the layout, the selection's places,
//! and `pin`'s count ([`crate::reorder`] is the rules; `docs/DECISIONS.md`,
//! "Features").

use std::ops::Range;

use gpui_kit::*;

use super::{TallTableEvent, TallTableState};
use crate::delegate::TallTableDelegate;
use crate::reorder::{Move, is_order};

impl<D: TallTableDelegate> TallTableState<D> {
    /// The order in effect: `order()[place]` is the index (in
    /// [`TallTableState::columns`]) drawn at that place, 0 at the left.
    pub fn order(&self) -> &[usize] {
        &self.order
    }

    /// Moves the columns at `places` (a block of places) so the first lands
    /// at place `to`, in the order after the move. The columns are laid out
    /// again (no page is read: a page holds every column), the sideways
    /// scroll kept and clamped.
    ///
    /// With `select`, a `Columns` or `Cells` range follows its columns while
    /// they're still side by side (else it's cleared), with
    /// [`TallTableEvent::Selected`] when its places change; a `Rows` range
    /// stays. With `pin`, a block moved into the run pins and one moved out
    /// unpins, the count changed by the columns that crossed (`Pinned` if
    /// the run in effect changes); at the run's end, the place both sides
    /// share, the block keeps its first column's side
    /// ([`TallTableState::move_columns_pinned`] picks it).
    ///
    /// Then [`TallTableEvent::ColumnsMoved`]. Nothing for an empty block, a
    /// block past the columns, a `to` past the columns less the block's
    /// length, or a move that changes neither the order nor the count.
    pub fn move_columns(&mut self, places: Range<usize>, to: usize, cx: &mut Context<Self>) {
        self.move_block(Move { places, to }, None, cx);
    }

    /// As [`TallTableState::move_columns`], the block landing pinned or not
    /// as `pinned` says where `to` is the run's end (a drag's release calls
    /// this, with the pointer's side of the run's edge); nothing where `to`
    /// is on the other side of the run from `pinned`.
    #[cfg(feature = "pin")]
    pub fn move_columns_pinned(
        &mut self,
        places: Range<usize>,
        to: usize,
        pinned: bool,
        cx: &mut Context<Self>,
    ) {
        self.move_block(Move { places, to }, Some(pinned), cx);
    }

    /// Sets the order: `order[place]` is the index drawn there. Refused
    /// unless a permutation of the columns' indices (a debug assertion;
    /// nothing changes). Nothing if it's the order in effect.
    ///
    /// With `select`, a `Columns` or `Cells` selection is cleared
    /// ([`TallTableEvent::Selected`]`(None)`); a `Rows` one stays. With
    /// `pin`, the count is kept as a count of places, so the first *n* drawn
    /// pin, whichever they are now: a host restoring an order with its pins
    /// calls `set_pinned` after, with the count `ColumnsMoved` gave it.
    /// Then [`TallTableEvent::ColumnsMoved`].
    pub fn set_order(&mut self, order: Vec<usize>, cx: &mut Context<Self>) {
        if !is_order(&order, self.column_info.len()) {
            // The tests reach it on purpose (the refusal's).
            #[cfg(not(test))]
            debug_assert!(false, "set_order: {order:?} isn't an order of the columns");
            return;
        }
        if order == self.order {
            return;
        }
        self.order = order;
        #[cfg(feature = "select")]
        self.order_selection(cx);
        self.lay_out(cx);
        self.emit_moved(cx);
        cx.notify();
    }

    /// `mv`, at the run's end on `pinned`'s side (`None`: the block's first
    /// column's), if it fits and changes the order or the count.
    fn move_block(&mut self, mv: Move, pinned: Option<bool>, cx: &mut Context<Self>) {
        let columns = self.order.len();
        #[cfg(feature = "pin")]
        let Some(count) = mv.moves(
            columns,
            self.pin_state.count,
            pinned,
            #[cfg(test)]
            self.reorder_control,
        ) else {
            return;
        };
        #[cfg(not(feature = "pin"))]
        {
            let _ = pinned;
            if !mv.fits(columns) || mv.to == mv.places.start {
                return;
            }
        }
        self.order = mv.order_after(&self.order);
        #[cfg(feature = "select")]
        if let Some(selection) = self.selection_state.current {
            let after = mv.selection_after(
                selection,
                #[cfg(test)]
                self.reorder_control,
            );
            self.replace_selection(after, cx);
        }
        // Laid out with the count after, so the run is computed once, and
        // `Pinned` emitted if it changed.
        #[cfg(feature = "pin")]
        {
            self.pin_state.count = count;
        }
        self.lay_out(cx);
        self.emit_moved(cx);
        cx.notify();
    }

    /// [`TallTableEvent::ColumnsMoved`] with the order and, with `pin`, the
    /// host's count.
    fn emit_moved(&mut self, cx: &mut Context<Self>) {
        cx.emit(TallTableEvent::ColumnsMoved {
            order: self.order.clone(),
            #[cfg(feature = "pin")]
            pinned: self.pin_state.count,
        });
    }
}
