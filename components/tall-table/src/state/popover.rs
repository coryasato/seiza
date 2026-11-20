//! `popover`: one popover over the table, on one cell, held by row and
//! column index, showing the cell's exact text in gpui-base's
//! `SelectableText`, with the host's button at its foot; and the cue, drawn
//! on the hovered and the active cell, whose press opens it. Its state is
//! the table's, not gpui-kit's `Popover`'s: the table's cells are painted,
//! and what closes it follows the table's rules. It's placed each frame
//! from its cell's bounds by gpui-base's `Positioner`, below the cell at its
//! left, flipped above at the window's bottom, in a `deferred` at
//! `POPUP_PRIORITY`, and never takes focus, so Enter and Escape stay the
//! table's (`docs/DECISIONS.md`, "Features", 2026-11-19, `popover`).
//!
//! What's checked each frame (`prepare_popover`): its cell still in view
//! (its row visible, its column shown and not behind `pin`'s run), else it
//! closes; its text decided again after a page landed on its row
//! (`undecide_popover`, the tooltip's sites); `find`'s tints for the term
//! in effect; and the cues, each decided once for its cell by the
//! tooltip's rule.

use std::cell::RefCell;
use std::ops::Range;
use std::rc::Rc;

use gpui_kit::base::{Align, POPUP_PRIORITY, Placement, Positioner, SelectableText};
use gpui_kit::component::button::{Button, ButtonVariants as _};
use gpui_kit::component::{ActiveTheme as _, Sizable as _};
use gpui_kit::prelude::FluentBuilder as _;
use gpui_kit::*;

use super::{CONTEXT, TallTableEvent, TallTableState, click_stops};
use crate::delegate::{TallTableDelegate, TallTablePage as _};
use crate::pages::RowState;
use crate::popover::{
    ButtonLook, CUE_GAP, CUE_INSET, CueInCell, CueLook, CueMark, MARGIN, POPOVER_CHARS,
    PopoverButton, PopoverCell, PopoverCue, PopoverText, cue_mark, max_height, max_width,
    popover_text,
};
use crate::probe::{CueProbe, PopoverProbe};

actions!(seiza_tall_table, [PopoverEnter, PopoverEscape, PopoverCopy]);

/// Binds Enter, Escape, and Cmd+C and Ctrl+C. Called by [`crate::init`]
/// last, so its Escape is seen before `select`'s `ClearSelection` and
/// `reorder`'s `CancelMove`, and its copy before `copy`'s; each propagates
/// when it has nothing to do. The copy is the table's, not gpui-kit's
/// `Root`'s, which a wasm build binds to Ctrl+C alone (its Cmd+C is
/// `cfg(target_os = "macos")`).
pub(crate) fn init(cx: &mut App) {
    cx.bind_keys([
        KeyBinding::new("enter", PopoverEnter, Some(CONTEXT)),
        KeyBinding::new("escape", PopoverEscape, Some(CONTEXT)),
        KeyBinding::new("cmd-c", PopoverCopy, Some(CONTEXT)),
        KeyBinding::new("ctrl-c", PopoverCopy, Some(CONTEXT)),
    ]);
}

/// The random test's negative controls (tests only).
#[cfg(test)]
#[derive(Debug, Clone, Copy, PartialEq, Eq, Default)]
pub(crate) enum Control {
    #[default]
    None,
    /// A sort's reset leaves the popover open, its old text drawn.
    KeepPopoverOnSort,
    /// A page landing on its row doesn't decide its text again.
    StalePopoverText,
}

/// A cue drawn: its cell and its box, in window pixels.
type DrawnCue = (PopoverCell, Bounds<Pixels>);

