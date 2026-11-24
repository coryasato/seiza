//! Tycho's theme on the canvas: the token file (`web/src/tokens.css`, read
//! by `build.rs`) mapped onto the gpui-kit colors the tall table and the
//! perf panel read. The page owns which theme is shown: it passes the first
//! to `start` and every change after ([`apply`]), so the canvas never
//! follows the system on its own.

#[allow(clippy::excessive_precision, clippy::unreadable_literal)]
mod tokens {
    include!(concat!(env!("OUT_DIR"), "/tokens.rs"));
}
pub use tokens::{DARK, LIGHT, Tokens};

use gpui_kit::component::{Theme, ThemeColor, ThemeMode};
use gpui_kit::{App, Hsla};

/// The tokens of one theme.
pub fn tokens(dark: bool) -> &'static Tokens {
    if dark { &DARK } else { &LIGHT }
}

/// Writes `tokens` onto the colors the table and the panel read. The table
/// has no stripes and draws its head on the page's ground, as the design
/// does; its active cell is the accent's.
pub fn map(tokens: &Tokens, colors: &mut ThemeColor) {
    let c = |rgba: gpui_kit::Rgba| Hsla::from(rgba);
    colors.background = c(tokens.background);
    colors.foreground = c(tokens.foreground);
    colors.muted = c(tokens.surface_raised);
    colors.muted_foreground = c(tokens.foreground_muted);
    colors.border = c(tokens.border);
    colors.input = c(tokens.border_strong);
    // The table's frame while it has focus: a step up from its line, not
    // the accent, which the design keeps for the current state.
    colors.ring = c(tokens.border_strong);
    colors.primary = c(tokens.accent_fill);
    colors.primary_foreground = c(tokens.accent_on);
    colors.secondary = c(tokens.surface_active);
    colors.danger = c(tokens.error);
    colors.popover = c(tokens.surface);
    colors.popover_foreground = c(tokens.foreground);
    colors.selection = c(tokens.accent_tint);
    colors.skeleton = c(tokens.border);
    colors.scrollbar = c(tokens.background).opacity(0.);
    colors.scrollbar_thumb = c(tokens.border_strong);
    colors.scrollbar_thumb_hover = c(tokens.foreground_subtle);
    colors.table = c(tokens.background);
    colors.table_head = c(tokens.background);
    colors.table_head_foreground = c(tokens.foreground_muted);
    colors.table_even = c(tokens.background);
    colors.table_hover = c(tokens.surface_raised);
    colors.table_row_border = c(tokens.border_subtle);
    colors.table_active = c(tokens.accent_tint);
    colors.table_active_border = c(tokens.accent);
}

/// Shows the dark or light theme on the canvas: gpui-kit's theme for the
/// mode, then Tycho's tokens over it. Every window redraws.
pub fn apply(dark: bool, cx: &mut App) {
    Theme::change(
        if dark {
            ThemeMode::Dark
        } else {
            ThemeMode::Light
        },
        None,
        cx,
    );
    Theme::update(cx, |theme| map(tokens(dark), &mut theme.colors));
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn token_file_reads() {
        // The ground: the canvas's dark #0c0d10 and light #ffffff.
        let to_byte = |v: f32| (v * 255.0).round() as u8;
        let dark = DARK.background;
        assert_eq!(
            [to_byte(dark.r), to_byte(dark.g), to_byte(dark.b)],
            [0x0c, 0x0d, 0x10]
        );
        let light = LIGHT.background;
        assert_eq!([light.r, light.g, light.b, light.a], [1.0, 1.0, 1.0, 1.0]);
        // A token with an alpha keeps it.
        assert!((DARK.accent_tint.a - 0.14).abs() < 1e-6);
    }
}
