//! The workbench: Tycho's one window. Empty until a file or sample is loaded.

use gpui_kit::component::button::Button;
use gpui_kit::component::empty::{Empty, EmptyContent, EmptyDescription, EmptyHeader, EmptyTitle};
use gpui_kit::component::{ActiveTheme as _, Disableable as _, v_flex};
use gpui_kit::*;

use crate::engine::EngineStatus;

pub struct Workbench {
    _engine_status: Subscription,
}

impl Workbench {
    pub fn new(_window: &mut Window, cx: &mut Context<Self>) -> Self {
        Self {
            _engine_status: cx.observe_global::<EngineStatus>(|_, cx| cx.notify()),
        }
    }

    /// One quiet line under the sample button. The engine loads after first
    /// paint, so the shell says so until it's ready (Tycho rule 1).
    fn render_engine_status(&self, cx: &App) -> impl IntoElement {
        let theme = cx.theme();
        let status = cx.try_global::<EngineStatus>().cloned().unwrap_or_default();
        let (text, color): (SharedString, _) = match status {
            EngineStatus::Loading => ("Engine loading…".into(), theme.muted_foreground),
            EngineStatus::Ready { .. } => ("Engine ready".into(), theme.muted_foreground),
            EngineStatus::Failed(message) => (
                format!("Engine failed to load: {message}. Reload the page to try again.").into(),
                theme.danger,
            ),
        };
        div().text_xs().text_color(color).child(text)
    }

    fn render_empty(&self, cx: &App) -> impl IntoElement {
        Empty::new()
            .border_0()
            .header(
                EmptyHeader::new()
                    .title(EmptyTitle::new().child("Drop a CSV or Parquet file"))
                    .description(EmptyDescription::new().child("Files stay on this device.")),
            )
            .content(
                EmptyContent::new()
                    .child(
                        // Enabled once the asteroid sample is hosted (M3).
                        Button::new("try-sample-asteroids")
                            .outline()
                            .label("Try sample: every known asteroid")
                            .disabled(true),
                    )
                    .child(self.render_engine_status(cx)),
            )
    }
}

impl Render for Workbench {
    fn render(&mut self, _window: &mut Window, cx: &mut Context<Self>) -> impl IntoElement {
        v_flex().size_full().p_4().child(self.render_empty(cx))
    }
}
