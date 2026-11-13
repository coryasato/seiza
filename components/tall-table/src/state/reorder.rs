//! `reorder`: the order the columns are drawn in, kept by the table, and a
//! move of a block of them. A column's place is where it's drawn; its index
//! is its place in `set_columns`' list, which a page reads it by, so a move
//! reads nothing. What follows a move: the layout, the selection's places,
//! and `pin`'s count ([`crate::reorder`] is the rules; `docs/DECISIONS.md`,
//! "Features").
//!
//! The drag: a press on a movable header (with `select`'s `Columns` kind
//! on, inside the selected range) that passes 2 px moves its block, the
//! table's own drag (never a GPUI `Drag`), followed by the move, release,
//! and wheel handlers the body's `canvas` registers every frame; Escape
//! cancels it. Drawn: the block's headers lifted over the header, a line
//! at the gap through the header and body, the closed hand.

use std::ops::Range;

use gpui_kit::component::ActiveTheme as _;
use gpui_kit::prelude::FluentBuilder as _;
use gpui_kit::*;

use super::{TallTableEvent, TallTableState, padded};
use crate::delegate::TallTableDelegate;
use crate::reorder::{Gap, LINE, Move, View, gap, is_order};
#[cfg(feature = "select")]
use crate::selection::{Cell, Kind, TallTableSelection};

actions!(seiza_tall_table, [CancelMove]);

/// How far the pointer moves before a press on a header drags: GPUI's
/// drag threshold.
const THRESHOLD: f32 = 2.0;

/// Binds Escape to cancel a drag. Called by [`crate::init`] after the
/// others: at the same depth the latest binding goes first, and with no
/// drag its action propagates to the next (`select`'s, or the host's).
pub(crate) fn init(cx: &mut App) {
    cx.bind_keys([KeyBinding::new("escape", CancelMove, Some(super::CONTEXT))]);
}

/// What the last frame drew of a drag (tests only), in the header's and
/// the body's pixels.
#[cfg(test)]
#[derive(Debug, Clone, Default, PartialEq)]
pub(crate) struct Drawn {
    /// The preview's left and width.
    pub(crate) preview: Option<(f32, f32)>,
    /// The line's left in the header, and in the body.
    pub(crate) lines: [Option<f32>; 2],
}

/// A header pressed to move its block: a drag once the pointer passes
/// [`THRESHOLD`], from the press to the release.
#[derive(Debug, Clone, PartialEq)]
pub(crate) struct Moving {
    /// The places it moves.
    pub(crate) block: Range<usize>,
    /// The press, in window pixels.
    press: Point<Pixels>,
    /// The pointer's x at the press less the block's left on screen: the
    /// preview keeps it under the pointer.
    grab: f32,
    /// The pointer's x now, in window pixels.
    x: f32,
    /// Past the threshold: the preview and the line are drawn.
    pub(crate) started: bool,
    /// A press inside the selected range (`select`): the column it selects
    /// alone at a release that never started (`None` inside: no rows).
    #[cfg(feature = "select")]
    select: Option<Option<Cell>>,
    /// The gap the line is drawn at.
    pub(crate) gap: Option<Gap>,
}

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
        self.cancel_drag(cx);
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
        // A host's move during a drag leaves its places stale.
        self.cancel_drag(cx);
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

// --- the drag ---

impl<D: TallTableDelegate> TallTableState<D> {
    /// The place whose header is under `position` (window pixels), if any:
    /// the header's row, over the cells area, on a column.
    fn header_place_at(&self, position: Point<Pixels>) -> Option<usize> {
        let x = f32::from(position.x - self.body.origin.x) - self.gutter_width();
        let y = f32::from(position.y - self.body.origin.y);
        let row_h = f32::from(self.sizes().row());
        if !(-row_h..0.0).contains(&y) || !(0.0..self.cells_width()).contains(&x) {
            return None;
        }
        let x = self.place().content_x(x, self.scroll_x);
        self.columns
            .iter()
            .position(|column| (column.x..column.x + column.width).contains(&x))
    }

    /// Whether every column at `places` is movable.
    fn movable(&self, places: &Range<usize>) -> bool {
        places.clone().all(|place| {
            self.columns
                .get(place)
                .and_then(|column| self.column_info.get(column.index(place)))
                .is_some_and(|column| column.movable)
        })
    }

