//! `select`: one range of rows, columns, or cells, from an anchor (the
//! active cell) to a head. A press on a cell, the gutter, a header, or the
//! corner starts it, Shift+press and a drag move its head, and the keys
//! (actions of their own, in a context the element adds only while a kind
//! is on) move either. The drag is the table's own, followed by the move,
//! release, and wheel handlers the body's `canvas` registers every frame;
//! no auto-scroll past an edge. Drawn as one tint under the text, over
//! `custom-cells`' quads (`docs/DECISIONS.md`, "Features").

use gpui_kit::component::ActiveTheme as _;
use gpui_kit::*;

use super::{TallTableEvent, TallTableState, row_height};
use crate::delegate::TallTableDelegate;
use crate::selection::{Cell, Kind, Selectable, TallTableSelection};

actions!(
    seiza_tall_table,
    [
        SelectUp,
        SelectDown,
        SelectLeft,
        SelectRight,
        ExtendUp,
        ExtendDown,
        ExtendLeft,
        ExtendRight,
        SelectPageUp,
        SelectPageDown,
        ExtendPageUp,
        ExtendPageDown,
        SelectFirst,
        SelectLast,
        ExtendFirst,
        ExtendLast,
        SelectAll,
        ClearSelection
    ]
);

/// The keys' context, added beside the base's only while a kind is on.
/// Bound after the base's, so at the same depth its bindings win; space
/// and Shift+Space aren't bound here, so they keep the base's paging.
pub(super) const SELECT_CONTEXT: &str = "TallTableSelect";

/// The element's key context while a kind is on.
const CONTEXTS: &str = "TallTable TallTableSelect";

/// Binds the selection's keys. Called by [`crate::init`], after the base's.
pub(crate) fn init(cx: &mut App) {
    let context = Some(SELECT_CONTEXT);
    cx.bind_keys([
        KeyBinding::new("up", SelectUp, context),
        KeyBinding::new("down", SelectDown, context),
        KeyBinding::new("left", SelectLeft, context),
        KeyBinding::new("right", SelectRight, context),
        KeyBinding::new("shift-up", ExtendUp, context),
        KeyBinding::new("shift-down", ExtendDown, context),
        KeyBinding::new("shift-left", ExtendLeft, context),
        KeyBinding::new("shift-right", ExtendRight, context),
        KeyBinding::new("pageup", SelectPageUp, context),
        KeyBinding::new("pagedown", SelectPageDown, context),
        KeyBinding::new("shift-pageup", ExtendPageUp, context),
        KeyBinding::new("shift-pagedown", ExtendPageDown, context),
        KeyBinding::new("home", SelectFirst, context),
        KeyBinding::new("end", SelectLast, context),
        KeyBinding::new("cmd-up", SelectFirst, context),
        KeyBinding::new("cmd-down", SelectLast, context),
        KeyBinding::new("shift-home", ExtendFirst, context),
        KeyBinding::new("shift-end", ExtendLast, context),
        KeyBinding::new("cmd-shift-up", ExtendFirst, context),
        KeyBinding::new("cmd-shift-down", ExtendLast, context),
        // Both: the table can't tell the platform without the browser.
        KeyBinding::new("cmd-a", SelectAll, context),
        KeyBinding::new("ctrl-a", SelectAll, context),
        KeyBinding::new("escape", ClearSelection, context),
    ]);
}

/// The element's key context: the base's, and the selection's while a kind
/// is on.
pub(crate) fn context<D: TallTableDelegate>(
    state: &Entity<TallTableState<D>>,
    cx: &App,
) -> &'static str {
    if state.read(cx).selection_state.selectable.any() {
        CONTEXTS
    } else {
        super::CONTEXT
    }
}

