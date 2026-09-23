//! The workbench: Tycho's one window. Empty until a file or sample is loaded.

use gpui_kit::component::button::Button;
use gpui_kit::component::empty::{Empty, EmptyContent, EmptyDescription, EmptyHeader, EmptyTitle};
use gpui_kit::component::{Disableable as _, v_flex};
use gpui_kit::*;

pub struct Workbench {}

impl Workbench {
    pub fn new(_window: &mut Window, _cx: &mut Context<Self>) -> Self {
        Self {}
    }

    fn render_empty(&self) -> impl IntoElement {
        Empty::new()
            .border_0()
            .header(
                EmptyHeader::new()
                    .title(EmptyTitle::new().child("Drop a CSV or Parquet file"))
                    .description(EmptyDescription::new().child("Files stay on this device.")),
            )
            .content(
                EmptyContent::new().child(
                    // Enabled once the asteroid sample is hosted (M3).
                    Button::new("try-sample-asteroids")
                        .outline()
                        .label("Try sample: every known asteroid")
                        .disabled(true),
                ),
            )
    }
}

impl Render for Workbench {
    fn render(&mut self, _window: &mut Window, _cx: &mut Context<Self>) -> impl IntoElement {
        v_flex().size_full().p_4().child(self.render_empty())
    }
}
