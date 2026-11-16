//! `clicks`: the table's presses reported ([`TallTableEvent::Clicked`]).
//! The root's press listener takes every button's press: a context press
//! (the right button's, or a Ctrl+left one when the host says so) and a
//! left press the table counts (`click::Count`), which `reorder` and
//! `select` then read at the table's count, not gpui's. A long press comes
//! through a window listener on the root's first child, whose hitbox the
//! bands and arrows occlude. The scrollbars, bands, and arrows stop a right
//! press and a long press (`stops_context`), so nothing is reported there
//! and a host's `ContextMenuExt` round the table doesn't open over them.
//! The event follows what the press did to the selection (`select`).
//! Nothing is drawn (`docs/DECISIONS.md`, "Features").

use gpui_kit::*;

use super::hit::Target;
use super::{TallTableEvent, TallTableState};
use crate::click::{ClickKind, ClickTarget, Count, TallTableClick};
use crate::delegate::TallTableDelegate;
#[cfg(feature = "select")]
use crate::selection::{Kind, TallTableSelection};

/// The table's presses, with the feature.
#[derive(Debug, Default)]
pub(super) struct ClicksState {
    /// A left press with Ctrl is a context press (the host's setting).
    ctrl_press_is_context: bool,
    /// The left presses counted, as of the last press.
    count: Count,
    /// The count before the press being handled: every press in the
    /// window takes it in the capture phase, so a press the table never
    /// counts (a band's, a scrollbar's, one outside) makes the next a first.
    before: Count,
    /// A long press was reported and nothing claimed it: gpui-pre turns
    /// its touch, lifted, into a tap (a left press), which isn't a press of
    /// the reader's. Forgotten when a phase after its start comes (someone
    /// claimed it, a host's `ContextMenuExt`) or the touch pans.
    long_press: bool,
    /// The press being handled is that tap: it's dropped.
    tap: bool,
}

impl<D: TallTableDelegate> TallTableState<D> {
    /// Whether a left press with Ctrl is a context press: off by default.
    pub fn ctrl_press_is_context(&self) -> bool {
        self.clicks_state.ctrl_press_is_context
    }

    /// Whether a left press with Ctrl is a context press (off by default:
    /// a Mac browser's right-click, which a host in a Mac browser turns on;
    /// elsewhere Ctrl+click is the host's to give a meaning). Off, it's a
    /// `Press` whose modifiers say Ctrl, and `select` ignores it.
    pub fn set_ctrl_press_is_context(&mut self, on: bool) {
        self.clicks_state.ctrl_press_is_context = on;
    }

    /// A press of any button on the table, in the root's bubble phase (the
    /// bands, arrows, and scrollbars stop theirs first).
    pub(super) fn press(
        &mut self,
        event: &MouseDownEvent,
        window: &mut Window,
        cx: &mut Context<Self>,
    ) {
        if self.clicks_state.tap {
            return;
        }
        let left = event.button == MouseButton::Left;
        if event.button == MouseButton::Right
            || (left && event.modifiers.control && self.clicks_state.ctrl_press_is_context)
        {
            self.context_press(event.position, event.modifiers, window, cx);
            return;
        }
        if !left {
            return;
        }
        let counted = self.count_left(event.click_count);
        // `reorder` and `select` read the table's count: a left press after
        // a right one is a first, whatever gpui counted.
        let event = MouseDownEvent {
            click_count: counted,
            ..event.clone()
        };
        // Found once, for `select` and the event (a press doesn't scroll).
        let target = self.target_at(event.position);
        #[cfg(feature = "reorder")]
        let moved = self.press_move(&event, cx);
        #[cfg(not(feature = "reorder"))]
        let moved = false;
        #[cfg(feature = "select")]
        if !moved {
            self.press_select_at(&event, target, cx);
        }
        #[cfg(not(feature = "select"))]
        let _ = moved;
        if let Some(kind) = ClickKind::counted(counted) {
            self.report(kind, target, event.position, event.modifiers, cx);
        }
    }

    /// A left press the table counts (the root's, and `resize`'s band's,
    /// whose double press fits): its count, from the last press's.
    pub(super) fn count_left(&mut self, click_count: usize) -> usize {
        let mut count = self.clicks_state.before;
        let counted = count.left(click_count);
        self.clicks_state.count = count;
        counted
    }

    /// A touch's long press over the table, at its start: a context press.
    /// Its tap, if nothing claims it, is dropped.
    fn long_press(&mut self, position: Point<Pixels>, window: &mut Window, cx: &mut Context<Self>) {
        self.clicks_state.count.other();
        if self.context_press(position, Modifiers::default(), window, cx) {
            self.clicks_state.long_press = true;
        }
    }

    /// A context press: nothing during a drag (`false`); else it hides the
    /// tooltip and focuses the table, as a left press does, and with
    /// `select` follows Sheets' rule; then the event.
    fn context_press(
        &mut self,
        position: Point<Pixels>,
        modifiers: Modifiers,
        window: &mut Window,
        cx: &mut Context<Self>,
    ) -> bool {
        if self.dragging() {
            return false;
        }
        self.hide_tooltip(cx);
        window.focus(&self.focus_handle, cx);
        let target = self.target_at(position);
        #[cfg(feature = "select")]
        self.context_select(target, cx);
        self.report(ClickKind::Context, target, position, modifiers, cx);
        true
    }

    /// A drag of any kind is on: a scrollbar's, a selection's, a column's
    /// move or its pressed header, a resize.
    fn dragging(&self) -> bool {
        #[cfg(feature = "select")]
        if self.is_selecting() {
            return true;
        }
        #[cfg(feature = "reorder")]
        if self.moving.is_some() {
            return true;
        }
        #[cfg(feature = "resize")]
        if self.resizing.is_some() {
            return true;
        }
        self.drag.is_some()
    }