/// The popover open, the host's button and cue, and the cues decided
/// (`popover`).
pub(super) struct PopoverState<D: TallTableDelegate> {
    pub(super) open: Option<Open>,
    button: Option<PopoverButton>,
    pub(super) cue: Option<PopoverCue>,
    /// Each cue cell's decision, by row and place: whether it shows. Kept
    /// only for the cells a frame would cue (the hovered and the active).
    decided: Vec<((u64, usize), bool)>,
    /// The cues this frame draws, in window pixels: a press on one is the
    /// cue's, not a press outside.
    cues: Rc<RefCell<Vec<DrawnCue>>>,
    /// Where the last frame placed the popover.
    placed: Rc<RefCell<Placed>>,
    /// The table, for `close`'s event, which `close` can't emit.
    this: WeakEntity<TallTableState<D>>,
    #[cfg(test)]
    pub(crate) control: Control,
}

/// The popover open on a cell.
pub(super) struct Open {
    pub(super) cell: PopoverCell,
    pub(super) text: PopoverText,
    /// Its text is the last landed page's: false once a page lands on its
    /// row, until the next frame decides the text again.
    pub(super) decided: bool,
    /// `find`'s ranges in its text, and the term (folded) they're for.
    pub(super) tints: Vec<Range<usize>>,
    #[cfg(feature = "find")]
    tinted_for: Option<Rc<str>>,
    /// Its text's scroll, kept while it's open.
    scroll: ScrollHandle,
    /// Its text's part in the window's text selection: its own, so a
    /// selection made in another popover's text (the element's id is the
    /// same) or in the host's isn't this one's to copy.
    selection: gpui_kit::base::TextSelectionHandle,
    /// Redraws it as a drag selects (`SelectableText` keeps one for a
    /// handle of its own); made at its first frame, which has the window.
    _selecting: Option<Subscription>,
}

/// What the last frame drew of the popover, in window pixels.
#[derive(Debug, Default, Clone, PartialEq)]
pub(super) struct Placed {
    pub(super) bounds: Option<Bounds<Pixels>>,
    pub(super) below: bool,
    pub(super) button: Option<Bounds<Pixels>>,
}

impl<D: TallTableDelegate> PopoverState<D> {
    pub(super) fn new(this: WeakEntity<TallTableState<D>>) -> Self {
        Self {
            open: None,
            button: None,
            cue: Some(PopoverCue::default()),
            decided: Vec::new(),
            cues: Default::default(),
            placed: Default::default(),
            this,
            #[cfg(test)]
            control: Control::None,
        }
    }
}

fn corners(bounds: Bounds<Pixels>) -> [f32; 4] {
    [
        f32::from(bounds.origin.x),
        f32::from(bounds.origin.y),
        f32::from(bounds.size.width),
        f32::from(bounds.size.height),
    ]
}

impl<D: TallTableDelegate> TallTableState<D> {
    /// Opens the popover on `cell` (`popover`), closing any other: its
    /// exact text, wrapped, below the cell. Refused (false) unless the cell
    /// is in view (its row visible, its column shown and not behind `pin`'s
    /// run), its page loaded, and the table open. Lets go of `follow`.
    /// `TallTableEvent::Popover` with the cell, unless it was open there.
    pub fn open_popover(&mut self, cell: PopoverCell, cx: &mut Context<Self>) -> bool {
        if self.closed {
            return false;
        }
        let Some(place) = self.place_of(cell.column) else {
            return false;
        };
        if self.popover_cell_bounds(cell.row, place).is_none() {
            return false;
        }
        // Open there already, its page loading again or not.
        if self.popover().is_some_and(|open| open == cell) {
            return true;
        }
        let Some(text) = self.popover_value(cell) else {
            return false;
        };
        // The cell stays put (`follow`).
        #[cfg(feature = "follow")]
        self.let_go(cx);
        let selection = gpui_kit::base::TextSelectionHandle::new(text.text.to_string(), cx);
        self.popover_state.open = Some(Open {
            cell,
            text,
            decided: true,
            tints: Vec::new(),
            #[cfg(feature = "find")]
            tinted_for: None,
            scroll: ScrollHandle::new(),
            selection,
            _selecting: None,
        });
        *self.popover_state.placed.borrow_mut() = Placed::default();
        cx.emit(TallTableEvent::Popover(Some(cell)));
        cx.notify();
        true
    }