/// The selection's actions on the element.
pub(crate) fn on_actions<D: TallTableDelegate, E: InteractiveElement>(
    element: E,
    state: &Entity<TallTableState<D>>,
    window: &Window,
) -> E {
    let element = element
        .on_action(window.listener_for(state, TallTableState::select_up))
        .on_action(window.listener_for(state, TallTableState::select_down))
        .on_action(window.listener_for(state, TallTableState::select_left))
        .on_action(window.listener_for(state, TallTableState::select_right))
        .on_action(window.listener_for(state, TallTableState::extend_up))
        .on_action(window.listener_for(state, TallTableState::extend_down))
        .on_action(window.listener_for(state, TallTableState::extend_left))
        .on_action(window.listener_for(state, TallTableState::extend_right))
        .on_action(window.listener_for(state, TallTableState::select_page_up))
        .on_action(window.listener_for(state, TallTableState::select_page_down))
        .on_action(window.listener_for(state, TallTableState::extend_page_up))
        .on_action(window.listener_for(state, TallTableState::extend_page_down))
        .on_action(window.listener_for(state, TallTableState::select_first))
        .on_action(window.listener_for(state, TallTableState::select_last))
        .on_action(window.listener_for(state, TallTableState::extend_first))
        .on_action(window.listener_for(state, TallTableState::extend_last))
        .on_action(window.listener_for(state, TallTableState::select_all))
        .on_action(window.listener_for(state, TallTableState::clear_selection));
    #[cfg(feature = "copy")]
    let element = element.on_action(window.listener_for(state, TallTableState::copy_selection));
    element
}

/// The selection fixture's negative controls (`fixtures/selection.json`),
/// each a way to get selecting wrong that the fixture must catch.
#[cfg(test)]
#[derive(Debug, Clone, Copy, PartialEq, Eq, Default)]
pub(crate) enum Control {
    #[default]
    None,
    /// A key past an end wraps to the other end, as `DataTable`'s do.
    Loop,
    /// A moved head is scrolled to the middle of the view.
    Center,
    /// A plain arrow moves the head, keeping the anchor.
    PlainMovesHead,
    /// Shift+arrow across a range's direction moves its head anyway.
    ExtendAcross,
    /// `set_rows` leaves a range past the new end as it was.
    KeepPastRows,
}

/// The table's selection, with the feature.
#[derive(Debug, Default)]
pub(super) struct SelectState {
    pub(super) current: Option<TallTableSelection>,
    pub(super) selectable: Selectable,
    /// A drag selecting, from its press to its release.
    pub(super) selecting: Option<Selecting>,
    /// The last jump selected its row or cell: its mark isn't drawn.
    pub(super) jump_selected: bool,
    /// The table had focus at the last render: the active cell is edged.
    pub(super) focused: bool,
    /// What the last frame drew of the selection, for the tests.
    #[cfg(test)]
    pub(crate) drawn: Drawn,
    #[cfg(test)]
    pub(crate) control: Control,
}

/// What a frame drew of the selection (tests only), in the cells layer's
/// coordinates.
#[cfg(test)]
#[derive(Debug, Clone, Default, PartialEq)]
pub(crate) struct Drawn {
    pub(crate) tint: Option<Bounds<Pixels>>,
    pub(crate) active: Option<Bounds<Pixels>>,
    pub(crate) gutter: Vec<u64>,
    pub(crate) header: Vec<usize>,
}

/// A drag selecting: which of the head's coordinates follow the pointer.
#[derive(Debug, Clone, Copy, PartialEq)]
pub(super) struct Selecting {
    rows: bool,
    columns: bool,
}

/// What a press is on.
#[derive(Debug, Clone, Copy, PartialEq)]
enum Target {
    Cell(Cell),
    /// The row-number gutter: its row, at the first visible column.
    Gutter(Cell),
    /// A header cell: its column, at the top visible row.
    Header(Cell),
    /// The header over the gutter.
    Corner,
}

impl Target {
    /// The cell, and which of its coordinates the press picked.
    fn cell(self) -> Option<(Cell, bool, bool)> {
        match self {
            Target::Cell(cell) => Some((cell, true, true)),
            Target::Gutter(cell) => Some((cell, true, false)),
            Target::Header(cell) => Some((cell, false, true)),
            Target::Corner => None,
        }
    }
}

/// A key's move.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum Step {
    Up,
    Down,
    Left,
    Right,
    PageUp,
    PageDown,
    First,
    Last,
}

impl<D: TallTableDelegate> TallTableState<D> {
    pub fn selection(&self) -> Option<TallTableSelection> {
        self.selection_state.current
    }