    fn report(
        &mut self,
        kind: ClickKind,
        target: Option<Target>,
        position: Point<Pixels>,
        modifiers: Modifiers,
        cx: &mut Context<Self>,
    ) {
        let target = match target {
            Some(Target::Cell((row, column))) => ClickTarget::Cell { row, column },
            Some(Target::Gutter((row, _))) => ClickTarget::Row(row),
            Some(Target::Header((_, column))) => ClickTarget::Column(column),
            Some(Target::Corner) => ClickTarget::Corner,
            #[cfg(feature = "group-headers")]
            Some(Target::Group { level, start, end }) => ClickTarget::Group { level, start, end },
            // A header with no rows (`target_at` reads a header's cell).
            None => self
                .header_place_at(position)
                .map_or(ClickTarget::Blank, ClickTarget::Column),
        };
        cx.emit(TallTableEvent::Clicked(TallTableClick {
            kind,
            target,
            position,
            modifiers,
        }));
    }

    /// Sheets' rule: a context press inside the selection keeps it; on
    /// anything else it selects what's pressed as an unmodified press
    /// would (Shift doesn't extend), no drag started. A blank changes
    /// nothing.
    #[cfg(feature = "select")]
    fn context_select(&mut self, target: Option<Target>, cx: &mut Context<Self>) {
        let Some(target) = target else {
            return;
        };
        if self
            .selection_state
            .current
            .is_some_and(|selection| inside(selection, target))
        {
            return;
        }
        // A group outside the selection: selected.
        #[cfg(feature = "group-headers")]
        if let Target::Group { start, end, .. } = target {
            self.press_group(false, start..end, cx);
            return;
        }
        let Some((cell, ..)) = target.cell() else {
            // The corner, with nothing selected.
            self.select_everything(cx);
            return;
        };
        if let Some(kind) = self.press_kind(target) {
            self.replace_selection(Some(TallTableSelection::new(kind, cell, cell)), cx);
        }
    }

    /// The root's first child: every press in the window takes the count
    /// and the long press's tap (capture), a pan forgets it, and a long
    /// press over the table is a context press. Its hitbox is under
    /// everything the table draws, so the bands and arrows, which occlude,
    /// keep their long presses.
    pub(super) fn clicks_canvas(&self, cx: &mut Context<Self>) -> impl IntoElement + use<D> {
        let entity = cx.entity();
        canvas(
            |bounds, window, _| window.insert_hitbox(bounds, HitboxBehavior::Normal),
            move |_, hitbox, window, _| {
                let pressing = entity.clone();
                window.on_mouse_event(move |event: &MouseDownEvent, phase, _, cx| {
                    if phase == DispatchPhase::Capture {
                        pressing.update(cx, |this, _| {
                            let clicks = &mut this.clicks_state;
                            clicks.before = clicks.count;
                            clicks.count.other();
                            clicks.tap = std::mem::take(&mut clicks.long_press)
                                && event.button == MouseButton::Left;
                        });
                    }
                });
                let panning = entity.clone();
                window.on_mouse_event(move |_: &ScrollEvent, phase, _, cx| {
                    if phase == DispatchPhase::Capture {
                        panning.update(cx, |this, _| this.clicks_state.long_press = false);
                    }
                });
                window.on_mouse_event(move |event: &LongPressEvent, phase, window, cx| {
                    if phase != DispatchPhase::Bubble {
                        return;
                    }
                    if event.phase != TouchPhase::Started {
                        // Claimed: no tap follows.
                        entity.update(cx, |this, _| this.clicks_state.long_press = false);
                    } else if !window.default_prevented() && hitbox.is_hovered(window) {
                        entity.update(cx, |this, cx| {
                            this.long_press(event.start_position, window, cx)
                        });
                    }
                });
            },
        )
        .absolute()
        .size_full()
    }
}

/// Whether a context press on `target` is inside `selection`: a cell it
/// covers, a row's number under a `Rows` range, a header or a group (all
/// its columns) under a `Columns` range, the corner under any.
#[cfg(feature = "select")]
fn inside(selection: TallTableSelection, target: Target) -> bool {
    match target {
        Target::Cell((row, column)) => selection.contains(row, column),
        Target::Gutter((row, column)) => {
            selection.kind() == Kind::Rows && selection.contains(row, column)
        }
        Target::Header((row, column)) => {
            selection.kind() == Kind::Columns && selection.contains(row, column)
        }
        Target::Corner => true,
        // Its columns all in a `Columns` range.
        #[cfg(feature = "group-headers")]
        Target::Group { start, end, .. } => {
            selection.kind() == Kind::Columns
                && selection.contains(0, start)
                && selection.contains(0, end - 1)
        }
    }
}

/// `element` (a scrollbar, a band, an arrow) stops a right press and a long
/// press: nothing reported, and a `ContextMenuExt` round the table, which
/// opens only on a press nothing stopped or prevented, doesn't open over it.
pub(super) fn stops_context<E: InteractiveElement + ParentElement>(element: E) -> E {
    element
        .on_mouse_down(MouseButton::Right, |_, _, cx| cx.stop_propagation())
        .child(
            canvas(
                |bounds, window, _| window.insert_hitbox(bounds, HitboxBehavior::Normal),
                |_, hitbox, window, _| {
                    window.on_mouse_event(move |event: &LongPressEvent, phase, window, cx| {
                        if phase == DispatchPhase::Bubble
                            && event.phase == TouchPhase::Started
                            && hitbox.is_hovered(window)
                        {
                            window.prevent_default();
                            cx.stop_propagation();
                        }
                    });
                },
            )
            .absolute()
            .size_full(),
        )
}