    /// Closes the popover, if one is open: `TallTableEvent::Popover(None)`.
    pub fn close_popover(&mut self, cx: &mut Context<Self>) {
        if self.popover_state.open.take().is_some() {
            *self.popover_state.placed.borrow_mut() = Placed::default();
            cx.emit(TallTableEvent::Popover(None));
            cx.notify();
        }
    }

    /// The cell the popover is open on.
    pub fn popover(&self) -> Option<PopoverCell> {
        self.popover_state.open.as_ref().map(|open| open.cell)
    }

    /// The button at the popover's foot: the table's look with the host's
    /// label ([`PopoverButton::label`]), or the host's element
    /// ([`PopoverButton::custom`]); `None` (the default): no button. Its
    /// press, or Enter on the open popover, emits
    /// `TallTableEvent::PopoverButton` and closes it. With one set, the cue
    /// shows on every loaded cell, so each reaches the host's view.
    pub fn set_popover_button(&mut self, button: Option<PopoverButton>, cx: &mut Context<Self>) {
        self.popover_state.button = button;
        // Its place is recorded again when it draws, if it does.
        self.popover_state.placed.borrow_mut().button = None;
        self.popover_state.decided.clear();
        cx.notify();
    }

    /// The popover's button, if set.
    pub fn popover_button(&self) -> Option<&PopoverButton> {
        self.popover_state.button.as_ref()
    }

    /// The cue drawn at the right end of the hovered cell and of `select`'s
    /// active cell when the popover shows more than the cell (a float
    /// rounded, a text cut or with line breaks) or a button is set: the
    /// table's look ([`PopoverCue::expand`], the default, or
    /// [`PopoverCue::icon`]) or the host's element ([`PopoverCue::custom`]);
    /// `None` draws none (Enter and `open_popover` still open it).
    pub fn set_popover_cue(&mut self, cue: Option<PopoverCue>, cx: &mut Context<Self>) {
        self.popover_state.cue = cue;
        self.popover_state.decided.clear();
        cx.notify();
    }

    /// The cue, if drawn.
    pub fn popover_cue(&self) -> Option<&PopoverCue> {
        self.popover_state.cue.as_ref()
    }

    /// `cell`'s text for the popover, if its page is loaded.
    fn popover_value(&self, cell: PopoverCell) -> Option<PopoverText> {
        let RowState::Loaded(page, index) = self.cache.row(cell.row) else {
            return None;
        };
        let value = page.value(index, cell.column)?;
        Some(popover_text(&value, POPOVER_CHARS))
    }

    /// The cell at `row` and `place`'s visible part, in window pixels: none
    /// unless its row is visible, its column shown, and some of it in the
    /// cells area (with `pin`, right of the run unless pinned).
    pub(super) fn popover_cell_bounds(&self, row: u64, place: usize) -> Option<Bounds<Pixels>> {
        let column = self.columns.get(place)?;
        if column.width <= 0.0 || !self.scroll.visible().contains(&row) {
            return None;
        }
        let placing = self.place();
        let left = placing.left(place, column.x, self.scroll_x);
        #[cfg(feature = "pin")]
        let edge = if placing.holds(place) {
            0.0
        } else {
            placing.edge
        };
        #[cfg(not(feature = "pin"))]
        let edge = placing.edge();
        let (start, end) = (
            left.max(edge),
            (left + column.width).min(self.cells_width()),
        );
        if end <= start {
            return None;
        }
        let row_h = self.sizes().row();
        let origin = point(
            self.body.origin.x + px(self.gutter_width() + start),
            self.body.origin.y
                + px((self.scroll.offset_of(row) * f64::from(f32::from(row_h))) as f32),
        );
        Some(Bounds::new(origin, size(px(end - start), row_h)))
    }

    /// A page landed over `rows` (`undecide_tooltip`'s sites): the open
    /// popover's text there is decided again at the next frame, its scroll
    /// kept, and a cue there too.
    pub(super) fn undecide_popover(&mut self, rows: &Range<u64>) {
        #[cfg(test)]
        let stale = self.popover_state.control == Control::StalePopoverText;
        #[cfg(not(test))]
        let stale = false;
        if let Some(open) = self.popover_state.open.as_mut()
            && rows.contains(&open.cell.row)
            && !stale
        {
            open.decided = false;
        }
        self.popover_state
            .decided
            .retain(|((row, _), _)| !rows.contains(row));
    }

