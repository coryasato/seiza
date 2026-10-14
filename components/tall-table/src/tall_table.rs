//! The table element: draws a [`TallTableState`] with its focus, scrolling keys,
//! and border.

use gpui_kit::component::ActiveTheme as _;
use gpui_kit::*;

use crate::delegate::TallTableDelegate;
use crate::state::{CONTEXT, TEXT_REMS, TallTableState};

/// Draws `state`, filling its parent. Call [`crate::init`] once first, for
/// the keys.
///
/// ```rust,ignore
/// let state = cx.new(|cx| TallTableState::new(delegate, columns, rows, Paging::default(), cx));
/// TallTable::new(&state)
/// ```
#[derive(IntoElement)]
pub struct TallTable<D: TallTableDelegate> {
    state: Entity<TallTableState<D>>,
}

impl<D: TallTableDelegate> TallTable<D> {
    pub fn new(state: &Entity<TallTableState<D>>) -> Self {
        Self {
            state: state.clone(),
        }
    }
}

impl<D: TallTableDelegate> RenderOnce for TallTable<D> {
    fn render(self, window: &mut Window, cx: &mut App) -> impl IntoElement {
        let focus_handle = self.state.read(cx).focus_handle.clone();
        let focused = focus_handle.is_focused(window);
        let theme = cx.theme();
        div()
            .id("tall-table")
            .key_context(CONTEXT)
            .track_focus(&focus_handle)
            .on_action(window.listener_for(&self.state, TallTableState::line_up))
            .on_action(window.listener_for(&self.state, TallTableState::line_down))
            .on_action(window.listener_for(&self.state, TallTableState::page_up))
            .on_action(window.listener_for(&self.state, TallTableState::page_down))
            .on_action(window.listener_for(&self.state, TallTableState::scroll_to_top))
            .on_action(window.listener_for(&self.state, TallTableState::scroll_to_end))
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