    /// Sets or clears it (no scroll), emitting
    /// [`TallTableEvent::Selected`] if it changed; a drag selecting ends.
    /// A cell past the last row or column is moved to it (a source that
    /// shrank, a selection kept across a reload); with no rows or no
    /// columns, it clears. A kind that's off is the host's mistake: the
    /// call does nothing (a debug assertion).
    pub fn select(&mut self, selection: Option<TallTableSelection>, cx: &mut Context<Self>) {
        if let Some(selection) = selection
            && !self.selection_state.selectable.allows(selection.kind())
        {
            debug_assert!(
                false,
                "select: a {:?} selection while that kind is off",
                selection.kind()
            );
            return;
        }
        let clamped = selection.and_then(|selection| self.clamped(selection));
        self.replace_selection(clamped, cx);
    }

    /// `selection` with every cell past the last row or column moved to
    /// it; `None` with no rows or no columns.
    fn clamped(&self, selection: TallTableSelection) -> Option<TallTableSelection> {
        let last_row = self.scroll.rows().checked_sub(1)?;
        let last_column = self.columns.len().checked_sub(1)?;
        let clamp = |(row, column): Cell| (row.min(last_row), column.min(last_column));
        Some(selection.with(clamp(selection.anchor()), clamp(selection.head())))
    }

    pub fn selectable(&self) -> Selectable {
        self.selection_state.selectable
    }

    /// Which kinds are on; turning one off clears a selection of its kind.
    /// With none on, the keys are the base's. With rows and cells off, a
    /// jump selects nothing, so the last jump's mark is drawn again.
    pub fn set_selectable(&mut self, selectable: Selectable, cx: &mut Context<Self>) {
        self.selection_state.selectable = selectable;
        if self
            .selection_state
            .current
            .is_some_and(|selection| !selectable.allows(selection.kind()))
        {
            self.replace_selection(None, cx);
        }
        if !selectable.rows && !selectable.cells {
            self.selection_state.jump_selected = false;
        }
        cx.notify();
    }

    /// Every change but a drag's own: if `selection` is new, a drag
    /// selecting ends (its flags were for the range it started), and the
    /// change is emitted.
    fn replace_selection(&mut self, selection: Option<TallTableSelection>, cx: &mut Context<Self>) {
        if self.selection_state.current != selection {
            self.selection_state.selecting = None;
            self.set_selection(selection, cx);
        }
    }

    /// Emits [`TallTableEvent::Selected`] and redraws if `selection` is
    /// new. Only a drag's moves call it directly; everything else goes
    /// through [`Self::replace_selection`].
    fn set_selection(&mut self, selection: Option<TallTableSelection>, cx: &mut Context<Self>) {
        if self.selection_state.current != selection {
            self.selection_state.current = selection;
            cx.emit(TallTableEvent::Selected(selection));
            cx.notify();
        }
    }

    /// The row a jump landed on is selected (rows on), else its cell (cells
    /// on: the active cell's column, else the first visible), with the
    /// event; its mark isn't drawn then. With only columns on it's marked
    /// as without the feature.
    pub(super) fn jump_select(&mut self, row: u64, cx: &mut Context<Self>) {
        let selectable = self.selection_state.selectable;
        let kind = [Kind::Rows, Kind::Cells]
            .into_iter()
            .find(|kind| selectable.allows(*kind));
        let last = self.scroll.rows().checked_sub(1);
        let (Some(kind), Some(last)) = (kind, last) else {
            self.selection_state.jump_selected = false;
            return;
        };
        let column = match self.selection_state.current {
            Some(selection) => selection.anchor().1,
            None => self.first_visible().map_or(0, |(_, column)| column),
        };
        let cell = (row.min(last), column);
        self.selection_state.jump_selected = true;
        self.replace_selection(Some(TallTableSelection::new(kind, cell, cell)), cx);
    }

    /// The row the last jump marked, unless the jump selected it.
    #[inline(always)]
    pub(super) fn drawn_mark(&self) -> Option<u64> {
        if self.selection_state.jump_selected {
            return None;
        }
        self.marked
    }