    /// The layout changed (widths, order, hidden flags, the text size):
    /// every cue decided again.
    pub(super) fn relayout_popover(&mut self) {
        self.popover_state.decided.clear();
    }

    /// Every index means another row or column (a sort, `replace_rows`,
    /// `set_columns`): it closes.
    pub(super) fn reset_popover(&mut self, cx: &mut Context<Self>) {
        self.popover_state.decided.clear();
        self.close_popover(cx);
    }

    /// The random test's `KeepPopoverOnSort`, around a sort's reset: the
    /// open popover taken before it (`None` without the control) and put
    /// back after, its old text drawn.
    #[cfg(all(test, feature = "sort"))]
    pub(super) fn keep_popover_on_sort(&mut self) -> Option<Open> {
        if self.popover_state.control != Control::KeepPopoverOnSort {
            return None;
        }
        self.popover_state.open.take()
    }

    /// Puts back what [`TallTableState::keep_popover_on_sort`] took.
    #[cfg(all(test, feature = "sort"))]
    pub(super) fn put_back_popover(&mut self, kept: Option<Open>) {
        if kept.is_some() {
            self.popover_state.open = kept;
        }
    }

    /// The rows shrank to `rows` (`set_rows`): open past them, it closes.
    pub(super) fn cut_popover(&mut self, rows: u64, cx: &mut Context<Self>) {
        if self.popover().is_some_and(|cell| cell.row >= rows) {
            self.close_popover(cx);
        }
    }

    /// `close`: it closes, `Popover(None)` once the update ends (`close`
    /// can't emit).
    pub(super) fn close_popover_quietly(&mut self, cx: &mut App) {
        if self.popover_state.open.take().is_none() {
            return;
        }
        let this = self.popover_state.this.clone();
        cx.defer(move |cx| {
            let _ = this.update(cx, |_, cx| {
                cx.emit(TallTableEvent::Popover(None));
                cx.notify();
            });
        });
    }

    /// Cmd+C or Ctrl+C: with the popover open and part of its text
    /// selected (the window's text selection), that part to the clipboard;
    /// else it goes on (to `copy`'s key, then the host's).
    pub(crate) fn popover_copy(
        &mut self,
        _: &PopoverCopy,
        window: &mut Window,
        cx: &mut Context<Self>,
    ) {
        // A selection in this popover's text, not one left in another's or
        // made in the host's.
        if self
            .popover_state
            .open
            .as_ref()
            .is_some_and(|open| open.selection.snapshot(cx).is_some())
        {
            let text = gpui_kit::base::TextSelection::selected_text(window, cx);
            if !text.is_empty() {
                cx.write_to_clipboard(ClipboardItem::new_string(text));
                return;
            }
        }
        cx.propagate();
    }

    /// Enter: on an open popover, presses its button, or with none closes
    /// it; else opens it on `select`'s active cell (a `Cells` selection);
    /// else goes on to the host.
    pub(crate) fn popover_enter(
        &mut self,
        _: &PopoverEnter,
        window: &mut Window,
        cx: &mut Context<Self>,
    ) {
        if let Some(cell) = self.popover() {
            if self.popover_state.button.is_some() {
                self.press_popover_button(cell, window, cx);
            } else {
                self.close_popover(cx);
            }
            return;
        }
        #[cfg(feature = "select")]
        if let Some(selection) = self.selection_state.current
            && selection.kind() == crate::selection::Kind::Cells
        {
            let (row, place) = selection.anchor();
            if let Some(column) = self.columns.get(place).map(|column| column.index(place))
                && self.open_popover(PopoverCell::new(row, column), cx)
            {
                return;
            }
        }
        cx.propagate();
    }

    /// Escape: closes an open popover, else goes on (to `reorder`'s and
    /// `select`'s, then the host's).
    pub(crate) fn popover_escape(
        &mut self,
        _: &PopoverEscape,
        _: &mut Window,
        cx: &mut Context<Self>,
    ) {
        if self.popover_state.open.is_none() {
            cx.propagate();
            return;
        }
        self.close_popover(cx);
    }