    /// A left press on the table (the bands, arrows, and scrollbars stop
    /// theirs first): on a movable header, a drag may follow. With
    /// `select`'s `Columns` kind on, only a press inside the selected
    /// `Columns` range, every column in it movable, and it's the range's:
    /// `true`, so `select`'s press doesn't run (the press selects that
    /// column alone at a release that never dragged). Shift, Cmd, Ctrl, and
    /// a double-click's second press never move.
    pub(super) fn press_move(&mut self, event: &MouseDownEvent, cx: &mut Context<Self>) -> bool {
        // A drag whose release went unseen: its drawing goes.
        self.cancel_drag(cx);
        let modifiers = event.modifiers;
        if modifiers.shift || modifiers.platform || modifiers.control || event.click_count >= 2 {
            return false;
        }
        let Some(place) = self.header_place_at(event.position) else {
            return false;
        };
        #[cfg(feature = "select")]
        let (block, select) = if self.selection_state.selectable.columns {
            let Some(range) = self
                .selection_state
                .current
                .filter(|selection| selection.kind() == Kind::Columns)
                .and_then(|selection| selection.columns(self.columns.len()))
                .filter(|range| range.contains(&place))
            else {
                return false;
            };
            // The column alone if no drag follows: none to select with no
            // rows, but the range still moves.
            (
                *range.start()..*range.end() + 1,
                Some(self.cell_clamped(event.position)),
            )
        } else {
            (place..place + 1, None)
        };
        #[cfg(not(feature = "select"))]
        let block = place..place + 1;
        if !self.movable(&block) {
            return false;
        }
        let x = f32::from(event.position.x);
        let left = self
            .place()
            .left(block.start, self.columns[block.start].x, self.scroll_x)
            + f32::from(self.body.origin.x)
            + self.gutter_width();
        self.moving = Some(Moving {
            block,
            press: event.position,
            grab: x - left,
            x,
            started: false,
            #[cfg(feature = "select")]
            select,
            gap: None,
        });
        #[cfg(feature = "select")]
        return select.is_some();
        #[cfg(not(feature = "select"))]
        false
    }

    /// Whether a drag is moving columns: no hover, and so no tooltip,
    /// meanwhile.
    pub(super) fn is_moving(&self) -> bool {
        self.moving.as_ref().is_some_and(|moving| moving.started)
    }

    /// The gap a drag of `block` shows with the pointer at `x` (window
    /// pixels).
    fn gap_at(&self, block: &Range<usize>, x: f32) -> Option<Gap> {
        let place = self.place();
        #[cfg(feature = "pin")]
        let (run, edge, count) = (place.columns, place.edge(), self.pin_state.count);
        #[cfg(not(feature = "pin"))]
        let (run, edge, count) = (0, place.edge(), 0);
        gap(
            View {
                columns: &self.columns,
                cells_width: self.cells_width(),
                scroll_x: self.scroll_x,
                run,
                edge,
            },
            count,
            block.clone(),
            x - f32::from(self.body.origin.x) - self.gutter_width(),
            #[cfg(test)]
            self.reorder_control,
        )
    }

    /// The pointer moved with the button down: past the threshold the drag
    /// starts; the preview follows the pointer's x and the gap is found
    /// again. A redraw only when either moves.
    pub(super) fn move_drag_to(&mut self, position: Point<Pixels>, cx: &mut Context<Self>) {
        let Some(moving) = self.moving.as_mut() else {
            return;
        };
        if !moving.started {
            let moved = position - moving.press;
            if f32::from(moved.x).hypot(f32::from(moved.y)) <= THRESHOLD {
                return;
            }
            moving.started = true;
            self.hide_tooltip(cx);
            cx.notify();
        }
        self.drag_x(f32::from(position.x), cx);
    }

    /// The pointer's x is `x`, or the columns under it moved: the gap
    /// found again, a redraw if it or the preview moved.
    fn drag_x(&mut self, x: f32, cx: &mut Context<Self>) {
        let Some(block) = self.moving.as_ref().map(|moving| moving.block.clone()) else {
            return;
        };
        let gap = self.gap_at(&block, x);
        let Some(moving) = self.moving.as_mut() else {
            return;
        };
        if moving.x != x || moving.gap != gap {
            moving.x = x;
            moving.gap = gap;
            cx.notify();
        }
    }

    /// A wheel anywhere in the window during a drag: the body scrolls as
    /// the base's wheel scrolls it, and the gap follows the columns now
    /// under the pointer.
    pub(super) fn move_wheel(&mut self, event: &ScrollEvent, cx: &mut Context<Self>) {
        self.on_scroll_wheel(event, cx);
        if let Some(x) = self.moving.as_ref().map(|moving| moving.x) {
            self.drag_x(x, cx);
        }
    }