    /// The rows shrank to `rows`: a `Rows` or `Cells` range loses the rows
    /// past the end (a corner past it moves to the last row), and one
    /// wholly past it is cleared. A `Columns` range covers every row.
    pub(super) fn cut_selection(&mut self, rows: u64, cx: &mut Context<Self>) {
        #[cfg(test)]
        if self.selection_state.control == Control::KeepPastRows {
            return;
        }
        let Some(selection) = self.selection_state.current else {
            return;
        };
        if selection.kind() == Kind::Columns {
            return;
        }
        let (anchor, head) = (selection.anchor(), selection.head());
        let cut = match rows.checked_sub(1) {
            Some(last) if anchor.0.min(head.0) <= last => {
                Some(selection.with((anchor.0.min(last), anchor.1), (head.0.min(last), head.1)))
            }
            _ => None,
        };
        self.replace_selection(cut, cx);
    }

    /// A sort moved every row (`sort`): a `Rows` or `Cells` selection goes
    /// (kept as positions, it would be other rows); a `Columns` one stays,
    /// its anchor's and head's rows at the top, so the keys go on from the
    /// view.
    #[cfg(feature = "sort")]
    pub(super) fn sort_selection(&mut self, cx: &mut Context<Self>) {
        let kept = self
            .selection_state
            .current
            .filter(|selection| selection.kind() == Kind::Columns)
            .map(|selection| selection.with((0, selection.anchor().1), (0, selection.head().1)));
        self.selection_state.jump_selected = false;
        self.replace_selection(kept, cx);
    }

    /// The columns were replaced: the selection goes, a drag with it.
    pub(super) fn clear_selection_for_columns(&mut self, cx: &mut Context<Self>) {
        self.replace_selection(None, cx);
    }

    /// Whether a drag is selecting: no tooltip meanwhile.
    pub(super) fn is_selecting(&self) -> bool {
        self.selection_state.selecting.is_some()
    }

    // --- the pointer ---

    /// The cell nearest `position` (window pixels): the pointer's clamped
    /// to the visible cells, and past the last column to the last.
    fn cell_clamped(&self, position: Point<Pixels>) -> Option<Cell> {
        let last_row = self.scroll.rows().checked_sub(1)?;
        let last_column = self.columns.len().checked_sub(1)?;
        let x = f32::from(position.x - self.body.origin.x) - self.gutter_width();
        let y = f32::from(position.y - self.body.origin.y);
        // A hair inside the far edges, so the clamp lands on a cell there.
        let x = x.clamp(0.0, (self.cells_width() - 0.5).max(0.0)) + self.scroll_x;
        let y = y.clamp(0.0, (f32::from(self.viewport().height) - 0.5).max(0.0));
        let row = (self.scroll.top() + f64::from(y / f32::from(row_height()))).floor() as u64;
        let column = self
            .columns
            .iter()
            .position(|column| x < column.x + column.width)
            .unwrap_or(last_column);
        Some((row.min(last_row), column))
    }

    /// The first visible cell: the top row, the leftmost column.
    fn first_visible(&self) -> Option<Cell> {
        self.cell_clamped(self.body.origin + point(px(self.gutter_width()), px(0.)))
    }

    /// What a press at `position` is on, if it's on the table's cells, its
    /// gutter, or its header (the header is the row above the body). Past
    /// the last row or column, nothing.
    fn target_at(&self, position: Point<Pixels>) -> Option<Target> {
        let x = f32::from(position.x - self.body.origin.x) - self.gutter_width();
        let y = f32::from(position.y - self.body.origin.y);
        if x >= 0.0 {
            if y >= 0.0 {
                // The hover's hit test.
                return self.cell_at(position).map(Target::Cell);
            }
            let past = !self
                .columns
                .last()
                .is_some_and(|column| x + self.scroll_x < column.x + column.width);
            if y < -f32::from(row_height()) || x >= self.cells_width() || past {
                return None;
            }
            return self.cell_clamped(position).map(Target::Header);
        }
        if y < 0.0 {
            return (y >= -f32::from(row_height())).then_some(Target::Corner);
        }
        let row = (self.scroll.top() + f64::from(y / f32::from(row_height()))).floor();
        if y >= f32::from(self.viewport().height) || row as u64 >= self.scroll.rows() {
            return None;
        }
        self.cell_clamped(position).map(Target::Gutter)
    }