    /// The button pressed (or Enter): `PopoverButton`, closed, the table
    /// focused again (a host's button may have taken it).
    fn press_popover_button(
        &mut self,
        cell: PopoverCell,
        window: &mut Window,
        cx: &mut Context<Self>,
    ) {
        cx.emit(TallTableEvent::PopoverButton(cell));
        self.close_popover(cx);
        window.focus(&self.focus_handle, cx);
    }

    /// A press on the cue of `cell`: on the open popover's cell it closes
    /// it, else opens it there (moving it from another).
    fn press_cue(&mut self, cell: PopoverCell, window: &mut Window, cx: &mut Context<Self>) {
        self.hide_tooltip(cx);
        window.focus(&self.focus_handle, cx);
        if self.popover() == Some(cell) {
            self.close_popover(cx);
        } else {
            self.open_popover(cell, cx);
        }
    }

    /// Before a frame: the open popover closed if its cell left the view,
    /// its text decided again if a page landed on its row, its tints for
    /// the term in effect; and the cues to draw decided.
    pub(super) fn prepare_popover(&mut self, window: &Window, cx: &mut Context<Self>) {
        if let Some(cell) = self.popover() {
            let shown = self
                .place_of(cell.column)
                .and_then(|place| self.popover_cell_bounds(cell.row, place));
            if shown.is_none() {
                self.close_popover(cx);
            }
        }
        if let Some(cell) = self
            .popover_state
            .open
            .as_ref()
            .filter(|open| !open.decided)
            .map(|open| open.cell)
            && let Some(text) = self.popover_value(cell)
            && let Some(open) = self.popover_state.open.as_mut()
        {
            if open.text != text {
                open.text = text;
                #[cfg(feature = "find")]
                {
                    open.tinted_for = None;
                }
            }
            open.decided = true;
        }
        #[cfg(feature = "find")]
        self.tint_popover();
        self.decide_cues(window);
        self.place_cues();
    }

    /// `find`'s ranges in the open popover's text, for the term in effect:
    /// a value that matches by the rule has each occurrence tinted, as its
    /// cell's are.
    #[cfg(feature = "find")]
    fn tint_popover(&mut self) {
        let folded = self
            .find_state
            .term
            .is_some()
            .then(|| self.find_state.folded.clone());
        let lower = self
            .find_state
            .term
            .as_ref()
            .map(|_| self.find_state.lower.clone());
        let Some(open) = self.popover_state.open.as_mut() else {
            return;
        };
        let same = match (&open.tinted_for, &folded) {
            (Some(was), Some(now)) => was == now,
            (None, None) => true,
            _ => false,
        };
        if same {
            return;
        }
        open.tints = match (&folded, lower) {
            (Some(folded), Some(lower))
                if !open.text.null && crate::find::matches(&open.text.text, &lower) =>
            {
                crate::find::ranges(&open.text.text, folded)
            }
            _ => Vec::new(),
        };
        open.tinted_for = folded;
    }

    /// The cells a frame cues: the hovered one, then `select`'s active
    /// cell, by row and place.
    fn cue_cells(&self) -> Vec<(u64, usize)> {
        let mut cells = Vec::with_capacity(2);
        if let Some(hover) = self.hover.as_ref() {
            cells.push((hover.row, hover.column));
        }
        #[cfg(feature = "select")]
        if let Some(selection) = self.selection_state.current
            && selection.kind() == crate::selection::Kind::Cells
            && !cells.contains(&selection.anchor())
        {
            cells.push(selection.anchor());
        }
        cells
    }

