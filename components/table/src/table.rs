//! The table element: draws a [`TableState`] with its focus, scrolling keys,
//! and border.

use gpui_kit::component::ActiveTheme as _;
use gpui_kit::*;

use crate::delegate::TableDelegate;
use crate::state::{CONTEXT, TEXT_REMS, TableState};

/// Draws `state`, filling its parent. Call [`crate::init`] once first, for
/// the keys.
///
/// ```rust,ignore
/// let state = cx.new(|cx| TableState::new(delegate, columns, rows, Paging::default(), cx));
/// Table::new(&state)
/// ```
#[derive(IntoElement)]
pub struct Table<D: TableDelegate> {
    state: Entity<TableState<D>>,
}

impl<D: TableDelegate> Table<D> {
    pub fn new(state: &Entity<TableState<D>>) -> Self {
        Self {
            state: state.clone(),
        }
    }
}

impl<D: TableDelegate> RenderOnce for Table<D> {
    fn render(self, window: &mut Window, cx: &mut App) -> impl IntoElement {
        let focus_handle = self.state.read(cx).focus_handle.clone();
        let focused = focus_handle.is_focused(window);
        let theme = cx.theme();
        div()
            .id("row-table")
            .key_context(CONTEXT)
            .track_focus(&focus_handle)
            .on_action(window.listener_for(&self.state, TableState::line_up))
            .on_action(window.listener_for(&self.state, TableState::line_down))
            .on_action(window.listener_for(&self.state, TableState::page_up))
            .on_action(window.listener_for(&self.state, TableState::page_down))
            .on_action(window.listener_for(&self.state, TableState::scroll_to_top))
            .on_action(window.listener_for(&self.state, TableState::scroll_to_end))
            .on_mouse_down(
                MouseButton::Left,
                window.listener_for(&self.state, |this, _: &MouseDownEvent, window, cx| {
                    this.hide_tooltip(cx);
                    window.focus(&this.focus_handle, cx);
                }),
            )
            .size_full()
            .overflow_hidden()
            .text_size(rems(TEXT_REMS))
            .bg(theme.tokens.table)
            .rounded(theme.radius)
            .border_1()
            .border_color(if focused { theme.ring } else { theme.border })
            .child(self.state)
    }
}