    /// A left press anywhere on the table (the bands and scrollbars stop
    /// theirs first). Cmd+press is a plain press; Ctrl+press (a Mac
    /// browser's right-click) and a double-click's second press select
    /// nothing.
    pub(super) fn press_select(&mut self, event: &MouseDownEvent, cx: &mut Context<Self>) {
        if event.modifiers.control || event.click_count >= 2 {
            return;
        }
        let Some(target) = self.target_at(event.position) else {
            return;
        };
        let Some((cell, rows, columns)) = target.cell() else {
            self.select_everything(cx);
            return;
        };
        let selectable = self.selection_state.selectable;
        // Shift: the head moves to the press, along what the press picked
        // and the range spans.
        if event.modifiers.shift
            && let Some(selection) = self.selection_state.current
        {
            let kind = selection.kind();
            let selecting = Selecting {
                rows: rows && kind.spans_rows(),
                columns: columns && kind.spans_columns(),
            };
            if selecting.rows || selecting.columns {
                self.start_selecting(selecting, cx);
                self.drag_head_to(cell, cx);
            }
            return;
        }
        let kind = match target {
            Target::Cell(_) => selectable.smallest(false),
            Target::Gutter(_) => selectable.rows.then_some(Kind::Rows),
            Target::Header(_) => selectable.columns.then_some(Kind::Columns),
            Target::Corner => None,
        };
        let Some(kind) = kind else {
            return;
        };
        self.replace_selection(Some(TallTableSelection::new(kind, cell, cell)), cx);
        self.start_selecting(
            Selecting {
                rows: rows && kind.spans_rows(),
                columns: columns && kind.spans_columns(),
            },
            cx,
        );
    }

    /// A drag starts: no hover, and so no tooltip, until its release.
    fn start_selecting(&mut self, selecting: Selecting, cx: &mut Context<Self>) {
        self.hide_tooltip(cx);
        self.selection_state.selecting = Some(selecting);
    }

    /// The head's coordinates that the drag follows move to `cell`'s.
    fn drag_head_to(&mut self, cell: Cell, cx: &mut Context<Self>) {
        let (Some(selecting), Some(selection)) =
            (self.selection_state.selecting, self.selection_state.current)
        else {
            return;
        };
        let head = selection.head();
        let head = (
            if selecting.rows { cell.0 } else { head.0 },
            if selecting.columns { cell.1 } else { head.1 },
        );
        self.set_selection(Some(selection.with(selection.anchor(), head)), cx);
    }

    /// The pointer moved during a drag: the head follows the cell under it,
    /// clamped to the visible cells. A redraw only if the selection changed.
    pub(super) fn select_drag_to(&mut self, position: Point<Pixels>, cx: &mut Context<Self>) {
        if let Some(cell) = self.cell_clamped(position) {
            self.drag_head_to(cell, cx);
        }
    }

    pub(super) fn end_select(&mut self) {
        self.selection_state.selecting = None;
    }

    /// A wheel anywhere in the window during a drag: the body scrolls as
    /// the base's wheel scrolls it, and the head follows the cell now under
    /// the pointer.
    pub(super) fn select_wheel(&mut self, event: &ScrollWheelEvent, cx: &mut Context<Self>) {
        self.on_scroll_wheel(event, cx);
        self.select_drag_to(event.position, cx);
    }

    // --- the keys ---

    /// Cmd+A, Ctrl+A, and the corner: every column, else every row, else
    /// every cell.
    fn select_everything(&mut self, cx: &mut Context<Self>) {
        let selectable = self.selection_state.selectable;
        let rows = self.scroll.rows();
        let (Some(first), Some(last_column)) =
            (self.first_visible(), self.columns.len().checked_sub(1))
        else {
            return;
        };
        let last_row = rows - 1;
        let selection = if selectable.columns {
            TallTableSelection::Columns {
                anchor: (first.0, 0),
                head: (first.0, last_column),
            }
        } else if selectable.rows {
            TallTableSelection::Rows {
                anchor: (0, first.1),
                head: (last_row, first.1),
            }
        } else if selectable.cells {
            TallTableSelection::Cells {
                anchor: (0, 0),
                head: (last_row, last_column),
            }
        } else {
            return;
        };
        self.replace_selection(Some(selection), cx);
    }