    /// Each cue cell decided once (until a page lands on it or the layout
    /// changes): it shows with a button set, or where the popover shows
    /// more than the cell (the tooltip's rule, by shaping the cell), its
    /// page loaded either way.
    fn decide_cues(&mut self, window: &Window) {
        if self.popover_state.cue.is_none() {
            self.popover_state.decided.clear();
            return;
        }
        let cells = self.cue_cells();
        self.popover_state
            .decided
            .retain(|(cell, _)| cells.contains(cell));
        for cell in cells {
            if self.popover_state.decided.iter().any(|(at, _)| *at == cell) {
                continue;
            }
            if !matches!(self.cache.row(cell.0), RowState::Loaded(..)) {
                continue;
            }
            let shows = self.popover_state.button.is_some()
                || self.tooltip_text(cell.0, cell.1, window).is_some();
            self.popover_state.decided.push((cell, shows));
        }
    }

    /// Places this frame's cues, in window pixels, before the probe reads
    /// them: each a box at its cell's right end (2 px inside its right,
    /// top, and bottom edges, so the active cell's and the current match's
    /// edges show past it); none for a cell too narrow to hold one.
    fn place_cues(&mut self) {
        let mut placed = Vec::new();
        if self.popover_state.cue.is_some() {
            let side = self.cue_side();
            // The hovered cell's first, then the active cell's: the probe's
            // `cue` is the first.
            for (row, place) in self.cue_cells() {
                let shows = self
                    .popover_state
                    .decided
                    .iter()
                    .any(|(at, shows)| *at == (row, place) && *shows);
                let Some(bounds) = self.popover_cell_bounds(row, place).filter(|_| shows) else {
                    continue;
                };
                if f32::from(bounds.size.width) < side + 2.0 * CUE_INSET {
                    continue;
                }
                let cell = PopoverCell::new(row, self.columns[place].index(place));
                let origin = point(
                    bounds.right() - px(CUE_INSET + side),
                    bounds.origin.y + px(CUE_INSET),
                );
                placed.push((cell, Bounds::new(origin, size(px(side), px(side)))));
            }
        }
        *self.popover_state.cues.borrow_mut() = placed;
    }

    /// A cue's side: the row's height less its insets.
    fn cue_side(&self) -> f32 {
        (f32::from(self.sizes().row()) - 2.0 * CUE_INSET).max(0.0)
    }

    /// The cues placed this frame ([`TallTableState::place_cues`]), in the
    /// body's coordinates, each a press target over its cell's text.
    pub(super) fn render_cues(
        &self,
        window: &mut Window,
        cx: &mut Context<Self>,
    ) -> Vec<Stateful<Div>> {
        let Some(cue) = self.popover_state.cue.clone() else {
            return Vec::new();
        };
        let side = self.cue_side();
        let placed = self.popover_state.cues.borrow().clone();
        let mut elements = Vec::new();
        for (cell, bounds) in placed {
            let element = div()
                .id(("tall-table-cue", elements.len()))
                .absolute()
                .left(bounds.origin.x - self.body.origin.x)
                .top(bounds.origin.y - self.body.origin.y)
                .size(px(side))
                .cursor_pointer()
                .on_mouse_down(
                    MouseButton::Left,
                    cx.listener(move |this, _: &MouseDownEvent, window, cx| {
                        // Not `select`'s press, nor reported by `clicks`.
                        cx.stop_propagation();
                        this.press_cue(cell, window, cx);
                    }),
                )
                .map(click_stops);
            elements.push(element.children(self.cue_look(&cue, window, cx)));
        }
        elements
    }

    /// The host's element, if its own cue's look is one: the table's
    /// mark and the host's icon are painted with the cell's text
    /// (`CueInCell`), the cue's element only their press target.
    fn cue_look(
        &self,
        cue: &PopoverCue,
        window: &mut Window,
        cx: &mut Context<Self>,
    ) -> Option<AnyElement> {
        match &cue.look {
            CueLook::Custom(build) => Some(
                div()
                    .size_full()
                    .child(build(window, cx))
                    .into_any_element(),
            ),
            CueLook::Expand | CueLook::Icon(_) => None,
        }
    }

