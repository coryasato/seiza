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
/// On the web it also owns the first-frame mark: its first render with a real
/// viewport arms the `gpui:first-frame` mark, then runs the post-paint hook. The perf overlay
/// draws above everything else.
pub struct AppShell {
    title: SharedString,
    content: AnyView,
    #[cfg(target_family = "wasm")]
    first_frame: Option<FirstFrameHook>,
    _appearance: Subscription,
    _perf: Subscription,
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
        let perf = cx.observe_global::<crate::perf::PerfOverlay>(|_, cx| cx.notify());
        Self {
            title: title.into(),
            content: content.into(),
            #[cfg(target_family = "wasm")]
            first_frame: None,
            _appearance: appearance,
            _perf: perf,
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

    /// Arms the first-frame mark on the first render with a real viewport. The
    /// window starts at 0×0, and a render at that size presents nothing.
    #[cfg(target_family = "wasm")]
    fn arm_first_frame(&mut self, window: &mut Window, cx: &mut Context<Self>) {
        let viewport = window.viewport_size();
        if viewport.width <= px(0.) || viewport.height <= px(0.) {
            return;
        }
        let Some(hook) = self.first_frame.take() else {
            return;
        };
        let marked = crate::first_frame::mark_first_frame();
        cx.spawn_in(window, async move |_, cx| {
            let ttfp_ms = marked.await;
            let _ = cx.update(|window, cx| {
                if let Some(ttfp_ms) = ttfp_ms {
                    crate::perf::set_ttfp(cx, ttfp_ms);
                }
                hook(window, cx);
            });
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
            .children(crate::perf::render(cx))
    }
}