    /// The rows a page key moves by: the base's page.
    fn page_step(&self) -> u64 {
        (self.page_rows().floor() as u64).max(1)
    }

    /// A key's move: the active cell (`extend` off: collapsing to the
    /// smallest kind that holds it) or the head (`extend`: along the
    /// range's direction only), stopping at the ends, then scrolled into
    /// view. With nothing selected, an arrow selects the first visible cell
    /// without moving, and the rest scroll as the base's.
    fn key_step(&mut self, step: Step, extend: bool, cx: &mut Context<Self>) {
        let Some(selection) = self.selection_state.current else {
            match step {
                Step::PageUp => self.scroll_by(-self.page_rows(), 0.0, cx),
                Step::PageDown => self.scroll_by(self.page_rows(), 0.0, cx),
                Step::First => self.scroll_to_fraction(0.0, cx),
                Step::Last => self.scroll_to_fraction(1.0, cx),
                _ => {
                    let kind = self.selection_state.selectable.smallest(true);
                    if let (Some(kind), Some(cell)) = (kind, self.first_visible()) {
                        self.replace_selection(Some(TallTableSelection::new(kind, cell, cell)), cx);
                    }
                }
            }
            return;
        };
        let (Some(last_row), Some(last_column)) = (
            self.scroll.rows().checked_sub(1),
            self.columns.len().checked_sub(1),
        ) else {
            return;
        };
        let kind = selection.kind();
        let vertical = !matches!(step, Step::Left | Step::Right);
        #[cfg(test)]
        let across = self.selection_state.control == Control::ExtendAcross;
        #[cfg(not(test))]
        let across = false;
        if extend
            && !across
            && !(if vertical {
                kind.spans_rows()
            } else {
                kind.spans_columns()
            })
        {
            return;
        }
        #[cfg(test)]
        let moves_head = extend || self.selection_state.control == Control::PlainMovesHead;
        #[cfg(not(test))]
        let moves_head = extend;
        let from = if moves_head {
            selection.head()
        } else {
            selection.anchor()
        };
        let from = (from.0.min(last_row), from.1.min(last_column));
        let page = self.page_step();
        #[cfg(test)]
        let wraps = self.selection_state.control == Control::Loop;
        #[cfg(not(test))]
        let wraps = false;
        let to = match step {
            Step::Up if wraps && from.0 == 0 => (last_row, from.1),
            Step::Down if wraps && from.0 == last_row => (0, from.1),
            Step::Up => (from.0.saturating_sub(1), from.1),
            Step::Down => ((from.0 + 1).min(last_row), from.1),
            Step::Left => (from.0, from.1.saturating_sub(1)),
            Step::Right => (from.0, (from.1 + 1).min(last_column)),
            Step::PageUp => (from.0.saturating_sub(page), from.1),
            Step::PageDown => ((from.0 + page).min(last_row), from.1),
            Step::First => (0, from.1),
            Step::Last => (last_row, from.1),
        };
        if to == from {
            return;
        }
        let selection = if moves_head {
            selection.with(selection.anchor(), to)
        } else {
            match self.selection_state.selectable.smallest(true) {
                Some(kind) => TallTableSelection::new(kind, to, to),
                None => return,
            }
        };
        self.replace_selection(Some(selection), cx);
        match step {
            Step::PageUp => self.scroll_by(-self.page_rows(), 0.0, cx),
            Step::PageDown => self.scroll_by(self.page_rows(), 0.0, cx),
            _ => {}
        }
        // Along what moved: an extended range's head is scrolled to only
        // along the range's direction, where its other coordinate is stale.
        let (rows, columns) = if moves_head {
            (kind.spans_rows(), kind.spans_columns())
        } else {
            (true, true)
        };
        self.scroll_into_view(to, rows, columns, cx);
    }