    /// What the cell at `row` and column index `column` draws of its cue
    /// with its text (`cells_text`), none on a cell with no cue drawn: its
    /// mark (none for the host's element, which draws itself), and the room
    /// it keeps past the padding where the text has no "…" to give it: up to
    /// the mark, or the host's whole box, and a gap, from the cue's box at
    /// the cell's visible right end.
    pub(super) fn cue_in_cell(&self, row: u64, column: usize, color: Hsla) -> Option<CueInCell> {
        let cue = self.popover_state.cue.as_ref()?;
        let cell = PopoverCell::new(row, column);
        let cue_right = self
            .popover_state
            .cues
            .borrow()
            .iter()
            .find(|(at, _)| *at == cell)
            .map(|(_, bounds)| bounds.right() + px(CUE_INSET))?;
        let side = self.cue_side();
        // How far the cue's box sits left of the cell's whole right end: a
        // cell cut by the view's right edge has its cue at its visible end.
        let offset = self.place_of(column).map_or(0.0, |place| {
            let laid_out = &self.columns[place];
            let right = self.body.origin.x
                + px(self.gutter_width()
                    + self.place().left(place, laid_out.x, self.scroll_x)
                    + laid_out.width);
            f32::from(right - cue_right).max(0.0)
        });
        let (covered, mark) = match &cue.look {
            CueLook::Custom(_) => (side, None),
            CueLook::Expand => ((side + cue_mark(side)) / 2.0, Some(CueMark::Expand(color))),
            CueLook::Icon(path) => (
                (side + cue_mark(side)) / 2.0,
                Some(CueMark::Icon(path.clone(), color)),
            ),
        };
        Some(CueInCell {
            room: (offset + CUE_INSET + covered + CUE_GAP - self.sizes().padding() / 2.0).max(0.0),
            side,
            offset,
            mark,
        })
    }

