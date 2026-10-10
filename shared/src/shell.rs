//! The window shell every app renders into: a title bar above the app's view,
//! plus the perf panel.

use gpui_kit::assets::IconName;
use gpui_kit::component::button::{Button, ButtonVariants as _};
use gpui_kit::component::{
    ActiveTheme as _, Selectable as _, Sizable as _, Theme, ThemeMode, TitleBar, h_flex, v_flex,
};
use gpui_kit::*;

use crate::panel::PerfPanel;

actions!(seiza, [ToggleTheme]);

/// Whether the shell still follows the system appearance: until the visitor
/// picks a theme (the title bar's button or Cmd/Ctrl+Shift+L), then never
/// again until a reload. In memory only, by design: remembering the choice is
/// the job of whatever embeds these views, at its own root.
#[derive(Default)]
struct ThemeChoice {
    picked: bool,
}

impl Global for ThemeChoice {}

/// Binds the theme shortcut. `shared/`'s bootstrap calls this after
/// `gpui_kit::init`.
#[cfg_attr(
    not(target_family = "wasm"),
    expect(dead_code, reason = "only the web bootstrap calls it")
)]
pub(crate) fn init(cx: &mut App) {
    cx.set_global(ThemeChoice::default());
    // Both spellings, as for the panel's Cmd/Ctrl+Shift+P.
    cx.bind_keys([
        KeyBinding::new("cmd-shift-l", ToggleTheme, None),
        KeyBinding::new("ctrl-shift-l", ToggleTheme, None),
    ]);
    cx.on_action(|_: &ToggleTheme, cx| toggle_theme(cx));
}

/// Switches between the light and dark themes, and stops following the
/// system appearance until a reload.
fn toggle_theme(cx: &mut App) {
    cx.default_global::<ThemeChoice>().picked = true;
    let mode = if cx.theme().is_dark() {
        ThemeMode::Light
    } else {
        ThemeMode::Dark
    };
    // Refreshes every window.
    Theme::change(mode, None, cx);
}

#[cfg(target_family = "wasm")]
type FirstFrameHook = Box<dyn FnOnce(&mut Window, &mut App)>;

/// A title bar above the app's content, filling the canvas.
///
/// It follows the system light/dark appearance until the visitor picks a
/// theme ([`ThemeChoice`]); views only read `cx.theme()`. A reload follows the
/// system again, so the page's placeholder (`prefers-color-scheme`) always
/// matches the first frame. Its buttons take the web's pointer cursor
/// (gpui-kit gives buttons the desktop arrow). The sheet, dialog, and
/// notification layers are `Root`'s job (gpui-kit 0.7).
///
/// On the web it also owns the first-frame mark: its first render with a real
/// viewport arms the `gpui:first-frame` mark, then runs the post-paint hook. The perf panel
/// draws above the app's view; `Root`'s dialogs and sheets draw above it.
pub struct AppShell {
    title: SharedString,
    content: AnyView,
    panel: Entity<PerfPanel>,
    /// The panel's visibility as last rendered (the title bar's toggle).
    panel_visible: bool,
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
            // A system change must not undo the visitor's choice.
            if !cx
                .try_global::<ThemeChoice>()
                .is_some_and(|choice| choice.picked)
            {
                Theme::sync_system_appearance(Some(window), cx);
            }
        });
        // Only for the title bar's toggle; the panel observes its own values.
        let perf = cx.observe_global::<crate::perf::PerfOverlay>(|this: &mut Self, cx| {
            if this.panel_visible != crate::perf::is_visible(cx) {
                cx.notify();
            }
        });
        let title = title.into();
        let panel = cx.new(|cx| PerfPanel::new(title.clone(), cx));
        Self {
            title,
            content: content.into(),
            panel,
            panel_visible: false,
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
                crate::frames::start(cx, ttfp_ms);
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
            crate::frames::frame_started();
            self.arm_first_frame(window, cx);
        }
        self.panel_visible = crate::perf::is_visible(cx);
        // Shows the theme a press switches to: a sun in dark, a moon in
        // light. `shared-web`'s placeholder draws the same icons; keep them
        // matched.
        let (theme_icon, theme_tooltip) = if cx.theme().is_dark() {
            (IconName::Sun, "Light theme (Cmd/Ctrl+Shift+L)")
        } else {
            (IconName::Moon, "Dark theme (Cmd/Ctrl+Shift+L)")
        };

        // Root already sets the background, text color, and font family.
        div()
            .relative()
            .size_full()
            .child(
                v_flex()
                    .size_full()
                    .child(
                        TitleBar::new().child(
                            h_flex()
                                .flex_1()
                                .pr_2()
                                .justify_between()
                                .child(div().text_sm().child(self.title.clone()))
                                .child(
                                    h_flex()
                                        .gap_1()
                                        .child(
                                            Button::new("seiza-theme-toggle")
                                                .ghost()
                                                .xsmall()
                                                .icon(theme_icon)
                                                .cursor_pointer()
                                                .tooltip(theme_tooltip)
                                                .on_click(|_, _, cx| toggle_theme(cx)),
                                        )
                                        .child(
                                            Button::new("seiza-perf-toggle")
                                                .ghost()
                                                .xsmall()
                                                .label("Observation panel")
                                                .cursor_pointer()
                                                .selected(self.panel_visible)
                                                .tooltip("Live load, frame, and memory numbers (Cmd/Ctrl+Shift+P)")
                                                .on_click(|_, _, cx| crate::perf::toggle(cx)),
                                        ),
                                ),
                        ),
                    )
                    .child(
                        div()
                            .flex_1()
                            .min_h_0()
                            .min_w_0()
                            .child(self.content.clone()),
                    ),
            )
            .child(
                AnyView::from(self.panel.clone())
                    .cached(StyleRefinement::default().absolute().top_0().left_0().size_full()),
            )
    }
}