    /// Scrolls `cell` into view the least distance, down or up (`rows`) and
    /// sideways (`columns`), through the base's scroll paths (so `follow`
    /// sees a move down as the reader's).
    fn scroll_into_view(&mut self, cell: Cell, rows: bool, columns: bool, cx: &mut Context<Self>) {
        let (top, view_rows) = (self.scroll.top(), self.scroll.viewport_rows());
        let row = cell.0 as f64;
        #[cfg(test)]
        let center = self.selection_state.control == Control::Center;
        #[cfg(not(test))]
        let center = false;
        let to = if center {
            row + 0.5 - view_rows / 2.0
        } else if row < top {
            row
        } else if row + 1.0 > top + view_rows {
            row + 1.0 - view_rows
        } else {
            top
        };
        if rows && to != top {
            self.scroll_by(to - top, 0.0, cx);
        }
        let Some(column) = self.columns.get(cell.1).filter(|_| columns) else {
            return;
        };
        let (left, right) = (column.x, column.x + column.width);
        let (view_left, view_right) = (self.scroll_x, self.scroll_x + self.cells_width());
        let x = if left < view_left {
            left - view_left
        } else if right > view_right {
            (right - view_right).min(left - view_left)
        } else {
            0.0
        };
        if x != 0.0 {
            self.scroll_by(0.0, x, cx);
        }
    }

    pub(crate) fn select_up(&mut self, _: &SelectUp, _: &mut Window, cx: &mut Context<Self>) {
        self.key_step(Step::Up, false, cx);
    }

    pub(crate) fn select_down(&mut self, _: &SelectDown, _: &mut Window, cx: &mut Context<Self>) {
        self.key_step(Step::Down, false, cx);
    }

    pub(crate) fn select_left(&mut self, _: &SelectLeft, _: &mut Window, cx: &mut Context<Self>) {
        self.key_step(Step::Left, false, cx);
    }

    pub(crate) fn select_right(&mut self, _: &SelectRight, _: &mut Window, cx: &mut Context<Self>) {
        self.key_step(Step::Right, false, cx);
    }

    pub(crate) fn extend_up(&mut self, _: &ExtendUp, _: &mut Window, cx: &mut Context<Self>) {
        self.key_step(Step::Up, true, cx);
    }

    pub(crate) fn extend_down(&mut self, _: &ExtendDown, _: &mut Window, cx: &mut Context<Self>) {
        self.key_step(Step::Down, true, cx);
    }

    pub(crate) fn extend_left(&mut self, _: &ExtendLeft, _: &mut Window, cx: &mut Context<Self>) {
        self.key_step(Step::Left, true, cx);
    }

    pub(crate) fn extend_right(&mut self, _: &ExtendRight, _: &mut Window, cx: &mut Context<Self>) {
        self.key_step(Step::Right, true, cx);
    }

    pub(crate) fn select_page_up(
        &mut self,
        _: &SelectPageUp,
        _: &mut Window,
        cx: &mut Context<Self>,
    ) {
        self.key_step(Step::PageUp, false, cx);
    }

    pub(crate) fn select_page_down(
        &mut self,
        _: &SelectPageDown,
        _: &mut Window,
        cx: &mut Context<Self>,
    ) {
        self.key_step(Step::PageDown, false, cx);
    }

    pub(crate) fn extend_page_up(
        &mut self,
        _: &ExtendPageUp,
        _: &mut Window,
        cx: &mut Context<Self>,
    ) {
        self.key_step(Step::PageUp, true, cx);
    }

    pub(crate) fn extend_page_down(
        &mut self,
        _: &ExtendPageDown,
        _: &mut Window,
        cx: &mut Context<Self>,
    ) {
        self.key_step(Step::PageDown, true, cx);
    }

    pub(crate) fn select_first(&mut self, _: &SelectFirst, _: &mut Window, cx: &mut Context<Self>) {
        self.key_step(Step::First, false, cx);
    }

    pub(crate) fn select_last(&mut self, _: &SelectLast, _: &mut Window, cx: &mut Context<Self>) {
        self.key_step(Step::Last, false, cx);
    }

    pub(crate) fn extend_first(&mut self, _: &ExtendFirst, _: &mut Window, cx: &mut Context<Self>) {
        self.key_step(Step::First, true, cx);
    }

    pub(crate) fn extend_last(&mut self, _: &ExtendLast, _: &mut Window, cx: &mut Context<Self>) {
        self.key_step(Step::Last, true, cx);
    }

