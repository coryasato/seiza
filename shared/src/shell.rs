//! The window shell every app renders into: a title bar above the app's view,
//! plus the window's overlay layers.

use gpui_kit::component::{Root, Theme, TitleBar, v_flex};
use gpui_kit::*;

#[cfg(target_family = "wasm")]
type FirstFrameHook = Box<dyn FnOnce(&mut Window, &mut App)>;

/// A title bar above the app's content, filling the canvas.
///
/// It follows the system light/dark appearance while the page is open, and
/// renders the sheet, dialog, and notification layers: in gpui-kit 0.6.4,
/// `Root` doesn't draw them itself, so without this `open_dialog`,
/// `open_sheet`, and `push_notification` update state but never appear.
///
/// On the web it also owns the first-frame mark: its first render arms the
/// `gpui:first-frame` mark, then runs the post-paint hook.
pub struct AppShell {
    title: SharedString,
    content: AnyView,
    #[cfg(target_family = "wasm")]
    first_frame: Option<FirstFrameHook>,
    _appearance: Subscription,
}

impl AppShell {
    pub fn new(
        title: impl Into<SharedString>,
        content: impl Into<AnyView>,
        window: &mut Window,
        cx: &mut Context<Self>,
    ) -> Self {
        let appearance = cx.observe_window_appearance(window, |_, window, cx| {
            Theme::sync_system_appearance(Some(window), cx);
        });
        Self {
            title: title.into(),
            content: content.into(),
            #[cfg(target_family = "wasm")]
            first_frame: None,
            _appearance: appearance,
        }
    }

    /// Runs `hook` once, after the first frame has been presented.
    #[cfg(target_family = "wasm")]
    pub(crate) fn on_first_frame(
        mut self,
        hook: impl FnOnce(&mut Window, &mut App) + 'static,
    ) -> Self {
        self.first_frame = Some(Box::new(hook));
        self
    }

    #[cfg(target_family = "wasm")]
    fn arm_first_frame(&mut self, window: &mut Window, cx: &mut Context<Self>) {
        let Some(hook) = self.first_frame.take() else {
            return;
        };
        cx.spawn_in(window, async move |_, cx| {
            crate::first_frame::mark_after_next_frame().await;
            let _ = cx.update(hook);
        })
        .detach();
    }
}

impl Render for AppShell {
    fn render(&mut self, window: &mut Window, cx: &mut Context<Self>) -> impl IntoElement {
        #[cfg(target_family = "wasm")]
        self.arm_first_frame(window, cx);

        // Root already sets the background, text color, and font family.
        div()
            .relative()
            .size_full()
            .child(
                v_flex()
                    .size_full()
                    .child(TitleBar::new().child(div().text_sm().child(self.title.clone())))
                    .child(
                        div()
                            .flex_1()
                            .min_h_0()
                            .min_w_0()
                            .child(self.content.clone()),
                    ),
            )
            .children(Root::render_sheet_layer(window, cx))
            .children(Root::render_dialog_layer(window, cx))
            .children(Root::render_notification_layer(window, cx))
    }
}
