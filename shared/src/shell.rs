//! The window's root, around the app's view: it arms the first-frame mark,
//! follows the system appearance, and draws the perf panel above the view
//! (feature `panel`). Anything else on screen, a title bar or a theme toggle
//! included, is the app's.

use gpui_kit::component::Theme;
use gpui_kit::*;

#[cfg(feature = "panel")]
use crate::panel::PerfPanel;

/// Whether the window still follows the system appearance: until the app
/// says a visitor picked a theme ([`stop_following_system_appearance`]),
/// then never again until a reload.
#[derive(Default)]
struct SystemAppearance {
    ignored: bool,
}

impl Global for SystemAppearance {}

/// Stops the window following the system light/dark appearance, for the rest
/// of the page's life: call it when a visitor picks a theme, so a system
/// change doesn't undo their choice. A reload follows the system again, so
/// the page's placeholder (`prefers-color-scheme`) always matches the first
/// frame.
pub fn stop_following_system_appearance(cx: &mut App) {
    cx.default_global::<SystemAppearance>().ignored = true;
}

#[cfg(target_family = "wasm")]
type FirstFrameHook = Box<dyn FnOnce(&mut Window, &mut App)>;

/// The app's view, filling the canvas. `shared/`'s bootstrap opens the window
/// with it; apps don't construct it.
///
/// It follows the system light/dark appearance until the app stops it
/// ([`stop_following_system_appearance`]); views only read `cx.theme()`. The
/// sheet, dialog, and notification layers are `Root`'s job (gpui-kit 0.7).
///
/// On the web it also owns the first-frame mark: its first render with a real
/// viewport arms the `gpui:first-frame` mark, then runs the post-paint hook. The perf panel
/// draws above the app's view; `Root`'s dialogs and sheets draw above it.
// Public only because the native build (clippy and tests) has no bootstrap
// to construct it, and everything it uses would read as dead code.
#[doc(hidden)]
pub struct AppShell {
    content: AnyView,
    #[cfg(feature = "panel")]
    panel: Entity<PerfPanel>,
    #[cfg(target_family = "wasm")]
    first_frame: Option<FirstFrameHook>,
    _appearance: Subscription,
}

impl AppShell {
    /// `title` names the app in the perf panel.
    #[cfg_attr(not(feature = "panel"), expect(unused_variables))]
    pub fn new(
        title: impl Into<SharedString>,
        content: impl Into<AnyView>,
        window: &mut Window,
        cx: &mut Context<Self>,
    ) -> Self {
        let appearance = cx.observe_window_appearance(window, |_, window, cx| {
            // A system change must not undo the visitor's choice.
            if !cx
                .try_global::<SystemAppearance>()
                .is_some_and(|appearance| appearance.ignored)
            {
                Theme::sync_system_appearance(Some(window), cx);
            }
        });
        Self {
            content: content.into(),
            #[cfg(feature = "panel")]
            panel: cx.new(|cx| PerfPanel::new(title.into(), cx)),
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
                #[cfg(feature = "panel")]
                {
                    if let Some(ttfp_ms) = ttfp_ms {
                        crate::perf::set_ttfp(cx, ttfp_ms);
                    }
                    crate::frames::start(cx, ttfp_ms);
                }
                #[cfg(not(feature = "panel"))]
                let _ = ttfp_ms;
                hook(window, cx);
            });
        })
        .detach();
    }
}

impl Render for AppShell {
    // Only the web build arms the first-frame mark with `window`.
    #[cfg_attr(not(target_family = "wasm"), expect(unused_variables))]
    fn render(&mut self, window: &mut Window, cx: &mut Context<Self>) -> impl IntoElement {
        #[cfg(target_family = "wasm")]
        {
            #[cfg(feature = "panel")]
            crate::frames::frame_started();
            self.arm_first_frame(window, cx);
        }
        // Root already sets the background, text color, and font family.
        let shell = div().relative().size_full().child(self.content.clone());
        #[cfg(feature = "panel")]
        let shell = shell.child(
            AnyView::from(self.panel.clone()).cached(
                StyleRefinement::default()
                    .absolute()
                    .top_0()
                    .left_0()
                    .size_full(),
            ),
        );
        shell
    }
}