    pub(crate) fn select_all(&mut self, _: &SelectAll, _: &mut Window, cx: &mut Context<Self>) {
        self.select_everything(cx);
    }

    /// Escape: clears, or with nothing selected goes on to the host. With
    /// `copy`, a copy running is cancelled first, the selection kept.
    pub(crate) fn clear_selection(
        &mut self,
        _: &ClearSelection,
        _: &mut Window,
        cx: &mut Context<Self>,
    ) {
        #[cfg(feature = "copy")]
        if self.escape_copy(cx) {
            return;
        }
        if self.selection_state.current.is_none() {
            cx.propagate();
            return;
        }
        self.replace_selection(None, cx);
    }

    // --- the drawing ---

    /// The selected rows and columns, for the gutter's and the header's
    /// cells.
    pub(super) fn selected_lines(
        &self,
    ) -> (
        Option<std::ops::RangeInclusive<u64>>,
        Option<std::ops::RangeInclusive<usize>>,
    ) {
        match self.selection_state.current {
            Some(selection) => (
                selection.rows(self.scroll.rows()),
                selection.columns(self.columns.len()),
            ),
            None => (None, None),
        }
    }

    /// The selection's tint and the active cell's edge, in the cells
    /// layer's coordinates: one canvas, after `custom-cells`' quads and
    /// before the text. The tint is the range's visible part, its edges
    /// past the view's where the range goes on; the edge only while the
    /// table has focus.
    pub(super) fn render_selection(&mut self, cx: &App) -> Option<impl IntoElement + use<D>> {
        let selection = self.selection_state.current;
        #[cfg(test)]
        {
            self.selection_state.drawn.tint = None;
            self.selection_state.drawn.active = None;
        }
        let selection = selection?;
        let theme = cx.theme();
        let row_h = f32::from(row_height());
        let visible = self.scroll.visible();
        let (view_w, view_h) = (self.cells_width(), f32::from(self.viewport().height));
        let row_y = |row: u64| (self.scroll.offset_of(row) * f64::from(row_h)) as f32;
        let mut quads = Vec::with_capacity(2);
        let rows = selection.rows(self.scroll.rows());
        let columns = selection.columns(self.columns.len());
        if let (Some(rows), Some(columns)) = (rows, columns)
            && !visible.is_empty()
            && *rows.start() < visible.end
            && *rows.end() >= visible.start
        {
            let top = if *rows.start() < visible.start {
                -1.0
            } else {
                row_y(*rows.start())
            };
            // Past the view's bottom only where rows go on below it.
            let bottom = if *rows.end() + 1 >= visible.end && visible.end < self.scroll.rows() {
                view_h + 1.0
            } else {
                row_y(*rows.end() + 1)
            };
            let (first, last) = (
                &self.columns[*columns.start()],
                &self.columns[*columns.end()],
            );
            let left = (first.x - self.scroll_x).max(-1.0);
            let right = (last.x + last.width - self.scroll_x).min(view_w + 1.0);
            if left < right {
                let bounds = Bounds::new(
                    point(px(left), px(top)),
                    size(px(right - left), px(bottom - top)),
                );
                #[cfg(test)]
                {
                    self.selection_state.drawn.tint = Some(bounds);
                }
                quads.push(
                    fill(bounds, theme.table_active)
                        .border_widths(px(1.))
                        .border_color(theme.table_active_border),
                );
            }
        }
        let (row, column) = selection.anchor();
        if self.selection_state.focused
            && visible.contains(&row)
            && let Some(column) = self.columns.get(column)
        {
            let bounds = Bounds::new(
                point(px(column.x - self.scroll_x), px(row_y(row))),
                size(px(column.width), px(row_h)),
            );
            #[cfg(test)]
            {
                self.selection_state.drawn.active = Some(bounds);
            }
            quads.push(
                fill(bounds, transparent_black())
                    .border_widths(px(2.))
                    .border_color(theme.table_active_border),
            );
        }
        (!quads.is_empty()).then(|| {
            canvas(
                |_, _, _| {},
                move |bounds, _, window, _| {
                    for mut quad in quads {
                        quad.bounds.origin += bounds.origin;
                        window.paint_quad(quad);
                    }
                },
            )
            .absolute()
            .size_full()
        })
    }
}