    /// The open popover, below its cell or flipped above, over everything
    /// but the tooltip.
    pub(super) fn render_popover(
        &mut self,
        window: &mut Window,
        cx: &mut Context<Self>,
    ) -> Option<Deferred> {
        // Redrawn as a drag selects its text, from its first frame.
        if let Some(open) = self.popover_state.open.as_mut()
            && open._selecting.is_none()
        {
            open._selecting = Some(open.selection.refresh_window_on_change(window, cx));
        }
        let open = self.popover_state.open.as_ref()?;
        let place = self.place_of(open.cell.column)?;
        let cell_bounds = self.popover_cell_bounds(open.cell.row, place)?;
        let cell = open.cell;
        let viewport = window.viewport_size();
        let max_w = max_width(f32::from(cell_bounds.size.width), f32::from(viewport.width));
        let max_h = max_height(f32::from(viewport.height));
        let sizes = self.sizes();
        let pad = sizes.padding() / 2.0;
        let font_size = self.glyphs.font_size;
        let entity = cx.entity();
        let placed = self.popover_state.placed.clone();
        let cues = self.popover_state.cues.clone();
        let probing = self.probe_frames;
        let theme = cx.theme();
        let tint = HighlightStyle {
            background_color: Some(Hsla {
                s: 0.1,
                ..theme.selection
            }),
            ..Default::default()
        };
        let (surface_bg, border, radius) = (theme.popover, theme.border, theme.radius);
        let text = SelectableText::with_handle(
            "tall-table-popover-text",
            open.selection.clone(),
            open.text.text.clone(),
        )
        .highlights(open.tints.iter().cloned().map(|range| (range, tint)));
        let text_color = if open.text.null {
            theme.muted_foreground
        } else {
            theme.popover_foreground
        };
        let body = div()
            .id("tall-table-popover-scroll")
            .flex_shrink(1.)
            .min_h_0()
            .overflow_y_scroll()
            .track_scroll(&open.scroll)
            .px(px(pad))
            .py(px(pad / 2.0))
            .whitespace_normal()
            .text_color(text_color)
            .child(text);
        let button = self.popover_state.button.as_ref().map(|button| {
            let recorded = placed.clone();
            let press = cx.listener(move |this, _: &ClickEvent, window, cx| {
                this.press_popover_button(cell, window, cx);
            });
            let target = match &button.look {
                ButtonLook::Label(label) => Button::new("tall-table-popover-button")
                    .label(label.clone())
                    .ghost()
                    .small()
                    .tab_stop(false)
                    .on_click(press)
                    .into_any_element(),
                ButtonLook::Custom(build) => div()
                    .id("tall-table-popover-button")
                    .cursor_pointer()
                    .on_click(press)
                    .child(build(window, cx))
                    .into_any_element(),
            };
            div()
                .relative()
                .flex_shrink_0()
                .flex()
                .px(px(pad / 2.0))
                .pb(px(pad / 2.0))
                .child(
                    div().relative().child(target).child(
                        canvas(
                            move |bounds, _, _| recorded.borrow_mut().button = Some(bounds),
                            |_, _, _, _| {},
                        )
                        .absolute()
                        .top_0()
                        .left_0()
                        .size_full(),
                    ),
                )
        });
        let surface = div()
            .id("tall-table-popover")
            .relative()
            .flex()
            .flex_col()
            .min_w(px(f32::from(cell_bounds.size.width).min(max_w)))
            .max_w(px(max_w))
            .max_h(px(max_h))
            .overflow_hidden()
            .bg(surface_bg)
            .border_1()
            .border_color(border)
            .rounded(radius)
            .shadow_lg()
            .text_size(font_size)
            .line_height(relative(1.4))
            .child(body)
            .children(button)
            .child(
                // Where it landed, and a press anywhere else closes it.
                canvas(
                    {
                        let placed = placed.clone();
                        move |bounds, _, cx| {
                            let below = bounds.origin.y >= cell_bounds.origin.y;
                            let changed = {
                                let mut placed = placed.borrow_mut();
                                let changed =
                                    placed.bounds != Some(bounds) || placed.below != below;
                                placed.bounds = Some(bounds);
                                placed.below = below;
                                changed
                            };
                            // The probe reports it at the next frame.
                            if changed && probing {
                                let entity = entity.clone();
                                cx.defer(move |cx| entity.update(cx, |_, cx| cx.notify()));
                            }
                            entity
                        }
                    },
                    move |bounds, entity, window, _| {
                        window.on_mouse_event(move |event: &MouseDownEvent, phase, _, cx| {
                            if phase != DispatchPhase::Capture
                                || bounds.contains(&event.position)
                                || cues
                                    .borrow()
                                    .iter()
                                    .any(|(_, cue)| cue.contains(&event.position))
                            {
                                return;
                            }
                            // It goes on to do what it does.
                            entity.update(cx, |this, cx| this.close_popover(cx));
                        });
                    },
                )
                .absolute()
                .top_0()
                .left_0()
                .size_full(),
            );
        Some(
            deferred(
                Positioner::side(cell_bounds)
                    .placement(Placement::Bottom)
                    .align(Align::Start)
                    .margin(px(MARGIN))
                    .occlude()
                    .child(surface),
            )
            .with_priority(POPUP_PRIORITY),
        )
    }

    /// The probe's `popover`: the last frame's placing.
    pub(super) fn popover_probe(&self) -> Option<PopoverProbe> {
        let open = self.popover_state.open.as_ref()?;
        let placed = self.popover_state.placed.borrow();
        let bounds = placed.bounds?;
        let scroll = &open.scroll;
        let view = f32::from(scroll.bounds().size.height);
        Some(PopoverProbe {
            cell: open.cell,
            bounds: corners(bounds),
            below: placed.below,
            chars: open.text.chars,
            cut: open.text.cut,
            scroll: -f32::from(scroll.offset().y),
            content_height: view + f32::from(scroll.max_offset().y),
            button: placed.button.map(corners),
        })
    }

    /// The cues this frame drew, by cell, in window pixels (tests only).
    #[cfg(test)]
    pub(super) fn popover_state_cues(&self) -> Vec<DrawnCue> {
        self.popover_state.cues.borrow().clone()
    }

    /// The probe's `cue`: the hovered cell's, else the active cell's.
    pub(super) fn cue_probe(&self) -> Option<CueProbe> {
        self.popover_state
            .cues
            .borrow()
            .first()
            .map(|(cell, bounds)| CueProbe {
                cell: *cell,
                bounds: corners(*bounds),
            })
    }
}
