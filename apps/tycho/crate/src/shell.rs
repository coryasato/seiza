//! Tycho's window: a title bar above the workbench, with the theme toggle and
//! the observation panel's toggle.

use gpui_kit::assets::IconName;
use gpui_kit::component::button::{Button, ButtonVariants as _};
use gpui_kit::component::{
    ActiveTheme as _, Selectable as _, Sizable as _, Theme, ThemeMode, TitleBar, h_flex, v_flex,
};
use gpui_kit::*;

actions!(tycho, [ToggleTheme]);

/// The window's, the title bar's, and the perf panel's title. The
/// placeholder's title bar (`web/vite.config.ts`) spells it too.
pub const TITLE: &str = "Tycho";

// The icons the title bar draws, embedded in the wasm (`seiza::Bootstrap`'s
// `assets`). Unlisted icons draw nothing.
gpui_kit::assets::icon_assets!(pub Icons, [Sun, Moon]);

/// Binds the theme shortcut.
pub fn init(cx: &mut App) {
    // Both spellings, as for the panel's Cmd/Ctrl+Shift+P.
    cx.bind_keys([
        KeyBinding::new("cmd-shift-l", ToggleTheme, None),
        KeyBinding::new("ctrl-shift-l", ToggleTheme, None),
    ]);
    cx.on_action(|_: &ToggleTheme, cx| toggle_theme(cx));
}

/// Switches between the light and dark themes, and stops following the
/// system appearance until a reload. In memory only, by design: a reload
/// follows the system again, so the page's placeholder
/// (`prefers-color-scheme`) always matches the first frame.
fn toggle_theme(cx: &mut App) {
    seiza::stop_following_system_appearance(cx);
    let mode = if cx.theme().is_dark() {
        ThemeMode::Light
    } else {
        ThemeMode::Dark
    };
    // Refreshes every window.
    Theme::change(mode, None, cx);
}

/// A title bar above the workbench, filling the window.
///
/// Its buttons take the web's pointer cursor (gpui-kit gives buttons the
/// desktop arrow). `web/vite.config.ts`'s placeholder draws the same bar;
/// keep them matched.
pub struct Shell {
    content: AnyView,
    /// The panel's visibility as last rendered (the toggle's state).
    panel_visible: bool,
    _perf: Subscription,
}

impl Shell {
    pub fn new(content: impl Into<AnyView>, cx: &mut Context<Self>) -> Self {
        // Only for the toggle; the panel observes its own values.
        let perf = cx.observe_global::<seiza::PerfOverlay>(|this: &mut Self, cx| {
            if this.panel_visible != seiza::perf::is_visible(cx) {
                cx.notify();
            }
        });
        Self {
            content: content.into(),
            panel_visible: false,
            _perf: perf,
        }
    }
}

impl Render for Shell {
    fn render(&mut self, _: &mut Window, cx: &mut Context<Self>) -> impl IntoElement {
        self.panel_visible = seiza::perf::is_visible(cx);
        // Shows the theme a press switches to: a sun in dark, a moon in
        // light. The placeholder draws the same icons; keep them matched.
        let (theme_icon, theme_tooltip) = if cx.theme().is_dark() {
            (IconName::Sun, "Light theme (Cmd/Ctrl+Shift+L)")
        } else {
            (IconName::Moon, "Dark theme (Cmd/Ctrl+Shift+L)")
        };

        v_flex()
            .size_full()
            .child(
                TitleBar::new().child(
                    h_flex()
                        .flex_1()
                        .pr_2()
                        .justify_between()
                        .child(div().text_sm().child(TITLE))
                        .child(
                            h_flex()
                                .gap_1()
                                .child(
                                    Button::new("tycho-theme-toggle")
                                        .ghost()
                                        .xsmall()
                                        .icon(theme_icon)
                                        .cursor_pointer()
                                        .tooltip(theme_tooltip)
                                        .on_click(|_, _, cx| toggle_theme(cx)),
                                )
                                .child(
                                    Button::new("tycho-perf-toggle")
                                        .ghost()
                                        .xsmall()
                                        .label("Observation panel")
                                        .cursor_pointer()
                                        .selected(self.panel_visible)
                                        .tooltip("Live load, frame, and memory numbers (Cmd/Ctrl+Shift+P)")
                                        .on_click(|_, _, cx| seiza::perf::toggle(cx)),
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
            )
    }
}