    /// The button came up: a drag at a gap moves its block to the gap the
    /// last frame drew (the line the reader saw), on the pointer's side at
    /// the run's end (`pin`); a drag without one moves nothing. A press
    /// inside a selected range that never dragged selects its column alone
    /// (`select`).
    pub(super) fn end_move(&mut self, cx: &mut Context<Self>) {
        let Some(moving) = self.moving.take() else {
            return;
        };
        if !moving.started {
            #[cfg(feature = "select")]
            if let Some(Some(cell)) = moving.select {
                self.replace_selection(
                    Some(TallTableSelection::new(Kind::Columns, cell, cell)),
                    cx,
                );
            }
            return;
        }
        cx.notify();
        let Some(gap) = moving.gap else {
            return;
        };
        let mv = Move {
            places: moving.block,
            to: gap.to,
        };
        #[cfg(feature = "pin")]
        self.move_block(mv, Some(gap.pinned), cx);
        #[cfg(not(feature = "pin"))]
        self.move_block(mv, None, cx);
    }

    /// A pointer move with the button up: the release went unseen. A drag
    /// is cancelled (the reader may not have finished it); a press that
    /// never dragged is the click it was.
    pub(super) fn release_unseen(&mut self, cx: &mut Context<Self>) {
        if self.is_moving() {
            self.cancel_drag(cx);
        } else {
            self.end_move(cx);
        }
    }

    /// The gap found again at the pointer's x before a frame draws it: the
    /// columns may have moved under it since the last pointer move (a
    /// host's `set_pinned`, the keys' sideways scroll, a new layout). Never
    /// asks for a frame: it's in one.
    pub(super) fn refresh_gap(&mut self) {
        let Some((block, x)) = self
            .moving
            .as_ref()
            .filter(|moving| moving.started)
            .map(|moving| (moving.block.clone(), moving.x))
        else {
            return;
        };
        let gap = self.gap_at(&block, x);
        if let Some(moving) = self.moving.as_mut() {
            moving.gap = gap;
        }
    }

    /// The drag ends with nothing moved (Escape, a release never seen, a
    /// host's move or new columns).
    pub(super) fn cancel_drag(&mut self, cx: &mut Context<Self>) {
        if self.moving.take().is_some_and(|moving| moving.started) {
            cx.notify();
        }
    }

    /// Escape: cancels a drag, the key going no further; with no drag it
    /// goes on (to `select`'s Escape, or the host's).
    pub(crate) fn cancel_move(&mut self, _: &CancelMove, _: &mut Window, cx: &mut Context<Self>) {
        if self.is_moving() {
            self.cancel_drag(cx);
        } else {
            // A press that hasn't dragged: its release selects nothing, so
            // a selection Escape clears stays cleared.
            self.moving = None;
            cx.propagate();
        }
    }

    // --- the drawing ---

    /// Whether the header at `place` is lifted by a drag: its text dimmed.
    pub(super) fn lifted(&self, place: usize) -> bool {
        self.moving
            .as_ref()
            .is_some_and(|moving| moving.started && moving.block.contains(&place))
    }

    /// The block's header cells over the header, following the pointer:
    /// at 0.9 opacity in `table_head`, edged in `border`.
    pub(super) fn render_preview(&self, cx: &App) -> Option<Div> {
        let moving = self.moving.as_ref().filter(|moving| moving.started)?;
        let theme = cx.theme();
        let sizes = self.sizes();
        let columns = self.columns.get(moving.block.clone())?;
        let first = columns.first()?.x;
        let width: f32 = columns.iter().map(|column| column.width).sum();
        let left = moving.x - moving.grab - f32::from(self.body.origin.x);
        #[cfg(test)]
        {
            self.move_drawn.borrow_mut().preview = Some((left, width));
        }
        let cells = columns.iter().map(|column| {
            padded(
                div()
                    .absolute()
                    .top_0()
                    .h_full()
                    .left(px(column.x - first))
                    .w(px(column.width)),
                sizes,
            )
            .line_height(sizes.row())
            .when(column.kind.numeric(), |cell| cell.text_right())
            .truncate()
            .child(column.name.clone())
        });
        Some(
            div()
                .absolute()
                .top_0()
                .h_full()
                .left(px(left))
                .w(px(width))
                .opacity(0.9)
                .bg(theme.tokens.table_head)
                .text_color(theme.table_head_foreground)
                .border_1()
                .border_color(theme.border)
                .overflow_hidden()
                .children(cells),
        )
    }

    /// The 2 px line at the gap, in `drag_border`: the header's (`header`)
    /// or the body's, above the scrollbar.
    pub(super) fn render_gap_line(&self, header: bool, cx: &App) -> Option<Div> {
        let gap = self.moving.as_ref().filter(|moving| moving.started)?.gap?;
        #[cfg(test)]
        {
            self.move_drawn.borrow_mut().lines[usize::from(!header)] =
                Some(self.gutter_width() + gap.line);
        }
        let line = div()
            .absolute()
            .top_0()
            .left(px(self.gutter_width() + gap.line))
            .w(px(LINE))
            .bg(cx.theme().drag_border);
        Some(if header {
            line.h_full()
        } else {
            line.bottom(gpui_kit::component::scroll::Scrollbar::width())
        })
    }
}
